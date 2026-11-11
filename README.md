# Planet Maps

Pick Earth, the Moon or Mars on the home page and explore its map.

## Run it
Requires Node.js 18+ (https://nodejs.org).

    npm install
    npm run dev

Then open the URL it prints (usually http://localhost:5173).

## Using it
- Click a world on the home page to open its map; **← Home** (or the browser back button) returns.
- Zoom with the mouse wheel, pinch, or the **+ / −** buttons. The bottom-left box shows the
  zoom factor and how wide the view is. Maximum zoom is about 1 km across the screen.

## Where the maps come from
Map images are streamed as tiles from these services while you browse, so nothing is downloaded up front:

| World | Imagery | Sharpest detail |
|-------|---------|-----------------|
| Earth | Esri World Imagery (satellite) | under 1 m per pixel in many places |
| Moon  | LRO WAC global mosaic, via NASA Moon Trek | ~100 m per pixel |
| Mars  | Viking MDIM 2.1 colour mosaic, via NASA Mars Trek | ~232 m per pixel |

Past that detail the Moon and Mars images are enlarged and look blurry. Change sources in `src/bodies.js`.
