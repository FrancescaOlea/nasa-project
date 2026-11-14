// Route planner for Mars: pick who travels (an astronaut or one of NASA's rovers), click a
// start (A) and a destination (B), and get three routes: the shortest, the easiest and the
// safest, each with what makes it dangerous and why it goes the way it does.
// The terrain grid comes from grid.js, the search runs in search.worker.js, the rovers'
// specs and the model's assumptions about them are in rovers.js.
import L from 'leaflet';
import { buildGrid, cellOf, cellLatLon, craterDepthKm, haversineKm, MAX_LAT } from './grid.js';
import { ROVERS, travellerModel, travellerName, roverIcon } from './rovers.js';
import { formatLatLon } from '../geo.js';

// Mars seasons by solar longitude (Ls); northern-hemisphere names. Ls 180-360 is the
// dusty season (Mars is closest to the Sun).
export const SEASONS = [
  { name: 'Northern spring', short: 'N. spring', ls: 'Ls 0–90°' },
  { name: 'Northern summer', short: 'N. summer', ls: 'Ls 90–180°' },
  { name: 'Northern autumn (dust season)', short: 'N. autumn', ls: 'Ls 180–270°' },
  { name: 'Northern winter (dust season)', short: 'N. winter', ls: 'Ls 270–360°' },
];
export const KINDS = {
  safest: { name: 'Safest', colour: '#ffb02e', about: 'Avoids steep ground, crater rims, rough, rocky and loose terrain and dust-storm areas, as far as this traveller needs to, even if that takes longer.' },
  easiest: { name: 'Easiest', colour: '#4cd387', about: 'Least effort: as little climbing as possible.' },
  shortest: { name: 'Shortest', colour: '#6ec6ff', about: 'Fewest kilometres while staying under the slope limit.' },
};
const TRAVELLER_KEYS = ['walk', ...Object.keys(ROVERS)];
const RECORD_KM = 45.16; // Opportunity, the longest drive on another world

/** Fires 'update' whenever the route (or its endpoints) change; the 3D view listens. */
export const routeEvents = new EventTarget();

const $ = (id) => document.getElementById(id);
const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`);
const fmtM = (km) => `${Math.round(km * 1000).toLocaleString()} m`;
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const pct = (x) => `${Math.round(x * 100)}%`;
const fromA = (km) => (km < 0.1 ? 'at A' : `${fmtKm(km)} from A`);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const lr0 = Math.log10(0.02);
const lr1 = Math.log10(0.4);
const roughOf = (relief) => (Number.isNaN(relief) ? 0
  : Math.min(1, Math.max(0, (Math.log10(Math.max(relief, 1e-4)) - lr0) / (lr1 - lr0))));

let worker = null;
function runSearch(grid, opts, start, goal) {
  worker ??= new Worker(new URL('./search.worker.js', import.meta.url), { type: 'module' });
  const id = Math.random();
  const transfer = {
    rows: grid.rows, cols: grid.cols, dLat: grid.dLat, dLon: grid.dLon, latMax: grid.latMax,
    elev: grid.elev, slopeMax: grid.slopeMax, relief: grid.relief, ti: grid.ti, storm: grid.storm,
    crater: grid.crater, valid: grid.valid,
  };
  return new Promise((resolve, reject) => {
    const onMsg = ({ data }) => {
      if (data.id !== id) return;
      worker.removeEventListener('message', onMsg);
      resolve(data);
    };
    worker.addEventListener('message', onMsg);
    worker.onerror = reject;
    worker.postMessage({ grid: transfer, opts, start, goal, id });
  });
}

/** Planner options for a traveller (see rovers.js). */
export function optsFor(traveller) {
  const m = travellerModel(traveller);
  return { traveller, noGoDeg: m.noGoDeg, cautionDeg: m.cautionDeg, weights: m.weights };
}

/**
 * Builds the grid and finds the three routes for one traveller. Kept separate from the UI so
 * two rovers can later be compared on the same A and B (call it twice, reuse the grid).
 */
export async function computeRoutes(a, b, season, traveller, onProgress = () => {}, grid = null) {
  const opts = optsFor(traveller);
  const g = grid ?? await buildGrid(a, b, season, onProgress);
  onProgress(`Searching ${(g.rows * g.cols).toLocaleString()} terrain cells (${g.cellKm.toFixed(1)} km each)…`);
  const start = cellOf(g, a.lat, a.lon);
  const goal = cellOf(g, b.lat, b.lon);
  const res = await runSearch(g, opts, start, goal);
  const bLon = g.lonMin + ((goal % g.cols) + 0.5) * g.dLon;
  const routes = {};
  for (const k of Object.keys(KINDS)) {
    const r = res.routes[k];
    routes[k] = r.path ? describe(g, r.path, a, opts, res) : null;
    if (routes[k]) {
      const pts = routes[k].pts;
      pts[pts.length - 1] = [b.lat, b.lon + Math.round((bLon - b.lon) / 360) * 360];
    }
  }
  return { g, routes, opts, traveller, season };
}

// ---- What a route goes through --------------------------------------------------------

function describe(g, path, a, opts, res) {
  const { soft, rocky, z } = res;
  const pts = path.map((i) => cellLatLon(g, i));
  pts[0] = [a.lat, a.lon];
  const seg = [0];
  let dist = 0;
  let up = 0; let down = 0;
  let hours = 0;
  let steepKm = 0; let softKm = 0; let rockyKm = 0; let roughKm = 0;
  let maxSlope = -1; let maxSlopeAt = 0;
  let maxStorm = -1; let maxStormAt = 0; let stormSum = 0;
  let coldest = Infinity;
  let lo = Infinity; let hi = -Infinity;
  let hazardSum = 0;
  const craterHits = new Map(); // crater index -> first point on the route
  const dangers = [];
  const hard = new Uint8Array(path.length); // difficult points (for the 3D view)
  let softStart = -1;
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    const rough = roughOf(g.relief[i]);
    const isSteep = g.slopeMax[i] > opts.cautionDeg;
    const isCrater = g.craterId[i] >= 0 && g.crater[i] > 0.15;
    hard[k] = isSteep || isCrater || soft[i] > 0.5 || rocky[i] > 0.5 ? 1 : 0;
    if (k > 0) {
      const L0 = haversineKm(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      dist += L0;
      const dz = z[i] - z[path[k - 1]];
      if (dz > 0) up += dz; else down -= dz;
      hours += L0 / (6 * Math.exp(-3.5 * Math.abs(dz / Math.max(L0, 1e-6) + 0.05)));
      if (isSteep) steepKm += L0;
      if (soft[i] > 0.5) softKm += L0;
      if (rocky[i] > 0.5) rockyKm += L0;
      if (rough > 0.6) roughKm += L0;
      stormSum += g.storm[i] * L0;
      hazardSum += L0 * (Math.min(1, (g.slopeMax[i] / opts.cautionDeg) ** 2) + g.crater[i] + rough * 0.5 + soft[i] + rocky[i]);
    }
    seg.push(dist);
    if (g.slopeMax[i] > maxSlope) { maxSlope = g.slopeMax[i]; maxSlopeAt = k; }
    if (g.storm[i] > maxStorm) { maxStorm = g.storm[i]; maxStormAt = k; }
    if (g.tmin[i] < coldest) coldest = g.tmin[i];
    lo = Math.min(lo, g.elev[i]); hi = Math.max(hi, g.elev[i]);
    if (isCrater && !craterHits.has(g.craterId[i])) craterHits.set(g.craterId[i], k);
    // stretches of loose dust longer than ~5 km
    if (soft[i] > 0.5 && softStart < 0) softStart = k;
    if ((soft[i] <= 0.5 || k === path.length - 1) && softStart >= 0) {
      const len = seg[k] - seg[softStart];
      if (len >= 5) {
        dangers.push({ type: 'dust', k: softStart, title: `Loose dust for ${fmtKm(len)}`,
          text: 'Very low thermal inertia: fine dust or sand where wheels sink and slip (MGS TES, measured). Spirit got stuck in soft sand in 2009; Curiosity once hit 98.7% wheel slip.' });
      }
      softStart = -1;
    }
  }
  if (maxSlope > 0) {
    const level = maxSlope > opts.cautionDeg ? 'Steep' : 'Steepest point';
    dangers.push({ type: 'slope', k: maxSlopeAt, title: `${level}: ${maxSlope.toFixed(1)}° slope`,
      text: `Steepest ground on this route, averaged over ~2 km (MOLA, measured). Local slopes, e.g. on a crater wall or boulder field, can be much steeper. Limit used for ${travellerName(opts.traveller)}: ${opts.noGoDeg}°.` });
  }
  const craters = [...craterHits.entries()].map(([idx, k]) => ({ c: g.craters[idx], k }))
    .sort((p, q) => craterDepthKm(q.c) - craterDepthKm(p.c));
  for (const { c, k } of craters.slice(0, 6)) {
    const measured = c.depthKm != null;
    dangers.push({ type: 'crater', k, title: `Crater rim: ${c.d.toFixed(c.d < 10 ? 1 : 0)} km wide, ${measured ? '' : '~'}${fmtM(craterDepthKm(c))} deep`,
      text: `${measured ? 'Rim-to-floor depth measured from MOLA' : 'Depth estimated (~1/5 of the width); not measured'} (Robbins & Hynek crater catalog).` +
        `${c.rimKm != null ? ` Rim stands ${fmtM(c.rimKm)} above the plains.` : ''}${c.degradation ? ` Preservation: ${['', 'heavily eroded', 'eroded', 'fairly fresh', 'fresh'][c.degradation]}.` : ''}` +
        `${measured && c.d < 10 ? ' MOLA depths of craters under 10 km are only rough.' : ''}` });
  }
  if (maxStorm >= 0.05) {
    dangers.push({ type: 'storm', k: maxStormAt, title: `Dust storms on ${pct(maxStorm)} of sols here`,
      text: `In this season, a dust storm covered this area on ${pct(maxStorm)} of the sols mapped from orbit in 2001–2015 (Mars Dust Activity Database, observed). Storms cut sunlight for solar power and visibility.` });
  }
  dangers.sort((p, q) => p.k - q.k);
  return {
    pts, seg, dist, up, down, hours, steepKm, softKm, rockyKm, roughKm, maxSlope, maxStorm, coldest, lo, hi,
    avgStorm: dist > 0 ? stormSum / dist : 0, hazardSum, craters, dangers, hard,
    elev: path.map((i) => g.elev[i]), slope: path.map((i) => g.slopeMax[i]),
  };
}

// ---- Explaining a route ------------------------------------------------------------------

function travelTime(r, traveller) {
  if (traveller === 'walk') {
    const h = r.hours;
    const evas = Math.ceil(h / 8);
    return {
      short: h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h walk`,
      long: `~${h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`} walking${evas > 1 ? ` (${evas} eight-hour spacewalks)` : ''}`,
      src: 'model',
    };
  }
  const pace = ROVERS[traveller].model.pace;
  if (pace) {
    const sols = Math.max(1, Math.ceil((r.dist * 1000) / pace.mPerSol));
    return { short: `${sols.toLocaleString()} sols`, long: `~${sols.toLocaleString()} sols at ${pace.text}`, src: 'estimate' };
  }
  return { short: 'no estimate', long: 'Not estimated: no published average pace for this rover', src: '' };
}

/** Plain-language reasons: why this route, what it avoids, where it's hard, can it be done. */
function explain(result, kind) {
  const { routes, opts, traveller } = result;
  const r = routes[kind];
  const s = routes.shortest;
  const name = travellerName(traveller);
  const model = travellerModel(traveller);
  const out = { why: [], avoided: [], difficult: [], verdict: null, warnings: [] };

  if (kind === 'shortest' || !s) {
    out.why.push(`The most direct line that keeps every ~2.6 km cell below ${name}'s ${opts.noGoDeg}° slope limit.`);
  } else {
    const extra = r.dist - s.dist;
    out.why.push(kind === 'safest'
      ? `${extra > 0.5 ? `${fmtKm(extra)} (${Math.round((extra / s.dist) * 100)}%) longer than the shortest route, to stay` : 'Almost as short as the shortest route, while staying'} away from the hazards that matter most for ${name}.`
      : `${extra > 0.5 ? `${fmtKm(extra)} longer than the shortest route, but` : 'About as long as the shortest route, and'} with ${fmtM(Math.max(0, s.up - r.up))} less climbing (↑ ${fmtM(r.up)} instead of ↑ ${fmtM(s.up)}).`);
    if (kind === 'safest') out.why.push(model.why);
    const diff = (label, a, b, count = false) => {
      if (b - a > (count ? 0.5 : 0.9)) out.avoided.push(`${label}: ${count ? `${a} instead of ${b}` : `${fmtKm(a)} instead of ${fmtKm(b)}`}`);
    };
    diff(`Slopes over ${opts.cautionDeg}°`, r.steepKm, s.steepKm);
    diff('Crater rims crossed', r.craters.length, s.craters.length, true);
    diff('Loose dust / sand', r.softKm, s.softKm);
    diff('Rocky ground', r.rockyKm, s.rockyKm);
    diff('Rough ground', r.roughKm, s.roughKm);
    if (s.maxSlope - r.maxSlope > 2) out.avoided.push(`Steepest slope: ${r.maxSlope.toFixed(1)}° instead of ${s.maxSlope.toFixed(1)}°`);
    if (!out.avoided.length) out.avoided.push('Nothing major: the direct line is already about as safe as it gets at this map scale.');
  }
  if (r.steepKm > 0) out.difficult.push(`${fmtKm(r.steepKm)} of slopes over ${opts.cautionDeg}° (steepest ${r.maxSlope.toFixed(1)}°)`);
  if (r.craters.length) out.difficult.push(`${r.craters.length} crater rim${r.craters.length > 1 ? 's' : ''} (deepest ~${fmtM(craterDepthKm(r.craters[0].c))})`);
  if (r.softKm > 0) out.difficult.push(`${fmtKm(r.softKm)} of loose dust or sand`);
  if (r.rockyKm > 0) out.difficult.push(`${fmtKm(r.rockyKm)} of rocky ground (high thermal inertia)`);
  if (r.maxStorm >= 0.05) out.difficult.push(`dust storms on up to ${pct(r.maxStorm)} of sols this season`);

  // can it be done (under the model's assumptions)?
  const tooFar = model.rangeKm != null && r.dist > model.rangeKm;
  out.verdict = {
    ok: !tooFar,
    text: tooFar
      ? `Beyond ${name}'s capabilities: ${fmtKm(r.dist)} is far more than it could manage (${model.rangeWhy}). The route is shown only to compare terrain.`
      : `Passable under this model: every ~2.6 km cell is below ${name}'s ${opts.noGoDeg}° limit (steepest ${r.maxSlope.toFixed(1)}°). Not checked: single rocks, small scarps and sand ripples, which are too small for this data.`,
  };
  if (traveller !== 'walk' && r.dist > RECORD_KM && !tooFar) {
    out.warnings.push(`At ${fmtKm(r.dist)}, this is longer than any rover has ever driven (Opportunity's record: 45.16 km in 14 years).`);
  }
  return out;
}

// ---- The planner ---------------------------------------------------------------------

/**
 * Sets up the route planner on a Mars map. Returns { open, close, isOpen, click, query, result }.
 * `onChange` is called when the route's endpoints/options change (to save them in the URL).
 */
export function createRoutePlanner(map, params, onChange) {
  const state = {
    open: false,
    a: null, b: null,
    traveller: TRAVELLER_KEYS.includes(params.get('tr')) ? params.get('tr') : 'curiosity',
    season: Math.min(3, Math.max(0, parseInt(params.get('ss'), 10) || 0)),
    kind: KINDS[params.get('rk')] ? params.get('rk') : 'safest',
    result: null,
    busy: false,
    fresh: false, // a route was just calculated (the views zoom to it once)
  };
  if (!map.getPane('route')) map.createPane('route').style.zIndex = 450;
  const layer = L.layerGroup().addTo(map);
  const dangerLayer = L.layerGroup().addTo(map);
  let hover = null;
  const markers = { a: null, b: null };
  let token = 0;
  const emit = () => routeEvents.dispatchEvent(new CustomEvent('update', { detail: api.result() }));

  // ---- panel: who travels
  const panel = $('route-panel');
  $('route-traveller').replaceChildren(...TRAVELLER_KEYS.map((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'traveller-btn';
    b.dataset.value = k;
    b.dataset.group = 'traveller';
    b.setAttribute('role', 'radio');
    b.title = travellerName(k);
    b.innerHTML = `<span class="t-icon">${roverIcon(k, 34)}</span><span class="t-label">${k === 'walk' ? 'On foot' : esc(ROVERS[k].name)}</span>`;
    b.onclick = () => { state.traveller = k; refreshChips(); plan(); };
    return b;
  }));
  // season: a dropdown next to the A / B coordinates
  const seasonSelect = $('route-season');
  seasonSelect.replaceChildren(...SEASONS.map((s, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = s.short;
    o.title = `${s.name}, ${s.ls}`;
    return o;
  }));
  seasonSelect.onchange = () => { state.season = Number(seasonSelect.value); refreshChips(); plan(); };
  function refreshChips() {
    for (const b of panel.querySelectorAll('[data-group="traveller"]')) b.setAttribute('aria-checked', b.dataset.value === state.traveller);
    seasonSelect.value = String(state.season);
    seasonSelect.title = `${SEASONS[state.season].name}, ${SEASONS[state.season].ls}`;
    renderProfileCard();
  }

  // compact profile of the chosen rover, with sources
  function renderProfileCard() {
    const box = $('route-rover');
    const m = travellerModel(state.traveller);
    const modelHtml = `<p class="rv-model"><span class="tag tag-model">Model assumption</span> Slope limit ${m.noGoDeg}° at ~2 km scale (${esc(m.noGoWhy)}); caution above ${m.cautionDeg}°. ${esc(m.why)}</p>`;
    if (state.traveller === 'walk') {
      box.innerHTML = `<details class="rv-card">
        <summary><span class="rv-icon">${roverIcon('walk', 44)}</span><span class="rv-head"><strong>Astronaut on foot</strong>
          <span class="sub">NASA xEVA spacesuit concept of operations</span></span></summary>
        ${modelHtml}</details>`;
      return;
    }
    const r = ROVERS[state.traveller];
    const rows = Object.entries({ Mass: r.specs.mass, Size: r.specs.size, Wheels: r.specs.wheels, Obstacles: r.specs.obstacles,
      Speed: r.specs.speed, Navigation: r.specs.navigation, Record: r.specs.distance })
      .map(([label, v]) => `<tr><td>${label}</td><td>${esc(v.text)}${v.src.length ? ` <span class="src-dot" title="Source: ${esc(v.src.join('; '))}">ⓘ</span>` : ''}</td></tr>`).join('');
    box.innerHTML = `<details class="rv-card">
      <summary><span class="rv-icon">${roverIcon(state.traveller, 44)}</span><span class="rv-head"><strong>${esc(r.name)}</strong>
        <span class="sub">${esc(r.mission)} · ${esc(r.period)}</span></span></summary>
      <table class="route-table rv-specs"><tbody>${rows}</tbody></table>
      <p class="sub rv-note">Published specs (hover ⓘ for the source). Silhouettes are drawn to scale by wheel size.</p>
      ${modelHtml}
      </details>`;
  }

  refreshChips();
  $('route-close').onclick = () => close();
  $('route-swap').onclick = () => {
    if (!state.a || !state.b) return;
    [state.a, state.b] = [state.b, state.a];
    placeMarkers();
    plan();
  };
  $('route-clear').onclick = () => {
    state.a = state.b = null;
    state.result = null;
    placeMarkers();
    render();
    onChange();
    emit();
  };

  function status(text) { $('route-status').textContent = text; }

  function placeMarkers() {
    for (const k of ['a', 'b']) {
      if (markers[k]) { markers[k].remove(); markers[k] = null; }
      const p = state[k];
      if (!p) continue;
      markers[k] = L.marker([p.lat, p.lon], {
        draggable: true, pane: 'route', keyboard: false, title: k === 'a' ? 'Start (A) – drag to move' : 'Destination (B) – drag to move',
        icon: L.divIcon({ className: '', html: `<span class="route-pin route-pin-${k}">${k.toUpperCase()}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
      }).addTo(map);
      markers[k].on('dragend', (e) => {
        const ll = e.target.getLatLng();
        state[k] = { lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, ll.lat)), lon: wrap(ll.lng) };
        plan();
      });
    }
  }

  function click(latlng) {
    const p = { lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, latlng.lat)), lon: wrap(latlng.lng) };
    if (!state.a || (state.a && state.b)) {
      state.a = p; state.b = null; state.result = null;
      layer.clearLayers(); dangerLayer.clearLayers();
      placeMarkers(); render();
      onChange();
      emit();
      return;
    }
    state.b = p;
    placeMarkers();
    plan();
  }

  async function plan() {
    onChange();
    if (!state.a || !state.b) { render(); emit(); return; }
    const my = ++token;
    layer.clearLayers(); dangerLayer.clearLayers();
    $('route-results').hidden = true;
    panel.classList.add('busy');
    state.busy = true;
    emit();
    try {
      const prev = state.result;
      // same points and season: reuse the terrain grid, only the search changes
      const reuse = prev && prev.a === state.a && prev.b === state.b && prev.season === state.season ? prev.g : null;
      const res = await computeRoutes(state.a, state.b, state.season, state.traveller, (s) => { if (my === token) status(s); }, reuse);
      if (my !== token) return;
      state.result = { ...res, a: state.a, b: state.b };
      render();
      fitRoute();
      state.fresh = true;
    } catch (err) {
      console.error(err);
      if (my === token) status('Could not load the terrain data for this route.');
    } finally {
      if (my === token) { panel.classList.remove('busy'); state.busy = false; emit(); state.fresh = false; }
    }
  }

  // Zoom the 2D map so the whole route fills the space next to the panel.
  function fitRoute() {
    const r = state.result?.routes?.[state.kind] ?? Object.values(state.result?.routes ?? {}).find(Boolean);
    if (!r) return;
    const pts = r.pts.map(([lat, lon]) => [lat, wrap(lon)]);
    const lons = pts.map((p) => p[1]);
    if (Math.max(...lons) - Math.min(...lons) > 180) return; // crosses the map's edge: leave the view
    const bounds = L.latLngBounds(pts);
    const wide = window.innerWidth > 600;
    const panelW = wide ? Math.min(400, window.innerWidth - 24) + 24 : 0;
    map.flyToBounds(bounds, {
      paddingTopLeft: [50, 80],
      paddingBottomRight: wide ? [panelW + 50, 50] : [30, Math.round(window.innerHeight * 0.55)],
      maxZoom: map.getMaxZoom(),
      duration: 0.9,
    });
  }

  // Leaflet lines can't cross the map's edge at +/-180: split them there.
  function splitAtEdge(pts) {
    const parts = [[]];
    let prev = null;
    for (const [lat, lon0] of pts) {
      const lon = wrap(lon0);
      if (prev !== null && Math.abs(lon - prev) > 180) parts.push([]);
      parts[parts.length - 1].push([lat, lon]);
      prev = lon;
    }
    return parts;
  }

  function render() {
    layer.clearLayers();
    dangerLayer.clearLayers();
    const has = state.a && state.b && state.result;
    $('route-hint').textContent = !state.a ? 'Click the map to set the start (A).'
      : !state.b ? 'Now click the destination (B).' : 'Drag A or B to change the route. Click the map to start over.';
    $('route-swap').disabled = !(state.a && state.b);
    $('route-ab').innerHTML = state.a
      ? `<span class="ab-line"><span class="route-pin route-pin-a">A</span> ${formatLatLon(state.a.lat, state.a.lon)}</span>` +
        (state.b ? `<span class="ab-line"><span class="route-pin route-pin-b">B</span> ${formatLatLon(state.b.lat, state.b.lon)}</span>` : '')
      : '';
    if (!has) { $('route-results').hidden = true; if (!state.b) status(''); return; }
    const { routes, g, opts, traveller } = state.result;
    const found = Object.keys(KINDS).filter((k) => routes[k]);
    if (!found.length) {
      status(`No route possible for ${travellerName(traveller)}: every way from A to B crosses ground steeper than its ${opts.noGoDeg}° limit (averaged over ~2 km). Try another traveller or other points.`);
      $('route-results').hidden = true;
      return;
    }
    status(`${travellerName(traveller)} · straight-line distance ${fmtKm(g.distKm)} · terrain cells ${g.cellKm.toFixed(1)} km`);
    if (!routes[state.kind]) state.kind = found[0];
    for (const k of [...found.filter((x) => x !== state.kind), state.kind]) {
      const chosen = k === state.kind;
      for (const part of splitAtEdge(routes[k].pts)) {
        if (chosen) L.polyline(part, { pane: 'route', color: '#000', weight: 7, opacity: 0.45, interactive: false }).addTo(layer);
        L.polyline(part, { pane: 'route', color: KINDS[k].colour, weight: chosen ? 4 : 2.5, opacity: chosen ? 1 : 0.7, dashArray: chosen ? null : '6 6' })
          .on('click', (e) => { L.DomEvent.stop(e); state.kind = k; onChange(); render(); emit(); })
          .addTo(layer);
      }
    }
    $('route-tabs').replaceChildren(...Object.entries(KINDS).map(([k, info]) => {
      const r = routes[k];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'route-tab';
      b.setAttribute('aria-pressed', k === state.kind);
      b.disabled = !r;
      b.innerHTML = `<span class="dot" style="background:${info.colour}"></span><span class="t-name">${info.name}</span>` +
        `<span class="t-sub">${r ? `${fmtKm(r.dist)} · ${travelTime(r, traveller).short}` : 'no route'}</span>`;
      b.onclick = () => { state.kind = k; onChange(); render(); emit(); };
      return b;
    }));
    const r = routes[state.kind];
    $('route-about').textContent = KINDS[state.kind].about;
    renderExplanation(explain(state.result, state.kind));
    $('route-stats').innerHTML = statsHtml(r, opts, traveller);
    drawProfile(r, opts);
    const icons = { slope: '⛰', crater: '◎', dust: '≋', storm: '🌪' };
    $('route-dangers').replaceChildren(...r.dangers.map((d) => {
      const [lat, lon] = r.pts[d.k];
      const m = L.marker([lat, wrap(lon)], {
        pane: 'route', keyboard: false, title: d.title,
        icon: L.divIcon({ className: '', html: `<span class="danger-pin danger-${d.type}">${icons[d.type]}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).bindPopup(`<strong>${esc(d.title)}</strong><br>${esc(d.text)}<br><span class="sub">${formatLatLon(lat, wrap(lon))} · ${fromA(r.seg[d.k])}</span>`)
        .addTo(dangerLayer);
      const li = document.createElement('li');
      li.innerHTML = `<button type="button"><span class="danger-pin danger-${d.type}">${icons[d.type]}</span><span><strong></strong><br><span class="sub"></span></span></button>`;
      li.querySelector('strong').textContent = d.title;
      li.querySelector('.sub').textContent = fromA(r.seg[d.k]);
      li.querySelector('button').onclick = () => {
        routeEvents.dispatchEvent(new CustomEvent('focus', { detail: { k: d.k, danger: d } }));
        map.flyTo([lat, wrap(lon)], Math.max(map.getZoom(), 5), { duration: 0.6 });
        m.openPopup();
      };
      return li;
    }));
    $('route-no-dangers').hidden = r.dangers.length > 0;
    $('route-results').hidden = false;
  }

  function renderExplanation(x) {
    const list = (items) => `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
    $('route-explain').innerHTML = `
      <p class="verdict ${x.verdict.ok ? 'ok' : 'bad'}">${x.verdict.ok ? '✓' : '✕'} ${esc(x.verdict.text)}</p>
      ${x.warnings.map((w) => `<p class="verdict warn">! ${esc(w)}</p>`).join('')}
      <span class="eyebrow">Why this route</span>${list(x.why)}
      ${x.avoided.length ? `<span class="eyebrow">Compared with the shortest route</span>${list(x.avoided)}` : ''}
      <span class="eyebrow">Difficult sections</span>${list(x.difficult.length ? x.difficult : ['None found at this map scale.'])}`;
  }

  function statsHtml(r, opts, traveller) {
    const row = (label, value, src) => `<tr><td>${label}</td><td>${value}</td><td class="src">${src}</td></tr>`;
    const storm = r.maxStorm >= 0 ? `${pct(r.avgStorm)} of sols on average, up to ${pct(r.maxStorm)}` : '–';
    const deepest = r.craters[0];
    const t = travelTime(r, traveller);
    const difficulty = r.dist > 0 ? r.hazardSum / r.dist : 0; // 0 = easy, ~1+ = hard
    const diffText = difficulty < 0.15 ? 'Easy' : difficulty < 0.4 ? 'Moderate' : difficulty < 0.8 ? 'Hard' : 'Very hard';
    return `<table class="route-table"><tbody>
      ${row('Distance', fmtKm(r.dist), '')}
      ${row('Terrain difficulty', `${diffText} <span class="sub">(${difficulty.toFixed(2)} hazard per km)</span>`, 'model')}
      ${row('Time', t.long, t.src)}
      ${row('Climb / descent', `↑ ${fmtM(r.up)} · ↓ ${fmtM(r.down)}`, 'measured')}
      ${row('Elevation', `${fmtM(r.lo)} to ${fmtM(r.hi)}`, 'measured')}
      ${row('Steepest slope', `${r.maxSlope.toFixed(1)}°${r.steepKm > 0 ? ` · ${fmtKm(r.steepKm)} over ${opts.cautionDeg}°` : ''}`, 'measured')}
      ${row('Crater rims crossed', r.craters.length ? `${r.craters.length}${deepest ? ` · deepest ${craterDepthKm(deepest.c) >= 1 ? `${craterDepthKm(deepest.c).toFixed(1)} km` : fmtM(craterDepthKm(deepest.c))}` : ''}` : 'none', 'catalog')}
      ${row('Loose dust / sand', r.softKm > 0 ? fmtKm(r.softKm) : 'none', 'measured')}
      ${row('Rocky ground', r.rockyKm > 0 ? fmtKm(r.rockyKm) : 'none', 'measured')}
      ${row('Dust storms (season)', storm, 'observed')}
      ${row('Coldest night', Number.isFinite(r.coldest) ? `${Math.round(r.coldest)} °C` : '–', 'model')}
    </tbody></table>`;
  }

  // Elevation profile, coloured by slope; hovering shows the spot on the map (and in 3D).
  function drawProfile(r, opts) {
    const cv = $('route-profile');
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 300;
    const H = 90;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.clearRect(0, 0, W, H);
    const elev = r.elev;
    const lo = Math.min(...elev); const hi = Math.max(...elev);
    const span = Math.max(0.2, hi - lo);
    const x = (k) => 4 + (r.seg[k] / Math.max(r.dist, 1e-6)) * (W - 8);
    const y = (e) => H - 14 - ((e - lo) / span) * (H - 26);
    for (let k = 1; k < elev.length; k++) {
      const s = r.slope[k];
      c.fillStyle = s > opts.cautionDeg ? '#e5484d' : s > 8 ? '#ffb02e' : '#4cd387';
      c.beginPath();
      c.moveTo(x(k - 1) - 0.5, H - 12); c.lineTo(x(k - 1) - 0.5, y(elev[k - 1])); c.lineTo(x(k) + 0.5, y(elev[k])); c.lineTo(x(k) + 0.5, H - 12);
      c.fill();
    }
    c.strokeStyle = '#fff'; c.lineWidth = 1.5;
    c.beginPath();
    elev.forEach((e, k) => (k ? c.lineTo(x(k), y(e)) : c.moveTo(x(k), y(e))));
    c.stroke();
    c.fillStyle = 'rgba(255,255,255,.75)';
    c.font = '10px system-ui, sans-serif';
    c.textAlign = 'right';
    c.fillText(`${fmtM(hi)}`, W - 4, 10);
    c.fillText(`${fmtM(lo)}`, W - 4, H - 16);
    c.textAlign = 'left';
    c.fillText('A', 2, H - 1);
    c.fillText('B', W - 9, H - 1);
    c.fillText(fmtKm(r.dist), W / 2 - 14, H - 1);
    cv.onmousemove = (e) => {
      const px = e.offsetX;
      let k = 0;
      while (k < r.seg.length - 1 && x(k + 1) < px) k++;
      const [lat, lon] = r.pts[k];
      if (!hover) hover = L.circleMarker([lat, wrap(lon)], { pane: 'route', radius: 6, color: '#fff', weight: 2, fillColor: KINDS[state.kind].colour, fillOpacity: 1, interactive: false }).addTo(map);
      else hover.setLatLng([lat, wrap(lon)]);
      routeEvents.dispatchEvent(new CustomEvent('hover', { detail: { k } }));
      $('route-profile-note').textContent = `${fromA(r.seg[k])} · ${fmtM(elev[k])} · slope ${r.slope[k].toFixed(1)}°`;
    };
    cv.onmouseleave = () => {
      if (hover) { hover.remove(); hover = null; }
      routeEvents.dispatchEvent(new CustomEvent('hover', { detail: { k: -1 } }));
      $('route-profile-note').textContent = 'Hover to find a spot on the map. Green < 8°, amber < 15°, red steeper.';
    };
    cv.onmouseleave();
  }

  function open() {
    state.open = true;
    panel.hidden = false;
    render();
    onChange();
    emit();
  }
  function close() {
    state.open = false;
    panel.hidden = true;
    state.a = state.b = null;
    state.result = null;
    placeMarkers();
    layer.clearLayers(); dangerLayer.clearLayers();
    if (hover) { hover.remove(); hover = null; }
    onChange();
    emit();
  }

  const api = {
    open, close, click,
    isOpen: () => state.open,
    /** current state for the 3D view: endpoints, route and which one is chosen */
    result: () => ({
      open: state.open, a: state.a, b: state.b, busy: state.busy, kind: state.kind, fresh: state.fresh,
      route: state.result?.routes?.[state.kind] ?? null,
      opts: state.result?.opts ?? null, colour: KINDS[state.kind].colour,
    }),
    /** this planner's part of the page address */
    query(q) {
      if (!state.open) return;
      const f = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      q.set('route', [state.a, state.b].filter(Boolean).map(f).join(';'));
      if (state.traveller !== 'curiosity') q.set('tr', state.traveller);
      if (state.season) q.set('ss', state.season);
      if (state.kind !== 'safest') q.set('rk', state.kind);
    },
  };

  // restore from the address: route=latA,lonA;latB,lonB
  const saved = (params.get('route') ?? '').split(';').map((s) => s.split(',').map(Number));
  if (params.has('route')) {
    if (saved[0]?.length === 2 && saved[0].every(Number.isFinite)) state.a = { lat: saved[0][0], lon: saved[0][1] };
    if (saved[1]?.length === 2 && saved[1].every(Number.isFinite)) state.b = { lat: saved[1][0], lon: saved[1][1] };
    if (params.get('tr') === 'rover') state.traveller = 'curiosity'; // links from the first version
    open();
    placeMarkers();
    if (state.a && state.b) {
      map.fitBounds(L.latLngBounds([[state.a.lat, state.a.lon], [state.b.lat, state.b.lon]]), { padding: [120, 120], maxZoom: 7 });
      plan();
    }
  }
  return api;
}
