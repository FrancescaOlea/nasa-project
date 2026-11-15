// Field campaign plan for an Earth analog site: the technology needed to do Moon / Mars
// research there and to simulate what the place itself can't provide, the team, and a
// rough cost per year.
//
// IMPORTANT: every price here is a rough planning figure (order of magnitude, 2025 US
// dollars) chosen by the app's authors from typical prices of such equipment and field
// logistics. They are NOT quotes and not from a NASA data set; real costs depend on the
// country, the national programme and the season. The app says so next to the numbers.
//
// The plan depends on the place: its climate and altitude (from the Earth search grid),
// its latitude, whether it is in Antarctica, and on the world it stands in for.
import { loadEarthGrid } from './analogs.js';

const PERSON_YEAR_USD = 130000; // loaded cost of one person for a year (salary + overheads)
const EQUIPMENT_YEARS = 5;      // equipment is paid off over this many yearly campaigns
const CONTINGENCY = 0.15;

// Kinds of place: what getting there and living there takes.
//   field: people in the field; weeks: length of the yearly campaign;
//   personYears: the whole team's work in a year (preparation, campaign, analysis)
const KINDS = {
  antarctic: { name: 'Antarctic deep-field site', field: 8, weeks: 6, personYears: 6,
    access: 'Reached only in the southern summer, through a national Antarctic programme (ship or aircraft, then ski-plane or traverse).',
    camp: ['Polar field camp', 'insulated tents, stoves, sleds, polar clothing, crevasse and rescue gear', 180000],
    logistics: [['Antarctic programme logistics', 'flights or ship berths, ski-plane hours, fuel depots, waste removal', 1500000],
      ['Freight', 'shipping the equipment south and back', 80000],
      ['Permits, insurance, medical evacuation cover', 'Antarctic Treaty permit and environmental assessment', 60000]] },
  polar: { name: 'Arctic / polar site', field: 8, weeks: 4, personYears: 5,
    access: 'Reached in summer by chartered ski- or tundra-wheel aircraft from the nearest settlement.',
    camp: ['Polar field camp', 'insulated tents, stoves, polar clothing, bear-safety gear', 120000],
    logistics: [['Charter aircraft and fuel caches', 'e.g. Twin Otter flights for people and cargo', 350000],
      ['Freight', 'air and sea freight to the staging settlement', 50000],
      ['Permits, insurance, medical evacuation cover', 'research and land-use permits', 40000]] },
  highalt: { name: 'High-altitude site', field: 8, weeks: 4, personYears: 5,
    access: 'Reached by 4x4 on mountain tracks; the team needs days to get used to the thin air.',
    camp: ['High-altitude camp', 'four-season tents, heating, bottled oxygen, pressure bag for altitude sickness', 70000],
    logistics: [['4x4 vehicles, drivers and fuel', 'including acclimatisation days on the way up', 90000],
      ['Freight', 'shipping and customs', 40000],
      ['Permits, insurance, medical evacuation cover', 'research permits, high-altitude rescue cover', 25000]] },
  hotdesert: { name: 'Hot desert site', field: 8, weeks: 4, personYears: 4.5,
    access: 'Reached by 4x4 convoy; all water and fuel is trucked in.',
    camp: ['Desert camp', 'shade structures, cooling for people and electronics, water storage', 50000],
    logistics: [['4x4 vehicles, water and fuel trucking', 'convoy with a support truck', 80000],
      ['Freight', 'shipping and customs', 40000],
      ['Permits, insurance, medical evacuation cover', 'research permits, heat-illness cover', 20000]] },
  colddesert: { name: 'Cold or temperate desert site', field: 8, weeks: 4, personYears: 4.5,
    access: 'Reached by 4x4; water and fuel are brought along.',
    camp: ['Desert camp', 'wind-proof tents, heating, water storage', 40000],
    logistics: [['4x4 vehicles, water and fuel', 'convoy with a support truck', 70000],
      ['Freight', 'shipping and customs', 40000],
      ['Permits, insurance, medical evacuation cover', 'research permits', 20000]] },
  other: { name: 'Accessible site', field: 6, weeks: 3, personYears: 3.5,
    access: 'Reached by road; supplies are available in the region.',
    camp: ['Field camp', 'tents or rented base, basic field kitchen', 30000],
    logistics: [['Vehicles and fuel', 'rented 4x4s', 40000],
      ['Freight', 'shipping', 20000],
      ['Permits, insurance, medical evacuation cover', 'research permits', 15000]] },
};

function kindOf({ lat, altKm, rainMm, tmax, tmin }) {
  if (lat <= -60) return 'antarctic';
  if (Math.abs(lat) >= 60 && tmin <= -25) return 'polar';
  if (altKm >= 3.5) return 'highalt';
  if (rainMm < 250 && tmax >= 40) return 'hotdesert';
  if (rainMm < 250) return 'colddesert';
  return 'other';
}

// Values of the Earth search grid at a place (its 0.5 degree cell, or the nearest land cell)
async function placeValues(lat, lon) {
  const g = await loadEarthGrid();
  const { width: W, height: H, res, dense } = g;
  const r0 = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / res)));
  const c0 = Math.floor((lon + 180) / res);
  let k = -1; let best = Infinity;
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const r = r0 + dr; if (r < 0 || r >= H) continue;
      const i = r * W + (((c0 + dc) % W) + W) % W;
      const d = dr * dr + dc * dc;
      if (Number.isFinite(dense.tmax[i]) && d < best) { best = d; k = i; }
    }
  }
  if (k < 0) return null;
  return { tmax: dense.tmax[k], tmin: dense.tmin[k], altKm: dense.alt[k], rainMm: 10 ** dense.dry[k] - 1, uv: dense.uv[k] };
}

/** The plan: { kind, team, equipment: [[name, why, usd]], logistics: [...], totals } */
export function fieldPlan({ from, worldName, lat, country, values }) {
  const v = { lat, ...values };
  const kindKey = kindOf(v);
  const kind = KINDS[kindKey];
  const mars = from === 'mars';
  const t = (x) => `${Math.round(x)} °C`;

  // ---- research technology (the same core set everywhere)
  const equipment = [
    ['Rover and robotics test platform', mars
      ? 'drive, navigate and sample on real terrain, as a Mars rover would'
      : 'drive and dig on loose ground, as a lunar rover or excavator would', 250000],
    ['Portable rock and soil analysers', `handheld X-ray and laser (Raman) spectrometers, to compare the ground with ${worldName} data`, 120000],
    ['Drill and sampling system (1–2 m)', mars ? 'reach below the surface, where ice and organics could survive' : 'take cores of the loose surface layer', 90000],
    ['Survey drone with laser scanner', 'centimetre-scale 3D terrain model of the test area', 50000],
    ['Ground-penetrating radar', mars ? 'look for buried ice and layers' : 'look for buried rocks, layers and cavities', 40000],
    ['Weather, UV and radiation station', 'record the conditions every test ran in', 15000],
    ['Spacesuit mock-ups (2)', 'work with stiff gloves, limited view and a life-support backpack', 60000],
    ['Mission-control link with time delay', mars ? 'talk to “Earth” with a 4–24 minute delay, as on Mars' : 'remote operation with the Moon’s ~1.3 s delay', 20000],
    ['Power system', 'solar panels, batteries and a backup generator', 30000],
    ['Satellite communication terminals', 'voice and data from anywhere', 10000],
  ];

  // ---- technology to simulate what this place can't provide
  const simulate = [];
  simulate.push([`Gravity off-load rig (${mars ? '0.38 g' : '1/6 g'})`,
    'Earth’s gravity is the same everywhere: a harness and counterweights for walking and handling tests', 80000]);
  if (!mars) {
    simulate.push(['Portable vacuum and thermal chamber', 'the Moon has no air and swings from about +120 to −180 °C: test parts in a chamber on site', 150000]);
    simulate.push(['Lunar soil simulant (about 2 tonnes)', 'sharp, clinging dust for wheel, seal and tool tests', 60000]);
    if (Math.abs(lat) < 60) simulate.push(['Low-sun lighting rig', 'the lunar poles have a Sun that skims the horizon, with long black shadows', 25000]);
  } else {
    if (v.tmin > -60) simulate.push(['Portable cold and low-pressure chamber', `nights here reach about ${t(v.tmin)}; Mars nights fall to −90 °C and below, in near-vacuum`, 150000]);
    if (v.uv < 1.5) simulate.push(['UV lamp array', 'sunlight here carries far less ultraviolet than reaches the surface of Mars', 15000]);
    if (v.rainMm >= 250) simulate.push(['Covered dry test bed with Mars soil simulant', `it rains about ${Math.round(v.rainMm)} mm a year here; Mars soil is bone dry`, 40000]);
  }
  if (v.tmax >= 40) simulate.push(['Cooling for electronics and batteries', `ground temperatures reach about ${t(v.tmax)} here`, 20000]);
  if (kindKey === 'highalt') simulate.push(['Medical oxygen monitoring kit', `at ${v.altKm.toFixed(1)} km the air is thin for people too`, 10000]);

  const camp = [kind.camp];
  const logistics = [
    ...kind.logistics,
    ['Team travel', `${kind.field} people to the site and back`, kind.field * (kindKey === 'antarctic' ? 8000 : 4000)],
    ['Consumables and laboratory analysis', 'food, spares, sample analysis back home', 60000],
    ['Satellite airtime', 'for the campaign', 10000],
  ];

  const sum = (rows) => rows.reduce((a, r) => a + r[2], 0);
  const purchase = sum(equipment) + sum(simulate) + sum(camp);
  const equipmentPerYear = purchase / EQUIPMENT_YEARS;
  const personnel = kind.personYears * PERSON_YEAR_USD;
  const logisticsPerYear = sum(logistics);
  const subtotal = personnel + equipmentPerYear + logisticsPerYear;
  const contingency = subtotal * CONTINGENCY;
  return {
    kindKey, kind, country, values: v, equipment, simulate, camp, logistics,
    team: { field: kind.field, weeks: kind.weeks, personYears: kind.personYears },
    totals: { purchase, equipmentPerYear, personnel, logisticsPerYear, contingency, perYear: subtotal + contingency },
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// $1.23 million / $450,000 (rounded: these are rough figures)
export function usd(x) {
  if (x >= 1e6) return `$${(x / 1e6).toFixed(x >= 1e7 ? 0 : 1)} million`;
  return `$${(Math.round(x / 1000) * 1000).toLocaleString('en-US')}`;
}
const rows = (list) => list.map(([name, why, cost]) =>
  `<tr><td>${esc(name)}<small>${esc(why)}</small></td><td>${usd(cost)}</td></tr>`).join('');

/** HTML of the plan for one analog result (a collapsed <details> block). */
export async function fieldPlanHtml({ from, worldName, lat, lon, country }) {
  const values = await placeValues(lat, lon);
  if (!values) return '';
  const p = fieldPlan({ from, worldName, lat, country, values });
  const { team, totals: T, kind } = p;
  const where = country ? ` · ${esc(country)}` : '';
  return `<details class="field-plan">
    <summary>Field research here: equipment, team and cost · about ${usd(T.perYear)} a year</summary>
    <p class="fp-kind"><strong>${esc(kind.name)}</strong>${where}. ${esc(kind.access)}</p>
    <h4>Team</h4>
    <table><tbody>
      <tr><td>People in the field<small>mission lead, 2 scientists, 2 engineers, field safety and medic, camp and logistics${team.field > 6 ? ', guide or mechanic' : ''}</small></td><td>${team.field}</td></tr>
      <tr><td>Campaign length<small>one campaign a year</small></td><td>${team.weeks} weeks</td></tr>
      <tr><td>Total work in a year<small>preparation, campaign and analysis, at ${usd(PERSON_YEAR_USD)} a person-year</small></td><td>${team.personYears} person-years</td></tr>
    </tbody></table>
    <h4>Research technology</h4>
    <table><tbody>${rows(p.equipment)}</tbody></table>
    <h4>To simulate what this place lacks</h4>
    <table><tbody>${rows(p.simulate)}</tbody></table>
    <h4>Camp</h4>
    <table><tbody>${rows(p.camp)}</tbody></table>
    <h4>Getting there and running it, per year</h4>
    <table><tbody>${rows(p.logistics)}</tbody></table>
    <h4>Cost per year</h4>
    <table><tbody>
      <tr><td>Team<small>${team.personYears} person-years</small></td><td>${usd(T.personnel)}</td></tr>
      <tr><td>Equipment<small>${usd(T.purchase)} to buy, spread over ${EQUIPMENT_YEARS} yearly campaigns</small></td><td>${usd(T.equipmentPerYear)}</td></tr>
      <tr><td>Travel, transport and running costs</td><td>${usd(T.logisticsPerYear)}</td></tr>
      <tr><td>Reserve<small>${Math.round(CONTINGENCY * 100)}% for the unexpected</small></td><td>${usd(T.contingency)}</td></tr>
      <tr class="fp-total"><td>Total per year</td><td>${usd(T.perYear)}</td></tr>
    </tbody></table>
    <p class="fp-note">Rough planning figures in 2025 US dollars, put together by this app from typical prices of such
      equipment and field logistics. They are not quotes and not NASA data: real costs depend on the country, the
      national programme and the season. The equipment list follows this place’s climate, altitude and
      latitude, and what ${esc(worldName)} has that the place lacks.</p>
  </details>`;
}
