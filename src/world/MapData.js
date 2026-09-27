// Stylised but geographically consistent layout of Sivakasi and surroundings.
// Units are metres. +x = east, -z = north (north is "up" on the minimap).
// This file is pure data (no three.js) so it can be validated in Node (scripts/check-map.mjs).

export const WORLD = { half: 1600, chunk: 160 };

// ---------------------------------------------------------------- districts
// Checked in order; first match wins.
export const DISTRICTS = [
  { id: 'thiruthangal', type: 'town', ta: 'திருத்தங்கல்', en: 'Thiruthangal', x: -1050, z: -650, r: 260 },
  { id: 'bazaar', type: 'bazaar', ta: 'சிவகாசி கடைவீதி', en: 'Sivakasi Bazaar', x: 0, z: 0, r: 230 },
  { id: 'printing', type: 'printing', ta: 'அச்சகப் பகுதி', en: 'Printing Area', x: -290, z: -300, r: 190 },
  { id: 'commercial_n', type: 'commercial', ta: 'வணிகப் பகுதி', en: 'Commercial Street', x: 240, z: -230, r: 190 },
  { id: 'commercial_s', type: 'commercial', ta: 'வணிகப் பகுதி', en: 'Commercial Street', x: 230, z: 240, r: 170 },
  { id: 'res_sw', type: 'residential', ta: 'குடியிருப்பு', en: 'Residential Area', x: -300, z: 300, r: 230 },
  { id: 'res_se', type: 'residential', ta: 'குடியிருப்பு', en: 'Residential Area', x: 380, z: 440, r: 200 },
  { id: 'res_ne', type: 'residential', ta: 'குடியிருப்பு', en: 'Residential Area', x: 440, z: -420, r: 170 },
  { id: 'fireworks_e', type: 'fireworks', ta: 'பட்டாசு ஆலைப் பகுதி', en: 'Fireworks Industrial Area', x: 1080, z: 450, r: 380 },
  { id: 'fireworks_s', type: 'fireworks', ta: 'பட்டாசு ஆலைப் பகுதி', en: 'Fireworks Industrial Area', x: 470, z: 1030, r: 280 },
  { id: 'match', type: 'match', ta: 'தீப்பெட்டி ஆலைப் பகுதி', en: 'Match Factory Area', x: -880, z: 420, r: 230 },
  { id: 'industrial', type: 'industrial', ta: 'தொழிற்பேட்டை', en: 'Industrial Estate', x: 850, z: -500, r: 230 },
  { id: 'vembakottai', type: 'village', ta: 'வெம்பக்கோட்டை', en: 'Vembakottai', x: 250, z: 1300, r: 170 },
  { id: 'naranapuram', type: 'village', ta: 'நாரணாபுரம்', en: 'Naranapuram', x: 1250, z: -1200, r: 180 },
  { id: 'sengamalapatti', type: 'village', ta: 'செங்கமலப்பட்டி', en: 'Sengamalapatti', x: -1300, z: -1180, r: 170 },
  { id: 'anaiyur', type: 'village', ta: 'ஆனையூர்', en: 'Anaiyur', x: -880, z: 1150, r: 150 },
];

export const EDGE_DISTRICT = { id: 'town_edge', type: 'residential_edge', ta: 'சிவகாசி புறநகர்', en: 'Sivakasi Suburbs' };
export const OUTSKIRTS = { id: 'outskirts', type: 'outskirts', ta: 'புறநகர் / வயல்வெளி', en: 'Outskirts' };

export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    const dx = x - d.x;
    const dz = z - d.z;
    if (dx * dx + dz * dz < d.r * d.r) return d;
  }
  if (Math.hypot(x, z) < 640) return EDGE_DISTRICT;
  return OUTSKIRTS;
}

// ---------------------------------------------------------------- roads
// Town grid: 7x7 nodes, 150 m spacing, x/z from -450..450
export const GRID = { n: 7, step: 150, origin: -450 };
const gx = (i) => GRID.origin + i * GRID.step;

const nodes = [];
for (let i = 0; i < GRID.n; i++) {
  for (let j = 0; j < GRID.n; j++) nodes.push({ id: `g${i}${j}`, x: gx(i), z: gx(j) });
}
nodes.push(
  // Virudhunagar road (north)
  { id: 'n1', x: 250, z: -900 }, { id: 'n2', x: 600, z: -1600 },
  // Sattur road (east)
  { id: 'e1', x: 1000, z: 120 }, { id: 'e2', x: 1600, z: 180 },
  // Vembakottai road (south)
  { id: 's1', x: 180, z: 1000 }, { id: 's2', x: 250, z: 1300 }, { id: 's3', x: 300, z: 1600 },
  // Srivilliputhur road (south-west)
  { id: 'sw1', x: -700, z: 800 }, { id: 'sw2', x: -1050, z: 1600 },
  // Thiruthangal road (west)
  { id: 'w1', x: -620, z: -260 }, { id: 'w2', x: -850, z: -520 }, { id: 't0', x: -1050, z: -700 }, { id: 'w3', x: -1600, z: -900 },
  { id: 'tN', x: -1050, z: -950 }, { id: 'tS', x: -1050, z: -450 }, { id: 'sg', x: -1300, z: -1180 },
  // Naranapuram road (north-east)
  { id: 'ne1', x: 900, z: -900 }, { id: 'ne2', x: 1250, z: -1200 }, { id: 'ne3', x: 1600, z: -1500 },
  // Fireworks belt road
  { id: 'f1', x: 1050, z: 600 }, { id: 'f2', x: 900, z: 1050 },
  // Match factory link
  { id: 'm1', x: -850, z: 450 },
  // Railway station forecourt spur
  { id: 'st', x: -548, z: 5 },
);
export const ROAD_NODES = nodes;

const REMOVED = new Set(['g10-g11', 'g45-g55', 'g51-g52', 'g14-g24', 'g56-g66', 'g60-g61']);
const edges = [];
for (let i = 0; i < GRID.n; i++) {
  for (let j = 0; j < GRID.n; j++) {
    if (i < GRID.n - 1) {
      const key = `g${i}${j}-g${i + 1}${j}`;
      if (!REMOVED.has(key)) edges.push({ a: `g${i}${j}`, b: `g${i + 1}${j}`, w: j === 3 ? 12 : 8, type: j === 3 ? 'main' : 'street' });
    }
    if (j < GRID.n - 1) {
      const key = `g${i}${j}-g${i}${j + 1}`;
      if (!REMOVED.has(key)) edges.push({ a: `g${i}${j}`, b: `g${i}${j + 1}`, w: i === 3 ? 12 : 8, type: i === 3 ? 'main' : 'street' });
    }
  }
}
const hw = (a, b, w = 11) => edges.push({ a, b, w, type: 'highway' });
hw('g30', 'n1'); hw('n1', 'n2');
hw('g63', 'e1'); hw('e1', 'e2');
hw('g36', 's1'); hw('s1', 's2'); hw('s2', 's3');
hw('g06', 'sw1'); hw('sw1', 'sw2');
hw('g02', 'w1'); hw('w1', 'w2'); hw('w2', 't0'); hw('t0', 'w3');
hw('g60', 'ne1'); hw('ne1', 'ne2'); hw('ne2', 'ne3');
const rd = (a, b, w = 8) => edges.push({ a, b, w, type: 'rural' });
rd('t0', 'tN'); rd('t0', 'tS'); rd('tS', 'w2'); rd('tN', 'sg');
rd('e1', 'f1'); rd('f1', 'f2'); rd('f2', 's1');
rd('sw1', 'm1'); rd('m1', 'g04');
edges.push({ a: 'g03', b: 'st', w: 9, type: 'street' });
export const ROAD_EDGES = edges;

// ---------------------------------------------------------------- railway
// Virudhunagar (north) -> Thiruthangal -> Sivakasi -> Srivilliputhur (south-west)
export const RAILWAY = [
  [-500, -1600], [-880, -900], [-760, -500], [-600, -150], [-620, 300], [-900, 900], [-1150, 1600],
];
export const STATIONS = [
  { id: 'sivakasi_rs', ta: 'சிவகாசி', en: 'SIVAKASI', z: -20, side: 1 },
  { id: 'thiruthangal_rs', ta: 'திருத்தங்கல்', en: 'TIRUTTANGAL', z: -760, side: -1 },
];

// ---------------------------------------------------------------- terrain
export const HILL = { x: -1220, z: -560, r: 105, h: 26 };

export function terrainHeight(x, z) {
  const dx = x - HILL.x;
  const dz = z - HILL.z;
  const d2 = (dx * dx + dz * dz) / (HILL.r * HILL.r);
  if (d2 >= 1) return 0;
  const k = 1 - d2;
  return HILL.h * k * k;
}

// ---------------------------------------------------------------- landmarks
// rot = direction the building's front faces (radians, 0 = +z/south).
export const LANDMARKS = [
  { id: 'temple', type: 'temple', ta: 'ஸ்ரீ பத்ரகாளியம்மன் கோவில்', en: 'Sri Bhadrakali Amman Temple', x: -75, z: -78, rot: Math.PI / 2, w: 64, d: 64, reserve: 52 },
  { id: 'busstand', type: 'busstand', ta: 'சிவகாசி பேருந்து நிலையம்', en: 'Sivakasi Bus Stand', x: 76, z: 76, rot: 0, w: 104, d: 84, reserve: 66 },
  { id: 'market', type: 'market', ta: 'காய்கறி சந்தை', en: 'Vegetable Market', x: -76, z: 76, rot: Math.PI / 2, w: 80, d: 70, reserve: 55 },
  { id: 'police', type: 'police', ta: 'சிவகாசி காவல் நிலையம்', en: 'Sivakasi Police Station', x: 225, z: -30, rot: 0, w: 34, d: 22, reserve: 34 },
  { id: 'hospital', type: 'hospital', ta: 'அரசு மருத்துவமனை', en: 'Government Hospital', x: 225, z: -215, rot: 0, w: 70, d: 28, reserve: 52 },
  { id: 'firestation', type: 'firestation', ta: 'தீயணைப்பு நிலையம்', en: 'Fire & Rescue Station', x: 375, z: 128, rot: 0, w: 32, d: 22, reserve: 30 },
  { id: 'press', type: 'press', ta: 'ஸ்ரீ லட்சுமி ஆப்செட் பிரிண்டர்ஸ்', en: 'Sri Lakshmi Offset Printers', x: -225, z: -410, rot: Math.PI, w: 44, d: 24, reserve: 36 },
  { id: 'fireworks', type: 'fireworks', ta: 'ஸ்ரீ பாலாஜி பட்டாசு ஆலை', en: 'Sri Balaji Fireworks', x: 1180, z: 360, rot: -Math.PI / 2, w: 130, d: 100, reserve: 90 },
  { id: 'matchworks', type: 'matchworks', ta: 'காமாட்சி தீப்பெட்டி ஆலை', en: 'Kamatchi Match Works', x: -1010, z: 380, rot: Math.PI / 2, w: 70, d: 40, reserve: 52 },
  { id: 'hilltemple', type: 'hilltemple', ta: 'திருத்தங்கல் மலைக்கோவில்', en: 'Thiruthangal Hill Temple', x: -1220, z: -560, rot: Math.PI / 2, w: 22, d: 18, reserve: 110 },
  { id: 'school', type: 'school', ta: 'அரசு மேல்நிலைப் பள்ளி', en: 'Govt Higher Secondary School', x: -225, z: 214, rot: Math.PI, w: 64, d: 22, reserve: 46 },
  { id: 'mechanic', type: 'mechanic', ta: 'முருகன் மெக்கானிக் ஷாப்', en: 'Murugan Mechanic Shop', x: 375, z: -22, rot: 0, w: 18, d: 12, reserve: 18 },
  { id: 'hotel', type: 'hotel', ta: 'ஸ்ரீ முருகன் ஹோட்டல்', en: 'Sri Murugan Hotel', x: 75, z: -21, rot: 0, w: 22, d: 14, reserve: 18 },
  { id: 'home', type: 'home', ta: 'மாதவ் வீடு', en: "Madhav's Home", x: -375, z: 316, rot: Math.PI, w: 12, d: 10, reserve: 14 },
  { id: 'villagetemple', type: 'shrine', ta: 'மாரியம்மன் கோவில்', en: 'Mariamman Shrine', x: 282, z: 1296, rot: -Math.PI / 2, w: 10, d: 10, reserve: 22 },
];

export const landmarkById = (id) => LANDMARKS.find((l) => l.id === id);

/** Points of interest used by UI / missions / shops (world positions). */
export const POI = {
  spawn: { x: 60, z: 128, rot: Math.PI },
  teaShop: { x: 124, z: 118 },
  hotelCounter: { x: 75, z: -10 },
  mechanic: { x: 375, z: -12 },
  hospitalDoor: { x: 225, z: -198 },
  policeDoor: { x: 225, z: -16 },
  fireStationDoor: { x: 375, z: 142 },
  home: { x: -375, z: 306.5 },
};
