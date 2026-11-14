// Route planner for Mars: click a start (A) and a destination (B) and get three routes:
// the shortest, the easiest and the safest, each with what makes it dangerous.
// The terrain grid comes from grid.js, the search runs in search.worker.js.
import L from 'leaflet';
import { buildGrid, cellOf, cellLatLon, craterDepthKm, haversineKm, MAX_LAT } from './grid.js';
import { formatLatLon } from '../geo.js';

// Who travels, and what slopes they can manage (degrees, at the data's ~2 km scale).
//  On foot: NASA xEVA spacesuit concept of operations (EVA-EXP-0042) asks for walking on
//  slopes up to 20 deg; Apollo walking traverses stayed under 15 deg.
//  Rover: Curiosity's nominal tilt limit is 30 deg, but its steepest in 7 years was
//  25.3 deg (Rankin et al., JPL); Mars 2020 called <15 deg "benign" terrain.
export const TRAVELLERS = {
  walk: { name: 'Astronaut on foot', short: 'On foot', noGoDeg: 20, cautionDeg: 15 },
  rover: { name: 'Rover', short: 'Rover', noGoDeg: 25, cautionDeg: 15 },
};
// Mars seasons by solar longitude (Ls); northern-hemisphere names. Ls 180-360 is the
// dusty season (Mars is closest to the Sun).
export const SEASONS = [
  { name: 'Northern spring', short: 'N. spring', ls: 'Ls 0–90°' },
  { name: 'Northern summer', short: 'N. summer', ls: 'Ls 90–180°' },
  { name: 'Northern autumn (dust season)', short: 'N. autumn', ls: 'Ls 180–270°' },
  { name: 'Northern winter (dust season)', short: 'N. winter', ls: 'Ls 270–360°' },
];
const KINDS = {
  safest: { name: 'Safest', colour: '#ffb02e', about: 'Avoids steep ground, crater rims, rough and loose terrain and dust-storm areas, even if it takes longer.' },
  easiest: { name: 'Easiest', colour: '#4cd387', about: 'Least effort: as little climbing as possible.' },
  shortest: { name: 'Shortest', colour: '#6ec6ff', about: 'Fewest kilometres while staying under the slope limit.' },
};
// How much each hazard lengthens the "safest" route (see search.worker.js)
const WEIGHTS = {
  walk: { slope: 3, crater: 1.5, rough: 1.5, soft: 1, storm: 1 },
  rover: { slope: 3, crater: 1.5, rough: 1.5, soft: 2, storm: 1 },
};
// Curiosity drove 21.3 km in 738 drives over its first seven years: ~29 m per drive
// (Rankin et al. 2020, J. Field Robotics).
const ROVER_M_PER_DRIVE = 29;

const $ = (id) => document.getElementById(id);
const fmtKm = (km) => (km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`);
const fmtM = (km) => `${Math.round(km * 1000).toLocaleString()} m`;
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;
const pct = (x) => `${Math.round(x * 100)}%`;
const fromA = (km) => (km < 0.1 ? 'at A' : `${fmtKm(km)} from A`);

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

// ---- What a route goes through --------------------------------------------------------

function describe(g, path, a, b, opts, soft, z) {
  const pts = path.map((i) => cellLatLon(g, i));
  pts[0] = [a.lat, a.lon];
  pts[pts.length - 1] = [b.lat, g.lonMin <= b.lon && b.lon <= g.lonMax ? b.lon : pts[pts.length - 1][1]];
  const seg = [0];
  let dist = 0;
  let up = 0; let down = 0;
  let hours = 0;
  let steepKm = 0; let softKm = 0;
  let maxSlope = -1; let maxSlopeAt = 0;
  let maxStorm = -1; let maxStormAt = 0; let stormSum = 0;
  let coldest = Infinity; let coldestAt = 0;
  let lo = Infinity; let hi = -Infinity;
  const craterHits = new Map(); // crater index -> first point on the route
  const dangers = [];
  let softStart = -1;
  for (let k = 0; k < path.length; k++) {
    const i = path[k];
    if (k > 0) {
      const L0 = haversineKm(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
      dist += L0;
      const dz = z[i] - z[path[k - 1]];
      if (dz > 0) up += dz; else down -= dz;
      hours += L0 / (6 * Math.exp(-3.5 * Math.abs(dz / Math.max(L0, 1e-6) + 0.05)));
      if (g.slopeMax[i] > opts.cautionDeg) steepKm += L0;
      if (soft[i] > 0.5) softKm += L0;
      stormSum += g.storm[i] * L0;
    }
    seg.push(dist);
    if (g.slopeMax[i] > maxSlope) { maxSlope = g.slopeMax[i]; maxSlopeAt = k; }
    if (g.storm[i] > maxStorm) { maxStorm = g.storm[i]; maxStormAt = k; }
    if (g.tmin[i] < coldest) { coldest = g.tmin[i]; coldestAt = k; }
    lo = Math.min(lo, g.elev[i]); hi = Math.max(hi, g.elev[i]);
    if (g.craterId[i] >= 0 && g.crater[i] > 0.15 && !craterHits.has(g.craterId[i])) craterHits.set(g.craterId[i], k);
    // stretches of loose dust longer than ~5 km
    if (soft[i] > 0.5 && softStart < 0) softStart = k;
    if ((soft[i] <= 0.5 || k === path.length - 1) && softStart >= 0) {
      const len = seg[k] - seg[softStart];
      if (len >= 5) {
        dangers.push({ type: 'dust', k: softStart, title: `Loose dust for ${fmtKm(len)}`,
          text: 'Very low thermal inertia: fine dust or sand where wheels can sink and slip and boots sink in (MGS TES, measured). Curiosity once hit 98.7% wheel slip in sand.' });
      }
      softStart = -1;
    }
  }
  if (maxSlope > 0) {
    const level = maxSlope > opts.cautionDeg ? 'Steep' : 'Steepest point';
    dangers.push({ type: 'slope', k: maxSlopeAt, title: `${level}: ${maxSlope.toFixed(1)}° slope`,
      text: `Steepest ground on this route, averaged over ~2 km (MOLA, measured). Local slopes, e.g. on a crater wall or boulder field, can be much steeper. Limit for ${TRAVELLERS[opts.traveller].name.toLowerCase()}: ${opts.noGoDeg}°.` });
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
    pts, seg, dist, up, down, hours, steepKm, softKm, maxSlope, maxStorm, coldest, coldestAt, lo, hi,
    avgStorm: dist > 0 ? stormSum / dist : 0, craters, dangers,
    sols: Math.ceil((dist * 1000) / ROVER_M_PER_DRIVE),
  };
}

// ---- The planner ---------------------------------------------------------------------

/**
 * Sets up the route planner on a Mars map. Returns { open, close, isOpen, click, params }.
 * `onChange` is called when the route's endpoints/options change (to save them in the URL).
 */
export function createRoutePlanner(map, params, onChange) {
  const state = {
    open: false,
    a: null, b: null,
    traveller: TRAVELLERS[params.get('tr')] ? params.get('tr') : 'walk',
    season: Math.min(3, Math.max(0, parseInt(params.get('ss'), 10) || 0)),
    kind: KINDS[params.get('rk')] ? params.get('rk') : 'safest',
    result: null,
  };
  const pane = map.createPane('route');
  pane.style.zIndex = 450;
  const layer = L.layerGroup().addTo(map);
  const dangerLayer = L.layerGroup().addTo(map);
  let hover = null;
  const markers = { a: null, b: null };
  let token = 0;

  // ---- panel
  const panel = $('route-panel');
  $('route-traveller').replaceChildren(...Object.entries(TRAVELLERS).map(([k, t]) => chip(t.short, t.name, () => {
    state.traveller = k; refreshChips(); plan();
  }, k, 'traveller')));
  $('route-season').replaceChildren(...SEASONS.map((s, i) => chip(s.short, `${s.name}, ${s.ls}`, () => {
    state.season = i; refreshChips(); plan();
  }, i, 'season')));
  function chip(label, title, onclick, value, group) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.dataset.value = value;
    b.dataset.group = group;
    b.setAttribute('role', 'radio');
    b.onclick = onclick;
    return b;
  }
  function refreshChips() {
    for (const b of panel.querySelectorAll('[data-group]')) {
      const v = b.dataset.group === 'traveller' ? state.traveller : String(state.season);
      b.setAttribute('aria-checked', b.dataset.value === v);
    }
    $('route-season-note').textContent = `${SEASONS[state.season].name} · ${SEASONS[state.season].ls}`;
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
      return;
    }
    state.b = p;
    placeMarkers();
    plan();
  }

  async function plan() {
    onChange();
    if (!state.a || !state.b) { render(); return; }
    const my = ++token;
    const t = TRAVELLERS[state.traveller];
    const opts = { traveller: state.traveller, noGoDeg: t.noGoDeg, cautionDeg: t.cautionDeg, weights: WEIGHTS[state.traveller] };
    layer.clearLayers(); dangerLayer.clearLayers();
    $('route-results').hidden = true;
    status('Reading NASA terrain data…');
    panel.classList.add('busy');
    try {
      const g = await buildGrid(state.a, state.b, state.season, (s) => { if (my === token) status(s); });
      if (my !== token) return;
      status(`Searching ${(g.rows * g.cols).toLocaleString()} terrain cells (${g.cellKm.toFixed(1)} km each)…`);
      const start = cellOf(g, state.a.lat, state.a.lon);
      const goal = cellOf(g, state.b.lat, state.b.lon);
      const res = await runSearch(g, opts, start, goal);
      if (my !== token) return;
      const routes = {};
      for (const k of Object.keys(KINDS)) {
        const r = res.routes[k];
        routes[k] = r.path ? describe(g, r.path, state.a, { ...state.b, lon: g.lonMin + ((cellOf(g, state.b.lat, state.b.lon) % g.cols) + 0.5) * g.dLon }, opts, res.soft, res.z) : null;
      }
      // the route's last point: B itself (in the grid's unwrapped longitude)
      for (const r of Object.values(routes)) if (r) r.pts[r.pts.length - 1] = [state.b.lat, unwrapNear(state.b.lon, r.pts[r.pts.length - 2]?.[1] ?? state.b.lon)];
      state.result = { g, routes, opts };
      if (import.meta.env.DEV) console.log('route search', Object.fromEntries(Object.entries(res.routes).map(([k, r]) => [k, `${r.ms} ms, ${r.expanded} cells`])), g);
      render();
    } catch (err) {
      console.error(err);
      if (my === token) status('Could not load the terrain data for this route.');
    } finally {
      if (my === token) panel.classList.remove('busy');
    }
  }
  const unwrapNear = (lon, ref) => lon + Math.round((ref - lon) / 360) * 360;

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
      ? `<span class="route-pin route-pin-a">A</span> ${formatLatLon(state.a.lat, state.a.lon)}` +
        (state.b ? `<br><span class="route-pin route-pin-b">B</span> ${formatLatLon(state.b.lat, state.b.lon)}` : '')
      : '';
    if (!has) { $('route-results').hidden = true; if (!state.b) status(''); return; }
    const { routes, g, opts } = state.result;
    const found = Object.keys(KINDS).filter((k) => routes[k]);
    if (!found.length) {
      status(`No route found: every way from A to B crosses slopes over ${opts.noGoDeg}° (the limit for ${TRAVELLERS[opts.traveller].name.toLowerCase()}). Try the rover, or other points.`);
      $('route-results').hidden = true;
      return;
    }
    status(`Straight-line distance ${fmtKm(g.distKm)} · terrain cells ${g.cellKm.toFixed(1)} km`);
    if (!routes[state.kind]) state.kind = found[0];
    // lines: other routes thin underneath, the chosen one on top
    for (const k of [...found.filter((x) => x !== state.kind), state.kind]) {
      const chosen = k === state.kind;
      for (const part of splitAtEdge(routes[k].pts)) {
        if (chosen) L.polyline(part, { pane: 'route', color: '#000', weight: 7, opacity: 0.45, interactive: false }).addTo(layer);
        L.polyline(part, { pane: 'route', color: KINDS[k].colour, weight: chosen ? 4 : 2.5, opacity: chosen ? 1 : 0.7, dashArray: chosen ? null : '6 6' })
          .on('click', (e) => { L.DomEvent.stop(e); state.kind = k; onChange(); render(); })
          .addTo(layer);
      }
    }
    // route tabs
    $('route-tabs').replaceChildren(...Object.entries(KINDS).map(([k, info]) => {
      const r = routes[k];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'route-tab';
      b.setAttribute('aria-pressed', k === state.kind);
      b.disabled = !r;
      b.innerHTML = `<span class="dot" style="background:${info.colour}"></span><span class="t-name">${info.name}</span>` +
        `<span class="t-sub">${r ? `${fmtKm(r.dist)} · ${timeText(r, opts, true)}` : 'no route'}</span>`;
      b.onclick = () => { state.kind = k; onChange(); render(); };
      return b;
    }));
    const r = routes[state.kind];
    $('route-about').textContent = KINDS[state.kind].about;
    $('route-stats').innerHTML = statsHtml(r, opts);
    drawProfile(r, g, opts);
    // danger markers
    const icons = { slope: '⛰', crater: '◎', dust: '≋', storm: '🌪' };
    $('route-dangers').replaceChildren(...r.dangers.map((d) => {
      const [lat, lon] = r.pts[d.k];
      const m = L.marker([lat, wrap(lon)], {
        pane: 'route', keyboard: false, title: d.title,
        icon: L.divIcon({ className: '', html: `<span class="danger-pin danger-${d.type}">${icons[d.type]}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).bindPopup(`<strong>${d.title}</strong><br>${d.text}<br><span class="sub">${formatLatLon(lat, wrap(lon))} · ${fromA(r.seg[d.k])}</span>`)
        .addTo(dangerLayer);
      const li = document.createElement('li');
      li.innerHTML = `<button type="button"><span class="danger-pin danger-${d.type}">${icons[d.type]}</span><span><strong></strong><br><span class="sub"></span></span></button>`;
      li.querySelector('strong').textContent = d.title;
      li.querySelector('.sub').textContent = fromA(r.seg[d.k]);
      li.querySelector('button').onclick = () => { map.flyTo([lat, wrap(lon)], Math.max(map.getZoom(), 5), { duration: 0.6 }); m.openPopup(); };
      return li;
    }));
    $('route-no-dangers').hidden = r.dangers.length > 0;
    $('route-results').hidden = false;
  }

  function timeText(r, opts, short = false) {
    if (opts.traveller === 'walk') {
      const h = r.hours;
      const evas = Math.ceil(h / 8);
      if (short) return h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h walk`;
      return `~${h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`} walking` + (evas > 1 ? ` (${evas} eight-hour spacewalks)` : '');
    }
    return short ? `${r.sols.toLocaleString()} sols` : `~${r.sols.toLocaleString()} driving sols at Curiosity's average ~${ROVER_M_PER_DRIVE} m per drive`;
  }

  function statsHtml(r, opts) {
    const row = (label, value, src) => `<tr><td>${label}</td><td>${value}</td><td class="src">${src}</td></tr>`;
    const storm = r.maxStorm >= 0
      ? `${pct(r.avgStorm)} of sols on average, up to ${pct(r.maxStorm)}`
      : '–';
    const deepest = r.craters[0];
    return `<table class="route-table"><tbody>
      ${row('Distance', fmtKm(r.dist), '')}
      ${row('Time', timeText(r, opts), opts.traveller === 'walk' ? 'estimate' : 'estimate')}
      ${row('Climb / descent', `↑ ${fmtM(r.up)} · ↓ ${fmtM(r.down)}`, 'measured')}
      ${row('Elevation', `${fmtM(r.lo)} to ${fmtM(r.hi)}`, 'measured')}
      ${row('Steepest slope', `${r.maxSlope.toFixed(1)}°${r.steepKm > 0 ? ` · ${fmtKm(r.steepKm)} over ${opts.cautionDeg}°` : ''}`, 'measured')}
      ${row('Crater rims crossed', r.craters.length ? `${r.craters.length}${deepest ? ` · deepest ${craterDepthKm(deepest.c) >= 1 ? `${craterDepthKm(deepest.c).toFixed(1)} km` : fmtM(craterDepthKm(deepest.c))}` : ''}` : 'none', 'catalog')}
      ${row('Loose dust / sand', r.softKm > 0 ? fmtKm(r.softKm) : 'none', 'measured')}
      ${row('Dust storms (season)', storm, 'observed')}
      ${row('Coldest night', Number.isFinite(r.coldest) ? `${Math.round(r.coldest)} °C` : '–', 'model')}
    </tbody></table>`;
  }

  // Elevation profile, coloured by slope; hovering shows the spot on the map.
  function drawProfile(r, g, opts) {
    const cv = $('route-profile');
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth || 300;
    const H = 90;
    cv.width = W * dpr; cv.height = H * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.clearRect(0, 0, W, H);
    const path = state.result.routes[state.kind];
    const elev = path.pts.map((_, k) => g.elev[cellOf(g, path.pts[k][0], path.pts[k][1])]);
    const lo = Math.min(...elev); const hi = Math.max(...elev);
    const span = Math.max(0.2, hi - lo);
    const x = (k) => 4 + (r.seg[k] / Math.max(r.dist, 1e-6)) * (W - 8);
    const y = (e) => H - 14 - ((e - lo) / span) * (H - 26);
    for (let k = 1; k < elev.length; k++) {
      const s = g.slopeMax[cellOf(g, path.pts[k][0], path.pts[k][1])];
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
      $('route-profile-note').textContent = `${fromA(r.seg[k])} · ${fmtM(elev[k])} · slope ${g.slopeMax[cellOf(g, lat, lon)].toFixed(1)}°`;
    };
    cv.onmouseleave = () => { if (hover) { hover.remove(); hover = null; } $('route-profile-note').textContent = 'Hover to find a spot on the map. Green < 8°, amber < 15°, red steeper.'; };
    cv.onmouseleave();
  }

  function open() {
    state.open = true;
    panel.hidden = false;
    render();
    onChange();
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
  }

  // restore from the address: route=latA,lonA;latB,lonB
  const saved = (params.get('route') ?? '').split(';').map((s) => s.split(',').map(Number));
  if (params.has('route')) {
    if (saved[0]?.length === 2 && saved[0].every(Number.isFinite)) state.a = { lat: saved[0][0], lon: saved[0][1] };
    if (saved[1]?.length === 2 && saved[1].every(Number.isFinite)) state.b = { lat: saved[1][0], lon: saved[1][1] };
    open();
    placeMarkers();
    if (state.a && state.b) {
      map.fitBounds(L.latLngBounds([[state.a.lat, state.a.lon], [state.b.lat, state.b.lon]]), { padding: [120, 120], maxZoom: 7 });
      plan();
    }
  }

  return {
    open, close, click,
    isOpen: () => state.open,
    /** this planner's part of the page address */
    query(q) {
      if (!state.open) return;
      const f = (p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
      q.set('route', [state.a, state.b].filter(Boolean).map(f).join(';'));
      if (state.traveller !== 'walk') q.set('tr', state.traveller);
      if (state.season) q.set('ss', state.season);
      if (state.kind !== 'safest') q.set('rk', state.kind);
    },
  };
}
