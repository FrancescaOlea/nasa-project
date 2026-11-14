// Far-distance terrain for the 3D surface view: public/surface3d/<body>_8ppd.bin
//
//   moon: LOLA LDEM 16 px/degree (PDS Geosciences, LRO-L-LOLA-4-GDR-V1.0), heights = DN x 0.5 m
//   mars: MOLA MEGDR 16 px/degree (PDS Geosciences, MGS-M-MOLA-5-MEGDR-L3-V1.0), metres above the areoid
//
// Averaged 2 x 2 to 8 pixels/degree (~3.8 km on the Moon, ~7.4 km on Mars). Whole metres,
// int16, rows from 90N southwards, columns from 180W eastwards (2880 x 1440). Each row is
// stored as differences from the row above, then deflated; the browser undoes both
// (src/surface3d/dem.js). Run: node tools/build_far_dem.mjs moon|mars
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SOURCES = {
  moon: { url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img',
    file: 'ldem_16.img', bigEndian: false, scale: 0.5 },
  mars: { url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img',
    file: 'megt90n000eb.img', bigEndian: true, scale: 1 },
};
const body = process.argv[2];
const src = SOURCES[body];
if (!src) { console.error('usage: node tools/build_far_dem.mjs moon|mars'); process.exit(1); }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', src.file);
const OUT = join(ROOT, 'public', 'surface3d', `${body}_8ppd.bin`);

if (!existsSync(RAW)) {
  console.log('Downloading', src.url);
  const res = await fetch(src.url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  mkdirSync(dirname(RAW), { recursive: true });
  writeFileSync(RAW, Buffer.from(await res.arrayBuffer()));
}
const buf = readFileSync(RAW);
const SW = 5760; const SH = 2880; // lon 0..360 east, lat 90..-90
const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
const at = (r, c) => view.getInt16((r * SW + c) * 2, !src.bigEndian);
const W = SW / 2; const H = SH / 2;
const out = new Int16Array(W * H);
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    const sc = (2 * c + SW / 2) % SW; // output column 0 = 180W = source longitude 180
    let s = 0;
    for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) s += at(2 * r + dr, (sc + dc) % SW);
    out[r * W + c] = Math.round((s / 4) * src.scale);
  }
}
const delta = new Int16Array(W * H);
for (let i = 0; i < W * H; i++) delta[i] = i < W ? out[i] : out[i] - out[i - W];
const packed = deflateSync(Buffer.from(delta.buffer), { level: 9 });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, packed);
let mn = Infinity; let mx = -Infinity; for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
console.log(`${OUT}: ${W}x${H}, ${(packed.length / 1e6).toFixed(2)} MB, heights ${mn}..${mx} m`);
