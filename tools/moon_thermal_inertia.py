"""Moon thermal inertia from Diviner's midnight temperatures - the same quantity, made the
same way, as the Mars map (MGS TES night thermal inertia).

Ground with a high thermal inertia (rocks, bedrock, compacted soil) stores the day's heat
and stays warmer through the night; fine, fluffy dust cools fast. So the temperature at
midnight tells the thermal inertia once latitude and sunlight are known:

1. A thermal model (uniform ground, heat diffusion with the Moon's 29.53-day day-night
   cycle, sunlight 1361 W/m2, albedo 0.12, emissivity 0.95) gives the midnight
   temperature for 48 thermal inertias from 10 to 3000 TIU at every 1 deg of latitude.
2. For every spot of Diviner's midnight bolometric temperature map (GHRM, slope-adjusted
   midnight, 70S-70N, averaged to 32 px/deg), the matching thermal inertia is read off.

Like TES on Mars this is an "apparent" (bulk) thermal inertia: a spot with some boulders
in fine soil gives an in-between value. Albedo varies (0.07 maria - 0.16 highlands); that
changes midnight temperatures by a few K, i.e. ~10-15% in thermal inertia.
"""
import math
import os

import numpy as np
from numba import njit, prange

SIGMA = 5.670e-8
SOLAR = 1361.0
DAY = 29.53 * 86400.0
ALBEDO = 0.12
EMISSIVITY = 0.95
RHO_C = 1.2e6          # J/m3/K; only thermal inertia matters for uniform ground
STEPS = 1440           # per lunar day (~30 min)
DAYS = 4               # spin-up; the last day is used
LAYERS = 40

TI_VALUES = np.logspace(1, np.log10(3000), 48)
LAT_VALUES = np.arange(0, 71, 1.0)


@njit(cache=True)
def midnight_temperature(lat_rad, ti):
    k = ti * ti / RHO_C
    skin = math.sqrt(k * DAY / (RHO_C * math.pi))             # diurnal skin depth
    # layer thicknesses growing with depth, down to ~8 skin depths
    dz = np.empty(LAYERS)
    dz[0] = skin / 30
    for i in range(1, LAYERS):
        dz[i] = dz[i - 1] * 1.12
    dt = DAY / STEPS
    T = np.full(LAYERS, 250.0 * math.cos(lat_rad) ** 0.25)
    a = np.empty(LAYERS); b = np.empty(LAYERS); c = np.empty(LAYERS); d = np.empty(LAYERS)
    cp = np.empty(LAYERS); dp = np.empty(LAYERS)
    out = 0.0
    for step in range(DAYS * STEPS):
        h = 2 * math.pi * ((step % STEPS) + 1) / STEPS - math.pi     # hour angle, noon = 0
        mu = math.cos(lat_rad) * math.cos(h)
        absorbed = (1 - ALBEDO) * SOLAR * mu if mu > 0 else 0.0
        T_old = T.copy()
        for _ in range(3):                                        # Newton on the surface radiation
            ts = T[0]
            emit = EMISSIVITY * SIGMA * ts ** 4
            demit = 4 * EMISSIVITY * SIGMA * ts ** 3
            for i in range(LAYERS):
                cap = RHO_C * dz[i] / dt
                kup = 0.0 if i == 0 else 2 * k / (dz[i - 1] + dz[i])
                kdn = 0.0 if i == LAYERS - 1 else 2 * k / (dz[i] + dz[i + 1])
                a[i] = -kup
                c[i] = -kdn
                b[i] = cap + kup + kdn
                d[i] = cap * T_old[i]
            b[0] += demit
            d[0] += absorbed - emit + demit * ts
            # tridiagonal solve
            cp[0] = c[0] / b[0]; dp[0] = d[0] / b[0]
            for i in range(1, LAYERS):
                m = b[i] - a[i] * cp[i - 1]
                cp[i] = c[i] / m
                dp[i] = (d[i] - a[i] * dp[i - 1]) / m
            T[LAYERS - 1] = dp[LAYERS - 1]
            for i in range(LAYERS - 2, -1, -1):
                T[i] = dp[i] - cp[i] * T[i + 1]
        if step == DAYS * STEPS - 1:                             # last step = midnight
            out = T[0]
    return out


@njit(parallel=True, cache=True)
def _table(lats, tis):
    t = np.empty((lats.size, tis.size))
    for n in prange(lats.size * tis.size):
        i, j = n // tis.size, n % tis.size
        t[i, j] = midnight_temperature(math.radians(lats[i]), tis[j])
    return t


def lookup_table():
    return _table(LAT_VALUES, TI_VALUES)


def moon_thermal_inertia(raw_dir):
    """Thermal inertia (TIU) on the global 32 px/deg grid (rows 90N->90S, cols 180W->180E);
    NaN beyond 70 deg and where Diviner has no data."""
    tb = np.load(os.path.join(raw_dir, 'diviner_tbol_midnight_32.npy'))   # rows 70N->70S, cols 0->360E
    table = lookup_table()
    ppd = 32
    rows = tb.shape[0]
    lat = 70 - (np.arange(rows) + 0.5) / ppd
    out = np.full_like(tb, np.nan)
    log_ti = np.log10(TI_VALUES)
    for r in range(rows):
        la = abs(lat[r])
        i = min(int(la), LAT_VALUES.size - 2)
        f = la - LAT_VALUES[i]
        temps = table[i] * (1 - f) + table[i + 1] * f            # midnight T vs thermal inertia here
        v = tb[r]
        ok = np.isfinite(v)
        out[r, ok] = 10 ** np.interp(v[ok], temps, log_ti, left=np.nan, right=np.nan)
    g = np.full((180 * ppd, 360 * ppd), np.nan, dtype=np.float32)
    g[20 * ppd:160 * ppd] = np.roll(out, out.shape[1] // 2, axis=1)  # 0..360E -> -180..180
    return g


if __name__ == '__main__':
    t = lookup_table()
    for lat in (0, 30, 60, 70):
        i = int(lat)
        print(f'lat {lat:2d}: midnight T for TI 20/50/100/300/1000 =',
              [round(float(np.interp(np.log10(x), np.log10(TI_VALUES), t[i])), 1) for x in (20, 50, 100, 300, 1000)])
