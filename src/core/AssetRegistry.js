// Optional premium asset pipeline. The game ships with fully procedural assets (instant
// loading, no downloads). If `public/assets/manifest.json` lists authored glTF/GLB
// models (e.g. a scanned / sculpted LEOMATHAV with Idle/Walk/Run/... clips), they are
// streamed in the background and swapped in without code changes.
//
// manifest.json example:
// {
//   "hero": { "url": "characters/leomathav.glb", "scale": 1, "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "jump": "Jump", "drive_car": "Drive" } }
// }
import * as THREE from 'three';

export class AssetRegistry {
  constructor() {
    this.manifest = null;
  }

  async init() {
    try {
      const r = await fetch('assets/manifest.json', { cache: 'no-cache' });
      if (r.ok) this.manifest = await r.json();
    } catch (e) { /* no manifest: procedural assets only */ }
    return this;
  }

  async loadCharacter(key) {
    const entry = this.manifest?.[key];
    if (!entry?.url) return null;
    try {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const gltf = await new GLTFLoader().loadAsync(`assets/${entry.url}`);
      return new GLTFCharacter(gltf, entry);
    } catch (e) {
      console.warn('Premium asset failed to load, using procedural model', e);
      return null;
    }
  }
}

/** Adapter giving a glTF character the same interface as the procedural one. */
export class GLTFCharacter {
  constructor(gltf, entry) {
    this.mesh = gltf.scene;
    this.scale = entry.scale ?? 1;
    this.mesh.scale.setScalar(this.scale);
    this.mesh.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.appearance = { hero: true, height: 1.8 };
    this.mixer = new THREE.AnimationMixer(this.mesh);
    const clips = entry.clips || {};
    this.actions = {};
    for (const [state, name] of Object.entries(clips)) {
      const clip = THREE.AnimationClip.findByName(gltf.animations, name);
      if (clip) this.actions[state] = this.mixer.clipAction(clip);
    }
    const self = this;
    this.animator = {
      state: 'idle', stateTime: 0, steer: 0,
      setState(s) {
        if (s === this.state) return;
        const from = self.actions[this.state] || self.actions.idle;
        const to = self.actions[s] || self.actions.idle;
        this.state = s;
        this.stateTime = 0;
        if (to && to !== from) { to.reset().play(); from?.crossFadeTo(to, 0.25, false); }
      },
      update(dt) { this.stateTime += dt; self.mixer.update(dt); },
      snap() {},
    };
    this.actions.idle?.play();
  }
}
