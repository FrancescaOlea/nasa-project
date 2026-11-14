"""Sunlight on the Moon and Mars: average solar power reaching flat ground (W/m2), averaged
over day and night and over the whole year - the same quantity as NASA POWER's
ALLSKY_SFC_SW_DWN for Earth (all-sky surface shortwave downward irradiance).

No global measured product exists for either body, so it is calculated from their real
orbits and NASA terrain data:

Mars:  Mars's orbit (eccentricity, 25.19 deg tilt), hour by hour over a Mars year, dimmed by
       dust: optical depth 0.3 at the reference pressure (610 Pa), scaled with the local
       surface pressure from MOLA elevation (less air and dust over mountains). Same sunlight
       model as tools/mars_thermal.py: direct beam exp(-tau/mu), half of the rest arrives as
       skylight. No dust storms or clouds.
Moon:  1361 W/m2 (Earth-Moon at 1 AU), no atmosphere, the Sun's 1.54 deg tilt to the lunar
       equator over the 18.6-year cycle. Poleward of 75 deg, where the Sun stays low and
       mountains cast long shadows, every 1.9 km spot's horizon is computed from the LOLA
       polar elevation models (240 m, averaged to 1.9 km) in 64 directions out to 250 km,
       so permanently shadowed craters get ~0 and sunlit ridges their real share. Towards the
       equator the Sun is high and shadows are short, so flat ground is used.
"""
import math
import os

import numpy as np
from numba import njit, prange

SOLAR = 1361.0
MOON_R = 1737.4e3
MOON_TILT = math.radians(1.54)
SUN_RADIUS = math.radians(0.267)
AZIMUTHS = 64
RAY_KM = 250.0


# ---- Mars -----------------------------------------------------------------------

def mars_sunlight(raw_dir, ppd=4):
    import mars_thermal as mt
    dec, flux, hour = mt._sun_tables(1)
    h = 180 * ppd
    lat = np.radians(90 - (np.arange(h) + 0.5) / ppd)
    # elevation (km), block-averaged from MOLA 32 px/deg
    dem = np.memmap(os.path.join(raw_dir, 'megt90n000fb.img'), dtype='>i2', mode='r', shape=(5760, 11520))
    dem = np.roll(np.asarray(dem, dtype=np.float32) / 1000, 5760, axis=1)
    f = 32 // ppd
    elev = dem.reshape(h, f, 360 * ppd, f).mean(axis=(1, 3))
    # table: mean sunlight for every latitude row and a range of dust optical depths
    taus = np.linspace(0.02, 1.2, 60)
    table = np.empty((h, taus.size))
    sd, cd = np.sin(dec), np.cos(dec)
    for i in range(h):
        mu = np.sin(lat[i]) * sd + np.cos(lat[i]) * cd * np.cos(hour)
        up = mu > 0
        m = np.maximum(mu[up], 0.05)
        for j, tau in enumerate(taus):
            direct = np.exp(-tau / m)
            table[i, j] = np.sum(flux[up] * (direct + 0.5 * (1 - direct)) * mu[up]) / mu.size
    tau = mt.DUST_TAU * np.exp(-elev / 10.8)                     # dust column ~ pressure
    out = np.empty_like(elev)
    for i in range(h):
        out[i] = np.interp(tau[i], taus, table[i])
    return out.astype(np.float32), 1 / ppd


# ---- Moon -----------------------------------------------------------------------

def _sun_samples(n_dec=24, n_hour=360):
    """Declinations and hour angles sampling the long-term average evenly."""
    d = MOON_TILT * np.sin(2 * np.pi * (np.arange(n_dec) + 0.5) / n_dec)
    hh = 2 * np.pi * (np.arange(n_hour) + 0.5) / n_hour - np.pi
    return d, hh


def moon_flat(lat_deg):
    """Long-term average sunlight on flat ground with no terrain, W/m2."""
    d, hh = _sun_samples()
    lat = np.radians(np.asarray(lat_deg))[..., None, None]
    mu = np.sin(lat) * np.sin(d)[:, None] + np.cos(lat) * np.cos(d)[:, None] * np.cos(hh)[None, :]
    return SOLAR * np.maximum(mu, 0).mean(axis=(-1, -2))


@njit(parallel=True, cache=True)
def _horizons(dem, px_m, R, n_az, max_px):
    """Horizon elevation angle (rad) in n_az grid directions for every pixel (curvature included)."""
    h, w = dem.shape
    out = np.full((h, w, n_az), -0.2)
    for r in prange(h):
        for c in range(w):
            z0 = dem[r, c]
            if not np.isfinite(z0):
                continue
            for k in range(n_az):
                a = 2 * np.pi * k / n_az
                dx, dy = math.cos(a), math.sin(a)
                best = -0.2
                s = 1.0
                while s <= max_px:
                    rr = int(round(r + dy * s))
                    cc = int(round(c + dx * s))
                    if rr < 0 or rr >= h or cc < 0 or cc >= w:
                        break
                    z = dem[rr, cc]
                    if np.isfinite(z):
                        dist = s * px_m
                        ang = math.atan((z - z0 - dist * dist / (2 * R)) / dist)
                        if ang > best:
                            best = ang
                    s += 1.0 if s < 20 else s * 0.05
                out[r, c, k] = best
    return out


@njit(parallel=True, cache=True)
def _shadowed_sunlight(hor, lat, north_ang, decs, hours, sun_r):
    """Average sunlight on flat ground, with each pixel's horizon blocking the Sun."""
    h, w, n_az = hor.shape
    out = np.zeros((h, w))
    n = decs.size * hours.size
    for r in prange(h):
        for c in range(w):
            sl, cl = math.sin(lat[r, c]), math.cos(lat[r, c])
            total = 0.0
            for d in decs:
                sd, cd = math.sin(d), math.cos(d)
                for hh in hours:
                    mu = sl * sd + cl * cd * math.cos(hh)
                    if mu < -0.01:
                        continue
                    elev = math.asin(max(-1.0, min(1.0, mu)))
                    east = -cd * math.sin(hh)
                    nrth = cl * sd - sl * cd * math.cos(hh)
                    az = math.atan2(east, nrth)                       # from north, clockwise
                    g = north_ang[r, c] + az                          # direction in the grid
                    k = (g / (2 * np.pi) * n_az) % n_az
                    k0 = int(k) % n_az
                    k1 = (k0 + 1) % n_az
                    f = k - int(k)
                    hz = hor[r, c, k0] * (1 - f) + hor[r, c, k1] * f
                    vis = (elev - hz) / (2 * sun_r) + 0.5             # share of the Sun's disc up
                    if vis <= 0:
                        continue
                    if vis > 1:
                        vis = 1.0
                    total += max(mu, 0.0) * vis
            out[r, c] = 1361.0 * total / n
    return out


def moon_polar(raw_dir, pole, block=8):
    """Shadow-aware sunlight on the LOLA polar stereographic grid, plus each pixel's lat/lon."""
    path = os.path.join(raw_dir, 'lola_polar', f'ldem_75{pole}_240m.img')
    a = np.fromfile(path, '<i2').reshape(3812, 3812).astype(np.float32) * 0.5
    n = (3812 // block) * block
    a = a[:n, :n].reshape(n // block, block, n // block, block).mean(axis=(1, 3))
    px = 240.0 * block
    size = a.shape[0]
    # pixel centres in metres from the pole; rows/cols as in the PDS grid (offset 1905.5 px)
    idx = ((np.arange(size) + 0.5) * block - 1905.5) * 240.0
    X, Y = np.meshgrid(idx, idx)                    # X: along columns, Y: along rows
    rho = np.hypot(X, Y)
    colat = 2 * np.arctan(rho / (2 * MOON_R))
    north = pole == 'n'
    lat = (np.pi / 2 - colat) * (1 if north else -1)
    lon = np.arctan2(X, Y) if north else np.arctan2(X, -Y)
    # grid direction (angle of (col, row)) of local north at each pixel
    north_ang = np.arctan2(-Y, -X) if north else np.arctan2(Y, X)
    hor = _horizons(a.astype(np.float64), px, MOON_R, AZIMUTHS, RAY_KM * 1000 / px)
    decs, hours = _sun_samples()
    sun = _shadowed_sunlight(hor, lat, north_ang, decs, hours, SUN_RADIUS)
    return sun, np.degrees(lat), np.degrees(lon)


def moon_sunlight(raw_dir, ppd=8):
    """Global map: flat ground, with the shadow-aware polar results poleward of 75 deg."""
    h, w = 180 * ppd, 360 * ppd
    lat_rows = 90 - (np.arange(h) + 0.5) / ppd
    out = np.repeat(moon_flat(lat_rows)[:, None], w, axis=1).astype(np.float64)
    for pole in ('s', 'n'):
        sun, la, lo = moon_polar(raw_dir, pole)
        # average the polar pixels into the global grid's cells
        r = np.floor((90 - la) * ppd).astype(int)
        c = np.floor((lo + 180) * ppd).astype(int) % w
        ok = np.abs(la) >= 75.5
        s = np.zeros((h, w)); k = np.zeros((h, w))
        np.add.at(s, (r[ok], c[ok]), sun[ok])
        np.add.at(k, (r[ok], c[ok]), 1)
        rows = np.unique(r[ok])
        for row in rows:
            have = k[row] > 0
            if have.all():
                out[row] = s[row] / k[row]
            elif have.any():  # near the pole cells are wider than polar pixels: fill gaps along the row
                cols = np.nonzero(have)[0]
                vals = s[row, cols] / k[row, cols]
                out[row] = np.interp(np.arange(w), cols, vals, period=w)
    return out.astype(np.float32), 1 / ppd
