// Terrain around the observer as four nested square heightfields in the local frame
// (x = east, y = north, z = up, metres; origin = the ground at the observer). Heights
// include the world's curvature, so distant ground drops below the horizon as it should.
//
//   foot  ±100 m  at 1 m    detailed DEM (via 'near') + made-up small craters and texture
//   near  ±5 km   at 20 m   detailed DEM (Moon 118 m, Mars 200 m) + made-up craters 70-600 m
//   mid   ±40 km  at 250 m  detailed DEM, every 4th (Moon) / 2nd (Mars) sample
//   far   ±250 km (Moon) / ±400 km (Mars)   bundled 8 px/degree file
//
// Each finer level fades its made-up detail out and blends into the next coarser level
// towards its edge, so the levels meet without steps. Where a finer level exists, the
// coarser mesh is cut away (and the ring that overlaps is pushed slightly down).
// The same heightfields go to the GPU as textures for the terrain shadows (view.js).
import * as THREE from 'three';

export function levelsFor(world) {
  return [
    { name: 'foot', half: 100, n: 201, sink: 0 },
    { name: 'near', half: 5000, n: 501, sink: 0.4 },
    { name: 'mid', half: 40000, n: 321, sink: 3 },
    { name: 'far', half: world.farHalf, n: 251, sink: 15 },
  ];
}

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Local (x east, y north) in metres -> [lat, lon, cos c] (orthographic projection). */
export function projector(lat0, lon0, R) {
  const sp = Math.sin(rad(lat0)); const cp = Math.cos(rad(lat0));
  return (x, y) => {
    const d = Math.hypot(x, y);
    if (d < 1e-6) return [lat0, lon0, 1];
    const sc = Math.min(1, d / R); const cc = Math.sqrt(1 - sc * sc);
    const lat = Math.asin(Math.min(1, Math.max(-1, cc * sp + (y * sc * cp) / d)));
    let lon = lon0 + deg(Math.atan2(x * sc, d * cc * cp - y * sc * sp));
    lon = ((lon + 540) % 360) - 180;
    return [deg(lat), lon, cc];
  };
}

// ---- small deterministic random helpers -------------------------------------------------

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x); const iy = Math.floor(y);
  let fx = x - ix; let fy = y - iy;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed); const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed); const d = hash2(ix + 1, iy + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
/** Fractal noise, -1..1 */
export function fbm(x, y, seed, octaves) {
  let s = 0; let amp = 1; let f = 1; let total = 0;
  for (let o = 0; o < octaves; o++) {
    s += amp * (vnoise(x * f, y * f, seed + o * 17) * 2 - 1);
    total += amp; amp *= 0.5; f *= 2.03;
  }
  return s / total;
}

// ---- levels -----------------------------------------------------------------------------

function makeLevel(spec) {
  const cell = (2 * spec.half) / (spec.n - 1);
  const z = new Float32Array(spec.n * spec.n);
  const sample = (x, y) => {
    const n = spec.n;
    const gx = Math.min(n - 1.000001, Math.max(0, (x + spec.half) / cell));
    const gy = Math.min(n - 1.000001, Math.max(0, (y + spec.half) / cell));
    const i = Math.floor(gx); const j = Math.floor(gy);
    const fx = gx - i; const fy = gy - j;
    const k = j * n + i;
    return (z[k] * (1 - fx) + z[k + 1] * fx) * (1 - fy) + (z[k + n] * (1 - fx) + z[k + n + 1] * fx) * fy;
  };
  return { ...spec, cell, z, sample };
}

// Crater shape added to a heightfield: a bowl with a raised rim. Sizes follow a power law
// (many small, few large), as on the real Moon; most are worn down (shallow).
function addCraters(L, random, count, dMin, dMax, weight) {
  const { n, half, cell, z } = L;
  const k = (dMin / dMax) ** 2;
  for (let c = 0; c < count; c++) {
    const D = dMin * (1 - random() * (1 - k)) ** -0.5;
    const R = D / 2;
    const cx = (random() * 2 - 1) * half; const cy = (random() * 2 - 1) * half;
    const depth = D * (0.04 + 0.16 * random() ** 3);
    const rim = depth * 0.22;
    const reach = 1.7 * R;
    const i0 = Math.max(0, Math.floor((cx - reach + half) / cell)); const i1 = Math.min(n - 1, Math.ceil((cx + reach + half) / cell));
    const j0 = Math.max(0, Math.floor((cy - reach + half) / cell)); const j1 = Math.min(n - 1, Math.ceil((cy + reach + half) / cell));
    for (let j = j0; j <= j1; j++) {
      const y = -half + j * cell;
      for (let i = i0; i <= i1; i++) {
        const x = -half + i * cell;
        const r = Math.hypot(x - cx, y - cy);
        if (r > reach) continue;
        let dh;
        if (r < R) dh = depth * ((r / R) ** 2 - 1) + rim;
        else dh = rim * (R / r) ** 3 * (1 - smoothstep(1.25 * R, reach, r));
        z[j * n + i] += dh * weight(x, y);
      }
    }
  }
}

/**
 * Build all levels. `sources` = { far, mid?, near? } lat/lon grids with get(lat, lon) -> m.
 * Returns { levels, h0 } where h0 is the ground height (m) at the observer.
 */
export function buildLevels(world, lat, lon, sources, seed) {
  const R = world.radius;
  const proj = projector(lat, lon, R);
  const best = { far: sources.far, mid: sources.mid ?? sources.far, near: sources.near ?? sources.mid ?? sources.far };
  const h0 = best.near.get(lat, lon);
  const levels = levelsFor(world).map(makeLevel);
  const [foot, near, mid, far] = levels;

  // heights from the data, with curvature: z = (R + h) cos c - (R + h0)
  const fromData = (L, src) => {
    for (let j = 0; j < L.n; j++) {
      for (let i = 0; i < L.n; i++) {
        const [la, lo, cc] = proj(-L.half + i * L.cell, -L.half + j * L.cell);
        L.z[j * L.n + i] = (R + src.get(la, lo)) * cc - (R + h0);
      }
    }
  };
  // towards its edge a level becomes its coarser neighbour (detail fades over [a, 1] of half)
  const edge = (L, a) => (x, y) => 1 - smoothstep(a, 1, Math.max(Math.abs(x), Math.abs(y)) / L.half);
  const blendInto = (L, coarse, a) => {
    const w = edge(L, a);
    for (let j = 0; j < L.n; j++) {
      for (let i = 0; i < L.n; i++) {
        const x = -L.half + i * L.cell; const y = -L.half + j * L.cell;
        const t = w(x, y);
        if (t < 1) L.z[j * L.n + i] = L.z[j * L.n + i] * t + coarse.sample(x, y) * (1 - t);
      }
    }
  };

  fromData(far, best.far);
  fromData(mid, best.mid);
  blendInto(mid, far, 0.85);

  fromData(near, best.near);
  const r1 = rng(seed);
  const wNear = edge(near, 0.75);
  addCraters(near, r1, world.craters.near, 70, 600, wNear);
  for (let j = 0; j < near.n; j++) {
    for (let i = 0; i < near.n; i++) {
      const x = -near.half + i * near.cell; const y = -near.half + j * near.cell;
      near.z[j * near.n + i] += 2.2 * fbm(x / 350, y / 350, seed, 4) * wNear(x, y);
    }
  }
  blendInto(near, mid, 0.8);

  // the observer's few hundred metres: smooth 'near' + small craters and lumpy regolith
  for (let j = 0; j < foot.n; j++) {
    for (let i = 0; i < foot.n; i++) foot.z[j * foot.n + i] = near.sample(-foot.half + i * foot.cell, -foot.half + j * foot.cell);
  }
  const r0 = rng(seed + 1);
  const wFoot = edge(foot, 0.55);
  addCraters(foot, r0, world.craters.foot, 0.6, 25, wFoot);
  for (let j = 0; j < foot.n; j++) {
    for (let i = 0; i < foot.n; i++) {
      const x = -foot.half + i * foot.cell; const y = -foot.half + j * foot.cell;
      foot.z[j * foot.n + i] += (0.18 * fbm(x / 7, y / 7, seed + 5, 3)) * wFoot(x, y);
    }
  }
  return { levels, h0, proj };
}

/** Height (local z) at x, y from the finest level that covers it. */
export function heightAt(levels, x, y) {
  const m = Math.max(Math.abs(x), Math.abs(y));
  for (const L of levels) if (m < L.half) return L.sample(x, y);
  return levels[levels.length - 1].sample(x, y);
}

/** 0..1: how much of the Sun's disc is visible from (x, y, z) - same march as the GPU. */
export function sunVisibility(levels, sun, x, y, z, sunRadiusDeg) {
  if (sun.z < -0.05) return 0;
  const tanR = Math.tan(rad(sunRadiusDeg));
  let vis = 1; let t = 0.5;
  const maxZ = Math.max(...levels.map((L) => L.zMax ?? Infinity));
  for (let k = 0; k < 400; k++) {
    const px = x + sun.x * t; const py = y + sun.y * t; const pz = z + sun.z * t;
    if (Math.max(Math.abs(px), Math.abs(py)) > levels[3].half) break;
    vis = Math.min(vis, (pz - heightAt(levels, px, py)) / (t * tanR));
    if (vis < -1) return 0;
    if (pz > maxZ && sun.z > 0) break;
    t += Math.max(0.5, t * 0.04);
  }
  return smoothstep(-1, 1, vis);
}

// ---- meshes and GPU heightfields ---------------------------------------------------------

/** Mesh of level `L` (three.js coords: x = east, y = up, z = -north) with `finer` cut out. */
export function levelGeometry(L, finer, seed, colourAt) {
  const { n, half, cell, z } = L;
  const pos = new Float32Array(n * n * 3);
  const col = new Float32Array(n * n * 3);
  const inner = finer ? finer.half - cell : -1;
  let lo = Infinity; let hi = -Infinity;
  for (const v of z) lo = Math.min(lo, v);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = -half + i * cell; const y = -half + j * cell;
      let h = z[k];
      if (finer && Math.max(Math.abs(x), Math.abs(y)) < finer.half) h -= L.sink; // hidden under the finer mesh
      hi = Math.max(hi, z[k]);
      pos.set([x, h, -y], k * 3);
      // ground colour (map colour or the world's plain colour) with gentle made-up patchiness
      const [r, g, b] = colourAt(x, y);
      const a = 1 + 0.11 * fbm(x / (cell * 40), y / (cell * 40), seed + 9, 3) + 0.05 * fbm(x / (cell * 3), y / (cell * 3), seed + 3, 2);
      col.set([r * a, g * a, b * a], k * 3);
    }
  }
  const index = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const x0 = -half + i * cell; const y0 = -half + j * cell;
      if (finer && x0 >= -inner && x0 + cell <= inner && y0 >= -inner && y0 + cell <= inner) continue;
      const a = j * n + i; const b = a + 1; const c = a + n; const d = c + 1;
      index.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  L.zMin = lo; L.zMax = hi;
  return g;
}

export function heightTexture(L) {
  const tex = new THREE.DataTexture(L.z, L.n, L.n, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}
