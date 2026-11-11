// Map settings for each body. radiusKm is the body's mean radius, used to
// work out how many km the screen shows. To add another planet, add an entry here
// and a matching button in index.html.
const TREK = 'https://trek.nasa.gov/tiles';

export const BODIES = {
  earth: {
    name: 'Earth',
    crs: 'EPSG3857', // standard web map projection
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    radiusKm: 6371.0,
    maxNativeZoom: 18, // deepest zoom the imagery server actually has
  },
  moon: {
    name: 'Moon',
    crs: 'EPSG4326', // NASA Trek tiles are equirectangular
    url: `${TREK}/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
    attribution: 'LRO WAC mosaic &copy; NASA/GSFC/ASU via NASA Moon Trek',
    radiusKm: 1737.4,
    maxNativeZoom: 7, // ~100 m per pixel; deeper zooms enlarge these tiles
  },
  mars: {
    name: 'Mars',
    crs: 'EPSG4326',
    url: `${TREK}/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg`,
    attribution: 'Viking MDIM 2.1 &copy; NASA/JPL/USGS via NASA Mars Trek',
    radiusKm: 3389.5,
    maxNativeZoom: 7, // ~232 m per pixel; deeper zooms enlarge these tiles
  },
};
