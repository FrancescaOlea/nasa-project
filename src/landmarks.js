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

const MISSION_DETAILS = {
  'Apollo 11': {
    year: 1969,
    organization: 'NASA (United States)',
    type: 'Crewed lunar landing',
    crew: 'Neil Armstrong and Buzz Aldrin',
    keyFact: 'First crewed landing on the Moon; Michael Collins remained in lunar orbit.',
    intro: 'The first Apollo landing party explored Mare Tranquillitatis.',
    source: 'https://www.nasa.gov/mission/apollo-11/',
  },
  'Apollo 12': {
    year: 1969,
    organization: 'NASA (United States)',
    type: 'Crewed lunar landing',
    crew: 'Charles Conrad and Alan Bean',
    keyFact: 'Landed near the earlier Surveyor 3 robotic spacecraft.',
    intro: 'Apollo 12 made the second crewed lunar landing in Oceanus Procellarum.',
    source: 'https://www.nasa.gov/mission/apollo-12/',
  },
  'Apollo 14': {
    year: 1971,
    organization: 'NASA (United States)',
    type: 'Crewed lunar landing',
    crew: 'Alan Shepard and Edgar Mitchell',
    keyFact: 'Explored the Fra Mauro highlands; Stuart Roosa stayed in lunar orbit.',
    intro: 'Apollo 14 was the third crewed lunar landing.',
    source: 'https://www.nasa.gov/mission/apollo-14/',
  },
  'Apollo 15': {
    year: 1971,
    organization: 'NASA (United States)',
    type: 'Crewed lunar landing',
    crew: 'David Scott and James Irwin',
    keyFact: 'First Apollo mission to use a lunar rover; Alfred Worden stayed in orbit.',
    intro: 'Apollo 15 explored the Hadley-Apennine region.',
    source: 'https://www.nasa.gov/mission/apollo-15/',
  },
  'Apollo 16': {
    year: 1972,
    organization: 'NASA (United States)',
    type: 'Crewed lunar landing',
    crew: 'John Young and Charles Duke',
    keyFact: 'Explored the Descartes highlands using a lunar rover; Ken Mattingly stayed in orbit.',
    intro: 'Apollo 16 was the first crewed landing in the Moon’s rugged highlands.',
    source: 'https://www.nasa.gov/mission/apollo-16/',
  },
  'Apollo 17': {
    year: 1972,
    organization: 'NASA (United States)',
    type: 'Crewed lunar landing',
    crew: 'Eugene Cernan and Harrison Schmitt',
    keyFact: 'The last crewed lunar landing; Schmitt was a geologist and the mission used a rover.',
    intro: 'Apollo 17 explored the Taurus-Littrow valley.',
    source: 'https://www.nasa.gov/mission/apollo-17/',
  },
  'Curiosity · Gale crater': {
    year: 2012,
    organization: 'NASA / Jet Propulsion Laboratory',
    type: 'Robotic rover',
    keyFact: 'Studies whether Gale crater once had conditions that could support microbial life.',
    intro: 'Curiosity is a mobile science laboratory exploring Gale crater and Mount Sharp.',
    source: 'https://science.nasa.gov/mission/msl-curiosity/',
  },
  'Perseverance · Jezero': {
    year: 2021,
    organization: 'NASA / Jet Propulsion Laboratory',
    type: 'Robotic rover',
    keyFact: 'Searches for signs of ancient life and collects rock and soil samples.',
    intro: 'Perseverance landed in Jezero crater, the site of an ancient lake and river delta.',
    source: 'https://science.nasa.gov/mission/mars-2020-perseverance/',
  },
  'Viking 1': {
    year: 1976,
    organization: 'NASA (United States)',
    type: 'Orbiter and lander',
    keyFact: 'First truly successful Mars landing and the first images from the surface.',
    intro: 'Viking 1 began NASA’s first long-running in-place study of the Martian surface.',
    source: 'https://science.nasa.gov/mission/viking-1/',
  },
  'Viking 2': {
    year: 1976,
    organization: 'NASA (United States)',
    type: 'Orbiter and lander',
    keyFact: 'Studied the Martian surface and atmosphere at Utopia Planitia.',
    intro: 'Viking 2 was the second NASA Viking lander to operate on Mars.',
    source: 'https://science.nasa.gov/mission/viking-2/',
  },
  'Pathfinder': {
    year: 1997,
    organization: 'NASA / Jet Propulsion Laboratory',
    type: 'Lander and rover',
    keyFact: 'Demonstrated a new landing system and delivered the first rover to Mars.',
    intro: 'Pathfinder landed at Ares Vallis and deployed the small Sojourner rover.',
    source: 'https://science.nasa.gov/mission/mars-pathfinder/',
  },
  'Spirit': {
    year: 2004,
    organization: 'NASA / Jet Propulsion Laboratory',
    type: 'Robotic rover',
    keyFact: 'Explored Gusev crater for evidence of past water; its mission ended in 2010.',
    intro: 'Spirit was one of NASA’s twin Mars Exploration Rovers.',
    source: 'https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/',
  },
  'Opportunity': {
    year: 2004,
    organization: 'NASA / Jet Propulsion Laboratory',
    type: 'Robotic rover',
    keyFact: 'Found evidence of past water and continued operating until 2018.',
    intro: 'Opportunity was one of NASA’s twin Mars Exploration Rovers.',
    source: 'https://science.nasa.gov/mission/mars-exploration-rovers-spirit-and-opportunity/',
  },
  'Phoenix': {
    year: 2008,
    organization: 'NASA / University of Arizona',
    type: 'Stationary lander',
    keyFact: 'Studied the Martian Arctic and confirmed water ice in the soil.',
    intro: 'Phoenix investigated the icy plains of Mars’s northern polar region.',
    source: 'https://science.nasa.gov/mission/mars-phoenix/',
  },
  'InSight': {
    year: 2018,
    organization: 'NASA / Jet Propulsion Laboratory',
    type: 'Stationary lander',
    keyFact: 'Measured marsquakes to investigate the planet’s interior.',
    intro: 'InSight studied Mars’s internal structure, heat flow, and seismic activity.',
    source: 'https://science.nasa.gov/mission/insight/',
  },
};

const ICON = { human: '◆', robotic: '●', peak: '▲', feature: '' };

function missionPopup(name, details) {
  const content = document.createElement('article');
  content.className = 'mission-popup';

  const heading = document.createElement('h3');
  heading.textContent = name;
  content.append(heading);

  const intro = document.createElement('p');
  intro.textContent = details.intro;
  content.append(intro);

  const list = document.createElement('ul');
  for (const [label, value] of [
    ['Year', details.year],
    ['Organization', details.organization],
    ['Mission', details.type],
    ...(details.crew ? [['Crew', details.crew]] : []),
    ['Key fact', details.keyFact],
  ]) {
    const item = document.createElement('li');
    const term = document.createElement('strong');
    term.textContent = `${label}: `;
    item.append(term, document.createTextNode(value));
    list.append(item);
  }
  content.append(list);

  if (details.source) {
    const source = document.createElement('a');
    source.href = details.source;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = 'Mission information';
    content.append(source);
  }
  return content;
}

/** Adds the labels to `map`; returns a function that shows/hides them. */
export function addLandmarks(map, body) {
  map.createPane('labels').style.zIndex = 450; // above data overlays and selection
  const tiers = [L.layerGroup(), L.layerGroup(), L.layerGroup()];
  for (const [name, lat, lon, type, tier, note] of LANDMARKS[body] ?? []) {
    const mission = MISSION_DETAILS[name];
    const icon = L.divIcon({
      className: `landmark landmark-${type}${mission ? ' landmark-mission' : ''}`,
      html: `<div class="lm"><span class="lm-icon">${ICON[type]}</span><span class="lm-text"></span></div>`,
      iconSize: null,
    });
    const marker = L.marker([lat, lon], {
      icon,
      interactive: Boolean(mission),
      keyboard: Boolean(mission),
      pane: 'labels',
      title: mission ? `${name} - open mission information` : name,
    });
    marker.on('add', () => {
      const el = marker.getElement();
      el.querySelector('.lm-text').textContent = name;
      if (mission) {
        el.setAttribute('aria-label', `${name}, ${mission.year}, ${mission.organization}. Open mission information.`);
      } else if (note) {
        el.title = `${name}: ${note}`;
      }
    });
    if (mission) {
      marker.bindPopup(missionPopup(name, mission), {
        className: 'mission-popup-shell',
        minWidth: 200,
        maxWidth: 280,
        maxHeight: 320,
        autoPanPadding: [16, 16],
      });
    }
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
