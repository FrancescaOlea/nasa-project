// Where the Sun and Earth are in the sky of a point on the Moon, at a given time.
//
// astronomy-engine gives positions in the J2000 equatorial frame (EQJ) and the Moon's IAU
// orientation (pole direction + spin angle of the prime meridian). From these we build the
// Moon's body-fixed axes (x = 0°N 0°E, z = north pole; the frame LOLA's maps use, to within a
// few hundred metres) and then the observer's local east / north / up.
import * as A from "astronomy-engine";

const KM_PER_AU = 149597870.7;
const MOON_R_KM = 1737.4;

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const norm = (a) => scale(a, 1 / Math.hypot(a.x, a.y, a.z));
const rad = (d) => (d * Math.PI) / 180;

/** Moon body-fixed axes in EQJ at time t. */
function moonAxes(t) {
  const axis = A.RotationAxis(A.Body.Moon, t);
  const N = norm(axis.north);
  const Q = norm(cross({ x: 0, y: 0, z: 1 }, N)); // where the Moon's equator crosses Earth's (J2000)
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

/** Azimuth (deg from north, clockwise) and elevation (deg) of a local east/north/up vector. */
export function azEl(v) {
  const d = norm(v);
  return { az: ((Math.atan2(d.x, d.y) * 180) / Math.PI + 360) % 360, el: (Math.asin(d.z) * 180) / Math.PI };
}

/**
 * Sky at time `date` from (lat, lon). Directions are unit vectors in local east/north/up.
 *   sun: { dir }, earth: { dir, km (distance), lit (illuminated fraction 0..1), sunDir (sun as seen
 *   from Earth, local frame - for drawing its phase) }
 */
export function skyAt(date, lat, lon) {
  const t = A.MakeTime(date);
  const B = moonAxes(t);
  const L = localAxes(lat, lon);
  const moon = A.GeoMoon(t);                      // Earth -> Moon, AU, EQJ
  const sunGeo = A.GeoVector(A.Body.Sun, t, true); // Earth -> Sun
  // the observer, in EQJ, relative to the Moon's centre
  const obsBody = scale(L.u, MOON_R_KM / KM_PER_AU);
  const obs = add(add(scale(B.X, obsBody.x), scale(B.Y, obsBody.y)), scale(B.Z, obsBody.z));
  const sunFromObs = sub(sub(sunGeo, moon), obs);
  const earthFromObs = sub(scale(moon, -1), obs);
  const local = (v) => norm(toLocal(toBody(v, B), L));
  const cosPhase = dot(norm(sunGeo), norm(moon)); // angle Sun-Earth-Moon
  return {
    sun: { dir: local(sunFromObs) },
    earth: {
      dir: local(earthFromObs),
      km: Math.hypot(earthFromObs.x, earthFromObs.y, earthFromObs.z) * KM_PER_AU,
      lit: (1 + cosPhase) / 2,
      sunDir: local(sunGeo),
    },
  };
}

/** Sub-solar and sub-Earth points (deg), for checking. */
export function subPoints(date) {
  const t = A.MakeTime(date);
  const B = moonAxes(t);
  const moon = A.GeoMoon(t);
  const ll = (v) => { const b = norm(toBody(v, B)); return [Math.asin(b.z) * 180 / Math.PI, Math.atan2(b.y, b.x) * 180 / Math.PI]; };
  return { sun: ll(sub(A.GeoVector(A.Body.Sun, t, true), moon)), earth: ll(scale(moon, -1)) };
}

/**
 * When the Sun next crosses the flat horizon (elevation 0) from `date`, searching up to 31 days
 * in 1-hour steps, then refining. Returns { date, rising } or null.
 */
export function nextSunCrossing(date, lat, lon) {
  const el = (d) => skyAt(d, lat, lon).sun.dir.z;
  const H = 3600e3;
  let t0 = date.getTime(); let e0 = el(date);
  for (let k = 1; k <= 31 * 24; k++) {
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
