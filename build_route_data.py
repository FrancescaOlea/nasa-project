"""Build the extra data the Mars route planner needs (public/route/).

Inputs (put them in data/raw/):
  RobbinsCraters_20121016.tsv  Robbins & Hynek (2012) global Mars crater database, 384,343
                               craters >= 1 km with MOLA rim-to-floor depths.
                               Official source: https://craters.sjrdesign.net/
                               (doi:10.1029/2011JE003966)
  MDAD.csv                     Mars Dust Activity Database v1.0 (Battalio & Wang 2021,
                               Icarus 354:114059), 14,974 dust storms mapped from MGS MOC
                               and MRO MARCI daily global images, MY24-MY32.
                               Official source: https://doi.org/10.7910/DVN/F8R2JX

Outputs:
  public/route/craters/{lat0}_{lon0}.bin  craters in 30 x 30 degree blocks (lat0, lon0 = SW
                                          corner). 12 bytes per crater, little-endian:
                                            int16  lat x 100      int16  lon x 100
                                            uint16 diameter x 10 (km)
                                            uint16 rim-to-floor depth (m), 65535 = unknown
                                            uint16 rim height above surroundings (m), 65535 = unknown
                                            uint8  degradation state 1 (worn) .. 4 (fresh), 0 = unknown
                                            uint8  (padding)
  public/route/storms.bin                 4 seasons x 90 rows x 180 cols, uint8: share of
                                          observed sols with a dust storm over the 2 x 2 degree
                                          cell, in 1/250 steps (row 0 = 88-90 N, col 0 = 180-178 W).
                                          Seasons by Ls: 0-90, 90-180, 180-270, 270-360.
  public/route/index.json                 description of the above

Run:  python3 tools/build_route_data.py
"""
import json
import struct
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'data' / 'raw'
OUT = ROOT / 'public' / 'route'
MARS_R = 3389.5
BLOCK = 30


def build_craters():
    d = pd.read_csv(RAW / 'RobbinsCraters_20121016.tsv', sep='\t', encoding='latin-1', low_memory=False,
                    usecols=['LATITUDE_CIRCLE_IMAGE', 'LONGITUDE_CIRCLE_IMAGE', 'DIAM_CIRCLE_IMAGE',
                             'DEPTH_RIMFLOOR_TOPOG', 'DEPTH_RIMHEIGHT_TOPOG', 'DEGRADATION_STATE'])
    d.columns = ['lat', 'lon', 'd', 'depth', 'rim', 'deg']
    d = d[np.isfinite(d.lat) & np.isfinite(d.lon) & (d.d > 0)].copy()
    d['lon'] = ((d.lon + 180) % 360) - 180

    def metres(col):
        v = pd.to_numeric(d[col], errors='coerce')
        ok = np.isfinite(v) & (v > 0)  # the catalog uses -1 / blank for "not measured"
        return np.where(ok, np.clip(np.round(v * 1000), 0, 65534), 65535).astype(np.uint16)

    d['depth_m'] = metres('depth')
    d['rim_m'] = metres('rim')
    deg = pd.to_numeric(d.deg, errors='coerce')
    d['deg_i'] = np.where(np.isfinite(deg) & (deg >= 1) & (deg <= 4), deg, 0).astype(np.uint8)
    d['blat'] = (np.floor((d.lat + 90) / BLOCK) * BLOCK - 90).clip(-90, 90 - BLOCK).astype(int)
    d['blon'] = (np.floor((d.lon + 180) / BLOCK) * BLOCK - 180).clip(-180, 180 - BLOCK).astype(int)

    out = OUT / 'craters'
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob('*.bin'):
        f.unlink()
    blocks = {}
    for (blat, blon), g in d.groupby(['blat', 'blon']):
        g = g.sort_values('d', ascending=False)
        buf = bytearray()
        for r in g.itertuples(index=False):
            buf += struct.pack('<hhHHHBx', int(round(r.lat * 100)), int(round(r.lon * 100)),
                               min(65535, int(round(r.d * 10))), int(r.depth_m), int(r.rim_m), int(r.deg_i))
        (out / f'{blat}_{blon}.bin').write_bytes(bytes(buf))
        blocks[f'{blat}_{blon}'] = len(g)
    with_depth = int((d.depth_m < 65535).sum())
    print(f'craters: {len(d):,} in {len(blocks)} blocks, {with_depth:,} with a measured depth')
    return {'count': int(len(d)), 'with_depth': with_depth, 'block_deg': BLOCK, 'record_bytes': 12,
            'blocks': blocks}


def build_storms():
    m = pd.read_csv(RAW / 'MDAD.csv', skipinitialspace=True)
    m.columns = [c.strip() for c in m.columns]
    m['season'] = (m['Ls'] // 90).clip(0, 3).astype(int)
    m['day'] = m['Mars Year'].astype(str) + '/' + m['Mission subphase'].astype(str).str.strip() + '/' + m['Sol'].astype(str)
    # A storm is drawn as an ellipse: its north-south extent comes from the database's
    # max/min latitude, its east-west half-width from its area.
    rows, cols = 90, 180
    lat_c = 90 - (np.arange(rows) + 0.5) * 2
    lon_c = -180 + (np.arange(cols) + 0.5) * 2
    grid = np.zeros((4, rows, cols), np.float64)
    days = np.zeros(4)
    for s in range(4):
        ms = m[m.season == s]
        days[s] = ms['day'].nunique()  # sols that were mapped (nearly every mapped sol has a storm somewhere)
        for day, g in ms.groupby('day'):
            covered = np.zeros((rows, cols), bool)  # one storm-sol per cell per sol, however many storms
            for r in g.itertuples(index=False):
                area = r[6]
                lat0, lon0 = r[5], r[4]
                la_max, la_min = r[9], r[10]
                half_ns_km = max(1.0, (la_max - la_min) / 2 * np.pi / 180 * MARS_R)
                half_ew_km = area / (np.pi * half_ns_km)
                lat_mid = (la_max + la_min) / 2
                coslat = max(np.cos(np.radians(lat0)), 0.05)
                half_ew_deg = min(180.0, half_ew_km / (MARS_R * coslat) * 180 / np.pi)
                half_ns_deg = max(0.5, (la_max - la_min) / 2)
                dlat = (lat_c[:, None] - lat_mid) / half_ns_deg
                dlon = ((lon_c[None, :] - lon0 + 180) % 360 - 180) / max(half_ew_deg, 0.5)
                covered |= dlat ** 2 + dlon ** 2 <= 1
            grid[s] += covered
        grid[s] /= max(days[s], 1)
    q = np.clip(np.round(grid * 250), 0, 250).astype(np.uint8)
    (OUT / 'storms.bin').write_bytes(q.tobytes())
    print('storms: mapped sols per season', days.astype(int).tolist(), 'max share', grid.max(axis=(1, 2)).round(2).tolist())
    return {'seasons_ls': [[0, 90], [90, 180], [180, 270], [270, 360]], 'rows': rows, 'cols': cols,
            'cell_deg': 2, 'scale': 250, 'mapped_sols': days.astype(int).tolist(), 'storms': int(len(m))}


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    index = {
        'craters': {**build_craters(),
                    'source': 'Robbins & Hynek (2012) global Mars crater database, doi:10.1029/2011JE003966'},
        'storms': {**build_storms(),
                   'source': 'Mars Dust Activity Database v1.0, Battalio & Wang (2021), doi:10.7910/DVN/F8R2JX'},
    }
    (OUT / 'index.json').write_text(json.dumps(index, indent=1))
    print('wrote', OUT)
