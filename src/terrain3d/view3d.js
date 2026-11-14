// Interactive 3D view of Mars terrain, built from real NASA elevation data (MOLA, the same
// tiles the map's Elevation view uses), drawn with three.js (already used for the home-page
// globes). Rotate, tilt down to a low angle, pan and zoom; pick the route's A and B on the
// terrain; the planner's route is draped over the surface with its difficult parts in red.
//
// Honest limits: MOLA elevation here is ~2.6 km per pixel (stored in ~115 m steps, smoothed
// when drawn), so big craters and canyons show their real shape but small craters (< ~10 km)
// are blurred. The surface is drawn flat (no planet curvature) around the area's centre.
// Heights can be exaggerated to read the shape better; the factor is always shown.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadIndex } from '../overlays.js';
import { layerSampler, MARS_R } from '../route/grid.js';
import { BODIES } from '../bodies.js';
import { formatLatLon } from '../geo.js';

const DEG = Math.PI / 180;
const KM_PER_DEG = MARS_R * DEG;
const MAX_SIDE = 420;          // mesh vertices along the longer side
const MAX_REGION_KM = 1600;    // biggest area built at once
const MIN_REGION_KM = 12;
const EXAGGERATIONS = [1, 2, 3, 5, 10];
const $ = (id) => document.getElementById(id);
const fmtM = (km) => `${Math.round(km * 1000).toLocaleString()} m`;

// Mars-like elevation colours (low = dark basalt brown, high = pale dusty ochre)
const ELEV_STOPS = [
  [0.0, [58, 36, 28]], [0.25, [104, 58, 38]], [0.5, [158, 92, 56]], [0.75, [201, 140, 92]], [1.0, [236, 210, 176]],
];
// slope colours: green (gentle) -> amber -> red (steep)
const SLOPE_STOPS = [[0, [76, 160, 110]], [0.33, [215, 190, 90]], [0.6, [230, 130, 60]], [1, [200, 50, 50]]];
function ramp(stops, t) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1]; const [t1, c1] = stops[i];
      const f = (x - t0) / (t1 - t0);
      return c0.map((c, k) => (c + (c1[k] - c) * f) / 255);
    }
  }
  return stops[stops.length - 1][1].map((c) => c / 255);
}

/**
 * Creates the 3D view (once per page). open({ getLeafletView, planner, onClose }):
 * `getLeafletView()` gives the 2D map's centre and size (km) so the 3D view opens on the same
 * area; `planner` is the route planner (or null).
 */
export function createView3D({ routeEvents }) {
  let getLeafletView = () => ({ lat: 0, lon: 0, wKm: 600, hKm: 600 });
  let planner = null;
  let onClose = null;
  const root = $('view3d');
  const canvasHost = $('view3d-canvas');
  let renderer = null; let scene = null; let camera = null; let controls = null;
  let terrain = null;      // { mesh, heights, rows, cols, lat0, lon0, wKm, hKm, kx, slope }
  let routeGroup = null; let markerGroup = null; let hoverDot = null;
  let exaggeration = 3;
  let colourMode = 'elevation';
  let animId = 0;
  let building = 0;
  let isOpen = false;
  const raycaster = new THREE.Raycaster();

  function setStatus(t) { $('view3d-status').textContent = t; }

  // ---- three.js setup (once)
  function init() {
    renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvasHost.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    // dusky Mars sky: dark overhead, a faint butterscotch glow at the horizon
    const sky = document.createElement('canvas');
    sky.width = 2; sky.height = 256;
    const sg = sky.getContext('2d').createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, '#07070a'); sg.addColorStop(0.62, '#141014'); sg.addColorStop(1, '#3b2a20');
    const sc = sky.getContext('2d'); sc.fillStyle = sg; sc.fillRect(0, 0, 2, 256);
    scene.background = new THREE.CanvasTexture(sky);
    scene.background.colorSpace = THREE.SRGBColorSpace;
    camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e5);
    scene.add(new THREE.HemisphereLight(0xffeedd, 0x3a2418, 0.75));
    const sun = new THREE.DirectionalLight(0xfff1e0, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    scene.add(sun, sun.target);
    scene.userData.sun = sun;
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;       // pan along the ground
    controls.maxPolarAngle = Math.PI * 0.497;  // down to just above the horizon
    controls.zoomToCursor = true;
    controls.zoomSpeed = 1.2;
    controls.addEventListener('change', updateClip);
    new ResizeObserver(resize).observe(canvasHost);
    resize();
    // click (not drag) on the terrain: pick A / B
    let down = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || down.b !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
      const hit = pick(e);
      if (!hit || !planner) return;
      if (!planner.isOpen()) planner.open();
      planner.click({ lat: hit.lat, lng: hit.lon });
    });
    renderer.domElement.addEventListener('pointermove', throttle((e) => {
      const hit = pick(e);
      $('view3d-cursor').textContent = hit ? `${formatLatLon(hit.lat, hit.lon)} · elevation ${fmtM(hit.h)}` : '';
    }, 60));
  }

  function throttle(fn, ms) {
    let t = 0;
    return (e) => { const now = performance.now(); if (now - t > ms) { t = now; fn(e); } };
  }

  function resize() {
    if (!renderer) return;
    const w = canvasHost.clientWidth || 1;
    const h = canvasHost.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // near/far planes follow the camera so zooming right in doesn't clip the ground
  function updateClip() {
    if (!terrain) return;
    const d = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.002, d / 5000);
    camera.far = d * 20 + Math.max(terrain.wKm, terrain.hKm) * 6;
    camera.updateProjectionMatrix();
  }

  function loop() {
    animId = requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  }

  // ---- coordinates: local km on a flat plane around the area's centre
  const toLocal = (lat, lon) => {
    const l = lon + Math.round((terrain.lon0 - lon) / 360) * 360;
    return [(l - terrain.lon0) * terrain.kx, -(lat - terrain.lat0) * KM_PER_DEG];
  };
  const toLatLon = (x, z) => {
    const lat = terrain.lat0 - z / KM_PER_DEG;
    const lon = terrain.lon0 + x / terrain.kx;
    return { lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
  };
  // terrain height (km, not exaggerated) at local x, z, interpolated from the mesh grid
  function heightAt(x, z) {
    const { rows, cols, wKm, hKm, heights } = terrain;
    const fx = Math.min(cols - 1, Math.max(0, ((x + wKm / 2) / wKm) * (cols - 1)));
    const fz = Math.min(rows - 1, Math.max(0, ((z + hKm / 2) / hKm) * (rows - 1)));
    const c0 = Math.floor(fx); const r0 = Math.floor(fz);
    const c1 = Math.min(cols - 1, c0 + 1); const r1 = Math.min(rows - 1, r0 + 1);
    const tx = fx - c0; const tz = fz - r0;
    const h = (r, c) => heights[r * cols + c];
    return (h(r0, c0) * (1 - tx) + h(r0, c1) * tx) * (1 - tz) + (h(r1, c0) * (1 - tx) + h(r1, c1) * tx) * tz;
  }

  function pick(e) {
    if (!terrain) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(terrain.mesh, false)[0];
    if (!hit) return null;
    const ll = toLatLon(hit.point.x, hit.point.z);
    return { ...ll, h: heightAt(hit.point.x, hit.point.z) };
  }

  // ---- building the terrain
  async function build(region) {
    const my = ++building;
    setStatus('Reading NASA elevation data…');
    root.classList.add('busy');
    const wKm = Math.min(MAX_REGION_KM, Math.max(MIN_REGION_KM, region.wKm));
    const hKm = Math.min(MAX_REGION_KM, Math.max(MIN_REGION_KM, region.hKm));
    const lat0 = Math.max(-84, Math.min(84, region.lat));
    const lon0 = region.lon;
    const kx = KM_PER_DEG * Math.max(0.05, Math.cos(lat0 * DEG));
    const dLat = hKm / 2 / KM_PER_DEG;
    const dLon = wKm / 2 / kx;
    const index = await loadIndex();
    const metas = index.mars;
    const [elev, slope] = await Promise.all([
      layerSampler('elevation', metas.elevation, lat0 - dLat, lat0 + dLat, lon0 - dLon, lon0 + dLon),
      layerSampler('slope', metas.slope, lat0 - dLat, lat0 + dLat, lon0 - dLon, lon0 + dLon),
    ]);
    if (my !== building) return;
    const cols = Math.round(wKm >= hKm ? MAX_SIDE : (MAX_SIDE * wKm) / hKm);
    const rows = Math.round(hKm >= wKm ? MAX_SIDE : (MAX_SIDE * hKm) / wKm);
    const n = rows * cols;
    const raw = new Float32Array(n);
    const slopes = new Float32Array(n);
    let missing = 0;
    for (let r = 0; r < rows; r++) {
      const z = -hKm / 2 + (r / (rows - 1)) * hKm;
      const lat = lat0 - z / KM_PER_DEG;
      for (let c = 0; c < cols; c++) {
        const x = -wKm / 2 + (c / (cols - 1)) * wKm;
        const lon = ((((lon0 + x / kx) + 180) % 360) + 360) % 360 - 180;
        let h = elev.smooth(lat, lon);
        if (Number.isNaN(h)) { h = 0; missing++; }
        raw[r * cols + c] = h;
        slopes[r * cols + c] = slope.smooth(lat, lon);
      }
    }
    // The tiles store elevation in ~115 m steps: blur over about one data pixel so the
    // steps don't show as terraces. (This doesn't remove real detail: there is none finer.)
    const pxKm = (180 / (256 * 2 ** metas.elevation.max_zoom)) * KM_PER_DEG;
    const cellKm = wKm / (cols - 1);
    const heights = blur(raw, rows, cols, Math.max(0.6, (0.6 * pxKm) / cellKm));
    terrain?.mesh.geometry.dispose();
    if (terrain) scene.remove(terrain.mesh);
    terrain = { rows, cols, wKm, hKm, lat0, lon0, kx, heights, slopes, cellKm, pxKm, missing };
    makeMesh();
    await applyColours();
    if (my !== building) return;
    placeSun();
    resetCamera();
    drawRoute();
    root.classList.remove('busy');
    let lo = Infinity; let hi = -Infinity;
    for (const h of heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
    setStatus(`${Math.round(wKm).toLocaleString()} × ${Math.round(hKm).toLocaleString()} km · elevation ${fmtM(lo)} to ${fmtM(hi)}`);
    updateInfo();
  }

  function blur(src, rows, cols, sigma) {
    const rad = Math.ceil(sigma * 2.5);
    const k = []; let ks = 0;
    for (let i = -rad; i <= rad; i++) { const w = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(w); ks += w; }
    const tmp = new Float32Array(src.length); const out = new Float32Array(src.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let s = 0; let ws = 0;
        for (let i = -rad; i <= rad; i++) { const cc = c + i; if (cc < 0 || cc >= cols) continue; s += src[r * cols + cc] * k[i + rad]; ws += k[i + rad]; }
        tmp[r * cols + c] = s / ws;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let s = 0; let ws = 0;
        for (let i = -rad; i <= rad; i++) { const rr = r + i; if (rr < 0 || rr >= rows) continue; s += tmp[rr * cols + c] * k[i + rad]; ws += k[i + rad]; }
        out[r * cols + c] = s / ws;
      }
    }
    return ks ? out : src;
  }

  function makeMesh() {
    const { rows, cols, wKm, hKm, heights } = terrain;
    const geo = new THREE.PlaneGeometry(wKm, hKm, cols - 1, rows - 1);
    geo.rotateX(-Math.PI / 2); // now x = east, z = south, y = up
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i] * exaggeration);
    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 3), 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    terrain.mesh = mesh;
  }

  function setExaggeration(x) {
    exaggeration = x;
    if (!terrain) return;
    const pos = terrain.mesh.geometry.attributes.position;
    const { heights } = terrain;
    for (let i = 0; i < pos.count; i++) pos.setY(i, heights[i] * exaggeration);
    pos.needsUpdate = true;
    terrain.mesh.geometry.computeVertexNormals();
    terrain.mesh.geometry.computeBoundingSphere();
    terrain.mesh.geometry.computeBoundingBox();
    // keep the camera's height above ground in step with the new heights
    drawRoute();
    updateInfo();
  }

  async function applyColours() {
    const { heights, slopes, mesh } = terrain;
    const col = mesh.geometry.attributes.color;
    let lo = Infinity; let hi = -Infinity;
    for (const h of heights) { if (h < lo) lo = h; if (h > hi) hi = h; }
    const span = Math.max(0.05, hi - lo);
    mesh.material.map = null;
    if (colourMode === 'imagery') {
      const tex = await Promise.race([imageryTexture(), new Promise((r) => setTimeout(() => r(null), 12000))]).catch(() => null);
      if (tex) {
        for (let i = 0; i < col.count; i++) col.setXYZ(i, 1, 1, 1);
        mesh.material.map = tex;
        col.needsUpdate = true;
        mesh.material.needsUpdate = true;
        $('view3d-legend').textContent = 'Colour: spacecraft images (Viking, CTX) draped on the terrain';
        return;
      }
      colourMode = 'elevation';
      refreshButtons();
      setStatus('The image servers don\'t allow their pictures to be used in 3D here, so the terrain is coloured by elevation.');
    }
    for (let i = 0; i < col.count; i++) {
      const c = colourMode === 'slope'
        ? (Number.isNaN(slopes[i]) ? [0.5, 0.5, 0.5] : ramp(SLOPE_STOPS, slopes[i] / 25))
        : ramp(ELEV_STOPS, (heights[i] - lo) / span);
      col.setXYZ(i, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
    mesh.material.needsUpdate = true;
    $('view3d-legend').innerHTML = colourMode === 'slope'
      ? 'Colour: slope at ~2 km scale (MOLA) · <span style="color:#4ca06e">■</span> flat · <span style="color:#d7be5a">■</span> 8° · <span style="color:#e6823c">■</span> 15° · <span style="color:#c83232">■</span> 25°+'
      : `Colour: elevation · dark = ${fmtM(lo)} · pale = ${fmtM(hi)}`;
  }

  // Spacecraft images for the texture, read from the same tile servers as the 2D map.
  // Only works if the server allows cross-site use of its images (CORS).
  async function imageryTexture() {
    const { lat0, lon0, wKm, hKm, kx } = terrain;
    const dLat = hKm / 2 / KM_PER_DEG; const dLon = wKm / 2 / kx;
    const south = lat0 - dLat; const north = lat0 + dLat; const west = lon0 - dLon; const east = lon0 + dLon;
    const W = 2048; const H = Math.max(256, Math.round((W * hKm) / wKm));
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    let drawn = 0;
    for (const layer of BODIES.mars.layers) {
      const tile = layer.tileSize ?? 256;
      const worldPxNeeded = (W / (east - west)) * 360;
      let z = Math.ceil(Math.log2(worldPxNeeded / 512));
      z = Math.min(layer.maxNativeZoom, Math.max(0, z));
      if (layer.minZoom && z < layer.minZoom) continue;
      const worldPx = 512 * 2 ** z;
      const nTx = worldPx / tile;
      const x0 = Math.floor(((west + 180) / 360) * nTx); const x1 = Math.floor(((east + 180) / 360) * nTx);
      const y0 = Math.max(0, Math.floor(((90 - north) / 180) * (nTx / 2))); const y1 = Math.min(nTx / 2 - 1, Math.floor(((90 - south) / 180) * (nTx / 2)));
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 160) continue; // too many tiles
      ctx.filter = layer.filter ?? 'none';
      const jobs = [];
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const txw = ((tx % nTx) + nTx) % nTx;
          const url = layer.url.replace('{z}', z + (layer.zoomOffset ?? 0)).replace('{y}', ty).replace('{x}', txw);
          jobs.push(new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const lonA = (tx / nTx) * 360 - 180; const lonB = ((tx + 1) / nTx) * 360 - 180;
              const latA = 90 - (ty / (nTx / 2)) * 180; const latB = 90 - ((ty + 1) / (nTx / 2)) * 180;
              const px = ((lonA - west) / (east - west)) * W; const py = ((north - latA) / (north - south)) * H;
              const pw = ((lonB - lonA) / (east - west)) * W; const ph = ((latA - latB) / (north - south)) * H;
              ctx.drawImage(img, px, py, pw + 0.5, ph + 0.5);
              drawn++;
              resolve();
            };
            img.onerror = () => resolve();
            img.src = url;
          }));
        }
      }
      await Promise.all(jobs);
    }
    if (!drawn) throw new Error('no imagery');
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  function placeSun() {
    const sun = scene.userData.sun;
    const size = Math.max(terrain.wKm, terrain.hKm);
    // afternoon sun from the north-west, 35 degrees up: long shadows show the relief
    const el = 35 * DEG; const az = 315 * DEG;
    sun.position.set(Math.sin(az) * Math.cos(el) * size, Math.sin(el) * size, -Math.cos(az) * Math.cos(el) * size);
    sun.target.position.set(0, 0, 0);
    const cam = sun.shadow.camera;
    cam.left = -size * 0.75; cam.right = size * 0.75; cam.top = size * 0.75; cam.bottom = -size * 0.75;
    cam.near = 0.01; cam.far = size * 4;
    cam.updateProjectionMatrix();
  }

  function centreHeight() { return heightAt(0, 0) * exaggeration; }

  function resetCamera() {
    const size = Math.max(terrain.wKm, terrain.hKm);
    const h = centreHeight();
    controls.target.set(0, h, 0);
    // looking north, tilted 55 degrees down from the horizon
    const d = size * 0.95;
    camera.position.set(0, h + d * Math.sin(55 * DEG), d * Math.cos(55 * DEG));
    controls.minDistance = Math.max(0.05, terrain.cellKm * 0.25);
    controls.maxDistance = size * 4;
    controls.update();
    updateClip();
  }

  function topView() {
    const d = camera.position.distanceTo(controls.target);
    camera.position.set(controls.target.x, controls.target.y + d, controls.target.z + d * 0.001);
    controls.update();
  }

  // ---- the route on the terrain
  function drawRoute() {
    if (!terrain) return;
    if (routeGroup) { scene.remove(routeGroup); disposeGroup(routeGroup); }
    if (markerGroup) { scene.remove(markerGroup); disposeGroup(markerGroup); }
    routeGroup = new THREE.Group();
    markerGroup = new THREE.Group();
    scene.add(routeGroup, markerGroup);
    hoverDot = null;
    const state = planner?.result();
    if (!state) return;
    const size = Math.max(terrain.wKm, terrain.hKm);
    const lift = size * 0.0015 + 0.01;
    const pin = (p, colour) => {
      const [x, z] = toLocal(p.lat, p.lon);
      const y = heightAt(x, z) * exaggeration;
      const hgt = size * 0.04;
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.0012, size * 0.0012, hgt, 8), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      stick.position.set(x, y + hgt / 2, z);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(size * 0.007, 16, 12), new THREE.MeshBasicMaterial({ color: colour }));
      ball.position.set(x, y + hgt, z);
      markerGroup.add(stick, ball);
    };
    if (state.a) pin(state.a, 0x7fd4ff);
    if (state.b) pin(state.b, 0xff7a7a);
    const r = state.route;
    if (!r) return;
    // draped line: densify between points so it follows the ground, then lift it a little
    const pts = []; const hardFlags = [];
    for (let k = 0; k < r.pts.length; k++) {
      const [x, z] = toLocal(r.pts[k][0], r.pts[k][1]);
      if (k > 0) {
        const [px, pz] = toLocal(r.pts[k - 1][0], r.pts[k - 1][1]);
        const steps = Math.max(1, Math.ceil(Math.hypot(x - px, z - pz) / (terrain.cellKm * 0.7)));
        for (let s = 1; s < steps; s++) {
          const t = s / steps;
          const xx = px + (x - px) * t; const zz = pz + (z - pz) * t;
          pts.push(new THREE.Vector3(xx, heightAt(xx, zz) * exaggeration + lift, zz));
          hardFlags.push(r.hard[k]);
        }
      }
      pts.push(new THREE.Vector3(x, heightAt(x, z) * exaggeration + lift, z));
      hardFlags.push(r.hard[k]);
    }
    terrain.routePts = pts;
    terrain.routeIndex = []; // route point k -> index into pts
    { let j = 0; for (let k = 0; k < r.pts.length; k++) { const [x, z] = toLocal(r.pts[k][0], r.pts[k][1]); while (j < pts.length - 1 && Math.hypot(pts[j].x - x, pts[j].z - z) > 1e-6) j++; terrain.routeIndex.push(j); } }
    const radius = size * 0.0016;
    const runs = [];
    let start = 0;
    for (let i = 1; i <= pts.length; i++) {
      if (i === pts.length || hardFlags[i] !== hardFlags[start]) {
        runs.push({ from: Math.max(0, start - 1), to: i - 1, hard: hardFlags[start] });
        start = i;
      }
    }
    for (const run of runs) {
      const seg = pts.slice(run.from, run.to + 1);
      if (seg.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(seg, false, 'centripetal');
      const geo = new THREE.TubeGeometry(curve, Math.max(2, seg.length * 3), radius, 8, false);
      const mat = new THREE.MeshBasicMaterial({ color: run.hard ? 0xe5484d : new THREE.Color(state.colour), depthTest: true });
      routeGroup.add(new THREE.Mesh(geo, mat));
    }
    // danger markers: small floating labels
    const icons = { slope: '⛰', crater: '◎', dust: '≋', storm: '🌪' };
    for (const d of r.dangers) {
      const p = pts[terrain.routeIndex[d.k]];
      if (!p) continue;
      const sprite = labelSprite(icons[d.type]);
      sprite.position.set(p.x, p.y + size * 0.02, p.z);
      sprite.scale.set(size * 0.025, size * 0.025, 1);
      markerGroup.add(sprite);
    }
  }

  function labelSprite(text) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(17,17,17,.9)';
    c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#ffb02e'; c.lineWidth = 5; c.stroke();
    c.fillStyle = '#fff'; c.font = '30px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 32, 34);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  }

  function disposeGroup(g) {
    g.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } });
  }

  function showHover(k) {
    if (!terrain?.routePts) return;
    if (k < 0) { if (hoverDot) hoverDot.visible = false; return; }
    const p = terrain.routePts[terrain.routeIndex[k]];
    if (!p) return;
    if (!hoverDot) {
      const size = Math.max(terrain.wKm, terrain.hKm);
      hoverDot = new THREE.Mesh(new THREE.SphereGeometry(size * 0.006, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      markerGroup.add(hoverDot);
    }
    hoverDot.visible = true;
    hoverDot.position.copy(p);
  }

  // fly the camera to look at a point of the route from a low angle
  function focusOn(k) {
    const p = terrain?.routePts?.[terrain.routeIndex[k]];
    if (!p) return;
    const size = Math.max(terrain.wKm, terrain.hKm);
    const d = Math.max(terrain.cellKm * 6, size * 0.12);
    const dir = camera.position.clone().sub(controls.target).setY(0).normalize();
    controls.target.copy(p);
    camera.position.set(p.x + dir.x * d * 0.9, p.y + d * 0.45, p.z + dir.z * d * 0.9);
    controls.update();
  }

  // ---- what area to show
  function regionFromRoute(state) {
    const pts = state?.route?.pts ?? [state?.a, state?.b].filter(Boolean).map((p) => [p.lat, p.lon]);
    if (pts.length < 2) return null;
    const ref = pts[0][1];
    let la0 = Infinity; let la1 = -Infinity; let lo0 = Infinity; let lo1 = -Infinity;
    for (const [lat, lon0] of pts) {
      const lon = lon0 + Math.round((ref - lon0) / 360) * 360;
      la0 = Math.min(la0, lat); la1 = Math.max(la1, lat); lo0 = Math.min(lo0, lon); lo1 = Math.max(lo1, lon);
    }
    const lat = (la0 + la1) / 2; const lon = (lo0 + lo1) / 2;
    const kx = KM_PER_DEG * Math.max(0.05, Math.cos(lat * DEG));
    const span = Math.max((la1 - la0) * KM_PER_DEG, (lo1 - lo0) * kx);
    // room around the route so its surroundings (e.g. the whole crater) are visible
    const side = Math.max(150, span * 1.8);
    return { lat, lon, wKm: side, hKm: side };
  }
  function routeInside(state) {
    if (!terrain || !state?.route) return true;
    return state.route.pts.every(([lat, lon]) => {
      const [x, z] = toLocal(lat, lon);
      return Math.abs(x) < terrain.wKm / 2 && Math.abs(z) < terrain.hKm / 2;
    });
  }

  function updateInfo() {
    const pxKm = terrain ? terrain.pxKm : 2.6;
    $('view3d-info').innerHTML = `<strong>Real NASA elevation</strong> (MGS MOLA) · ~${pxKm.toFixed(1)} km per data pixel, smoothed ·
      heights <strong>×${exaggeration}</strong>${exaggeration > 1 ? ' (exaggerated to show the shape)' : ' (true scale)'} · drawn flat, without the planet's curvature.
      Craters smaller than ~10 km are blurred at this data resolution.`;
  }

  // ---- buttons
  function refreshButtons() {
    for (const b of root.querySelectorAll('[data-exag]')) b.setAttribute('aria-checked', Number(b.dataset.exag) === exaggeration);
    for (const b of root.querySelectorAll('[data-colour]')) b.setAttribute('aria-checked', b.dataset.colour === colourMode);
  }
  $('view3d-exag').replaceChildren(...EXAGGERATIONS.map((x) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = `×${x}`; b.dataset.exag = x; b.setAttribute('role', 'radio');
    b.title = x === 1 ? 'True heights' : `Heights exaggerated ${x} times`;
    b.onclick = () => { setExaggeration(x); refreshButtons(); };
    return b;
  }));
  $('view3d-colour').replaceChildren(...[['elevation', 'Elevation'], ['slope', 'Slope'], ['imagery', 'Images']].map(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.dataset.colour = k; b.setAttribute('role', 'radio');
    b.onclick = async () => { colourMode = k; refreshButtons(); if (terrain) await applyColours(); };
    return b;
  }));
  refreshButtons();
  $('view3d-reset').onclick = () => terrain && resetCamera();
  $('view3d-top').onclick = () => terrain && topView();
  $('view3d-here').onclick = () => {
    if (!terrain) return;
    // rebuild the terrain around the point the camera looks at, about as wide as the view
    const t = controls.target;
    const ll = toLatLon(t.x, t.z);
    const d = camera.position.distanceTo(t);
    build({ lat: ll.lat, lon: ll.lon, wKm: d * 1.4, hKm: d * 1.4 });
  };
  $('view3d-route').onclick = () => {
    const reg = regionFromRoute(planner?.result());
    if (reg) build(reg);
  };
  $('view3d-close').onclick = () => close();

  routeEvents?.addEventListener('update', ({ detail }) => {
    if (!isOpen || !terrain || detail.busy) { if (isOpen && terrain) drawRoute(); return; }
    $('view3d-route').hidden = !detail.route;
    if (detail.route && !routeInside(detail)) build(regionFromRoute(detail));
    else drawRoute();
  });
  routeEvents?.addEventListener('hover', ({ detail }) => { if (isOpen) showHover(detail.k); });
  routeEvents?.addEventListener('focus', ({ detail }) => { if (isOpen) focusOn(detail.k); });

  function open(opts = {}) {
    if (opts.getLeafletView) getLeafletView = opts.getLeafletView;
    planner = opts.planner ?? null;
    onClose = opts.onClose ?? null;
    if (!renderer) {
      try { init(); } catch (err) {
        console.error(err);
        alert('3D view needs WebGL, which this browser has turned off.');
        return;
      }
    }
    isOpen = true;
    root.hidden = false;
    document.body.classList.add('in-3d');
    resize();
    cancelAnimationFrame(animId);
    loop();
    const state = planner?.result();
    $('view3d-route').hidden = !state?.route;
    const reg = regionFromRoute(state) ?? getLeafletView();
    build(reg);
  }
  function close() {
    isOpen = false;
    root.hidden = true;
    document.body.classList.remove('in-3d');
    cancelAnimationFrame(animId);
    onClose?.();
  }
  return { open, close, isOpen: () => isOpen };
}
