// Show tiles made for one projection on a map in another, by warping them in the
// browser. The sources stay exactly as they are (NASA Trek, Esri, our data tiles).
//
// For each tile the map asks for:
//   1. a 17 x 17 grid of points over the tile is converted to latitude/longitude
//      (target projection), then to pixel positions in the source tiles, at the
//      source zoom level whose detail matches the screen (one level per tile)
//   2. each 16 x 16 px cell is drawn as two triangles, each with its own linear
//      (affine) transform - a piecewise approximation of the real, curved mapping.
//      Cells where the mapping bends a lot (around a pole) or that reach the edge of
//      the source's coverage are subdivided.
//   3. every triangle is drawn straight from the source tiles it overlaps (clipped to
//      the triangle), so there is no size limit even where a tile spans all longitudes.
// Drawing (not reading pixels) means this also works for imagery from other sites.
import L from 'leaflet';
import { loadImage } from './overlays.js';

const rad = (d) => (d * Math.PI) / 180;
const CELL = 16;
// Near a pole, equirectangular source rows wrap around a tiny circle, so full detail
// would need every longitude's tiles (thousands). Cap how many source pixels may be
// squeezed across one screen pixel; beyond that, use a coarser source level there.
const MAX_SQUEEZE = 8;

/**
 * A source tile grid.
 *   kind       'equirect' (2:1 world) or 'mercator' (square world)
 *   url        template with {z} {y} {x}
 *   tileSize   px
 *   across0    tiles across the world at level 0 (Trek: 2, Esri / our Earth tiles: 1)
 *   maxLevel   deepest level that exists
 *   bounds     optional [[south, west], [north, east]]: tiles outside aren't drawn
 */
export function sourceGrid(opts) {
  return { tileSize: 256, across0: opts.kind === 'equirect' ? 2 : 1, ...opts };
}

function srcXY(src, level, lat, lon) {
  const W = src.across0 * src.tileSize * 2 ** level;
  const x = ((lon + 180) / 360) * W;
  if (src.kind === 'equirect') return [x, ((90 - lat) / 180) * (W / 2), W];
  if (Math.abs(lat) > 85.0511) return [x, NaN, W]; // Mercator tiles stop here
  const phi = rad(lat);
  return [x, ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * W, W];
}

function haversineKm(R, a, b) {
  const [la1, lo1] = a.map(rad);
  const [la2, lo2] = b.map(rad);
  const h = Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Affine transform [a, b, c, d, e, f] taking source triangle s to destination triangle d.
function affine(s, d) {
  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const [[u0, v0], [u1, v1], [u2, v2]] = d;
  const den = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (!den || !Number.isFinite(den)) return null;
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / den;
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / den;
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / den;
  const dd = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / den;
  return [a, b, c, dd, u0 - a * x0 - c * y0, v0 - b * x0 - dd * y0];
}

// Clip to the destination triangle (grown a little so neighbours overlap - no hairline
// seams), then draw each source tile image placed at its origin in source pixels.
function drawTriangle(ctx, m, d, images) {
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
  ctx.save();
  ctx.beginPath();
  d.forEach(([u, v], i) => {
    const dx = u - cx; const dy = v - cy; const len = Math.hypot(dx, dy) || 1;
    const gu = u + (dx / len) * 0.7; const gv = v + (dy / len) * 0.7;
    if (i) ctx.lineTo(gu, gv); else ctx.moveTo(gu, gv);
  });
  ctx.closePath();
  ctx.clip();
  const [a, b, c, dd, e, f] = m;
  for (const { img, ox, oy } of images) {
    ctx.setTransform(a, b, c, dd, e + a * ox + c * oy, f + b * ox + dd * oy);
    ctx.drawImage(img, 0, 0);
  }
  ctx.restore();
}

/**
 * Draws `src` into a 256 x 256 tile of the map at (coords) in projection `proj`.
 * opts: radiusKm, maxKmPerPx (layer hidden when the view is coarser, e.g. CTX close-ups)
 * Resolves with the number of triangles drawn (0 = nothing to show).
 */
export async function warpTile(ctx, coords, proj, src, opts) {
  const n = 256 * 2 ** coords.z;
  const at = (px, py) => proj.fromWorld((coords.x * 256 + px) / n, (coords.y * 256 + py) / n);

  // Layers shown only when zoomed in: decide once per zoom level for the whole map,
  // so neighbouring tiles always agree.
  if (opts.maxKmPerPx && proj.kmPerPxAtZoom0(opts.radiusKm) / 2 ** coords.z > opts.maxKmPerPx) return 0;

  // 1. grid of points (lat/lon) and the screen's resolution in the middle of the tile
  const N = 256 / CELL;
  const pts = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pts.push(at(i * CELL, j * CELL));
  const P = (i, j) => pts[j * (N + 1) + i];
  const mid = P(N / 2, N / 2);
  const kmPerPx = Math.max(haversineKm(opts.radiusKm, mid, P(N / 2 + 1, N / 2)),
    haversineKm(opts.radiusKm, mid, P(N / 2, N / 2 + 1))) / CELL;

  // source level whose pixels are about as fine as the screen's
  const C = 2 * Math.PI * opts.radiusKm;
  const T = src.tileSize;
  const cosMid = src.kind === 'mercator' ? Math.max(0.02, Math.cos(rad(mid[0]))) : 1;
  const level = Math.max(0, Math.min(src.maxLevel,
    Math.ceil(Math.log2((C * cosMid) / (src.across0 * T * kmPerPx)))));

  // source pixel position at a level, longitude unwrapped next to refX
  const S = (lvl, [lat, lon], refX) => {
    const [x, y, w] = srcXY(src, lvl, lat, lon);
    let ux = x;
    if (refX !== undefined) {
      while (ux - refX > w / 2) ux -= w;
      while (ux - refX < -w / 2) ux += w;
    }
    return [ux, y];
  };

  // 2. triangles (and the source tiles each one needs)
  const triangles = [];
  const needed = new Map();
  const addTriangle = (ll, d, size) => {
    let lvl = level;
    let s = ll.map((p, i, arr) => S(lvl, p, i ? S(lvl, arr[0])[0] : undefined));
    const span = Math.max(...s.map((q) => q[0])) - Math.min(...s.map((q) => q[0]));
    const allowed = MAX_SQUEEZE * Math.max(size, 1);
    if (span > allowed) {
      lvl = Math.max(0, lvl - Math.ceil(Math.log2(span / allowed)));
      s = ll.map((p, i, arr) => S(lvl, p, i ? S(lvl, arr[0])[0] : undefined));
    }
    const m = affine(s, d);
    if (!m) return;
    const across = src.across0 * 2 ** lvl;
    const down = src.kind === 'equirect' ? across / 2 : across;
    const xs = s.map((q) => q[0]); const ys = s.map((q) => q[1]);
    const tiles = [];
    for (let ty = Math.max(0, Math.floor(Math.min(...ys) / T)); ty <= Math.min(down - 1, Math.floor(Math.max(...ys) / T)); ty++) {
      for (let tx = Math.floor(Math.min(...xs) / T); tx <= Math.floor(Math.max(...xs) / T); tx++) {
        const wx = ((tx % across) + across) % across;
        if (src.bounds && !tileInBounds(src, lvl, wx, ty, across)) continue;
        const key = `${lvl}/${ty}/${wx}`;
        if (!needed.has(key)) needed.set(key, src.url.replace('{z}', lvl).replace('{y}', ty).replace('{x}', wx));
        tiles.push({ key, ox: tx * T, oy: ty * T });
      }
    }
    if (tiles.length) triangles.push({ m, d, tiles });
  };
  const split = (px, py, size, depth) => {
    const h = size / 2;
    for (const [dx, dy] of [[0, 0], [h, 0], [0, h], [h, h]]) {
      const q = [at(px + dx, py + dy), at(px + dx + h, py + dy), at(px + dx, py + dy + h), at(px + dx + h, py + dy + h)];
      cell(px + dx, py + dy, h, depth + 1, q);
    }
  };
  const cell = (px, py, size, depth, corners) => {
    // corners: lat/lon of top-left, top-right, bottom-left, bottom-right
    const ref = S(level, corners[0])[0];
    const s = corners.map((p) => S(level, p, ref));
    const bad = s.filter(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)).length;
    if (bad) {
      // at the edge of the source's coverage (e.g. Mercator stops at 85 deg): refine so
      // the edge is a smooth curve, not a staircase of whole cells
      if (bad < 4 && depth < 4) split(px, py, size, depth);
      return;
    }
    const spread = Math.max(...s.map((q) => q[0])) - Math.min(...s.map((q) => q[0]));
    // the mapping bends strongly here (e.g. the pole is inside): split into four
    if (depth < 4 && spread > Math.max(64, size * 8)) { split(px, py, size, depth); return; }
    const d = [[px, py], [px + size, py], [px, py + size], [px + size, py + size]];
    addTriangle([corners[0], corners[1], corners[2]], [d[0], d[1], d[2]], size);
    addTriangle([corners[1], corners[3], corners[2]], [d[1], d[3], d[2]], size);
  };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) cell(i * CELL, j * CELL, CELL, 0, [P(i, j), P(i + 1, j), P(i, j + 1), P(i + 1, j + 1)]);
  }

  // 3. load the source tiles, then draw every triangle from them
  const images = new Map();
  await Promise.all([...needed].map(([key, url]) => loadImage(url).then((img) => images.set(key, img), () => {})));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let drawn = 0;
  for (const t of triangles) {
    const list = t.tiles.filter((q) => images.has(q.key)).map((q) => ({ img: images.get(q.key), ox: q.ox, oy: q.oy }));
    if (list.length) { drawTriangle(ctx, t.m, t.d, list); drawn++; }
  }
  return drawn;
}

function tileInBounds(src, level, tx, ty, across) {
  const [[s, w], [nn, e]] = src.bounds;
  const lon0 = (tx / across) * 360 - 180;
  const lon1 = ((tx + 1) / across) * 360 - 180;
  const rows = src.kind === 'equirect' ? across / 2 : across;
  let lat0; let lat1;
  if (src.kind === 'equirect') { lat1 = 90 - (ty / rows) * 180; lat0 = 90 - ((ty + 1) / rows) * 180; } else {
    const m = (v) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI;
    lat1 = m(ty / rows); lat0 = m((ty + 1) / rows);
  }
  return lat1 > s && lat0 < nn && lon1 > w && lon0 < e;
}

/** Imagery layer shown in a projection other than its own. */
export const WarpedImagery = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    warpTile(tile.getContext('2d'), coords, this.options.proj, this.options.src, this.options)
      .then(() => done(null, tile), () => done(null, tile));
    return tile;
  },
});
