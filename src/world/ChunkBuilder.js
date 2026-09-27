// Deterministic per-chunk city generation.
//   planChunk()  -> pure data (buildings, trees, props, colliders). Cheap, cached.
//   buildLow()   -> 1 mesh of textured boxes for distant viewing.
//   buildHigh()  -> detailed merged meshes (facades, awnings, signs, tanks, poles, wires...).
import * as THREE from 'three';
import { WORLD, LANDMARKS, STATIONS, districtAt, terrainHeight } from './MapData.js';
import { GeoBuilder } from './GeoBuilder.js';
import { ROW, FACADE_ROWS } from './Textures.js';
import { mulberry32, hash2, pick, clamp } from '../core/utils.js';

export const FLOOR_H = 3.2;
const BAY_U = 14; // metres of facade per texture repeat (4 bays of 3.5 m)

const PAINTS = [
  '#f2c4c4', '#f7e3a1', '#bfe3d0', '#c8d8f0', '#f5f0e1', '#e8c8e8', '#f3d6a8', '#d4ecb4',
  '#fbe7d4', '#ffffff', '#e0d4c0', '#b8e0e8', '#ffd7b0', '#d9f2c2', '#f0b8b8', '#cfe7ff',
];
const TARPS = ['#1e5bb8', '#2e8b57', '#d9552b', '#e0b000', '#7a3fb5', '#c62828', '#1b9aaa'];

// Per-district building rules.
const P = {
  bazaar: { frontage: true, rows: 3, width: [4.5, 8], depth: [9, 14], floors: [1, 4], fill: 0.97, gap: 0.15, sidewalk: 2.5, setback: 0, rowGap: 1.2, shop: 0.92, kind: 'shop' },
  commercial: { frontage: true, rows: 2, width: [7, 14], depth: [10, 16], floors: [2, 5], fill: 0.9, gap: 0.6, sidewalk: 2.5, setback: 0.5, rowGap: 2, shop: 0.75, kind: 'shop' },
  town: { frontage: true, rows: 2, width: [5, 9], depth: [8, 13], floors: [1, 3], fill: 0.9, gap: 0.4, sidewalk: 2.2, setback: 0.3, rowGap: 1.5, shop: 0.6, kind: 'shop' },
  printing: { frontage: true, rows: 2, width: [10, 20], depth: [12, 20], floors: [1, 3], fill: 0.85, gap: 1.2, sidewalk: 2.5, setback: 1, rowGap: 3, shop: 0.35, kind: 'press' },
  residential: { frontage: true, rows: 3, width: [7, 11], depth: [8, 12], floors: [1, 3], fill: 0.85, gap: 1.6, sidewalk: 2.2, setback: 1.5, rowGap: 2.5, shop: 0.12, kind: 'house' },
  residential_edge: { frontage: true, rows: 2, width: [7, 11], depth: [8, 11], floors: [1, 2], fill: 0.55, gap: 4, sidewalk: 2, setback: 3, rowGap: 5, shop: 0.08, kind: 'house' },
  industrial: { frontage: true, rows: 1, width: [22, 38], depth: [16, 28], floors: [1, 1], fill: 0.7, gap: 8, sidewalk: 1.5, setback: 8, rowGap: 10, shop: 0, kind: 'shed' },
  match: { frontage: true, rows: 1, width: [24, 34], depth: [9, 12], floors: [1, 1], fill: 0.55, gap: 10, sidewalk: 1.5, setback: 10, rowGap: 10, shop: 0, kind: 'shed' },
  fireworks: { frontage: false },
  village: { frontage: true, rows: 2, width: [6, 9], depth: [6, 8], floors: [1, 1], fill: 0.45, gap: 4, sidewalk: 1.5, setback: 3, rowGap: 6, shop: 0.1, kind: 'village' },
  outskirts: { frontage: true, rows: 1, width: [6, 9], depth: [6, 8], floors: [1, 1], fill: 0.05, gap: 25, sidewalk: 1.5, setback: 6, rowGap: 6, shop: 0, kind: 'village' },
};

const rr = (rng, [a, b]) => a + rng() * (b - a);

let stationReserves = null;
function getStationReserves(roads) {
  if (!stationReserves) {
    stationReserves = STATIONS.map((s) => {
      const p = roads.railPoint(roads.railParamAtZ(s.z));
      return { x: p.x + p.dz * s.side * -18, z: p.z - p.dx * s.side * -18, r: 62 };
    });
  }
  return stationReserves;
}

// ====================================================================== PLAN
export function planChunk(cx, cz, roads, propsDensity = 1) {
  const C = WORLD.chunk;
  const x0 = cx * C;
  const z0 = cz * C;
  const x1 = x0 + C;
  const z1 = z0 + C;
  const rng = mulberry32(hash2(cx, cz, 7));
  const plan = {
    cx, cz, x0, z0,
    buildings: [], trees: [], fields: [], poles: [], lamps: [], parked: [], animals: [], carts: [], banners: [],
    colliders: [], shopFronts: [], sidewalkSpots: [],
  };
  const N = C / 2;
  const occ = new Uint8Array(N * N);
  const reserves = [
    ...LANDMARKS.map((l) => ({ x: l.x, z: l.z, r: l.reserve })),
    ...getStationReserves(roads),
  ];

  const inChunk = (x, z, m = 0) => x >= x0 + m && x < x1 - m && z >= z0 + m && z < z1 - m;
  const cell = (x, z) => {
    const ix = Math.floor((x - x0) / 2);
    const iz = Math.floor((z - z0) / 2);
    return ix < 0 || iz < 0 || ix >= N || iz >= N ? -1 : iz * N + ix;
  };

  /** Validate an oriented footprint. Returns sample list or null. */
  const footprint = (x, z, rot, w, d, minClear, needInside = true) => {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const nu = Math.max(2, Math.ceil(w / 2.2));
    const nv = Math.max(2, Math.ceil(d / 2.2));
    const samples = [];
    // road clearance / chunk bounds on the full footprint
    for (let i = 0; i <= nu; i++) {
      const u = -w / 2 + (w * i) / nu;
      for (let j = 0; j <= nv; j++) {
        const v = -d / 2 + (d * j) / nv;
        const wx = x + u * c + v * s;
        const wz = z - u * s + v * c;
        if (needInside && !inChunk(wx, wz, 0.3)) return null;
        if (roads.roadClearance(wx, wz) < minClear) return null;
      }
    }
    // occupancy on a slightly inset footprint so neighbours can share walls
    const iw = Math.max(0.5, w - 1.6);
    const id = Math.max(0.5, d - 1.6);
    const mu = Math.max(1, Math.ceil(iw / 1.8));
    const mv = Math.max(1, Math.ceil(id / 1.8));
    for (let i = 0; i <= mu; i++) {
      const u = -iw / 2 + (iw * i) / mu;
      for (let j = 0; j <= mv; j++) {
        const v = -id / 2 + (id * j) / mv;
        const k = cell(x + u * c + v * s, z - u * s + v * c);
        if (k >= 0 && occ[k]) return null;
        samples.push(k);
      }
    }
    const R = Math.max(w, d) / 2;
    for (const r of reserves) {
      if ((x - r.x) ** 2 + (z - r.z) ** 2 < (r.r + R) ** 2) return null;
    }
    if (roads.railDistance(x, z) < 11 + R) return null;
    if (terrainHeight(x, z) > 0.3) return null;
    return samples;
  };
  const mark = (samples) => {
    for (const k of samples) if (k >= 0) occ[k] = 1;
  };

  const addBuilding = (b, minClear = 1.8) => {
    const samples = footprint(b.x, b.z, b.rot, b.w, b.d, minClear);
    if (!samples) return false;
    mark(samples);
    b.h = b.floors * FLOOR_H;
    plan.buildings.push(b);
    plan.colliders.push({ type: 'rect', x: b.x, z: b.z, hw: b.w / 2, hd: b.d / 2, c: Math.cos(b.rot), s: Math.sin(b.rot), h: b.h + 1 });
    return true;
  };

  const newBuilding = (kind, x, z, rot, w, d, floors, rules) => {
    const shop = kind === 'shop' || kind === 'press' ? rng() < (rules?.shop ?? 0.5) : rng() < (rules?.shop ?? 0);
    return {
      kind, x, z, rot, w, d, floors,
      paint: kind === 'unit' ? '#ffffff' : kind === 'shed' ? pick(rng, ['#c9ced3', '#b9c8d8', '#d8d0c0', '#c0c6b8']) : kind === 'hut' ? '#b58c62' : pick(rng, PAINTS),
      shop,
      open: rng() < 0.6,
      winRow: rng() < 0.6 ? ROW.WIN_A : ROW.WIN_B,
      sign: shop && rng() < 0.85 ? Math.floor(rng() * 32) : -1,
      awning: shop && rng() < 0.6 ? pick(rng, TARPS) : null,
      tank: rng() < 0.6,
      stair: rng() < 0.35,
      roof: kind === 'village' ? (rng() < 0.6 ? 'tile' : 'flat') : kind === 'hut' ? 'thatch' : kind === 'shed' || kind === 'unit' ? 'shed' : 'flat',
      balcony: kind === 'house' && floors > 1 && rng() < 0.4,
      seed: Math.floor(rng() * 1e9),
    };
  };

  // ---------------------------------------------------------------- road frontage
  const margin = 60;
  const edges = roads.edges.filter((e) => {
    const minX = Math.min(e.a.x, e.b.x) - margin;
    const maxX = Math.max(e.a.x, e.b.x) + margin;
    const minZ = Math.min(e.a.z, e.b.z) - margin;
    const maxZ = Math.max(e.a.z, e.b.z) + margin;
    return maxX >= x0 && minX <= x1 && maxZ >= z0 && minZ <= z1;
  });

  for (const e of edges) {
    for (const side of [1, -1]) {
      const lx = e.dz * side;
      const lz = -e.dx * side;
      const rot = Math.atan2(-lx, -lz); // front faces the road
      const trimA = e.a.edges.length > 1 ? e.a.radius + 3 : 0;
      const trimB = e.b.edges.length > 1 ? e.b.radius + 3 : 0;
      for (let row = 0; row < 3; row++) {
        let s = trimA + rng() * 3;
        while (s < e.len - trimB - 3) {
          const px = e.a.x + e.dx * s;
          const pz = e.a.z + e.dz * s;
          const probe = districtAt(px + lx * 14, pz + lz * 14);
          const rules = P[probe.type];
          if (!rules || !rules.frontage || row >= rules.rows) { s += 12; continue; }
          const w = rr(rng, rules.width);
          const dMax = rules.depth[1];
          const d = rr(rng, rules.depth);
          if (s + w > e.len - trimB) break;
          if (rng() > rules.fill) { s += w + rules.gap + rng() * 3; continue; }
          const off = e.hw + rules.sidewalk + rules.setback + row * (dMax + rules.rowGap) + d / 2 + (row ? rng() * 1.5 : 0);
          const cxw = e.a.x + e.dx * (s + w / 2) + lx * off;
          const czw = e.a.z + e.dz * (s + w / 2) + lz * off;
          if (!inChunk(cxw, czw)) { s += w + rules.gap; continue; }
          const floors = Math.round(rr(rng, [rules.floors[0] - 0.49, rules.floors[1] + 0.49]));
          let kind = rules.kind;
          if (kind === 'village' && rng() < 0.2) kind = 'hut';
          const b = newBuilding(kind, cxw, czw, rot, w, d, clamp(floors, 1, 6), rules);
          if (row > 0) { b.shop = false; b.sign = -1; b.awning = null; }
          if (addBuilding(b, row === 0 ? rules.sidewalk - 0.3 : 1.5)) {
            if (row === 0 && b.shop && b.open) {
              const fo = e.hw + rules.sidewalk * 0.55;
              plan.shopFronts.push({ x: e.a.x + e.dx * (s + w / 2) + lx * (off - d / 2 - 0.9), z: e.a.z + e.dz * (s + w / 2) + lz * (off - d / 2 - 0.9), rot });
              if (rng() < 0.35 * propsDensity && (probe.type === 'bazaar' || probe.type === 'commercial' || probe.type === 'town')) {
                plan.parked.push({ x: e.a.x + e.dx * (s + w * 0.3) + lx * (e.hw + 0.6), z: e.a.z + e.dz * (s + w * 0.3) + lz * (e.hw + 0.6), rot: rot + Math.PI / 2 + (rng() - 0.5) * 0.5, color: pick(rng, ['#111', '#b71c1c', '#1565c0', '#333', '#555', '#6d4c41']) });
              }
              void fo;
            }
          }
          s += w + rules.gap * (0.5 + rng());
        }
      }
    }
  }

  // ---------------------------------------------------------------- scatter by district
  const cxm = x0 + C / 2;
  const czm = z0 + C / 2;
  const dMid = districtAt(cxm, czm);

  if (dMid.type === 'fireworks' || districtAt(x0 + 20, z0 + 20).type === 'fireworks' || districtAt(x1 - 20, z1 - 20).type === 'fireworks') {
    const clusters = 2 + Math.floor(rng() * 2);
    for (let k = 0; k < clusters; k++) {
      const ox = x0 + 20 + rng() * (C - 40);
      const oz = z0 + 20 + rng() * (C - 40);
      if (districtAt(ox, oz).type !== 'fireworks') continue;
      const ang = rng() * Math.PI;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const nx = 2 + Math.floor(rng() * 3);
      const nz = 2 + Math.floor(rng() * 2);
      for (let i = 0; i < nx; i++) {
        for (let j = 0; j < nz; j++) {
          const lx = (i - (nx - 1) / 2) * 15;
          const lz = (j - (nz - 1) / 2) * 13;
          const x = ox + lx * ca + lz * sa;
          const z = oz - lx * sa + lz * ca;
          const b = newBuilding('unit', x, z, ang, 5 + rng(), 4 + rng(), 1, { shop: 0 });
          b.tank = false; b.stair = false;
          if (addBuilding(b, 10) && rng() < 0.7) {
            plan.animals.push({ kind: 'sand', x: x + ca * 5, z: z - sa * 5, rot: ang });
          }
        }
      }
      plan.banners.push({ x: ox + 16 * sa, z: oz + 16 * ca, rot: ang, key: rng() < 0.5 ? 'warn_smoke' : 'warn_danger', small: true });
    }
  }

  if (dMid.type === 'village') {
    for (let k = 0; k < 18; k++) {
      const a = rng() * Math.PI * 2;
      const r = rng() * dMid.r * 0.8;
      const x = dMid.x + Math.cos(a) * r;
      const z = dMid.z + Math.sin(a) * r;
      if (!inChunk(x, z, 6)) continue;
      const kind = rng() < 0.25 ? 'hut' : 'village';
      const b = newBuilding(kind, x, z, Math.floor(rng() * 4) * (Math.PI / 2) + (rng() - 0.5) * 0.3, 6 + rng() * 3, 5 + rng() * 3, 1, { shop: 0 });
      b.tank = rng() < 0.3;
      addBuilding(b, 3);
    }
  }

  // fields & orchards on the outskirts / villages
  if (dMid.type === 'outskirts' || dMid.type === 'village' || dMid.type === 'fireworks' || dMid.type === 'match') {
    const tries = dMid.type === 'outskirts' ? 7 : 3;
    for (let k = 0; k < tries; k++) {
      const w = 25 + rng() * 40;
      const d = 20 + rng() * 35;
      const x = x0 + w / 2 + rng() * (C - w);
      const z = z0 + d / 2 + rng() * (C - d);
      const rot = (rng() - 0.5) * 0.4;
      const samples = footprint(x, z, rot, w, d, 3);
      if (!samples) continue;
      mark(samples);
      const crop = pick(rng, ['#9ccc65', '#7cb342', '#c5b358', '#8d6e63', '#aed581', '#dce775']);
      plan.fields.push({ x, z, rot, w, d, color: crop });
      // palmyra palms along field bunds
      if (rng() < 0.7) {
        const n = Math.floor(w / 9);
        for (let i = 0; i < n; i++) {
          const u = -w / 2 + (i + 0.5) * (w / n);
          plan.trees.push({ type: 'palm', x: x + u * Math.cos(rot) + (d / 2 + 1) * Math.sin(rot), z: z - u * Math.sin(rot) + (d / 2 + 1) * Math.cos(rot), s: 0.8 + rng() * 0.5, r: rng() * 6.28 });
        }
      }
    }
  }

  // ---------------------------------------------------------------- vegetation
  const town = ['bazaar', 'commercial', 'town', 'printing'].includes(dMid.type);
  const treeTries = town ? 10 : dMid.type === 'residential' ? 30 : 60;
  for (let k = 0; k < treeTries; k++) {
    const x = x0 + rng() * C;
    const z = z0 + rng() * C;
    const d = districtAt(x, z);
    const k2 = cell(x, z);
    if (k2 < 0 || occ[k2]) continue;
    const clr = roads.roadClearance(x, z);
    if (clr < 2.5) continue;
    if (roads.railDistance(x, z) < 8) continue;
    let bad = false;
    for (const r of reserves) if ((x - r.x) ** 2 + (z - r.z) ** 2 < r.r * r.r) { bad = true; break; }
    if (bad) continue;
    let type;
    if (d.type === 'outskirts' || d.type === 'fireworks' || d.type === 'match') type = rng() < 0.55 ? 'palm' : rng() < 0.5 ? 'shrub' : 'neem';
    else if (d.type === 'village') type = rng() < 0.45 ? 'palm' : rng() < 0.6 ? 'neem' : 'tamarind';
    else type = rng() < 0.7 ? 'neem' : 'palm';
    occ[k2] = 1;
    plan.trees.push({ type, x, z, s: 0.75 + rng() * 0.6, r: rng() * 6.28 });
  }
  // tamarind avenue trees on highways (very Tamil Nadu)
  for (const e of edges) {
    if (e.type !== 'highway' && e.type !== 'rural') continue;
    for (let s = 10; s < e.len - 10; s += 22 + rng() * 14) {
      for (const side of [1, -1]) {
        if (rng() < 0.35) continue;
        const off = e.hw + 4 + rng() * 2;
        const x = e.a.x + e.dx * s + e.dz * side * off;
        const z = e.a.z + e.dz * s - e.dx * side * off;
        if (!inChunk(x, z)) continue;
        const d = districtAt(x, z);
        if (d.type !== 'outskirts' && d.type !== 'village' && d.type !== 'fireworks') continue;
        const k2 = cell(x, z);
        if (k2 < 0 || occ[k2] || roads.roadClearance(x, z) < 3) continue;
        occ[k2] = 1;
        plan.trees.push({ type: rng() < 0.6 ? 'tamarind' : 'neem', x, z, s: 0.8 + rng() * 0.4, r: rng() * 6.28 });
      }
    }
  }
  for (const t of plan.trees) {
    plan.colliders.push({ type: 'circle', x: t.x, z: t.z, r: t.type === 'tamarind' ? 0.6 : t.type === 'shrub' ? 0.6 : 0.35 });
  }

  // ---------------------------------------------------------------- street furniture
  for (const e of edges) {
    const side = e.i % 2 ? 1 : -1;
    const lx = e.dz * side;
    const lz = -e.dx * side;
    const step = e.type === 'highway' ? 42 : 34;
    let prev = null;
    for (let s = 8; s < e.len - 8; s += step) {
      const off = e.hw + 1.1;
      const x = e.a.x + e.dx * s + lx * off;
      const z = e.a.z + e.dz * s + lz * off;
      if (!inChunk(x, z)) { prev = null; continue; }
      if (roads.roadClearance(x, z) < 0.6 || roads.railDistance(x, z) < 6) { prev = null; continue; }
      const pole = { x, z, rot: Math.atan2(-lx, -lz), lamp: Math.round(s / step) % 2 === 0 || e.type === 'main' };
      plan.poles.push(pole);
      plan.colliders.push({ type: 'circle', x, z, r: 0.2 });
      if (pole.lamp) {
        plan.lamps.push({ x: x - lx * 1.6, y: 7.1, z: z - lz * 1.6 });
      }
      if (prev) pole.prev = prev;
      prev = pole;
    }
    // sidewalk spots used by idle pedestrians
    if (e.type !== 'highway' && e.type !== 'rural') {
      for (let s = 15; s < e.len - 15; s += 25) {
        for (const sd of [1, -1]) {
          const off = e.hw + 1.4;
          const x = e.a.x + e.dx * s + e.dz * sd * off;
          const z = e.a.z + e.dz * s - e.dx * sd * off;
          if (inChunk(x, z)) plan.sidewalkSpots.push({ x, z });
        }
      }
    }
  }

  // banners at busy junctions, cows & carts
  for (const n of roads.nodes.values()) {
    if (!inChunk(n.x, n.z) || n.edges.length < 3) continue;
    if (rng() > 0.45) continue;
    const e = n.edges[Math.floor(rng() * n.edges.length)];
    const dir = e.a === n ? 1 : -1;
    const fx = e.dx * dir, fz = e.dz * dir;
    const off = e.hw + 3;
    const x = n.x + fx * (n.radius + 10) + fz * off;
    const z = n.z + fz * (n.radius + 10) - fx * off;
    if (roads.roadClearance(x, z) < 1.5 || !inChunk(x, z)) continue;
    plan.banners.push({ x, z, rot: Math.atan2(fz, -fx), key: `banner${Math.floor(rng() * 6)}` });
  }
  const cattle = dMid.type === 'village' || dMid.type === 'outskirts' ? 3 : dMid.type === 'residential' || dMid.type === 'residential_edge' ? 1 : town ? 1 : 0;
  for (let k = 0; k < cattle; k++) {
    if (rng() > 0.6 * propsDensity) continue;
    const e = edges[Math.floor(rng() * edges.length)];
    if (!e) break;
    const s = rng() * e.len;
    const side = rng() < 0.5 ? 1 : -1;
    const off = e.hw + 1.5 + rng() * 3;
    const x = e.a.x + e.dx * s + e.dz * side * off;
    const z = e.a.z + e.dz * s - e.dx * side * off;
    if (!inChunk(x, z) || roads.roadClearance(x, z) < 0.8) continue;
    const k2 = cell(x, z);
    if (k2 >= 0 && occ[k2]) continue;
    plan.animals.push({ kind: rng() < 0.7 ? 'cow' : 'goat', x, z, rot: rng() * 6.28, color: pick(rng, ['#f2f0ea', '#d8d2c4', '#8a6a4a', '#3a3a3a', '#c8b89a']) });
    plan.colliders.push({ type: 'circle', x, z, r: 0.8 });
  }
  if (town || dMid.type === 'residential') {
    for (let k = 0; k < 3; k++) {
      if (rng() > 0.6 * propsDensity) continue;
      const e = edges[Math.floor(rng() * edges.length)];
      if (!e || e.type === 'highway') continue;
      const s = 12 + rng() * (e.len - 24);
      const side = rng() < 0.5 ? 1 : -1;
      const off = e.hw + 1.2;
      const x = e.a.x + e.dx * s + e.dz * side * off;
      const z = e.a.z + e.dz * s - e.dx * side * off;
      if (!inChunk(x, z) || roads.roadClearance(x, z) < 0.5) continue;
      plan.carts.push({ x, z, rot: Math.atan2(e.dx, e.dz), color: pick(rng, TARPS), goods: Math.floor(rng() * 3) });
      plan.colliders.push({ type: 'circle', x, z, r: 0.9 });
    }
  }
  return plan;
}

// ====================================================================== MESHES
const rowV = (row, tex) => {
  const inset = 2 / tex;
  return [1 - (row + 1) / FACADE_ROWS + inset, 1 - row / FACADE_ROWS - inset];
};

function rowFor(b, side, floor) {
  switch (b.kind) {
    case 'unit': return ROW.BRICK;
    case 'shed': return ROW.SHED;
    case 'hut': return ROW.PLAIN;
    case 'village':
      return side === 0 && floor === 0 ? ROW.HOUSE : ROW.PLAIN;
    case 'house':
      if (side === 0) return floor === 0 ? (b.shop ? ROW.SHUTTER : ROW.HOUSE) : b.winRow;
      return ROW.PLAIN;
    default: // shop / press
      if (side === 0) {
        if (floor === 0) return b.shop ? (b.open ? ROW.SHOP : ROW.SHUTTER) : ROW.HOUSE;
        return b.winRow;
      }
      return floor === 0 || side === 2 ? ROW.PLAIN : b.kind === 'press' ? ROW.WIN_B : ROW.PLAIN;
  }
}

const _col = new THREE.Color();
const tmpC = (hex, mul = 1) => _col.set(hex).multiplyScalar(mul).clone();

export function addFacadeBuilding(fb, b, tex, lowDetail) {
  fb.place(b.x, 0, b.z, b.rot);
  const w = b.w, d = b.d, H = b.h;
  const paint = new THREE.Color(b.paint);
  const hw = w / 2, hd = d / 2;
  // sides: 0 front(+z) 1 right(+x) 2 back(-z) 3 left(-x)
  const sides = [
    [[-hw, hd], [hw, hd]],
    [[hw, hd], [hw, -hd]],
    [[hw, -hd], [-hw, -hd]],
    [[-hw, -hd], [-hw, hd]],
  ];
  const parapet = b.roof === 'flat' ? 0.9 : 0;
  const shade = [1, 0.93, 0.86, 0.93];
  sides.forEach(([a, c], si) => {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const u1 = len / BAY_U;
    const col = paint.clone().multiplyScalar(shade[si]);
    if (lowDetail) {
      // tileable low-LOD facade: one texture repeat = 4 bays x 4 floors
      const plain = b.kind === 'unit' || b.kind === 'shed' || b.kind === 'hut';
      const uv = plain ? [0.004, 0.99, 0.012, 0.996] : [0, 0, len / BAY_U, (H + parapet) / (FLOOR_H * 4)];
      fb.quad([a[0], 0, a[1]], [c[0], 0, c[1]], [c[0], H + parapet, c[1]], [a[0], H + parapet, a[1]], col, uv);
      return;
    }
    for (let f = 0; f < b.floors; f++) {
      const row = rowFor(b, si, f);
      const [v0, v1] = rowV(row, tex);
      const y0 = f * FLOOR_H;
      const y1 = y0 + FLOOR_H;
      fb.quad([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], col, [0, v0, u1, v1]);
    }
    if (parapet) {
      const [, v1] = rowV(ROW.PLAIN, tex);
      const pv0 = v1 - 0.25 / FACADE_ROWS;
      fb.quad([a[0], H, a[1]], [c[0], H, c[1]], [c[0], H + parapet, c[1]], [a[0], H + parapet, a[1]], col, [0, pv0, u1, v1]);
      // inner face of the parapet
      const ins = 0.2;
      const ia = [a[0] - Math.sign(a[0]) * ins, a[1] - Math.sign(a[1]) * ins];
      const ic = [c[0] - Math.sign(c[0]) * ins, c[1] - Math.sign(c[1]) * ins];
      fb.quad([ic[0], H, ic[1]], [ia[0], H, ia[1]], [ia[0], H + parapet, ia[1]], [ic[0], H + parapet, ic[1]], col.clone().multiplyScalar(0.85), [0, pv0, u1, v1]);
      // parapet cap
      fb.quad([a[0], H + parapet, a[1]], [c[0], H + parapet, c[1]], [ic[0], H + parapet, ic[1]], [ia[0], H + parapet, ia[1]], col, [0, pv0, 0.01, v1]);
    }
  });
  if (b.roof === 'flat' || lowDetail) {
    const [, v1] = rowV(ROW.PLAIN, tex);
    const rc = tmpC(b.roof === 'tile' ? '#9c4a2c' : b.roof === 'thatch' ? '#b39556' : '#9e968a', 1);
    const y = H + (lowDetail ? parapet : 0.02);
    const uv = lowDetail ? [0.004, 0.99, 0.012, 0.996] : [0.001, v1 - 0.02, 0.01, v1 - 0.01];
    fb.quad([-hw, y, hd], [hw, y, hd], [hw, y, -hd], [-hw, y, -hd], rc, uv);
  }
  fb.setTransform(null);
}

export function addDetails(db, sb, lb, b, mats, rng) {
  db.place(b.x, 0, b.z, b.rot);
  sb.place(b.x, 0, b.z, b.rot);
  const w = b.w, d = b.d, H = b.h, hw = w / 2, hd = d / 2;
  const paint = new THREE.Color(b.paint);
  const concrete = tmpC('#b8b2a6');

  if (b.roof === 'tile') {
    const tile = tmpC('#9c4a2c');
    const ov = 0.45;
    const ridge = 1.7;
    db.quad([-hw - ov, H, hd + ov], [hw + ov, H, hd + ov], [hw + ov, H + ridge, 0], [-hw - ov, H + ridge, 0], tile);
    db.quad([hw + ov, H, -hd - ov], [-hw - ov, H, -hd - ov], [-hw - ov, H + ridge, 0], [hw + ov, H + ridge, 0], tile.clone().multiplyScalar(0.85));
    db.tri([hw, H, hd], [hw, H, -hd], [hw, H + ridge, 0], paint);
    db.tri([-hw, H, -hd], [-hw, H, hd], [-hw, H + ridge, 0], paint);
    // underside of eaves
    db.quad([hw + ov, H, hd + ov], [-hw - ov, H, hd + ov], [-hw - ov, H - 0.01, hd], [hw + ov, H - 0.01, hd], tile.clone().multiplyScalar(0.5));
  } else if (b.roof === 'thatch') {
    const straw = tmpC('#b39556');
    const ov = 0.6;
    const top = [0, H + 2.2, 0];
    db.tri([-hw - ov, H - 0.2, hd + ov], [hw + ov, H - 0.2, hd + ov], top, straw);
    db.tri([hw + ov, H - 0.2, hd + ov], [hw + ov, H - 0.2, -hd - ov], top, straw.clone().multiplyScalar(0.9));
    db.tri([hw + ov, H - 0.2, -hd - ov], [-hw - ov, H - 0.2, -hd - ov], top, straw.clone().multiplyScalar(0.8));
    db.tri([-hw - ov, H - 0.2, -hd - ov], [-hw - ov, H - 0.2, hd + ov], top, straw.clone().multiplyScalar(0.9));
  } else if (b.roof === 'shed') {
    const sheet = tmpC(b.kind === 'unit' ? '#b9b7b0' : '#8ea3b5');
    const ov = b.kind === 'unit' ? 0.5 : 0.3;
    const ridge = b.kind === 'unit' ? 0.5 : 1.8;
    db.quad([-hw - ov, H, hd + ov], [hw + ov, H, hd + ov], [hw + ov, H + ridge, 0], [-hw - ov, H + ridge, 0], sheet);
    db.quad([hw + ov, H, -hd - ov], [-hw - ov, H, -hd - ov], [-hw - ov, H + ridge, 0], [hw + ov, H + ridge, 0], sheet.clone().multiplyScalar(0.85));
    db.tri([hw, H, hd], [hw, H, -hd], [hw, H + ridge, 0], sheet.clone().multiplyScalar(0.8));
    db.tri([-hw, H, -hd], [-hw, H, hd], [-hw, H + ridge, 0], sheet.clone().multiplyScalar(0.8));
  } else {
    // flat roof: black Sintex water tank + stair room
    if (b.tank) {
      const tx = (rng() - 0.5) * (w - 2.5);
      const tz = -hd * 0.4;
      db.geometry(TANK, new THREE.Matrix4().makeTranslation(tx, H + 0.75, tz), tmpC('#1a1a1a'));
      db.box(tx, H + 0.1, tz, 1.4, 0.2, 1.4, concrete);
    }
    if (b.stair && w > 6 && d > 6) {
      db.box(hw - 1.6, H + 1.35, -hd + 1.6, 2.6, 2.7, 2.6, paint.clone().multiplyScalar(0.92));
    }
  }

  // sunshades (chajja) above windows
  if (b.kind !== 'unit' && b.kind !== 'shed' && b.kind !== 'hut') {
    for (let f = b.shop ? 1 : 0; f < b.floors; f++) {
      db.box(0, f * FLOOR_H + FLOOR_H * 0.8, hd + 0.3, w - 0.3, 0.1, 0.6, concrete);
    }
    if (b.balcony) {
      db.box(0, FLOOR_H + 0.05, hd + 0.6, w * 0.6, 0.15, 1.2, concrete);
      db.box(0, FLOOR_H + 0.55, hd + 1.15, w * 0.6, 0.9, 0.08, paint.clone().multiplyScalar(0.8));
    }
  }
  // shop awning + signboard
  if (b.shop) {
    if (b.awning) {
      const tarp = tmpC(b.awning);
      db.quad([-hw + 0.2, 2.45, hd + 1.7], [hw - 0.2, 2.45, hd + 1.7], [hw - 0.2, 2.95, hd + 0.02], [-hw + 0.2, 2.95, hd + 0.02], tarp);
      db.quad([hw - 0.2, 2.45, hd + 1.7], [-hw + 0.2, 2.45, hd + 1.7], [-hw + 0.2, 2.94, hd + 0.02], [hw - 0.2, 2.94, hd + 0.02], tarp.clone().multiplyScalar(0.55));
    }
    if (b.sign >= 0) {
      const uv = mats.signUV(`shop${b.sign}`);
      const sw = Math.min(w - 0.4, 9);
      sb.quad([-sw / 2, 3.25, hd + 0.14], [sw / 2, 3.25, hd + 0.14], [sw / 2, 4.15, hd + 0.14], [-sw / 2, 4.15, hd + 0.14], tmpC('#ffffff'), uv);
      db.box(0, 3.7, hd + 0.07, sw + 0.1, 0.96, 0.12, tmpC('#333'));
      // tube light under the board
      lb.box(0, 3.15, hd + 0.2, sw * 0.6, 0.06, 0.06, tmpC('#fff'));
    }
  }
  if (b.kind === 'unit') {
    // fireworks safety room: thick blast walls + sand bucket stand
    db.box(0, 1.1, hd + 1.2, w + 0.4, 2.2, 0.5, tmpC('#9a5a3c'));
    db.box(hw + 0.8, 0.5, 0, 0.3, 1, 0.6, tmpC('#c62828'));
  }
  db.setTransform(null);
  sb.setTransform(null);
}

// Shared small geometries
export const TANK = new THREE.CylinderGeometry(0.6, 0.6, 1.3, 10);
export const WHEEL = new THREE.CylinderGeometry(0.3, 0.3, 0.08, 10).rotateZ(Math.PI / 2);

function addPole(db, lb, p) {
  db.place(p.x, 0, p.z, p.rot);
  const conc = tmpC('#a9a59c');
  db.box(0, 4.5, 0, 0.22, 9, 0.22, conc);
  db.box(0, 8.6, 0, 1.8, 0.1, 0.1, conc);
  if (p.lamp) {
    db.box(0, 7.1, 0.8, 0.08, 0.08, 1.6, tmpC('#555'));
    lb.place(p.x, 0, p.z, p.rot);
    lb.box(0, 7.02, 1.6, 0.3, 0.1, 0.6, tmpC('#fff'));
    lb.setTransform(null);
  }
  db.setTransform(null);
}

function addParkedBike(db, p) {
  db.place(p.x, 0, p.z, p.rot);
  const c = tmpC(p.color);
  db.geometry(WHEEL, new THREE.Matrix4().makeTranslation(0, 0.3, 0.65), tmpC('#151515'));
  db.geometry(WHEEL, new THREE.Matrix4().makeTranslation(0, 0.3, -0.65), tmpC('#151515'));
  db.box(0, 0.55, 0, 0.25, 0.3, 1.1, c);
  db.box(0, 0.78, -0.15, 0.26, 0.1, 0.7, tmpC('#111'));
  db.box(0, 0.75, 0.35, 0.22, 0.22, 0.3, c);
  db.box(0, 1.0, 0.6, 0.7, 0.04, 0.04, tmpC('#666'));
  db.setTransform(null);
}

function addAnimal(db, a) {
  db.place(a.x, 0, a.z, a.rot);
  if (a.kind === 'sand') {
    db.box(0, 0.4, 0, 3.5, 0.8, 1.2, tmpC('#c9a66b'));
  } else if (a.kind === 'cow') {
    const c = tmpC(a.color);
    db.box(0, 1.05, 0, 0.55, 0.6, 1.5, c);
    db.box(0, 1.15, 0.9, 0.3, 0.35, 0.45, c);
    db.box(0, 1.3, 0.72, 0.28, 0.12, 0.12, c.clone().multiplyScalar(0.9)); // hump
    db.box(0.1, 1.45, 0.92, 0.04, 0.2, 0.04, tmpC('#d8cfc0'));
    db.box(-0.1, 1.45, 0.92, 0.04, 0.2, 0.04, tmpC('#d8cfc0'));
    for (const [lx, lz] of [[0.18, 0.55], [-0.18, 0.55], [0.18, -0.55], [-0.18, -0.55]]) db.box(lx, 0.38, lz, 0.1, 0.76, 0.1, c.clone().multiplyScalar(0.85));
    db.box(0, 0.95, -0.78, 0.04, 0.5, 0.04, c);
  } else {
    const c = tmpC(a.color);
    db.box(0, 0.55, 0, 0.3, 0.32, 0.75, c);
    db.box(0, 0.75, 0.45, 0.16, 0.2, 0.25, c);
    for (const [lx, lz] of [[0.1, 0.28], [-0.1, 0.28], [0.1, -0.28], [-0.1, -0.28]]) db.box(lx, 0.2, lz, 0.06, 0.4, 0.06, c);
  }
  db.setTransform(null);
}

function addCart(db, c) {
  db.place(c.x, 0, c.z, c.rot);
  db.box(0, 0.85, 0, 1.2, 0.1, 2, tmpC('#6d4c41'));
  db.geometry(WHEEL, new THREE.Matrix4().makeTranslation(0.65, 0.3, 0).multiply(new THREE.Matrix4().makeScale(1.2, 1, 1)), tmpC('#222'));
  db.geometry(WHEEL, new THREE.Matrix4().makeTranslation(-0.65, 0.3, 0), tmpC('#222'));
  const goods = ['#ff7043', '#8bc34a', '#ffd54f'][c.goods];
  for (let i = 0; i < 6; i++) db.box((i % 2 - 0.5) * 0.5, 1.0, (Math.floor(i / 2) - 1) * 0.55, 0.45, 0.2, 0.45, tmpC(goods, 0.8 + (i % 3) * 0.1));
  db.box(0, 1.6, 0, 0.04, 1.4, 0.04, tmpC('#444'));
  const um = tmpC(c.color);
  db.tri([-1.1, 2.1, 1.1], [1.1, 2.1, 1.1], [0, 2.5, 0], um);
  db.tri([1.1, 2.1, 1.1], [1.1, 2.1, -1.1], [0, 2.5, 0], um.clone().multiplyScalar(0.9));
  db.tri([1.1, 2.1, -1.1], [-1.1, 2.1, -1.1], [0, 2.5, 0], um);
  db.tri([-1.1, 2.1, -1.1], [-1.1, 2.1, 1.1], [0, 2.5, 0], um.clone().multiplyScalar(0.9));
  db.setTransform(null);
}

function addBanner(db, sb, mats, bn) {
  db.place(bn.x, 0, bn.z, bn.rot);
  sb.place(bn.x, 0, bn.z, bn.rot);
  const W = bn.small ? 3 : 7;
  const Hs = bn.small ? 1.2 : 2.2;
  const base = bn.small ? 1.2 : 2.6;
  db.box(-W / 2, (base + Hs) / 2, 0, 0.1, base + Hs, 0.1, tmpC('#555'));
  db.box(W / 2, (base + Hs) / 2, 0, 0.1, base + Hs, 0.1, tmpC('#555'));
  const uv = mats.signUV(bn.key);
  sb.quad([-W / 2, base, 0.06], [W / 2, base, 0.06], [W / 2, base + Hs, 0.06], [-W / 2, base + Hs, 0.06], tmpC('#fff'), uv);
  sb.quad([W / 2, base, -0.06], [-W / 2, base, -0.06], [-W / 2, base + Hs, -0.06], [W / 2, base + Hs, -0.06], tmpC('#ddd'), uv);
  db.setTransform(null);
  sb.setTransform(null);
}

function addField(cb, f) {
  cb.place(f.x, 0.03, f.z, f.rot);
  const c = tmpC(f.color);
  cb.quad([-f.w / 2, 0, f.d / 2], [f.w / 2, 0, f.d / 2], [f.w / 2, 0, -f.d / 2], [-f.w / 2, 0, -f.d / 2], c, [0, 0, f.w / 12, f.d / 12]);
  cb.setTransform(null);
}

function wireGeometry(plan) {
  const pts = [];
  for (const p of plan.poles) {
    if (!p.prev) continue;
    const a = p.prev;
    for (const o of [-0.8, 0, 0.8]) {
      const ax = a.x + Math.cos(a.rot) * o, az = a.z - Math.sin(a.rot) * o;
      const bx = p.x + Math.cos(p.rot) * o, bz = p.z - Math.sin(p.rot) * o;
      let px = ax, py = 8.6, pz = az;
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        const x = ax + (bx - ax) * t;
        const z = az + (bz - az) * t;
        const y = 8.6 - Math.sin(t * Math.PI) * 0.7;
        pts.push(px, py, pz, x, y, z);
        px = x; py = y; pz = z;
      }
    }
  }
  if (!pts.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

export function buildLow(plan, mats) {
  const fb = new GeoBuilder();
  const tex = mats.factory.size;
  for (const b of plan.buildings) addFacadeBuilding(fb, b, tex, true);
  if (!fb.vertexCount) return null;
  const mesh = new THREE.Mesh(fb.build(), mats.facadeLow);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  return mesh;
}

export function buildTrees(plan, treeGeos, mats, castShadow) {
  const group = new THREE.Group();
  const byType = {};
  for (const t of plan.trees) (byType[t.type] ||= []).push(t);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (const [type, list] of Object.entries(byType)) {
    const im = new THREE.InstancedMesh(treeGeos[type], mats.tree, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(up, t.r);
      s.setScalar(t.s);
      p.set(t.x, terrainHeight(t.x, t.z), t.z);
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    im.castShadow = castShadow;
    im.receiveShadow = false;
    group.add(im);
  }
  return group;
}

export function buildHigh(plan, mats, castShadow) {
  const tex = mats.factory.size;
  const rng = mulberry32(plan.cx * 928371 + plan.cz * 1237);
  const fb = new GeoBuilder();
  const db = new GeoBuilder();
  const sb = new GeoBuilder();
  const lb = new GeoBuilder();
  const cb = new GeoBuilder();
  for (const b of plan.buildings) {
    addFacadeBuilding(fb, b, tex, false);
    addDetails(db, sb, lb, b, mats, rng);
  }
  for (const p of plan.poles) addPole(db, lb, p);
  for (const p of plan.parked) addParkedBike(db, p);
  for (const a of plan.animals) addAnimal(db, a);
  for (const c of plan.carts) addCart(db, c);
  for (const bn of plan.banners) addBanner(db, sb, mats, bn);
  for (const f of plan.fields) addField(cb, f);

  const group = new THREE.Group();
  const add = (builder, mat, shadow = true) => {
    if (!builder.vertexCount) return;
    const mesh = new THREE.Mesh(builder.build(), mat);
    mesh.castShadow = shadow && castShadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  };
  add(fb, mats.facade);
  add(db, mats.detail);
  add(sb, mats.signs, false);
  add(lb, mats.lamp, false);
  add(cb, mats.crops, false);
  const wires = wireGeometry(plan);
  if (wires) group.add(new THREE.LineSegments(wires, mats.wire));
  return group;
}
