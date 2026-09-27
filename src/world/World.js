// World partition + level streaming.
// The map is split into 160 m chunks. Around the player:
//   detail ring  -> full-detail merged meshes (facades, signs, props, wires)
//   far ring     -> cheap textured blocks + trees
//   beyond       -> nothing (fog / sky)
// Chunk meshes are built incrementally under a per-frame time budget, so new areas
// stream in without freezing, and chunks that fall out of range are disposed.
import * as THREE from 'three';
import { WORLD, districtAt, terrainHeight, HILL } from './MapData.js';
import { RoadNetwork } from './RoadNetwork.js';
import { Materials } from './Materials.js';
import { planChunk, buildLow, buildHigh, buildTrees } from './ChunkBuilder.js';
import { buildTreeGeometries, buildLowTreeGeometries } from './Vegetation.js';
import { buildLandmarks } from './Landmarks.js';
import { Railway } from './Railway.js';
import { GeoBuilder } from './GeoBuilder.js';
import { fbm, clamp } from '../core/utils.js';

const MIN_C = -WORLD.half / WORLD.chunk;
const MAX_C = WORLD.half / WORLD.chunk - 1;
const TOWN_TYPES = new Set(['bazaar', 'commercial', 'residential', 'town', 'printing', 'residential_edge']);
const GCELL = 50;

export class World {
  constructor(engine, events) {
    this.engine = engine;
    this.scene = engine.scene;
    this.events = events;
    this.preset = engine.preset;
    this.roads = new RoadNetwork();
    this.chunks = new Map();
    this.plans = new Map();
    this.queue = [];
    this.globalColliders = new Map();
    this.walkables = [];
    this.stats = { high: 0, low: 0, built: 0 };
  }

  /** Heavy one-off setup, split into steps so the loading bar can animate. */
  async init(progress = () => {}) {
    const step = async (label, frac, fn) => {
      progress(label, frac);
      await new Promise((r) => setTimeout(r, 0));
      fn();
    };
    await step('அமைப்புகள் தயாராகின்றன… (materials)', 0.05, () => {
      this.mats = new Materials(this.preset);
      this.treeGeos = buildTreeGeometries();
      this.treeGeosLow = buildLowTreeGeometries();
    });
    await step('நிலம் மற்றும் சாலைகள்… (ground & roads)', 0.15, () => {
      this.buildGround();
      this.buildRoads();
    });
    await step('முக்கிய இடங்கள்… (landmarks)', 0.3, () => {
      const lm = buildLandmarks(this.mats, this.preset.shadows);
      this.landmarks = lm;
      this.scene.add(lm.group);
      lm.colliders.forEach((c) => this.addGlobalCollider(c));
      // bus stand platform is walkable
      this.walkables.push({ x: 76, z: 76, hw: 46, hd: 5.5, c: 1, s: 0, h: 0.3 });
    });
    await step('ரயில் பாதை… (railway)', 0.4, () => {
      this.railway = new Railway(this.scene, this.roads, this.mats, this.preset.shadows);
      this.railway.colliders.forEach((c) => this.addGlobalCollider(c));
      this.walkables.push(...this.railway.walkables);
    });
    this.buildLampLights();
  }

  // ------------------------------------------------------------ ground
  buildGround() {
    const size = WORLD.half * 2 + 200;
    const seg = 200;
    const g = new THREE.PlaneGeometry(size, size, seg, seg).rotateX(-Math.PI / 2);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const cols = [];
    const c = new THREE.Color();
    const town = new THREE.Color('#b4aa9a');
    const red = new THREE.Color('#c29270');
    const green = new THREE.Color('#a7b27a');
    const dry = new THREE.Color('#c4b296');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(x, z));
      const d = districtAt(x, z);
      const n = fbm(x / 140, z / 140, 3);
      if (TOWN_TYPES.has(d.type)) c.copy(town).lerp(dry, n * 0.4);
      else if (d.type === 'fireworks' || d.type === 'match') c.copy(red).lerp(dry, n * 0.6);
      else if (d.type === 'village') c.copy(green).lerp(dry, n * 0.7);
      else c.copy(dry).lerp(green, clamp(n * 1.3 - 0.35, 0, 1)).lerp(red, clamp(0.5 - n, 0, 0.3));
      if (Math.hypot(x - HILL.x, z - HILL.z) < HILL.r) c.lerp(new THREE.Color('#8d8a70'), 0.5);
      cols.push(c.r, c.g, c.b);
      uv.setXY(i, x / 12, z / 12);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    const ground = new THREE.Mesh(g, this.mats.ground);
    ground.receiveShadow = true;
    this.scene.add(ground);
    // horizon apron beyond the playable map
    const outer = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.7, 9000, 32, 1).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xb49a78, roughness: 1 }),
    );
    outer.position.y = -0.05;
    this.scene.add(outer);
    this.ground = ground;
  }

  // ------------------------------------------------------------ roads
  buildRoads() {
    const marked = new GeoBuilder();
    const rural = new GeoBuilder();
    const walk = new GeoBuilder();
    const junc = new GeoBuilder();
    const white = new THREE.Color(1, 1, 1);
    const curb = new THREE.Color('#d9d4c8');
    for (const e of this.roads.edges) {
      const b = e.type === 'rural' ? rural : marked;
      const ang = Math.atan2(e.b.x - e.a.x, e.b.z - e.a.z);
      const mx = (e.a.x + e.b.x) / 2;
      const mz = (e.a.z + e.b.z) / 2;
      b.place(mx, 0.04, mz, ang);
      const L = e.len / 2;
      b.quad([-e.hw, 0, L], [e.hw, 0, L], [e.hw, 0, -L], [-e.hw, 0, -L], white, [0, 0, 1, e.len / 9]);
      b.setTransform(null);
      const d = districtAt(mx, mz);
      e.sidewalk = TOWN_TYPES.has(d.type) && e.type !== 'highway';
      if (e.sidewalk) {
        const ta = e.a.edges.length > 1 ? e.a.radius + 2.6 : 0;
        const tb = e.b.edges.length > 1 ? e.b.radius + 2.6 : 0;
        const len = e.len - ta - tb;
        if (len > 2) {
          const cx = e.a.x + e.dx * (ta + len / 2);
          const cz = e.a.z + e.dz * (ta + len / 2);
          walk.place(cx, 0, cz, ang);
          for (const side of [1, -1]) {
            const x = side * (e.hw + 1.2);
            walk.box(x, 0.08, 0, 2.4, 0.16, len, curb, [0, 0, 1, len / 3], { bottom: true });
          }
          walk.setTransform(null);
        }
      }
    }
    for (const n of this.roads.nodes.values()) {
      if (n.edges.length < 2) continue;
      const r = n.radius + 1.2;
      const circle = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2);
      junc.geometry(circle, new THREE.Matrix4().makeTranslation(n.x, 0.05, n.z), white);
    }
    const add = (b, mat) => {
      const m = new THREE.Mesh(b.build(), mat);
      m.receiveShadow = true;
      this.scene.add(m);
    };
    add(marked, this.mats.road);
    add(rural, this.mats.roadRural);
    add(walk, this.mats.sidewalk);
    add(junc, this.mats.junction);
  }

  // ------------------------------------------------------------ colliders
  addGlobalCollider(c) {
    const r = c.type === 'rect' ? Math.hypot(c.hw, c.hd) : c.r;
    const x0 = Math.floor((c.x - r) / GCELL), x1 = Math.floor((c.x + r) / GCELL);
    const z0 = Math.floor((c.z - r) / GCELL), z1 = Math.floor((c.z + r) / GCELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = x * 10007 + z;
        if (!this.globalColliders.has(k)) this.globalColliders.set(k, []);
        this.globalColliders.get(k).push(c);
      }
    }
  }

  getPlan(cx, cz) {
    const k = cx * 1000 + cz;
    let p = this.plans.get(k);
    if (!p) {
      p = planChunk(cx, cz, this.roads, this.preset.props);
      this.plans.set(k, p);
    }
    return p;
  }

  /** Colliders around a point (chunk plans + global landmark/railway colliders). */
  collidersNear(x, z) {
    const out = [];
    const C = WORLD.chunk;
    const cx = Math.floor(x / C);
    const cz = Math.floor(z / C);
    const fx = (x - cx * C) / C;
    const fz = (z - cz * C) / C;
    const xs = [cx, fx < 0.3 ? cx - 1 : fx > 0.7 ? cx + 1 : null].filter((v) => v !== null && v >= MIN_C && v <= MAX_C);
    const zs = [cz, fz < 0.3 ? cz - 1 : fz > 0.7 ? cz + 1 : null].filter((v) => v !== null && v >= MIN_C && v <= MAX_C);
    for (const ix of xs) for (const iz of zs) out.push(...this.getPlan(ix, iz).colliders);
    const g = this.globalColliders.get(Math.floor(x / GCELL) * 10007 + Math.floor(z / GCELL));
    if (g) out.push(...g);
    return out;
  }

  /**
   * Push a circle out of static geometry. Returns the collision normal (or null).
   * `height` lets short things (walls < 1 m) be ignored for tall movers if needed.
   */
  resolveCircle(pos, radius) {
    let hit = null;
    const list = this.collidersNear(pos.x, pos.z);
    for (let iter = 0; iter < 2; iter++) {
      for (const c of list) {
        if (c.type === 'circle') {
          const dx = pos.x - c.x;
          const dz = pos.z - c.z;
          const rr = radius + c.r;
          const d2 = dx * dx + dz * dz;
          if (d2 < rr * rr && d2 > 1e-8) {
            const d = Math.sqrt(d2);
            const push = rr - d;
            pos.x += (dx / d) * push;
            pos.z += (dz / d) * push;
            hit = { nx: dx / d, nz: dz / d, depth: push };
          }
          continue;
        }
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const lx = dx * c.c - dz * c.s;
        const lz = dx * c.s + dz * c.c;
        if (Math.abs(lx) > c.hw + radius || Math.abs(lz) > c.hd + radius) continue;
        const qx = clamp(lx, -c.hw, c.hw);
        const qz = clamp(lz, -c.hd, c.hd);
        let ex = lx - qx;
        let ez = lz - qz;
        let d = Math.hypot(ex, ez);
        let nlx, nlz, push;
        if (d > 1e-6) {
          if (d >= radius) continue;
          nlx = ex / d; nlz = ez / d; push = radius - d;
        } else {
          // centre inside the rectangle: exit along the shallowest axis
          const px = c.hw - Math.abs(lx);
          const pz = c.hd - Math.abs(lz);
          if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; push = px + radius; }
          else { nlx = 0; nlz = Math.sign(lz) || 1; push = pz + radius; }
        }
        const nx = nlx * c.c + nlz * c.s;
        const nz = -nlx * c.s + nlz * c.c;
        pos.x += nx * push;
        pos.z += nz * push;
        hit = { nx, nz, depth: push };
      }
    }
    return hit;
  }

  /** Walkable height (terrain, platforms, sidewalks). */
  heightAt(x, z) {
    let h = terrainHeight(x, z);
    for (const w of this.walkables) {
      const dx = x - w.x;
      const dz = z - w.z;
      const lx = dx * w.c - dz * w.s;
      const lz = dx * w.s + dz * w.c;
      if (Math.abs(lx) < w.hw && Math.abs(lz) < w.hd) h = Math.max(h, w.h);
    }
    const n = this.roads.nearest(x, z);
    if (n && n.edge.sidewalk && n.d > n.edge.hw && n.d < n.edge.hw + 2.4 && n.t > 0.02 && n.t < 0.98) {
      const ta = n.edge.a.radius + 2.6;
      const s = n.t * n.edge.len;
      if (s > ta && s < n.edge.len - (n.edge.b.radius + 2.6)) h = Math.max(h, 0.16);
    }
    return h;
  }

  // ------------------------------------------------------------ streaming
  chunkKey(cx, cz) {
    return cx * 1000 + cz;
  }

  desiredState(dist) {
    if (dist <= this.preset.detailRadius) return 2;
    if (dist <= this.preset.farRadius) return 1;
    return 0;
  }

  refreshTargets(px, pz) {
    const C = WORLD.chunk;
    const pcx = Math.floor(px / C);
    const pcz = Math.floor(pz / C);
    this.center = [pcx, pcz];
    const R = this.preset.farRadius;
    const tasks = [];
    for (let cx = pcx - R; cx <= pcx + R; cx++) {
      for (let cz = pcz - R; cz <= pcz + R; cz++) {
        if (cx < MIN_C || cx > MAX_C || cz < MIN_C || cz > MAX_C) continue;
        // distance from player to chunk centre in chunk units (circular rings)
        const dx = (cx + 0.5) * C - px;
        const dz = (cz + 0.5) * C - pz;
        const dist = Math.max(0, Math.hypot(dx, dz) / C - 0.5);
        const want = this.desiredState(Math.round(dist));
        const key = this.chunkKey(cx, cz);
        const ch = this.chunks.get(key);
        const have = ch ? ch.state : 0;
        if (want > have) tasks.push({ cx, cz, want, dist });
        else if (ch) ch.want = want;
      }
    }
    // closest first
    tasks.sort((a, b) => a.dist - b.dist);
    this.queue = tasks;
    // unload / downgrade
    for (const [key, ch] of this.chunks) {
      const dx = (ch.cx + 0.5) * C - px;
      const dz = (ch.cz + 0.5) * C - pz;
      const dist = Math.max(0, Math.hypot(dx, dz) / C - 0.5);
      const want = this.desiredState(Math.round(dist - 0.6)); // hysteresis
      if (want >= ch.state) continue;
      if (want < 2 && ch.high) {
        this.disposeGroup(ch.high);
        ch.high = null;
        if (ch.low) ch.low.visible = true;
        this.setTrees(ch, false);
        ch.state = 1;
      }
      if (want < 1) {
        if (ch.low) this.disposeMesh(ch.low);
        if (ch.trees) { this.scene.remove(ch.trees); ch.trees.children.forEach((m) => m.dispose?.()); }
        this.chunks.delete(key);
      }
    }
  }

  processTask(t) {
    const key = this.chunkKey(t.cx, t.cz);
    let ch = this.chunks.get(key);
    if (!ch) {
      ch = { cx: t.cx, cz: t.cz, state: 0, low: null, high: null, trees: null };
      this.chunks.set(key, ch);
    }
    const plan = this.getPlan(t.cx, t.cz);
    if (ch.state < 1) {
      ch.low = buildLow(plan, this.mats);
      if (ch.low) this.scene.add(ch.low);
      this.setTrees(ch, false);
      ch.state = 1;
      this.stats.built++;
      return;
    }
    if (t.want >= 2 && ch.state < 2) {
      ch.high = buildHigh(plan, this.mats, this.preset.shadows);
      this.scene.add(ch.high);
      if (ch.low) ch.low.visible = false;
      this.setTrees(ch, true);
      ch.state = 2;
      this.stats.built++;
    }
  }

  /** Trees: detailed geometry near the player, low-poly further away (same instances). */
  setTrees(ch, detailed) {
    if (ch.trees && ch.treesDetailed === detailed) return;
    if (ch.trees) { this.scene.remove(ch.trees); ch.trees.children.forEach((m) => m.dispose?.()); }
    const plan = this.getPlan(ch.cx, ch.cz);
    ch.trees = buildTrees(plan, detailed ? this.treeGeos : this.treeGeosLow, this.mats, detailed && this.preset.treeShadows);
    ch.treesDetailed = detailed;
    this.scene.add(ch.trees);
  }

  disposeGroup(g) {
    this.scene.remove(g);
    g.traverse((o) => o.geometry?.dispose());
  }

  disposeMesh(m) {
    this.scene.remove(m);
    m.geometry.dispose();
  }

  /** Synchronous-ish preload used behind the loading screen. */
  async preload(px, pz, progress) {
    this.refreshTargets(px, pz);
    const total = this.queue.reduce((n, t) => n + t.want, 0) || 1;
    let done = 0;
    let last = performance.now();
    while (this.queue.length) {
      const t = this.queue.shift();
      this.processTask(t);
      done++;
      const ch = this.chunks.get(this.chunkKey(t.cx, t.cz));
      if (ch && ch.state < t.want) this.queue.unshift(t);
      if (performance.now() - last > 30) {
        progress?.(Math.min(1, done / total));
        await new Promise((r) => setTimeout(r, 0));
        last = performance.now();
      }
    }
    this.lastRefresh = performance.now();
  }

  update(dt, playerPos, night) {
    const now = performance.now();
    if (!this.lastRefresh || now - this.lastRefresh > 400) {
      this.refreshTargets(playerPos.x, playerPos.z);
      this.lastRefresh = now;
    }
    const budget = this.preset.label === 'LOW' ? 3 : 5;
    const t0 = performance.now();
    while (this.queue.length && performance.now() - t0 < budget) {
      const t = this.queue.shift();
      this.processTask(t);
      const ch = this.chunks.get(this.chunkKey(t.cx, t.cz));
      if (ch && ch.state < t.want) this.queue.unshift(t);
    }
    this.railway?.update(dt, this.events);
    this.updateLampLights(playerPos, night);
    this.stats.high = 0;
    this.stats.low = 0;
    for (const ch of this.chunks.values()) ch.state === 2 ? this.stats.high++ : this.stats.low++;
  }

  // ------------------------------------------------------------ night lighting
  buildLampLights() {
    this.lampLights = [];
    for (let i = 0; i < this.preset.nightLights; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 28, 1.6);
      l.castShadow = false;
      this.scene.add(l);
      this.lampLights.push(l);
    }
    this.lampTimer = 0;
  }

  updateLampLights(p, night) {
    if (!this.lampLights.length) return;
    this.lampTimer -= 1;
    if (this.lampTimer <= 0) {
      this.lampTimer = 30;
      const near = [];
      for (const ch of this.chunks.values()) {
        if (ch.state !== 2) continue;
        for (const l of this.getPlan(ch.cx, ch.cz).lamps) {
          const d = (l.x - p.x) ** 2 + (l.z - p.z) ** 2;
          if (d < 90 * 90) near.push([d, l]);
        }
      }
      near.sort((a, b) => a[0] - b[0]);
      this.lampLights.forEach((light, i) => {
        const l = near[i]?.[1];
        if (l) { light.position.set(l.x, l.y - 0.3, l.z); light.userData.on = true; }
        else light.userData.on = false;
      });
    }
    for (const light of this.lampLights) light.intensity = light.userData.on ? night * 60 : 0;
  }

  /** Nearby spots where idle NPCs can stand (shop fronts & sidewalk points). */
  idleSpotsNear(x, z, radius) {
    const out = [];
    const C = WORLD.chunk;
    const r = Math.ceil(radius / C);
    const cx = Math.floor(x / C);
    const cz = Math.floor(z / C);
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cz - r; j <= cz + r; j++) {
        if (i < MIN_C || i > MAX_C || j < MIN_C || j > MAX_C) continue;
        const p = this.getPlan(i, j);
        for (const s of p.shopFronts) out.push({ ...s, role: 'shop_owner' });
        for (const s of p.sidewalkSpots) out.push({ ...s, role: null });
      }
    }
    return out;
  }
}
