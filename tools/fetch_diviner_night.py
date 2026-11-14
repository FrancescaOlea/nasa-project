"""Download Diviner's global midnight bolometric temperature (GHRM, 128 px/deg, 70S-70N,
3.3 GB) as a stream and average it down to 32 px/deg on the fly, so the full file is
never stored. Output: data/raw/diviner_tbol_midnight_32.npy (K, rows 70N -> 70S,
columns 0 -> 360E, NaN = no data).

Run:  python tools/fetch_diviner_night.py
"""
import os
import urllib.request

import numpy as np

URL = ('https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/'
       'data_derived_ghrm/img/dghrm_tbol_m_70s70n_img.img')
LINES, SAMPLES, F = 17920, 46080, 4
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'raw',
                   'diviner_tbol_midnight_32.npy')


def main():
    if os.path.exists(OUT):
        print('already there:', OUT)
        return
    out = np.full((LINES // F, SAMPLES // F), np.nan, dtype=np.float32)
    row_bytes = SAMPLES * 4
    with urllib.request.urlopen(URL, timeout=300) as r:
        for i in range(LINES // F):
            buf = b''
            need = row_bytes * F
            while len(buf) < need:
                chunk = r.read(need - len(buf))
                if not chunk:
                    raise SystemExit(f'download cut off at block row {i}')
                buf += chunk
            a = np.frombuffer(buf, '<f4').reshape(F, SAMPLES // F, F).transpose(1, 0, 2).reshape(SAMPLES // F, F * F)
            with np.errstate(invalid='ignore'):
                n = np.isfinite(a).sum(axis=1)
                s = np.nansum(a, axis=1)
            out[i] = np.where(n >= 8, s / np.maximum(n, 1), np.nan)  # at least half the block measured
            if i % 448 == 0:
                print(f'{100 * i / (LINES // F):.0f}%', flush=True)
    np.save(OUT, out)
    print('saved', OUT, out.shape, f'{np.isfinite(out).mean():.1%} with data')


if __name__ == '__main__':
    main()
