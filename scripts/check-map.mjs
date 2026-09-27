// Sanity checks for the Sivakasi map data: landmarks must not sit on roads,
// the road graph must be connected, and chunk generation must be fast & deterministic.
import { RoadNetwork } from '../src/world/RoadNetwork.js';
import { LANDMARKS, WORLD, POI } from '../src/world/MapData.js';
import { planChunk } from '../src/world/ChunkBuilder.js';

let failures = 0;
const fail = (m) => { failures++; console.error('✗', m); };
const roads = new RoadNetwork();
console.log(`roads: ${roads.nodes.size} nodes, ${roads.edges.length} edges, rail ${roads.railLength.toFixed(0)} m`);

// connectivity
const start = roads.nodes.values().next().value;
const seen = new Set([start]);
const stack = [start];
while (stack.length) {
  const n = stack.pop();
  for (const e of n.edges) {
    const o = roads.other(e, n);
    if (!seen.has(o)) { seen.add(o); stack.push(o); }
  }
}
if (seen.size !== roads.nodes.size) fail(`road graph not connected (${seen.size}/${roads.nodes.size})`);

for (const l of LANDMARKS) {
  const c = Math.cos(l.rot), s = Math.sin(l.rot);
  let worst = Infinity;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const u = -l.w / 2 + (l.w * i) / 10, v = -l.d / 2 + (l.d * j) / 10;
    worst = Math.min(worst, roads.roadClearanceGlobal(l.x + u * c + v * s, l.z - u * s + v * c));
  }
  if (worst < 1.5) fail(`landmark ${l.id} overlaps a road (clearance ${worst.toFixed(1)})`);
  if (l.type !== 'hilltemple' && roads.railDistance(l.x, l.z) < Math.max(l.w, l.d) / 2 + 8) fail(`landmark ${l.id} too close to railway`);
}
for (const [k, p] of Object.entries(POI)) {
  if (roads.roadClearanceGlobal(p.x, p.z) < -0.5) console.warn(`  note: POI ${k} is on a road`);
}

const t0 = performance.now();
let buildings = 0, trees = 0, n = 0;
const N = WORLD.half / WORLD.chunk;
for (let cx = -N; cx < N; cx++) for (let cz = -N; cz < N; cz++) {
  const p = planChunk(cx, cz, roads);
  buildings += p.buildings.length; trees += p.trees.length; n++;
}
const dt = performance.now() - t0;
console.log(`chunks: ${n}, buildings: ${buildings}, trees: ${trees}, avg plan ${(dt / n).toFixed(2)} ms`);
const a = JSON.stringify(planChunk(0, 0, roads).buildings);
const b = JSON.stringify(planChunk(0, 0, roads).buildings);
if (a !== b) fail('chunk generation is not deterministic');
if (failures) { console.error(`${failures} problem(s)`); process.exit(1); }
console.log('✓ map OK');
