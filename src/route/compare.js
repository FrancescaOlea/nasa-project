// Connect an Earth analog to exploration: drive the same traveller on the same route length at
// the analog and at the Moon / Mars site, and compare the two side by side.
//
// - The site route: the route planned on the Moon / Mars map (carried in the Earth page's address
//   as src=latA,lonA;latB,lonB), or, if none was planned, a west-east crossing of the site area.
// - The Earth route: the same length and direction, centred on the analog area, turned (or
//   shifted) if needed so that it stays on land. The user can then drag A and B as usual.
// - Both are found by the same planner (computeRoutes in planner.js) from the map's data tiles,
//   so they compare like with like. Earth has no thermal-inertia, crater or dust-storm data: the
//   comparison uses what both worlds have (distance, climb, slopes, roughness) and says so.
import { layerSampler, RADIUS, haversineKm } from './grid.js';
import { loadIndex } from '../overlays.js';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const wrap = (lon) => ((((lon + 180) % 360) + 360) % 360) - 180;

/** Initial bearing (degrees from north) from a to b. */
export function bearingDeg(a, b) {
  const p1 = rad(a.lat); const p2 = rad(b.lat); const dl = rad(b.lon - a.lon);
  return (deg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))) + 360) % 360;
}

/** The point `km` away from p in direction `brg` (degrees) on a sphere of radius R. */
export function destination(p, brg, km, R) {
  const d = km / R; const t = rad(brg); const p1 = rad(p.lat);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = rad(p.lon) + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: deg(p2), lon: wrap(deg(l2)) };
}

/** A and B `km` apart, centred on c, in direction brg. */
export function lineThrough(c, km, brg, R) {
  return { a: destination(c, (brg + 180) % 360, km / 2, R), b: destination(c, brg, km / 2, R) };
}

/** The site route when none was planned: a west-east crossing of the site area (its diameter). */
export function siteCrossing(site, radiusKm, world) {
  const km = Math.max(10, 2 * radiusKm);
  return { ...lineThrough(site, km, 90, RADIUS[world]), crossing: true };
}

/**
 * The same route length and direction at an Earth analog centred on c: tries the original
 * direction first, then turned by up to 90 degrees either way, then shifted, until every sampled
 * point of the straight line is on land. Returns { a, b, turned } (turned in degrees, or null if
 * no land line was found, in which case the original direction is used).
 */
export async function sameRouteOnEarth(src, c) {
  const R = RADIUS.earth;
  const km = haversineKm(src.a.lat, src.a.lon, src.b.lat, src.b.lon, RADIUS[src.world]);
  const brg = bearingDeg(src.a, src.b);
  const index = await loadIndex();
  const meta = index.earth.elevation;
  const reach = deg((km / 2 + 20) / R);
  const cos = Math.max(0.1, Math.cos(rad(c.lat)));
  const elev = await layerSampler('elevation', meta, c.lat - reach, c.lat + reach, c.lon - reach / cos, c.lon + reach / cos,
    km > 400 ? 3 : undefined, 'earth');
  const onLand = (line) => {
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const lat = line.a.lat + (line.b.lat - line.a.lat) * t;
      let dl = line.b.lon - line.a.lon;
      if (dl > 180) dl -= 360; else if (dl < -180) dl += 360;
      if (!Number.isFinite(elev.at(lat, wrap(line.a.lon + dl * t)))) return false;
    }
    return true;
  };
  for (const turn of [0, 15, -15, 30, -30, 45, -45, 60, -60, 75, -75, 90]) {
    const line = lineThrough(c, km, (brg + turn + 360) % 360, R);
    if (onLand(line)) return { ...line, km, turned: turn };
  }
  // shift the centre a little (the analog area is at least half land)
  for (const shift of [0.25, 0.5]) {
    for (const dir of [0, 90, 180, 270]) {
      const c2 = destination(c, dir, km * shift, R);
      for (const turn of [0, 45, -45, 90]) {
        const line = lineThrough(c2, km, (brg + turn + 360) % 360, R);
        if (onLand(line)) return { ...line, km, turned: turn, shifted: true };
      }
    }
  }
  return { ...lineThrough(c, km, brg, R), km, turned: null };
}

// ---- The side-by-side summary -------------------------------------------------------------

const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km).toLocaleString()} km`);
const fmtM = (km) => `${Math.round(km * 1000).toLocaleString()} m`;
const perKm = (r) => (r.dist > 0 ? r.terrainSum / r.dist : 0);

/** Compares two values: 'similar' within ±tol (relative), else 'less' / 'more' with the %. */
function relate(earth, site, tol, floor) {
  const e = Math.max(earth, floor); const s = Math.max(site, floor);
  if (Math.abs(e - s) / Math.max(e, s) <= tol) return { word: 'similar', pct: 0 };
  return e < s ? { word: 'less', pct: Math.round((1 - e / s) * 100) } : { word: 'more', pct: Math.round((e / s - 1) * 100) };
}

/**
 * One sentence: e.g. "A 12 km Curiosity traverse here has similar slopes but 40% less rough
 * ground than at the Mars site."
 */
export function conclusion(site, earth, { travellerName, worldName, walking }) {
  const slope = relate(earth.avgSlope, site.avgSlope, 0.2, 0.2);
  const rough = Number.isFinite(earth.avgRelief) && Number.isFinite(site.avgRelief)
    ? relate(earth.avgRelief, site.avgRelief, 0.15, 0.005) : null;
  const there = `the ${worldName} site`;
  const slopeText = slope.word === 'similar' ? `similar slopes to ${there}`
    : slope.word === 'less' ? `${slope.pct}% gentler slopes than ${there}` : `${slope.pct}% steeper slopes than ${there}`;
  const roughText = !rough ? '' : rough.word === 'similar' ? 'about as much rough ground'
    : rough.word === 'less' ? `${rough.pct}% less rough ground` : `${rough.pct}% more rough ground`;
  // "but" when the two point different ways (one similar and one not, or one less and one more)
  const join = rough && slope.word !== rough.word ? ' but ' : ' and ';
  const who = walking ? 'walk' : `${travellerName} traverse`;
  return `A ${fmtKm(earth.dist)} ${who} here has ${slopeText}${roughText ? `${join}${roughText}` : ''}.`;
}

/**
 * The comparison table. site / earth: the chosen kind's route on each world (from computeRoutes);
 * returns HTML for the planner panel.
 */
export function compareHtml({ site, earth, kindName, worldName, travellerName, walking, crossing, turned, missing, cellKm }) {
  const row = (label, s, e, note = '') => `<tr><td>${label}${note ? ` <span class="sub">${note}</span>` : ''}</td><td>${s}</td><td>${e}</td></tr>`;
  const pctOver = (r) => (r.dist > 0 ? ` <span class="sub">(${Math.round((r.steep15Km / r.dist) * 100)}%)</span>` : '');
  const rel = (r) => (Number.isFinite(r.avgRelief) ? fmtM(r.avgRelief) : '–');
  const diffWord = (d) => (d < 0.15 ? 'Easy' : d < 0.4 ? 'Moderate' : d < 0.8 ? 'Hard' : 'Very hard');
  return `
    <p class="cmp-conclusion">${conclusion(site, earth, { travellerName, worldName, walking })}</p>
    <table class="route-table cmp-table">
      <thead><tr><th>${kindName} route</th><th>${worldName}</th><th>Earth</th></tr></thead>
      <tbody>
        ${row('Distance', fmtKm(site.dist), fmtKm(earth.dist))}
        ${row('Climb', `↑ ${fmtM(site.up)}`, `↑ ${fmtM(earth.up)}`)}
        ${row('Steepest slope', `${site.maxSlope.toFixed(1)}°`, `${earth.maxSlope.toFixed(1)}°`)}
        ${row('Over 15°', `${fmtKm(site.steep15Km)}${pctOver(site)}`, `${fmtKm(earth.steep15Km)}${pctOver(earth)}`)}
        ${row('Average slope', `${site.avgSlope.toFixed(1)}°`, `${earth.avgSlope.toFixed(1)}°`)}
        ${row('Roughness', rel(site), rel(earth), 'height spread in ~9 km')}
        ${row('Terrain difficulty', `${diffWord(perKm(site))} <span class="sub">${perKm(site).toFixed(2)}/km</span>`,
    `${diffWord(perKm(earth))} <span class="sub">${perKm(earth).toFixed(2)}/km</span>`, 'slope + roughness')}
        ${row(`All hazards at the ${worldName} site`, `${(site.dist > 0 ? site.hazardSum / site.dist : 0).toFixed(2)}/km`, '<span class="sub">no data</span>', 'incl. craters, dust, rock')}
      </tbody>
    </table>
    <p class="sub cmp-note">${crossing
    ? `No route was planned at the site, so this compares a west–east crossing of the site area. Plan a route on the ${worldName} map before finding analogs to compare that one.${turned === 'moved' ? ' You moved A or B here: compare the per-km and % values.' : ''}`
    : turned === 'moved' ? `You moved A or B, so the two routes differ in length: compare the per-km and % values.`
      : `Same straight-line length and direction as your ${worldName} route${turned ? `, turned ${Math.abs(turned)}° to stay on land` : turned === null ? ' (part of it may cross water: drag A or B onto land)' : ''}.`}
      Same traveller, same planner and the same ~${cellKm.toFixed(1)} km terrain cells on both worlds, from slope data at the same ~2 km scale (${worldName === 'Moon' ? 'LOLA' : 'MOLA'}, ETOPO 2022).
      <strong>Missing on Earth:</strong> ${missing.join(', ')}; these hazards are left out of the Earth route and of the difficulty compared above.</p>`;
}
