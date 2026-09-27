// Sky, sun/moon, day-night cycle, fog/haze, weather and night fireworks.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { clamp, lerp, smoothstep, mulberry32, weightedPick } from '../core/utils.js';
import { DISTRICTS } from '../world/MapData.js';

const WEATHERS = {
  clear: { fogK: 1, sun: 1, turbidity: 3.2, rain: 0, cloud: 0 },
  hazy: { fogK: 0.62, sun: 0.85, turbidity: 8, rain: 0, cloud: 0.2 },
  cloudy: { fogK: 0.75, sun: 0.45, turbidity: 9, rain: 0, cloud: 0.7 },
  rain: { fogK: 0.45, sun: 0.25, turbidity: 14, rain: 1, cloud: 1 },
};

export class Environment {
  constructor(game) {
    this.game = game;
    this.engine = game.engine;
    this.scene = game.engine.scene;
    this.preset = game.engine.preset;
    this.hour = 8.5;
    this.day = 1;
    this.timeScale = 60; // 1 real second = 1 game minute
    this.rng = mulberry32(99);
    this.weather = 'clear';
    this.w = { ...WEATHERS.clear };
    this.weatherTimer = 3 * 60;
    this.night = 0;

    this.sky = new Sky();
    this.sky.scale.setScalar(9000);
    const u = this.sky.material.uniforms;
    u.rayleigh.value = 1.2;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    this.scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3);
    this.sun.castShadow = this.preset.shadows;
    const sm = this.preset.shadowMapSize;
    this.sun.shadow.mapSize.set(sm, sm);
    const ext = this.preset.label === 'ULTRA' ? 90 : this.preset.label === 'HIGH' ? 75 : 55;
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 600 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.shadowExt = ext;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0xb08a60, 1.1);
    this.scene.add(this.hemi);
    this.moonLight = new THREE.DirectionalLight(0x8fa8ff, 0);
    this.scene.add(this.moonLight, this.moonLight.target);

    this.scene.fog = new THREE.Fog(0xcfd8dc, 100, this.preset.viewDistance);
    this.buildStars();
    this.buildRain();
    this.buildFireworks();
    this.sunDir = new THREE.Vector3();
    // headlight for the player's vehicle (the only shadowless spot light we need)
    this.headlight = new THREE.SpotLight(0xfff1d6, 0, 55, 0.55, 0.5, 1.2);
    this.scene.add(this.headlight, this.headlight.target);
  }

  buildStars() {
    // keep the sky dome objects inside the camera's far plane
    this.skyR = this.engine.camera.far * 0.8;
    const n = 1400;
    const pos = new Float32Array(n * 3);
    const r = mulberry32(5);
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2;
      const ph = Math.acos(r() * 0.95);
      pos.set([Math.sin(ph) * Math.cos(th) * this.skyR, Math.cos(ph) * this.skyR, Math.sin(ph) * Math.sin(th) * this.skyR], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(this.skyR * 0.017, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf4f1e6, fog: false, transparent: true }));
    this.scene.add(this.moon);
  }

  buildRain() {
    const n = this.preset.rainDrops;
    const pos = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xaab8c8, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.rainDrops = [];
    const r = mulberry32(3);
    for (let i = 0; i < n; i++) this.rainDrops.push([(r() - 0.5) * 60, r() * 30, (r() - 0.5) * 60]);
    this.scene.add(this.rain);
  }

  buildFireworks() {
    this.bursts = [];
    this.fwTimer = 5;
    const N = 140;
    for (let i = 0; i < 6; i++) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const m = new THREE.PointsMaterial({ size: 5, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      p.visible = false;
      this.scene.add(p);
      this.bursts.push({ points: p, vel: new Float32Array(N * 3), life: 0, n: N });
    }
  }

  launchFirework(center) {
    const b = this.bursts.find((x) => x.life <= 0);
    if (!b) return;
    const r = this.rng;
    const hue = r();
    const pos = b.points.geometry.attributes.position.array;
    const col = b.points.geometry.attributes.color.array;
    const c = new THREE.Color();
    const c2 = new THREE.Color().setHSL((hue + 0.5) % 1, 1, 0.6);
    for (let i = 0; i < b.n; i++) {
      pos[i * 3] = center.x; pos[i * 3 + 1] = center.y; pos[i * 3 + 2] = center.z;
      const th = r() * Math.PI * 2;
      const ph = Math.acos(2 * r() - 1);
      const s = 18 + r() * 8;
      b.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      b.vel[i * 3 + 1] = Math.cos(ph) * s;
      b.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
      c.setHSL(hue, 1, 0.55 + r() * 0.2);
      const cc = r() < 0.25 ? c2 : c;
      col.set([cc.r, cc.g, cc.b], i * 3);
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.geometry.attributes.color.needsUpdate = true;
    b.life = 2.4;
    b.points.visible = true;
    b.points.material.opacity = 1;
    this.game.events.emit('firework', { x: center.x, y: center.y, z: center.z });
  }

  setWeather(name) {
    this.weather = name;
    this.game.events.emit('weather', name);
  }

  /** Sun elevation for a given hour (sunrise ~6:00, sunset ~18:15 in Sivakasi). */
  sunAngles(h) {
    const t = (h - 6.1) / 12.2; // 0 at sunrise, 1 at sunset
    const elev = Math.sin(t * Math.PI) * 78 * (Math.PI / 180);
    const az = lerp(Math.PI / 2, -Math.PI / 2, t); // east (+x) -> west (-x)
    return { elev: t >= 0 && t <= 1 ? elev : -Math.abs(Math.sin(t * Math.PI)) * 0.8, az };
  }

  update(dt, focus) {
    this.hour += (dt * this.timeScale) / 3600;
    if (this.hour >= 24) { this.hour -= 24; this.day++; this.game.events.emit('newday', this.day); }

    // weather changes (Sivakasi is mostly dry & hazy)
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      this.weatherTimer = (2 + this.rng() * 3) * 60;
      this.setWeather(weightedPick(this.rng, [['clear', 5], ['hazy', 3], ['cloudy', 1.4], ['rain', 0.8]]));
    }
    const W = WEATHERS[this.weather];
    const k = Math.min(1, dt * 0.2);
    for (const key of Object.keys(W)) this.w[key] += (W[key] - this.w[key]) * k;

    const { elev, az } = this.sunAngles(this.hour);
    this.sunDir.set(Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * 0.28).normalize(); // slightly south
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = this.w.turbidity;

    const day = smoothstep(-0.05, 0.18, this.sunDir.y);
    const golden = 1 - smoothstep(0.05, 0.4, this.sunDir.y);
    this.night = 1 - smoothstep(-0.12, 0.06, this.sunDir.y);
    const sunColor = new THREE.Color(0xfff4e2).lerp(new THREE.Color(0xff9a52), golden * 0.8);
    this.sun.color.copy(sunColor);
    this.sun.intensity = day * 3.6 * this.w.sun;
    this.hemi.intensity = 0.75 + day * 0.45 * (0.7 + 0.3 * this.w.sun);
    this.hemi.color.set(0xe3ebf5).lerp(new THREE.Color(0x56679c), this.night);
    this.hemi.groundColor.set(0xb08a60).lerp(new THREE.Color(0x2c2620), this.night);
    this.moonLight.intensity = this.night * 0.7;

    // follow focus with the shadow camera (snap to texels to avoid shimmering)
    const texel = (this.shadowExt * 2) / this.preset.shadowMapSize;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.position.set(fx + this.sunDir.x * 300, Math.max(20, this.sunDir.y * 300), fz + this.sunDir.z * 300);
    this.sun.target.position.set(fx, 0, fz);
    this.sun.castShadow = this.preset.shadows && day > 0.05;
    this.moonLight.position.set(focus.x - this.sunDir.x * 300, 200, focus.z - this.sunDir.z * 300);
    this.moonLight.target.position.set(focus.x, 0, focus.z);

    // fog / haze
    const fogDay = new THREE.Color(0xc9d3dc).lerp(new THREE.Color(0xe8b98a), golden * 0.6).lerp(new THREE.Color(0x9ea4a8), this.w.cloud * 0.6);
    const fogNight = new THREE.Color(0x0b1020);
    this.scene.fog.color.copy(fogDay).lerp(fogNight, this.night);
    const far = this.preset.viewDistance * this.w.fogK * (1 - this.night * 0.25);
    this.scene.fog.far = far;
    this.scene.fog.near = far * 0.18;
    this.engine.renderer.toneMappingExposure = lerp(0.62, 0.85, this.night) * (1 - this.w.cloud * 0.1);

    this.sky.position.copy(focus);
    this.stars.position.copy(focus);
    this.stars.material.opacity = this.night * (1 - this.w.cloud * 0.9);
    const mr = this.skyR * 0.95;
    this.moon.position.set(focus.x - this.sunDir.x * mr, Math.max(-mr * 0.2, -this.sunDir.y * mr + mr * 0.25), focus.z - this.sunDir.z * mr);
    this.moon.material.opacity = this.night;
    this.moon.visible = this.night > 0.02;

    this.game.world.mats.setNight(this.night);
    this.game.vehicleFactory?.setNight(this.night);
    if (this.engine.bloom) {
      // only lamps / windows / signs should glow: high threshold by day
      this.engine.bloom.strength = lerp(0.12, 0.6, this.night);
      this.engine.bloom.threshold = lerp(2.4, 0.85, this.night);
    }

    // wet roads when raining
    const wet = this.w.rain;
    this.game.world.mats.road.roughness = lerp(0.95, 0.35, wet);
    this.game.world.mats.roadRural.roughness = lerp(0.97, 0.45, wet);

    const pv = this.game.player?.vehicle;
    if (pv && this.night > 0.1) {
      const f = pv.forward;
      this.headlight.position.set(pv.pos.x + f.x * (pv.spec.len / 2), 1.0, pv.pos.z + f.z * (pv.spec.len / 2));
      this.headlight.target.position.set(pv.pos.x + f.x * 25, 0, pv.pos.z + f.z * 25);
      this.headlight.intensity = this.night * 80;
    } else this.headlight.intensity = 0;

    this.updateRain(dt, focus);
    this.updateFireworks(dt, focus);
  }

  updateRain(dt, focus) {
    const on = this.w.rain > 0.2;
    this.rain.visible = on;
    if (!on) return;
    this.rain.material.opacity = 0.45 * this.w.rain;
    const arr = this.rain.geometry.attributes.position.array;
    const fall = 26 * dt;
    for (let i = 0; i < this.rainDrops.length; i++) {
      const d = this.rainDrops[i];
      d[1] -= fall;
      if (d[1] < 0) d[1] += 30;
      const x = focus.x + d[0];
      const y = focus.y + d[1] - 5;
      const z = focus.z + d[2];
      arr[i * 6] = x; arr[i * 6 + 1] = y; arr[i * 6 + 2] = z;
      arr[i * 6 + 3] = x + 0.05; arr[i * 6 + 4] = y + 0.7; arr[i * 6 + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }

  updateFireworks(dt, focus) {
    const h = this.hour;
    const festive = (h >= 19 && h < 23.8) || h < 0.5;
    if (festive && this.w.rain < 0.3) {
      this.fwTimer -= dt;
      if (this.fwTimer <= 0) {
        this.fwTimer = 3 + this.rng() * 12;
        // fireworks tested/celebrated around the fireworks belt and villages
        const spots = DISTRICTS.filter((d) => d.type === 'fireworks' || d.type === 'village' || d.type === 'bazaar');
        const d = spots[Math.floor(this.rng() * spots.length)];
        const cx = d.x + (this.rng() - 0.5) * d.r;
        const cz = d.z + (this.rng() - 0.5) * d.r;
        const dist = Math.hypot(cx - focus.x, cz - focus.z);
        if (dist < 900) this.launchFirework(new THREE.Vector3(cx, 70 + this.rng() * 60, cz));
      }
    }
    for (const b of this.bursts) {
      if (b.life <= 0) continue;
      b.life -= dt;
      const pos = b.points.geometry.attributes.position.array;
      for (let i = 0; i < b.n; i++) {
        b.vel[i * 3 + 1] -= 9.8 * dt * 0.6;
        b.vel[i * 3] *= 1 - dt * 1.2;
        b.vel[i * 3 + 1] *= 1 - dt * 1.2;
        b.vel[i * 3 + 2] *= 1 - dt * 1.2;
        pos[i * 3] += b.vel[i * 3] * dt;
        pos[i * 3 + 1] += b.vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.points.material.opacity = clamp(b.life / 1.2, 0, 1);
      if (b.life <= 0) b.points.visible = false;
    }
  }

  timeString() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    const ampm = h < 12 ? 'AM' : 'PM';
    const hh = ((h + 11) % 12) + 1;
    return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
  }
}
