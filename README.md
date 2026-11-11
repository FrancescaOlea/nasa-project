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
- **☰ Menu** (Moon and Mars) holds the map options:
  - **View**: show one coloured data layer over the map (blue = low, red = high, with a legend).
    Currently *Terrain slope* and *Terrain roughness*.
  - **Selection radius**: 1, 5, 10, 25, 50, 100 or 250 km (default 10). **Find Earth analogs** opens the Earth map for that
  area (the analog search itself is still to be built); **Find similar spots** is a placeholder.
  The selection is kept in the address (e.g. `#/mars?lat=18.44&lon=77.45&r=10&view=slope`), so links and the
  back button bring it back.
- The home page shows spinning 3D globes of the Moon and Mars (three.js, textures made from the
  NASA Trek maps), drawn to scale. Mars turns once every 30 s; the Moon 28x slower.
  Change the speed with `MARS_SECONDS_PER_TURN` in `src/main.js`. The Earth map is reached via
  **Find Earth analogs**.

## Where the maps come from
Map images are streamed as tiles from these services while you browse, so nothing is downloaded up front:

| World | Zoomed out | Zoomed in (sharpest detail) |
|-------|------------|-----------------------------|
| Earth | Esri World Imagery (satellite) | under 1 m per pixel in many places |
| Moon  | LRO WAC mosaic (NASA), ~100 m/pixel | Kaguya TC mosaic (JAXA, via NASA Moon Trek), ~21 m/pixel |
| Mars  | Viking colour mosaic (NASA), ~232 m/pixel | CTX mosaic (NASA/Caltech, via Esri), ~5 m/pixel, tinted Mars-coloured |

Past that detail the images are enlarged, so the very closest zoom levels get soft. Change sources in `src/bodies.js`.

## Terrain views: how they're made

`tools/build_terrain.py` turns NASA elevation maps into the slope and roughness layers:

| | Mars | Moon |
|---|---|---|
| Source | MGS **MOLA** MEGDR, 32 px/degree | LRO **LOLA** LDEM, 64 px/degree, averaged to 16 |
| Pixel size | 1.85 km | 1.90 km |

Both bodies are measured at the same ~1.9 km scale so their numbers can be compared
(slope and roughness depend on the scale you measure them at).

- **Slope**: steepness between neighbouring points, in degrees.
- **Roughness**: RMS height (m) left after fitting a tilted plane over a 5 x 5-pixel (~9 km)
  window. Removing the plane means a smooth, evenly tilted surface isn't counted as rough.

**Why the colour scales are logarithmic.** At this scale both values span about three orders of
magnitude and are roughly log-normal: Mars has a median slope of 0.6 deg (99% below 13 deg), the
Moon 4 deg (99% below 23 deg); median roughness is 12 m on Mars and 80 m on the Moon. On a linear
scale ~90% of Mars would be one shade of blue. Both bodies share the same ranges
(slope 0.1-30 deg, roughness 1-500 m) so the same colour means the same value on each.

The layers are stored as 8-bit WebP "data tiles" in `public/overlays/` (value -> real units is
in `index.json`); the browser colours them. To rebuild (downloads ~660 MB into `data/raw/`):

    pip install numpy scipy pillow
    python3 tools/build_terrain.py
