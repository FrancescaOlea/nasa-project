"""Earth grid for the analog search (public/search/earth.bin + earth.json).

Every 0.5 x 0.5 degree cell that contains land gets the land-area-weighted mean of each
search parameter, computed from the same data as the Earth map layers (2 arc-minute
grid). The browser combines neighbouring cells into circles of the chosen radius and
scores every one of them - no random sampling.

Fields per cell (all from land pixels only):
  land       share of the cell that is land (0..1)
  tmax       hottest month's average daily maximum ground temperature (C)
  tmin       coldest month's average daily minimum (C)
  swing      average day-night swing (C)
  dry        log10(yearly rain in mm + 1)
  uv         average UV index
  alt        mean elevation (km)
  alt_sd     elevation standard deviation inside the cell (km)
  relief     mean elevation standard deviation inside ~9 km blocks (km): local relief
  logslope   mean of log10(slope in degrees), slope between points ~1.9 km apart
  clat, clon where the cell's land is centred, relative to the cell centre (degrees)

Stored as int16 (value / scale), land cells only, cell index = row * 720 + col with row 0
at 90N and col 0 at 180W.

Run:  python tools/build_search_grid.py
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_layers as bl  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'search')
CELL = 15          # 2 arc-minute pixels per 0.5 degree cell
SCALES = dict(land=1 / 30000, tmax=0.01, tmin=0.01, swing=0.01, dry=0.001, uv=0.001,
              alt=0.001, alt_sd=0.0005, relief=0.0002, logslope=0.0002, clat=1e-5, clon=1e-5)


def cell_mean(values, weight):
    """Weighted mean of each 15x15 block (NaN where the block has no weight)."""
    h, w = values.shape
    v = np.where(weight > 0, values, 0).astype(np.float64)
    vw = (v * weight).reshape(h // CELL, CELL, w // CELL, CELL).sum(axis=(1, 3))
    ww = weight.reshape(h // CELL, CELL, w // CELL, CELL).sum(axis=(1, 3))
    with np.errstate(invalid='ignore', divide='ignore'):
        return vw / ww, ww


def main():
    land = bl.earth_land()                     # 5400 x 10800, 2 arc-minutes
    h, w = land.shape
    weight = land.astype(np.float32)           # area weights within a cell: cos(lat) ~ constant
    dem = bl._earth['dem2'] / 1000             # km
    fields = {}
    fields['land'] = weight.reshape(h // CELL, CELL, w // CELL, CELL).mean(axis=(1, 3))
    # land centroid inside each cell (so small result circles sit on land)
    off = (np.arange(h) % CELL + 0.5) / 30 - 0.25            # deg from cell centre, + = north
    fields['clat'], _ = cell_mean(np.broadcast_to(-off[:, None], (h, w)), weight)
    offc = (np.arange(w) % CELL + 0.5) / 30 - 0.25
    fields['clon'], _ = cell_mean(np.broadcast_to(offc[None, :], (h, w)), weight)
    print('elevation')
    fields['alt'], _ = cell_mean(dem, weight)
    sq, _ = cell_mean(dem * dem, weight)
    fields['alt_sd'] = np.sqrt(np.maximum(sq - fields['alt'] ** 2, 0))
    # relief: elevation standard deviation inside ~9 km blocks (5 x 5 pixels of the
    # 1 arc-minute DEM, as for the Moon and Mars), averaged over each cell's land
    print('relief')
    full = bl.earth_dem_full()
    rel = np.zeros((h // CELL, w // CELL))
    for r0 in range(0, 2 * h, 600):                      # 1 arc-minute rows, 20 cells per strip
        mask = np.repeat(np.repeat(land[r0 // 2:(r0 + 600) // 2], 2, 0), 2, 1)
        b = bl.relief_blocks(full[r0:r0 + 600], mask)     # 120 x 4320 blocks
        ok = np.isfinite(b)
        k = 30 // bl.RELIEF_BLOCK                         # blocks per cell side
        shape = (b.shape[0] // k, k, b.shape[1] // k, k)
        with np.errstate(invalid='ignore', divide='ignore'):
            rel[r0 // 30:(r0 + 600) // 30] = (np.where(ok, b, 0).reshape(shape).sum(axis=(1, 3))
                                              / ok.reshape(shape).sum(axis=(1, 3)))
    fields['relief'] = rel
    print('slope')
    s, _ = bl.earth_slope()
    fields['logslope'], _ = cell_mean(np.log10(np.maximum(np.nan_to_num(s, nan=0.01), 0.01)), weight)
    del s
    for name, param, how in (('tmax', 'TS_MAX', 'max'), ('tmin', 'TS_MIN', 'min'),
                             ('swing', 'TS_RANGE', 'mean'), ('dry', 'PRECTOTCORR', 'mean'),
                             ('uv', 'ALLSKY_SFC_UV_INDEX', 'mean')):
        print(name)
        g, _ = bl.power_grid(param, how)
        if name == 'dry':
            g = np.log10(g * 365.25 + 1)
        ok = weight * np.isfinite(g)
        fields[name], _ = cell_mean(np.nan_to_num(g), ok)

    keep = fields['land'] > 0
    for k, v in fields.items():
        keep &= np.isfinite(v) if k != 'relief' else True
    fields['relief'] = np.where(np.isfinite(fields['relief']), fields['relief'], fields['alt_sd'])
    idx = np.nonzero(keep.ravel())[0].astype(np.uint32)
    names = list(SCALES)
    cols = [np.round(fields[k].ravel()[idx] / SCALES[k]).clip(-32767, 32767).astype(np.int16) for k in names]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'earth.bin'), 'wb') as f:
        f.write(idx.tobytes())
        for c in cols:
            f.write(c.tobytes())
    meta = dict(cells=int(idx.size), res=0.5, width=720, height=360, fields=names, scales=SCALES,
                about='Land-area-weighted means per 0.5 degree cell; see tools/build_search_grid.py')
    with open(os.path.join(OUT, 'earth.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(f'{idx.size} land cells, {os.path.getsize(os.path.join(OUT, "earth.bin")) / 1e6:.1f} MB')
    for k in names:
        v = fields[k].ravel()[idx]
        print(f'  {k:9s} p1/50/99 {np.percentile(v, [1, 50, 99]).round(3)}')


if __name__ == '__main__':
    main()
