// Elevation for the 3D surface view (Moon and Mars). Heights are metres above the world's
// reference sphere (Moon) or areoid (Mars).
//
//  * Far: public/surface3d/<world>_8ppd.bin (8 px/degree; tools/build_far_dem.mjs), loaded once.
//  * Near / middle: the world's global DEM on the USGS Astrogeology server (worlds.js). These
//    files are uncompressed with one strip per image row, so a window is read with one small
//    HTTP range request per row - only the bytes needed, not whole rows.
import { fromUrl } from 'geotiff';

const PARALLEL = 6; // browsers open ~6 connections per server

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

const farCache = new Map();
export function loadFar(world) {
  if (!farCache.has(world.far)) {
    const p = (async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}surface3d/${world.far}`);
      if (!res.ok) throw new Error(`far DEM: HTTP ${res.status}`);
      const stream = res.body.pipeThrough(new DecompressionStream('deflate'));
      const delta = new Int16Array(await new Response(stream).arrayBuffer());
      const cols = 2880; const rows = 1440;
      const data = new Float32Array(cols * rows);
      for (let i = 0; i < data.length; i++) data[i] = i < cols ? delta[i] : data[i - cols] + delta[i];
      return grid({ data, rows, cols, lat0: 90, lon0: -180, dLat: 1 / 8, dLon: 1 / 8, wrap: true });
    })();
    p.catch(() => farCache.delete(world.far));
    farCache.set(world.far, p);
  }
  return farCache.get(world.far);
}

const stripCache = new Map();
function strips(url) {
  if (!stripCache.has(url)) {
    const p = fromUrl(url).then((t) => t.getImage(0)).then((img) => Float64Array.from(img.fileDirectory.StripOffsets, Number));
    p.catch(() => stripCache.delete(url));
    stripCache.set(url, p);
  }
  return stripCache.get(url);
}

/**
 * Heights around (lat, lon) from the world's detailed DEM: a square of ±halfM metres (at
 * least), keeping every `step`-th row and column. `onRow(done, total)` reports progress.
 */
export async function loadDetail(world, lat, lon, halfM, step, onRow) {
  const { url, width: DW, height: DH, scale } = world.dem;
  const offsets = await strips(url);
  const ppd = DW / 360; // square pixels: DH = DW / 2
  const halfLat = (halfM / world.radius) * (180 / Math.PI) * 1.05;
  const cosLat = Math.cos(((Math.min(89.9, Math.abs(lat) + halfLat)) * Math.PI) / 180);
  const halfLon = Math.min(180, halfLat / Math.max(cosLat, 1e-3));
  const r0 = Math.max(0, Math.floor((90 - lat - halfLat) * ppd));
  const r1 = Math.min(DH - 1, Math.ceil((90 - lat + halfLat) * ppd));
  // columns: one span, possibly wrapping around 180°
  let c0 = Math.floor((lon - halfLon + 180) * ppd);
  let c1 = Math.ceil((lon + halfLon + 180) * ppd);
  if (c1 - c0 >= DW) { c0 = 0; c1 = DW - 1; }
  c0 -= ((c0 % step) + step) % step; // keep columns on a common step grid
  const rowIdx = [];
  for (let r = r0 - (r0 % step); r <= r1; r += step) rowIdx.push(r);
  const nCols = Math.floor((c1 - c0) / step) + 1;
  const data = new Float32Array(rowIdx.length * nCols);

  // byte ranges of one row: [start, end, position in row], split where the span wraps around
  const spans = [];
  const a = ((c0 % DW) + DW) % DW;
  const len = nCols * step - (step - 1);
  if (a + len <= DW) spans.push([a, a + len - 1, 0]);
  else { spans.push([a, DW - 1, 0]); spans.push([0, a + len - 1 - DW, DW - a]); }

  let next = 0; let done = 0;
  const readRow = async (i) => {
    const r = rowIdx[i];
    const row = new Int16Array(len);
    for (const [s, e, at] of spans) {
      const from = offsets[r] + s * 2;
      row.set(new Int16Array(await fetchRange(url, from, from + (e - s + 1) * 2 - 1)), at);
    }
    for (let k = 0; k < nCols; k++) {
      const v = row[k * step];
      data[i * nCols + k] = v === -32768 ? NaN : v * scale;
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < rowIdx.length) {
      const i = next++;
      await readRow(i);
      onRow?.(++done, rowIdx.length);
    }
  }));
  fillGaps(data, nCols);
  // grid() puts cell i's centre at edge + (i + 0.5) * d; pixel k's centre is at (k + 0.5) / ppd
  const d = step / ppd;
  const shift = (0.5 - 0.5 * step) / ppd;
  return grid({ data, rows: rowIdx.length, cols: nCols, lat0: 90 - rowIdx[0] / ppd - shift,
    lon0: c0 / ppd + shift - 180, dLat: d, dLon: d, wrap: false });
}

// "No data" pixels (rare): take the nearest value along the row, else 0
function fillGaps(data, cols) {
  if (!data.some(Number.isNaN)) return;
  for (let r = 0; r < data.length / cols; r++) {
    let last = NaN;
    for (let c = 0; c < cols; c++) { const k = r * cols + c; if (Number.isNaN(data[k])) data[k] = last; else last = data[k]; }
    last = NaN;
    for (let c = cols - 1; c >= 0; c--) { const k = r * cols + c; if (Number.isNaN(data[k])) data[k] = last; else last = data[k]; }
  }
  for (let k = 0; k < data.length; k++) if (Number.isNaN(data[k])) data[k] = 0;
}

async function fetchRange(url, from, to, tries = 3) {
  for (let k = 0; ; k++) {
    try {
      // no-store: Chrome otherwise queues requests for the same URL behind its cache lock,
      // one at a time (~4x slower)
      const res = await fetch(url, { cache: 'no-store', headers: { Range: `bytes=${from}-${to}` } });
      if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
      return await res.arrayBuffer();
    } catch (err) {
      if (k >= tries) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** k));
    }
  }
}

// ---- ground colours from a map mosaic (Mars: Viking colour) ---------------------------------

const tileCanvas = document.createElement('canvas');
tileCanvas.width = tileCanvas.height = 256;
const tileCtx = tileCanvas.getContext('2d', { willReadFrequently: true });

function loadTile(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      tileCtx.clearRect(0, 0, 256, 256);
      tileCtx.drawImage(img, 0, 0);
      resolve(tileCtx.getImageData(0, 0, 256, 256).data);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Colour sampler (lat, lon) -> [r, g, b] 0..1 over a box of ±halfM around (lat, lon), from the
 * equirectangular tile set at the zoom level where a pixel is about `pxM` metres.
 */
export async function loadColours(world, lat, lon, halfM, pxM) {
  const im = world.imagery;
  const circ = 2 * Math.PI * world.radius;
  let z = Math.round(Math.log2(circ / (512 * pxM)));
  z = Math.max(0, Math.min(im.maxZoom, z));
  const W = 512 * 2 ** z; const H = 256 * 2 ** z;
  const ppd = W / 360;
  const halfLat = (halfM / world.radius) * (180 / Math.PI) * 1.05;
  const cosLat = Math.cos(((Math.min(89, Math.abs(lat) + halfLat)) * Math.PI) / 180);
  const halfLon = Math.min(180, halfLat / Math.max(cosLat, 0.02));
  const ty0 = Math.max(0, Math.floor(((90 - lat - halfLat) * ppd) / 256));
  const ty1 = Math.min(H / 256 - 1, Math.floor(((90 - lat + halfLat) * ppd) / 256));
  const tx0 = Math.floor(((lon - halfLon + 180) * ppd) / 256);
  const tx1 = Math.floor(((lon + halfLon + 180) * ppd) / 256);
  const nx = W / 256;
  const tiles = new Map();
  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= Math.min(tx1, tx0 + nx - 1); tx++) {
      const x = ((tx % nx) + nx) % nx;
      const url = im.url.replace('{z}', z).replace('{y}', ty).replace('{x}', x);
      jobs.push(loadTile(url).then((d) => tiles.set(`${ty}/${x}`, d)));
    }
  }
  await Promise.all(jobs);
  const px = (row, col) => {
    row = Math.min(H - 1, Math.max(0, row));
    col = ((col % W) + W) % W;
    const d = tiles.get(`${Math.floor(row / 256)}/${Math.floor(col / 256)}`);
    if (!d) return null;
    const i = ((row % 256) * 256 + (col % 256)) * 4;
    return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
  };
  return (la, lo) => {
    const y = (90 - la) * ppd - 0.5; const x = (lo + 180) * ppd - 0.5;
    const r = Math.floor(y); const c = Math.floor(x); const fy = y - r; const fx = x - c;
    const a = px(r, c); const b = px(r, c + 1); const cc = px(r + 1, c); const d = px(r + 1, c + 1);
    if (!a || !b || !cc || !d) return a ?? b ?? cc ?? d;
    return [0, 1, 2].map((k) => (a[k] * (1 - fx) + b[k] * fx) * (1 - fy) + (cc[k] * (1 - fx) + d[k] * fx) * fy);
  };
}
