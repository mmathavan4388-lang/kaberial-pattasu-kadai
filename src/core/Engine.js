import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { PRESETS } from './Quality.js';

/**
 * Renderer, scene, camera, frame loop and dynamic resolution scaling.
 * Everything else plugs in through `onUpdate`.
 */
export class Engine {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.preset = PRESETS[settings.preset];

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: this.preset.antialias,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false; // count all passes of a frame

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 1500);

    this.resScale = 1;
    this.frameTimes = [];
    this.lastAdjust = 0;
    this.fps = 60;
    this.updaters = [];
    this.running = false;
    this.last = 0;

    this.applyPreset(settings.preset);
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  applyPreset(name) {
    this.settings.preset = name;
    this.preset = PRESETS[name];
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.camera.far = this.preset.viewDistance + 200;
    this.camera.updateProjectionMatrix();
    this.resScale = 1;
    this.setupComposer();
    this.resize();
    this.scene.traverse((o) => {
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => (m.needsUpdate = true));
      }
    });
  }

  setupComposer() {
    if (this.composer) {
      this.composer.dispose?.();
      this.composer = null;
    }
    if (!this.preset.bloom) return;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.35, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, this.preset.pixelRatio);
    return Math.max(0.5, dpr * this.resScale);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio());
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio());
      this.composer.setSize(w, h);
    }
  }

  onUpdate(fn) {
    this.updaters.push(fn);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const raw = Math.max(0, (now - this.last) / 1000);
      this.last = now;
      const dt = Math.min(raw, 1 / 20); // clamp hitches so physics stays stable
      this.trackPerformance(raw);
      for (const fn of this.updaters) fn(dt);
      this.render();
    };
    requestAnimationFrame(loop);
  }

  render() {
    this.renderer.info.reset();
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Dynamic resolution: keep ~60fps by trading pixels, not world content. */
  trackPerformance(raw) {
    this.frameTimes.push(raw);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const now = performance.now();
    if (now - this.lastAdjust < 1000 || this.frameTimes.length < 30) return;
    this.lastAdjust = now;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1 / avg;
    if (!this.settings.dynamicResolution) {
      if (this.resScale !== 1) { this.resScale = 1; this.resize(); }
      return;
    }
    let next = this.resScale;
    if (avg > 1 / 45) next = Math.max(0.55, this.resScale - 0.1);
    else if (avg < 1 / 58 && this.resScale < 1) next = Math.min(1, this.resScale + 0.05);
    if (Math.abs(next - this.resScale) > 0.001) {
      this.resScale = next;
      this.resize();
    }
  }
}
