// Fully procedural Web Audio: no sound files to download (fast loading).
// City ambience, vehicle engine, horns, sirens, train horn, temple bells,
// fireworks, UI and phone sounds — all positional by simple distance attenuation.

export class AudioSystem {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.enabled = false;
    this.bellTimer = 10;
  }

  /** Must be called from a user gesture. */
  unlock() {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.game.settings.volume;
    this.master.connect(this.ctx.destination);
    this.noiseBuf = this.makeNoise();
    this.buildAmbience();
    this.buildEngine();
    this.buildSiren();
    this.enabled = true;
  }

  setVolume(v) {
    if (this.master) this.master.gain.value = v;
  }

  makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02; // brown-ish
      d[i] = last * 3.5;
    }
    return b;
  }

  buildAmbience() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    this.ambGain = c.createGain();
    this.ambGain.gain.value = 0;
    src.connect(f).connect(this.ambGain).connect(this.master);
    src.start();
  }

  buildEngine() {
    const c = this.ctx;
    this.engOsc = c.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc2 = c.createOscillator();
    this.engOsc2.type = 'square';
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 400;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    const g2 = c.createGain();
    g2.gain.value = 0.3;
    this.engOsc.connect(this.engFilter);
    this.engOsc2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engOsc.start();
    this.engOsc2.start();
  }

  buildSiren() {
    const c = this.ctx;
    this.sirenOsc = c.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenGain = c.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
  }

  atten(x, z, range = 120) {
    const p = this.game.cameraRig?.pos || this.game.player.pos;
    const d = Math.hypot(x - p.x, z - p.z);
    return Math.max(0, 1 - d / range) ** 2;
  }

  tone(freq, dur, type = 'sine', vol = 0.2, when = 0, slide = null) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseBurst(dur, vol, freq = 800, when = 0) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.enabled) return;
    const v = opts.vol ?? 1;
    switch (name) {
      case 'horn': {
        const big = opts.big;
        const f = big ? 220 : opts.two ? 520 : 400;
        this.tone(f, 0.38, 'square', 0.06 * v);
        this.tone(f * 1.26, 0.38, 'square', 0.05 * v);
        break;
      }
      case 'impact': this.noiseBurst(0.35, 0.5 * v, 200); this.tone(70, 0.25, 'sine', 0.3 * v); break;
      case 'jump': this.noiseBurst(0.08, 0.05, 1500); break;
      case 'cash': this.tone(1318, 0.12, 'sine', 0.12); this.tone(1760, 0.3, 'sine', 0.1, 0.08); break;
      case 'click': this.tone(900, 0.05, 'square', 0.04); break;
      case 'mission': [523, 659, 784].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.12, i * 0.12)); break;
      case 'success': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.45, 'triangle', 0.13, i * 0.11)); break;
      case 'fail': [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.06, i * 0.18)); break;
      case 'alert': this.tone(880, 0.15, 'square', 0.07); this.tone(660, 0.2, 'square', 0.07, 0.16); break;
      case 'ring': for (let i = 0; i < 2; i++) { this.tone(740, 0.35, 'sine', 0.12, i * 0.45); this.tone(988, 0.35, 'sine', 0.08, i * 0.45); } break;
      case 'train': [110, 139, 165].forEach((f) => this.tone(f, 1.6, 'sawtooth', 0.05 * v)); break;
      case 'bell': [880, 1320, 1760, 2210].forEach((f, i) => this.tone(f, 2.4 - i * 0.4, 'sine', (0.07 / (i + 1)) * v)); break;
      case 'firework': {
        const delay = opts.delay || 0;
        this.noiseBurst(0.6, 0.35 * v, 120, delay);
        for (let i = 0; i < 8; i++) this.noiseBurst(0.05, 0.08 * v, 3000, delay + 0.3 + Math.random() * 0.8);
        break;
      }
      default: break;
    }
  }

  update(dt) {
    if (!this.enabled) return;
    const g = this.game;
    const c = this.ctx;
    const t = c.currentTime;
    const env = g.env;
    const density = env ? (env.hour >= 22 || env.hour < 5 ? 0.25 : 1) : 1;
    this.ambGain.gain.setTargetAtTime(0.05 * density, t, 0.5);

    const v = g.player.vehicle;
    if (v) {
      const two = v.spec.two;
      const sp = Math.abs(v.speed);
      const rpm = (sp % (v.spec.maxSpeed / 4)) / (v.spec.maxSpeed / 4);
      const base = two ? 55 : v.spec.big ? 28 : v.type === 'auto' ? 48 : 38;
      const f = base * (1 + rpm * 1.4 + sp / v.spec.maxSpeed);
      this.engOsc.frequency.setTargetAtTime(f, t, 0.05);
      this.engOsc2.frequency.setTargetAtTime(f * (v.type === 'auto' ? 0.5 : 0.502), t, 0.05);
      this.engFilter.frequency.setTargetAtTime(300 + sp * 30, t, 0.1);
      this.engGain.gain.setTargetAtTime(0.06 + Math.min(0.06, sp * 0.004), t, 0.1);
    } else {
      this.engGain.gain.setTargetAtTime(0, t, 0.15);
    }
    // sirens: player's vehicle or police pursuit nearby
    let siren = 0;
    if (v?.sirenOn) siren = 1;
    for (const p of g.police?.pursuers || []) siren = Math.max(siren, this.atten(p.pos.x, p.pos.z, 250));
    for (const a of g.traffic?.active || []) if (a.sirenOn) siren = Math.max(siren, this.atten(a.pos.x, a.pos.z, 200) * 0.7);
    const wail = 650 + Math.sin(t * Math.PI * 0.9) * 250;
    this.sirenOsc.frequency.setTargetAtTime(wail, t, 0.05);
    this.sirenGain.gain.setTargetAtTime(siren * 0.05, t, 0.1);

    // temple bells near temples in the morning / evening
    this.bellTimer -= dt;
    if (this.bellTimer <= 0 && env) {
      this.bellTimer = 6 + Math.random() * 8;
      const h = env.hour;
      if ((h > 5.5 && h < 9) || (h > 17.5 && h < 20.5)) {
        for (const id of ['temple', 'hilltemple', 'villagetemple']) {
          const lm = g.world.landmarks && g.lmById?.[id];
          if (!lm) continue;
          const a = this.atten(lm.x, lm.z, 150);
          if (a > 0.02) this.play('bell', { vol: a });
        }
      }
    }
  }
}
