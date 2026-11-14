// Ruler: measure the distance between two points on the map (not areas).
//
// The ruler button sits in the zoom bar. While measuring, every other function of the
// map page is switched off (selection, panels, buttons, result markers); only moving and
// zooming the map still work, so you can find your points. Click a start point, move the
// cursor (a line follows with the live distance), click an end point: the distance stays
// on screen. The next click starts a new measurement. The X (or Esc) ends measuring.
//
// Distances are great-circle distances on the body's sphere, and the line follows the
// great circle, so it is correct in every projection.
import L from 'leaflet';

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
let active = false;

/** True while the ruler is on; other click handlers should ignore clicks then. */
export const isMeasuring = () => active;

function distanceKm(R, a, b) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Points along the great circle from a to b (longitudes kept continuous, so the line
// doesn't jump across the map at 180 deg)
function greatCircle(a, b, n = 64) {
  const v = (p) => [Math.cos(rad(p.lat)) * Math.cos(rad(p.lng)), Math.cos(rad(p.lat)) * Math.sin(rad(p.lng)), Math.sin(rad(p.lat))];
  const A = v(a); const B = v(b);
  const omega = Math.acos(Math.min(1, Math.max(-1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
  if (omega < 1e-9) return [a, b];
  const pts = [];
  let prevLon = a.lng;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
    const s2 = Math.sin(t * omega) / Math.sin(omega);
    const x = s1 * A[0] + s2 * B[0]; const y = s1 * A[1] + s2 * B[1]; const z = s1 * A[2] + s2 * B[2];
    let lon = deg(Math.atan2(y, x));
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    pts.push(L.latLng(deg(Math.atan2(z, Math.hypot(x, y))), lon));
  }
  return pts;
}

export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(km < 10 ? 2 : 1)} km`;
  return `${Math.round(km).toLocaleString()} km`;
}

/**
 * Adds the ruler to a map. `button` is the ruler button element, `panel` the measurement
 * panel (with .ruler-text and .ruler-close inside), `root` the element that gets the
 * `measuring` class (it greys out and disables everything else via CSS), `radiusKm` the
 * body's radius, `inside(e)` optionally rejects clicks off the planet (polar maps).
 */
export function addRuler(map, { button, panel, root, radiusKm, inside }) {
  const text = panel.querySelector('.ruler-text');
  const group = L.layerGroup();
  let start = null;
  let end = null;
  let line = null;

  const say = (html) => { text.innerHTML = html; };
  const draw = (a, b) => {
    const pts = greatCircle(a, b);
    if (line) line.setLatLngs(pts);
    else line = L.polyline(pts, { className: 'ruler-line', interactive: false }).addTo(group);
  };
  const dot = (p) => L.circleMarker(p, { className: 'ruler-dot', radius: 5, interactive: false }).addTo(group);

  function reset() {
    group.clearLayers();
    line = null; start = null; end = null;
    say('Click a <strong>start point</strong> on the map.');
  }
  function onClick(e) {
    if (inside && !inside(e)) return;
    if (!start || end) { // begin a new measurement
      reset();
      start = e.latlng;
      dot(start);
      say('Move the cursor and click an <strong>end point</strong>.');
      return;
    }
    end = e.latlng;
    dot(end);
    draw(start, end);
    say(`Distance: <strong>${formatDistance(distanceKm(radiusKm, start, end))}</strong>
      <span class="ruler-hint">Click again to measure another distance.</span>`);
  }
  function onMove(e) {
    if (!start || end) return;
    draw(start, e.latlng);
    say(`<strong>${formatDistance(distanceKm(radiusKm, start, e.latlng))}</strong>
      <span class="ruler-hint">Click to set the end point.</span>`);
  }
  const onKey = (e) => { if (e.key === 'Escape') stop(); };

  function begin() {
    if (active) return;
    active = true;
    root.classList.add('measuring');
    button.setAttribute('aria-pressed', 'true');
    panel.hidden = false;
    group.addTo(map);
    reset();
    map.getContainer().classList.add('ruler-cursor');
    map.on('click', onClick);
    map.on('mousemove', onMove);
    document.addEventListener('keydown', onKey);
  }
  function stop() {
    if (!active) return;
    active = false;
    root.classList.remove('measuring');
    button.setAttribute('aria-pressed', 'false');
    panel.hidden = true;
    group.remove();
    group.clearLayers();
    line = null; start = null; end = null;
    map.getContainer().classList.remove('ruler-cursor');
    map.off('click', onClick);
    map.off('mousemove', onMove);
    document.removeEventListener('keydown', onKey);
  }

  button.onclick = (e) => { e.preventDefault(); begin(); }; // (replaces the previous map's handler)
  panel.querySelector('.ruler-close').onclick = stop;
  map.on('unload', stop); // map removed (page change): leave measuring mode
  return { begin, stop };
}
