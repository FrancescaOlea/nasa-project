// Typical value of a data layer over a circular area, read from the same data
// tiles the map shows (at their most detailed level).
//
// "Typical" = the area-weighted median: half of the area has a lower value, half a
// higher one. Unlike an average, a single cliff or crater can't drag it around. The
// 10th-90th percentile range shows how uniform the area is.
import { decode, loadImage } from './overlays.js';

const BASE = `${import.meta.env.BASE_URL}overlays`;
const rad = (d) => (d * Math.PI) / 180;

const canvas = document.createElement('canvas');
canvas.width = canvas.height = 256;
const ctx = canvas.getContext('2d', { willReadFrequently: true });

async function tileCodes(url) {
  const img = await loadImage(url);
  ctx.clearRect(0, 0, 256, 256);
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, 256, 256).data;
}

function weightedQuantiles(values, weights, qs) {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const total = weights.reduce((a, b) => a + b, 0);
  const out = [];
  let acc = 0;
  let k = 0;
  for (const i of order) {
    acc += weights[i];
    while (k < qs.length && acc >= qs[k] * total) { out.push(values[i]); k++; }
  }
  while (out.length < qs.length) out.push(values[order[order.length - 1]]);
  return out;
}

/**
 * Summary of one layer over a circle. Resolves to
 *   { median, p10, p90, mean, logMean, sd, pixels } or { none: true } where the layer
 * has no data. mean / logMean (mean of log10) / sd (standard deviation) are area-weighted;
 * the analog search uses them because they combine the same way as the Earth grid.
 */
export async function summarize(body, layer, meta, lat0, lon0, radiusKm, sphereKm) {
  const z = meta.max_zoom;
  const mercator = meta.crs === 'EPSG3857';
  // Pixel grid of the most detailed tile level: equirectangular (2:1) or Web Mercator (square)
  const W = (mercator ? 256 : 512) * 2 ** z;
  const H = 256 * 2 ** z;
  const MAX_LAT = 85.0511;
  const rowToLat = mercator
    ? (row) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (row + 0.5)) / H))) * 180) / Math.PI
    : (row) => 90 - ((row + 0.5) * 180) / H;
  const latToRow = mercator
    ? (lat) => {
      const phi = rad(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)));
      return ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * H;
    }
    : (lat) => ((90 - lat) / 180) * H;
  const lonToCol = (lon) => ((lon + 180) / 360) * W;
  const latMin = meta.lat_min ?? -90;
  const latMax = meta.lat_max ?? 90;

  // bounding box of the circle, in pixels
  const dLat = (radiusKm / sphereKm) * (180 / Math.PI);
  const cosLat = Math.cos(rad(lat0));
  const dLon = cosLat > 1e-6 ? Math.min(180, dLat / cosLat) : 180;
  const nearPole = Math.abs(lat0) + dLat >= 90;
  const r0 = Math.max(0, Math.floor(latToRow(Math.min(90, lat0 + dLat))));
  const r1 = Math.min(H - 1, Math.floor(latToRow(Math.max(-90, lat0 - dLat))));
  let c0 = Math.floor(lonToCol(lon0 - dLon));
  let c1 = Math.floor(lonToCol(lon0 + dLon));
  if (nearPole || c1 - c0 >= W) { c0 = 0; c1 = W - 1; }

  // load every tile the box touches, then read pixels synchronously
  const tiles = new Map();
  const keyOf = (row, col) => `${Math.floor(row / 256)}/${Math.floor((((col % W) + W) % W) / 256)}`;
  const load = async (key) => {
    if (!tiles.has(key)) {
      tiles.set(key, await tileCodes(`${BASE}/${body}/${layer}/${z}/${key}.${meta.format}`).catch(() => null));
    }
  };
  const needed = new Set();
  for (let row = r0; row <= r1 + 255; row += 256) {
    for (let col = c0; col <= c1 + 255; col += 256) needed.add(keyOf(Math.min(row, r1), Math.min(col, c1)));
  }
  await Promise.all([...needed].map(load));
  // value code at a pixel, or 0 where there's no data (missing tile, ocean = transparent)
  const codeAt = (row, col) => {
    const c = ((col % W) + W) % W; // wrap around in longitude
    const data = tiles.get(keyOf(row, col));
    if (!data) return 0;
    const i = ((row % 256) * 256 + (c % 256)) * 4;
    return data[i + 3] >= 128 ? data[i] : 0;
  };

  const values = [];
  const weights = [];
  const sinLat0 = Math.sin(rad(lat0));
  const maxAngle = radiusKm / sphereKm;
  for (let row = r0; row <= r1; row++) {
    const lat = rowToLat(row);
    if (lat < latMin || lat > latMax) continue;
    const sinLat = Math.sin(rad(lat));
    const cos = Math.cos(rad(lat));
    // real area of one pixel: shrinks with cos(lat) east-west; in Mercator also north-south
    const w = Math.max(mercator ? cos * cos : cos, 1e-6);
    for (let col = c0; col <= c1; col++) {
      const lon = -180 + ((col + 0.5) * 360) / W;
      // great-circle distance from the centre
      const cosD = sinLat0 * sinLat + cosLat * cos * Math.cos(rad(lon - lon0));
      if (Math.acos(Math.min(1, Math.max(-1, cosD))) > maxAngle) continue;
      const code = codeAt(row, col);
      if (code > 0) { values.push(decode(meta, code)); weights.push(w); }
    }
  }

  if (!values.length) {
    // circle smaller than one data pixel: use the pixel under the centre
    if (lat0 < latMin || lat0 > latMax) return { none: true };
    const row = Math.min(H - 1, Math.max(0, Math.floor(latToRow(lat0))));
    const col = Math.floor(lonToCol(lon0));
    await load(keyOf(row, col));
    const code = codeAt(row, col);
    if (!code) return { none: true };
    const v = decode(meta, code);
    return { median: v, p10: v, p90: v, mean: v, logMean: Math.log10(Math.max(v, 0.01)), sd: 0, pixels: 1 };
  }
  const [p10, median, p90] = weightedQuantiles(values, weights, [0.1, 0.5, 0.9]);
  let sw = 0; let s1 = 0; let s2 = 0; let sl = 0;
  values.forEach((v, i) => {
    const w = weights[i];
    sw += w; s1 += w * v; s2 += w * v * v; sl += w * Math.log10(Math.max(v, 0.01));
  });
  const mean = s1 / sw;
  const sd = Math.sqrt(Math.max(0, s2 / sw - mean * mean));
  return { median, p10, p90, mean, logMean: sl / sw, sd, pixels: values.length };
}
