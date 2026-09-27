// Realistic asset pipeline (glTF / GLB).
//
// The game ships fully procedural (instant loading), but any character, NPC or
// vehicle can be replaced by an authored, realistic model (e.g. Mixamo characters,
// Sketchfab vehicles) just by listing it in `public/assets/manifest.json`.
// Nothing in the game code needs to change. See docs/REAL_MODELS_TA.md.
//
// {
//   "animations": ["animations/idle.glb", "animations/walk.glb", "animations/run.glb", "animations/sitting.glb"],
//   "hero":  { "url": "characters/leomathav.glb", "height": 1.8 },
//   "npcs": [
//     { "url": "characters/man1.glb",   "height": 1.72, "roles": ["man", "shop_owner", "driver"] },
//     { "url": "characters/woman1.glb", "height": 1.58, "female": true, "roles": ["woman", "vendor"] },
//     { "url": "characters/police.glb", "height": 1.75, "roles": ["police"] }
//   ],
//   "vehicles": { "car": { "url": "vehicles/car.glb", "wheels": true, "rotateY": 0 } }
// }
//
// * Characters are cloned with SkeletonUtils, so 40 NPCs using one GLB share its
//   geometry and textures (cheap). Animation clips can live inside the GLB or be shared
//   files (Mixamo "In Place" exports); clip names are matched loosely ("Walking", "walk").
// * Any role / vehicle type without a model keeps using the procedural version.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

const FEMALE_ROLES = new Set(['woman', 'girl', 'oldwoman', 'nurse', 'amma']);

// state -> keywords tried in order against clip names
const CLIP_KEYS = {
  idle: ['idle', 'breath', 'stand'],
  walk: ['walk'],
  run: ['run', 'jog', 'sprint'],
  jump: ['jump'],
  fall: ['fall', 'jump'],
  land: ['land'],
  drive_car: ['driv', 'sit'],
  drive_bike: ['ride', 'bike', 'motor', 'driv', 'sit'],
  drive_auto: ['driv', 'ride', 'sit'],
  sit: ['sit'],
  talk: ['talk', 'convers', 'explain'],
  wave: ['wave', 'greet', 'hello'],
  phone: ['phone', 'call', 'talk'],
  work: ['work', 'typing', 'pick', 'hammer'],
  interact: ['pick', 'button', 'interact', 'grab'],
  knockdown: ['knock', 'fall', 'death', 'dying', 'hit'],
  getup: ['getup', 'get up', 'standup', 'stand up'],
  cheer: ['cheer', 'victory', 'celebrat', 'dance'],
};
const TIMED = { land: 0.3, wave: 2, interact: 0.8, getup: 0.8 };
const SEATED = new Set(['drive_car', 'drive_bike', 'drive_auto', 'sit']);

const norm = (s) => String(s).toLowerCase().replace(/mixamorig[:_]?/g, '').replace(/[^a-z0-9]/g, '');

export class AssetRegistry {
  constructor() {
    this.manifest = null;
    this.gltfs = new Map();
    this.sharedClips = [];
    this.ready = false;
  }

  async init() {
    try {
      const r = await fetch('assets/manifest.json', { cache: 'no-cache' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) this.manifest = await r.json();
    } catch (e) { /* no manifest: procedural assets only */ }
    this.manifest ||= {};
    return this;
  }

  get hasAny() {
    const m = this.manifest;
    return !!(m.hero || m.npcs?.length || (m.vehicles && Object.keys(m.vehicles).length));
  }

  /** Download every listed GLB in the background (while the menu is shown). */
  async preload(progress = () => {}) {
    const m = this.manifest;
    const urls = new Set();
    for (const a of m.animations || []) urls.add(a);
    if (m.hero?.url) urls.add(m.hero.url);
    for (const n of m.npcs || []) { urls.add(n.url); (n.animations || []).forEach((a) => urls.add(a)); }
    if (m.hero?.animations) m.hero.animations.forEach((a) => urls.add(a));
    for (const v of Object.values(m.vehicles || {})) urls.add(v.url);
    for (const l of Object.values(m.landmarks || {})) urls.add(l.url);
    if (!urls.size) { this.ready = true; return; }
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(draco); // many downloaded models are Draco-compressed
    let done = 0;
    await Promise.all([...urls].map(async (u) => {
      try {
        const g = await loader.loadAsync(`assets/${u}`);
        this.gltfs.set(u, g);
      } catch (e) {
        console.warn(`[assets] could not load ${u} — using procedural fallback`, e);
      }
      progress(++done / urls.size, u);
    }));
    this.sharedClips = this.clipsFrom(m.animations || []);
    this.ready = true;
  }

  clipsFrom(urls) {
    const out = [];
    for (const u of urls) {
      const g = this.gltfs.get(u);
      if (!g) continue;
      const base = u.split('/').pop().replace(/\.(glb|gltf)$/i, '');
      g.animations.forEach((c, i) => {
        const clip = c.clone();
        // single-clip Mixamo files are named "mixamo.com": use the file name instead
        if (g.animations.length === 1 || /mixamo/i.test(clip.name)) clip.name = g.animations.length === 1 ? base : `${base}_${i}`;
        out.push(clip);
      });
    }
    return out;
  }

  // ------------------------------------------------------------ characters
  entryFor(role, seed) {
    const list = (this.manifest.npcs || []).filter((n) => this.gltfs.has(n.url));
    if (!list.length) return null;
    const female = FEMALE_ROLES.has(role);
    let cands = list.filter((n) => (n.roles || []).includes(role));
    if (!cands.length) cands = list.filter((n) => (n.roles || []).includes('*') && !!n.female === female);
    if (!cands.length) return null;
    return cands[Math.abs(seed) % cands.length];
  }

  makeHero() {
    const h = this.manifest.hero;
    if (!h || !this.gltfs.has(h.url)) return null;
    return this.makeCharacter(h, { hero: true, role: 'hero', female: false });
  }

  /** Realistic NPC for a role, or null to fall back to the procedural model. */
  makeNpc(role, seed) {
    const e = this.entryFor(role, seed);
    if (!e) return null;
    return this.makeCharacter(e, { role, female: !!e.female, old: /old/.test(role), kid: role === 'boy' || role === 'girl', face: seed % 64 });
  }

  makeCharacter(entry, appearance) {
    const g = this.gltfs.get(entry.url);
    const clips = [...g.animations.map((c) => c.clone()), ...this.clipsFrom(entry.animations || []), ...this.sharedClips];
    return new GLTFCharacter(g, entry, appearance, clips);
  }

  // ------------------------------------------------------------ vehicles
  vehicleModel(type, spec) {
    const v = this.manifest.vehicles?.[type];
    const g = v && this.gltfs.get(v.url);
    if (!g) return null;
    const inner = g.scene.clone(true);
    inner.rotation.y = v.rotateY ?? 0;
    inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inner);
    const size = box.getSize(new THREE.Vector3());
    const s = (v.length ?? spec.len) / Math.max(size.z, 0.01);
    inner.scale.setScalar(s);
    inner.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(inner);
    inner.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
    inner.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return { object: inner, ownWheels: v.wheels !== false, seat: v.seat || null };
  }

  landmarkModel(id) {
    const l = this.manifest.landmarks?.[id];
    const g = l && this.gltfs.get(l.url);
    if (!g) return null;
    const o = g.scene.clone(true);
    if (l.scale) o.scale.setScalar(l.scale);
    o.rotation.y = l.rotateY ?? 0;
    o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
    return o;
  }
}

/**
 * A glTF character with the same interface as the procedural HumanModel + Animator:
 * { mesh, animator, scale, appearance }. `mesh` is an outer Group the game moves around;
 * the realistic model inside is scaled to the requested height with its feet at y = 0.
 */
export class GLTFCharacter {
  constructor(gltf, entry, appearance, clips) {
    const height = entry.height ?? (appearance.female ? 1.58 : 1.75);
    this.mesh = new THREE.Group();
    this.inner = cloneSkinned(gltf.scene);
    this.inner.rotation.y = entry.rotateY ?? 0;
    this.inner.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.inner);
    const h = Math.max(0.1, box.max.y - box.min.y);
    const s = height / h;
    this.inner.scale.setScalar(s);
    this.inner.position.y = -box.min.y * s;
    this.mesh.add(this.inner);
    this.mesh.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    this.scale = height / 1.75; // hips ≈ 0.56 × height, matches the procedural seat maths
    this.appearance = { height, stoop: 0, face: 0, bottom: 'pants', ...appearance, gltf: true };

    // bones for the seated fallback pose
    const bones = {};
    this.inner.traverse((o) => { if (o.isBone) bones[norm(o.name)] = o; });
    const find = (...names) => names.map((n) => bones[n]).find(Boolean) || null;
    this.bones = {
      thighL: find('leftupleg', 'leftthigh', 'thighl', 'lthigh'),
      thighR: find('rightupleg', 'rightthigh', 'thighr', 'rthigh'),
      shinL: find('leftleg', 'leftcalf', 'calfl', 'lcalf'),
      shinR: find('rightleg', 'rightcalf', 'calfr', 'rcalf'),
      armL: find('leftarm', 'leftupperarm', 'upperarml'),
      armR: find('rightarm', 'rightupperarm', 'upperarmr'),
      foreL: find('leftforearm', 'leftlowerarm', 'lowerarml'),
      foreR: find('rightforearm', 'rightlowerarm', 'lowerarmr'),
    };
    const hipsName = Object.keys(bones).find((k) => k === 'hips' || k === 'pelvis');

    this.mixer = new THREE.AnimationMixer(this.inner);
    this.actions = {};
    const bindNames = new Map(Object.values(bones).map((b) => [norm(b.name), b.name]));
    const prepared = clips.map((c) => this.retarget(c, bindNames, hipsName ? bones[hipsName].name : null));
    for (const [state, keys] of Object.entries(CLIP_KEYS)) {
      const explicit = entry.clips?.[state];
      let clip = explicit ? prepared.find((c) => c.name === explicit) : null;
      for (const k of keys) {
        if (clip) break;
        clip = prepared.find((c) => c.name.toLowerCase().includes(k));
      }
      if (clip) this.actions[state] = this.mixer.clipAction(clip);
    }
    if (!this.actions.idle && prepared.length) this.actions.idle = this.mixer.clipAction(prepared[0]);
    for (const [st, a] of Object.entries(this.actions)) {
      if (TIMED[st] || st === 'jump' || st === 'land' || st === 'knockdown' || st === 'getup') { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; }
    }
    this.animator = new GLTFAnimator(this);
  }

  /** Map track names onto this skeleton and remove horizontal root motion (keep in place). */
  retarget(clip, bindNames, hipsBone) {
    const c = clip.clone();
    c.tracks = c.tracks.filter((t) => {
      const dot = t.name.lastIndexOf('.');
      const node = t.name.slice(0, dot);
      const prop = t.name.slice(dot);
      const real = bindNames.get(norm(node));
      if (!real) return false;
      t.name = real + prop;
      if (real === hipsBone && prop === '.position') {
        const v = t.values;
        const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      }
      return true;
    });
    return c;
  }
}

class GLTFAnimator {
  constructor(char) {
    this.c = char;
    this.state = null;
    this.stateTime = 0;
    this.steer = 0;
    this.current = null;
    this.fall = 0;
    this.setState('idle');
  }

  actionFor(s) {
    const a = this.c.actions;
    if (a[s]) return a[s];
    if (SEATED.has(s)) return a.sit || a.drive_car || a.idle;
    if (s === 'fall') return a.jump || a.idle;
    if (s === 'phone' || s === 'work') return a.talk || a.idle;
    return a.idle;
  }

  setState(s) {
    if (s === this.state) return;
    this.state = s;
    this.stateTime = 0;
    const next = this.actionFor(s);
    if (next && next !== this.current) {
      next.reset();
      next.enabled = true;
      next.setEffectiveWeight(1);
      next.play();
      if (this.current) this.current.crossFadeTo(next, 0.25, false);
      this.current = next;
    } else if (next) {
      next.reset().play();
    }
  }

  snap() {
    this.c.mixer.update(0);
  }

  update(dt, speed = 0, opts = {}) {
    this.stateTime += dt;
    const s = this.state;
    // time-scale gait clips so feet match the movement speed
    if (this.current) {
      if (s === 'walk') this.current.timeScale = Math.max(0.5, Math.min(1.6, speed / 1.5));
      else if (s === 'run') this.current.timeScale = Math.max(0.7, Math.min(1.4, speed / 5));
      else this.current.timeScale = 1;
    }
    this.c.mixer.update(dt);
    if (TIMED[s] && this.stateTime > TIMED[s]) this.setState('idle');
    if (s === 'knockdown' && this.stateTime > 2.4 && !opts.stayDown) this.setState('getup');

    // knockdown fallback when the model has no fall clip: tip the whole body over
    const tip = s === 'knockdown' && !this.c.actions.knockdown ? 1 : 0;
    this.fall += (tip - this.fall) * Math.min(1, dt * 6);
    this.c.inner.rotation.x = -1.45 * this.fall;
    this.c.inner.position.z = -0.8 * this.fall;

    // seated fallback pose (drive / ride) when no sitting clip exists
    if (SEATED.has(s) && !this.c.actions[s] && !this.c.actions.sit) this.applySeated(s);
  }

  /** Rotate bones about the character's own left-right axis to make a seated pose. */
  applySeated(s) {
    const b = this.c.bones;
    const bike = s !== 'drive_car' && s !== 'sit';
    const root = this.c.mesh;
    root.updateWorldMatrix(true, false);
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    const pq = new THREE.Quaternion();
    const r = new THREE.Quaternion();
    const turn = (bone, angle) => {
      if (!bone) return;
      bone.parent.updateWorldMatrix(true, false);
      bone.parent.getWorldQuaternion(pq);
      r.setFromAxisAngle(axis, angle);
      // local' = P^-1 * R * P * local
      const inv = pq.clone().invert();
      bone.quaternion.premultiply(pq).premultiply(r).premultiply(inv);
      bone.updateMatrixWorld(true);
    };
    const leg = bike ? -1.2 : -1.45;
    turn(b.thighL, leg); turn(b.thighR, leg);
    turn(b.shinL, -leg); turn(b.shinR, -leg);
    const arm = -0.9 + this.steer * 0.15;
    turn(b.armL, arm); turn(b.armR, -0.9 - this.steer * 0.15);
    turn(b.foreL, -0.4); turn(b.foreR, -0.4);
  }
}
