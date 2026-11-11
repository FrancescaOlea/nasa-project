"""
Build the terrain slope and roughness overlays for the Moon and Mars.

Input: NASA global elevation maps from the PDS Geosciences Node
  Mars: MGS MOLA MEGDR, 32 pixels/degree (megt90n000fb.img)
  Moon: LRO LOLA LDEM, 64 pixels/degree (ldem_64.img), averaged to 16 px/deg
Both end up at ~1.9 km per pixel, so the numbers are comparable between bodies.

Output (served by the web app from public/overlays/):
  {body}/{layer}/{z}/{y}/{x}.webp 8-bit grayscale "data tiles" (0 = no data)
  index.json                      how to turn tile values back into real units

Run:  python3 tools/build_terrain.py        (downloads ~660 MB into data/raw/ first)
Needs numpy, scipy and Pillow.
"""
import json
import math
import os
import urllib.request

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data', 'raw')
OUT = os.path.join(ROOT, 'public', 'overlays')
PDS = 'https://pds-geosciences.wustl.edu'
TILE_FORMAT = 'webp'  # lossy WebP q90: half the size of PNG, error ~0.5% of the scale
ROUGH_WINDOW = 5      # roughness window, pixels (~9 km)

BODIES = {
    'mars': dict(
        url=f'{PDS}/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg032/megt90n000fb.img',
        shape=(5760, 11520), dtype='>i2', scale=1.0, ppd=32, factor=1,
        radius_km=3396.19,
        max_zoom=4),  # deepest tile level: 8192 x 4096 px for the whole map
    'moon': dict(
        url=f'{PDS}/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img',
        shape=(11520, 23040), dtype='<i2', scale=0.5, ppd=64, factor=4,
        radius_km=1737.4,
        max_zoom=3),  # 4096 x 2048; the 5760-px data would only be enlarged at level 4
}


def load_dem(name, b):
    """Elevation in metres, rows north->south, columns -180..180 longitude."""
    path = os.path.join(RAW, os.path.basename(b['url']))
    if not os.path.exists(path):
        os.makedirs(RAW, exist_ok=True)
        print(f'downloading {b["url"]}')
        urllib.request.urlretrieve(b['url'], path)
    dem = np.memmap(path, dtype=b['dtype'], mode='r', shape=b['shape'])
    f = b['factor']
    if f > 1:  # block-average to a coarser grid
        h, w = b['shape']
        dem = np.asarray(dem, dtype=np.float32).reshape(h // f, f, w // f, f).mean(axis=(1, 3))
    dem = np.asarray(dem, dtype=np.float32) * b['scale']
    # Files run 0..360 east; shift so the map runs -180..180 like the web map.
    return np.roll(dem, dem.shape[1] // 2, axis=1), b['ppd'] // f


def slope_deg(dem, ppd, radius_km):
    pixel_m = 2 * math.pi * radius_km * 1000 / (360 * ppd)
    lat = 90 - (np.arange(dem.shape[0]) + 0.5) / ppd
    dx_m = pixel_m * np.maximum(np.cos(np.radians(lat)), 0.02)[:, None]
    # central differences; longitude wraps around, latitude doesn't
    dzdx = (np.roll(dem, -1, axis=1) - np.roll(dem, 1, axis=1)) / (2 * dx_m)
    dzdy = np.gradient(dem, pixel_m, axis=0)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def roughness_m(dem, n=ROUGH_WINDOW):
    """RMS height (m) left after fitting a tilted plane in an n x n window.
    Removing the plane means a smooth slope is not counted as rough."""
    r = n // 2
    u = np.tile(np.arange(-r, r + 1, dtype=np.float64), (n, 1))  # column offset
    v = u.T                                                       # row offset
    box = np.ones((n, n))

    def win(w, img):
        # wrap around in longitude, repeat the edge row at the poles
        padded = np.pad(np.pad(img, ((0, 0), (r, r)), mode='wrap'), ((r, r), (0, 0)), mode='edge')
        return ndimage.correlate(padded, w, mode='nearest')[r:-r, r:-r]

    z = dem.astype(np.float64)
    count = n * n
    s_z, s_zz = win(box, z), win(box, z * z)
    s_uz, s_vz = win(u, z), win(v, z)
    ss = s_zz - s_z ** 2 / count - s_uz ** 2 / (u ** 2).sum() - s_vz ** 2 / (v ** 2).sum()
    return np.sqrt(np.maximum(ss, 0) / (count - 3)).astype(np.float32)


def encode(values, lo, hi, log):
    """Map values to 1..255 (linear or log10 between lo and hi); 0 = no data."""
    v = values.astype(np.float64)
    if log:
        v, lo, hi = np.log10(np.maximum(v, 1e-6)), math.log10(lo), math.log10(hi)
    t = np.clip((v - lo) / (hi - lo), 0, 1)
    out = (1 + np.round(t * 254)).astype(np.uint8)
    out[~np.isfinite(values)] = 0
    return out


def write_tiles(encoded, folder, max_zoom):
    img = Image.fromarray(encoded, 'L')
    for z in range(max_zoom + 1):
        w, h = 512 * 2 ** z, 256 * 2 ** z
        level = img.resize((w, h), Image.BOX if w <= img.width else Image.BILINEAR)
        for y in range(h // 256):
            for x in range(w // 256):
                d = os.path.join(folder, str(z), str(y))
                os.makedirs(d, exist_ok=True)
                level.crop((x * 256, y * 256, x * 256 + 256, y * 256 + 256)).save(
                    os.path.join(d, f'{x}.{TILE_FORMAT}'), quality=90, method=6)


def main():
    index = {}
    for name, b in BODIES.items():
        dem, ppd = load_dem(name, b)
        km = 2 * math.pi * b['radius_km'] / (360 * ppd)
        print(f'{name}: {dem.shape[1]}x{dem.shape[0]} px, {km:.2f} km/px')
        layers = {'slope': slope_deg(dem, ppd, b['radius_km']), 'roughness': roughness_m(dem)}
        index[name] = {}
        for layer, vals in layers.items():
            p = np.percentile(vals, [1, 5, 25, 50, 75, 95, 99, 99.9])
            print(f'  {layer} percentiles 1/5/25/50/75/95/99/99.9:', np.round(p, 2))
            spec = SCALES[name][layer]
            write_tiles(encode(vals, spec['min'], spec['max'], spec['log']),
                        os.path.join(OUT, name, layer), b['max_zoom'])
            index[name][layer] = {**spec, 'pixel_km': round(km, 2), 'max_zoom': b['max_zoom'],
                                  'format': TILE_FORMAT}
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, indent=2)


# Colour scale ranges, shared by both bodies so the same colour means the same
# value on the Moon and on Mars. Both are logarithmic: at this ~1.9 km scale
# slope and roughness each span about three orders of magnitude and are
# roughly log-normally distributed (Mars median slope 0.6 deg, 99th pct 13 deg;
# Moon 4 / 23 deg; roughness medians 12 m and 80 m). A linear scale would paint
# ~90% of Mars the same blue.
SHARED = {
    'slope': dict(unit='°', log=True, min=0.1, max=30),
    'roughness': dict(unit='m', log=True, min=1, max=500),
}
SCALES = {'mars': SHARED, 'moon': SHARED}

if __name__ == '__main__':
    main()
