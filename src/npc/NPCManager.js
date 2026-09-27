// Population system.
//  * A pool of unique, pre-built character models (no duplicate faces/outfits on
//    screen) is grown in the background under a time budget.
//  * Walkers follow sidewalks of the road graph; stationary NPCs occupy role spots
//    (police at the station, priest at the temple, vendors at the market, shop
//    owners at shop fronts...) according to a daily schedule.
//  * LOD: near = animated every frame, mid = animated at reduced rate, far = not
//    simulated at all (despawned; the "virtual" population is re-spawned near the player).
import { makeAppearance } from '../characters/Appearance.js';
import { buildHuman } from '../characters/HumanModel.js';
import { Animator } from '../characters/Animator.js';
import { mulberry32, weightedPick, clamp, wrapAngle, lerpAngle } from '../core/utils.js';

// Which roles appear at which hour (weights)
function walkerRoles(h) {
  if (h >= 6 && h < 10) return [['man', 5], ['woman', 5], ['student', 5], ['boy', 3], ['girl', 3], ['factory_worker', 5], ['oldman', 2], ['oldwoman', 2], ['teacher', 1], ['business_owner', 1]];
  if (h >= 10 && h < 17) return [['man', 5], ['woman', 6], ['shopper', 4], ['oldman', 2], ['oldwoman', 2], ['factory_worker', 2], ['business_owner', 2], ['doctor', 0.5], ['railway', 0.5], ['security', 0.5]];
  if (h >= 17 && h < 21) return [['man', 6], ['woman', 5], ['shopper', 3], ['student', 3], ['boy', 2], ['girl', 2], ['oldman', 2], ['oldwoman', 2], ['factory_worker', 3], ['devotee', 2]];
  if (h >= 21 || h < 5) return [['man', 5], ['security', 2], ['factory_worker', 1], ['oldman', 1]];
  return [['man', 3], ['oldman', 3], ['oldwoman', 2], ['devotee', 2], ['woman', 2]];
}

function spotActive(role, h, site) {
  switch (role) {
    case 'student': return h >= 7.5 && h < 16.5;
    case 'teacher': return h >= 8 && h < 17;
    case 'vendor': case 'shopper': return h >= 5 && h < 21.5;
    case 'devotee': return (h >= 5.5 && h < 12) || (h >= 16.5 && h < 21);
    case 'priest': return h >= 5 && h < 21.5;
    case 'passenger': return h >= 5 && h < 23;
    case 'shop_owner': return site ? h >= 6 && h < 22 : h >= 8.5 && h < 21.5;
    case 'customer': return h >= 6 && h < 22;
    case 'tea_master': return h >= 5 && h < 23;
    case 'factory_worker': case 'business_owner': case 'mechanic': return h >= 8 && h < 19;
    default: return true;
  }
}

export class NPCManager {
  constructor(game) {
    this.game = game;
    this.scene = game.engine.scene;
    this.world = game.world;
    this.roads = game.world.roads;
    this.atlas = game.faceAtlas;
    this.preset = game.engine.preset;
    this.rng = mulberry32(777);
    this.pool = [];
    this.seed = 100;
    this.walkers = [];
    this.statics = [];
    this.spawnTimer = 0;
    this.frame = 0;
    this.buildQueue = [];
    this.maxModels = this.preset.npcCount + Math.ceil(this.preset.trafficCount * 0.8) + 12;
  }

  // ------------------------------------------------------------ model pool
  buildModel(role) {
    const seed = this.seed++;
    // realistic glTF model when one is provided for this role, else procedural
    const real = this.game.assets?.makeNpc(role, seed);
    let entry;
    if (real) entry = { model: real, animator: real.animator, role, inUse: false };
    else {
      const model = buildHuman(makeAppearance(role, seed), this.atlas);
      entry = { model, animator: new Animator(model), role, inUse: false };
    }
    this.pool.push(entry);
    return entry;
  }

  /** Grow the pool during loading. */
  prebuild(n, roles) {
    for (let i = 0; i < n; i++) this.buildModel(roles[i % roles.length]);
  }

  roleMatches(entry, role) {
    if (entry.role === role) return true;
    const generic = ['man', 'woman', 'shopper', 'customer', 'passenger'];
    return generic.includes(role) && generic.includes(entry.role) && (role === 'woman') === entry.model.appearance.female;
  }

  acquire(role, allowBuild = true) {
    let free = this.pool.filter((e) => !e.inUse && this.roleMatches(e, role));
    if (!free.length && ['man', 'shopper', 'customer', 'passenger'].includes(role)) free = this.pool.filter((e) => !e.inUse && ['man', 'woman', 'shopper', 'customer', 'passenger', 'oldman', 'oldwoman'].includes(e.role));
    let e = free.length ? free[Math.floor(this.rng() * free.length)] : null;
    if (!e) {
      if (!allowBuild || this.pool.length >= this.maxModels) {
        if (this.buildQueue.length < 6 && this.pool.length < this.maxModels) this.buildQueue.push(role);
        return null;
      }
      e = this.buildModel(role);
    }
    e.inUse = true;
    e.model.mesh.visible = true;
    return e;
  }

  release(e) {
    e.inUse = false;
    e.model.mesh.parent?.remove(e.model.mesh);
  }

  acquireCrew(role) {
    const e = this.acquire(role, false);
    return e;
  }

  releaseCrew(e) {
    this.release(e);
  }

  // ------------------------------------------------------------ walkers
  sidewalk(edge, dir) {
    return this.roads.laneSegment(edge, dir, edge.hw + 1.5);
  }

  spawnWalker(player) {
    const h = this.game.env.hour;
    for (let attempt = 0; attempt < 6; attempt++) {
      const near = [];
      for (const e of this.roads.edgesNear(player.x + (this.rng() - 0.5) * 120, player.z + (this.rng() - 0.5) * 120)) near.push(e);
      if (!near.length) continue;
      const e = near[Math.floor(this.rng() * near.length)];
      if (e.type === 'highway' && this.rng() < 0.7) continue;
      const dir = this.rng() < 0.5 ? 1 : -1;
      const seg = this.sidewalk(e, dir);
      const s = this.rng() * seg.len;
      const p = this.roads.pointOn(seg, s);
      const d = Math.hypot(p.x - player.x, p.z - player.z);
      if (d < 25 || d > 85) continue;
      const role = weightedPick(this.rng, walkerRoles(h));
      const ent = this.acquire(role, false);
      if (!ent) return;
      const w = {
        ent, pos: ent.model.mesh.position, seg, s, edge: e, dir, pending: null,
        speed: (ent.model.appearance.old ? 0.9 : ent.model.appearance.kid ? 1.3 : 1.25) * (0.85 + this.rng() * 0.3),
        mode: 'walk', timer: 0, heading: Math.atan2(p.hx, p.hz), onRoad: false, acc: 0, pause: 8 + this.rng() * 30,
      };
      w.pos.set(p.x, 0.16, p.z);
      ent.model.mesh.rotation.set(0, w.heading, 0);
      ent.animator.setState('walk');
      ent.animator.snap();
      this.scene.add(ent.model.mesh);
      this.walkers.push(w);
      return;
    }
  }

  stepWalker(w, dt, player) {
    const a = w.ent.animator;
    if (w.mode === 'knock') {
      w.timer -= dt;
      if (w.timer <= 0) { w.mode = 'flee'; w.timer = 6; a.setState('run'); }
      return 0;
    }
    if (w.mode === 'flee') {
      w.timer -= dt;
      const dx = w.pos.x - player.x;
      const dz = w.pos.z - player.z;
      const target = Math.atan2(dx, dz);
      w.heading = lerpAngle(w.heading, target, Math.min(1, dt * 4));
      const sp = 4.2;
      w.pos.x += Math.sin(w.heading) * sp * dt;
      w.pos.z += Math.cos(w.heading) * sp * dt;
      this.world.resolveCircle(w.pos, 0.35);
      w.ent.model.mesh.rotation.y = w.heading;
      w.onRoad = this.roads.roadClearance(w.pos.x, w.pos.z) < 0;
      if (w.timer <= 0) w.despawn = true;
      return sp;
    }
    if (w.mode === 'idle') {
      w.timer -= dt;
      if (w.timer <= 0) { w.mode = 'walk'; a.setState('walk'); w.pause = 10 + this.rng() * 40; }
      return 0;
    }
    // walk along sidewalk; occasionally stop to chat / use phone
    w.pause -= dt;
    if (w.pause <= 0 && !w.onRoad) {
      w.mode = 'idle';
      w.timer = 3 + this.rng() * 6;
      a.setState(this.rng() < 0.3 ? 'phone' : 'idle');
      return 0;
    }
    // keep personal space with the player
    let speed = w.speed;
    const pdx = player.x - w.pos.x;
    const pdz = player.z - w.pos.z;
    const pd = Math.hypot(pdx, pdz);
    const f = { x: Math.sin(w.heading), z: Math.cos(w.heading) };
    if (pd < 1.6 && (pdx * f.x + pdz * f.z) > 0) speed = 0;
    w.s += speed * dt;
    let guard = 0;
    while (w.s >= w.seg.len && guard++ < 4) {
      w.s -= w.seg.len;
      if (w.seg.kind === 'line') {
        const node = w.seg.to;
        const next = this.roads.chooseNext(node, w.edge, this.rng);
        const ndir = this.roads.dirFrom(next, node);
        const line = this.sidewalk(next, ndir);
        w.pending = { line, edge: next, dir: ndir };
        w.seg = this.roads.connector(w.seg, line);
      } else {
        w.seg = w.pending.line;
        w.edge = w.pending.edge;
      }
    }
    const p = this.roads.pointOn(w.seg, w.s);
    w.onRoad = w.seg.kind === 'bez';
    w.pos.set(p.x, w.onRoad || !w.edge.sidewalk ? 0 : 0.16, p.z);
    const target = Math.atan2(p.hx, p.hz);
    w.heading = lerpAngle(w.heading, target, Math.min(1, dt * 6));
    w.ent.model.mesh.rotation.y = w.heading;
    if (speed === 0 && a.state === 'walk') a.setState('idle');
    else if (speed > 0 && a.state === 'idle') a.setState('walk');
    return speed;
  }

  // ------------------------------------------------------------ statics
  refreshStatics(player) {
    const h = this.game.env.hour;
    const R = 70;
    // despawn far / inactive
    for (let i = this.statics.length - 1; i >= 0; i--) {
      const s = this.statics[i];
      const d = Math.hypot(s.spot.x - player.x, s.spot.z - player.z);
      if (d > R + 25 || !spotActive(s.spot.role, h, s.spot.site)) {
        this.release(s.ent);
        s.spot.taken = false;
        this.statics.splice(i, 1);
      }
    }
    const budget = Math.floor(this.preset.npcCount * 0.55);
    if (this.statics.length >= budget) return;
    const cand = [];
    for (const sp of this.game.world.landmarks.spots) {
      if (sp.taken || sp.reserved) continue;
      const d = Math.hypot(sp.x - player.x, sp.z - player.z);
      if (d < R && spotActive(sp.role, h, true)) cand.push([d, sp]);
    }
    if (!this.localSpots || Math.hypot(this.localSpotsAt.x - player.x, this.localSpotsAt.z - player.z) > 40) {
      this.localSpots = this.world.idleSpotsNear(player.x, player.z, R);
      this.localSpotsAt = { x: player.x, z: player.z };
      // keep only a fraction of generic spots so streets are lively but not crowded
      const r2 = mulberry32(Math.floor(player.x / 40) * 31 + Math.floor(player.z / 40));
      this.localSpots = this.localSpots.filter((s) => (s.role === 'shop_owner' ? r2() < 0.55 : r2() < 0.18));
    }
    for (const sp of this.localSpots) {
      if (sp.taken) continue;
      const role = sp.role || (h >= 21 || h < 6 ? 'man' : weightedPick(this.rng, walkerRoles(h)));
      if (!spotActive(role, h, false)) continue;
      const d = Math.hypot(sp.x - player.x, sp.z - player.z);
      if (d < R) cand.push([d + 15, { ...sp, role, ref: sp }]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    for (const [, sp] of cand) {
      if (this.statics.length >= budget) break;
      const ent = this.acquire(sp.role, false);
      if (!ent) break;
      const m = ent.model.mesh;
      m.position.set(sp.x, this.world.heightAt(sp.x, sp.z), sp.z);
      m.rotation.set(0, sp.rot ?? this.rng() * Math.PI * 2, 0);
      const st = { vendor: 'work', factory_worker: 'work', mechanic: 'work', tea_master: 'work', priest: 'idle', passenger: this.rng() < 0.3 ? 'phone' : 'idle' }[sp.role] || (this.rng() < 0.35 ? 'talk' : 'idle');
      ent.animator.setState(st);
      ent.animator.snap();
      this.scene.add(m);
      const real = sp.ref || sp;
      real.taken = true;
      this.statics.push({ ent, spot: real, baseRot: m.rotation.y, baseState: st });
    }
  }

  // ------------------------------------------------------------ reactions
  knockdown(w, fromX, fromZ) {
    w.mode = 'knock';
    w.timer = 2.8;
    w.onRoad = false;
    const dx = w.pos.x - fromX;
    const dz = w.pos.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    w.pos.x += (dx / d) * 1.5;
    w.pos.z += (dz / d) * 1.5;
    w.heading = Math.atan2(-dx, -dz);
    w.ent.model.mesh.rotation.y = w.heading;
    w.ent.animator.setState('knockdown');
    this.game.audio?.play('impact');
    this.game.dialogue?.bark(this.game.lines.pick('hit_reaction'), w.ent.model.mesh.position);
    this.panic(w.pos, 25);
  }

  panic(pos, r) {
    for (const o of this.walkers) {
      if (o.mode === 'knock') continue;
      if ((o.pos.x - pos.x) ** 2 + (o.pos.z - pos.z) ** 2 < r * r) {
        o.mode = 'flee';
        o.timer = 5 + this.rng() * 4;
        o.ent.animator.setState('run');
      }
    }
  }

  /** Crew ejected from a hijacked vehicle becomes a fleeing pedestrian. */
  spawnFleeing(ent, x, z) {
    const m = ent.model.mesh;
    m.position.set(x, 0, z);
    m.rotation.set(0, 0, 0);
    this.scene.add(m);
    ent.inUse = true;
    const w = { ent, pos: m.position, seg: null, mode: 'flee', timer: 6, heading: 0, onRoad: true, acc: 0, speed: 4 };
    ent.animator.setState('run');
    this.walkers.push(w);
    this.game.dialogue?.bark(this.game.lines.pick('carjack_reaction'), m.position);
  }

  /** Closest NPC the player can talk to. */
  nearestTalkable(pos, r = 2.4) {
    let best = null;
    let bd = r * r;
    const check = (npc, kind) => {
      const p = npc.ent.model.mesh.position;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d < bd && !(kind === 'walker' && (npc.mode === 'knock' || npc.mode === 'flee'))) { bd = d; best = { npc, kind }; }
    };
    for (const s of this.statics) check(s, 'static');
    for (const w of this.walkers) check(w, 'walker');
    return best;
  }

  faceTowards(npc, pos, state = 'talk', duration = 4) {
    const m = npc.ent.model.mesh;
    npc.talkUntil = performance.now() + duration * 1000;
    npc.talkYaw = Math.atan2(pos.x - m.position.x, pos.z - m.position.z);
    if (npc.mode) { npc.mode = 'idle'; npc.timer = duration; }
    npc.ent.animator.setState(state);
  }

  // ------------------------------------------------------------ update
  update(dt, player) {
    this.frame++;
    const env = this.game.env;
    const density = env.hour >= 22 || env.hour < 5 ? 0.35 : env.hour < 7 ? 0.6 : 1;
    const target = Math.round(this.preset.npcCount * 0.5 * density);

    // background pool growth: at most one new character every 0.4 s (~5-7 ms each)
    const now = performance.now();
    if (this.pool.length < this.maxModels && now - (this.lastBuild || 0) > 400) {
      if (this.buildQueue.length) {
        this.buildModel(this.buildQueue.shift());
        this.lastBuild = now;
      } else if (this.pool.filter((e) => !e.inUse).length < 4) {
        this.buildModel(weightedPick(this.rng, walkerRoles(env.hour)));
        this.lastBuild = now;
      }
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.35;
      if (this.walkers.length < target) this.spawnWalker(player);
      this.refreshStatics(player);
    }

    const pv = this.game.player.vehicle;
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i];
      const d = Math.hypot(w.pos.x - player.x, w.pos.z - player.z);
      if (d > 105 || w.despawn) {
        this.release(w.ent);
        this.walkers.splice(i, 1);
        continue;
      }
      const speed = this.stepWalker(w, dt, player);
      // struck by the player's vehicle or traffic
      if (w.mode !== 'knock') {
        if (pv && Math.abs(pv.speed) > 3) {
          for (const c of pv.circles()) {
            if ((c.x - w.pos.x) ** 2 + (c.z - w.pos.z) ** 2 < (c.r + 0.35) ** 2) {
              this.knockdown(w, pv.pos.x, pv.pos.z);
              this.game.events.emit('crime', { type: 'hit_pedestrian', x: w.pos.x, z: w.pos.z });
              pv.speed *= 0.8;
              break;
            }
          }
        }
      }
      if (w.talkUntil && performance.now() < w.talkUntil) {
        w.ent.model.mesh.rotation.y = lerpAngle(w.ent.model.mesh.rotation.y, w.talkYaw, Math.min(1, dt * 6));
      }
      this.animate(w.ent, dt, speed, d);
    }
    for (const s of this.statics) {
      const m = s.ent.model.mesh;
      const d = Math.hypot(m.position.x - player.x, m.position.z - player.z);
      let look;
      if (s.talkUntil && performance.now() < s.talkUntil) {
        m.rotation.y = lerpAngle(m.rotation.y, s.talkYaw, Math.min(1, dt * 6));
      } else if (s.talkUntil) {
        s.talkUntil = 0;
        s.ent.animator.setState(s.baseState);
      } else if (d < 6) {
        // glance at the player when close
        look = wrapAngle(Math.atan2(player.x - m.position.x, player.z - m.position.z) - m.rotation.y);
        if (Math.abs(look) > 1.4) look = undefined;
      }
      this.animate(s.ent, dt, 0, d, look);
    }
  }

  animate(ent, dt, speed, dist, lookYaw) {
    // animation LOD: every frame near, every 3rd frame mid, frozen far
    if (dist < 35) {
      ent.animator.update(dt + (ent.skipped || 0), speed, { lookYaw });
      ent.skipped = 0;
    } else if (dist < 80) {
      ent.skipped = (ent.skipped || 0) + dt;
      if ((this.frame + (ent.model.appearance.face || 0)) % 3 === 0) {
        ent.animator.update(ent.skipped, speed);
        ent.skipped = 0;
      }
    }
  }

  clear() {
    for (const w of this.walkers) this.release(w.ent);
    for (const s of this.statics) { this.release(s.ent); s.spot.taken = false; }
    this.walkers = [];
    this.statics = [];
  }
}
