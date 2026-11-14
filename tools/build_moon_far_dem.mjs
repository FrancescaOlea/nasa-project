// Far-distance terrain for the Moon 3D view: public/moon3d/ldem_8ppd.bin
//
// Source: LOLA LDEM 16 pixels/degree (PDS Geosciences, LRO-L-LOLA-4-GDR-V1.0), averaged
// 2 x 2 to 8 pixels/degree (~3.8 km). Heights in whole metres above the 1737.4 km sphere,
// int16, rows from 90N southwards, columns from 180W eastwards (2880 x 1440). Each row
// is stored as differences from the row above, then deflated; the browser undoes both
// (src/moon3d/dem.js). Run: node tools/build_moon_far_dem.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'ldem_16.img');
const URL_ = 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.img';
const OUT = join(ROOT, 'public', 'moon3d', 'ldem_8ppd.bin');

if (!existsSync(RAW)) {
  console.log('Downloading', URL_);
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  mkdirSync(dirname(RAW), { recursive: true });
  writeFileSync(RAW, Buffer.from(await res.arrayBuffer()));
}
const buf = readFileSync(RAW);
const SW = 5760; const SH = 2880;               // source: lon 0..360 east, lat 90..-90
const src = new Int16Array(buf.buffer, buf.byteOffset, SW * SH);
const W = SW / 2; const H = SH / 2;
const out = new Int16Array(W * H);
for (let r = 0; r < H; r++) {
  for (let c = 0; c < W; c++) {
    // output column c starts at 180W = source longitude 180
    const sc = (2 * c + SW / 2) % SW;
    let s = 0;
    for (const [dr, dc] of [[0, 0], [0, 1], [1, 0], [1, 1]]) s += src[(2 * r + dr) * SW + ((sc + dc) % SW)];
    out[r * W + c] = Math.round((s / 4) * 0.5); // DN * 0.5 m
  }
}
const delta = new Int16Array(W * H);
for (let i = 0; i < W * H; i++) delta[i] = i < W ? out[i] : out[i] - out[i - W];
const packed = deflateSync(Buffer.from(delta.buffer), { level: 9 });
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, packed);
let mn = Infinity; let mx = -Infinity; for (const v of out) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
console.log(`${OUT}: ${W}x${H}, ${(packed.length / 1e6).toFixed(2)} MB, heights ${mn}..${mx} m`);
