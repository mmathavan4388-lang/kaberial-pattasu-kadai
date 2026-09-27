// Procedural animation: every pose is computed per bone, then the skeleton is
// smoothly blended toward it (exponential damping) so transitions between walk,
// run, jump, drive, talk etc. are always smooth. Gait phase is driven by distance
// travelled, which keeps feet from sliding.
import { damp, clamp } from '../core/utils.js';

const NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'foreArmL', 'handL', 'upperArmR', 'foreArmR', 'handR', 'thighL', 'shinL', 'footL', 'thighR', 'shinR', 'footR'];

function blank() {
  const p = {};
  for (const n of NAMES) p[n] = { x: 0, y: 0, z: 0 };
  p.hipsY = 0;
  p.hipsZ = 0;
  return p;
}

export class Animator {
  constructor(model) {
    this.model = model;
    this.bones = model.bones;
    this.hipsRest = this.bones.hips.position.clone();
    this.cur = blank();
    this.tgt = blank();
    this.state = 'idle';
    this.stateTime = 0;
    this.phase = Math.random() * 6;
    this.t = Math.random() * 10;
    this.stoop = model.appearance.stoop || 0;
    this.gaitScale = ['veshti', 'lungi', 'saree', 'skirt'].includes(model.appearance.bottom) ? 0.7 : 1;
    this.blendSpeed = 10;
    this.steer = 0;
    this.variant = Math.floor(Math.random() * 3);
  }

  setState(s) {
    if (s !== this.state) {
      this.state = s;
      this.stateTime = 0;
    }
  }

  /** @param speed horizontal speed m/s (used for gait), opts.steer -1..1 */
  update(dt, speed = 0, opts = {}) {
    this.t += dt;
    this.stateTime += dt;
    const p = this.tgt;
    for (const n of NAMES) { const b = p[n]; b.x = 0; b.y = 0; b.z = 0; }
    p.hipsY = 0;
    p.hipsZ = 0;
    const st = this.state;
    const g = this.gaitScale;
    // natural relaxed arms
    p.upperArmL.z = 0.07;
    p.upperArmR.z = -0.07;
    p.foreArmL.x = -0.12;
    p.foreArmR.x = -0.12;

    if (st === 'walk' || st === 'run') {
      const run = st === 'run';
      const stride = run ? 2.5 : 1.35 * (0.8 + 0.2 * g);
      this.phase += (speed * dt * Math.PI * 2) / stride;
      const s = Math.sin(this.phase);
      const c = Math.cos(this.phase);
      const k = clamp(speed / (run ? 5 : 1.4), 0.3, 1.2);
      const leg = (run ? 0.75 : 0.42) * g * k;
      const knee = (run ? 1.5 : 0.75) * k;
      const arm = (run ? 0.8 : 0.35) * k;
      p.thighL.x = -s * leg - (run ? 0.1 : 0);
      p.thighR.x = s * leg - (run ? 0.1 : 0);
      p.shinL.x = knee * Math.max(0, c) + 0.06;
      p.shinR.x = knee * Math.max(0, -c) + 0.06;
      p.footL.x = -p.thighL.x * 0.3 - p.shinL.x * 0.4;
      p.footR.x = -p.thighR.x * 0.3 - p.shinR.x * 0.4;
      p.upperArmL.x = s * arm;
      p.upperArmR.x = -s * arm;
      p.foreArmL.x = run ? -1.35 + s * 0.25 : -0.2 - Math.max(0, -s) * 0.35;
      p.foreArmR.x = run ? -1.35 - s * 0.25 : -0.2 - Math.max(0, s) * 0.35;
      if (run) { p.upperArmL.z = 0.18; p.upperArmR.z = -0.18; }
      p.hips.y = s * 0.09 * k;
      p.chest.y = -s * 0.13 * k;
      p.spine.x = run ? -0.2 : -0.04;
      p.head.x = run ? 0.12 : 0.02;
      p.hips.z = c * 0.025 * k;
      p.hipsY = -Math.abs(s) * (run ? 0.06 : 0.03) + (run ? -0.04 : 0);
    } else if (st === 'jump' || st === 'fall') {
      const up = st === 'jump';
      p.thighL.x = -0.8; p.shinL.x = 1.1;
      p.thighR.x = up ? -0.2 : -0.45; p.shinR.x = up ? 0.4 : 0.8;
      p.footL.x = 0.2; p.footR.x = 0.1;
      p.upperArmL.x = -0.5; p.upperArmL.z = 0.55; p.foreArmL.x = -0.6;
      p.upperArmR.x = -0.3; p.upperArmR.z = -0.55; p.foreArmR.x = -0.6;
      p.spine.x = -0.12;
    } else if (st === 'land') {
      p.thighL.x = -0.6; p.shinL.x = 1.0; p.thighR.x = -0.6; p.shinR.x = 1.0;
      p.footL.x = -0.4; p.footR.x = -0.4;
      p.hipsY = -0.18; p.spine.x = -0.3;
      if (this.stateTime > 0.25) this.setState('idle');
    } else if (st === 'drive_car' || st === 'sit') {
      p.thighL.x = -1.45; p.thighR.x = -1.45;
      p.shinL.x = 1.4; p.shinR.x = 1.4;
      p.thighL.z = 0.06; p.thighR.z = -0.06;
      if (st === 'drive_car') {
        const sv = this.steer;
        p.upperArmL.x = -0.85 + sv * 0.25; p.upperArmL.z = 0.25;
        p.upperArmR.x = -0.85 - sv * 0.25; p.upperArmR.z = -0.25;
        p.foreArmL.x = -0.6; p.foreArmR.x = -0.6;
        p.head.y = sv * 0.2;
      } else {
        p.upperArmL.x = -0.35; p.upperArmR.x = -0.35; p.foreArmL.x = -0.9; p.foreArmR.x = -0.9;
      }
    } else if (st === 'drive_bike' || st === 'drive_auto') {
      const bike = st === 'drive_bike';
      p.thighL.x = bike ? -1.15 : -1.4; p.thighR.x = bike ? -1.15 : -1.4;
      p.thighL.z = bike ? 0.22 : 0.08; p.thighR.z = bike ? -0.22 : -0.08;
      p.shinL.x = bike ? 1.3 : 1.35; p.shinR.x = bike ? 1.3 : 1.35;
      p.spine.x = bike ? -0.22 : -0.08;
      const sv = this.steer;
      p.upperArmL.x = -0.95 + sv * 0.2; p.upperArmL.z = 0.35;
      p.upperArmR.x = -0.95 - sv * 0.2; p.upperArmR.z = -0.35;
      p.foreArmL.x = -0.35; p.foreArmR.x = -0.35;
      p.chest.y = sv * 0.12;
    } else if (st === 'talk') {
      const t = this.t;
      p.upperArmR.x = -0.35 + Math.sin(t * 2.7) * 0.18; p.upperArmR.z = -0.2;
      p.foreArmR.x = -1.1 + Math.sin(t * 3.9) * 0.25;
      p.upperArmL.x = -0.15 + Math.sin(t * 2.1 + 1) * 0.1; p.foreArmL.x = -0.5 + Math.sin(t * 3.1) * 0.2;
      p.head.x = Math.sin(t * 2.3) * 0.06; p.head.y = Math.sin(t * 0.9) * 0.15;
      p.chest.x = Math.sin(t * 1.6) * 0.02;
    } else if (st === 'wave') {
      p.upperArmR.z = -2.5; p.upperArmR.x = -0.2;
      p.foreArmR.z = -0.3 + Math.sin(this.t * 9) * 0.45;
      if (this.stateTime > 2) this.setState('idle');
    } else if (st === 'phone') {
      p.upperArmR.x = -0.55; p.upperArmR.z = -0.55; p.upperArmR.y = 0.6;
      p.foreArmR.x = -2.3;
      p.head.z = -0.12;
    } else if (st === 'work') {
      const t = this.t;
      p.spine.x = -0.35; p.chest.x = -0.12; p.head.x = 0.2;
      p.upperArmL.x = -0.75 + Math.sin(t * 3) * 0.1; p.upperArmR.x = -0.7 + Math.sin(t * 3 + 1.4) * 0.12;
      p.foreArmL.x = -0.7; p.foreArmR.x = -0.8 + Math.sin(t * 5) * 0.15;
    } else if (st === 'interact') {
      p.spine.x = -0.3; p.upperArmR.x = -1.1; p.foreArmR.x = -0.3; p.head.x = 0.2;
      if (this.stateTime > 0.8) this.setState('idle');
    } else if (st === 'knockdown') {
      const k = Math.min(1, this.stateTime * 4);
      p.hips.x = -1.45 * k; p.hipsY = -0.78 * k; p.hipsZ = -0.4 * k;
      p.thighL.x = -0.3; p.thighR.x = -0.1; p.shinL.x = 0.4; p.shinR.x = 0.2;
      p.upperArmL.z = 1.2; p.upperArmR.z = -1.2; p.head.x = 0.3;
      if (this.stateTime > 2.4 && !opts.stayDown) this.setState('getup');
    } else if (st === 'getup') {
      p.thighL.x = -0.9; p.shinL.x = 1.4; p.thighR.x = -0.9; p.shinR.x = 1.4;
      p.spine.x = -0.5; p.hipsY = -0.35;
      if (this.stateTime > 0.7) this.setState('idle');
    } else if (st === 'cheer') {
      p.upperArmL.z = 2.6; p.upperArmR.z = -2.6;
      p.foreArmL.z = 0.3 + Math.sin(this.t * 8) * 0.3; p.foreArmR.z = -0.3 - Math.sin(this.t * 8) * 0.3;
      p.hipsY = Math.abs(Math.sin(this.t * 6)) * 0.05;
    } else {
      // idle: breathing, weight shift, glances
      const t = this.t;
      p.chest.x = Math.sin(t * 1.7) * 0.022;
      p.hips.z = Math.sin(t * 0.45) * 0.03;
      p.spine.z = -Math.sin(t * 0.45) * 0.02;
      p.head.y = Math.sin(t * 0.31 + this.variant) * 0.25;
      p.head.x = Math.sin(t * 0.23) * 0.05;
      p.thighL.z = 0.03; p.thighR.z = -0.03;
      if (this.variant === 1) { p.upperArmL.x = 0.25; p.upperArmR.x = 0.25; p.foreArmL.x = -0.3; p.foreArmR.x = -0.3; p.upperArmL.z = 0.18; p.upperArmR.z = -0.18; }
      if (this.variant === 2) { p.upperArmL.z = 0.35; p.foreArmL.x = -1.6; p.foreArmL.y = 0.8; }
      if (this.stoop && this.variant === 0) { p.upperArmR.x = -0.35; p.foreArmR.x = -0.5; }
    }
    if (this.stoop) {
      p.spine.x -= this.stoop;
      p.head.x += this.stoop * 0.7;
      p.thighL.x -= this.stoop * 0.2;
      p.thighR.x -= this.stoop * 0.2;
      p.shinL.x += this.stoop * 0.3;
      p.shinR.x += this.stoop * 0.3;
    }
    if (opts.lookYaw !== undefined) p.head.y += clamp(opts.lookYaw, -0.9, 0.9);

    // blend
    const f = damp(this.blendSpeed, dt);
    const c = this.cur;
    for (const n of NAMES) {
      const a = c[n];
      const b = p[n];
      a.x += (b.x - a.x) * f;
      a.y += (b.y - a.y) * f;
      a.z += (b.z - a.z) * f;
      this.bones[n].rotation.set(a.x, a.y, a.z);
    }
    c.hipsY += (p.hipsY - c.hipsY) * f;
    c.hipsZ += (p.hipsZ - c.hipsZ) * f;
    this.bones.hips.position.set(this.hipsRest.x, this.hipsRest.y + c.hipsY, this.hipsRest.z + c.hipsZ);
  }

  /** Jump straight to the target pose (used when spawning pooled NPCs). */
  snap() {
    const f = this.blendSpeed;
    this.blendSpeed = 1e4;
    this.update(0.016, 0);
    this.blendSpeed = f;
  }
}
