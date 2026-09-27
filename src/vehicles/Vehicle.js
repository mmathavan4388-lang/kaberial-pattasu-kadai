// Runtime vehicle: transform, arcade physics (used by the player and pursuing
// police), wheel spin, siren flashing and damage.
import * as THREE from 'three';
import { clamp, damp, wrapAngle } from '../core/utils.js';

let NEXT_ID = 1;

export class Vehicle {
  constructor(type, variant, factory, castShadow) {
    this.id = NEXT_ID++;
    this.type = type;
    this.variant = variant;
    const inst = factory.instance(type, variant, castShadow);
    this.group = inst.group;
    this.body = inst.body;
    this.sirens = inst.sirens;
    this.spec = inst.spec;
    this.pos = this.group.position;
    this.heading = 0;
    this.speed = 0;
    this.steer = 0;
    this.lean = 0;
    this.spin = 0;
    this.health = 100;
    this.sirenOn = false;
    this.sirenT = 0;
    this.driver = null; // { model, animator } or 'player'
    this.ai = null;
    this.parked = false;
    this.honkCooldown = 0;
  }

  get forward() {
    return { x: Math.sin(this.heading), z: Math.cos(this.heading) };
  }

  place(x, z, heading) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.syncTransform();
  }

  syncTransform() {
    this.group.rotation.set(0, this.heading, 0);
    if (this.spec.two) this.body.rotation.z = this.lean;
  }

  /** Circles (world) used for collision. */
  circles() {
    const out = [];
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    for (const [, z, r] of this.spec.circles) out.push({ x: this.pos.x + s * z, z: this.pos.z + c * z, r });
    return out;
  }

  /**
   * Arcade driving. input = { throttle -1..1, brake 0..1, steer -1..1, handbrake }
   * Returns collision info from the world if any.
   */
  drive(dt, input, world) {
    const sp = this.spec;
    const maxS = sp.maxSpeed * (this.health > 25 ? 1 : 0.55);
    const fwd = this.speed >= 0;
    let acc = 0;
    if (input.throttle > 0) acc = fwd ? sp.accel * input.throttle * (1 - (this.speed / maxS) ** 2) : sp.brake;
    else if (input.throttle < 0) acc = this.speed > 0.5 ? -sp.brake : -sp.accel * 0.6 * (this.speed > -maxS * 0.3 ? 1 : 0);
    if (input.brake) acc -= Math.sign(this.speed) * sp.brake * input.brake;
    // rolling resistance + drag
    acc -= this.speed * (input.handbrake ? 1.4 : 0.12) + Math.sign(this.speed) * 0.4;
    this.speed += acc * dt;
    if (Math.abs(this.speed) < 0.05 && !input.throttle) this.speed = 0;

    const speedK = clamp(Math.abs(this.speed) / sp.maxSpeed, 0, 1);
    const maxSteer = (sp.two ? 0.5 : 0.55) * (1 - speedK * 0.62);
    this.steer += (input.steer * maxSteer - this.steer) * damp(sp.big ? 4 : 7, dt);
    const yaw = (this.speed / sp.wheelbase) * Math.tan(this.steer) * (input.handbrake ? 1.5 : 1);
    this.heading = wrapAngle(this.heading + yaw * dt);
    const f = this.forward;
    this.pos.x += f.x * this.speed * dt;
    this.pos.z += f.z * this.speed * dt;
    if (sp.two) {
      const targetLean = clamp(-yaw * Math.abs(this.speed) * 0.05, -0.6, 0.6);
      this.lean += (targetLean - this.lean) * damp(6, dt);
    }

    let hit = null;
    if (world) {
      // resolve each body circle against static geometry
      const s = Math.sin(this.heading);
      const c = Math.cos(this.heading);
      for (const [, z, r] of sp.circles) {
        const p = { x: this.pos.x + s * z, z: this.pos.z + c * z };
        const h = world.resolveCircle(p, r * 0.9);
        if (h) {
          this.pos.x += p.x - (this.pos.x + s * z);
          this.pos.z += p.z - (this.pos.z + c * z);
          hit = h;
        }
      }
      if (hit) {
        const into = -(hit.nx * f.x + hit.nz * f.z) * this.speed;
        if (into > 3) this.damage(into * 1.5);
        this.speed *= into > 6 ? -0.25 : 0.6;
      }
      this.pos.y = world.heightAt(this.pos.x, this.pos.z) > 0.2 ? world.heightAt(this.pos.x, this.pos.z) : 0;
    }
    this.syncTransform();
    return hit;
  }

  damage(n) {
    this.health = Math.max(0, this.health - n);
  }

  update(dt) {
    this.spin += (this.speed / this.spec.wheelR) * dt;
    if (this.honkCooldown > 0) this.honkCooldown -= dt;
    if (this.sirens.length) {
      this.sirenT += dt;
      const phase = Math.floor(this.sirenT * 6) % 2;
      for (const m of this.sirens) m.visible = this.sirenOn ? (m.userData.color === 'red' ? phase === 0 : phase === 1) : false;
    }
  }

  /** Write wheel instance matrices; returns number written. */
  writeWheels(mesh, start, tmp) {
    const sp = this.spec;
    const s = Math.sin(this.heading);
    const c = Math.cos(this.heading);
    let i = start;
    for (const [x, z] of sp.wheels) {
      const front = z > 0;
      tmp.m.makeRotationY(this.heading + (front ? this.steer : 0));
      if (sp.two) tmp.m.multiply(tmp.r.makeRotationZ(this.lean));
      tmp.m.multiply(tmp.r.makeRotationX(this.spin));
      const w = sp.two ? 0.22 : sp.big ? 0.7 : 0.45;
      tmp.m.multiply(tmp.r.makeScale(w, sp.wheelR, sp.wheelR));
      const lx = sp.two ? Math.sin(this.lean) * sp.wheelR * 0 : x;
      tmp.m.setPosition(this.pos.x + c * lx + s * z, this.pos.y + sp.wheelR, this.pos.z - s * lx + c * z);
      mesh.setMatrixAt(i++, tmp.m);
    }
    return i - start;
  }
}

export const WHEEL_TMP = { m: new THREE.Matrix4(), r: new THREE.Matrix4() };
