> **Mars Rover Route** · NASA Space Apps Challenge 2026. Built on *Planet Maps* by
> [gumenion594-ai](https://github.com/gumenion594-ai/nasa-project) (maps, data layers, Earth analog
> search). Added here by Francesca Olea: the **Mars route planner** (safest / easiest / shortest
> routes with their dangers), **rover-aware routing** (Sojourner, Spirit, Opportunity, Curiosity,
> Perseverance) and the **interactive 3D terrain** view. See *Mars route planner* and *3D terrain* below.

# Planet Maps

Pick the Moon or Mars on the home page, explore its map, select an area and look for Earth analogs.

**Open the app online:** https://gumenion594-ai.github.io/nasa-project/ (no install needed)

It's published with GitHub Pages: `.github/workflows/pages.yml` builds the site (`npm run build`), pushes it to the `gh-pages` branch
and publishes it every time `main` changes. To run it on your own computer instead, see *Run it* below.

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
  (a slider from 1 to 250 km, logarithmic so small sizes get as much room as big ones; default 10).
- **Ruler** (top left, next to Home / View): measure the distance between two points (great-circle
  distance on the planet's sphere, correct in every projection). While measuring, everything else on the page
  is switched off except moving and zooming the map; click a start point, move the cursor (live distance),
  click an end point. The next click starts a new measurement. **×** (or Esc) ends it.
- **Tutorial**: on the first visit a welcome card offers a short guided tour of the main tools (View, area
  summary and radius, ruler, route planner once it exists, Find Earth analogs, Find similar spots). A click
  anywhere moves to the next step. It's shown once per browser, and any time from the **?** button (top left on
  the maps).
- Bottom-left: **Landmarks** on/off (on every time a map opens). **Find Earth analogs** searches Earth for
  the places most like the selected area (see *Earth analog search* below); **Find similar spots**
  searches the same world (see *Similar spots* below).
  The selection is kept in the address (e.g. `#/mars?lat=18.44&lon=77.45&r=10&view=slope`), so links and the
  back button bring it back.
- The home page shows spinning 3D globes of the Moon and Mars (three.js, textures made from the
  NASA Trek maps), drawn to scale. Mars turns once every 30 s; the Moon 28x slower.
  Change the speed with `MARS_SECONDS_PER_TURN` in `src/main.js`. The Earth map is reached via
  **Find Earth analogs**.

## Route planner (A to B), Mars and Moon

On the Mars map (and the Moon map, see *On the Moon* below), **🧭 Plan a route from A to B** (selection panel) opens the route planner.
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

### On the Moon

The same planner works on the **Moon map** (same button, same three routes, same 3D terrain button
once A and B are set). What differs:

- **Data**: slope, elevation and roughness from LRO **LOLA**, loose dust and rocky ground from
  **Diviner** thermal inertia (on the Moon it only spans ~25–60 TIU, so "loose" is below ~30 and
  "rocky" above ~60, the ends of the Moon's own range), coldest night measured by Diviner.
- **Craters**: the Robbins (2019) lunar crater catalog, 910,000 craters ≥ 1.3 km in
  `public/route/moon/craters/` (same 12-byte format). It has no depths, so
  `node tools/build_moon_route_data.mjs` measures the rim-to-floor depth of every crater ≥ 15 km
  from LOLA (`data/raw/ldem_16.img`; e.g. Tycho 4.7 km, Copernicus 3.7 km). Smaller craters use
  Pike's (1977) depth–diameter relation for fresh lunar craters (0.196 × D below 15 km). The giant
  impact basins (> 300 km, e.g. Imbrium) are not counted as crater rims: their rims are mountain
  rings hundreds of km wide, which the slope data already shows.
- **No seasons, no dust storms** (no weather): the season dropdown is hidden.
- **Who travels**: an astronaut on foot (20°, as on Mars), the **Apollo Lunar Roving Vehicle**
  (25° design limit; time at ~8 km/h, the Apollo 15–17 average; 92 km battery range). Routes
  longer than Apollo 17's 35.9 km, the farthest NASA has driven on the Moon, get a warning.

### Efficient route: the precise route engine

(Mars and the Moon. Moon: `python3 tools/build_route_grids.py --body moon` packs LRO LOLA's
`ldem_16.img` (16 px/deg, ~1.9 km; 0.5 m steps) into `public/route/moon/grid/` (L0 4 px/deg, L1
16 px/deg); the engine then works the same with the Moon's radius, and its dust / rock / cold
factors use the ends of the Moon's own ranges: thermal inertia below ~34 or above ~50 TIU, nights
below −200 °C. Without the grids the Efficient route is an estimate from the map tiles, and says so.)

`src/route/engine/` implements docs/route-algorithm.md: a drivable / walkable, energy-efficient
route from NASA's **precise MOLA elevation** (16-bit, 1 m steps; the map's 8-bit tiles are never
used for its climbs). In the planner it's the **Efficient** route; Safest and Shortest still come
from the map tiles.

- **Modes**: a rover route is searched first (max slope 20°, setting 10–30°), then on foot (15°,
  10–25°); if neither exists: **"Path unavailable"**, with the steepest unavoidable stretch (⛔ on
  the map). A step is impossible if the slope along it, the sideways slope, or the steepest slope
  inside either cell is over the limit.
- **Cost** (km of flat driving): `d · m_cell + k_up · climb + k_down · descent`, k_up 8 (rover) /
  10 (on foot), settings 3 / 8 / 20; `m_cell = 1 + min(0.25, w_dust f_dust + w_rock f_rock +
  w_cold f_cold)` from the "Dusty or rocky terrain" and "Min. temperature" layers, weights 0–2,
  so they can never make a route more than 25% more expensive. A* with an admissible heuristic
  (great-circle distance + k_up × the unavoidable climb to B), 16 neighbours.
- **Coarse to fine**: L0 (~7.4 km) on the A–B box + 30% (≥ 300 km), 3 distinct corridors (best,
  then penalise its surroundings ×3 and search again, twice) → L1 (~1.85 km) in ±30 km bands
  (best 2) → L2 (~463 m) in ±8 km bands where built. Long corridors are refined in ~300 km pieces,
  each in its own small window. A corridor impassable at the finer level is dropped (band ×2 once
  first). Stops early when a level changes the cost < 1% and moves the route < 1 cell.
- **Smoothing**: string-pulling (each straight piece re-checked every half cell), then a
  Catmull-Rom curve kept only if it also passes the limits.
- **Web Worker** (`route.worker.js`), cancelled when A, B or settings change; progress in the panel.
- **Output** (`findRoute` in engine.js): `{ status, mode, points: [[lat, lon, elev_m]], bounds,
  totals: { length_km, straight_km, climb_m, descent_m, max_slope_deg, energy_km_equiv,
  extra_cost_from_secondary_pct }, segments, blocked, levels }`.
- **Data**: `python3 tools/build_route_grids.py` packs MOLA MEGDR 32 px/deg (`megt90n000fb.img`,
  132 MB, downloaded if missing) into lossless WebP blocks in `public/route/grid/` (R,G = elevation
  m + 10000; B = steepest slope inside the cell in 0.25° steps from the next finer level).
  `--l2 south,north,west,east` adds L2 (128 px/deg) for an area. Without these blocks the
  Efficient route falls back to an estimate from the map tiles, and says so.
- **Tests**: `npm test` (Node's test runner): synthetic terrain (flat, wall with a gap, hill with
  high / zero climbing penalty, closed wall, A* = Dijkstra, the 25% cap, coarse-to-fine bands,
  output contract) and, if `data/raw/megt90n000fb.img` is present, real terrain (Jezero rim,
  Valles Marineris, Gale → Jezero).

### Zoom to route

`src/route/zoom.js`. As soon as a route is found, the map zooms and pans so the whole route
(A, B and every point between) fills the part of the screen the panels leave free; **⤢ Zoom to
route** in the planner brings it back after you've moved the map.

- **Free area from the real panels**: every visible panel (planner, selection, area summary, View,
  legend, top buttons, zoom bar, Earth switch, landmarks switch, zoom readout) is measured on
  screen and pushes the free area in from the side that costs the least map; then at least 40 px
  on every side, plus room for the A / B pins. On phones that's the bottom panel's real height.
- **Every projection**: route points (plus a 5 km ring around A and B) are projected to map
  pixels with the map's own CRS, and the zoom and centre come from that pixel box, so it works the
  same in equirectangular, Mercator and both polar views (where a lat/lon box would fail near the
  pole). Cylindrical maps use the short way round at 180°.
- **Limits**: never closer than the map's maximum zoom (~1 km across), and at least ~5 km kept in
  view around A and B, so very short routes still show their surroundings; very long routes zoom
  out as far as needed (down to the whole map). Animation 0.7 s (`map.flyTo`).
- **180° on the flat maps**: the flat maps end at 180° and don't repeat, so a route crossing it is
  drawn in two pieces at opposite edges. The view frames the piece at the west edge (clear of the
  planner panel; on phones the bigger piece) and the panel says to use a polar view (☰ View) to see
  it in one piece.
- **Route stands out**: a dark halo under a bright line; while a route is shown the imagery and
  data layers are dimmed by 20% (restored when the route is cleared); A and B pins with a dark
  ring; small arrows every ~110 px on screen show the direction of travel (redrawn on zoom).
- The route result carries `points` (every point, A to B) and `bounds` (short-way lat/lon box).

### Driving the route at an Earth analog

Connects an analog to exploration: the same traveller drives the same route at the Moon / Mars
site and at an Earth analog, compared side by side (`src/route/compare.js`).

- **From a route**: plan a route on the Moon or Mars map, then **🌍 Find Earth analogs for this
  route** (in the planner). The search area is the circle around the route (its midpoint, half its
  length as the radius); the route goes along in the Earth page's address (`src`, `str`, `sss`).
- **At a result**: **🛣 Drive the same route here** opens the planner on Earth with a route of the
  same straight-line length and direction, centred on the analog area (turned by up to 90°, or
  shifted, if it would cross water) and the same traveller. Drag A or B to change it, as on Mars.
  Without a site route (an analog search started from the selected area), it compares a
  west–east crossing of the site area with the same crossing at the analog.
- **Side by side** (planner panel), for the chosen route kind: distance, climb, steepest slope,
  km over 15°, average slope, roughness and terrain difficulty per km, plus one sentence, e.g.
  *"A 20 km Apollo LRV traverse here has 41% gentler slopes than the Moon site and 46% less rough
  ground."* Both routes come from the same planner (`computeRoutes`) on the same cell size (the
  site's grid is built at the Earth grid's cell size, since Earth's tiles are coarser), from
  slope data at the same ~1.9 km scale (MOLA / LOLA; ETOPO 2022 on Earth).
- **Earth data**: elevation and slope from the Earth map's tiles (ETOPO 2022, Web Mercator, read
  by `layerSampler`), coldest night from NASA POWER. Earth has no relief map: roughness is the
  standard deviation of the cells' elevation in a ~9 km block, the same measure as the Moon /
  Mars relief maps. **Not on Earth**: crater rims, loose dust / rocky ground (thermal inertia) and
  dust storms: those hazards are simply absent from the Earth route, the panel says so, and the
  compared difficulty uses slope and roughness only on both worlds (the site's full difficulty,
  with craters, dust and rock, is shown separately). The precise MOLA route is Mars-only, so the
  comparison uses the map-tile routes on both worlds.

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

- **Real elevation**: the MOLA elevation tiles the map uses (~2.6 km per pixel). The tiles store
  heights in ~115 m steps (8 bits); instead of blurring, the 3D view finds the smoothest surface
  that keeps every data pixel inside its own step (smoothing passes, each clamped back to the
  allowed range), then interpolates bicubically. Plains lose their fake terraces while cliffs and
  crater walls stay sharp, and every height stays within what NASA measured. No artificial
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
| Dusty or rocky terrain | Thermal inertia (low = dust, high = rock), **calculated** from Diviner's midnight temperatures (GHRM mosaic) with a thermal model, ~1 km, 70S-70N | MGS TES night thermal inertia (low = dust, high = rock), ~3 km, 70S-70N | log, TIU; own range per body (Moon 25-400, Mars 30-1000) |
| Minerals: iron content | Lunar Prospector GRS, FeO wt%, ~60 km | Mars Odyssey GRS, Fe as FeO wt%, ~300 km, 57.5S-57.5N | linear; own range per body |
| Underground ice | *no global map product found* | Mars Odyssey averaged neutron data (~12 Mars years): % fewer epithermal neutrons than the driest ground (hydrogen, mostly ice near the poles), ~300 km | linear |
| Temperature | Diviner: average over a full lunar day, ~15 km | **Calculated** (see below): average over a Mars year, ~60 km | linear |
| Daily temperature variation | Diviner: hottest minus coldest time of day, ~15 km | **Calculated**: typical day-night swing | linear |
| Sunlight | **Calculated**: average solar power on flat ground over day, night and the year, from the Sun's path; beyond 75° with crater and mountain shadows from the LOLA polar terrain models (permanently shadowed craters = 0) | **Calculated**: Mars's orbit, dimmed by typical dust (optical depth 0.3 at 610 Pa, scaled with pressure from MOLA elevation); no dust storms | linear; own range per body |
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
| Sunlight | NASA POWER `ALLSKY_SFC_SW_DWN` (CERES), solar power reaching the ground incl. clouds, yearly average, W/m² (same quantity as the Moon and Mars maps) | ~50 km |

Surface (not air) temperatures are used so Earth compares with the Moon and Mars surface maps.
The land mask comes from ETOPO: below-sea-level areas count as water only if bigger than
50,000 km2, so Death Valley, the Dead Sea shore and the Qattara Depression stay land. Earth tiles
are Web Mercator (to match the satellite basemap) with the ocean in a lossless alpha channel.
Download the climate data with `python3 tools/fetch_power.py` (cached, resumable), then build
with `python3 tools/build_layers.py earth`.

### Earth analog search

**Find Earth analogs** (Moon or Mars, with an area selected) first asks how much each characteristic
should count (off, ×0.5, ×1, ×2, ×3; at least one on), how many places to find (1-10, default 3) and
what a good analog is. **Defaults** restores the default weights, mode and number:
max. temperature ×2, min. temperature ×1, daily swing ×1, slope ×2, relief ×2, dryness ×2, UV and
altitude off. These were chosen by running 18 Moon and Mars sites and checking that different sites
get different places: only 9% of results are shared between sites (it was 41% with every weight at
×1, when most searches ended in the Atacama or Tibet). UV and altitude have no Mars/Moon value, so
they pull every search towards the same highlands.

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
| Dryness | – (no Mars/Moon equivalent) | yearly rain, log | any desert (under 250 mm/yr) counts as dry enough; wetter places count against |
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
- The best circle is kept, then the next best at least 800 km from all kept ones, until there are as
  many as asked for (3 by default).

#### Report card: how good is the analog, and where does it fail?

Click a result for its **report card** (`src/reportcard.js`), under the comparison table:

- **New or known**: is the place in a known analog region, or new? (see below)
- **✓ Strong / ≈ partial / ✗ weak match**: each characteristic, by how far the place is from the site's
  value, measured in Earth's spread of that characteristic (its 5th–95th percentile over all land): strong up
  to 15%, weak from 50% (`STRONG_GAP`, `WEAK_GAP`).
- **↕ Matched only relatively**: where the site is beyond anything on Earth, only the rank matches. The card
  gives both real values, e.g. *Min. temperature: Mars −93 °C, here 6 °C; both at about the 92nd percentile of
  their own world*.
- **○ Not compared**: characteristics that were switched off, have no data at the site, or have no Earth
  counterpart in the search yet (surface material, iron, ice, sunlight, dust storms, rock type, craters).
- **What no place on Earth can reproduce** (fixed per world): gravity, vacuum or the thin CO₂ air, radiation,
  the Moon's 29.5-day day, Mars's perchlorate soil, and Earth's life, which helps testing but contaminates
  samples.

#### Known analogs: is the place new?

`src/knownAnalogs.js` lists 25 established analog sites (Haughton crater, McMurdo Dry Valleys, Atacama,
Río Tinto, Mars Desert Research Station, HI-SEAS, Askja, Meteor Crater, Ries, Sudbury, lava-tube parks, …),
each with what it is used for and a source. They show on the Earth map (✦, purple, from 2× zoom; click for
details). Every result is labelled **New analog** or **Known analog region** (within 250 km of one of them,
`KNOWN_REGION_KM`). **Only new places** in the search dialog leaves the known regions out (address: `new=1`).

**Does the search find known analogs?** `tools/validate-analogs.html` (open it with `npm run dev`, at
`/tools/validate-analogs.html`) runs the search with the default weights and a 25 km radius for Moon / Mars
sites whose Earth analog is established, and reports how well the best area within 250 km of that analog ranks
among all of Earth's ~96,000 areas. For comparison, the same number for 300 random land points (median):

| Moon / Mars site | Known Earth analog | Why that pair | Known analog ranks in | Random land point |
|---|---|---|---|---|
| Phoenix landing site (Mars) | McMurdo Dry Valleys | ice-cemented polar ground | **top 1.5%** | top 36% |
| Opportunity, Meridiani Planum (Mars) | Río Tinto | jarosite from acid water | **top 1.5%** | top 29% |
| Apollo 15, Hadley (Moon) | Askja | Apollo field training | **top 3.9%** | top 18% |
| Apollo 14, Fra Mauro (Moon) | Nördlinger Ries | Apollo 14 crew training | top 20% | top 34% |
| Apollo 16, Descartes (Moon) | Sudbury Basin | Apollo 16 / 17 rock studies | top 28% | top 28% |
| Viking 1, Chryse Planitia (Mars) | Atacama (Yungay) | Viking-like soil experiments | top 81% | top 21% |

Four of six known analogs rank far above a random place, from climate and terrain alone. The two that don't
were chosen for what the search doesn't compare: Sudbury for its impact rocks, and the Atacama for its soil
chemistry. Viking 1's site is cold for Mars, so it is matched to places cold for Earth, while Yungay is a warm
coastal desert. For every site, *some* known analog for its world ranks in the top 1.5%.

None of the six known analogs is among the site's 10 results: the results are other places with similar
values. Over 20 Moon and Mars sites × 10 results, **7 of 200 results (3.5%) are in a known analog region**
(e.g. Hellas → near Haughton crater, Mars's north pole → Svalbard); the other 96.5% are new. With *Only new
places* none are.

### Mars and Moon equivalents of an Earth place (the reverse search)

`src/equivalents.js`. On the Earth map, select an area and press **🪐 Find the Mars & Moon
equivalents**: the spots on Mars and on the Moon most like it, each with a % match, the nearest
named place (e.g. "near Hellas Planitia") and a button that opens it on that world's map.

- **Compared**: hottest-month maximum, coldest-month minimum, day–night swing (ground
  temperatures), slope and relief, the characteristics both sides have; weights 2 / 1 / 1 / 2 / 2
  as in the analog search. The Earth place uses the analog search's Earth grid (land-area means
  over the circle); every Moon / Mars spot the "Find similar spots" circle means, same radius.
- **Like the analog search, the other way round**: slope and relief are matched by value;
  a temperature that exists on that world is matched by value, one beyond it (Earth's nights are
  far warmer than Mars's) relatively: the same percentile of that world as the place has on Earth.
  Score = weighted RMS of the differences, each divided by the world's 5–95% spread; % match =
  (1 − score) × 100.
- **Rain**: the Moon and Mars are bone dry, so rain beyond a desert's (250 mm a year) lowers the
  % match of every spot alike.
- **No close equivalent**: below 86% the panel says so and gives the nearest spot with its %.
  Calibrated on known places: classic Mars analogs score 92–96% on Mars (Atacama 93%, Devon
  Island 92%, Antarctic Dry Valleys 96%), deserts ~88% (Sahara, Death Valley); wet or green
  places don't reach it (London 80%, Iceland 78%, Hawaii and the Amazon 70%).

**For a route**: the route planner also works on the Earth map. Plan a route there, then
**🪐 Find the Mars & Moon equivalents of this route**: the same search for the circle around the
route (its midpoint, half its length), and **🛣 Drive this route on Mars / the Moon** opens that
world's planner with the same route (same straight-line length and direction, same traveller where
that world has it) at the best-matching spot, compared side by side with the Earth route
(the same summary as at an Earth analog, the other way round).

### Map reliability

- **Moon / Mars imagery gaps**: the imagery comes from NASA Trek, which can be slow or drop tiles.
  A bundled whole-world layer sits underneath (`public/basemap/`, made by
  `tools/build_fallback_basemap.py` from the globe textures shaded with the 8 px/degree LOLA /
  MOLA relief), so a missing tile shows the shaded relief instead of a black square.
- **Earth 3D ("Stand here in 3D")**: the far landscape now comes from the AWS terrain tiles (small
  PNGs, fast), so it appears within seconds; NASADEM (Microsoft Planetary Computer) is used for
  the detailed rings with a 25 s limit, falling back to the AWS tiles; the satellite ground images
  get 30 s, and if they don't arrive the ground keeps its plain colour instead of turning black.

### Similar spots

**Find similar spots** (Moon or Mars, with an area selected) looks for the places on the *same* world
most like the selected area, at least 500 km away from it. It asks how much each data layer should count
(all ×1 by default) and how many spots to find (1-10, default 3). The results appear as numbered circles
with a "% match" and the distance from the site; click one for a site-vs-spot comparison table. Map clicks
are paused until **Exit results**.

How it works (`src/similar.js`):
- Each layer is read from its own map tiles at zoom level 1 (1024 x 512 pixels for the whole world:
  ~21 km per pixel on Mars, ~11 km on the Moon). The tile pyramid is box-averaged, so each pixel is the
  area mean of the detailed data (the mean of the log for slope and thermal inertia).
- Around every pixel, each layer is averaged over a circle of the selected radius (per-row running sums,
  so this takes about a second); the site gets the same treatment. Smaller radii than a pixel compare
  single pixels. Circles less than half covered by a layer (beyond its latitude limits) are skipped.
- Score and "% match" work as for Earth analogs: distance to the site's value divided by the layer's
  spread across the world (5th-95th percentile by area), weighted root-mean-square.
- Spots closer than 500 km to the site are left out; the best spot is kept, then the next best at least
  500 km from every kept one.

Results show as numbered circles of the site's radius. Click one (on the map or in the list) for its
area summary and a site-vs-Earth comparison. Selecting new areas is paused until **Exit results**;
data layers can still be shown. A search takes 0.1-1 s.

Checks, with the default weights (3 places, 25 km radius): Gale gives the Peruvian Andes, the Bolivian
Altiplano and Algeria; Meridiani the Sechura Desert (Peru), the Western Sahara and the Namib; Hellas
West Greenland, Alaska's North Slope and the Canadian Arctic; Argyre the Canadian Arctic islands and
Chukotka; Jezero, Utopia, the Mars poles and Shackleton different parts of Antarctica; Apollo 11 Sudan,
Niger and Oman; the Moon's far side Oman, the Danakil and Morocco.
Not covered yet: impact craters as a search characteristic and soil type (dusty/rocky data for Earth); see the
report card's *Not compared* list.

### Moon and Mars 3D view: standing on the surface

On the Moon or Mars, select a point and click **Stand here in 3D**: you stand there with your eyes
1.8 m above the ground (`#/moon3d?lat=..&lon=..&t=..` or `#/mars3d?...`). Drag to look around, scroll
or pinch to zoom (arrow keys and +/− work too). The time panel sets the date and time (default: now);
the slider moves ±15 days on the Moon and ±3 sols on Mars, and **Play** runs time (Moon: 1, 6 or 24
hours per second; Mars: 15 min, 1 h or 3 h per second), so you can watch a sunrise or a whole day.
The panel says whether it's day or night, where the Sun, Earth (and on Mars, Phobos and Deimos) are,
and when the next sunrise or sunset is. A compass strip along the top marks them.

How it works (`src/surface3d/`, loaded only when opened; per-world settings in `worlds.js`):
- **Terrain** (`dem.js`, `terrain.js`): four nested square heightfields around you, including the Moon's
  curvature (a 1.8 m person's horizon is only ~2.5 km away; beyond it only higher ground shows):

  | Ring | Size | Grid | Source |
  |---|---|---|---|
  | foot | ±100 m | 1 m | 'near' + made-up small craters (0.6-25 m), rocks and regolith texture |
  | near | ±5 km | 20 m | LOLA 118 m + made-up craters 70-600 m |
  | mid | ±40 km | 250 m | LOLA 118 m, every 4th sample (~470 m) |
  | far | ±250 km | 2 km | LOLA 8 px/deg (~3.8 km), bundled: `public/surface3d/moon_8ppd.bin` |

  On Mars the same rings use the HRSC + MOLA blended DEM (200 m; mid ring every 2nd sample) and MOLA
  8 px/deg (`public/surface3d/mars_8ppd.bin`, far ring ±400 km), with made-up craters from 120 m.
  The ground colour is a rust tone whose brightness follows the Viking colour mosaic (dark basalt sand
  vs. bright dust).

  The 118 m LOLA DEM is read straight from the USGS Astrogeology server: the file stores one image row
  per strip, so the browser asks for just the bytes it needs of each row (HTTP range requests, 6 at a
  time, `cache: 'no-store'` so Chrome doesn't queue them one by one). About 90 + 175 small requests;
  ~5-10 s. The coarse landscape shows first, the detail fills in. Each ring fades its made-up detail
  out and blends into the next coarser ring towards its edge.
  Made-up detail is seeded by the location, so a place always looks the same.
- **Sun and Earth** (`sky.js`): `astronomy-engine` gives the Sun, Earth and the Moon's rotation (IAU
  model) for any time; from these come their directions in the observer's sky (Earth with parallax,
  its size and lit fraction). Checked: at Apollo 11's landing (20 July 1969, 20:17 UTC) the Sun was
  10.7° up in the east (historically ~10.8°); full and new moon put the sub-solar point at 0° / 180°.
- **Shadows**: the terrain shader marches from each pixel towards the Sun through the four heightfields
  (up to 250 km), with a soft edge the size of the Sun's disc, so a crater rim or a distant mountain
  shades you correctly at any time. Rocks also cast shadow-mapped shadows within ~100 m.
- **Light**: no air, so the sky is black and shadows are dark (a little light bounced from sunlit ground).
  At night the ground is lit by earthshine, brightest at "full Earth" (lunar midnight on the near side);
  the exposure adapts like eyes would. On the far side the Earth never rises.
- **Mars sky**: a dusty atmosphere (optical depth 0.5): butterscotch sky by day, a blue glow round the
  Sun at sunrise and sunset, sunlight dimmed and reddened near the horizon, haze over distance (~45 km).
  The Sun is ~2/3 the size seen from Earth; Earth is a bright star. Mars's rotation comes from the IAU
  model; checked: Curiosity's landing (6 Aug 2012, 05:17 UTC) gives mid-afternoon local solar time
  (15:35), as reported.
- **Phobos and Deimos** are drawn from mean orbital elements (JPL, with the precession of their orbits),
  so their positions are approximate (a few degrees). Checked: on 2 April 2022 Phobos crosses the Sun
  as seen from Jezero, the eclipse Perseverance filmed. Phobos rises in the west and sets in the east
  twice a day; neither is visible from near the poles (above ~70° for Phobos).

### Earth analogs in 3D

On the Earth map, pick an analog result (or select a point) and click **Stand here in 3D**
(`#/earth3d?lat=..&lon=..&t=..`). Same view and controls as on the Moon and Mars, with Earth's data:
- **Heights**: NASA **NASADEM** (the Space Shuttle radar mission SRTM, reprocessed), 1 arc second
  (~30 m), 60° N to 56° S: near ring at full resolution, mid ring every 8th sample, far ring (±150 km)
  from the file's coarsest overview. One cloud-optimised GeoTIFF per 1° tile on Microsoft Planetary
  Computer, read in small pieces; the browser first fetches a free anonymous access token. No tile =
  sea. North of 60° N and south of 56° S (Devon Island, Svalbard, Antarctica) the heights come from the
  AWS Terrain Tiles (web-Mercator PNGs, ~40 m there), with the sea floor cut off at sea level.
- **Ground**: Esri World Imagery as a texture per ring (up to ~1 m per pixel in deserts; where the
  finest level is missing, the next coarser one), with its own shadows from when it was taken.
  No made-up craters; rocks and small bumps are made up.
- **Sky** (`sky.js`): Sun and Moon from astronomy-engine's observer functions (with refraction); the
  Moon is a grey globe lit by the Sun, so it shows its phase. Blue sky, orange glow at sunset, haze
  over distance (~90 km). Checked: noon Sun at 23° S on 21 June is 43.6° up (90 − 23 − 23.44).
- Not yet: stars and planets, a real map of the Earth (it's a cloudy blue stand-in), the 5 m south-pole
  DEM. Very close to the poles (above ~88°) the DEM rows are read at full width, so loading is slower.

`tools/build_far_dem.mjs moon|mars` makes the far-terrain files from PDS `ldem_16.img` / MOLA
`megt90n000eb.img` (downloaded to `data/raw/`).

### Moon thermal inertia: from Diviner's midnight temperatures

Both worlds show thermal inertia, made the same way: ground with a high thermal inertia (rocks,
bedrock) stores the day's heat and stays warmer at night; fine dust cools fast. Mars's map (TES) was
calculated from night temperatures by the TES team; for the Moon, `tools/moon_thermal_inertia.py`
does it from Diviner's global mosaic of the bolometric (whole-surface, rocks included) temperature
at slope-adjusted midnight (128 px/deg, streamed and averaged to 32 px/deg by
`tools/fetch_diviner_night.py`, so the 3.3 GB file is never stored):

- A thermal model (uniform ground, the 29.53-day lunar day, sunlight 1361 W/m², albedo 0.12,
  emissivity 0.95, 40 layers, implicit time steps) gives the midnight temperature for 48 thermal
  inertias (10-3000 TIU) at every degree of latitude, e.g. at the equator 103 K for 50 TIU,
  195 K for 1000 TIU (measured lunar nights: ~95-105 K over typical soil).
- Each spot's measured temperature is matched to its thermal inertia.

Results: typical soil 42-46 TIU (published lunar values ~50); fresh craters much higher (Tycho's
floor ~200, up to ~430; Aristarchus ~110). Like the TES map it's an apparent (bulk) value: boulders
in fine soil give an in-between number. Albedo differences (0.07-0.16) shift it by ~10-15%.

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
