import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { BODIES } from './bodies.js';
import { circlePoints, formatLatLon } from './geo.js';
import { createGlobe } from './globes.js';
import { drawStarfield } from './starfield.js';
import { VIEWS, loadIndex, createOverlay, legendHtml } from './overlays.js';
import { askWeights, parseWeights, formatWeights } from './weights.js';
import { addLandmarks } from './landmarks.js';
import moonTexture from './assets/moon-texture.jpg';
import marsTexture from './assets/mars-texture.jpg';

const home = document.getElementById('home');
const mapView = document.getElementById('map-view');
let map = null;

// Closest you can zoom: about this many km across the screen.
const MIN_VIEW_KM = 1;

// Radius choices (km) for the area you select on the Moon or Mars.
const RADIUS_OPTIONS_KM = [1, 5, 10, 25, 50, 100, 250];
const DEFAULT_RADIUS_KM = 10;

const $ = (id) => document.getElementById(id);

// On phones the zoom readout sits just above the selection panel; track its height.
new ResizeObserver(([entry]) => {
  mapView.style.setProperty('--panel-h', `${entry.target.offsetHeight}px`);
}).observe($('select-panel'));

// Starry sky behind the home page; repainted when the window size changes.
const stars = $('stars');
let starTimer = null;
new ResizeObserver(() => {
  clearTimeout(starTimer);
  starTimer = setTimeout(() => drawStarfield(stars), 150);
}).observe(stars);

// Spinning globes on the home page. The Moon turns 28x slower than Mars.
const MARS_SECONDS_PER_TURN = 30;
const GLOBES = {
  mars: { texture: marsTexture, secondsPerTurn: MARS_SECONDS_PER_TURN, tiltDeg: 25.2, startLon: -70, viewFromDeg: 20 },
  moon: { texture: moonTexture, secondsPerTurn: MARS_SECONDS_PER_TURN * 28, tiltDeg: 1.5, startLon: 0 },
};
for (const [key, opts] of Object.entries(GLOBES)) {
  const globe = document.querySelector(`.globe.${key}`);
  if (createGlobe(globe.querySelector('canvas'), opts)) globe.classList.add('is-3d');
}

document.querySelectorAll('.body-btn').forEach((btn) => {
  btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.body}`; });
});

document.getElementById('back').addEventListener('click', () => { location.hash = ''; });

// Leaflet's EPSG4326 maps 360° to 512 px at zoom 0; web mercator to 256 px.
const basePx = (body) => (body.crs === 'EPSG4326' ? 512 : 256);
const circumferenceKm = (body) => 2 * Math.PI * body.radiusKm;

// Zoom level at which the screen width spans MIN_VIEW_KM at the equator.
function maxZoomFor(body, size) {
  return Math.log2((size.x * circumferenceKm(body)) / (basePx(body) * MIN_VIEW_KM));
}

// Most zoomed-out level: the map just fills the whole screen, no black edges.
// (Equirectangular maps are twice as wide as tall; web mercator is square.)
function minZoomFor(body, size) {
  const w = basePx(body);
  const h = body.crs === 'EPSG4326' ? w / 2 : w;
  return Math.log2(Math.max(size.x / w, size.y / h));
}

// The edges of the map, so it can't repeat or be dragged off screen.
const MAP_BOUNDS = {
  EPSG3857: [[-85.0511, -180], [85.0511, 180]],
  EPSG4326: [[-90, -180], [90, 180]],
};

// Real-world width of the current view, measured along the centre latitude.
function viewWidthKm(body) {
  const b = map.getBounds();
  const degrees = Math.min(b.getEast() - b.getWest(), 360);
  return (degrees / 360) * circumferenceKm(body) * Math.cos((map.getCenter().lat * Math.PI) / 180);
}

function formatKm(km) {
  const m = Math.round(km * 1000);
  if (m < 1000) return `${m} m`;
  if (km >= 100) return `${Math.round(km).toLocaleString()} km`;
  return `${km.toFixed(1)} km`;
}

function openMap(key, params) {
  const body = BODIES[key];
  home.hidden = true;
  mapView.hidden = false;
  document.title = `${body.name} · Planet Maps`;

  const screen = { x: window.innerWidth, y: window.innerHeight };
  map = L.map('map', {
    crs: L.CRS[body.crs],
    center: [0, 0],
    zoom: minZoomFor(body, screen),
    minZoom: minZoomFor(body, screen),
    maxZoom: maxZoomFor(body, screen),
    zoomSnap: 0, // smooth zooming; the +/- buttons still step by 2x
    zoomDelta: 1,
    wheelPxPerZoomLevel: 120,
    maxBounds: MAP_BOUNDS[body.crs],
    maxBoundsViscosity: 1.0, // hard stop at the map edges
    zoomControl: false,
  });
  if (import.meta.env.DEV) window.map = map; // handy for debugging in the browser console
  L.control.zoom({ position: 'topright' }).addTo(map);
  body.layers.forEach((layer, i) => {
    // Each layer gets its own pane so it can have its own blend/filter.
    const pane = `layer${i}`;
    const el = map.createPane(pane);
    el.style.zIndex = 200 + i;
    if (layer.filter) el.style.filter = layer.filter;
    L.tileLayer(layer.url, {
      pane,
      attribution: layer.attribution,
      tileSize: layer.tileSize ?? 256,
      zoomOffset: layer.zoomOffset ?? 0,
      maxNativeZoom: layer.maxNativeZoom,
      minZoom: layer.minZoom ?? 0,
      maxZoom: 30,
      noWrap: true, // show the map once, never repeated side by side
      bounds: layer.bounds ?? MAP_BOUNDS[body.crs],
    }).addTo(map);
  });

  // Zoom readout in the bottom-left corner. ×1 = whole map filling the screen.
  const Readout = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'zoom-readout');
      const update = () => {
        const factor = Math.round(2 ** (map.getZoom() - map.getMinZoom()));
        el.innerHTML = `<strong>×${factor.toLocaleString()}</strong>` +
          `<span>${formatKm(viewWidthKm(body))} across</span>`;
      };
      map.on('zoom move resize', update);
      update();
      return el;
    },
  });
  new Readout({ position: 'bottomleft' }).addTo(map);

  map.on('resize', () => {
    const size = map.getSize();
    map.setMinZoom(minZoomFor(body, size));
    map.setMaxZoom(maxZoomFor(body, size));
  });

  if (body.selectable) setUpSelection(key, body, params);
  if (key === 'earth' && BODIES[params.get('from')]) showAnalogBanner(params);
}

// ---- Menu, views and area selection (Moon and Mars) -------------------------

function setUpSelection(key, body, params) {
  $('select-panel').hidden = false;
  $('menu-btn').hidden = false;
  let shapes = null;
  let current = null; // { lat, lon } of the selected point
  const r = parseFloat(params.get('r'));
  let radiusKm = RADIUS_OPTIONS_KM.includes(r) ? r : DEFAULT_RADIUS_KM;
  let view = VIEWS[params.get('view')] ? params.get('view') : null;
  let weights = parseWeights(params.get('w')); // last weights chosen for this site
  let available = {};                          // data layers for this body (from index.json)

  // Keep selection, radius and view in the address, without adding history
  // steps, so coming back to this page (e.g. from Earth) restores them.
  function query() {
    const q = new URLSearchParams();
    if (current) { q.set('lat', current.lat.toFixed(4)); q.set('lon', current.lon.toFixed(4)); }
    if (current || radiusKm !== DEFAULT_RADIUS_KM) q.set('r', radiusKm);
    if (view) q.set('view', view);
    if (Object.keys(weights).length) q.set('w', formatWeights(weights));
    return q.toString();
  }
  const saveToUrl = () => {
    const q = query();
    history.replaceState(null, '', `#/${key}${q ? `?${q}` : ''}`);
  };

  // ---- Menu drawer
  const menu = $('menu');
  const openMenu = (open) => {
    menu.hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', open);
  };
  $('menu-btn').onclick = () => openMenu(menu.hidden);
  $('menu-close').onclick = () => openMenu(false);
  map.on('keydown', (e) => { if (e.originalEvent.key === 'Escape') openMenu(false); });

  // ---- Views (coloured overlays)
  map.createPane('overlay').style.zIndex = 350; // above the imagery, below the selection
  let overlay = null;
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => L.DomUtil.create('div', 'legend');

  // ---- Landmarks (on/off remembered in this browser)
  const showLandmarks = addLandmarks(map, key);
  const toggle = $('landmarks-toggle');
  try { toggle.checked = localStorage.getItem('planet-maps:landmarks') !== 'off'; } catch { /* storage blocked */ }
  showLandmarks(toggle.checked);
  toggle.onchange = () => {
    showLandmarks(toggle.checked);
    try { localStorage.setItem('planet-maps:landmarks', toggle.checked ? 'on' : 'off'); } catch { /* ignore */ }
  };

  loadIndex().then((index) => {
    if (!map) return;
    available = index[key] ?? {};
    const options = [[null, { name: 'None', short: 'None', about: 'Just the imagery, no data layer.' }],
      ...Object.entries(VIEWS).filter(([v]) => available[v])
        .map(([v, info]) => [v, { ...info, about: available[v].about }])];
    const describe = () => {
      const info = options.find(([v]) => v === view)?.[1] ?? options[0][1];
      $('view-about').textContent = info.about;
    };
    $('view-options').replaceChildren(...options.map(([v, info]) => {
      const label = document.createElement('label');
      label.className = 'view-chip';
      label.title = `${info.name}: ${info.about}`;
      label.innerHTML = '<input type="radio" name="view"><span></span>';
      label.querySelector('span').textContent = info.short;
      const input = label.querySelector('input');
      input.checked = v === view;
      input.onchange = () => { view = v; showView(); describe(); saveToUrl(); };
      return label;
    }));
    describe();
    if (view && !available[view]) view = null;
    showView();
  });

  function showView() {
    if (overlay) { overlay.remove(); overlay = null; }
    legend.remove();
    if (!view) return;
    const meta = available[view];
    overlay = createOverlay(key, view, meta, 'overlay').addTo(map);
    legend.addTo(map);
    legend.getContainer().innerHTML = legendHtml(view, meta);
  }

  // ---- Selection
  // fit: 'always' (restoring a saved selection), 'if-hidden' (radius changed), or none (a click).
  function draw({ fit } = {}) {
    if (shapes) shapes.remove();
    const ring = circlePoints(current.lat, current.lon, radiusKm, body.radiusKm);
    shapes = L.layerGroup([
      L.polygon(ring, { className: 'selection-area', interactive: false }),
      L.circleMarker([current.lat, current.lon], { className: 'selection-centre', radius: 4, interactive: false }),
    ]).addTo(map);
    $('select-radius').textContent = `${radiusKm} km radius · click elsewhere to move it`;
    const bounds = L.latLngBounds(ring);
    if (fit === 'always' || (fit === 'if-hidden' && !map.getBounds().contains(bounds))) {
      map.fitBounds(bounds, { padding: [80, 80] });
    }
  }

  function select(lat, lon, opts) {
    current = { lat, lon };
    $('select-hint').hidden = true;
    $('select-info').hidden = false;
    $('select-coords').textContent = formatLatLon(lat, lon);
    $('toast').hidden = true;
    draw(opts);
    saveToUrl();
  }

  function clear() {
    if (shapes) shapes.remove();
    shapes = null;
    current = null;
    $('select-hint').hidden = false;
    $('select-info').hidden = true;
    saveToUrl();
  }

  // Radius buttons (in the menu)
  const chips = $('radius-options');
  chips.replaceChildren(...RADIUS_OPTIONS_KM.map((km) => {
    const btn = document.createElement('button');
    btn.textContent = `${km} km`;
    btn.setAttribute('role', 'radio');
    btn.onclick = () => {
      radiusKm = km;
      markChosen();
      if (current) draw({ fit: 'if-hidden' });
      saveToUrl();
    };
    return btn;
  }));
  const markChosen = () => [...chips.children].forEach((btn, i) =>
    btn.setAttribute('aria-checked', RADIUS_OPTIONS_KM[i] === radiusKm));
  markChosen();

  map.on('click', (e) => select(e.latlng.lat, e.latlng.lng));
  $('clear-selection').onclick = clear;

  // Both searches first ask how much each characteristic should count.
  async function chooseWeights(action) {
    const layers = Object.keys(VIEWS).filter((v) => available[v]);
    const chosen = await askWeights({
      heading: action === 'analogs' ? 'Find Earth analogs' : `Find similar spots on ${body.name}`,
      subheading: `${body.name} · ${formatLatLon(current.lat, current.lon)} · ${radiusKm} km radius`,
      action: action === 'analogs' ? 'Find Earth analogs →' : 'Find similar spots →',
      layers,
      initial: weights,
    });
    if (!chosen) return false;
    weights = chosen;
    saveToUrl();
    return true;
  }
  $('find-analogs').onclick = async () => {
    if (await chooseWeights('analogs')) location.hash = `#/earth?from=${key}&${query()}`;
  };
  $('find-similar').onclick = async () => {
    if (await chooseWeights('similar')) $('toast').hidden = false; // search not built yet
  };

  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) select(lat, lon, { fit: 'always' });
}

// ---- Earth page opened from "Find Earth analogs" -----------------------------

function showAnalogBanner(params) {
  const from = params.get('from');
  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  const r = parseFloat(params.get('r')) || DEFAULT_RADIUS_KM;
  $('analog-source').textContent = `${BODIES[from].name} · ${formatLatLon(lat, lon)}`;
  $('analog-radius').textContent = `Area: ${r} km radius`;
  const w = Object.entries(parseWeights(params.get('w'))).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = w.reduce((a, [, v]) => a + v, 0);
  $('analog-weights').textContent = w.length
    ? `Weights: ${w.map(([k, v]) => `${VIEWS[k].name} ${Math.round((v / total) * 100)}%`).join(' · ')}`
    : '';
  $('back-to-site').onclick = () => {
    const back = new URLSearchParams(params);
    back.delete('from');
    location.hash = `#/${from}?${back}`;
  };
  $('analog-banner').hidden = false;
}

function hidePanels() {
  for (const id of ['select-panel', 'analog-banner', 'menu', 'menu-btn']) $(id).hidden = true;
  $('menu-btn').setAttribute('aria-expanded', false);
  $('select-hint').hidden = false;
  $('select-info').hidden = true;
}

function showHome() {
  mapView.hidden = true;
  home.hidden = false;
  document.title = 'Planet Maps';
}

// The URL hash decides the page, so the browser's back button works:
//   #/mars                          Mars map
//   #/mars?lat=18.44&lon=77.45&r=10       Mars map with a 10 km-radius area selected
//   #/mars?view=slope                     Mars map showing the slope overlay
//   #/earth?from=mars&lat=..&lon=..&r=..  Earth map, looking for analogs of that area
function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (map) { map.remove(); map = null; }
  hidePanels();
  if (BODIES[path]) openMap(path, new URLSearchParams(query)); else showHome();
}

window.addEventListener('hashchange', route);
route();
