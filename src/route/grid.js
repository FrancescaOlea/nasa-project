// Builds the terrain grid the route planner searches: a lat/lon box around the two
// points, cut into cells, each holding the real NASA values read from the same data
// tiles the map's views show (public/overlays), plus craters and dust storms
// (public/route, made by tools/build_route_data.py).
import { decode, loadIndex, loadImage } from '../overlays.js';

const BASE = import.meta.env.BASE_URL;
export const MARS_R = 3389.5;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const MAX_CELLS = 220_000; // keeps a search under ~1 s on a laptop
export const MAX_LAT = 86;        // the equirectangular grid gets too distorted closer to a pole

export function haversineKm(lat1, lon1, lat2, lon2, R = MARS_R) {
  const h = Math.sin(rad(lat2 - lat1) / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const wrapLon = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

// ---- Reading the data tiles ---------------------------------------------------

const canvas = document.createElement('canvas');
canvas.width = canvas.height = 256;
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const tileCache = new Map();
function tilePixels(url) {
  if (!tileCache.has(url)) {
    if (tileCache.size > 600) tileCache.delete(tileCache.keys().next().value);
    tileCache.set(url, loadImage(url).then((img) => {
      ctx.clearRect(0, 0, 256, 256);
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, 256, 256).data;
    }).catch(() => null));
  }
  return tileCache.get(url);
}

/** Reads one layer's values (in real units) at its most detailed tile level. */
export async function layerSampler(layer, meta, latMin, latMax, lonMin, lonMax, zoom = meta.max_zoom) {
  const z = Math.min(meta.max_zoom, zoom); // a coarser level reads fewer tiles for big areas
  const W = 512 * 2 ** z;
  const H = 256 * 2 ** z;
  const r0 = Math.max(0, Math.floor(((90 - latMax) / 180) * H));
  const r1 = Math.min(H - 1, Math.floor(((90 - latMin) / 180) * H));
  const c0 = Math.floor(((lonMin + 180) / 360) * W);
  const c1 = Math.floor(((lonMax + 180) / 360) * W);
  const tiles = new Map();
  const jobs = [];
  for (let tr = Math.floor(r0 / 256); tr <= Math.floor(r1 / 256); tr++) {
    for (let tc = Math.floor(c0 / 256); tc <= Math.floor(c1 / 256); tc++) {
      const col = ((tc % (W / 256)) + W / 256) % (W / 256);
      const key = `${tr}/${col}`;
      if (!tiles.has(key)) {
        tiles.set(key, null);
        jobs.push(tilePixels(`${BASE}overlays/mars/${layer}/${z}/${key}.${meta.format}`).then((px) => tiles.set(key, px)));
      }
    }
  }
  await Promise.all(jobs);
  const lut = new Float32Array(256);
  for (let v = 1; v < 256; v++) lut[v] = decode(meta, v);
  const latLo = meta.lat_min ?? -90;
  const latHi = meta.lat_max ?? 90;
  return {
    pxDeg: 180 / H,
    /** value at a point, or NaN where there's no data */
    at(lat, lon) {
      if (lat < latLo || lat > latHi) return NaN;
      const row = Math.min(H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * H)));
      const col = ((Math.floor(((lon + 180) / 360) * W) % W) + W) % W;
      const px = tiles.get(`${row >> 8}/${col >> 8}`);
      if (!px) return NaN;
      const i = ((row & 255) * 256 + (col & 255)) * 4;
      return px[i + 3] >= 128 && px[i] > 0 ? lut[px[i]] : NaN;
    },
    /** value at a point, interpolated between the 4 nearest data pixels (NaN where none) */
    smooth(lat, lon) {
      if (lat < latLo || lat > latHi) return NaN;
      const fy = Math.min(H - 1, Math.max(0, ((90 - lat) / 180) * H - 0.5));
      const fx = ((lon + 180) / 360) * W - 0.5;
      const r0 = Math.floor(fy); const c0 = Math.floor(fx);
      const ty = fy - r0; const tx = fx - c0;
      let sum = 0; let wsum = 0;
      for (let dy = 0; dy < 2; dy++) {
        const row = Math.min(H - 1, r0 + dy);
        for (let dx = 0; dx < 2; dx++) {
          const col = (((c0 + dx) % W) + W) % W;
          const px = tiles.get(`${row >> 8}/${col >> 8}`);
          if (!px) continue;
          const i = ((row & 255) * 256 + (col & 255)) * 4;
          if (px[i + 3] < 128 || px[i] === 0) continue;
          const w = (dy ? ty : 1 - ty) * (dx ? tx : 1 - tx);
          sum += lut[px[i]] * w; wsum += w;
        }
      }
      return wsum > 1e-6 ? sum / wsum : NaN;
    },
  };
}

// ---- Craters and dust storms ------------------------------------------------------

let routeIndex = null;
const loadRouteIndex = () => (routeIndex ??= fetch(`${BASE}route/index.json`).then((r) => r.json()));
const craterBlocks = new Map();
let stormsPromise = null;

/** Craters (Robbins & Hynek 2012) whose rims reach into the box. */
export async function cratersIn(latMin, latMax, lonMin, lonMax) {
  const index = await loadRouteIndex();
  const B = index.craters.block_deg;
  const found = [];
  const lonRanges = [];
  // the box may run past +/-180 (unwrapped longitudes): look in both copies
  for (const shift of [-360, 0, 360]) {
    const lo = Math.max(-180, lonMin + shift);
    const hi = Math.min(180, lonMax + shift);
    if (lo < hi) lonRanges.push([lo, hi, shift]);
  }
  // big craters' rims reach out of their own block: look one block further out
  const pad = 6; // degrees; Hellas-sized basins are handled by their rim test below
  const jobs = [];
  for (const [lo, hi, shift] of lonRanges) {
    for (let bl = Math.floor((latMin - pad + 90) / B) * B - 90; bl < latMax + pad; bl += B) {
      for (let bo = Math.floor((lo - pad + 180) / B) * B - 180; bo < hi + pad; bo += B) {
        const la = Math.max(-90, Math.min(90 - B, bl));
        const lo2 = ((bo + 180 + 360) % 360) - 180;
        const key = `${la}_${lo2}`;
        if (!index.craters.blocks[key]) continue;
        if (!craterBlocks.has(key)) {
          craterBlocks.set(key, fetch(`${BASE}route/craters/${key}.bin`).then((r) => r.arrayBuffer()));
        }
        jobs.push(craterBlocks.get(key).then((buf) => ({ buf, shift, key })));
      }
    }
  }
  const seen = new Set();
  for (const { buf, shift, key } of await Promise.all(jobs)) {
    if (seen.has(`${key}${shift}`)) continue;
    seen.add(`${key}${shift}`);
    const v = new DataView(buf);
    for (let o = 0; o + 12 <= buf.byteLength; o += 12) {
      const lat = v.getInt16(o, true) / 100;
      const lon = v.getInt16(o + 2, true) / 100 - shift;
      const d = v.getUint16(o + 4, true) / 10;
      const rKm = d / 2;
      const dLat = deg((rKm * 1.3) / MARS_R);
      const dLon = dLat / Math.max(0.05, Math.cos(rad(lat)));
      if (lat + dLat < latMin || lat - dLat > latMax || lon + dLon < lonMin || lon - dLon > lonMax) continue;
      const depth = v.getUint16(o + 6, true);
      const rim = v.getUint16(o + 8, true);
      found.push({
        lat, lon, d,
        depthKm: depth === 65535 ? null : depth / 1000,
        rimKm: rim === 65535 ? null : rim / 1000,
        degradation: v.getUint8(o + 10) || null,
      });
    }
  }
  return found;
}

/** Share of mapped sols with a dust storm overhead, for one season (MDAD). */
export async function stormGrid(season) {
  stormsPromise ??= Promise.all([loadRouteIndex(), fetch(`${BASE}route/storms.bin`).then((r) => r.arrayBuffer())]);
  const [index, buf] = await stormsPromise;
  const { rows, cols, cell_deg: cd, scale } = index.storms;
  const data = new Uint8Array(buf, season * rows * cols, rows * cols);
  return (lat, lon) => {
    const r = Math.min(rows - 1, Math.max(0, Math.floor((90 - lat) / cd)));
    const c = Math.min(cols - 1, Math.max(0, Math.floor((wrapLon(lon) + 180) / cd)));
    return data[r * cols + c] / scale;
  };
}

// ---- The grid -----------------------------------------------------------------------

/**
 * Builds the search grid between a and b ({lat, lon}). Longitudes are unwrapped so the
 * box takes the short way round. Returns typed arrays, one value per cell.
 */
export async function buildGrid(a, b, season, onProgress = () => {}) {
  let lonB = b.lon;
  if (lonB - a.lon > 180) lonB -= 360;
  if (a.lon - lonB > 180) lonB += 360;
  const distKm = haversineKm(a.lat, a.lon, b.lat, lonB);
  // room to go round obstacles: a third of the distance on every side (at least 25 km)
  const marginKm = Math.max(25, distKm * 0.35);
  const mDeg = deg(marginKm / MARS_R);
  const latMin = Math.max(-MAX_LAT, Math.min(a.lat, b.lat) - mDeg);
  const latMax = Math.min(MAX_LAT, Math.max(a.lat, b.lat) + mDeg);
  const midLat = (latMin + latMax) / 2;
  const cosMid = Math.max(0.1, Math.cos(rad(midLat)));
  const lonPad = Math.min(170, mDeg / cosMid);
  const lonMin = Math.min(a.lon, lonB) - lonPad;
  const lonMax = Math.max(a.lon, lonB) + lonPad;

  const index = await loadIndex();
  const metas = index.mars;
  // Cells: as fine as the slope data (~2.6 km per tile pixel at its top level), coarser
  // only when the box would hold too many cells.
  const slopePxDeg = 180 / (256 * 2 ** metas.slope.max_zoom);
  const heightKm = rad(latMax - latMin) * MARS_R;
  const widthKm = rad(lonMax - lonMin) * MARS_R * cosMid;
  let cellKm = Math.max(rad(slopePxDeg) * MARS_R, Math.sqrt((heightKm * widthKm) / MAX_CELLS));
  const rows = Math.max(3, Math.ceil(heightKm / cellKm));
  const cols = Math.max(3, Math.ceil(widthKm / cellKm));
  cellKm = heightKm / rows;
  const dLat = (latMax - latMin) / rows;
  const dLon = (lonMax - lonMin) / cols;

  onProgress('Reading NASA terrain data…');
  const [slope, elev, relief, surface, tmin, storm] = await Promise.all([
    layerSampler('slope', metas.slope, latMin, latMax, lonMin, lonMax),
    layerSampler('elevation', metas.elevation, latMin, latMax, lonMin, lonMax),
    layerSampler('relief', metas.relief, latMin, latMax, lonMin, lonMax),
    layerSampler('surface', metas.surface, latMin, latMax, lonMin, lonMax),
    layerSampler('temp_min', metas.temp_min, latMin, latMax, lonMin, lonMax),
    stormGrid(season),
  ]);

  const n = rows * cols;
  const g = {
    rows, cols, cellKm, latMin, latMax, lonMin, lonMax, dLat, dLon, distKm,
    elev: new Float32Array(n),      // km above the MOLA datum (mean)
    slopeMax: new Float32Array(n),  // steepest 1.9 km slope inside the cell, degrees
    slopeMean: new Float32Array(n),
    relief: new Float32Array(n),    // km, terrain roughness (elevation spread in ~9 km blocks)
    ti: new Float32Array(n),        // thermal inertia (TIU): low = loose dust, high = rock
    tmin: new Float32Array(n),      // coldest-season night temperature, deg C (model)
    storm: new Float32Array(n),     // share of sols with a dust storm overhead (MDAD)
    crater: new Float32Array(n),    // 0..1 crater rim / wall hazard
    craterId: new Int32Array(n).fill(-1),
    valid: new Uint8Array(n),
  };
  // sample each cell on a small sub-grid of data pixels: up to 4 x 4
  const sub = Math.max(1, Math.min(4, Math.round(dLat / slopePxDeg)));
  for (let r = 0; r < rows; r++) {
    const lat0 = latMax - r * dLat;
    for (let c = 0; c < cols; c++) {
      const lon0 = lonMin + c * dLon;
      const i = r * cols + c;
      let sMax = 0; let sSum = 0; let eSum = 0; let k = 0;
      for (let y = 0; y < sub; y++) {
        const lat = lat0 - ((y + 0.5) / sub) * dLat;
        for (let x = 0; x < sub; x++) {
          const lon = wrapLon(lon0 + ((x + 0.5) / sub) * dLon);
          const s = slope.at(lat, lon);
          const e = elev.at(lat, lon);
          if (Number.isNaN(s) || Number.isNaN(e)) continue;
          if (s > sMax) sMax = s;
          sSum += s; eSum += e; k++;
        }
      }
      const latC = lat0 - dLat / 2;
      const lonC = wrapLon(lon0 + dLon / 2);
      if (k) {
        g.valid[i] = 1;
        g.slopeMax[i] = sMax;
        g.slopeMean[i] = sSum / k;
        g.elev[i] = eSum / k;
      }
      g.relief[i] = relief.at(latC, lonC);
      g.ti[i] = surface.at(latC, lonC);
      g.tmin[i] = tmin.at(latC, lonC);
      g.storm[i] = storm(latC, lonC);
    }
  }

  onProgress('Mapping craters…');
  const craters = await cratersIn(latMin, latMax, lonMin, lonMax);
  markCraters(g, craters);
  g.craters = craters;
  return g;
}

/** Estimated depth when the catalog has none: fresh simple craters are ~1/5 as deep as wide. */
export const craterDepthKm = (c) => c.depthKm ?? Math.min(0.2 * c.d, 1.5 + 0.02 * c.d);

// Crater hazard: the rim and inner wall (0.7-1.15 x the radius) are steep and rocky; small
// bowl-shaped craters are a hazard all the way across. Only craters at least half a cell
// wide are marked, smaller ones are invisible at this grid size anyway.
function markCraters(g, craters) {
  const minD = Math.max(1, g.cellKm * 0.5);
  craters.forEach((cr, idx) => {
    if (cr.d < minD) return;
    const R = cr.d / 2;
    const depth = craterDepthKm(cr);
    const bowl = cr.d < 7; // simple craters: steep everywhere inside
    const hazard = Math.min(1, depth / 1.0) * (cr.degradation === 1 ? 0.6 : 1); // worn-down rims are gentler
    const outer = R * 1.15;
    const inner = bowl ? 0 : R * 0.7;
    const dLatC = deg(outer / MARS_R);
    const r0 = Math.max(0, Math.floor((g.latMax - (cr.lat + dLatC)) / g.dLat));
    const r1 = Math.min(g.rows - 1, Math.floor((g.latMax - (cr.lat - dLatC)) / g.dLat));
    for (let r = r0; r <= r1; r++) {
      const lat = g.latMax - (r + 0.5) * g.dLat;
      const cosL = Math.max(0.05, Math.cos(rad(lat)));
      const dLonC = dLatC / cosL;
      const c0 = Math.max(0, Math.floor((cr.lon - dLonC - g.lonMin) / g.dLon));
      const c1 = Math.min(g.cols - 1, Math.floor((cr.lon + dLonC - g.lonMin) / g.dLon));
      for (let c = c0; c <= c1; c++) {
        const lon = g.lonMin + (c + 0.5) * g.dLon;
        const dKm = haversineKm(lat, lon, cr.lat, cr.lon);
        if (dKm > outer + g.cellKm / 2 || dKm < inner - g.cellKm / 2) continue;
        const i = r * g.cols + c;
        if (hazard > g.crater[i]) { g.crater[i] = hazard; g.craterId[i] = idx; }
      }
    }
  });
}

/** Centre of a cell. */
export function cellLatLon(g, i) {
  const r = Math.floor(i / g.cols);
  const c = i % g.cols;
  return [g.latMax - (r + 0.5) * g.dLat, g.lonMin + (c + 0.5) * g.dLon];
}

/** Cell holding a point (longitude in the grid's unwrapped range). */
export function cellOf(g, lat, lon) {
  let l = lon;
  while (l < g.lonMin) l += 360;
  while (l > g.lonMax) l -= 360;
  const r = Math.min(g.rows - 1, Math.max(0, Math.floor((g.latMax - lat) / g.dLat)));
  const c = Math.min(g.cols - 1, Math.max(0, Math.floor((l - g.lonMin) / g.dLon)));
  return r * g.cols + c;
}
