// Landmark labels for the Moon and Mars maps.
// type: 'human'   = crewed landing site (Apollo)
//       'robotic' = robotic lander or rover
//       'peak'    = mountain / volcano
//       'feature' = basin, plain, canyon, crater, region
// tier: 0 = always shown, 1 = from 2x zoom, 2 = from 4x zoom (keeps the map uncluttered)
// Coordinates: planetocentric latitude, east longitude (-180..180).
import L from 'leaflet';

export const LANDMARKS = {
  moon: [
    // Crewed landings
    ['Apollo 11', 0.674, 23.473, 'human', 0, 'First crewed landing, July 1969'],
    ['Apollo 12', -3.012, -23.422, 'human', 0, 'November 1969'],
    ['Apollo 14', -3.645, -17.471, 'human', 1, 'February 1971'],
    ['Apollo 15', 26.132, 3.634, 'human', 0, 'July 1971, first lunar rover'],
    ['Apollo 16', -8.973, 15.5, 'human', 0, 'April 1972, highlands'],
    ['Apollo 17', 20.191, 30.772, 'human', 0, 'December 1972, last crewed landing'],
    // Robotic
    ["Chang'e 4", -45.44, 177.6, 'robotic', 1, 'First far-side landing, 2019'],
    ["Chang'e 5", 43.06, -51.92, 'robotic', 2, 'Sample return, 2020'],
    // Mountains
    ['Mons Huygens', 19.92, -2.86, 'peak', 1, 'Tallest lunar mountain, ~5.5 km above its surroundings'],
    ['Mons Hadley', 26.69, 4.12, 'peak', 2, 'Next to the Apollo 15 site'],
    ['Selenean Summit', 5.41, -158.63, 'peak', 1, 'Highest point on the Moon, ~10.8 km'],
    ['Montes Apenninus', 18.9, -3.7, 'feature', 1, 'Mountain range on the rim of Mare Imbrium'],
    // Maria, basins, craters
    ['Mare Imbrium', 32.8, -15.6, 'feature', 0],
    ['Oceanus Procellarum', 18.4, -57.4, 'feature', 0],
    ['Mare Tranquillitatis', 8.5, 31.4, 'feature', 0],
    ['Mare Serenitatis', 28.0, 17.5, 'feature', 0],
    ['Mare Crisium', 17.0, 59.1, 'feature', 0],
    ['Mare Nubium', -21.3, -16.6, 'feature', 1],
    ['Mare Fecunditatis', -7.8, 51.3, 'feature', 1],
    ['Mare Frigoris', 56.0, 1.4, 'feature', 1],
    ['Mare Orientale', -19.4, -92.8, 'feature', 1],
    ['Mare Moscoviense', 27.3, 147.9, 'feature', 1],
    ['South Pole–Aitken Basin', -53.0, -169.0, 'feature', 0, 'Largest impact basin on the Moon'],
    ['Tycho', -43.31, -11.36, 'feature', 0, 'Young crater with bright rays'],
    ['Copernicus', 9.62, -20.08, 'feature', 0],
    ['Aristarchus', 23.7, -47.4, 'feature', 1, 'Brightest large crater'],
    ['Plato', 51.62, -9.38, 'feature', 1],
    ['Shackleton', -89.67, 129.78, 'feature', 1, 'South-pole crater, Artemis target region'],
  ],
  mars: [
    // Robotic landers and rovers (no humans have landed on Mars yet)
    ['Curiosity · Gale crater', -4.59, 137.44, 'robotic', 0, 'NASA rover, 2012'],
    ['Perseverance · Jezero', 18.44, 77.45, 'robotic', 0, 'NASA rover, 2021'],
    ['Viking 1', 22.27, -47.95, 'robotic', 0, 'First successful Mars landing, 1976'],
    ['Viking 2', 47.67, 134.28, 'robotic', 1, '1976'],
    ['Pathfinder', 19.13, -33.22, 'robotic', 1, '1997, first rover (Sojourner)'],
    ['Spirit', -14.57, 175.47, 'robotic', 1, 'NASA rover, 2004'],
    ['Opportunity', -1.95, -5.53, 'robotic', 1, 'NASA rover, 2004-2018'],
    ['Phoenix', 68.22, -125.75, 'robotic', 1, '2008, found water ice'],
    ['InSight', 4.5, 135.62, 'robotic', 1, '2018, seismometer'],
    ['Zhurong', 25.07, 109.93, 'robotic', 1, 'Chinese rover, 2021'],
    // Volcanoes
    ['Olympus Mons', 18.65, -133.8, 'peak', 0, 'Tallest volcano in the solar system, ~22 km'],
    ['Ascraeus Mons', 11.92, -104.08, 'peak', 1],
    ['Pavonis Mons', 1.48, -112.96, 'peak', 1],
    ['Arsia Mons', -8.26, -120.09, 'peak', 1],
    ['Elysium Mons', 24.8, 146.9, 'peak', 0],
    ['Alba Mons', 40.47, -109.6, 'peak', 1],
    // Canyons, basins, plains, regions
    ['Valles Marineris', -13.9, -59.2, 'feature', 0, 'Canyon system ~4,000 km long'],
    ['Hellas Planitia', -42.4, 70.5, 'feature', 0, 'Deepest basin, ~7 km below datum'],
    ['Argyre Planitia', -49.7, -43.4, 'feature', 0],
    ['Utopia Planitia', 46.7, 117.5, 'feature', 0],
    ['Syrtis Major', 8.4, 69.5, 'feature', 1],
    ['Isidis Planitia', 12.9, 87.0, 'feature', 1],
    ['Arabia Terra', 22.79, 5.06, 'feature', 1],
    ['Chryse Planitia', 28.4, -40.3, 'feature', 1],
    ['Acidalia Planitia', 49.8, -20.7, 'feature', 1],
    ['Planum Boreum', 85.0, 0.0, 'feature', 1, 'North polar ice cap'],
    ['Planum Australe', -84.0, 160.0, 'feature', 1, 'South polar ice cap'],
  ],
};

const ICON = { human: '◆', robotic: '●', peak: '▲', feature: '' };

/** Adds the labels to `map`; returns a function that shows/hides them. */
export function addLandmarks(map, body) {
  map.createPane('labels').style.zIndex = 450; // above data overlays and selection
  const tiers = [L.layerGroup(), L.layerGroup(), L.layerGroup()];
  for (const [name, lat, lon, type, tier, note] of LANDMARKS[body] ?? []) {
    const icon = L.divIcon({
      className: `landmark landmark-${type}`,
      html: `<div class="lm"><span class="lm-icon">${ICON[type]}</span><span class="lm-text"></span></div>`,
      iconSize: null,
    });
    const marker = L.marker([lat, lon], { icon, interactive: false, keyboard: false, pane: 'labels' });
    marker.on('add', () => {
      const el = marker.getElement();
      el.querySelector('.lm-text').textContent = name;
      if (note) el.title = `${name}: ${note}`;
    });
    tiers[tier].addLayer(marker);
  }
  let visible = true;
  const update = () => {
    const level = map.getZoom() - map.getMinZoom();
    tiers.forEach((group, t) => {
      const show = visible && level >= t - 0.01;
      if (show && !map.hasLayer(group)) group.addTo(map);
      if (!show && map.hasLayer(group)) group.remove();
    });
  };
  map.on('zoomend', update);
  update();
  return (show) => { visible = show; update(); };
}
