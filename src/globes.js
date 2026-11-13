// Spinning 3D globes for the home page, drawn with three.js.
// Each globe wraps a flat (equirectangular) NASA map around a sphere.
import * as THREE from 'three';

const FOV = 30; // camera field of view, degrees
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const globes = [];
const textureLoads = [];
/** Resolves once every globe's map image has loaded (or failed). */
export const globesReady = () => Promise.allSettled(textureLoads);

/**
 * Turn `canvas` into a spinning globe.
 *   texture        - URL of the equirectangular map
 *   secondsPerTurn - time for one full rotation
 *   tiltDeg        - axial tilt, leaning the north pole to the right
 *   startLon       - longitude facing the viewer at the start
 *   viewFromDeg    - look from this many degrees above the equator, so a tilted pole shows
 * Returns false if the browser can't do WebGL (the caller keeps a fallback image).
 */
export function createGlobe(canvas, { texture, secondsPerTurn, tiltDeg = 0, startLon = 0, viewFromDeg = 0 }) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  // Camera distance at which a sphere of radius 1 exactly fills the view.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
  const distance = 1.005 / Math.sin(THREE.MathUtils.degToRad(FOV / 2));
  const elevation = THREE.MathUtils.degToRad(viewFromDeg);
  camera.position.set(0, distance * Math.sin(elevation), distance * Math.cos(elevation));
  camera.lookAt(0, 0, 0);

  // Sunlight from the upper left, plus a little fill so the night side isn't pitch black.
  const sun = new THREE.DirectionalLight(0xffffff, 3.2);
  sun.position.set(-3, 1.5, 2.5);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.25));

  let loaded;
  textureLoads.push(new Promise((resolve) => { loaded = resolve; }));
  const map = new THREE.TextureLoader().load(texture, loaded, undefined, loaded);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 64),
    // Lambert (plain matte) lighting: looks the same for a dusty planet as a rough
    // physically based material, but its shader compiles much faster at start-up.
    new THREE.MeshLambertMaterial({ map }),
  );
  const tilt = new THREE.Group();
  tilt.rotation.z = -THREE.MathUtils.degToRad(tiltDeg);
  tilt.add(sphere);
  scene.add(tilt);

  // three.js puts texture longitude -90° facing the camera; shift to startLon.
  const startAngle = -THREE.MathUtils.degToRad(startLon + 90);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (w && h) renderer.setSize(w, h, false);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  globes.push({ renderer, scene, camera, sphere, startAngle, secondsPerTurn, canvas });
  if (import.meta.env.DEV) window.globes = globes; // for debugging in the browser console
  if (globes.length === 1) requestAnimationFrame(tick);
  return true;
}

function tick(ms) {
  for (const g of globes) {
    if (!g.canvas.offsetParent) continue; // not on screen (e.g. a map is open)
    const turns = reduceMotion ? 0 : ms / 1000 / g.secondsPerTurn;
    g.sphere.rotation.y = g.startAngle + turns * 2 * Math.PI; // west to east, like the real planets
    g.renderer.render(g.scene, g.camera);
  }
  requestAnimationFrame(tick);
}
