// Third-person orbit camera with smoothing, vehicle chase mode, speed FOV and
// collision against buildings (so the camera never ends up inside a wall).
import * as THREE from 'three';
import { clamp, damp, lerpAngle } from '../core/utils.js';

export class CameraRig {
  constructor(camera, world) {
    this.camera = camera;
    this.world = world;
    this.yaw = Math.PI;
    this.pitch = 0.25;
    this.dist = 4.2;
    this.zoom = 1;
    this.idle = 0;
    this.focus = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.first = true;
  }

  get forward() {
    return { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
  }

  update(dt, input, player) {
    const sens = input.sensitivity ?? 1;
    if (input.mouseDX || input.mouseDY) this.idle = 0;
    else this.idle += dt;
    this.yaw -= input.mouseDX * 0.0024 * sens;
    this.pitch = clamp(this.pitch + input.mouseDY * 0.0022 * sens, -0.2, 1.15);
    if (input.wheel) this.zoom = clamp(this.zoom + input.wheel * 0.12, 0.55, 2.2);

    const v = player.vehicle;
    const target = new THREE.Vector3();
    let dist;
    let height;
    if (v) {
      const size = v.spec.len;
      dist = (size * 1.1 + 3.2) * this.zoom;
      height = v.spec.big ? 3 : 1.7;
      target.set(v.pos.x, v.pos.y + height, v.pos.z);
      // auto chase behind the vehicle when the mouse is idle and we're moving
      if (this.idle > 1.2 && Math.abs(v.speed) > 2) {
        const behind = v.speed >= 0 ? v.heading : v.heading + Math.PI;
        this.yaw = lerpAngle(this.yaw, behind, damp(2.2, dt));
        this.pitch += (0.2 - this.pitch) * damp(1.5, dt);
      }
    } else {
      dist = 4.2 * this.zoom;
      height = 1.55;
      target.set(player.pos.x, player.pos.y + height, player.pos.z);
    }
    if (this.first) { this.focus.copy(target); this.first = false; }
    this.focus.lerp(target, damp(v ? 12 : 16, dt));

    const cp = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cp, -Math.sin(this.pitch), Math.cos(this.yaw) * cp);
    // collision: march from the focus towards the desired position
    let allowed = dist;
    const colliders = this.world.collidersNear(this.focus.x, this.focus.z);
    for (let t = 0.6; t <= dist; t += 0.4) {
      const px = this.focus.x - dir.x * t;
      const py = this.focus.y - dir.y * t;
      const pz = this.focus.z - dir.z * t;
      if (this.blocked(px, py, pz, colliders)) { allowed = Math.max(1.5, t - 0.4); break; }
    }
    this.dist += (allowed - this.dist) * damp(allowed < this.dist ? 20 : 4, dt);
    this.pos.set(this.focus.x - dir.x * this.dist, this.focus.y - dir.y * this.dist, this.focus.z - dir.z * this.dist);
    const g = this.world.heightAt(this.pos.x, this.pos.z) + 0.35;
    if (this.pos.y < g) this.pos.y = g;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.focus);
    const speed = v ? Math.abs(v.speed) : player.speed;
    const fov = 62 + clamp((speed - 8) * 0.45, 0, 12);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * damp(3, dt);
      this.camera.updateProjectionMatrix();
    }
  }

  blocked(x, y, z, list) {
    for (const c of list) {
      if (c.type !== 'rect' || y > (c.h ?? 8)) continue;
      const dx = x - c.x;
      const dz = z - c.z;
      const lx = dx * c.c - dz * c.s;
      const lz = dx * c.s + dz * c.c;
      if (Math.abs(lx) < c.hw + 0.25 && Math.abs(lz) < c.hd + 0.25) return true;
    }
    return false;
  }
}
