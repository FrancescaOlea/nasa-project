"""
Mars surface temperatures from a simple thermal model (in the spirit of NASA/USGS's
KRC model), driven by MGS TES albedo, TES thermal inertia and MOLA elevation.

For every 1 x 1 degree cell it simulates two Mars years, hour by hour, and keeps the
second year:
  * sunlight from Mars's real orbit (eccentricity 0.0934, axial tilt 25.19 deg),
    dimmed by the dusty atmosphere (optical depth 0.3) along its slanted path, with
    half of the blocked light still arriving as diffuse skylight
  * the atmosphere's own infrared glow: 5.5% of the local noon sunlight (KRC "FANON")
  * heat flowing into 30 ground layers, reaching ~80 daily heating depths (enough
    for the seasonal wave); ground heat capacity 1.2 MJ/m3/K, conductivity from the
    thermal inertia
  * CO2 frost: the ground can't cool below the CO2 frost point (about -125 C, set by
    the local air pressure, i.e. elevation); extra cooling turns into frost, which
    has to evaporate again (latent heat 590 kJ/kg) before the ground warms; frosted
    ground reflects 60% of sunlight
Outputs per cell (degrees C or K difference):
  mean      average surface temperature over the year
  daily     average day-night swing (daily max - min, averaged over the year)
  yearly    hottest minus coldest moment of the whole year
It is a model, not a measurement: compare_sites() checks it against published
lander/rover temperatures.
"""
import math
import os

import numpy as np

SIGMA = 5.670e-8
SOLAR_1AU = 1361.0
A_AU, ECC, OBLIQ = 1.5237, 0.0934, math.radians(25.19)
LS_PERIHELION = math.radians(251.0)
SOL = 88775.0                       # seconds
SOLS_PER_YEAR = 668.6
STEPS_PER_SOL = 24
EMISSIVITY = 0.95
HEAT_CAPACITY = 1.2e6               # J/m3/K (rho * c)
DUST_TAU = 0.3                      # typical atmospheric optical depth
FANON = 0.055
FROST_ALBEDO = 0.6
LATENT = 5.9e5                      # J/kg, CO2


def transmission(mu):
    """Share of sunlight reaching the ground: direct beam dims with path length 1/mu,
    half of what's taken out still arrives as scattered skylight."""
    direct = math.exp(-DUST_TAU / max(mu, 0.05)) if mu > 0 else 0.0
    return direct + 0.5 * (1 - direct) if mu > 0 else 0.0


def frost_point(elev_km):
    """CO2 frost temperature (K) from surface pressure; pressure falls ~10.8 km per e-fold."""
    p_pa = 610.0 * np.exp(-elev_km / 10.8)
    return -3167.8 / (np.log(0.01 * p_pa) - 23.23)


def ls_at(t_sols):
    """Solar longitude (season angle) and Sun distance for a time since perihelion."""
    m = 2 * math.pi * (t_sols / SOLS_PER_YEAR)              # mean anomaly
    e = m
    for _ in range(6):                                         # Kepler's equation
        e = m + ECC * math.sin(e)
    nu = 2 * math.atan2(math.sqrt(1 + ECC) * math.sin(e / 2), math.sqrt(1 - ECC) * math.cos(e / 2))
    r = A_AU * (1 - ECC * math.cos(e))
    return (nu + LS_PERIHELION) % (2 * math.pi), r


def simulate(lat_deg, albedo, inertia, elev_km, years=2, layers=30, history=None):
    """Vectorised over cells (1-D arrays). Returns mean, daily, yearly (C / K)."""
    n = lat_deg.size
    lat = np.radians(lat_deg)
    k = inertia ** 2 / HEAT_CAPACITY                           # conductivity
    skin = np.sqrt(k * SOL / (math.pi * HEAT_CAPACITY))        # daily heating depth (m)
    # layer thicknesses in skin depths: thin at the top, growing 20% per layer
    ds = 0.08 * 1.2 ** np.arange(layers)
    dz = ds[:, None] * skin[None, :]                           # (layers, n)
    h = np.empty_like(dz)                                      # control-volume thickness
    h[0] = dz[0] / 2
    h[1:] = (dz[:-1] + dz[1:]) / 2
    cap = HEAT_CAPACITY * h                                    # J/m2/K per node
    cond = k[None, :] / dz                                     # W/m2/K between nodes i, i+1
    t_frost = frost_point(elev_km)

    # start near the radiative-equilibrium temperature of the latitude
    start = 210 - 60 * np.abs(np.sin(lat))
    T = np.repeat(np.maximum(start, t_frost)[None, :], layers, axis=0)
    frost = np.zeros(n)                                        # kg/m2 of CO2 frost

    dt = SOL / STEPS_PER_SOL
    total_steps = int(round(years * SOLS_PER_YEAR * STEPS_PER_SOL))
    keep_from = total_steps - int(round(SOLS_PER_YEAR * STEPS_PER_SOL))
    acc_sum = np.zeros(n)
    acc_count = 0
    year_max = np.full(n, -np.inf)
    year_min = np.full(n, np.inf)
    day_max = np.full(n, -np.inf)
    day_min = np.full(n, np.inf)
    daily_sum = np.zeros(n)
    low_sum = np.zeros(n)
    high_sum = np.zeros(n)
    days = 0

    for step in range(total_steps):
        t_sols = step / STEPS_PER_SOL
        ls, r = ls_at(t_sols)
        dec = math.asin(math.sin(OBLIQ) * math.sin(ls))
        hour_angle = 2 * math.pi * ((step % STEPS_PER_SOL) + 0.5) / STEPS_PER_SOL - math.pi
        flux = SOLAR_1AU / r ** 2
        mu = np.sin(lat) * math.sin(dec) + np.cos(lat) * math.cos(dec) * math.cos(hour_angle)
        mu_noon = np.sin(lat) * math.sin(dec) + np.cos(lat) * math.cos(dec)
        a = np.where(frost > 0, FROST_ALBEDO, albedo)
        direct = np.exp(-DUST_TAU / np.maximum(mu, 0.05))
        absorbed = (1 - a) * flux * np.where(mu > 0, direct + 0.5 * (1 - direct), 0) * np.maximum(mu, 0)
        sky = FANON * flux * np.maximum(mu_noon, 0)

        # implicit (backward Euler) step; the surface radiation (T^4) is linearised and,
        # on frost-free ground, the solve is repeated (Newton iterations) so a sudden jump
        # in sunlight - e.g. right after the last frost disappears - can't overshoot.
        # Under frost the surface is pinned at the frost point, so the linearisation there
        # is exact and the surplus energy (computed below) evaporates frost.
        T_old = T.copy()
        T_lin = T_old[0]
        frosted = frost > 0
        for _ in range(4):
            rad = EMISSIVITY * SIGMA * T_lin ** 4
            drad = 4 * EMISSIVITY * SIGMA * T_lin ** 3
            lower = np.zeros_like(T)
            upper = np.zeros_like(T)
            diag = (cap / dt).copy()
            rhs = cap / dt * T_old
            diag[:-1] += cond[:-1]
            diag[1:] += cond[:-1]
            upper[:-1] = -cond[:-1]
            lower[1:] = -cond[:-1]
            diag[0] += drad
            rhs[0] += absorbed + sky - rad + drad * T_lin
            c = np.empty_like(T)
            d = np.empty_like(T)
            c[0] = upper[0] / diag[0]
            d[0] = rhs[0] / diag[0]
            for i in range(1, layers):
                m = diag[i] - lower[i] * c[i - 1]
                c[i] = upper[i] / m
                d[i] = (rhs[i] - lower[i] * d[i - 1]) / m
            T[-1] = d[-1]
            for i in range(layers - 2, -1, -1):
                T[i] = d[i] - c[i] * T[i + 1]
            change = np.where(frosted, 0, np.abs(T[0] - T_lin))
            if np.max(change) < 0.01:
                break
            T_lin = np.where(frosted, T_old[0], T[0])

        # CO2 frost on the surface node
        cold = T[0] < t_frost
        frost += np.where(cold, cap[0] * (t_frost - T[0]) / LATENT, 0)
        T[0] = np.where(cold, t_frost, T[0])
        warm = (frost > 0) & (T[0] > t_frost)
        melt = np.where(warm, np.minimum(frost, cap[0] * (T[0] - t_frost) / LATENT), 0)
        T[0] = T[0] - melt * LATENT / cap[0]
        frost -= melt

        if history is not None:
            history.append((step, float(T[0][0]), float(frost[0]), float(absorbed[0]) if np.ndim(absorbed) else absorbed))
        if step >= keep_from:
            ts = T[0]
            acc_sum += ts
            acc_count += 1
            year_max = np.maximum(year_max, ts)
            year_min = np.minimum(year_min, ts)
            day_max = np.maximum(day_max, ts)
            day_min = np.minimum(day_min, ts)
            if (step + 1) % STEPS_PER_SOL == 0:
                daily_sum += day_max - day_min
                low_sum += day_min
                high_sum += day_max
                days += 1
                day_max[:] = -np.inf
                day_min[:] = np.inf

    return dict(mean=acc_sum / acc_count - 273.15, daily=daily_sum / days, yearly=year_max - year_min,
                low=low_sum / days, high=high_sum / days)


def _sun_tables(years):
    """Season (declination) and Sun distance for every time step."""
    total = int(round(years * SOLS_PER_YEAR * STEPS_PER_SOL))
    dec = np.empty(total)
    flux = np.empty(total)
    hour = np.empty(total)
    for step in range(total):
        ls, r = ls_at(step / STEPS_PER_SOL)
        dec[step] = math.asin(math.sin(OBLIQ) * math.sin(ls))
        flux[step] = SOLAR_1AU / r ** 2
        hour[step] = 2 * math.pi * ((step % STEPS_PER_SOL) + 0.5) / STEPS_PER_SOL - math.pi
    return dec, flux, hour


def simulate_fast(lat_deg, albedo, inertia, elev_km, years=2, layers=30):
    """Same physics as simulate(), compiled with numba and run on all CPU cores."""
    import numba

    @numba.njit(parallel=True, fastmath=True, cache=True)
    def kernel(lat, albedo, inertia, t_frost, dec, flux, hour, keep_from, steps_per_sol, layers,
               out_mean, out_daily, out_yearly, out_low, out_high, out_tmax, out_tmin):
        n = lat.size
        total = dec.size
        dt = SOL / steps_per_sol
        for cell in numba.prange(n):
            k = inertia[cell] ** 2 / HEAT_CAPACITY
            skin = math.sqrt(k * SOL / (math.pi * HEAT_CAPACITY))
            dz = np.empty(layers)
            cap = np.empty(layers)
            for i in range(layers):
                dz[i] = 0.08 * 1.2 ** i * skin
            cap[0] = HEAT_CAPACITY * dz[0] / 2
            for i in range(1, layers):
                cap[i] = HEAT_CAPACITY * (dz[i - 1] + dz[i]) / 2
            cond = np.empty(layers)
            for i in range(layers):
                cond[i] = k / dz[i]
            sl, cl = math.sin(lat[cell]), math.cos(lat[cell])
            tf = t_frost[cell]
            T = np.empty(layers)
            start = max(210 - 60 * abs(sl), tf)
            for i in range(layers):
                T[i] = start
            frost = 0.0
            c = np.empty(layers)
            d = np.empty(layers)
            T_old = np.empty(layers)
            s_sum = 0.0
            n_sum = 0
            ymax, ymin = -1e9, 1e9
            dmax, dmin = -1e9, 1e9
            daily_sum = low_sum = high_sum = 0.0
            day_hi = np.empty(700)
            day_lo = np.empty(700)
            days = 0
            for step in range(total):
                sd, cd = math.sin(dec[step]), math.cos(dec[step])
                mu = sl * sd + cl * cd * math.cos(hour[step])
                mu_noon = sl * sd + cl * cd
                a = 0.6 if frost > 0 else albedo[cell]
                tr = 0.0
                if mu > 0:
                    direct = math.exp(-DUST_TAU / max(mu, 0.05))
                    tr = direct + 0.5 * (1 - direct)
                absorbed = (1 - a) * flux[step] * tr * max(mu, 0.0)
                sky = FANON * flux[step] * max(mu_noon, 0.0)
                for i in range(layers):
                    T_old[i] = T[i]
                T_lin = T[0]
                # Newton iterations on the T^4 surface radiation, only on frost-free ground
                # (under frost the surface is pinned at the frost point: one pass is exact)
                n_iter = 1 if frost > 0 else 6
                for _it in range(n_iter):
                    rad = EMISSIVITY * SIGMA * T_lin ** 4
                    drad = 4 * EMISSIVITY * SIGMA * T_lin ** 3
                    for i in range(layers):
                        diag = cap[i] / dt
                        rhs = cap[i] / dt * T_old[i]
                        lower = 0.0
                        upper = 0.0
                        if i < layers - 1:
                            diag += cond[i]
                            upper = -cond[i]
                        if i > 0:
                            diag += cond[i - 1]
                            lower = -cond[i - 1]
                        if i == 0:
                            diag += drad
                            rhs += absorbed + sky - rad + drad * T_lin
                            c[0] = upper / diag
                            d[0] = rhs / diag
                        else:
                            m = diag - lower * c[i - 1]
                            c[i] = upper / m
                            d[i] = (rhs - lower * d[i - 1]) / m
                    T[layers - 1] = d[layers - 1]
                    for i in range(layers - 2, -1, -1):
                        T[i] = d[i] - c[i] * T[i + 1]
                    if abs(T[0] - T_lin) < 0.01:
                        break
                    T_lin = T[0]
                # CO2 frost
                if T[0] < tf:
                    frost += cap[0] * (tf - T[0]) / LATENT
                    T[0] = tf
                elif frost > 0 and T[0] > tf:
                    melt = min(frost, cap[0] * (T[0] - tf) / LATENT)
                    T[0] -= melt * LATENT / cap[0]
                    frost -= melt
                if step >= keep_from:
                    ts = T[0]
                    s_sum += ts
                    n_sum += 1
                    ymax = max(ymax, ts)
                    ymin = min(ymin, ts)
                    dmax = max(dmax, ts)
                    dmin = min(dmin, ts)
                    if (step + 1) % steps_per_sol == 0:
                        daily_sum += dmax - dmin
                        low_sum += dmin
                        high_sum += dmax
                        if days < 700:
                            day_hi[days] = dmax
                            day_lo[days] = dmin
                        days += 1
                        dmax, dmin = -1e9, 1e9
            out_mean[cell] = s_sum / n_sum - 273.15
            out_daily[cell] = daily_sum / days
            out_yearly[cell] = ymax - ymin
            out_low[cell] = low_sum / days
            out_high[cell] = high_sum / days
            # Like Earth's 'hottest month' / 'coldest month': average the daily highs (lows)
            # over a sliding Mars month (1/12 of the year, ~56 sols, wrapping around the
            # year) and keep the warmest (coldest) such month.
            nd = min(days, 700)
            win = max(1, int(round(nd / 12)))
            best_hi = -1e9
            best_lo = 1e9
            for start in range(nd):
                shi = 0.0
                slo = 0.0
                for k in range(win):
                    idx = (start + k) % nd
                    shi += day_hi[idx]
                    slo += day_lo[idx]
                best_hi = max(best_hi, shi / win)
                best_lo = min(best_lo, slo / win)
            out_tmax[cell] = best_hi - 273.15
            out_tmin[cell] = best_lo - 273.15

    dec, flux, hour = _sun_tables(years)
    keep_from = dec.size - int(round(SOLS_PER_YEAR * STEPS_PER_SOL))
    n = lat_deg.size
    outs = [np.empty(n) for _ in range(7)]
    kernel(np.radians(lat_deg).astype(np.float64), albedo.astype(np.float64), inertia.astype(np.float64),
           frost_point(elev_km).astype(np.float64), dec, flux, hour, keep_from, STEPS_PER_SOL, layers, *outs)
    return dict(zip(('mean', 'daily', 'yearly', 'low', 'high', 'tmax', 'tmin'), outs))


def cell_inputs(raw_dir, res=1.0):
    """Albedo, thermal inertia and elevation averaged onto a res-degree grid."""
    alb = np.fromfile(os.path.join(raw_dir, 'global_albedo_8ppd.img'), dtype='<f4').reshape(1440, 2880)
    ti = np.fromfile(os.path.join(raw_dir, 'global_ti_night_2007.img'), dtype='>i2').reshape(3600, 7200)
    ti = ti.astype(np.float32)
    ti[ti <= 0] = np.nan
    dem = np.memmap(os.path.join(raw_dir, 'megt90n000fb.img'), dtype='>i2', mode='r', shape=(5760, 11520))
    dem = np.roll(np.asarray(dem, dtype=np.float32) / 1000, 5760, axis=1)  # km, -180..180

    h, w = int(180 / res), int(360 / res)

    def block(a, how):
        f = a.shape[0] // h
        b = a.reshape(h, f, w, f)
        return how(b, axis=(1, 3))

    alb_c = block(alb, np.nanmean)
    # thermal inertia: average in log space; poleward of the TES limit use the
    # nearest latitude's value (frost dominates there anyway)
    ti_c = 10 ** block(np.log10(ti), np.nanmean)
    with np.errstate(invalid='ignore'):
        for col in range(w):
            colv = ti_c[:, col]
            good = np.isfinite(colv)
            if good.any() and not good.all():
                idx = np.arange(h)
                ti_c[:, col] = np.interp(idx, idx[good], colv[good])
    ti_c = np.clip(np.nan_to_num(ti_c, nan=250), 20, 2500)
    elev_c = block(dem, np.mean)
    lat_c = np.repeat((90 - (np.arange(h) + 0.5) * res)[:, None], w, axis=1)
    return lat_c, alb_c, ti_c, elev_c


def mars_temperature_maps(raw_dir, res=1.0, cache=True):
    """mean, daily, yearly, tmax, tmin grids (C / K differences)."""
    keys = ('mean', 'daily', 'yearly', 'tmax', 'tmin')
    path = os.path.join(raw_dir, f'mars_temps_{res}.npz')
    if cache and os.path.exists(path):
        z = np.load(path)
        if all(k in z for k in keys):
            return [z[k] for k in keys]
    lat, alb, ti, elev = cell_inputs(raw_dir, res)
    shape = lat.shape
    r = simulate_fast(lat.ravel(), alb.ravel(), ti.ravel(), elev.ravel())
    out = {k: r[k].reshape(shape).astype(np.float32) for k in keys}
    np.savez(path, **out)
    return [out[k] for k in keys]


# Published surface temperatures at landing sites, for a sanity check.
SITES = {
    # name: (lat, lon, what was observed)
    'Curiosity (Gale)': (-4.59, 137.44, 'ground ~180-200 K before dawn, ~270-295 K early afternoon (REMS)'),
    'InSight (Elysium)': (4.50, 135.62, 'ground ~170-190 K at night, ~250-270 K midday (HP3 radiometer)'),
    'Perseverance (Jezero)': (18.44, 77.45, 'ground ~180-190 K at night, ~270-290 K midday (MEDA)'),
    'Viking 1 (Chryse)': (22.27, -47.95, 'surface ~180-190 K nights, ~260-270 K days (summer)'),
}


def compare_sites(raw_dir, res=1.0):
    lat, alb, ti, elev = cell_inputs(raw_dir, res)
    rows = []
    for name, (la, lo, obs) in SITES.items():
        i, j = int((90 - la) / res), int((lo + 180) / res)
        r = simulate_fast(lat[i:i + 1, j], alb[i:i + 1, j], ti[i:i + 1, j], elev[i:i + 1, j])
        rows.append((name, alb[i, j], ti[i, j], elev[i, j], {k: float(v[0]) for k, v in r.items()}, obs))
    return rows


if __name__ == '__main__':
    import sys
    raw = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'raw')
    for name, a, i, e, r, obs in compare_sites(raw):
        print(f'{name:22s} albedo {a:.2f} TI {i:4.0f} elev {e:5.1f} km | typical night {r["low"]:5.0f} K, '
              f'day {r["high"]:5.0f} K | mean {r["mean"]:6.1f} C, daily swing {r["daily"]:4.0f}, '
              f'yearly range {r["yearly"]:4.0f}\n{"":22s} observed: {obs}')
