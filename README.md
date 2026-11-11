# Planet Maps

Pick Earth, the Moon or Mars on the home page and explore its map.

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
- Home-page globes are drawn to scale: the Moon is 27% and Mars 53% of Earth's diameter.

## Where the maps come from
Map images are streamed as tiles from these services while you browse, so nothing is downloaded up front:

| World | Imagery | Sharpest detail |
|-------|---------|-----------------|
| Earth | Esri World Imagery (satellite) | under 1 m per pixel in many places |
| Moon  | LRO WAC global mosaic, via NASA Moon Trek | ~100 m per pixel |
| Mars  | Viking MDIM 2.1 colour mosaic, via NASA Mars Trek | ~232 m per pixel |

Past that detail the Moon and Mars images are enlarged and look blurry. Change sources in `src/bodies.js`.
