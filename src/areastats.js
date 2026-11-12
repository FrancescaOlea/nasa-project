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
 *   { median, p10, p90, pixels } or { none: true } where the layer has no data.
 */
export async function summarize(body, layer, meta, lat0, lon0, radiusKm, sphereKm) {
  const z = meta.max_zoom;
  const W = 512 * 2 ** z;
  const H = 256 * 2 ** z;
  const degPerPx = 360 / W;
  const latMin = meta.lat_min ?? -90;
  const latMax = meta.lat_max ?? 90;

  // bounding box of the circle, in pixels
  const dLat = (radiusKm / sphereKm) * (180 / Math.PI);
  const cosLat = Math.cos(rad(lat0));
  const dLon = cosLat > 1e-6 ? Math.min(180, dLat / cosLat) : 180;
  const nearPole = Math.abs(lat0) + dLat >= 90;
  const r0 = Math.max(0, Math.floor((90 - Math.min(90, lat0 + dLat)) / degPerPx));
  const r1 = Math.min(H - 1, Math.floor((90 - Math.max(-90, lat0 - dLat)) / degPerPx));
  let c0 = Math.floor((lon0 - dLon + 180) / degPerPx);
  let c1 = Math.floor((lon0 + dLon + 180) / degPerPx);
  if (nearPole || c1 - c0 >= W) { c0 = 0; c1 = W - 1; }

  // load every tile the box touches, then read pixels synchronously
  const tiles = new Map();
  const keyOf = (row, col) => `${Math.floor(row / 256)}/${Math.floor((((col % W) + W) % W) / 256)}`;
  const needed = new Set();
  for (let row = r0; row <= r1 + 255; row += 256) {
    for (let col = c0; col <= c1 + 255; col += 256) needed.add(keyOf(Math.min(row, r1), Math.min(col, c1)));
  }
  await Promise.all([...needed].map(async (key) => {
    const data = await tileCodes(`${BASE}/${body}/${layer}/${z}/${key}.${meta.format}`).catch(() => null);
    tiles.set(key, data);
  }));
  const codeAt = (row, col) => {
    const c = ((col % W) + W) % W; // wrap around in longitude
    const data = tiles.get(keyOf(row, col));
    return data ? data[((row % 256) * 256 + (c % 256)) * 4] : 0;
  };

  const values = [];
  const weights = [];
  const sinLat0 = Math.sin(rad(lat0));
  const maxAngle = radiusKm / sphereKm;
  for (let row = r0; row <= r1; row++) {
    const lat = 90 - (row + 0.5) * degPerPx;
    if (lat < latMin || lat > latMax) continue;
    const sinLat = Math.sin(rad(lat));
    const cos = Math.cos(rad(lat));
    for (let col = c0; col <= c1; col++) {
      const lon = -180 + (col + 0.5) * degPerPx;
      // great-circle distance from the centre
      const cosD = sinLat0 * sinLat + cosLat * cos * Math.cos(rad(lon - lon0));
      if (Math.acos(Math.min(1, Math.max(-1, cosD))) > maxAngle) continue;
      const code = codeAt(row, col);
      if (code > 0) { values.push(decode(meta, code)); weights.push(Math.max(cos, 1e-3)); }
    }
  }

  if (!values.length) {
    // circle smaller than one data pixel: use the pixel under the centre
    if (lat0 < latMin || lat0 > latMax) return { none: true };
    const row = Math.min(H - 1, Math.floor((90 - lat0) / degPerPx));
    const col = Math.floor((lon0 + 180) / degPerPx);
    const key = keyOf(row, col);
    if (!tiles.has(key)) {
      tiles.set(key, await tileCodes(`${BASE}/${body}/${layer}/${z}/${key}.${meta.format}`).catch(() => null));
    }
    const code = codeAt(row, col);
    if (!code) return { none: true };
    const v = decode(meta, code);
    return { median: v, p10: v, p90: v, pixels: 1 };
  }
  const [p10, median, p90] = weightedQuantiles(values, weights, [0.1, 0.5, 0.9]);
  return { median, p10, p90, pixels: values.length };
}
