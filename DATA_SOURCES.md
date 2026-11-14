# Data sources

All the data and imagery Planet Maps uses, with the organisation behind each. Map imagery is
streamed while you browse; the data layers are processed by `tools/build_layers.py`,
`tools/mars_thermal.py` and `tools/build_search_grid.py`.

## NASA data

**Mars**
- **MOLA elevation** (Mars Orbiter Laser Altimeter, Mars Global Surveyor): MEGDR 32 px/deg,
  `MGS-M-MOLA-5-MEGDR-L3-V1.0`, NASA Planetary Data System (PDS) Geosciences Node.
  Used for elevation, slope, relief, the thermal model and Mars sunlight (dust column).
- **MOLA MEGDR 16 px/deg** (`megt90n000eb.img`, same data set), averaged to 8 px/deg: far terrain in
  the Mars 3D view (`public/surface3d/mars_8ppd.bin`).
- **Phobos and Deimos orbits**: mean orbital elements from JPL Solar System Dynamics (planetary
  satellite mean elements, after Jacobson 2014). Approximate positions in the Mars 3D view sky.
- **TES thermal inertia** (Thermal Emission Spectrometer, Mars Global Surveyor): global night map
  2007 (N. Putzig, SwRI), `MGS-M-TES-5-TIMAP-V1.0`, PDS Geosciences. Used for "Dusty or rocky
  terrain" and the thermal model.
- **TES albedo** (Mars Global Surveyor): global albedo 8 px/deg (P. Christensen, Arizona State
  University), PDS Geosciences. Used for the thermal model.
- **Mars Odyssey Gamma Ray Spectrometer**: element maps (iron), `ODY-M-GRS-5-ELEMENTS-V1.0`,
  PDS Geosciences.
- **Mars Odyssey GRS averaged neutron data** (epithermal neutrons, ~12 Mars years),
  `ODY-M-GRS-5-AND-V2`, PDS Geosciences. Used for "Underground ice".
- **Viking MDIM 2.1 colour mosaic** (NASA/JPL/USGS), ~232 m/pixel, via NASA Mars Trek.
  Map imagery and the home-page globe; its brightness also tints the ground in the Mars 3D view.
- **CTX mosaic** (Context Camera, Mars Reconnaissance Orbiter; NASA/JPL/MSSS, Caltech Murray
  Lab global mosaic), ~5 m/pixel, served by Esri (OnMars). Close-up map imagery.

**Moon**
- **LOLA elevation** (Lunar Orbiter Laser Altimeter, Lunar Reconnaissance Orbiter): LDEM 64 px/deg,
  `LRO-L-LOLA-4-GDR-V1.0`, PDS Geosciences. Used for elevation, slope and relief.
- **LOLA polar elevation models** (LRO), 75°–90° N and S, 240 m, polar stereographic, same data
  set, PDS Geosciences. Used for crater and mountain shadows in Moon sunlight.
- **LOLA LDEM 16 px/deg** (same data set, PDS Geosciences), averaged to 8 px/deg: far terrain in the
  Moon 3D view (`public/surface3d/moon_8ppd.bin`).
- **LOLA global DEM 118 m** (`Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif`, USGS Astrogeology
  Science Center, from LRO LOLA data), read on demand by the browser: near and middle terrain in the
  Moon 3D view.
- **Diviner Global Cumulative Product** (Diviner Lunar Radiometer, LRO): surface temperature for
  96 times of day, 0.5 deg. Used for temperature, daily swing, and max./min. temperature.
- **Diviner global high-resolution mosaic, bolometric temperature at slope-adjusted midnight**
  (LRO, GHRM, `dghrm_tbol_m_70s70n`, 128 px/deg, 70°S–70°N), `urn:nasa:pds:lro_diviner_derived1`,
  PDS Geosciences. Turned into thermal inertia with a thermal model for "Dusty or rocky terrain".
- **Lunar Prospector Gamma Ray Spectrometer** element abundances (FeO), 2 deg,
  `LP-L-GRS-5-ELEM-ABUNDANCE-V1.0`, PDS Geosciences. Used for iron.
- **LRO WAC global mosaic** (Wide Angle Camera; NASA/GSFC/Arizona State University), ~100 m/pixel,
  via NASA Moon Trek. Map imagery and the home-page globe.

**Earth**
- **NASA POWER** (Prediction Of Worldwide Energy Resources, NASA Langley Research Center),
  long-term monthly climatology: `TS_MAX`, `TS_MIN`, `TS_RANGE` (ground-surface temperature),
  `PRECTOTCORR` (rainfall; from MERRA-2 / GPM), `ALLSKY_SFC_UV_INDEX` (UV; from CERES),
  `ALLSKY_SFC_SW_DWN` (sunlight reaching the ground; from CERES).
  Used for Earth's temperature, dryness, UV and sunlight layers and the analog search.

**Services**
- **NASA Mars Trek** and **NASA Moon Trek** (Solar System Treks, NASA JPL): map tile services.
- **NASA Planetary Data System, Geosciences Node** (Washington University in St. Louis): downloads.
- **USGS Astrogeology Science Center** (Planetary Maps / Annex): the 118 m Moon DEM and the 200 m
  Mars DEM, served to the browser.

## Partner data

- **Mars HRSC + MOLA blended DEM** (`Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif`; ESA/DLR/FU Berlin
  High Resolution Stereo Camera on Mars Express, blended with NASA MOLA; USGS Astrogeology Science
  Center), 200 m, read on demand by the browser: near and middle terrain in the Mars 3D view.
- **Kaguya Terrain Camera ortho mosaic** (JAXA / SELENE), ~21 m/pixel, via NASA Moon Trek.
  Close-up Moon imagery.
- **NOAA ETOPO 2022** global relief model, 60 arc-seconds (NOAA National Centers for Environmental
  Information; includes NASA SRTM data). Earth elevation, slope, relief, land mask and the analog
  search.
- **Esri World Imagery** (Esri, Maxar, Earthstar Geographics). Earth satellite imagery, also the
  ground texture in the Earth 3D view.
- **NASADEM** (NASA JPL, reprocessed SRTM Space Shuttle radar data), 1 arc second, 60° N–56° S, as
  cloud-optimised GeoTIFFs on Microsoft Planetary Computer (`nasadem` collection), read on demand by
  the browser: terrain in the Earth 3D view.
- **AWS Terrain Tiles** (Registry of Open Data on AWS; Mapzen/Tilezen, from SRTM, GMTED, ETOPO1 and
  national models). Earth 3D view terrain north of 60° N and south of 56° S.

## Software

- Leaflet (maps), three.js (3D globes and the Moon / Mars / Earth 3D views), astronomy-engine (Sun, Earth,
  Moon and Mars positions and rotation), geotiff.js (reading the DEM file layout), Vite (build); Python with NumPy, SciPy, Numba,
  Pillow and tifffile for data processing.
