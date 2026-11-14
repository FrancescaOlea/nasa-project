# Planet Maps

Pick the Moon or Mars on the home page, explore its map, select an area and look for Earth analogs.

## Run it
Requires Node.js 18+ (https://nodejs.org) and Git (https://git-scm.com).

**Easiest:** double-click `start.bat` (Windows) or `start.command` (Mac).
It pulls the latest changes, installs dependencies and opens the app in your browser.
Close that window to stop the app.

Or by hand: `npm install`, then `npm run dev`.

## Using it
- Click a world on the home page to open its map; **← Home** (or the browser back button) returns.
- Zoom with the mouse wheel, pinch, or the **+ / −** buttons. The bottom-left box shows the
  zoom factor (×1 = whole map filling the screen) and how wide the view is.
  Maximum zoom is 1 km across the screen. The map doesn't repeat sideways.
- On the Moon and Mars, click anywhere to select an area; its coordinates show in the panel.
  Click elsewhere to move it.
- **Area summary** (top right, appears with a selection): every characteristic's typical value
  over the whole circle - the area-weighted median - plus its 10th-90th percentile range. Rows
  marked "regional value" use data coarser than the circle. Click a row to show that view.
  The tiles store each layer's full value range, so these are real values, not clipped to the
  colour scale.
- **Earth view / Back to Mars (Moon) view** (top right): switch between Earth and the Moon or
  Mars. Going back restores the Moon/Mars map exactly as you left it.
- **Earth** has its own views, area selection and area summary (no analog search from Earth):
  elevation, slope, daily temperature swing, maximum and minimum temperature, dryness (yearly
  rainfall; red = driest) and UV radiation. Oceans are transparent.
- **Projection** (top of the ☰ View panel, all three worlds): Equirectangular, Mercator, North
  pole or South pole (azimuthal equidistant: the whole world as a disc centred on the pole, like
  the UN emblem; distances from the pole are true). The map sources
  stay the same; other projections are drawn by warping the source tiles in the browser
  (`src/reproject.js`). Selection, views, radius and the area summary carry over; the projection
  is kept in the address (`proj=`).
- **☰ View** (Moon and Mars): show one coloured data layer over the map (blue = low, red = high,
  with a legend). See *Map views* below for what's available on each body.
- Selection panel (bottom right): coordinates, the **Find** buttons and the selection **radius**
  (1, 5, 10, 25, 50, 100 or 250 km; default 10).
- Bottom-left: **Landmarks** on/off (on every time a map opens). **Find Earth analogs** searches Earth for
  the 5 places most like the selected area (see *Earth analog search* below); **Find similar spots** is
  still a placeholder.
  The selection is kept in the address (e.g. `#/mars?lat=18.44&lon=77.45&r=10&view=slope`), so links and the
  back button bring it back.
- The home page shows spinning 3D globes of the Moon and Mars (three.js, textures made from the
  NASA Trek maps), drawn to scale. Mars turns once every 30 s; the Moon 28x slower.
  Change the speed with `MARS_SECONDS_PER_TURN` in `src/main.js`. The Earth map is reached via
  **Find Earth analogs**.

## Mars route planner (A to B)

On the Mars map, **🧭 Plan a route from A to B** (selection panel) opens the route planner.
Click the start (A), then the destination (B); drag either pin to change the route. As soon as
the route is calculated, the map zooms so the whole route fills the space next to the panel (in 3D,
the camera flies to a tilted view of the route, centred between the panels). It finds
three routes and shows what's dangerous on each:

| Route | What it minimises |
|---|---|
| **Safest** (orange) | distance x (1 + hazards): steep slopes ×3, crater rims ×1.5, rough ground ×1.5, loose dust ×1 (rover ×2), dust storms ×1 |
| **Easiest** (green) | on foot: walking time (Tobler's hiking function on the up/down grade); rover: distance + 10 × uphill grade + loose dust |
| **Shortest** (blue) | kilometres |

All three avoid ground steeper than the traveller's limit: **20°** on foot (NASA xEVA spacesuit
concept of operations, EVA-EXP-0042) and **25°** for a rover (Curiosity's steepest tilt in 7 years,
25.3°; Rankin et al., JPL). Slopes over **15°** count as "caution" (Mars 2020's "benign terrain" limit;
Apollo walking traverses stayed under it). Options: who travels, and the **season** (dropdown next
to the A / B coordinates: Ls 0–90°, 90–180°, 180–270°, 270–360°; dust storms depend on it).
Each traveller's specs and its **model assumptions** are in the collapsible profile (▾ specs).

For the chosen route the panel shows: distance, time (walking hours or rover driving sols at
Curiosity's average ~29 m per drive), climb and descent, elevation range, steepest slope and
km over 15°, crater rims crossed with the deepest crater's depth, km of loose dust, how often dust
storms cover the route in that season, the coldest night, an elevation profile coloured by slope
(hover to find the spot on the map) and a list of dangers with map markers. Each number says
whether it's *measured* (spacecraft data), from the *catalog*, *observed* or a *model*.

How it works (`src/route/`):
- `grid.js` cuts a box around A and B (a third of the distance added on every side) into cells as
  fine as the slope data (~2.6 km), coarser for long routes (at most 220,000 cells). Each cell reads
  the same data tiles as the map's views: steepest and mean **slope** and mean **elevation** (MOLA),
  **roughness** (relief), **loose dust** (TES thermal inertia below ~150 TIU), **coldest night**
  (thermal model), plus **craters** and **dust storms** from `public/route/`.
- Crater hazard: the rim and inner wall (0.7–1.15 × the radius) of every crater at least half a
  cell wide; small bowl-shaped craters (< 7 km) all the way across; scaled by depth (1 km = full
  hazard), eroded rims count 60%. Where the catalog has no depth, ~1/5 of the width is used and the
  panel says "~" (estimated).
- `search.worker.js` runs A* (16 neighbours per cell) in a Web Worker, three times.

Limits: the data is ~2.6 km per cell at best (slope, elevation), 3–9 km (dust, roughness), 60 km
(temperatures) and 2° (storms). Routes are **corridors**, not paths a rover could drive without
closer images: boulders, small scarps and slopes steeper than the ~2 km average aren't visible.
Crater depths of craters under 10 km are rough (MOLA). Tobler's walking speeds come from people on
Earth. **Wind** isn't included yet: there is no measured global wind map of Mars, only climate
models (NASA Ames Mars GCM, Mars Climate Database).

Data for the planner is built with `python3 tools/build_route_data.py` (inputs in `data/raw/`, see
the script): the Robbins crater catalog into `public/route/craters/` (30° blocks, loaded only
where a route goes) and the dust-storm database into `public/route/storms.bin`.

### Rovers: who travels changes the route

**Who travels** offers an astronaut on foot and NASA's five Mars rovers: **Sojourner, Spirit,
Opportunity, Curiosity, Perseverance**. Each has a compact profile (mission, dates, mass, wheels,
obstacle clearance, speed, navigation; every fact with its source, hover ⓘ) and its own **model
parameters** in `src/route/rovers.js`, clearly marked as assumptions:

| | Slope limit (~2 km scale) | Hazard weights: slope / crater rim / rough / loose dust / rocky / dust storm | Why |
|---|---|---|---|
| On foot | 20° (xEVA spec) | 3 / 1.5 / 1.5 / 1 / 0.5 / 1 | |
| Sojourner | 20° (assumption) | 3 / 3 / 4 / 1 / 2 / 1 | 13 cm wheels clear ~20 cm: rough ground and rims count most |
| Spirit, Opportunity | 25° (MER test rover stalled on ~25° sand) | 3 / 2 / 3 / 3 / 1 / 1 | 26 cm wheels; both got stuck in sand |
| Curiosity | 25° (steepest tilt in 7 years 25.3°) | 3 / 1.5 / 1.5 / 2 / 2.5 / 0.5 | 50 cm wheels clear ~65 cm, but sharp rocks damaged them; nuclear power |
| Perseverance | 25° (assumption: Curiosity design) | 3 / 1.5 / 1.2 / 2 / 1 / 0.5 | thicker wheels after Curiosity's damage |

"Rocky" = high TES thermal inertia (> 600 TIU: rock and bedrock at the surface). Single rocks
are far too small for this data, so obstacle clearance only sets how much a rover dislikes rough
ground and crater rims. With these weights the same A and B can give different routes: e.g. across
Valles Marineris Spirit's safest route is ~885 km, Curiosity's ~635 km.

The panel then explains the chosen route: **why** (how much longer than the shortest and what for),
**what it avoids** compared with the shortest route (km of steep slopes, crater rims, dust, rocky
and rough ground), the **difficult sections**, and a **verdict**: passable under the model (every
cell below the rover's limit), or beyond the rover's capabilities (Sojourner had to stay within
~10 m of its lander; Spirit drove 7.7 km in total). Routes longer than Opportunity's 45.16 km
record get a warning. **Terrain difficulty** is the hazard per km (model). **Time** is shown only
where there's a defensible pace: walking (Tobler), Curiosity (~29 m per drive), Spirit and
Opportunity (lifetime averages from NASA's totals); none for Sojourner and Perseverance.

`computeRoutes()` in `planner.js` is separate from the UI, so comparing two rovers on the same A
and B later only means calling it twice (the terrain grid can be reused).

## 3D terrain (Mars)

**⛰ 3D terrain** (top bar) turns the area into a 3D landscape (`src/terrain3d/view3d.js`, three.js):
the route's area if there is a route, otherwise the area the 2D map shows (up to 1,000 km).

- **Real elevation**: the MOLA elevation tiles the map uses (~2.6 km per pixel), interpolated and
  smoothed over about one data pixel (the tiles store heights in ~115 m steps). No artificial
  shapes are added. Big craters, Mount Sharp, canyons and volcanoes show their real shape;
  craters under ~10 km are blurred.
- **Controls**: drag to rotate, tilt down to just above the horizon, right-drag (or Ctrl/⌘-drag)
  to pan, scroll or pinch to zoom (towards the cursor). **Top view** and **Reset**.
  Near and far clipping follow the camera, so you can zoom right in.
- **3 × 3 tiles**: the route's area is the middle tile (the route plus a small margin, at least
  80 km), with one tile of the same size on every side and corner. The whole model uses the most
  detailed elevation tiles, at 769 × 769 vertices (~256 per tile), smoothed only as much as needed
  to hide the 115 m storage steps, with sharp shadows over the whole model, no haze, and side walls
  down to a base like a physical terrain model.
- If the 2D map shows the whole planet, 3D opens on **Gale Crater** and says how to pick another place.
- **Heights ×5 (default) or ×10**: vertical exaggeration, always shown.
- Elevation colours are lighter where TES thermal inertia says the ground is dusty and darker where
  it's rocky (real data).
- **Colour by**: elevation or slope.
- Lighting: a low afternoon sun from the north-west with shadows, plus soft sky light.
- **Routes in 3D**: click the ground to set A and B (opens the planner). The chosen route follows
  the surface; its difficult parts (steep, crater rim, loose dust, rocky) are **red**; A and B are
  pins; dangers float above the route. Hovering the elevation profile moves a marker along the
  route, and clicking a danger in the list flies the camera there.
- The surface is drawn flat around the area's centre (no planet curvature).

Upgrade path for sharper 3D: NASA/USGS's HRSC-MOLA blended elevation (200 m per pixel, global)
would need its own 16-bit elevation tiles (the current ones are 8-bit, 2.6 km).

## Where the maps come from

Every NASA and partner data set is listed, with dataset IDs, in [DATA_SOURCES.md](DATA_SOURCES.md).

Map images are streamed as tiles from these services while you browse, so nothing is downloaded up front:

| World | Zoomed out | Zoomed in (sharpest detail) |
|-------|------------|-----------------------------|
| Earth | Esri World Imagery (satellite) | under 1 m per pixel in many places |
| Moon  | LRO WAC mosaic (NASA), ~100 m/pixel | Kaguya TC mosaic (JAXA, via NASA Moon Trek), ~21 m/pixel |
| Mars  | Viking colour mosaic (NASA), ~232 m/pixel | CTX mosaic (NASA/Caltech, via Esri), ~5 m/pixel, tinted Mars-coloured |

Past that detail the images are enlarged, so the very closest zoom levels get soft. Change sources in `src/bodies.js`.

## Map views: data and method

All views come from NASA (and partner) data in the Planetary Data System, built by
`tools/build_layers.py`. Blue = low, red = high. Where a quantity exists on both bodies,
both share one colour range, so the same colour means the same value on each.

| View | Moon | Mars | Scale |
|---|---|---|---|
| Elevation | LRO LOLA, ~1.9 km | MGS MOLA, ~1.9 km | linear |
| Terrain slope | LOLA, ~1.9 km | MOLA, ~1.9 km | log, 0.1-30 deg |
| Dusty or rocky terrain | LRO Diviner rock abundance (% of ground covered by >1 m rocks), ~3 km, 60S-60N | MGS TES night thermal inertia (low = dust, high = rock), ~3 km, 70S-70N | log |
| Minerals: iron content | Lunar Prospector GRS, FeO wt%, ~60 km | Mars Odyssey GRS, Fe as FeO wt%, ~300 km, 57.5S-57.5N | linear; own range per body |
| Underground ice | *no global map product found* | Mars Odyssey averaged neutron data (~12 Mars years): % fewer epithermal neutrons than the driest ground (hydrogen, mostly ice near the poles), ~300 km | linear |
| Temperature | Diviner: average over a full lunar day, ~15 km | **Calculated** (see below): average over a Mars year, ~60 km | linear |
| Daily temperature variation | Diviner: hottest minus coldest time of day, ~15 km | **Calculated**: typical day-night swing | linear |
| Yearly temperature range | *not added* | **Calculated**: hottest minus coldest moment of the year | linear |
| Maximum temperature | Diviner: hottest time of a typical day, ~15 km | **Calculated**: hottest month's average afternoon maximum | linear |
| Minimum temperature | Diviner: coldest time of a typical night, ~15 km | **Calculated**: coldest month's average night minimum | linear |

Maximum / minimum temperature are defined like Earth's (NASA POWER): the hottest month's average daily
maximum and the coldest month's average daily minimum. On Mars a "month" is a sliding 1/12 of the
Mars year (~56 sols). The Moon has no real seasons, so its typical day's max and night's min are used.

On the Moon (1.5 deg axial tilt) the maximum variation is essentially the daily variation, and
Diviner's archived product holds per-time-of-day averages, not all-time extremes, so it isn't added.

### Projections

| | Equirectangular | Mercator | North / South pole |
|---|---|---|---|
| Moon, Mars | their own (NASA Trek) | warped | warped |
| Earth | warped | its own (Esri) | warped |

`src/projections.js` defines each projection (lat/lon <-> map position, scale, zoom limits);
the polar ones are azimuthal equidistant: distance from the centre = angle from the pole, so
the opposite pole is the disc's rim.
`src/reproject.js` draws tiles of one projection in another: a 17 x 17 grid of points per tile
is converted to lat/lon and to source-tile pixels, each 16 px cell is drawn as two affine
triangles straight from the source tiles (subdivided where the mapping bends, e.g. at a pole,
or at the edge of a source's coverage). Drawing, rather than reading pixels, also works for
imagery from other sites. Data layers are warped first and coloured afterwards.

Limits: Mercator can't show the poles (stops at 85 deg), so Earth's polar views have a small round
gap within 5 deg of the pole (its sources are Mercator). Equirectangular sources store little detail
right at a pole (every pixel row wraps around a tiny circle): the source detail used there is
capped so a view never needs thousands of tiles, which makes close-ups within a few degrees of
a pole soft. The Moon's LRO WAC mosaic also has no data in the last ~1-2 deg around the poles.

### Earth data

| View | Source | Detail |
|---|---|---|
| Elevation, slope | (elevation uses a relief palette - green lowlands to white peaks - so low land doesn't look like water) NOAA ETOPO 2022, 60 arc-seconds (from NASA SRTM and other data); slope at the same ~1.9 km scale as the Moon and Mars | ~2-4 km |
| Max. / min. temperature, daily swing | NASA POWER `TS_MAX`, `TS_MIN`, `TS_RANGE`: **ground-surface** ("skin") temperature, long-term monthly averages. Max = hottest month's average daily maximum, min = coldest month's average daily minimum, swing = yearly mean | ~50 km |
| Dryness | NASA POWER `PRECTOTCORR` (MERRA-2 / GPM), yearly total; colour scale reversed so red = driest | ~50 km |
| UV radiation | NASA POWER `ALLSKY_SFC_UV_INDEX` (CERES), UV index averaged over day and night incl. clouds | ~100 km |

Surface (not air) temperatures are used so Earth compares with the Moon and Mars surface maps.
The land mask comes from ETOPO: below-sea-level areas count as water only if bigger than
50,000 km2, so Death Valley, the Dead Sea shore and the Qattara Depression stay land. Earth tiles
are Web Mercator (to match the satellite basemap) with the ocean in a lossless alpha channel.
Download the climate data with `python3 tools/fetch_power.py` (cached, resumable), then build
with `python3 tools/build_layers.py earth`.

### Earth analog search

**Find Earth analogs** (Moon or Mars, with an area selected) first asks how much each characteristic
should count (off, ×0.5, ×1, ×2, ×3; at least one on; dryness, UV and altitude start at ×0.5
because they favour the same places for every site) and what a good analog is:

- **Match my site**: places whose values are closest to the site's. Where the site is beyond anything
  on Earth (Mars nights are always colder, its day-night swing always bigger), it is matched
  *relatively*: a site that is cold for its world (say its 20th percentile by area) is matched to
  places equally cold for Earth (Earth's 20th percentile). Taking Earth's extreme instead gave
  every site the same target and the same results (always the Atacama and Tibet). The comparison
  table shows the percentile and the Earth value it was matched to.
- **Most extreme**: for the temperatures, Earth's extreme on the site's side, whatever the site's value.

| Characteristic | Site value (Moon / Mars) | Earth (`public/search`) | How it's compared |
|---|---|---|---|
| Max. / min. temperature, daily swing | area mean of the temperature layers | NASA POWER | matched (or most extreme) |
| Terrain slope | mean of log10(slope), ~1.9 km scale | ETOPO 2022, same scale | matched |
| Terrain relief | mean elevation standard deviation inside ~9 km blocks | ETOPO 2022, same blocks | matched |
| Dryness | – (no Mars/Moon equivalent) | yearly rain, log | driest wins |
| UV radiation | – | average UV index | highest wins |
| Altitude (thin air) | – | mean elevation | highest wins |

How it works (`src/analogs.js`):
- `tools/build_search_grid.py` stores, for each of the ~96,000 half-degree cells with land, the
  land-area mean of each characteristic (2.7 MB, loaded only when a search starts).
- For the chosen radius, every land cell becomes the centre of a circle; the cells inside are
  combined, weighted by land area (circles smaller than a cell use the cell, centred on its land).
  Circles that are less than half land are skipped. Every circle is scored: nothing is sampled.
- Each characteristic's distance to its target is divided by its spread across Earth (5th-95th
  percentile), so degrees, millimetres and slopes become comparable. The score is the weighted
  root-mean-square; "% match" = 100 % minus the score (0 % = a whole Earth spread away).
- The best circle is kept, then the next best at least 800 km from all kept ones, until there are 5.

Results show as numbered circles of the site's radius. Click one (on the map or in the list) for its
area summary and a site-vs-Earth comparison. Selecting new areas is paused until **Exit results**;
data layers can still be shown. A search takes 0.1-1 s.

Checks, with the default weights: Gale and Olympus Mons give the Peruvian Andes, Atacama and Kunlun;
Utopia Planitia, Jezero and the Mars polar caps give Antarctica (plus Tibet for Jezero); Apollo 11 gives
the Atacama, Tibet, Arabia and the Sahara; Shackleton (Moon south pole) gives Antarctica. With dryness,
UV and altitude off, the Moon's equator gives Arabia, the Namib, the Sahara and Australia.
Not covered yet: impact craters (e.g. Devon Island) and soil type (dusty/rocky data for Earth).

### Mars temperatures: a thermal model

No global measured surface-temperature map of Mars exists in the PDS (orbiters only pass each
place at ~2-3 am and pm). `tools/mars_thermal.py` calculates them instead, in the spirit of
NASA/USGS's KRC model, for every 1 x 1 degree cell from NASA data:

- **Inputs:** MGS TES albedo (`mgs-m-tes-special-v1`), TES night thermal inertia, MOLA elevation.
- **Sunlight:** Mars's real orbit (eccentricity 0.0934, tilt 25.19 deg), hour by hour over the year;
  dimmed by dust (optical depth 0.3) along the slanted path, half of it arriving as skylight.
- **Atmosphere's infrared glow:** 5.5% of local noon sunlight.
- **Ground:** heat diffusion through 30 layers (heat capacity 1.2 MJ/m3/K, conductivity from thermal inertia).
- **CO2 frost:** the surface can't cool below the frost point (~148 K, from local pressure);
  extra cooling builds frost (albedo 0.6) that must evaporate before the ground warms.
- Two Mars years are simulated (implicit time steps, Newton iterations on frost-free ground);
  the second is kept. All of Mars runs in a few minutes on 4 cores (numba).

**Check against landers** (typical night / day surface temperature, model vs. published):
Curiosity 189 / 269 K vs ~180-200 / 270-295 K; InSight 185 / 274 K vs ~170-190 / 250-270 K;
Perseverance 191 / 269 K vs ~180-190 / 270-290 K; Viking 1 188 / 264 K vs ~180-190 / 260-270 K.
Within ~10 K. It is still a model: no dust storms, seasonal pressure changes or water-ice caps.

**Why linear or logarithmic.** Elevation, iron, temperatures and ice are roughly bell-shaped over a
limited range, and equal steps are what people compare: linear. Slope, rock cover and thermal
inertia each span 2-3 orders of magnitude with most values bunched at the low end (e.g. half of
Mars has slopes under 0.6 deg, 99% under 13 deg): logarithmic, otherwise most of the map is one colour.

**Methods.**
- Slope: steepness between neighbouring points, both bodies at the same ~1.9 km pixel size
  (MOLA 32 px/deg; LOLA 64 px/deg averaged to 16).
- Diviner temperatures: the Global Cumulative Product gives the surface temperature of every
  0.5 deg spot for 96 times of day. Each spot is seen at ~55-65% of those times; gaps of up to
  2 h are filled by interpolating along the daily cycle, spots with longer gaps are left out.
- Mars ice: hydrogen slows neutrons, so fewer epithermal neutrons escape; shown as % below the
  driest 5% of the planet. Seasonal CO2 frost (up to ~1 m in winter) hides the ice beneath it, so
  poleward of 45 deg only that hemisphere's frost-free summer is averaged (north Ls 105-165, south
  Ls 285-345); elsewhere all seasons. (An earlier version used HEND's first months of 2002, during
  northern winter, which made the north pole look dry.)
- Coarse data (iron, ice) is smoothed at about half its cell size, ignoring gaps, so it reads
  as a map instead of squares; small holes in the Diviner temperatures are filled from
  neighbours.
- Orbit-track stripes (TES thermal inertia, Diviner rock abundance) are removed by subtracting
  the part of the east-west detail that stays consistent over a long north-south stretch, then
  smoothing a little more across the stripes than along them.
- Layers that don't cover the whole globe are cut at a clean latitude line in the browser.
  (A "no data" value in the tiles wouldn't survive lossy compression.)
- Iron uses a separate colour range per body: Mars only varies between ~15 and 23% FeO,
  which on the Moon's 0-24% range would be one flat colour.

The layers are stored as 8-bit WebP "data tiles" in `public/overlays/` (value -> real units in
`index.json`); the browser colours them. To rebuild (downloads ~3.6 GB into `data/raw/`):

    pip install numpy scipy pandas pillow numba tifffile imagecodecs
    python3 tools/fetch_power.py               # Earth climate (NASA POWER), ~10 min
    python3 tools/build_layers.py              # or e.g.: python3 tools/build_layers.py mars iron
    python3 tools/build_search_grid.py         # Earth grid for the analog search, ~1 min
