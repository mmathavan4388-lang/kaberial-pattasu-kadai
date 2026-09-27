// LEOMATHAV: on-foot movement (walk / sprint / jump), collisions, entering and
// driving vehicles, damage and knockdowns.
import * as THREE from 'three';
import { clamp, damp, lerpAngle } from '../core/utils.js';

export class Player {
  constructor(game, character) {
    this.game = game;
    this.char = character;
    this.mesh = character.mesh;
    this.animator = character.animator;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.heading = 0;
    this.grounded = true;
    this.health = 100;
    this.stamina = 1;
    this.vehicle = null;
    this.knock = 0;
    this.airTime = 0;
    this.speed = 0;
  }

  spawn(x, z, heading = 0) {
    this.pos.set(x, this.game.world.heightAt(x, z), z);
    this.heading = heading;
    this.vel.set(0, 0, 0);
    if (!this.mesh.parent) this.game.engine.scene.add(this.mesh);
    this.syncMesh();
  }

  syncMesh() {
    if (this.vehicle) return;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.heading, 0);
  }

  get locked() {
    return this.game.dialogue.freeze || this.game.ui.modalOpen;
  }

  update(dt, input, camYaw) {
    if (this.vehicle) this.updateDriving(dt, input);
    else this.updateOnFoot(dt, input, camYaw);
    this.stamina = clamp(this.stamina + dt * (this.sprinting ? -0.12 : 0.18), 0, 1);
  }

  updateOnFoot(dt, input, camYaw) {
    const world = this.game.world;
    const a = this.animator;
    if (this.knock > 0) {
      this.knock -= dt;
      a.setState('knockdown');
      a.update(dt, 0, { stayDown: this.knock > 0.8 });
      this.syncMesh();
      return;
    }
    let fwd = 0;
    let right = 0;
    if (!this.locked) {
      fwd = input.axis('KeyS', 'KeyW') + input.axis('ArrowDown', 'ArrowUp');
      right = input.axis('KeyA', 'KeyD') + input.axis('ArrowLeft', 'ArrowRight');
    }
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    let mx = fx * fwd - fz * right;
    let mz = fz * fwd + fx * right;
    const len = Math.hypot(mx, mz);
    this.sprinting = len > 0.1 && input.key('ShiftLeft') && this.stamina > 0.05;
    const target = len > 0.1 ? (this.sprinting ? 5.8 : 2.0) : 0;
    if (len > 0.1) { mx /= len; mz /= len; }
    const k = damp(this.grounded ? 10 : 2, dt);
    this.vel.x += (mx * target - this.vel.x) * k;
    this.vel.z += (mz * target - this.vel.z) * k;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.speed = hs;
    if (len > 0.1 && hs > 0.2) this.heading = lerpAngle(this.heading, Math.atan2(mx, mz), damp(10, dt));

    // jump & gravity
    if (this.grounded && !this.locked && input.hit('Space')) {
      this.vy = 4.8;
      this.grounded = false;
      a.setState('jump');
      this.game.audio?.play('jump');
    }
    this.vy -= 15 * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vy * dt;
    world.resolveCircle(this.pos, 0.33);
    const ground = world.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      // step up small ledges (sidewalk curbs, platforms)
      if (!this.grounded && this.airTime > 0.6) a.setState('land');
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
      this.airTime = 0;
    } else if (this.pos.y - ground > 0.25) {
      this.grounded = false;
      this.airTime += dt;
    } else if (this.grounded) {
      this.pos.y = ground;
      this.vy = 0;
    }

    // traffic / train hazards
    const car = this.game.traffic.hitTestPedestrian(this.pos.x, this.pos.z);
    if (car) this.knockDown(Math.min(60, car.speed * 3.2), car.pos);
    if (this.game.world.railway.hitTest(this.pos.x, this.pos.z, 0.3)) this.knockDown(80, this.game.world.railway.trainHeadPos());

    if (a.state !== 'land' && a.state !== 'interact' && a.state !== 'wave' && a.state !== 'getup' && a.state !== 'phone' && a.state !== 'cheer') {
      if (!this.grounded) a.setState(this.vy > 0 ? 'jump' : 'fall');
      else a.setState(hs > 3.2 ? 'run' : hs > 0.25 ? 'walk' : 'idle');
    } else if ((a.state === 'phone' || a.state === 'cheer') && hs > 0.5) a.setState('walk');
    a.update(dt, hs, { lookYaw: 0 });
    this.syncMesh();
  }

  knockDown(damage, from) {
    if (this.knock > 0) return;
    this.health = Math.max(0, this.health - damage);
    this.knock = 2.6;
    const dx = this.pos.x - from.x;
    const dz = this.pos.z - from.z;
    const d = Math.hypot(dx, dz) || 1;
    this.pos.x += (dx / d) * 2;
    this.pos.z += (dz / d) * 2;
    this.heading = Math.atan2(-dx, -dz);
    this.animator.setState('knockdown');
    this.game.audio?.play('impact');
    this.game.ui.flash('damage');
  }

  // ------------------------------------------------------------ vehicles
  enter(v) {
    const sp = v.spec;
    this.vehicle = v;
    this.game.engine.scene.remove(this.mesh);
    const s = this.char.scale;
    this.mesh.position.set(sp.seat[0], sp.seat[1] - 0.98 * s + 0.03, sp.seat[2]);
    this.mesh.rotation.set(0, 0, 0);
    v.body.add(this.mesh);
    this.animator.setState(sp.pose);
    this.animator.snap();
    if (sp.siren && (v.type === 'ambulance' || v.type === 'fire')) v.sirenOn = false;
  }

  exit() {
    const v = this.vehicle;
    if (!v) return;
    if (Math.abs(v.speed) > 6 && !v.spec.two) return; // too fast to jump out
    v.body.remove(this.mesh);
    const side = v.spec.two ? -0.9 : -(v.spec.width / 2 + 0.7);
    const c = Math.cos(v.heading);
    const s = Math.sin(v.heading);
    const x = v.pos.x + c * side + s * (v.spec.seat[2]);
    const z = v.pos.z - s * side + c * (v.spec.seat[2]);
    this.vehicle = null;
    this.game.traffic.abandon(v);
    v.speed *= 0.3;
    this.pos.set(x, this.game.world.heightAt(x, z), z);
    this.game.world.resolveCircle(this.pos, 0.35);
    this.heading = v.heading;
    this.vel.set(0, 0, 0);
    this.game.engine.scene.add(this.mesh);
    this.animator.setState('idle');
    this.syncMesh();
  }

  updateDriving(dt, input) {
    const v = this.vehicle;
    const L = this.locked;
    const throttle = L ? 0 : input.axis('KeyS', 'KeyW') + input.axis('ArrowDown', 'ArrowUp');
    const steer = L ? 0 : input.axis('KeyD', 'KeyA') + input.axis('ArrowRight', 'ArrowLeft');
    const handbrake = !L && input.key('Space');
    v.drive(dt, { throttle: clamp(throttle, -1, 1), steer: clamp(steer, -1, 1), brake: L ? 1 : 0, handbrake }, this.game.world);
    const impact = this.game.traffic.collidePlayerVehicle(v);
    if (impact > 3) {
      this.game.audio?.play('impact');
      if (v.spec.two) this.health = Math.max(0, this.health - impact * 1.5);
    }
    if (!L && input.hit('KeyH')) this.game.events.emit('horn', { x: v.pos.x, z: v.pos.z, type: v.type, player: true });
    if (!L && input.hit('KeyG') && v.spec.siren) v.sirenOn = !v.sirenOn;
    this.pos.copy(v.pos);
    this.heading = v.heading;
    this.speed = Math.abs(v.speed);
    this.animator.steer = v.steer / 0.5;
    this.animator.update(dt, 0);
    // falling off a two-wheeler in a hard crash
    if (v.spec.two && impact > 9) {
      v.speed = 0;
      const saved = v.spec;
      this.exit();
      this.knockDown(0, { x: v.pos.x + Math.sin(v.heading) * 3, z: v.pos.z + Math.cos(v.heading) * 3 });
      void saved;
    }
    if (v.health <= 0 && Math.abs(v.speed) < 1) this.game.ui.toast({ ta: 'வண்டி பழுதாகிவிட்டது! மெக்கானிக்கிடம் போங்க.', en: 'Vehicle broken! Visit the mechanic.' });
  }
}
