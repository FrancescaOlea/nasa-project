// Moon elevation for the 3D view. Heights are metres above the 1737.4 km reference sphere.
//
//  * Far: public/moon3d/ldem_8ppd.bin (LOLA, 8 px/degree ~3.8 km; tools/build_moon_far_dem.mjs),
//    loaded once, instant.
//  * Near / middle: the LOLA global DEM at 256 px/degree (118 m) on the USGS Astrogeology
//    server. The file is uncompressed with one strip per image row, so a window is read
//    with one small HTTP range request per row - only the bytes needed, not whole rows.
import { fromUrl } from 'geotiff';

export const MOON_R = 1737400; // m
const FAR_URL = `${import.meta.env.BASE_URL}moon3d/ldem_8ppd.bin`;
const LOLA_URL = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif';
const LOLA_W = 92160;   // 256 px/degree, columns from 180W, rows from 90N
const LOLA_H = 46080;
const LOLA_SCALE = 0.5; // m per DN
const PARALLEL = 6;     // browsers open ~6 connections per server

/** A lat/lon grid: rows from north, columns from west; `get(lat, lon)` samples it bilinearly. */
function grid({ data, rows, cols, lat0, lon0, dLat, dLon, wrap }) {
  const get = (lat, lon) => {
    let x = (lon - lon0) / dLon - 0.5;
    const y = (lat0 - lat) / dLat - 0.5;
    if (wrap) x = ((x % cols) + cols) % cols;
    const c0 = Math.floor(x); const r0 = Math.floor(y);
    const fx = x - c0; const fy = y - r0;
    const at = (r, c) => {
      r = Math.min(rows - 1, Math.max(0, r));
      c = wrap ? ((c % cols) + cols) % cols : Math.min(cols - 1, Math.max(0, c));
      return data[r * cols + c];
    };
    return (at(r0, c0) * (1 - fx) + at(r0, c0 + 1) * fx) * (1 - fy) +
      (at(r0 + 1, c0) * (1 - fx) + at(r0 + 1, c0 + 1) * fx) * fy;
  };
  return { get, lat0, lon0, dLat, dLon, rows, cols };
}

let farPromise = null;
export function loadFar() {
  farPromise ??= (async () => {
    const res = await fetch(FAR_URL);
    if (!res.ok) throw new Error(`far DEM: HTTP ${res.status}`);
    const stream = res.body.pipeThrough(new DecompressionStream('deflate'));
    const delta = new Int16Array(await new Response(stream).arrayBuffer());
    const cols = 2880; const rows = 1440;
    const data = new Float32Array(cols * rows);
    for (let i = 0; i < data.length; i++) data[i] = i < cols ? delta[i] : data[i - cols] + delta[i];
    return grid({ data, rows, cols, lat0: 90, lon0: -180, dLat: 1 / 8, dLon: 1 / 8, wrap: true });
  })();
  farPromise.catch(() => { farPromise = null; });
  return farPromise;
}

let stripsPromise = null;
function lolaStrips() {
  stripsPromise ??= fromUrl(LOLA_URL).then((t) => t.getImage(0)).then((img) => {
    const offs = img.fileDirectory.StripOffsets;
    return Float64Array.from(offs, Number);
  });
  stripsPromise.catch(() => { stripsPromise = null; });
  return stripsPromise;
}

/**
 * Heights around (lat, lon) from the 118 m DEM: a square of ±halfM metres (at least),
 * keeping every `step`-th row and column. `onRow(done, total)` reports progress.
 */
export async function loadLola(lat, lon, halfM, step, onRow) {
  const offsets = await lolaStrips();
  const ppd = LOLA_W / 360;
  const halfLat = (halfM / MOON_R) * (180 / Math.PI) * 1.05;
  const cosLat = Math.cos(((Math.min(89.9, Math.abs(lat) + halfLat)) * Math.PI) / 180);
  const halfLon = Math.min(180, halfLat / Math.max(cosLat, 1e-3));
  const r0 = Math.max(0, Math.floor((90 - lat - halfLat) * ppd));
  const r1 = Math.min(LOLA_H - 1, Math.ceil((90 - lat + halfLat) * ppd));
  // columns: one span, possibly wrapping around 180°
  let c0 = Math.floor((lon - halfLon + 180) * ppd);
  let c1 = Math.ceil((lon + halfLon + 180) * ppd);
  if (c1 - c0 >= LOLA_W) { c0 = 0; c1 = LOLA_W - 1; }
  c0 -= c0 % step; // keep columns on a common step grid
  const rowIdx = [];
  for (let r = r0 - (r0 % step); r <= r1; r += step) rowIdx.push(r);
  const nCols = Math.floor((c1 - c0) / step) + 1;
  const data = new Float32Array(rowIdx.length * nCols);

  // byte ranges of one row: [start, end] pairs, split where the span wraps around
  const spans = [];
  const a = ((c0 % LOLA_W) + LOLA_W) % LOLA_W;
  const len = nCols * step - (step - 1);
  if (a + len <= LOLA_W) spans.push([a, a + len - 1, 0]);
  else { spans.push([a, LOLA_W - 1, 0]); spans.push([0, a + len - 1 - LOLA_W, LOLA_W - a]); }

  let next = 0; let done = 0;
  const readRow = async (i) => {
    const r = rowIdx[i];
    const row = new Int16Array(len);
    for (const [s, e, at] of spans) {
      const from = offsets[r] + s * 2;
      const bytes = await fetchRange(from, from + (e - s + 1) * 2 - 1);
      row.set(new Int16Array(bytes), at);
    }
    for (let k = 0; k < nCols; k++) data[i * nCols + k] = row[k * step] * LOLA_SCALE;
  };
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < rowIdx.length) {
      const i = next++;
      await readRow(i);
      onRow?.(++done, rowIdx.length);
    }
  }));
  // grid() puts cell i's centre at edge + (i + 0.5) * d; pixel k's centre is at (k + 0.5) / ppd
  const d = step / ppd;
  const shift = (0.5 - 0.5 * step) / ppd;
  return grid({ data, rows: rowIdx.length, cols: nCols, lat0: 90 - rowIdx[0] / ppd - shift,
    lon0: c0 / ppd + shift - 180, dLat: d, dLon: d, wrap: false });
}

async function fetchRange(from, to, tries = 3) {
  for (let k = 0; ; k++) {
    try {
      // no-store: Chrome otherwise queues requests for the same URL behind its cache lock,
      // one at a time (~4x slower)
      const res = await fetch(LOLA_URL, { cache: 'no-store', headers: { Range: `bytes=${from}-${to}` } });
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      if (k >= tries) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** k));
    }
  }
}
