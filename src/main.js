import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { BODIES } from './bodies.js';

const home = document.getElementById('home');
const mapView = document.getElementById('map-view');
let map = null;

// Closest you can zoom: about this many km across the screen.
const MIN_VIEW_KM = 1;

// Paint each home-page globe with real imagery of that body.
document.querySelectorAll('.body-btn').forEach((btn) => {
  const body = BODIES[btn.dataset.body];
  const globe = btn.querySelector('.globe');
  const img = new Image();
  img.onload = () => globe.style.setProperty('--texture', `url("${body.preview}")`);
  img.src = body.preview; // if it fails, the CSS fallback colour stays
  btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.body}`; });
});

document.getElementById('back').addEventListener('click', () => { location.hash = ''; });

// Leaflet's EPSG4326 maps 360° to 512 px at zoom 0; web mercator to 256 px.
const basePx = (body) => (body.crs === 'EPSG4326' ? 512 : 256);
const circumferenceKm = (body) => 2 * Math.PI * body.radiusKm;

// Zoom level at which the screen width spans MIN_VIEW_KM at the equator.
function maxZoomFor(body, screenPx) {
  return Math.round(Math.log2((screenPx * circumferenceKm(body)) / (basePx(body) * MIN_VIEW_KM)));
}

// Real-world width of the current view, measured along the centre latitude.
function viewWidthKm(body) {
  const b = map.getBounds();
  const degrees = Math.min(b.getEast() - b.getWest(), 360);
  return (degrees / 360) * circumferenceKm(body) * Math.cos((map.getCenter().lat * Math.PI) / 180);
}

function formatKm(km) {
  if (km >= 100) return `${Math.round(km).toLocaleString()} km`;
  if (km >= 1) return `${km.toFixed(1)} km`;
  return `${Math.round(km * 1000)} m`;
}

function openMap(key) {
  const body = BODIES[key];
  home.hidden = true;
  mapView.hidden = false;
  document.title = `${body.name} · Planet Maps`;

  const minZoom = body.crs === 'EPSG4326' ? 0 : 1;
  map = L.map('map', {
    crs: L.CRS[body.crs],
    center: [0, 0],
    zoom: minZoom + 1,
    minZoom,
    maxZoom: maxZoomFor(body, window.innerWidth),
    worldCopyJump: true,
    zoomControl: false,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  L.tileLayer(body.url, {
    attribution: body.attribution,
    maxNativeZoom: body.maxNativeZoom,
    maxZoom: 30,
    noWrap: body.crs === 'EPSG4326',
  }).addTo(map);

  // Zoom readout in the bottom-left corner.
  const Readout = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'zoom-readout');
      const update = () => {
        const factor = 2 ** (map.getZoom() - minZoom);
        el.innerHTML = `<strong>×${factor.toLocaleString()}</strong>` +
          `<span>${formatKm(viewWidthKm(body))} across</span>`;
      };
      map.on('zoomend moveend resize', update);
      update();
      return el;
    },
  });
  new Readout({ position: 'bottomleft' }).addTo(map);

  map.on('resize', () => map.setMaxZoom(maxZoomFor(body, map.getSize().x)));
}

function showHome() {
  mapView.hidden = true;
  home.hidden = false;
  document.title = 'Planet Maps';
}

// The URL hash decides the page (#/earth, #/moon, #/mars), so the
// browser's back button also returns to the main page.
function route() {
  const key = location.hash.replace('#/', '');
  if (map) { map.remove(); map = null; }
  if (BODIES[key]) openMap(key); else showHome();
}

window.addEventListener('hashchange', route);
route();
