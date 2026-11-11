// Coloured data overlays (terrain slope, roughness, ...) drawn over a map.
//
// The data comes as 8-bit grayscale tiles made by tools/build_terrain.py:
// value 0 = no data, 1..255 = position between `min` and `max` on a linear
// or logarithmic scale (described in public/overlays/index.json). The browser
// turns those values into colours, low = blue, high = red.
import L from 'leaflet';

const BASE = `${import.meta.env.BASE_URL}overlays`;
export const OVERLAY_OPACITY = 0.6;

// The views, in menu order. Each body's own description (data source,
// resolution) comes from public/overlays/index.json.
// `short` is the label on the menu button; `name` is used in the legend and tooltip.
export const VIEWS = {
  elevation: { name: 'Elevation', short: 'Elevation' },
  slope: { name: 'Terrain slope', short: 'Slope' },
  surface: { name: 'Dusty or rocky terrain', short: 'Dust / rock' },
  iron: { name: 'Minerals: iron content', short: 'Iron' },
  ice: { name: 'Underground ice', short: 'Ice' },
  temperature: { name: 'Temperature', short: 'Temperature' },
  temp_range: { name: 'Daily temperature variation', short: 'Daily temp. swing' },
  temp_yearly: { name: 'Maximum temperature variation', short: 'Yearly temp. range' },
};

let indexPromise = null;
export function loadIndex() {
  indexPromise ??= fetch(`${BASE}/index.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return indexPromise;
}

// Blue -> light grey -> red ("cool-warm"), easy to read over imagery.
const STOPS = [
  [0.0, [49, 54, 149]], [0.15, [69, 117, 180]], [0.3, [116, 173, 209]], [0.45, [224, 243, 248]],
  [0.55, [254, 224, 144]], [0.7, [253, 174, 97]], [0.85, [244, 109, 67]], [1.0, [165, 0, 38]],
];
function colourAt(t) {
  for (let i = 1; i < STOPS.length; i++) {
    const [t1, c1] = STOPS[i];
    const [t0, c0] = STOPS[i - 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}
// Lookup table: tile value (0..255) -> RGBA
const LUT = new Uint8ClampedArray(256 * 4);
for (let v = 1; v < 256; v++) {
  LUT.set([...colourAt((v - 1) / 254), 255], v * 4);
}
export const GRADIENT_CSS = `linear-gradient(to right, ${STOPS.map(([t, c]) => `rgb(${c}) ${t * 100}%`).join(', ')})`;

// Decoded data tiles, shared between zoom levels (small cache).
const images = new Map();
function loadImage(url) {
  if (!images.has(url)) {
    if (images.size > 400) images.delete(images.keys().next().value);
    images.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    }));
  }
  return images.get(url);
}

const DataTiles = L.GridLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 256;
    // Past the data's own detail, take the matching part of a coarser tile and
    // enlarge it smoothly *before* colouring, so it doesn't turn into squares.
    const dz = Math.max(0, coords.z - this.options.nativeZoom);
    const n = 2 ** dz;
    const size = 256 / n;
    const src = `${this.options.url}/${coords.z - dz}/${Math.floor(coords.y / n)}/${Math.floor(coords.x / n)}.${this.options.format}`;
    loadImage(src).then((img) => {
      const ctx = tile.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (coords.x % n) * size, (coords.y % n) * size, size, size, 0, 0, 256, 256);
      const data = ctx.getImageData(0, 0, 256, 256);
      const px = data.data;
      // Layers covering only part of the globe are cut at a clean latitude line.
      const { latMin, latMax } = this.options;
      const degPerRow = 180 / 2 ** coords.z / 256;
      for (let r = 0; r < 256; r++) {
        const lat = 90 - (coords.y * 256 + r + 0.5) * degPerRow;
        const inside = lat >= latMin && lat <= latMax;
        for (let i = r * 1024, end = i + 1024; i < end; i += 4) {
          const v = inside ? px[i] * 4 : 0; // LUT entry 0 is fully transparent
          px[i] = LUT[v]; px[i + 1] = LUT[v + 1]; px[i + 2] = LUT[v + 2]; px[i + 3] = LUT[v + 3];
        }
      }
      ctx.putImageData(data, 0, 0);
      done(null, tile);
    }).catch(() => done(null, tile)); // missing tile: leave it transparent
    return tile;
  },
});

export function createOverlay(body, view, meta, pane) {
  return new DataTiles({
    url: `${BASE}/${body}/${view}`,
    format: meta.format ?? 'png',
    latMin: meta.lat_min ?? -90,
    latMax: meta.lat_max ?? 90,
    pane,
    opacity: OVERLAY_OPACITY,
    nativeZoom: meta.max_zoom, // deepest level that has its own data tiles
    maxZoom: 30,
    noWrap: true,
    bounds: [[-90, -180], [90, 180]],
  });
}

// Tick values for the legend.
function ticks(meta) {
  if (meta.log) {
    const out = [];
    for (let e = Math.floor(Math.log10(meta.min)); 10 ** e <= meta.max; e++) {
      const v = Number((10 ** e).toPrecision(2)); // powers of ten only, so labels don't crowd
      if (v >= meta.min && v <= meta.max) out.push(v);
    }
    // label both ends of the scale too, unless a tick is already close
    if (position(meta, out[0]) - position(meta, meta.min) > 0.12) out.unshift(meta.min);
    if (position(meta, meta.max) - position(meta, out[out.length - 1]) > 0.12) out.push(meta.max);
    return out;
  }
  // linear: a "nice" step giving 4-6 labels
  const span = meta.max - meta.min;
  const step = [1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500].find((s) => span / s <= 5) ?? span;
  const out = [];
  for (let v = Math.ceil(meta.min / step) * step; v <= meta.max + 1e-9; v += step) out.push(Number(v.toPrecision(6)));
  return out;
}

function position(meta, v) {
  if (meta.log) return (Math.log10(v) - Math.log10(meta.min)) / (Math.log10(meta.max) - Math.log10(meta.min));
  return (v - meta.min) / (meta.max - meta.min);
}

export function legendHtml(view, meta) {
  const marks = ticks(meta).map((v, i, all) => {
    const unit = meta.unit === '°' || meta.unit === '%' ? meta.unit : ` ${meta.unit}`;
    const label = `${v}${unit}${i === all.length - 1 && v === meta.max && meta.log ? '+' : ''}`;
    return `<span style="left:${(position(meta, v) * 100).toFixed(1)}%">${label}</span>`;
  }).join('');
  return `
    <div class="legend-title">${VIEWS[view].name}</div>
    <div class="legend-bar" style="background:${GRADIENT_CSS}"></div>
    <div class="legend-ticks">${marks}</div>
    <div class="legend-note">${meta.log ? 'Logarithmic' : 'Linear'} scale · ~${meta.pixel_km >= 10 ? Math.round(meta.pixel_km) : meta.pixel_km} km pixels</div>`;
}
