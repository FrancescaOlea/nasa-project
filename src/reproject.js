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
const CELL = 32;      // triangle cells, px (subdivided automatically where the mapping bends)
const MAX_DEPTH = 5;  // down to 1 px
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
  // whole map in px at this zoom (equirectangular is twice as wide as tall)
  const nx = proj.world[0] * 2 ** coords.z;
  const ny = proj.world[1] * 2 ** coords.z;
  const at = (px, py) => proj.fromWorld((coords.x * 256 + px) / nx, (coords.y * 256 + py) / ny);

  // Layers shown only when zoomed in: decide once per zoom level for the whole map,
  // so neighbouring tiles always agree.
  if (opts.maxKmPerPx && proj.kmPerPxAtZoom0(opts.radiusKm) / 2 ** coords.z > opts.maxKmPerPx) return 0;

  // 1. grid of points (lat/lon) and the screen's resolution in the middle of the tile
  const N = 256 / CELL;
  const pts = [];
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) pts.push(at(i * CELL, j * CELL));
  const P = (i, j) => pts[j * (N + 1) + i];
  // Measure the scale at the tile's centre - or, where the centre is off the planet (the
  // corners of a polar map, outside the world disc), at the nearest grid point that's on it.
  // (Measuring at a point off the planet gave NaN and the whole tile stayed black.)
  const ok = (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]);
  let probe = null;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (!ok(P(i, j)) || !ok(P(i + 1, j)) || !ok(P(i, j + 1))) continue;
      const d = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2);
      if (!probe || d < probe.d) probe = { i, j, d };
    }
  }
  if (!probe) return 0; // the whole tile is off the planet
  const mid = P(probe.i, probe.j);
  const kmPerPx = Math.max(haversineKm(opts.radiusKm, mid, P(probe.i + 1, probe.j)),
    haversineKm(opts.radiusKm, mid, P(probe.i, probe.j + 1))) / CELL;

  // source level whose pixels are about as fine as the screen's
  const C = 2 * Math.PI * opts.radiusKm;
  const T = src.tileSize;
  const cosMid = src.kind === 'mercator' ? Math.max(0.02, Math.cos(rad(mid[0]))) : 1;
  // nearest level, leaning towards the lighter one (like Leaflet's own maps): rounding
  // up every time quadrupled the tiles to download and decode for little visible gain
  let level = Math.max(0, Math.min(src.maxLevel,
    Math.round(Math.log2((C * cosMid) / (src.across0 * T * kmPerPx)) - 0.2)));
  // Mercator magnifies high latitudes (4x at 75 deg): don't fetch more than twice the
  // detail the map has at its reference latitude, or one view needs hundreds of tiles
  const refKm = proj.kmPerPxAtZoom0(opts.radiusKm) / 2 ** coords.z;
  const cap = Math.round(Math.log2(C / (src.across0 * T * refKm)) - 0.2) + 1;
  level = Math.max(0, Math.min(level, cap));

  // Fast path: between the two cylindrical projections (equirectangular <-> Mercator)
  // longitude stays linear and only latitude is stretched, so each tile can be copied in
  // thin horizontal strips - a few dozen plain image copies instead of many triangles.
  if (proj.cylindrical) return drawStrips(ctx, coords, proj, src, level, at);

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
      if (bad < 4 && depth < MAX_DEPTH) split(px, py, size, depth);
      return;
    }
    const spread = Math.max(...s.map((q) => q[0])) - Math.min(...s.map((q) => q[0]));
    // the mapping bends strongly here (e.g. the pole is inside): split into four
    if (depth < MAX_DEPTH && spread > Math.max(64, size * 8)) { split(px, py, size, depth); return; }
    // Adaptive refinement: compare the true source position at the cell's centre and edge
    // midpoints with what the two flat triangles would give; split if off by > 0.5 screen px.
    if (depth < MAX_DEPTH && size > 2) {
      const h = size / 2;
      const scale = Math.max(1e-9, Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) / size,
        Math.hypot(s[2][0] - s[0][0], s[2][1] - s[0][1]) / size); // source px per screen px
      const checks = [[h, h, (s[1][0] + s[2][0]) / 2, (s[1][1] + s[2][1]) / 2],
        [h, 0, (s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2],
        [0, h, (s[0][0] + s[2][0]) / 2, (s[0][1] + s[2][1]) / 2],
        [size, h, (s[1][0] + s[3][0]) / 2, (s[1][1] + s[3][1]) / 2],
        [h, size, (s[2][0] + s[3][0]) / 2, (s[2][1] + s[3][1]) / 2]];
      for (const [dx, dy, ex, ey] of checks) {
        const [qx, qy] = S(level, at(px + dx, py + dy), ref);
        if (!Number.isFinite(qx) || !Number.isFinite(qy) || Math.hypot(qx - ex, qy - ey) / scale > 0.5) {
          split(px, py, size, depth);
          return;
        }
      }
    }
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

const STRIP = 4; // px per strip

async function drawStrips(ctx, coords, proj, src, level, at) {
  const T = src.tileSize;
  const across = src.across0 * 2 ** level;
  const down = src.kind === 'equirect' ? across / 2 : across;
  const lon0 = at(0, 0)[1];
  const lon1 = at(256, 0)[1];
  const [x0] = srcXY(src, level, 0, lon0);
  let [x1] = srcXY(src, level, 0, lon1);
  if (x1 <= x0) x1 += src.across0 * T * 2 ** level; // tile ends exactly at +180
  const pxPerSrc = 256 / (x1 - x0);
  // strips: destination rows -> source rows
  const strips = [];
  const needed = new Map();
  for (let y = 0; y < 256; y += STRIP) {
    const sy0 = srcXY(src, level, at(128, y)[0], 0)[1];
    const sy1 = srcXY(src, level, at(128, y + STRIP)[0], 0)[1];
    if (!Number.isFinite(sy0) || !Number.isFinite(sy1)) continue;
    const top = Math.min(sy0, sy1); const bottom = Math.max(sy0, sy1);
    const parts = [];
    for (let ty = Math.max(0, Math.floor(top / T)); ty <= Math.min(down - 1, Math.floor((bottom - 1e-9) / T)); ty++) {
      for (let tx = Math.floor(x0 / T); tx <= Math.floor((x1 - 1e-9) / T); tx++) {
        const wx = ((tx % across) + across) % across;
        if (src.bounds && !tileInBounds(src, level, wx, ty, across)) continue;
        const key = `${ty}/${wx}`;
        if (!needed.has(key)) needed.set(key, src.url.replace('{z}', level).replace('{y}', ty).replace('{x}', wx));
        // the part of this source tile inside the strip, in source px and destination px
        const sxa = Math.max(x0, tx * T); const sxb = Math.min(x1, (tx + 1) * T);
        const sya = Math.max(top, ty * T); const syb = Math.min(bottom, (ty + 1) * T);
        const dya = y + ((sya - top) / (bottom - top)) * STRIP;
        const dyb = y + ((syb - top) / (bottom - top)) * STRIP;
        parts.push({ key, sx: sxa - tx * T, sy: sya - ty * T, sw: sxb - sxa, sh: syb - sya,
          dx: (sxa - x0) * pxPerSrc, dy: dya, dw: (sxb - sxa) * pxPerSrc, dh: dyb - dya });
      }
    }
    strips.push(...parts);
  }
  const images = new Map();
  await Promise.all([...needed].map(([key, url]) => loadImage(url).then((img) => images.set(key, img), () => {})));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let drawn = 0;
  for (const q of strips) {
    const img = images.get(q.key);
    if (!img || q.sw <= 0 || q.sh <= 0) continue;
    // overlap by a fraction of a pixel so strips never leave hairline gaps
    ctx.drawImage(img, q.sx, q.sy, q.sw, q.sh, q.dx, q.dy, q.dw + 0.5, q.dh + 0.5);
    drawn++;
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
