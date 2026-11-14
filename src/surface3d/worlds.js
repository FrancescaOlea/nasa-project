// Per-world settings for the 3D surface view.
export const WORLDS = {
  moon: {
    name: 'Moon',
    radius: 1737400, // m, reference sphere of the heights
    far: 'moon_8ppd.bin',
    // LOLA global DEM, 256 px/degree (118 m), int16 x 0.5 m, one strip per row (USGS Astrogeology)
    dem: { url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif',
      width: 92160, height: 46080, scale: 0.5, midStep: 4, label: 'NASA LOLA laser altimeter', detailM: 120 },
    farHalf: 250000,
    imagery: null, // the global mosaics have strong shading baked in: plain grey reads better
    ground: [0.62, 0.61, 0.6],
    rock: 0x9a948c,
    craters: { near: 220, foot: 1400 },
    rocks: 900,
    atmosphere: null,
    speeds: [1, 6, 24],      // simulated hours per real second
    range: { hours: 360, step: 1 }, // the time slider: ±15 days
    dayName: 'lunar day',
  },
  mars: {
    name: 'Mars',
    radius: 3396190,
    far: 'mars_8ppd.bin',
    // HRSC + MOLA blended DEM, ~200 m (0.00337°), int16 m above the areoid, one strip per row (USGS Astrogeology)
    dem: { url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif',
      width: 106694, height: 53347, scale: 1, midStep: 2, label: 'HRSC camera + MOLA laser altimeter', detailM: 200 },
    farHalf: 400000,
    // Viking colour mosaic (NASA Mars Trek): its brightness shows dark basalt vs bright dust
    // (meanLum: a typical brightness, which keeps the ground at its plain colour)
    imagery: { url: 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
      maxZoom: 7, meanLum: 0.3 },
    ground: [0.56, 0.35, 0.23],
    rock: 0x7d5a46,
    craters: { near: 120, foot: 500 },
    rocks: 1500,
    // dusty air: butterscotch sky, blue glow round the Sun at dusk, haze over distance
    atmosphere: { tau: 0.5, zenith: [0.62, 0.45, 0.31], horizon: [0.83, 0.66, 0.5], glow: [0.55, 0.68, 0.92],
      hazeKm: 45 },
    speeds: [0.25, 1, 3],
    range: { hours: 72, step: 0.25 }, // about ±3 sols
    dayName: 'sol',
  },
  earth: {
    name: 'Earth',
    radius: 6371000,
    far: null, // no bundled file: the far ring comes from the AWS terrain tiles (dem.js)
    // NASA NASADEM, 1 arc second (~30 m); mid ring every 8th sample (~240 m)
    dem: { source: 'nasadem', midStep: 8, label: 'NASA NASADEM, from the Space Shuttle’s radar', detailM: 30 },
    farHalf: 150000,
    // true-colour satellite images as the ground texture (Esri World Imagery, ~1 m in most deserts)
    imagery: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',
      maxZoom: 17, texture: true },
    ground: [0.55, 0.45, 0.34],
    rock: 0x8f7a64,
    craters: { near: 0, foot: 0 },
    rocks: 500,
    // clear desert air: blue sky, orange glow at sunset
    atmosphere: { tau: 0.12, zenith: [0.2, 0.4, 0.85], horizon: [0.7, 0.8, 0.92], glow: [1.0, 0.55, 0.25],
      hazeKm: 90 },
    speeds: [0.25, 1, 3],
    range: { hours: 72, step: 0.25 }, // ±3 days
    dayName: 'day',
  },
};
