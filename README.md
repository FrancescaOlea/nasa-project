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
  Pick the radius (1, 5, 10, 25, 50, 100 or 250 km; default 10). Click elsewhere to move it. **Find Earth analogs** opens the Earth map for that
  area (the analog search itself is still to be built); **Find similar spots** is a placeholder.
  The selection is kept in the address (e.g. `#/mars?lat=18.44&lon=77.45&r=10`), so links and the
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
