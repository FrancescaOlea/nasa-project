// Where the Sun, Earth and (on Mars) Phobos and Deimos are in the sky of a point on the
// Moon or Mars, at a given time; on Earth, the Sun and the Moon.
//
// astronomy-engine gives positions in the J2000 equatorial frame (EQJ) and each world's IAU
// orientation (pole direction + spin angle of the prime meridian). From these we build the
// world's body-fixed axes (x = 0°N 0°E, z = north pole; the frame the elevation maps use)
// and then the observer's local east / north / up.
//
// Phobos and Deimos are not in astronomy-engine. They come from JPL's mean orbital elements
// (Jacobson 2014, epoch J2000, referred to each moon's Laplace plane), with apsides and nodes
// precessing. Good to a few degrees along the orbit - shown as approximate.
import * as A from 'astronomy-engine';

const KM_PER_AU = 149597870.7;
const SUN_RADIUS_KM = 695700;
const EARTH_RADIUS_KM = 6371;

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (a) => Math.hypot(a.x, a.y, a.z);
const norm = (a) => scale(a, 1 / len(a));
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const fromRaDec = (ra, dec) => ({ x: Math.cos(rad(dec)) * Math.cos(rad(ra)), y: Math.cos(rad(dec)) * Math.sin(rad(ra)), z: Math.sin(rad(dec)) });

const BODY = { moon: A.Body.Moon, mars: A.Body.Mars };

/** Body-fixed axes in EQJ at time t. */
function bodyAxes(world, t) {
  const axis = A.RotationAxis(BODY[world], t);
  const N = norm(axis.north);
  const Q = norm(cross({ x: 0, y: 0, z: 1 }, N)); // where the body's equator crosses Earth's (J2000)
  const W = rad(axis.spin % 360);
  const X = add(scale(Q, Math.cos(W)), scale(cross(N, Q), Math.sin(W)));
  return { X, Y: cross(N, X), Z: N };
}

/** Local east / north / up unit vectors (body-fixed) at lat, lon in degrees. */
export function localAxes(lat, lon) {
  const p = rad(lat); const l = rad(lon);
  return {
    e: { x: -Math.sin(l), y: Math.cos(l), z: 0 },
    n: { x: -Math.sin(p) * Math.cos(l), y: -Math.sin(p) * Math.sin(l), z: Math.cos(p) },
    u: { x: Math.cos(p) * Math.cos(l), y: Math.cos(p) * Math.sin(l), z: Math.sin(p) },
  };
}

const toLocal = (v, L) => ({ x: dot(v, L.e), y: dot(v, L.n), z: dot(v, L.u) }); // east, north, up
const toBody = (v, B) => ({ x: dot(v, B.X), y: dot(v, B.Y), z: dot(v, B.Z) });
const fromBody = (v, B) => add(add(scale(B.X, v.x), scale(B.Y, v.y)), scale(B.Z, v.z));

/** Azimuth (deg from north, clockwise) and elevation (deg) of a local east/north/up vector. */
export function azEl(v) {
  const d = norm(v);
  return { az: ((Math.atan2(d.x, d.y) * 180) / Math.PI + 360) % 360, el: (Math.asin(d.z) * 180) / Math.PI };
}

// ---- Phobos and Deimos -------------------------------------------------------------------
// a km, e, w (arg. of periapsis), M (mean anomaly), i, node: degrees at J2000;
// n deg/day; pw / pnode: apsidal / nodal precession periods in years; Laplace pole RA/Dec.
const MARS_MOONS = [
  { name: 'Phobos', radiusKm: 11.1, albedo: 0.07, a: 9375, e: 0.0151, w: 150.057, M: 91.059, i: 1.075, node: 207.784,
    n: 1128.8447569, pw: 1.131, pnode: 2.262, ra: 317.671, dec: 52.885 },
  { name: 'Deimos', radiusKm: 6.2, albedo: 0.07, a: 23458, e: 0.0002, w: 260.729, M: 325.329, i: 1.788, node: 24.525,
    n: 285.161879, pw: 27.0, pnode: 54.536, ra: 316.657, dec: 53.529 },
];

/** Position of a Mars moon relative to Mars, EQJ, km. */
function marsMoon(m, t) {
  const d = t.tt; // days since J2000 TT
  const yr = d / 365.25;
  const w = rad(m.w + (360 * yr) / m.pw);
  const node = rad(m.node - (360 * yr) / m.pnode); // nodes regress
  let M = rad((m.M + m.n * d) % 360);
  M = M < 0 ? M + 2 * Math.PI : M;
  let E = M;
  for (let k = 0; k < 6; k++) E -= (E - m.e * Math.sin(E) - M) / (1 - m.e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + m.e) * Math.sin(E / 2), Math.sqrt(1 - m.e) * Math.cos(E / 2));
  const r = m.a * (1 - m.e * Math.cos(E));
  const u = w + nu; const inc = rad(m.i);
  // in the Laplace-plane frame (x towards its ascending node on Earth's J2000 equator)
  const p = {
    x: r * (Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(inc)),
    y: r * (Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(inc)),
    z: r * Math.sin(u) * Math.sin(inc),
  };
  const P = fromRaDec(m.ra, m.dec);
  const Q = norm(cross({ x: 0, y: 0, z: 1 }, P));
  const R = cross(P, Q);
  return add(add(scale(Q, p.x), scale(R, p.y)), scale(P, p.z));
}

// ---- the sky ----------------------------------------------------------------------------

/**
 * Sky at time `date` from (lat, lon) on `world` ('moon' | 'mars', radius in m).
 * Directions are unit vectors in local east/north/up. Returns
 *   sun: { dir, radiusDeg }, earth: { dir, km, lit, sunDir, radiusDeg },
 *   moons: [{ name, dir, km, radiusDeg, lit, sunDir }] (Mars), solarTime (local hours 0-24)
 */
export function skyAt(world, radiusM, date, lat, lon) {
  if (world === 'earth') return earthSky(date, lat, lon);
  const t = A.MakeTime(date);
  const B = bodyAxes(world, t);
  const L = localAxes(lat, lon);
  let sunC; let earthC; // Sun and Earth seen from the world's centre, EQJ, AU
  if (world === 'moon') {
    const moon = A.GeoMoon(t);
    sunC = sub(A.GeoVector(A.Body.Sun, t, true), moon);
    earthC = scale(moon, -1);
  } else {
    const mars = A.HelioVector(A.Body.Mars, t);
    sunC = scale(mars, -1);
    earthC = sub(A.HelioVector(A.Body.Earth, t), mars);
  }
  const obs = fromBody(scale(L.u, radiusM / 1000 / KM_PER_AU), B); // the observer, from the centre
  const local = (v) => norm(toLocal(toBody(v, B), L));
  const sunV = sub(sunC, obs);
  const earthV = sub(earthC, obs);
  const earthKm = len(earthV) * KM_PER_AU;
  // Earth's phase: angle at Earth between the Sun and us
  const earthToSun = sub(sunC, earthC); const earthToUs = scale(earthC, -1);
  const earthLit = (1 + dot(norm(earthToSun), norm(earthToUs))) / 2;
  const sunKm = len(sunV) * KM_PER_AU;

  const moons = world !== 'mars' ? [] : MARS_MOONS.map((m) => {
    const pos = scale(marsMoon(m, t), 1 / KM_PER_AU); // AU, from Mars' centre
    const v = sub(pos, obs);
    const km = len(v) * KM_PER_AU;
    const toSun = sub(sunC, pos);
    return {
      name: m.name, dir: local(v), km, radiusDeg: deg(Math.asin(m.radiusKm / km)),
      lit: (1 + dot(norm(toSun), norm(scale(v, -1)))) / 2, sunDir: local(toSun),
    };
  });

  // local solar time: 12:00 when the Sun is due south/north (crosses the meridian)
  const sb = norm(toBody(sunC, B));
  const subSolarLon = deg(Math.atan2(sb.y, sb.x));
  const solarTime = (((lon - subSolarLon) / 15 + 12) % 24 + 24) % 24;

  return {
    sun: { dir: local(sunV), radiusDeg: deg(Math.asin(SUN_RADIUS_KM / sunKm)), km: sunKm },
    earth: { dir: local(earthV), km: earthKm, lit: earthLit, sunDir: local(earthToSun), radiusDeg: deg(Math.asin(EARTH_RADIUS_KM / earthKm)) },
    moons,
    solarTime,
  };
}

// Earth: astronomy-engine's own observer functions (true equator of date, Earth's rotation,
// atmospheric refraction). Same result shape, with `earth: null` and the Moon as the one moon.
const MOON_RADIUS_KM = 1737.4;
function earthSky(date, lat, lon) {
  const t = A.MakeTime(date);
  const obs = new A.Observer(lat, lon, 0);
  const look = (body) => {
    const eq = A.Equator(body, t, obs, true, true);
    const h = A.Horizon(t, obs, eq.ra, eq.dec, 'normal');
    const az = rad(h.azimuth); const el = rad(h.altitude);
    return { dir: { x: Math.cos(el) * Math.sin(az), y: Math.cos(el) * Math.cos(az), z: Math.sin(el) }, km: eq.dist * KM_PER_AU };
  };
  const sun = look(A.Body.Sun);
  const moon = look(A.Body.Moon);
  return {
    sun: { dir: sun.dir, radiusDeg: deg(Math.asin(SUN_RADIUS_KM / sun.km)), km: sun.km },
    earth: null,
    moons: [{ name: 'Moon', dir: moon.dir, km: moon.km, radiusDeg: deg(Math.asin(MOON_RADIUS_KM / moon.km)),
      lit: A.Illumination(A.Body.Moon, t).phase_fraction, sunDir: sun.dir }],
    // hour angle 0 = the Sun on the meridian = 12:00 local solar time
    solarTime: (A.HourAngle(A.Body.Sun, t, obs) + 12) % 24,
  };
}

/** Sub-solar and sub-Earth points (deg), for checking. */
export function subPoints(world, date) {
  const s = skyAt(world, 0, date, 0, 0); // from the centre: local axes at 0,0 are body axes rotated
  const ll = (d) => [deg(Math.asin(d.y)), deg(Math.atan2(d.x, d.z))]; // local axes at 0,0: east = body y, north = body z, up = body x
  return { sun: ll(s.sun.dir), earth: ll(s.earth.dir) };
}

/**
 * When the Sun next crosses the flat horizon (elevation 0) from `date`, searching up to
 * `days` in steps of `stepH` hours, then refining. Returns { date, rising } or null.
 */
export function nextSunCrossing(world, radiusM, date, lat, lon, days = 31, stepH = 1) {
  const el = (d) => skyAt(world, radiusM, d, lat, lon).sun.dir.z;
  const H = stepH * 3600e3;
  let t0 = date.getTime(); let e0 = el(date);
  for (let k = 1; k <= (days * 24) / stepH; k++) {
    const t1 = date.getTime() + k * H;
    const e1 = el(new Date(t1));
    if ((e0 > 0) !== (e1 > 0)) {
      let a = t0; let b = t1; let ea = e0;
      for (let i = 0; i < 20; i++) {
        const m = (a + b) / 2; const em = el(new Date(m));
        if ((em > 0) === (ea > 0)) { a = m; ea = em; } else b = m;
      }
      return { date: new Date(b), rising: e1 > 0 };
    }
    t0 = t1; e0 = e1;
  }
  return null;
}
