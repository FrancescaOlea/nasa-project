// Procedural starry sky with the Milky Way, painted once onto a canvas
// (and again when the window is resized). No images needed.

// Small seeded random generator, so the sky looks the same on every visit.
function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Smooth 2D value noise, summed over several sizes ("fractal" noise): gives
// the cloudy texture of the Milky Way.
function makeNoise(seed) {
  const r = rng(seed);
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  for (let i = 0; i < N; i++) { perm[i] = i; vals[i] = r(); }
  for (let i = N - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < N; i++) perm[i + N] = perm[i];
  const at = (x, y) => vals[perm[(perm[x & 255] + y) & 511]];
  const smooth = (t) => t * t * (3 - 2 * t);
  const noise = (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const fx = smooth(x - xi); const fy = smooth(y - yi);
    const a = at(xi, yi); const b = at(xi + 1, yi);
    const c = at(xi, yi + 1); const d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  return (x, y, octaves = 5) => {
    let sum = 0; let amp = 0.5; let f = 1; let norm = 0;
    for (let o = 0; o < octaves; o++) { sum += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
    return sum / norm;
  };
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function drawStarfield(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(canvas.clientWidth * dpr);
  const H = Math.round(canvas.clientHeight * dpr);
  if (!W || !H) return;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  const random = rng(20261111);
  const cloud = makeNoise(7);
  const dust = makeNoise(13);

  // The Milky Way: a band crossing the screen diagonally.
  const angle = (-28 * Math.PI) / 180;
  const ux = Math.cos(angle); const uy = Math.sin(angle);   // along the band
  const diag = Math.hypot(W, H);
  const width = 0.11 * diag;                                  // band half-width
  const coreAt = -0.18 * diag;                                // brightest part, left of centre

  // 1) Diffuse glow, computed at about 1/4 of the screen's CSS resolution and smoothly
  //    enlarged (it's a soft blur, so more detail would be wasted work).
  const s = Math.max(3, Math.round(4 * dpr));
  const gw = Math.ceil(W / s); const gh = Math.ceil(H / s);
  const glow = new ImageData(gw, gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const px = x * s - W / 2; const py = y * s - H / 2;
      const along = px * ux + py * uy;
      const across = -px * uy + py * ux;
      const band = Math.exp(-((across / width) ** 2));
      if (band < 0.01) continue;
      const nx = px / diag * 6; const ny = py / diag * 6;
      const core = Math.exp(-(((along - coreAt) / (0.3 * diag)) ** 2));
      let v = band * (0.25 + 0.75 * cloud(nx, ny, 4)) * (0.55 + 0.9 * core);
      // dark dust lanes along the middle of the band
      const lane = smoothstep(0.5, 0.72, dust(nx * 2.2 + 11, ny * 2.2 + 5, 3));
      v *= 1 - 0.75 * lane * Math.exp(-((across / (0.45 * width)) ** 2));
      const i = (y * gw + x) * 4;
      // bluish-white outskirts, warmer towards the core
      glow.data[i] = 175 + 80 * core;
      glow.data[i + 1] = 185 + 45 * core;
      glow.data[i + 2] = 235 - 45 * core;
      glow.data[i + 3] = Math.min(255, v * 120);
    }
  }
  const off = document.createElement('canvas');
  off.width = gw; off.height = gh;
  off.getContext('2d').putImageData(glow, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, W, H);

  // 2) Stars: some spread evenly, many more crowded into the band.
  const colours = ['#a9c4ff', '#cad8ff', '#ffffff', '#ffffff', '#fff4e0', '#ffe2b8', '#ffc98f'];
  const area = (W * H) / (dpr * dpr);
  const star = (x, y, faint) => {
    const big = random() < (faint ? 0.003 : 0.012);
    const r = (big ? 0.9 + random() * 0.9 : 0.35 + random() ** 2 * 0.85) * dpr;
    const alpha = big ? 0.9 : 0.25 + random() * (faint ? 0.45 : 0.65);
    const c = colours[Math.floor(random() * colours.length)];
    ctx.globalAlpha = alpha;
    if (big) { // soft halo around bright stars
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3.5);
      g.addColorStop(0, c); g.addColorStop(0.25, c); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.globalAlpha = alpha * 0.6;
      ctx.beginPath(); ctx.arc(x, y, r * 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  for (let i = 0; i < area / 900; i++) star(random() * W, random() * H, false);
  for (let i = 0; i < area / 260; i++) {
    // position along the band, and a bell-curve distance across it
    const along = (random() - 0.5) * diag;
    const across = (random() + random() + random() - 1.5) * width * 0.9;
    const x = W / 2 + along * ux - across * uy;
    const y = H / 2 + along * uy + across * ux;
    if (x >= 0 && x < W && y >= 0 && y < H) star(x, y, true);
  }
  ctx.globalAlpha = 1;
}
