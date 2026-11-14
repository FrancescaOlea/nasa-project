// "3D view from here" on the Moon: stand at a point, 1.8 m eye height, look around, change
// the time and watch the light and shadows. Loaded only when opened (dynamic import).
import * as THREE from 'three';
import { loadFar, loadLola } from './dem.js';
import { buildLevels, levelGeometry, heightTexture, heightAt, sunVisibility, rng, LEVELS } from './terrain.js';
import { skyAt, azEl, nextSunCrossing } from './sky.js';

const EYE_M = 1.8;
const SUN_RADIUS_DEG = 0.267;
const DAY_EXPOSURE = 1.0;
const NIGHT_EXPOSURE = 9.0; // eyes adapted to earthshine

// local east/north/up -> three.js (x = east, y = up, z = -north)
const toThree = (v) => new THREE.Vector3(v.x, v.z, -v.y);

// ---- terrain shadows on the GPU: march towards the Sun through the four heightfields ----

const SHADOW_GLSL = /* glsl */`
uniform sampler2D uH0; uniform sampler2D uH1; uniform sampler2D uH2; uniform sampler2D uH3;
uniform vec4 uHalf; uniform vec4 uN; uniform vec3 uSunDir; uniform float uMaxZ;
varying vec3 vTW;
float hLevel(sampler2D tex, float hs, float n, vec2 xy) {
  vec2 g = clamp((xy + hs) / (2.0 * hs) * (n - 1.0), vec2(0.0), vec2(n - 1.001));
  vec2 i = floor(g); vec2 f = g - i; ivec2 p = ivec2(i);
  float a = texelFetch(tex, p, 0).r;               float b = texelFetch(tex, p + ivec2(1, 0), 0).r;
  float c = texelFetch(tex, p + ivec2(0, 1), 0).r; float d = texelFetch(tex, p + ivec2(1, 1), 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float tHeight(vec2 xy) {
  float m = max(abs(xy.x), abs(xy.y));
  if (m < uHalf.x) return hLevel(uH0, uHalf.x, uN.x, xy);
  if (m < uHalf.y) return hLevel(uH1, uHalf.y, uN.y, xy);
  if (m < uHalf.z) return hLevel(uH2, uHalf.z, uN.z, xy);
  return hLevel(uH3, uHalf.w, uN.w, xy);
}
float tCell(vec2 xy) {
  float m = max(abs(xy.x), abs(xy.y));
  vec4 cell = 2.0 * uHalf / (uN - 1.0);
  return m < uHalf.x ? cell.x : m < uHalf.y ? cell.y : m < uHalf.z ? cell.z : cell.w;
}
// 0..1: share of the Sun's disc visible from world point w (soft edge = the disc's size)
float terrainSun(vec3 w) {
  vec2 dir = vec2(uSunDir.x, -uSunDir.z); float sz = uSunDir.y;
  if (sz < -0.06) return 0.0;
  vec2 p0 = vec2(w.x, -w.z);
  float cell = tCell(p0);
  float z0 = w.y + 0.04 * cell + 0.01;
  float vis = 1.0; float t = cell;
  for (int k = 0; k < 280; k++) {
    vec2 p = p0 + dir * t; float pz = z0 + sz * t;
    if (max(abs(p.x), abs(p.y)) > uHalf.w) break;
    vis = min(vis, (pz - tHeight(p)) / (t * 0.00466));
    if (vis < -1.0) return 0.0;
    if (pz > uMaxZ && sz > 0.0) break;
    t += max(0.12, t * 0.045);
  }
  return smoothstep(-1.0, 1.0, vis);
}
`;

function patchLights() {
  const chunk = THREE.ShaderChunk.lights_fragment_begin;
  const at = chunk.indexOf('NUM_DIR_LIGHTS > 0');
  const re = chunk.indexOf('RE_Direct(', at);
  return `float terrainSunVis = terrainSun(vTW);\n${chunk.slice(0, re)}` +
    '#if UNROLLED_LOOP_INDEX == 0\n\t\tdirectLight.color *= terrainSunVis;\n\t\t#endif\n\t\t' + chunk.slice(re);
}

/** A standard material whose first directional light (the Sun) is blocked by the terrain. */
function shadowedMaterial(uniforms, opts) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, ...opts });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = `varying vec3 vTW;\n${sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 tw = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        tw = instanceMatrix * tw;
      #endif
      vTW = (modelMatrix * tw).xyz;`)}`;
    sh.fragmentShader = SHADOW_GLSL + sh.fragmentShader.replace('#include <lights_fragment_begin>', patchLights());
  };
  return mat;
}

// ---- rocks (made up) ----------------------------------------------------------------------

function rockGeometries(random) {
  return [0, 1, 2].map((v) => {
    const g = new THREE.IcosahedronGeometry(1, 2);
    const p = g.attributes.position;
    const bumps = Array.from({ length: 6 }, () => new THREE.Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize());
    for (let i = 0; i < p.count; i++) {
      const d = new THREE.Vector3().fromBufferAttribute(p, i);
      let s = 0.85;
      for (const b of bumps) s += 0.12 * Math.max(0, d.dot(b)) ** 3;
      s += 0.06 * (random() - 0.5);
      p.setXYZ(i, d.x * s * (1 + 0.2 * v), d.y * s * (0.55 + 0.1 * v), d.z * s);
    }
    g.computeVertexNormals();
    return g;
  });
}

// ---- sky textures ---------------------------------------------------------------------------

function sunTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.085, 'rgba(255,255,250,1)');
  grad.addColorStop(0.1, 'rgba(255,250,235,0.55)');
  grad.addColorStop(0.25, 'rgba(255,240,220,0.12)');
  grad.addColorStop(1, 'rgba(255,240,220,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function earthTexture() {
  // a stand-in: ocean blue with white cloud swirls (a real map of Earth comes next)
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const img = g.createImageData(512, 256);
  const random = rng(42);
  const blobs = Array.from({ length: 70 }, () => [random() * 512, random() * 256, 6 + random() * 30]);
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 512; x++) {
      let cloud = 0;
      for (const [bx, by, r] of blobs) {
        const dx = Math.min(Math.abs(x - bx), 512 - Math.abs(x - bx)); const dy = (y - by) * 1.6;
        cloud += Math.exp(-(dx * dx + dy * dy) / (r * r));
      }
      cloud = Math.min(1, cloud * 0.8 + (Math.abs(y - 128) > 108 ? 0.8 : 0));
      const k = (y * 512 + x) * 4;
      img.data[k] = 30 + 215 * cloud; img.data[k + 1] = 70 + 180 * cloud; img.data[k + 2] = 150 + 100 * cloud; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- the view ---------------------------------------------------------------------------------

/**
 * Open the 3D view. `els` = the page's elements; `onBack()` leaves; `onTime(date)` reports
 * time changes (for the address). Returns a function that closes the view.
 */
export function open3D(els, { lat, lon, date: startDate, onBack, onTime }) {
  const { canvas, hud } = els;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 400000);
  camera.rotation.order = 'YXZ';
  const skyScene = new THREE.Scene();
  const skyCam = new THREE.PerspectiveCamera(60, 1, 1, 5000);
  skyCam.rotation.order = 'YXZ';

  // lights: the Sun (casts rock shadows near you; terrain shadows come from the shader),
  // earthshine, and a little fill for light bounced off sunlit ground
  const sunLight = new THREE.DirectionalLight(0xfffaf2, 3.2);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(4096, 4096);
  Object.assign(sunLight.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 1, far: 2000 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.03;
  scene.add(sunLight, sunLight.target);
  const earthLight = new THREE.DirectionalLight(0xbcd2ff, 0);
  scene.add(earthLight, earthLight.target);
  const fill = new THREE.AmbientLight(0xffffff, 0);
  scene.add(fill);

  const uniforms = {
    uH0: { value: null }, uH1: { value: null }, uH2: { value: null }, uH3: { value: null },
    uHalf: { value: new THREE.Vector4(...LEVELS.map((l) => l.half)) },
    uN: { value: new THREE.Vector4(...LEVELS.map((l) => l.n)) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMaxZ: { value: 0 },
  };
  const groundMat = shadowedMaterial(uniforms, { vertexColors: true });
  const rockMat = shadowedMaterial(uniforms, { color: 0x9a948c });

  // sky: Sun and Earth
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTexture(), blending: THREE.AdditiveBlending,
    depthTest: false, depthWrite: false, transparent: true, toneMapped: false }));
  const SKY_D = 1000;
  sunSprite.scale.setScalar(2 * SKY_D * Math.tan((SUN_RADIUS_DEG * Math.PI) / 180) / 0.085);
  skyScene.add(sunSprite);
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshStandardMaterial({ map: earthTexture(), roughness: 0.9, metalness: 0 }));
  skyScene.add(earth);
  const earthSun = new THREE.DirectionalLight(0xffffff, 3);
  skyScene.add(earthSun, earthSun.target, new THREE.AmbientLight(0xffffff, 0.02));

  // ---- state
  const seed = (Math.round(lat * 1000) * 73856093) ^ (Math.round(lon * 1000) * 19349663);
  let levels = null;
  let meshes = [];
  let rocks = [];
  let eyeZ = EYE_M;
  let yaw = 0; let pitch = 0; // degrees: yaw from north, clockwise
  let base = startDate;       // slider 0
  let offsetH = 0;
  let playing = 0;            // hours per second (0 = paused)
  let sky = null;
  let closed = false;
  let dirty = true;
  const status = (text) => { els.status.textContent = text; els.status.hidden = !text; };

  function rebuild(sources) {
    const built = buildLevels(lat, lon, sources, seed);
    levels = built.levels;
    for (const m of meshes) { scene.remove(m); m.geometry.dispose(); }
    meshes = levels.map((L, i) => {
      const mesh = new THREE.Mesh(levelGeometry(L, levels[i - 1], seed + i), groundMat);
      mesh.receiveShadow = i <= 1;
      scene.add(mesh);
      return mesh;
    });
    for (const [i, L] of levels.entries()) {
      uniforms[`uH${i}`].value?.dispose();
      uniforms[`uH${i}`].value = heightTexture(L);
    }
    uniforms.uMaxZ.value = Math.max(...levels.map((L) => L.zMax)) + 1;
    placeRocks();
    eyeZ = heightAt(levels, 0, 0) + EYE_M;
    camera.position.set(0, eyeZ, 0);
    els.where.textContent = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}` +
      ` · ground ${(built.h0 / 1000).toFixed(2)} km`;
    updateSky();
  }

  const rockGeos = rockGeometries(rng(seed + 7));
  function placeRocks() {
    for (const r of rocks) scene.remove(r);
    const random = rng(seed + 11);
    const per = 900;
    const foot = levels[0];
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion(); const e = new THREE.Euler();
    rocks = rockGeos.map((g) => {
      const inst = new THREE.InstancedMesh(g, rockMat, per);
      for (let k = 0; k < per; k++) {
        const r = 1.5 + 93 * Math.sqrt(random()); const a = random() * Math.PI * 2;
        const x = r * Math.sin(a); const y = r * Math.cos(a);
        const D = 0.05 * (1 - random() * (1 - (0.05 / 1.8) ** 2.4)) ** (-1 / 2.4); // many pebbles, few boulders
        const s = D / 2;
        e.set(random() * 6.3, random() * 6.3, random() * 0.6);
        q.setFromEuler(e);
        m.compose(new THREE.Vector3(x, foot.sample(x, y) - 0.3 * s, -y), q, new THREE.Vector3(s, s, s));
        inst.setMatrixAt(k, m);
        const c = 0.8 + 0.35 * random();
        inst.setColorAt(k, new THREE.Color(c, c * 0.98, c * 0.95));
      }
      inst.castShadow = true;
      inst.receiveShadow = true;
      scene.add(inst);
      return inst;
    });
  }

  function now() { return new Date(base.getTime() + offsetH * 3600e3); }

  function updateSky() {
    if (!levels) return;
    const date = now();
    sky = skyAt(date, lat, lon);
    const s = sky.sun.dir;
    const sun3 = toThree(s);
    uniforms.uSunDir.value.copy(sun3);
    sunLight.position.copy(camera.position).addScaledVector(sun3, 1000);
    sunLight.target.position.set(0, eyeZ, 0);
    const sunEl = azEl(s).el;
    const vis = sunVisibility(levels, s, 0, 0, eyeZ);
    const sunUp = Math.max(0, Math.min(1, (sunEl + SUN_RADIUS_DEG) / (2 * SUN_RADIUS_DEG)));
    sunLight.intensity = 3.2 * sunUp;
    fill.intensity = 0.14 * sunUp; // light bounced off the sunlit ground: shadows are dark, not black
    // earthshine: from the Earth's direction, as bright as its lit share
    const e = sky.earth;
    const earthEl = azEl(e.dir).el;
    earthLight.position.copy(toThree(e.dir)).multiplyScalar(1000);
    earthLight.intensity = earthEl > -1 ? 0.06 * e.lit : 0;
    const day = Math.min(1, Math.max(0, (sunEl + 1) / 2)) * Math.max(vis, 0.15);
    renderer.toneMappingExposure = NIGHT_EXPOSURE + (DAY_EXPOSURE - NIGHT_EXPOSURE) * Math.min(1, day * 1.4);
    earthSun.intensity = 2.5 / renderer.toneMappingExposure; // the Earth looks the same whatever the eyes adapt to
    // sky objects
    sunSprite.position.copy(sun3).multiplyScalar(SKY_D);
    sunSprite.visible = sunEl > -2;
    const earthAng = Math.asin(6371 / e.km);
    earth.position.copy(toThree(e.dir)).multiplyScalar(SKY_D);
    earth.scale.setScalar(SKY_D * Math.tan(earthAng));
    earthSun.position.copy(earth.position).add(toThree(e.sunDir).multiplyScalar(10));
    earthSun.target.position.copy(earth.position);
    showInfo(date, sunEl, vis, e, earthEl);
    dirty = true;
  }

  // ---- info panel and controls
  const pad = (n) => String(n).padStart(2, '0');
  const localInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  let crossingTimer = null;
  function showInfo(date, sunEl, vis, e, earthEl) {
    els.date.value = localInput(date);
    els.slider.value = offsetH;
    els.offset.textContent = offsetH === 0 ? 'chosen time' : `${offsetH > 0 ? '+' : '−'}${fmtDuration(Math.abs(offsetH))}`;
    const sAz = Math.round(azEl(sky.sun.dir).az);
    let sunText;
    if (sunEl < -SUN_RADIUS_DEG) sunText = `<b>Night.</b> The Sun is ${(-sunEl).toFixed(1)}° below the horizon.`;
    else if (vis < 0.02) sunText = `<b>In shadow.</b> The Sun is ${sunEl.toFixed(1)}° up (${compass(sAz)}) but hidden behind terrain.`;
    else sunText = `<b>Day.</b> Sun ${sunEl.toFixed(1)}° above the horizon, ${compass(sAz)} (${sAz}°)` +
      (vis < 0.98 ? `, partly hidden (${Math.round(vis * 100)}% visible)` : '') + '.';
    els.sun.innerHTML = sunText;
    els.earth.innerHTML = earthEl > -1
      ? `<b>Earth</b> ${earthEl.toFixed(1)}° up, ${compass(azEl(e.dir).az)} · ${Math.round(e.lit * 100)}% lit · ${Math.round(e.km).toLocaleString()} km away`
      : '<b>Earth</b> is below the horizon here (always, on the far side of the Moon).';
    clearTimeout(crossingTimer);
    crossingTimer = setTimeout(() => {
      const c = nextSunCrossing(date, lat, lon);
      els.next.textContent = c ? `Next ${c.rising ? 'sunrise' : 'sunset'} (flat horizon): in ${fmtDuration((c.date - date) / 3600e3)}` +
        ` · ${c.date.toLocaleString()}` : '';
    }, 120);
  }
  const fmtDuration = (h) => (h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`);
  const compass = (az) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(az / 45) % 8];

  els.slider.oninput = () => { offsetH = Number(els.slider.value); updateSky(); onTime?.(now()); };
  els.date.onchange = () => {
    const d = new Date(els.date.value);
    if (!Number.isNaN(d.getTime())) { base = d; offsetH = 0; updateSky(); onTime?.(now()); }
  };
  els.now.onclick = () => { base = new Date(); offsetH = 0; updateSky(); onTime?.(now()); };
  const SPEEDS = [1, 6, 24];
  els.play.onclick = () => {
    playing = playing ? 0 : SPEEDS[speedIdx];
    els.play.textContent = playing ? '❚❚ Pause' : '▶ Play';
    if (!playing) onTime?.(now());
  };
  let speedIdx = 0;
  els.speed.onclick = () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    els.speed.textContent = `${SPEEDS[speedIdx]} h/s`;
    if (playing) playing = SPEEDS[speedIdx];
  };
  els.speed.textContent = `${SPEEDS[speedIdx]} h/s`;
  els.play.textContent = '▶ Play';
  els.back.onclick = () => onBack();

  // looking around: drag, wheel / pinch to zoom, arrow keys
  const zoomTo = (fov) => {
    camera.fov = Math.max(4, Math.min(100, fov));
    camera.updateProjectionMatrix();
    dirty = true;
  };
  const pointers = new Map();
  let pinch = null;
  canvas.onpointerdown = (ev) => {
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    canvas.setPointerCapture(ev.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: camera.fov };
    }
  };
  canvas.onpointermove = (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (!prev) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      zoomTo(pinch.fov * (pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))));
      return;
    }
    const k = camera.fov / canvas.clientHeight;
    yaw = (yaw - (ev.clientX - prev.x) * k + 360) % 360;
    pitch = Math.max(-89, Math.min(89, pitch + (ev.clientY - prev.y) * k));
    dirty = true;
  };
  canvas.onpointerup = canvas.onpointercancel = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
  };
  canvas.onwheel = (ev) => {
    ev.preventDefault();
    zoomTo(camera.fov * 1.1 ** Math.sign(ev.deltaY));
  };
  const onKey = (ev) => {
    if (ev.target.closest?.('input, button, select')) return; // the time controls use the keys themselves
    const step = camera.fov / 12;
    if (ev.key === 'ArrowLeft') yaw = (yaw - step + 360) % 360;
    else if (ev.key === 'ArrowRight') yaw = (yaw + step) % 360;
    else if (ev.key === 'ArrowUp') pitch = Math.min(89, pitch + step);
    else if (ev.key === 'ArrowDown') pitch = Math.max(-89, pitch - step);
    else if (ev.key === '+' || ev.key === '=') return zoomTo(camera.fov / 1.25);
    else if (ev.key === '-') return zoomTo(camera.fov * 1.25);
    else return;
    dirty = true;
  };
  window.addEventListener('keydown', onKey);

  function resize() {
    const w = canvas.clientWidth; const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = skyCam.aspect = w / h;
    camera.updateProjectionMatrix();
    hud.width = w * devicePixelRatio; hud.height = 40 * devicePixelRatio;
    dirty = true;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  // compass strip along the top
  function drawHud() {
    const g = hud.getContext('2d');
    const w = hud.width; const h = hud.height; const s = devicePixelRatio;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, w, h);
    const v = new THREE.Vector3();
    const xOf = (az) => {
      v.set(Math.sin((az * Math.PI) / 180), 0, -Math.cos((az * Math.PI) / 180));
      const d = ((az - yaw + 540) % 360) - 180;
      if (Math.abs(d) > camera.fov * camera.aspect * 0.75) return null;
      // horizontal position from the camera's yaw only (the strip ignores pitch)
      const half = Math.tan((camera.fov * camera.aspect * Math.PI) / 360);
      const x = Math.tan((d * Math.PI) / 180) / half;
      return Math.abs(d) < 89 ? (x * 0.5 + 0.5) * w : null;
    };
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let az = 0; az < 360; az += 5) {
      const x = xOf(az); if (x === null) continue;
      const major = az % 45 === 0;
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = s;
      g.beginPath(); g.moveTo(x, h); g.lineTo(x, h - (major ? 10 : az % 15 === 0 ? 6 : 3) * s); g.stroke();
      if (major) { g.fillStyle = '#fff'; g.font = `${600} ${12 * s}px system-ui`; g.fillText(compass(az), x, 14 * s); }
      else if (az % 15 === 0) { g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `${10 * s}px system-ui`; g.fillText(String(az), x, 14 * s); }
    }
    if (sky) {
      for (const [dir, label, color] of [[sky.sun.dir, '☀', '#ffd27a'], [sky.earth.dir, '◐ Earth', '#9cc4ff']]) {
        const { az, el } = azEl(dir);
        if (el < -1) continue; // below the horizon
        const x = xOf(az); if (x === null) continue;
        g.fillStyle = color; g.font = `${600} ${11 * s}px system-ui`; g.fillText(label, x, 29 * s);
      }
    }
    g.fillStyle = '#ffb347'; g.beginPath(); g.moveTo(w / 2 - 5 * s, h); g.lineTo(w / 2 + 5 * s, h); g.lineTo(w / 2, h - 6 * s); g.fill();
  }

  // ---- render loop (draws only when something changed, or while playing)
  let last = performance.now();
  function frame(t) {
    if (closed) return;
    const dt = (t - last) / 1000; last = t;
    if (playing) { offsetH += playing * dt; updateSky(); }
    if (dirty && levels) {
      camera.rotation.set((pitch * Math.PI) / 180, (-yaw * Math.PI) / 180, 0);
      skyCam.rotation.copy(camera.rotation);
      skyCam.fov = camera.fov; skyCam.updateProjectionMatrix();
      renderer.clear();
      renderer.render(skyScene, skyCam);
      renderer.clearDepth();
      renderer.render(scene, camera);
      drawHud();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  resize();
  if (camera.aspect < 1) zoomTo(85); // portrait phones: wider view so there's more than a slit sideways
  requestAnimationFrame(frame);

  // ---- load terrain: coarse first, then the detailed rings as they arrive
  (async () => {
    status('Loading the Moon’s terrain…');
    const sources = { far: await loadFar() };
    if (closed) return;
    rebuild(sources);
    try {
      sources.near = await loadLola(lat, lon, LEVELS[1].half * 1.06, 1,
        (d, n) => status(`Loading detailed terrain around you… ${Math.round((100 * d) / n)}%`));
      if (closed) return;
      rebuild(sources);
      sources.mid = await loadLola(lat, lon, LEVELS[2].half * 1.03, 4,
        (d, n) => status(`Loading the surrounding landscape… ${Math.round((100 * d) / n)}%`));
      if (closed) return;
      rebuild(sources);
      status('');
    } catch (err) {
      console.error(err);
      if (!closed) status('Could not load the detailed terrain (NASA/USGS server unreachable); showing coarse terrain.');
    }
  })().catch((err) => {
    console.error(err);
    if (!closed) status('Could not load the terrain.');
  });

  return function close() {
    closed = true;
    clearTimeout(crossingTimer);
    window.removeEventListener('keydown', onKey);
    ro.disconnect();
    for (const m of meshes) m.geometry.dispose();
    rockGeos.forEach((g) => g.dispose());
    for (let i = 0; i < 4; i++) uniforms[`uH${i}`].value?.dispose();
    renderer.dispose();
  };
}
