// Logic of tools/validate-analogs.html (see there).
import { BODIES } from '../src/bodies.js';
import { loadIndex } from '../src/overlays.js';
import { siteValues, findAnalogs, loadEarthGrid, DEFAULT_WEIGHTS } from '../src/analogs.js';
import { KNOWN_ANALOGS, KNOWN_REGION_KM, inKnownRegion } from '../src/knownAnalogs.js';

const RADIUS = 25; // km, as in the README checks
// [world, site name, lat, lon, known analog name (start of KNOWN_ANALOGS name), why the pair is known]
const PAIRS = [
  ['mars', 'Phoenix landing site', 68.22, -125.75, 'McMurdo Dry Valleys', 'ice-cemented polar ground'],
  ['mars', 'Viking 1, Chryse Planitia', 22.27, -47.95, 'Atacama', 'Viking-like soil experiments in the Atacama'],
  ['mars', 'Opportunity, Meridiani Planum', -1.95, -5.53, 'Río Tinto', 'jarosite from acid water'],
  ['moon', 'Apollo 14, Fra Mauro', -3.645, -17.471, 'Nördlinger Ries', 'Apollo 14 crew trained there'],
  ['moon', 'Apollo 16, Descartes', -8.973, 15.5, 'Sudbury Basin', 'Apollo 16 crew studied its rocks'],
  ['moon', 'Apollo 15, Hadley', 26.132, 3.634, 'Askja', 'Apollo crews trained there'],
];

const out = document.getElementById('out');
const log = (s) => { out.textContent += s + '\n'; };
const pct = (x) => `${(x * 100).toFixed(1)}%`;

const index = await loadIndex();
const grid = await loadEarthGrid();
// 300 random land points (fixed seed), for the baseline
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const randomPts = [];
while (randomPts.length < 300) {
  const j = Math.floor(rand() * grid.idx.length);
  const c = grid.idx[j];
  if (grid.dense.land[c] < 0.8) continue;
  randomPts.push([90 - (Math.floor(c / grid.width) + 0.5) * grid.res, -180 + ((c % grid.width) + 0.5) * grid.res]);
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const rows = [];
for (const [world, name, lat, lon, knownName, why] of PAIRS) {
  const known = KNOWN_ANALOGS.find((a) => a.name.startsWith(knownName));
  const site = await siteValues(world, BODIES[world].radiusKm, index[world] ?? {}, lat, lon, RADIUS);
  const found = await findAnalogs({ site, weights: DEFAULT_WEIGHTS, mode: 'match', radiusKm: RADIUS, count: 10 });
  const k = found.rankNear(known.lat, known.lon, KNOWN_REGION_KM);
  // best of any known analog for this world
  const anyKnown = KNOWN_ANALOGS.filter((a) => a.worlds.includes(world))
    .map((a) => ({ a, r: found.rankNear(a.lat, a.lon, KNOWN_REGION_KM) })).filter((x) => x.r)
    .sort((x, y) => x.r.top - y.r.top)[0];
  const base = median(randomPts.map(([la, lo]) => found.rankNear(la, lo, KNOWN_REGION_KM)?.top).filter((x) => x !== undefined));
  const inTop10 = found.results.findIndex((r) => Math.hypot(r.lat - known.lat, (r.lon - known.lon) * Math.cos(r.lat * Math.PI / 180)) * 111 < KNOWN_REGION_KM);
  rows.push({ name, known: known.name, why, top: k?.top, base, anyKnown: anyKnown && `${anyKnown.a.name} ${pct(anyKnown.r.top)}`, inTop10: inTop10 >= 0 ? inTop10 + 1 : '–' });
  log(`${name} -> ${known.name}: top ${k ? pct(k.top) : '–'} (random land point: top ${pct(base)}); ` +
    `in the 10 results: ${inTop10 >= 0 ? '#' + (inTop10 + 1) : 'no'}; best known ${world} analog: ${rows.at(-1).anyKnown}`);
}
// How often are results already-known analog regions? 10 results for each of these sites.
const SITES = [
  ['mars', 'Gale', -4.59, 137.44], ['mars', 'Meridiani', -1.95, -5.53], ['mars', 'Jezero', 18.44, 77.45],
  ['mars', 'Hellas', -42.4, 70.5], ['mars', 'Argyre', -49.7, -43.4], ['mars', 'Utopia', 49.7, 118.0],
  ['mars', 'North pole', 85, 0], ['mars', 'South pole', -85, 0], ['mars', 'Olympus Mons', 18.65, -133.8],
  ['mars', 'Valles Marineris', -13.9, -59.2], ['mars', 'InSight', 4.5, 135.6], ['mars', 'Phoenix', 68.22, -125.75],
  ['moon', 'Apollo 11', 0.674, 23.473], ['moon', 'Apollo 15', 26.132, 3.634], ['moon', 'Apollo 16', -8.973, 15.5],
  ['moon', 'Apollo 17', 20.191, 30.772], ['moon', 'Shackleton', -89.67, 129.78], ['moon', "Chang'e 4", -45.44, 177.6],
  ['moon', 'Tycho', -43.3, -11.2], ['moon', 'Aristarchus', 23.7, -47.4],
];
let total = 0; let knownHits = 0; let leaks = 0;
const hitList = [];
for (const [world, name, lat, lon] of SITES) {
  const site = await siteValues(world, BODIES[world].radiusKm, index[world] ?? {}, lat, lon, RADIUS);
  const a = await findAnalogs({ site, weights: DEFAULT_WEIGHTS, mode: 'match', radiusKm: RADIUS, count: 10 });
  const b = await findAnalogs({ site, weights: DEFAULT_WEIGHTS, mode: 'match', radiusKm: RADIUS, count: 10, exclude: inKnownRegion });
  total += a.results.length;
  for (const r of a.results) {
    if (inKnownRegion(r.lat, r.lon)) { knownHits++; hitList.push(`${name} -> ${r.lat.toFixed(1)}, ${r.lon.toFixed(1)}`); }
  }
  for (const r of b.results) if (inKnownRegion(r.lat, r.lon)) leaks++;
}
log(`\n${SITES.length} sites x 10 results: ${knownHits} of ${total} results are in a known analog region ` +
  `(${hitList.join('; ') || 'none'}); with "only new places": ${leaks} (must be 0).`);
log('\nJSON ' + JSON.stringify(rows));
document.getElementById('status').textContent = 'Done.';
document.title = 'done';
