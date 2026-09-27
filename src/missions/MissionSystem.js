// Mission runner: available-mission markers, step machine (talk / goto / enter /
// say / phone / reward), timers, dedicated mission characters and world markers.
import * as THREE from 'three';
import { MISSIONS } from './missions.js';
import { buildHuman } from '../characters/HumanModel.js';
import { makeAppearance } from '../characters/Appearance.js';
import { Animator } from '../characters/Animator.js';

const MARKER_COLORS = { mission: 0xffc400, objective: 0x29b6f6, talk: 0x66ff99 };

export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.scene = game.engine.scene;
    this.completed = new Set();
    this.active = null;
    this.stepIndex = 0;
    this.timer = null;
    this.npcs = new Map();
    this.busy = false;
    this.markers = [];
    this.markerGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2);
  }

  // ------------------------------------------------------------ markers
  marker(kind, x, z, r = 1.5) {
    const mat = new THREE.MeshBasicMaterial({ color: MARKER_COLORS[kind], transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Mesh(this.markerGeo, mat);
    beam.scale.set(r, kind === 'mission' ? 60 : 8, r);
    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: MARKER_COLORS[kind], transparent: true, opacity: 0.8, depthWrite: false, fog: false }));
    ring.scale.setScalar(r);
    const g = new THREE.Group();
    g.add(beam, ring);
    const y = this.game.world.heightAt(x, z);
    g.position.set(x, y + 0.08, z);
    beam.position.y = beam.scale.y / 2;
    g.userData = { kind, x, z, r };
    this.scene.add(g);
    this.markers.push(g);
    return g;
  }

  clearMarkers() {
    for (const m of this.markers) {
      this.scene.remove(m);
      m.children.forEach((c) => c.material.dispose());
    }
    this.markers = [];
  }

  available() {
    return MISSIONS.filter((m) => !this.completed.has(m.id) && (m.requires || []).every((r) => this.completed.has(r)));
  }

  refreshMarkers() {
    this.clearMarkers();
    if (this.active) {
      const st = this.step();
      if (!st) return;
      const p = this.stepPos(st);
      if (p) this.marker(st.type === 'talk' ? 'talk' : 'objective', p.x, p.z, st.type === 'talk' ? 1 : st.r || 3);
    } else {
      for (const m of this.available()) if (!m.auto) this.marker('mission', m.giver.x, m.giver.z, 2);
    }
  }

  /** Points for the minimap. */
  mapPoints() {
    if (this.active) {
      const p = this.stepPos(this.step());
      return p ? [{ ...p, kind: 'objective' }] : [];
    }
    return this.available().filter((m) => !m.auto).map((m) => ({ x: m.giver.x, z: m.giver.z, kind: 'mission', title: m.title }));
  }

  stationDoor(id) {
    const s = this.game.world.railway.stationInfo.find((x) => x.id === id);
    return s ? s.door : { x: 0, z: 0 };
  }

  stepPos(st) {
    if (!st) return null;
    if (st.type === 'talk') {
      const n = this.npcs.get(st.npc.id);
      return n ? { x: n.model.mesh.position.x, z: n.model.mesh.position.z } : null;
    }
    if (st.type === 'goto') return st.station ? this.stationDoor(st.station) : { x: st.x, z: st.z };
    return null;
  }

  // ------------------------------------------------------------ mission NPCs
  spawnNpc(def) {
    if (this.npcs.has(def.id)) return this.npcs.get(def.id);
    const app = makeAppearance(def.role, 9000 + def.id.length * 131 + def.id.charCodeAt(0));
    const model = buildHuman(app, this.game.faceAtlas);
    const animator = new Animator(model);
    let x = def.x;
    let z = def.z;
    let rot = def.rot ?? 0;
    if (def.station) {
      const d = this.stationDoor(def.station);
      x = d.x; z = d.z; rot = 0;
    }
    model.mesh.position.set(x, this.game.world.heightAt(x, z), z);
    model.mesh.rotation.y = rot;
    this.scene.add(model.mesh);
    // stop duplicates: occupy any matching landmark spot
    for (const sp of this.game.world.landmarks.spots) {
      if (Math.hypot(sp.x - x, sp.z - z) < 6 && sp.role === def.role) sp.reserved = true;
    }
    const npc = { def, model, animator, baseRot: rot };
    animator.setState('idle');
    this.npcs.set(def.id, npc);
    return npc;
  }

  releaseNpcs() {
    for (const n of this.npcs.values()) this.scene.remove(n.model.mesh);
    for (const sp of this.game.world.landmarks.spots) sp.reserved = false;
    this.npcs.clear();
  }

  // ------------------------------------------------------------ flow
  step() {
    return this.active ? this.active.steps[this.stepIndex] : null;
  }

  start(m) {
    this.active = m;
    this.stepIndex = 0;
    this.game.ui.missionBanner(m.title, 'start');
    this.game.audio?.play('mission');
    this.enterStep();
  }

  enterStep() {
    const st = this.step();
    this.timer = st?.timer ?? null;
    if (!st) { this.complete(); return; }
    if (st.type === 'talk') this.spawnNpc(st.npc);
    this.refreshMarkers();
    this.game.ui.setObjective(st.objective || null, this.timer);
    if (st.type === 'say') this.runDialogue(st.lines, { freeze: true, auto: false });
    if (st.type === 'phone') this.runPhone(st);
    if (st.type === 'reward') {
      this.game.economy.earn(st.money, { ta: 'வெகுமதி', en: 'Reward' });
      this.next();
    }
  }

  async runDialogue(lines, opts) {
    this.busy = true;
    await this.game.dialogue.play(lines, opts);
    this.busy = false;
    this.next();
  }

  async runPhone(st) {
    this.busy = true;
    await this.game.ui.ringPhone(st.caller);
    await this.game.dialogue.play(st.lines, { phone: true, auto: true });
    this.busy = false;
    this.next();
  }

  next() {
    this.stepIndex++;
    if (this.stepIndex >= this.active.steps.length) this.complete();
    else this.enterStep();
  }

  complete() {
    const m = this.active;
    this.completed.add(m.id);
    this.active = null;
    this.timer = null;
    this.game.ui.setObjective(null);
    this.game.ui.missionBanner(m.title, 'done');
    this.game.audio?.play('success');
    setTimeout(() => this.releaseNpcs(), 4000);
    this.refreshMarkers();
    this.game.save();
    if (this.completed.size === MISSIONS.length) {
      this.game.ui.toast({ ta: 'எல்லா கதைப் பணிகளும் முடிந்தன! சிவகாசியை சுதந்திரமாக சுற்றிப் பாருங்கள்.', en: 'All story missions complete! Explore Sivakasi freely.' }, 'good');
    }
  }

  fail(reason) {
    const m = this.active;
    this.active = null;
    this.timer = null;
    this.game.ui.setObjective(null);
    this.game.ui.missionBanner(m.title, 'fail', reason);
    this.game.audio?.play('fail');
    this.releaseNpcs();
    this.refreshMarkers();
  }

  /** E key: talk to a mission NPC if close. Returns true if consumed. */
  interact(pos) {
    const st = this.step();
    if (!st || this.busy || st.type !== 'talk') return false;
    const n = this.npcs.get(st.npc.id);
    if (!n) return false;
    const p = n.model.mesh.position;
    if (Math.hypot(p.x - pos.x, p.z - pos.z) > 2.8 || this.game.player.vehicle) return false;
    n.talking = true;
    n.animator.setState('talk');
    this.game.player.animator.setState('idle');
    this.runDialogue(st.lines, { freeze: true }).then(() => { n.talking = false; n.animator.setState('idle'); });
    return true;
  }

  talkPrompt(pos) {
    const st = this.step();
    if (!st || this.busy || st.type !== 'talk' || this.game.player.vehicle) return null;
    const n = this.npcs.get(st.npc.id);
    if (!n) return null;
    const p = n.model.mesh.position;
    if (Math.hypot(p.x - pos.x, p.z - pos.z) > 2.8) return null;
    return { ta: `${st.npc.name.ta} உடன் பேசு`, en: `Talk to ${st.npc.name.en}` };
  }

  update(dt) {
    const g = this.game;
    const pos = g.player.pos;
    // mission NPC animation + face the player when close
    for (const n of this.npcs.values()) {
      const m = n.model.mesh;
      const d = Math.hypot(m.position.x - pos.x, m.position.z - pos.z);
      if (d < 6) {
        const target = Math.atan2(pos.x - m.position.x, pos.z - m.position.z);
        let diff = target - m.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        m.rotation.y += diff * Math.min(1, dt * 3);
        if (!n.talking && n.animator.state === 'idle' && d < 4 && !n.waved) { n.animator.setState('wave'); n.waved = true; }
      }
      if (d < 80) n.animator.update(dt, 0);
    }
    // marker pulse
    const t = performance.now() / 1000;
    for (const mk of this.markers) {
      mk.children[1].scale.setScalar(mk.userData.r * (1 + Math.sin(t * 3) * 0.08));
      mk.children[0].material.opacity = 0.25 + Math.sin(t * 2) * 0.08;
    }

    if (!this.active) {
      // auto-start or proximity start
      for (const m of this.available()) {
        if (m.auto) { this.start(m); return; }
        if (!g.player.vehicle && Math.hypot(m.giver.x - pos.x, m.giver.z - pos.z) < 2.5 && !this.busy) {
          g.ui.prompt({ ta: `E: பணி தொடங்கு — ${m.title.ta}`, en: `E: Start mission — ${m.title.en}` });
          if (g.input.hit('KeyE')) { this.start(m); g.input.pressed.delete('KeyE'); }
        }
      }
      return;
    }
    const st = this.step();
    if (!st || this.busy) return;
    if (this.timer !== null) {
      this.timer -= dt;
      g.ui.setTimer(this.timer);
      if (this.timer <= 0) { this.fail({ ta: 'நேரம் முடிந்தது!', en: 'Out of time!' }); return; }
    }
    if (st.type === 'goto') {
      const p = this.stepPos(st);
      const inVeh = g.player.vehicle;
      const needV = st.vehicle;
      const okVehicle = !needV || (needV === true ? !!inVeh : inVeh?.type === needV);
      if (Math.hypot(p.x - pos.x, p.z - pos.z) < (st.r || 3) + (inVeh ? 2 : 0)) {
        if (okVehicle) this.next();
        else g.ui.prompt(needV === 'ambulance' ? { ta: 'ஆம்புலன்ஸில் வர வேண்டும்!', en: 'You must come in the ambulance!' } : { ta: 'வண்டியில் வர வேண்டும்!', en: 'You must arrive in a vehicle!' });
      }
      if (needV && !okVehicle && !this.warned) {
        this.warned = true;
        g.ui.toast(needV === 'ambulance' ? { ta: 'ஆம்புலன்ஸுக்கு திரும்பு!', en: 'Get back in the ambulance!' } : { ta: 'வண்டியில் ஏறு!', en: 'Get in a vehicle!' }, 'warn');
      } else if (okVehicle) this.warned = false;
    } else if (st.type === 'enter') {
      const v = g.player.vehicle;
      if (v && (!st.vehicle || v.type === st.vehicle)) {
        if (v.type === 'ambulance') v.sirenOn = true;
        this.next();
      }
    }
  }

  serialize() {
    return { completed: [...this.completed] };
  }

  restore(data) {
    this.completed = new Set(data?.completed || []);
    this.refreshMarkers();
  }
}
