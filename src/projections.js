// Map projections: how the round planet is flattened onto the screen.
//
// Every projection here provides the same small interface:
//   crs                 the Leaflet CRS (lat/lon <-> map pixels, tile grid)
//   toWorld(lat, lon)   -> [u, v], position on the whole map, 0..1 (u right, v down)
//   fromWorld(u, v)     -> [lat, lon]
//   kmPerPxAtZoom0(R)   size of one map pixel at zoom 0, on a planet of radius R km
//                       (at the equator for the cylindrical maps, at the pole for polar ones)
//   minZoom(size)       zoom at which the map just fills (or, for polar, fits) the screen
//   bounds              lat/lon limits for Leaflet's maxBounds (null = clamp manually)
//   center              default centre
//   cylindrical         true for equirectangular / Mercator
//
// The map sources (NASA Trek, Esri, our data tiles) are never changed; when a
// projection differs from a source's own, the tiles are warped in the browser
// (see reproject.js).
import L from 'leaflet';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const MERCATOR_MAX_LAT = 85.0511; // Mercator can't reach the poles
export const POLAR_EDGE_LAT = 60;        // polar maps reach this latitude at the middle of each edge
const RHO_MAX = 2 * Math.tan(rad(90 - POLAR_EDGE_LAT) / 2);

export const PROJECTIONS = {
  equirect: { name: 'Equirectangular', short: 'Equirectangular' },
  mercator: { name: 'Mercator', short: 'Mercator' },
  north: { name: 'North polar (stereographic)', short: 'North pole' },
  south: { name: 'South polar (stereographic)', short: 'South pole' },
};

const mercV = (lat) => {
  const phi = rad(Math.max(-MERCATOR_MAX_LAT, Math.min(MERCATOR_MAX_LAT, lat)));
  return (1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2;
};
const mercLat = (v) => deg(Math.atan(Math.sinh(Math.PI * (1 - 2 * v))));

const equirect = {
  id: 'equirect',
  crs: L.CRS.EPSG4326, // 360 x 180 degrees -> 512 x 256 px at zoom 0
  cylindrical: true,
  toWorld: (lat, lon) => [(lon + 180) / 360, (90 - lat) / 180],
  fromWorld: (u, v) => [90 - v * 180, u * 360 - 180],
  kmPerPxAtZoom0: (R) => (2 * Math.PI * R) / 512,
  minZoom: (size) => Math.log2(Math.max(size.x / 512, size.y / 256)),
  bounds: [[-90, -180], [90, 180]],
  center: [0, 0],
};

const mercator = {
  id: 'mercator',
  crs: L.CRS.EPSG3857, // square world, 256 px at zoom 0
  cylindrical: true,
  toWorld: (lat, lon) => [(lon + 180) / 360, mercV(lat)],
  fromWorld: (u, v) => [mercLat(v), u * 360 - 180],
  kmPerPxAtZoom0: (R) => (2 * Math.PI * R) / 256,
  minZoom: (size) => Math.log2(Math.max(size.x, size.y) / 256),
  bounds: [[-MERCATOR_MAX_LAT, -180], [MERCATOR_MAX_LAT, 180]],
  center: [0, 0],
};

// Polar stereographic on a unit sphere: distance from the pole on the map
// rho = 2 tan(c / 2), c = angle from the pole. Shapes are kept (conformal) and the
// pole is undistorted. North: 0 deg longitude points down; south: 0 deg points up
// (the usual orientation of polar maps); 90 deg E is to the right on both.
function polarXY(north, lat, lon) {
  const c = rad(north ? 90 - lat : 90 + lat);
  const rho = 2 * Math.tan(c / 2);
  const l = rad(lon);
  return [rho * Math.sin(l), north ? rho * Math.cos(l) : -rho * Math.cos(l)];
}
function polarLatLon(north, x, y) {
  const rho = Math.hypot(x, y);
  const c = 2 * Math.atan(rho / 2);
  const lon = deg(Math.atan2(x, north ? y : -y));
  return [north ? 90 - deg(c) : deg(c) - 90, lon];
}

function polar(north) {
  const projection = {
    project: (ll) => { const [x, y] = polarXY(north, ll.lat, ll.lng); return L.point(x, y); },
    unproject: (p) => { const [lat, lon] = polarLatLon(north, p.x, p.y); return L.latLng(lat, lon); },
    bounds: L.bounds([-RHO_MAX, -RHO_MAX], [RHO_MAX, RHO_MAX]),
  };
  const crs = L.extend({}, L.CRS, {
    code: north ? 'POLAR-N' : 'POLAR-S',
    projection,
    // map the square [-RHO_MAX, RHO_MAX] onto the 256 px world at zoom 0
    transformation: new L.Transformation(1 / (2 * RHO_MAX), 0.5, 1 / (2 * RHO_MAX), 0.5),
    infinite: false,
    wrapLng: null,
    wrapLat: null,
  });
  return {
    id: north ? 'north' : 'south',
    crs,
    cylindrical: false,
    toWorld: (lat, lon) => {
      const [x, y] = polarXY(north, lat, lon);
      return [x / (2 * RHO_MAX) + 0.5, y / (2 * RHO_MAX) + 0.5];
    },
    fromWorld: (u, v) => polarLatLon(north, (u - 0.5) * 2 * RHO_MAX, (v - 0.5) * 2 * RHO_MAX),
    // near the pole one unit of rho is one planet radius
    kmPerPxAtZoom0: (R) => (2 * RHO_MAX * R) / 256,
    minZoom: (size) => Math.log2(Math.min(size.x, size.y) / 256),
    bounds: null,
    center: [north ? 90 : -90, 0],
  };
}

const ALL = { equirect, mercator, north: polar(true), south: polar(false) };
export const projection = (id) => ALL[id] ?? equirect;
