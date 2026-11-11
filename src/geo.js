// Small geometry helpers that work on any sphere (Earth, Moon, Mars).

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

// Points of a circle `radiusKm` around (lat, lon) on a sphere of `sphereKm`.
// Longitudes are not wrapped, so a circle crossing ±180° stays in one piece.
export function circlePoints(lat, lon, radiusKm, sphereKm, steps = 96) {
  const d = radiusKm / sphereKm; // angular distance
  const φ1 = rad(lat);
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const θ = (2 * Math.PI * i) / steps;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(θ));
    const dλ = Math.atan2(Math.sin(θ) * Math.sin(d) * Math.cos(φ1),
      Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
    pts.push([deg(φ2), lon + deg(dλ)]);
  }
  return pts;
}

// 18.4400° N, 77.4500° E  (4 decimals ≈ 6 m on Mars)
export function formatLatLon(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}
