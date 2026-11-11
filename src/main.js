import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { BODIES } from './bodies.js';

const home = document.getElementById('home');
const mapView = document.getElementById('map-view');
let map = null;

// Closest you can zoom: about this many km across the screen.
const MIN_VIEW_KM = 1;

document.querySelectorAll('.body-btn').forEach((btn) => {
  btn.addEventListener('click', () => { location.hash = `#/${btn.dataset.body}`; });
});

document.getElementById('back').addEventListener('click', () => { location.hash = ''; });

// Leaflet's EPSG4326 maps 360° to 512 px at zoom 0; web mercator to 256 px.
const basePx = (body) => (body.crs === 'EPSG4326' ? 512 : 256);
const circumferenceKm = (body) => 2 * Math.PI * body.radiusKm;

// Zoom level at which the screen width spans MIN_VIEW_KM at the equator.
function maxZoomFor(body, size) {
  return Math.log2((size.x * circumferenceKm(body)) / (basePx(body) * MIN_VIEW_KM));
}

// Most zoomed-out level: the map just fills the whole screen, no black edges.
// (Equirectangular maps are twice as wide as tall; web mercator is square.)
function minZoomFor(body, size) {
  const w = basePx(body);
  const h = body.crs === 'EPSG4326' ? w / 2 : w;
  return Math.log2(Math.max(size.x / w, size.y / h));
}

// The edges of the map, so it can't repeat or be dragged off screen.
const MAP_BOUNDS = {
  EPSG3857: [[-85.0511, -180], [85.0511, 180]],
  EPSG4326: [[-90, -180], [90, 180]],
};

// Real-world width of the current view, measured along the centre latitude.
function viewWidthKm(body) {
  const b = map.getBounds();
  const degrees = Math.min(b.getEast() - b.getWest(), 360);
  return (degrees / 360) * circumferenceKm(body) * Math.cos((map.getCenter().lat * Math.PI) / 180);
}

function formatKm(km) {
  const m = Math.round(km * 1000);
  if (m < 1000) return `${m} m`;
  if (km >= 100) return `${Math.round(km).toLocaleString()} km`;
  return `${km.toFixed(1)} km`;
}

function openMap(key) {
  const body = BODIES[key];
  home.hidden = true;
  mapView.hidden = false;
  document.title = `${body.name} · Planet Maps`;

  const screen = { x: window.innerWidth, y: window.innerHeight };
  map = L.map('map', {
    crs: L.CRS[body.crs],
    center: [0, 0],
    zoom: minZoomFor(body, screen),
    minZoom: minZoomFor(body, screen),
    maxZoom: maxZoomFor(body, screen),
    zoomSnap: 0, // smooth zooming; the +/- buttons still step by 2x
    zoomDelta: 1,
    wheelPxPerZoomLevel: 120,
    maxBounds: MAP_BOUNDS[body.crs],
    maxBoundsViscosity: 1.0, // hard stop at the map edges
    zoomControl: false,
  });
  if (import.meta.env.DEV) window.map = map; // handy for debugging in the browser console
  L.control.zoom({ position: 'topright' }).addTo(map);
  body.layers.forEach((layer, i) => {
    // Each layer gets its own pane so it can have its own blend/filter.
    const pane = `layer${i}`;
    const el = map.createPane(pane);
    el.style.zIndex = 200 + i;
    if (layer.filter) el.style.filter = layer.filter;
    L.tileLayer(layer.url, {
      pane,
      attribution: layer.attribution,
      tileSize: layer.tileSize ?? 256,
      zoomOffset: layer.zoomOffset ?? 0,
      maxNativeZoom: layer.maxNativeZoom,
      minZoom: layer.minZoom ?? 0,
      maxZoom: 30,
      noWrap: true, // show the map once, never repeated side by side
      bounds: layer.bounds ?? MAP_BOUNDS[body.crs],
    }).addTo(map);
  });

  // Zoom readout in the bottom-left corner. ×1 = whole map filling the screen.
  const Readout = L.Control.extend({
    onAdd() {
      const el = L.DomUtil.create('div', 'zoom-readout');
      const update = () => {
        const factor = Math.round(2 ** (map.getZoom() - map.getMinZoom()));
        el.innerHTML = `<strong>×${factor.toLocaleString()}</strong>` +
          `<span>${formatKm(viewWidthKm(body))} across</span>`;
      };
      map.on('zoom move resize', update);
      update();
      return el;
    },
  });
  new Readout({ position: 'bottomleft' }).addTo(map);

  map.on('resize', () => {
    const size = map.getSize();
    map.setMinZoom(minZoomFor(body, size));
    map.setMaxZoom(maxZoomFor(body, size));
  });
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
