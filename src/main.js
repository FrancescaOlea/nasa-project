import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { BODIES } from './bodies.js';
import { circlePoints, formatLatLon } from './geo.js';
import { createGlobe, globesReady } from './globes.js';
import { drawStarfield } from './starfield.js';
import { VIEWS, loadIndex, createOverlay, legendHtml, colourPos, gradientCss, retryFailedTiles } from './overlays.js';
import { summarize } from './areastats.js';
import { askWeights, parseWeights, formatWeights } from './weights.js';
import { PARAMS, WEIGHT_STEPS, DEFAULT_WEIGHTS, DEFAULT_COUNT, MAX_COUNT, MIN_SEPARATION_KM, parseAnalogWeights, siteValues, findAnalogs, displayValue,
  similarity } from './analogs.js';
import { addLandmarks } from './landmarks.js';
import { createRoutePlanner, routeEvents } from './route/planner.js';
import { createView3D } from './terrain3d/view3d.js';

let view3d = null; // the 3D terrain view, made the first time it's opened
import { projection, PROJECTIONS } from './projections.js';
import { WarpedImagery, sourceGrid } from './reproject.js';
import moonTexture from './assets/moon-texture.jpg';
import iconEarth from './assets/icon-earth.png';
import moonPhoto from './assets/moon.png';
import marsPhoto from './assets/mars.png';
import iconMoon from './assets/icon-moon.png';
import iconMars from './assets/icon-mars.png';
import marsTexture from './assets/mars-texture.jpg';

const home = document.getElementById('home');
const mapView = document.getElementById('map-view');
let map = null;

// Closest you can zoom: about this many km across the screen.
const MIN_VIEW_KM = 1;

// Radius of the area you select (km): a slider from 1 to 250 km. It's logarithmic, so the
// small sizes get as much room as the big ones (the middle of the slider is ~16 km).
const MIN_RADIUS_KM = 1;
const MAX_RADIUS_KM = 250;
const DEFAULT_RADIUS_KM = 10;
const SLIDER_STEPS = 1000;
const sliderToKm = (v) => Math.round(MIN_RADIUS_KM * (MAX_RADIUS_KM / MIN_RADIUS_KM) ** (v / SLIDER_STEPS));
const kmToSlider = (km) => Math.round((Math.log(km / MIN_RADIUS_KM) / Math.log(MAX_RADIUS_KM / MIN_RADIUS_KM)) * SLIDER_STEPS);
const validRadius = (km) => Number.isFinite(km) && km >= MIN_RADIUS_KM && km <= MAX_RADIUS_KM;

const $ = (id) => document.getElementById(id);

// On phones the zoom readout sits just above the selection panel; track its height.
new ResizeObserver(([entry]) => {
  mapView.style.setProperty('--panel-h', `${entry.target.offsetHeight}px`);
}).observe($('select-panel'));

// Starry sky behind the home page; repainted when the window size changes.
const stars = $('stars');
let starTimer = null;
let starsPainted = false;
new ResizeObserver(() => {
  clearTimeout(starTimer);
  if (!starsPainted) { starsPainted = true; drawStarfield(stars); return; } // first paint: right away
  starTimer = setTimeout(() => drawStarfield(stars), 150);              // resizes: wait until settled
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
  else globe.querySelector('img').src = { moon: moonPhoto, mars: marsPhoto }[key]; // no 3D: photo instead
}

document.querySelectorAll('.body-btn').forEach((btn) => {
  btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.body}`; });
});

document.getElementById('back').addEventListener('click', () => { location.hash = ''; });

const circumferenceKm = (body) => 2 * Math.PI * body.radiusKm;
// Each body's own projection: the one its map tiles are made in.
const nativeProjection = (body) => (body.crs === 'EPSG3857' ? 'mercator' : 'equirect');
let proj = projection('equirect'); // projection of the map currently shown
let keepViewPanelOpen = false;     // reopen the View panel after switching projection

// Zoom level at which the screen width spans MIN_VIEW_KM.
function maxZoomFor(body, size) {
  return Math.log2((size.x * proj.kmPerPxAtZoom0(body.radiusKm)) / MIN_VIEW_KM);
}

// The edges of the map, so it can't repeat or be dragged off screen (native layers).
const MAP_BOUNDS = {
  EPSG3857: [[-85.0511, -180], [85.0511, 180]],
  EPSG4326: [[-90, -180], [90, 180]],
};

function haversineKm(R, a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2
    + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Real-world width of the current view.
function viewWidthKm(body) {
  if (proj.cylindrical) { // measured along the centre latitude
    const b = map.getBounds();
    const degrees = Math.min(b.getEast() - b.getWest(), 360);
    return (degrees / 360) * circumferenceKm(body) * Math.cos((map.getCenter().lat * Math.PI) / 180);
  }
  // polar (azimuthal equidistant): true scale along lines from the pole, so the
  // screen's width in km is simply its width in map pixels
  return (map.getSize().x * proj.kmPerPxAtZoom0(body.radiusKm)) / 2 ** map.getZoom();
}

// A characteristic's value with sensible precision for its unit.
function formatValue(meta, v, withUnit = true) {
  const u = meta.unit;
  let text;
  if (u === 'km') text = v.toFixed(Math.abs(v) < 10 ? 2 : 1);
  else if (u === '°C' || u === 'TIU') text = String(Math.round(v));
  else if (u === '°' || u === '%') text = v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : String(Math.round(v));
  else text = v.toPrecision(3);
  text = text.replace('-', '−');
  if (!withUnit) return text;
  return u === '°' || u === '%' ? `${text}${u}` : `${text} ${u}`;
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

  // Projection: the body's own unless another one is chosen (?proj=...)
  const native = nativeProjection(body);
  proj = projection(PROJECTIONS[params.get('proj')] ? params.get('proj') : native);

  const screen = { x: window.innerWidth, y: window.innerHeight };
  map = L.map('map', {
    crs: proj.crs,
    center: proj.center,
    zoom: proj.minZoom(screen),
    minZoom: proj.minZoom(screen),
    maxZoom: maxZoomFor(body, screen),
    zoomSnap: 0, // smooth zooming; the +/- buttons still step by 2x
    zoomDelta: 1,
    wheelPxPerZoomLevel: 120,
    maxBounds: proj.bounds ?? undefined,
    maxBoundsViscosity: 1.0, // hard stop at the map edges
    zoomControl: false,
  });
  if (import.meta.env.DEV) window.map = map; // handy for debugging in the browser console
  // Zoom buttons: a see-through horizontal bar at the top centre of the map
  map.attributionControl.setPrefix(false); // no 'Leaflet' link; the data credits stay
  const zoom = L.control.zoom({ position: 'topright' }).addTo(map);
  const zoomEl = zoom.getContainer();
  zoomEl.classList.add('zoom-bar');
  map.getContainer().appendChild(zoomEl); // out of Leaflet's corner, positioned by CSS
  body.layers.forEach((layer, i) => {
    // Each layer gets its own pane so it can have its own blend/filter.
    const pane = `layer${i}`;
    const el = map.createPane(pane);
    el.style.zIndex = 200 + i;
    if (layer.filter) el.style.filter = layer.filter;
    if (proj.id === native) {
      retryFailedTiles(L.tileLayer(layer.url, {
        pane,
        attribution: layer.attribution,
        tileSize: layer.tileSize ?? 256,
        zoomOffset: layer.zoomOffset ?? 0,
        maxNativeZoom: layer.maxNativeZoom,
        minZoom: layer.minZoom ?? 0,
        maxZoom: 30,
        noWrap: true, // show the map once, never repeated side by side
        bounds: layer.bounds ?? MAP_BOUNDS[body.crs],
      })).addTo(map);
      return;
    }
    // Another projection: same source tiles, warped in the browser.
    const nativePx = native === 'equirect' ? 512 : 256; // world width at zoom 0
    new WarpedImagery({
      pane,
      attribution: layer.attribution,
      proj,
      radiusKm: body.radiusKm,
      // layers that only appear when zoomed in (e.g. Mars CTX): same level of detail
      maxKmPerPx: layer.minZoom ? circumferenceKm(body) / (nativePx * 2 ** layer.minZoom) : undefined,
      src: sourceGrid({
        kind: native,
        url: layer.url,
        tileSize: layer.tileSize ?? 256,
        maxLevel: layer.maxNativeZoom + (layer.zoomOffset ?? 0),
        bounds: layer.bounds,
      }),
      maxZoom: 30,
      noWrap: true,
    }).addTo(map);
  });

  // Polar maps: keep the square map on screen (Leaflet's maxBounds works in lat/lon)
  if (!proj.bounds) {
    map.on('moveend', () => {
      const z = map.getZoom();
      const world = 256 * 2 ** z;
      const half = map.getSize().divideBy(2);
      const c = map.project(map.getCenter(), z);
      const clamp = (v, h) => (world <= 2 * h ? world / 2 : Math.min(Math.max(v, h), world - h));
      const x = clamp(c.x, half.x);
      const y = clamp(c.y, half.y);
      if (Math.abs(x - c.x) > 0.5 || Math.abs(y - c.y) > 0.5) map.panTo(map.unproject([x, y], z), { animate: false });
    });
  }

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
    map.setMinZoom(proj.minZoom(size));
    map.setMaxZoom(maxZoomFor(body, size));
  });

  const analog = key === 'earth' && params.has('site');
  const selection = body.selectable ? setUpSelection(key, body, params, { analog }) : null;
  if (analog) showAnalogResults(params, selection);
  setUpWorldSwitch(key, params);
}

// ---- Menu, views and area selection (Moon and Mars) -------------------------

function setUpSelection(key, body, params, { analog = false } = {}) {
  // During an analog search the results replace the selection panel, and clicking the
  // map doesn't select anything until 'Exit results'.
  $('select-panel').hidden = analog;
  $('menu-btn').hidden = false;
  let shapes = null;
  let current = null; // { lat, lon } of the selected point
  const r = parseFloat(params.get('r'));
  let radiusKm = validRadius(r) ? Math.round(r) : DEFAULT_RADIUS_KM;
  let view = VIEWS[params.get('view')] ? params.get('view') : null;
  if (analog) radiusKm = parseFloat(params.get('sr')) || DEFAULT_RADIUS_KM; // results use the site's radius
  let weights = parseWeights(params.get('w'));            // last weights for 'Find similar spots'
  let analogWeights = parseAnalogWeights(params.get('aw')); // ... and for 'Find Earth analogs'
  let analogMode = params.get('am') === 'extreme' ? 'extreme' : 'match';
  let analogCount = parseCount(params.get('an'));
  let available = {};                          // data layers for this body (from index.json)
  let planner = null;                          // Mars route planner (src/route/), when open
  let describe = () => {};
  function selectView(v) {
    view = v;
    showView();
    describe();
    saveToUrl();
    document.querySelectorAll('#view-options input').forEach((input, i) => {
      input.checked = (i === 0 && !v) || input.dataset.view === v;
    });
  }

  // Keep selection, radius and view in the address, without adding history
  // steps, so coming back to this page (e.g. from Earth) restores them.
  // Earth keeps where it was opened from (and an analog search's site) in its address
  const keep = key === 'earth' ? ['from', 'site', 'sr', 'w', 'mode', 'n'].filter((k) => params.has(k)) : [];
  function query() {
    const q = new URLSearchParams();
    for (const k of keep) q.set(k, params.get(k));
    if (current) { q.set('lat', current.lat.toFixed(4)); q.set('lon', current.lon.toFixed(4)); }
    if (current || radiusKm !== DEFAULT_RADIUS_KM) q.set('r', radiusKm);
    if (view) q.set('view', view);
    if (proj.id !== nativeProjection(body)) q.set('proj', proj.id);
    planner?.query(q);
    if (key !== 'earth' && Object.keys(weights).length) q.set('w', formatWeights(weights));
    if (key !== 'earth' && Object.keys(analogWeights).length) {
      q.set('aw', formatWeights(analogWeights));
      q.set('am', analogMode);
      q.set('an', analogCount);
    }
    return q.toString();
  }
  const saveToUrl = () => {
    const q = query();
    history.replaceState(null, '', `#/${key}${q ? `?${q}` : ''}`);
    if (key !== 'earth') lastPage[key] = location.hash; // so 'Back to Mars view' restores it
  };
  saveToUrl();
  // No analog search from Earth itself
  document.querySelector('#select-info .actions').hidden = key === 'earth';

  // ---- Menu drawer
  const menu = $('menu');
  const openMenu = (open) => {
    menu.hidden = !open;
    $('menu-btn').setAttribute('aria-expanded', open);
  };
  $('menu-btn').onclick = () => openMenu(menu.hidden);
  if (keepViewPanelOpen) { openMenu(true); keepViewPanelOpen = false; }
  $('menu-close').onclick = () => openMenu(false);
  map.on('keydown', (e) => { if (e.originalEvent.key === 'Escape') openMenu(false); });

  // ---- Projection buttons (top of the View panel): rebuild the map in another projection
  $('proj-options').replaceChildren(...Object.entries(PROJECTIONS).map(([id, info]) => {
    const label = document.createElement('label');
    label.className = 'view-chip';
    label.title = info.name;
    label.innerHTML = '<input type="radio" name="proj"><span></span>';
    label.querySelector('span').textContent = info.short;
    const input = label.querySelector('input');
    input.checked = id === proj.id;
    input.onchange = () => {
      proj = projection(id);
      saveToUrl();
      keepViewPanelOpen = true; // so projections can be tried one after another
      route(); // same body, selection and view - new projection
    };
    return label;
  }));

  // ---- Views (coloured overlays)
  map.createPane('overlay').style.zIndex = 350; // above the imagery, below the selection
  let overlay = null;
  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => L.DomUtil.create('div', 'legend');

  // ---- Map settings panel (bottom left): landmarks on/off
  const settings = L.control({ position: 'bottomleft' });
  settings.onAdd = () => {
    const el = L.DomUtil.create('div', 'map-settings');
    el.innerHTML = `
      <label class="switch-row">
        <input id="landmarks-toggle" type="checkbox" checked>
        <span class="switch" aria-hidden="true"></span>
        <span>Landmarks</span>
      </label>`;
    L.DomEvent.disableClickPropagation(el); // clicks here shouldn't select a spot on the map
    L.DomEvent.disableScrollPropagation(el);
    return el;
  };
  settings.addTo(map);

  // Landmarks: on whenever a map opens; the switch only hides them on this map
  const showLandmarks = addLandmarks(map, key);
  const toggle = $('landmarks-toggle');
  toggle.checked = true;
  showLandmarks(true);
  toggle.onchange = () => showLandmarks(toggle.checked);

  loadIndex().then((index) => {
    if (!map) return;
    available = index[key] ?? {};
    const options = [[null, { name: 'None', short: 'None', about: 'Just the imagery, no data layer.' }],
      ...Object.entries(VIEWS).filter(([v]) => available[v])
        .map(([v, info]) => [v, { ...info, about: available[v].about }])];
    describe = () => {
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
      input.dataset.view = v ?? '';
      input.checked = v === view;
      input.onchange = () => selectView(v);
      return label;
    }));
    describe();
    if (view && !available[view]) view = null;
    showView();
    updateSummary();
  });

  function showView() {
    document.querySelectorAll('.area-row').forEach((row, i) => {
      row.classList.toggle('active', Object.keys(VIEWS).filter((v) => available[v])[i] === view);
    });
    if (overlay) { overlay.remove(); overlay = null; }
    legend.remove();
    if (!view) return;
    const meta = available[view];
    overlay = createOverlay(key, view, meta, 'overlay', proj).addTo(map);
    legend.addTo(map);
    legend.getContainer().innerHTML = legendHtml(view, meta);
  }

  // ---- Area summary: typical value of every characteristic over the circle
  let summaryToken = 0;
  async function updateSummary() {
    const panel = $('area-panel');
    if (!current || !Object.keys(available).length) { panel.hidden = true; return; }
    panel.hidden = false;
    $('area-sub').textContent = `${formatLatLon(current.lat, current.lon)} · ${radiusKm} km radius`;
    const token = ++summaryToken;
    const layers = Object.keys(VIEWS).filter((v) => available[v]);
    const rows = layers.map((v) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'area-row';
      row.innerHTML = '<span class="swatch"></span><span class="a-name"></span><span class="a-val">…</span><span class="a-range"></span>';
      row.querySelector('.a-name').textContent = VIEWS[v].name;
      row.title = `Show ${VIEWS[v].name} on the map`;
      row.onclick = () => selectView(v);
      row.classList.toggle('active', v === view);
      return row;
    });
    $('area-rows').replaceChildren(...rows);
    const { lat, lon } = current;
    await Promise.all(layers.map(async (v, i) => {
      const meta = available[v];
      const res = await summarize(key, v, meta, lat, lon, radiusKm, body.radiusKm);
      if (token !== summaryToken) return; // a newer selection has started
      const row = rows[i];
      if (res.none) {
        row.querySelector('.a-val').textContent = 'no data here';
        row.classList.add('none');
        return;
      }
      row.querySelector('.a-val').textContent = formatValue(meta, res.median);
      const lo = formatValue(meta, res.p10, false);
      const hi = formatValue(meta, res.p90, false);
      const spread = lo === hi ? 'uniform' : `${lo} – ${formatValue(meta, res.p90)}`;
      const regional = meta.pixel_km > 2 * radiusKm ? ` · regional value (~${Math.round(meta.pixel_km)} km data)` : '';
      row.querySelector('.a-range').textContent = `range ${spread}${regional}`;
      const t = colourPos(meta, res.median);
      row.querySelector('.swatch').style.background = gradientCss(meta);
      row.querySelector('.swatch').style.backgroundSize = '2000% 100%';
      row.querySelector('.swatch').style.backgroundPosition = `${t * 100}% 0`;
    }));
  }
  const setCollapsed = (collapsed) => {
    $('area-panel').classList.toggle('collapsed', collapsed);
    $('area-collapse').setAttribute('aria-expanded', !collapsed);
    $('area-collapse').setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} area summary`);
    $('area-collapse').innerHTML = collapsed ? '&plus;' : '&minus;';
  };
  setCollapsed(window.innerWidth < 600); // phones: start as a single bar, tap to open
  $('area-collapse').onclick = () => setCollapsed(!$('area-panel').classList.contains('collapsed'));

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
    updateSummary();
  }

  function clear() {
    if (shapes) shapes.remove();
    shapes = null;
    current = null;
    $('select-hint').hidden = false;
    $('select-info').hidden = true;
    saveToUrl();
    updateSummary();
  }

  // Radius slider (in the selection panel, bottom right). While dragging, the circle follows;
  // the area summary is recalculated once the slider stops moving.
  const slider = $('radius-slider');
  const showRadius = () => {
    $('radius-value').textContent = `${radiusKm} km`;
    slider.setAttribute('aria-valuetext', `${radiusKm} km`);
  };
  slider.value = kmToSlider(radiusKm);
  $('radius-slider').parentElement.querySelector('.radius-ticks').replaceChildren(...[1, 5, 25, 100, 250].map((km) => {
    const t = document.createElement('span');
    t.textContent = km;
    t.style.left = `${(kmToSlider(km) / SLIDER_STEPS) * 100}%`;
    return t;
  }));
  showRadius();
  let summaryTimer = null;
  slider.oninput = () => {
    const km = sliderToKm(Number(slider.value));
    if (km === radiusKm) return;
    radiusKm = km;
    showRadius();
    if (current) draw();
    clearTimeout(summaryTimer);
    summaryTimer = setTimeout(() => { saveToUrl(); updateSummary(); }, 250);
  };
  slider.onchange = () => {
    if (current) draw({ fit: 'if-hidden' });
    clearTimeout(summaryTimer);
    saveToUrl();
    updateSummary();
  };

  map.on('click', (e) => {
    if (analog) return; // paused while analog results are shown
    if (planner?.isOpen()) { planner.click(e.latlng); return; } // route planner picks A and B
    // polar maps: ignore clicks in the empty corners outside the world disc
    if (proj.inside) {
      const n = 256 * 2 ** map.getZoom();
      const raw = map.containerPointToLayerPoint(e.containerPoint).add(map.getPixelOrigin());
      if (!proj.inside(raw.x / n, raw.y / n)) return;
    }
    select(e.latlng.lat, e.latlng.lng);
  });
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
    const chosen = await askWeights({
      heading: 'Find Earth analogs',
      subheading: `${body.name} · ${formatLatLon(current.lat, current.lon)} · ${radiusKm} km radius`,
      action: 'Find Earth analogs →',
      items: Object.entries(PARAMS).map(([k, p]) => ({ key: k, name: p.name, help: p.help })),
      steps: WEIGHT_STEPS,
      initial: { ...DEFAULT_WEIGHTS, ...analogWeights },
      defaults: DEFAULT_WEIGHTS,
      count: { value: analogCount, default: DEFAULT_COUNT, min: 1, max: MAX_COUNT },
      mode: {
        value: analogMode,
        default: 'match',
        options: [
          ['match', 'Match my site', `Places whose temperatures are closest to this site's. Where ${body.name} is ` +
            'beyond anything on Earth, places that are as cold (or warm) for Earth as this site is for ' +
            `${body.name}.`],
          ['extreme', 'Most extreme', 'The most extreme places on Earth in the direction of this site: coldest, ' +
            'hottest or biggest day–night swing.'],
        ],
      },
    });
    if (!chosen) return;
    analogMode = chosen.mode;
    analogCount = chosen.count;
    delete chosen.mode;
    delete chosen.count;
    analogWeights = chosen;
    saveToUrl();
    const site = new URLSearchParams({ from: key, site: `${current.lat.toFixed(4)},${current.lon.toFixed(4)}`,
      sr: radiusKm, w: formatWeights(analogWeights), mode: analogMode, n: analogCount });
    location.hash = `#/earth?${site}`;
  };
  $('find-similar').onclick = async () => {
    if (await chooseWeights('similar')) $('toast').hidden = false; // search not built yet
  };

  // ---- Route planner (Mars only): A to B, with the dangers on the way
  $('plan-route').hidden = key !== 'mars';
  if (key === 'mars') {
    const showRoutePanels = (open) => {
      $('select-panel').hidden = open;
      if (open) $('area-panel').hidden = true; else updateSummary();
    };
    planner = createRoutePlanner(map, params, () => { showRoutePanels(planner?.isOpen() ?? true); saveToUrl(); });
    $('plan-route').onclick = () => { if (shapes) clear(); planner.open(); };
    // 3D terrain: opens on the route (if any) or on the area the 2D map shows
    const btn3d = $('btn-3d');
    btn3d.hidden = false;
    const set3dButton = (on) => {
      btn3d.setAttribute('aria-pressed', on);
      btn3d.textContent = on ? '🗺 2D map' : '⛰ 3D terrain';
    };
    set3dButton(false);
    btn3d.onclick = () => {
      view3d ??= createView3D({ routeEvents });
      if (view3d.isOpen()) { view3d.close(); return; }
      if (shapes) clear();
      set3dButton(true);
      view3d.open({
        planner,
        onClose: () => set3dButton(false),
        getLeafletView: () => {
          const c = map.getCenter();
          const b = map.getBounds();
          const wKm = viewWidthKm(body);
          const hKm = Math.min(180, b.getNorth() - b.getSouth()) * (Math.PI / 180) * body.radiusKm;
          return { lat: c.lat, lon: c.lng, wKm, hKm };
        },
      });
    };
  }

  const lat = parseFloat(params.get('lat'));
  const lon = parseFloat(params.get('lon'));
  if (Number.isFinite(lat) && Number.isFinite(lon)) select(lat, lon, { fit: analog ? undefined : 'always' });
  return { select, clear, current: () => current, saveToUrl };
}

// ---- Earth page opened from "Find Earth analogs": the search and its results ---------

// number of places to find, from the address; 1-10, default 3
function parseCount(text) {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : DEFAULT_COUNT;
}

// Padding for fitting something into the part of the map not covered by panels: the
// results panel (left on wide screens, bottom on phones), the area summary (top right),
// the top buttons and the bottom-left map controls.
function freeScreenPadding() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const box = (id) => { const el = $(id); return el && !el.hidden ? el.getBoundingClientRect() : null; };
  const left = box('analog-banner');
  const summary = box('area-panel');
  const gap = 24;
  let pl = gap; let pr = gap; let pt = 70 + gap; let pb = gap;
  if (W > 600) {
    if (left) pl = Math.max(pl, left.right + gap);
    if (summary) pr = Math.max(pr, W - summary.left + gap);
  } else {
    if (left) pb = Math.max(pb, H - left.top + gap);
    if (summary) pt = Math.max(pt, summary.bottom + gap);
  }
  // always leave room for the area itself: a third of the width, and at least 160 px of height
  pl = Math.min(pl, W / 3); pr = Math.min(pr, W / 3);
  if (H - pt - pb < 160) pb = Math.max(gap, H - pt - 160);
  return { paddingTopLeft: [pl, pt], paddingBottomRight: [pr, pb] };
}

function showAnalogResults(params, selection) {
  const from = BODIES[params.get('from')] ? params.get('from') : 'mars';
  const source = BODIES[from];
  const [lat, lon] = (params.get('site') ?? '').split(',').map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const r = parseFloat(params.get('sr')) || DEFAULT_RADIUS_KM;
  const weights = parseAnalogWeights(params.get('w'));
  if (!Object.values(weights).some((v) => v > 0)) Object.assign(weights, DEFAULT_WEIGHTS);
  const mode = params.get('mode') === 'extreme' ? 'extreme' : 'match';
  const count = parseCount(params.get('n'));

  $('analog-source').textContent = `${source.name} · ${formatLatLon(lat, lon)}`;
  $('analog-radius').textContent = `${r} km radius · ${mode === 'extreme' ? 'most extreme' : 'match my site'}`;
  const w = Object.entries(weights).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const total = w.reduce((a, [, v]) => a + v, 0);
  $('analog-weights').textContent = `Weights: ${w.map(([k, v]) => `${PARAMS[k].name} ${Math.round((v / total) * 100)}%`).join(' · ')}`;
  $('back-to-site').onclick = () => {
    location.hash = lastPage[from] ?? `#/${from}?lat=${lat}&lon=${lon}&r=${r}`;
  };
  $('exit-results').onclick = () => {
    // back to the plain Earth map (same view and projection); selecting works again
    const q = new URLSearchParams({ from });
    const cur = new URLSearchParams(location.hash.split('?')[1] ?? '');
    for (const k of ['view', 'proj']) if (cur.has(k)) q.set(k, cur.get(k));
    location.hash = `#/earth?${q}`;
  };
  $('analog-results').replaceChildren();
  $('analog-compare').hidden = true;
  $('analog-status').textContent = 'Searching every land area on Earth…';
  $('analog-banner').hidden = false;

  const thisMap = map;
  (async () => {
    const index = await loadIndex();
    const site = await siteValues(from, source.radiusKm, index[from] ?? {}, lat, lon, r);
    const t0 = performance.now();
    const found = await findAnalogs({ site, weights, mode, radiusKm: r, count });
    if (map !== thisMap) return; // the page has changed meanwhile
    if (import.meta.env.DEV) console.log(`analog search: ${Math.round(performance.now() - t0)} ms`, found, site);
    showResults(found, site);
  })().catch((err) => {
    console.error(err);
    $('analog-status').textContent = 'The search failed to load its data.';
  });

  function showResults({ results, used, relative, targets }, site) {
    const skipped = Object.keys(weights).filter((k) => weights[k] > 0 && !used.includes(k));
    $('analog-status').textContent = results.length
      ? (results.length === 1 ? 'Best area.' : `Best ${results.length} areas, at least ${MIN_SEPARATION_KM} km apart.`) +
        (skipped.length ? ` No ${source.name} data here for: ${skipped.map((k) => PARAMS[k].name).join(', ')}.` : '')
      : 'No matching areas found.';
    const group = L.layerGroup().addTo(map);
    const markers = [];
    const buttons = results.map((res, i) => {
      L.polygon(circlePoints(res.lat, res.lon, r, BODIES.earth.radiusKm), { className: 'analog-area', interactive: false })
        .addTo(group);
      const m = L.marker([res.lat, res.lon], {
        icon: L.divIcon({ className: '', html: `<span class="analog-marker">${i + 1}</span>`, iconSize: [26, 26] }),
        keyboard: false, title: `Analog ${i + 1}`,
      }).addTo(group);
      m.on('click', () => pick(i));
      markers.push(m);
      const li = document.createElement('li');
      li.innerHTML = '<button type="button" aria-pressed="false"><span class="num"></span><span class="where"></span><span class="sim"></span></button>';
      li.querySelector('.num').textContent = i + 1;
      li.querySelector('.where').textContent = formatLatLon(res.lat, res.lon);
      li.querySelector('.sim').textContent = `${similarity(res.score)}% match`;
      li.querySelector('button').onclick = () => pick(i);
      return li;
    });
    $('analog-results').replaceChildren(...buttons);

    // Selecting a result (in the list or on the map) zooms so its area fills the part of
    // the screen that the panels leave free.
    function pick(i) {
      const res = results[i];
      buttons.forEach((li, j) => li.querySelector('button').setAttribute('aria-pressed', i === j));
      markers.forEach((m, j) => m.getElement()?.firstChild?.classList.toggle('picked', i === j));
      selection?.select(res.lat, res.lon);
      const area = L.latLngBounds(circlePoints(res.lat, res.lon, r, BODIES.earth.radiusKm));
      map.flyToBounds(area, { ...freeScreenPadding(), duration: 0.9, maxZoom: map.getMaxZoom() });
      showComparison(i, res, site, relative, targets);
    }
  }

  function showComparison(i, res, site, relative = {}, targets = {}) {
    const fmt = (k, v) => {
      const d = displayValue(k, v);
      if (!Number.isFinite(d)) return '–';
      const p = PARAMS[k];
      const digits = Math.abs(d) >= 100 || p.unit === '°C' || p.unit === 'm' ? 0 : Math.abs(d) >= 10 ? 1 : 2;
      return `${d.toFixed(digits)}${p.unit === '°C' || p.unit === '°' ? p.unit : ` ${p.unit}`}`;
    };
    const rows = Object.keys(res.values).map((k) => {
      const p = PARAMS[k];
      let siteCell = p.site ? fmt(k, site[k]) : `<span class="note">${p.better === 'low' ? 'lower wins' : 'higher wins'}</span>`;
      if (k in relative) {
        // beyond Earth's range: matched to the same percentile of Earth
        const pct = Math.round(relative[k] * 100);
        siteCell += `<br><span class="note" title="${pct}% of ${source.name} is below this value; matched to Earth's ${pct}th percentile">` +
          `${pct}th pct → ${fmt(k, targets[k])} on Earth</span>`;
      }
      return `<tr><td>${p.name}</td><td>${siteCell}</td><td>${fmt(k, res.values[k])}</td></tr>`;
    });
    const box = $('analog-compare');
    box.innerHTML = `<p class="c-title">Area ${i + 1} compared with the site</p>
      <table><thead><tr><th></th><th>${source.name}</th><th>Earth</th></tr></thead><tbody>${rows.join('')}</tbody></table>
      <p class="sub" style="margin-top:.4rem">Values beyond anything on Earth are matched relatively:
      as cold (or warm) for Earth as the site is for ${source.name}. Search values are averages over the area. The area summary
      (top right) shows this Earth area's typical values from the map data.</p>`;
    box.hidden = false;
  }
}

// ---- Earth <-> Moon/Mars switch (top right) ---------------------------------

// The last address of each Moon/Mars map, so switching back restores its view and selection.
const lastPage = {};
const ICONS = { earth: iconEarth, moon: iconMoon, mars: iconMars };

function setUpWorldSwitch(key, params) {
  const btn = $('switch-world');
  // From the Moon/Mars: go to Earth. From Earth: back to where it was opened from.
  const target = key === 'earth' ? (BODIES[params.get('from')] ? params.get('from') : 'mars') : 'earth';
  btn.querySelector('img').src = ICONS[target];
  const name = BODIES[target].name;
  btn.querySelector('.sw-text').innerHTML = key === 'earth'
    ? `<span class="sw-long">Back to </span>${name}<span class="sw-long"> view</span>`
    : `${name}<span class="sw-long"> view</span>`;
  btn.setAttribute('aria-label', key === 'earth' ? `Back to ${name} view` : `${name} view`);
  btn.onclick = () => {
    location.hash = key === 'earth' ? (lastPage[target] ?? `#/${target}`) : `#/earth?from=${key}`;
  };
  btn.hidden = false;
}

function hidePanels() {
  if (view3d?.isOpen()) view3d.close();
  $('btn-3d').hidden = true;
  for (const id of ['select-panel', 'analog-banner', 'menu', 'menu-btn', 'area-panel', 'switch-world', 'route-panel']) $(id).hidden = true;
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
//   #/earth?from=mars                     Earth map, opened from Mars (switch button goes back)
//   #/earth?from=mars&site=lat,lon&sr=10&w=..  Earth map, looking for analogs of a Mars area
//   (Earth's own selection and view use lat/lon/r/view like the other maps)
function route() {
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (map) { map.remove(); map = null; }
  hidePanels();
  if (BODIES[path]) openMap(path, new URLSearchParams(query)); else showHome();
}

window.addEventListener('hashchange', route);
route();

// Reveal the page only when it's ready: styles applied, globe images loaded and the
// first frame drawn. Never wait more than 4 s, so a slow image can't leave it blank.
Promise.race([globesReady(), new Promise((r) => setTimeout(r, 4000))]).then(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.add('ready');
    setTimeout(() => document.getElementById('loader')?.remove(), 600); // after its fade-out
  }));
});
