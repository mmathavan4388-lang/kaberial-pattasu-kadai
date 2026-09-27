// Wanted level, crime witnessing, police pursuit (A* on the road graph when far,
// direct chase when close), Tamil radio/shout barks, busted & escape logic.
import { clamp, wrapAngle } from '../core/utils.js';
import { POI } from '../world/MapData.js';

const CRIME_HEAT = { hit_pedestrian: 1, carjack: 1, hit_police: 2, crash: 0.34 };

export class PoliceSystem {
  constructor(game) {
    this.game = game;
    this.level = 0;
    this.heat = 0;
    this.pursuers = [];
    this.unseen = 0;
    this.bustTimer = 0;
    this.spawnTimer = 0;
    this.barkTimer = 0;
    game.events.on('crime', (c) => this.onCrime(c));
  }

  witnessed(x, z) {
    const g = this.game;
    for (const s of g.npcs.statics) if (s.ent.role === 'police' && Math.hypot(s.ent.model.mesh.position.x - x, s.ent.model.mesh.position.z - z) < 70) return true;
    for (const v of g.traffic.active) if (v.type === 'police' && Math.hypot(v.pos.x - x, v.pos.z - z) < 90) return true;
    for (const p of this.pursuers) if (Math.hypot(p.pos.x - x, p.pos.z - z) < 120) return true;
    return Math.random() < 0.45; // bystanders call the police
  }

  onCrime(c) {
    const heat = CRIME_HEAT[c.type] ?? 0.5;
    if (!heat) return;
    if (this.level === 0 && !this.witnessed(c.x, c.z)) return;
    this.heat += heat;
    const newLevel = clamp(Math.floor(this.heat + (this.level ? 0 : 0.7)), 0, 5);
    if (newLevel > this.level) {
      this.level = newLevel;
      this.game.ui.toast({ ta: `போலீஸ் தேடுகிறது! ${'★'.repeat(this.level)}`, en: `Wanted by police! (${this.level})` }, 'warn');
      this.game.audio?.play('alert');
    }
    this.unseen = 0;
  }

  clear() {
    this.level = 0;
    this.heat = 0;
    for (const p of this.pursuers) {
      p.ai = null;
      p.sirenOn = false;
      const i = this.game.traffic.active.indexOf(p);
      if (i >= 0) this.game.traffic.active.splice(i, 1);
      this.game.traffic.release(p);
    }
    this.pursuers = [];
    this.bustTimer = 0;
  }

  spawnPursuer(player) {
    const roads = this.game.world.roads;
    // spawn on a road 90-160 m away, preferably behind the camera
    const cam = this.game.cameraRig.forward;
    let best = null;
    for (let i = 0; i < 20; i++) {
      const e = roads.edges[Math.floor(Math.random() * roads.edges.length)];
      const t = Math.random();
      const x = e.a.x + (e.b.x - e.a.x) * t;
      const z = e.a.z + (e.b.z - e.a.z) * t;
      const d = Math.hypot(x - player.x, z - player.z);
      if (d < 80 || d > 170) continue;
      const behind = ((x - player.x) * cam.x + (z - player.z) * cam.z) / d < 0.2;
      if (!best || behind) best = { x, z, e };
      if (behind) break;
    }
    if (!best) return;
    const v = this.game.traffic.acquire('police');
    v.place(best.x, best.z, Math.atan2(player.x - best.x, player.z - best.z));
    v.ai = { pursuit: true, path: null, repath: 0, stuck: 0, reverse: 0 };
    v.sirenOn = true;
    this.game.traffic.addCrew(v);
    this.game.traffic.active.push(v);
    this.pursuers.push(v);
  }

  drivePursuer(v, dt, target) {
    const ai = v.ai;
    const roads = this.game.world.roads;
    const d = Math.hypot(target.x - v.pos.x, target.z - v.pos.z);
    let goal = target;
    ai.repath -= dt;
    if (d > 45) {
      if (ai.repath <= 0 || !ai.path) {
        ai.repath = 2;
        const a = roads.nearestNode(v.pos.x, v.pos.z);
        const b = roads.nearestNode(target.x, target.z);
        ai.path = roads.astar(a, b) || null;
        ai.pi = 0;
      }
      if (ai.path && ai.pi < ai.path.length) {
        const n = ai.path[ai.pi];
        goal = n;
        if (Math.hypot(n.x - v.pos.x, n.z - v.pos.z) < 12) ai.pi++;
      }
    }
    const desired = Math.atan2(goal.x - v.pos.x, goal.z - v.pos.z);
    const diff = wrapAngle(desired - v.heading);
    let throttle = d < 10 ? 0.35 : 1;
    let steer = clamp(diff * 2.2, -1, 1);
    if (Math.abs(diff) > 2.2 && d < 25) throttle = 0.5;
    // unstick
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      throttle = -1;
      steer = -steer;
    } else if (Math.abs(v.speed) < 0.8 && throttle > 0) {
      ai.stuck += dt;
      if (ai.stuck > 1.5) { ai.reverse = 1.2; ai.stuck = 0; }
    } else ai.stuck = 0;
    v.drive(dt, { throttle, steer, brake: 0, handbrake: false }, this.game.world);
    if (v.crew) for (const c of v.crew) { c.animator.steer = v.steer / 0.5; c.animator.update(dt, 0); }
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const pos = p.pos;
    if (this.level === 0) {
      if (this.pursuers.length) this.clear();
      return;
    }
    // keep enough pursuers
    const want = Math.min(1 + this.level, 5);
    this.spawnTimer -= dt;
    if (this.pursuers.length < want && this.spawnTimer <= 0) {
      this.spawnTimer = 4;
      this.spawnPursuer(pos);
    }
    let seen = false;
    let closest = Infinity;
    for (let i = this.pursuers.length - 1; i >= 0; i--) {
      const v = this.pursuers[i];
      const d = Math.hypot(v.pos.x - pos.x, v.pos.z - pos.z);
      if (d > 420) {
        this.pursuers.splice(i, 1);
        const k = g.traffic.active.indexOf(v);
        if (k >= 0) g.traffic.active.splice(k, 1);
        g.traffic.release(v);
        continue;
      }
      this.drivePursuer(v, dt, pos);
      closest = Math.min(closest, d);
      if (d < 85) seen = true;
    }
    // barks
    this.barkTimer -= dt;
    if (closest < 40 && this.barkTimer <= 0) {
      this.barkTimer = 6;
      const v = this.pursuers.reduce((a, b) => (Math.hypot(a.pos.x - pos.x, a.pos.z - pos.z) < Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z) ? a : b));
      g.dialogue.bark(g.lines.pick('police_chase'), v.pos);
    }
    // escape
    if (seen) this.unseen = 0;
    else {
      this.unseen += dt;
      if (this.unseen > 10 + this.level * 4) {
        this.level--;
        this.heat = this.level;
        this.unseen = 0;
        if (this.level === 0) {
          g.ui.toast({ ta: 'போலீஸிடமிருந்து தப்பித்தீர்கள்!', en: 'You escaped the police!' }, 'good');
          this.clear();
        }
      }
    }
    // busted
    const slow = p.vehicle ? Math.abs(p.vehicle.speed) < 1.5 : p.speed < 1.2 || p.knock > 0;
    if (closest < 7.5 && slow) {
      this.bustTimer += dt;
      if (this.bustTimer > 2.5) this.bust();
    } else this.bustTimer = Math.max(0, this.bustTimer - dt);
  }

  bust() {
    const g = this.game;
    const fine = Math.min(g.economy.money, 400 * this.level);
    g.economy.spend(fine, true);
    this.clear();
    g.respawn(POI.policeDoor, {
      ta: `கைது செய்யப்பட்டீர்கள்! அபராதம் ₹${fine}`, en: `Busted! Fine ₹${fine}`,
    }, [{ who: { ta: 'இன்ஸ்பெக்டர்', en: 'Inspector' }, ta: 'இனிமே இப்படி பண்ணாதே. அடுத்த தடவை ஜெயில் தான்!', en: "Don't do this again. Next time it's jail!" }]);
  }
}
