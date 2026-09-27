// Dynamic traffic: vehicles are pooled, spawned in a ring around the player (mostly
// out of view), follow left-hand lanes of the road graph with smooth junction curves,
// keep distance from whatever is ahead (cars, the player, pedestrians, closed level
// crossings), honk when blocked, and are recycled when far away. Density follows the
// time of day and the quality preset. All wheels share ONE instanced mesh.
import * as THREE from 'three';
import { Vehicle, WHEEL_TMP } from './Vehicle.js';
import { SPECS } from './VehicleModels.js';
import { districtAt, WORLD } from '../world/MapData.js';
import { mulberry32, weightedPick, clamp } from '../core/utils.js';

const CRUISE = { bike: 11, scooter: 9.5, auto: 8, car: 12.5, police: 13, ambulance: 14, delivery: 10, bus: 10, truck: 9, fire: 12 };
const MAX_WHEELS = 700;

export function densityForHour(h) {
  // morning rush, busy afternoon, evening peak, quiet night
  if (h < 5) return 0.18;
  if (h < 7) return 0.45;
  if (h < 10) return 0.95;
  if (h < 16) return 0.8;
  if (h < 21) return 1.0;
  if (h < 23) return 0.55;
  return 0.3;
}

export class TrafficManager {
  constructor(game) {
    this.game = game;
    this.scene = game.engine.scene;
    this.world = game.world;
    this.roads = game.world.roads;
    this.factory = game.vehicleFactory;
    this.events = game.events;
    this.preset = game.engine.preset;
    this.rng = mulberry32(4242);
    this.active = [];
    this.parked = [];
    this.pools = new Map();
    this.spawnTimer = 0;
    this.wheels = new THREE.InstancedMesh(this.factory.wheelGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), MAX_WHEELS);
    this.wheels.frustumCulled = false;
    this.wheels.castShadow = false;
    this.wheels.count = 0;
    this.scene.add(this.wheels);
  }

  get all() {
    return this.active.concat(this.parked);
  }

  // ------------------------------------------------------------ pooling
  acquire(type) {
    let list = this.pools.get(type);
    if (!list) { list = []; this.pools.set(type, list); }
    const v = list.pop() || new Vehicle(type, Math.floor(this.rng() * 6), this.factory, this.preset.shadows);
    v.health = 100;
    v.speed = 0;
    v.steer = 0;
    v.lean = 0;
    v.sirenOn = false;
    v.parked = false;
    v.player = false;
    this.scene.add(v.group);
    return v;
  }

  release(v) {
    this.scene.remove(v.group);
    this.removeCrew(v);
    v.ai = null;
    this.pools.get(v.type).push(v);
  }

  addCrew(v) {
    if (!this.game.npcs) return;
    const sp = v.spec;
    const role = v.type === 'police' ? 'police' : v.type === 'ambulance' ? 'driver' : v.type === 'auto' ? 'driver' : this.rng() < 0.15 ? 'student' : 'man';
    const crew = this.game.npcs.acquireCrew(role);
    if (!crew) return;
    this.seat(v, crew, sp.seat, sp.pose);
    v.crew = [crew];
    if (v.type === 'bike' && this.rng() < 0.3) {
      const pillion = this.game.npcs.acquireCrew(this.rng() < 0.6 ? 'woman' : 'man');
      if (pillion) {
        this.seat(v, pillion, [0, sp.seat[1] + 0.02, sp.seat[2] - 0.42], pillion.model.appearance.female ? 'sit' : 'drive_bike', pillion.model.appearance.female ? Math.PI / 2 : 0);
        v.crew.push(pillion);
      }
    }
  }

  seat(v, crew, seat, pose, rot = 0) {
    const m = crew.model.mesh;
    m.position.set(seat[0], seat[1] - 0.98 * crew.model.scale + 0.03, seat[2]);
    m.rotation.set(0, rot, 0);
    v.body.add(m);
    crew.animator.setState(pose);
    crew.animator.snap();
  }

  removeCrew(v) {
    if (!v.crew) return;
    for (const c of v.crew) {
      v.body.remove(c.model.mesh);
      this.game.npcs?.releaseCrew(c);
    }
    v.crew = null;
  }

  /** The player takes over a vehicle: its crew gets out as pedestrians. */
  commandeer(v) {
    const ejected = [];
    if (v.crew) {
      for (const c of v.crew) {
        v.body.remove(c.model.mesh);
        ejected.push(c);
      }
      v.crew = null;
    }
    const i = this.active.indexOf(v);
    if (i >= 0) this.active.splice(i, 1);
    const j = this.parked.indexOf(v);
    if (j >= 0) this.parked.splice(j, 1);
    v.ai = null;
    v.player = true;
    return ejected;
  }

  /** Player left the vehicle: it stays where it is as a parked vehicle. */
  abandon(v) {
    v.player = false;
    v.parked = true;
    v.speed = 0;
    v.sirenOn = false;
    this.parked.push(v);
  }

  addParked(type, x, z, rot, persistent = true) {
    const v = this.acquire(type);
    v.place(x, z, rot);
    v.parked = true;
    v.persistent = persistent;
    this.parked.push(v);
    return v;
  }

  // ------------------------------------------------------------ spawning
  pickType(x, z) {
    const d = districtAt(x, z).type;
    const town = ['bazaar', 'commercial', 'town', 'printing', 'residential', 'residential_edge'].includes(d);
    const ind = ['fireworks', 'match', 'industrial'].includes(d);
    const t = weightedPick(this.rng, [
      ['bike', town ? 34 : 24], ['scooter', town ? 18 : 8], ['auto', town ? 16 : 5], ['car', 16],
      ['bus', town ? 4 : 8], ['truck', ind ? 14 : 5], ['delivery', ind ? 10 : 5],
      ['police', 1.2], ['ambulance', 0.8], ['fire', 0.25],
    ]);
    return t;
  }

  targetCount() {
    const h = this.game.env?.hour ?? 10;
    return Math.round(this.preset.trafficCount * densityForHour(h));
  }

  trySpawn(player, camDir) {
    const R = Math.min(this.preset.viewDistance * 0.5, 320);
    for (let attempt = 0; attempt < 12; attempt++) {
      // sample a point in the spawn ring and snap it to the nearest road
      const ang = this.rng() * Math.PI * 2;
      const rad = 75 + this.rng() * (R - 75);
      const near = this.roads.nearest(player.x + Math.sin(ang) * rad, player.z + Math.cos(ang) * rad);
      if (!near || near.d > 40) continue;
      const e = near.edge;
      const dir = this.rng() < 0.5 ? 1 : -1;
      const lane = this.roads.laneSegment(e, dir);
      const along = near.t * e.len - (e.len - lane.len) / 2;
      const s = Math.max(0, Math.min(lane.len, dir > 0 ? along : lane.len - along));
      const p = this.roads.pointOn(lane, s);
      const dx = p.x - player.x;
      const dz = p.z - player.z;
      const d = Math.hypot(dx, dz);
      if (d < 70 || d > R) continue;
      // prefer spawning out of the camera's view when close
      if (d < 180 && camDir && (dx * camDir.x + dz * camDir.z) / d > 0.35) continue;
      let blocked = false;
      for (const o of this.all) if ((o.pos.x - p.x) ** 2 + (o.pos.z - p.z) ** 2 < 18 * 18) { blocked = true; break; }
      if (blocked) continue;
      const type = this.pickType(p.x, p.z);
      const v = this.acquire(type);
      v.place(p.x, p.z, Math.atan2(p.hx, p.hz));
      v.ai = { seg: lane, s, edge: e, dir, pending: null, blocked: 0, stopped: 0, cruise: CRUISE[type] * (0.85 + this.rng() * 0.3) };
      v.speed = v.ai.cruise * 0.7;
      if ((type === 'ambulance' || type === 'fire' || type === 'police') && this.rng() < 0.5) {
        v.sirenOn = true;
        v.ai.cruise *= 1.35;
      }
      this.addCrew(v);
      this.active.push(v);
      return v;
    }
    return null;
  }

  // ------------------------------------------------------------ AI
  obstacleGap(v, f) {
    const hl = v.spec.len / 2;
    const hw = v.spec.width / 2;
    let gap = Infinity;
    let byPlayer = false;
    const test = (x, z, r, len, isPlayer) => {
      const dx = x - v.pos.x;
      const dz = z - v.pos.z;
      const along = dx * f.x + dz * f.z;
      if (along <= 0 || along > 32) return;
      const lat = Math.abs(dx * f.z - dz * f.x);
      if (lat > hw + r + 0.5) return;
      const g = along - hl - len;
      if (g < gap) { gap = g; byPlayer = isPlayer; }
    };
    for (const o of this.active) if (o !== v) test(o.pos.x, o.pos.z, o.spec.width / 2, o.spec.len / 2, false);
    for (const o of this.parked) test(o.pos.x, o.pos.z, o.spec.width / 2, o.spec.len / 2, !!o.player);
    const pl = this.game.player;
    if (pl) {
      if (pl.vehicle) test(pl.vehicle.pos.x, pl.vehicle.pos.z, pl.vehicle.spec.width / 2, pl.vehicle.spec.len / 2, true);
      else test(pl.pos.x, pl.pos.z, 0.4, 0.3, true);
    }
    const peds = this.game.npcs?.walkers;
    if (peds) for (const n of peds) if (n.onRoad) test(n.pos.x, n.pos.z, 0.35, 0.3, false);
    // level crossing gates
    const rw = this.world.railway;
    if (rw) {
      const ax = v.pos.x + f.x * 14;
      const az = v.pos.z + f.z * 14;
      const c = rw.crossingClosedNear(ax, az, 16);
      if (c) {
        const along = (c.x - v.pos.x) * f.x + (c.z - v.pos.z) * f.z;
        if (along > 3) gap = Math.min(gap, along - 10 - hl);
      }
    }
    return { gap, byPlayer };
  }

  advance(v, dt) {
    const ai = v.ai;
    const f = v.forward;
    let desired = ai.cruise;
    const et = ai.edge.type;
    if (et === 'highway' || et === 'rural') desired *= 1.35;
    if (ai.seg.kind === 'bez') desired = Math.min(desired, 6);
    if (ai.stopped > 0) { ai.stopped -= dt; desired = 0; }
    const { gap, byPlayer } = this.obstacleGap(v, f);
    const safe = 2.5 + Math.max(0, v.speed) * 0.6;
    if (gap < safe) desired = 0;
    else if (gap < safe + 18) desired = Math.min(desired, (gap - safe) * 0.8);
    // honk when stuck behind the player
    if (desired < 0.5 && byPlayer && gap < 8) {
      ai.blocked += dt;
      if (ai.blocked > 1.2 && v.honkCooldown <= 0) {
        this.events.emit('horn', { x: v.pos.x, z: v.pos.z, type: v.type });
        v.honkCooldown = 3 + this.rng() * 3;
      }
    } else ai.blocked = 0;
    const a = desired > v.speed ? v.spec.accel * 0.8 : -v.spec.brake * (gap < safe ? 1.3 : 0.7);
    v.speed = clamp(v.speed + a * dt, 0, Math.max(desired, 0) + (a < 0 ? v.speed : 0));
    if (desired === 0 && v.speed < 0.3) v.speed = 0;

    ai.s += v.speed * dt;
    let guard = 0;
    while (ai.s >= ai.seg.len && guard++ < 4) {
      ai.s -= ai.seg.len;
      if (ai.seg.kind === 'line') {
        const node = ai.seg.to;
        if (Math.abs(node.x) > WORLD.half - 15 || Math.abs(node.z) > WORLD.half - 15) { ai.despawn = true; return; }
        const next = this.roads.chooseNext(node, ai.edge, this.rng);
        const ndir = this.roads.dirFrom(next, node);
        const line = this.roads.laneSegment(next, ndir);
        ai.pending = { line, edge: next, dir: ndir };
        ai.seg = this.roads.connector(ai.seg, line);
      } else {
        ai.seg = ai.pending.line;
        ai.edge = ai.pending.edge;
        ai.dir = ai.pending.dir;
      }
    }
    const p = this.roads.pointOn(ai.seg, ai.s);
    v.pos.x = p.x;
    v.pos.z = p.z;
    const target = Math.atan2(p.hx, p.hz);
    let dh = target - v.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    v.steer = clamp(dh * 3, -0.5, 0.5);
    v.heading += dh * Math.min(1, dt * 10);
    if (v.spec.two) v.lean += (-dh * 2.5 * Math.min(1, v.speed / 6) - v.lean) * Math.min(1, dt * 5);
    v.syncTransform();
  }

  // ------------------------------------------------------------ update
  update(dt, playerPos, camDir) {
    // spawn / despawn
    const R = Math.min(this.preset.viewDistance * 0.5, 320) + 70;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const v = this.active[i];
      const d2 = (v.pos.x - playerPos.x) ** 2 + (v.pos.z - playerPos.z) ** 2;
      if (v.ai?.pursuit) continue; // police pursuers are managed by the PoliceSystem
      if (d2 > R * R || v.ai?.despawn) {
        this.active.splice(i, 1);
        this.release(v);
      }
    }
    for (let i = this.parked.length - 1; i >= 0; i--) {
      const v = this.parked[i];
      if (v.persistent) continue;
      const d2 = (v.pos.x - playerPos.x) ** 2 + (v.pos.z - playerPos.z) ** 2;
      if (d2 > (R + 150) ** 2) { this.parked.splice(i, 1); this.release(v); }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.25;
      if (this.active.length < this.targetCount()) this.trySpawn(playerPos, camDir);
    }

    let w = 0;
    const near2 = 70 * 70;
    for (const v of this.active) {
      if (v.ai?.pursuit) { v.update(dt); continue; }
      if (v.ai) this.advance(v, dt);
      v.update(dt);
      if (v.crew) {
        const d2 = (v.pos.x - playerPos.x) ** 2 + (v.pos.z - playerPos.z) ** 2;
        if (d2 < near2) for (const c of v.crew) { c.animator.steer = v.steer / 0.5; c.animator.update(dt, 0); }
      }
    }
    for (const v of this.parked) v.update(dt);
    const pv = this.game.player?.vehicle;
    if (pv) pv.update(dt);
    // wheels (single instanced draw call)
    const list = pv ? [pv, ...this.active, ...this.parked] : [...this.active, ...this.parked];
    for (const v of list) {
      if (w + v.spec.wheels.length > MAX_WHEELS) break;
      w += v.writeWheels(this.wheels, w, WHEEL_TMP);
    }
    this.wheels.count = w;
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  /** Nearest enterable vehicle within r. */
  nearest(pos, r = 3.5) {
    let best = null;
    let bd = r * r;
    for (const v of this.all) {
      if (v.player) continue;
      const d = (v.pos.x - pos.x) ** 2 + (v.pos.z - pos.z) ** 2 - (v.spec.len / 2) ** 2 * 0.5;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  /** Resolve player-vehicle vs traffic collisions. Returns strongest impact speed. */
  collidePlayerVehicle(pv) {
    let impact = 0;
    const pc = pv.circles();
    for (const v of this.all) {
      if (v === pv) continue;
      if ((v.pos.x - pv.pos.x) ** 2 + (v.pos.z - pv.pos.z) ** 2 > 196) continue;
      for (const a of pc) {
        for (const b of v.circles()) {
          const dx = a.x - b.x;
          const dz = a.z - b.z;
          const rr = a.r + b.r;
          const d2 = dx * dx + dz * dz;
          if (d2 >= rr * rr || d2 < 1e-6) continue;
          const d = Math.sqrt(d2);
          const push = rr - d;
          pv.pos.x += (dx / d) * push * 0.8;
          pv.pos.z += (dz / d) * push * 0.8;
          const rel = Math.abs(pv.speed - (v.ai ? v.speed : 0));
          impact = Math.max(impact, rel);
          pv.speed *= 0.5;
          if (v.ai) { v.ai.stopped = 2.5; v.speed = 0; }
          if (rel > 4) { pv.damage(rel * 1.2); v.damage(rel * 1.5); }
          if (v.honkCooldown <= 0) { this.events.emit('horn', { x: v.pos.x, z: v.pos.z, type: v.type }); v.honkCooldown = 3; }
          if (v.type === 'police') this.events.emit('crime', { type: 'hit_police', x: v.pos.x, z: v.pos.z });
          else if (rel > 6) this.events.emit('crime', { type: 'crash', x: v.pos.x, z: v.pos.z });
        }
      }
    }
    return impact;
  }

  /** Is a moving vehicle hitting (x,z)? Returns the vehicle + speed. */
  hitTestPedestrian(x, z, r = 0.35) {
    for (const v of this.active) {
      if (v.speed < 2.5) continue;
      for (const c of v.circles()) {
        if ((c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + r) ** 2) return v;
      }
    }
    return null;
  }
}
