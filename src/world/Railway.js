// Virudhunagar – Thiruthangal – Sivakasi – Srivilliputhur line: track, stations,
// level crossings with gates, and a passenger train that stops at stations.
import * as THREE from 'three';
import { STATIONS } from './MapData.js';
import { GeoBuilder } from './GeoBuilder.js';
import { addFacadeBuilding, FLOOR_H } from './ChunkBuilder.js';
import { ROW } from './Textures.js';

const C = (h) => new THREE.Color(h);
const GAUGE = 1.676;
const LOCO_LEN = 18;
const COACH_LEN = 21;
const COACHES = 8;
const CRUISE = 20;

function coachGeometry(loco) {
  const b = new GeoBuilder();
  const L = loco ? LOCO_LEN : COACH_LEN;
  const body = C(loco ? '#b71c1c' : '#1f4e9c');
  const band = C(loco ? '#fdd835' : '#f5f0e1');
  b.box(0, 2.35, 0, 3.1, 2.7, L, body);
  b.box(0, 2.3, 0, 3.14, 0.35, L - 0.2, band);
  const roof = new THREE.CylinderGeometry(1.55, 1.55, L, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2);
  const rm = new THREE.Matrix4().makeScale(1, 0.35, 1).setPosition(0, 3.7, 0);
  b.geometry(roof, rm, C('#6d7075'));
  if (!loco) {
    const n = 10;
    for (let i = 0; i < n; i++) {
      const z = -L / 2 + 1.5 + (i * (L - 3)) / (n - 1);
      for (const x of [-1.56, 1.56]) b.box(x, 2.85, z, 0.04, 0.9, 1.1, C('#1b1f24'));
    }
    for (const z of [-L / 2 + 0.8, L / 2 - 0.8]) for (const x of [-1.56, 1.56]) b.box(x, 2.2, z, 0.05, 2.2, 0.9, C('#263238'));
  } else {
    for (const z of [-L / 2 + 0.05, L / 2 - 0.05]) {
      b.box(0, 3.1, z, 2.4, 0.9, 0.06, C('#1b1f24'));
      b.box(0, 1.4, z, 3.0, 0.5, 0.1, C('#fdd835'));
    }
    b.box(0, 4.3, 3, 1.2, 0.5, 0.1, C('#333'));
    b.box(0, 4.55, 3, 0.1, 0.1, 1.8, C('#333'));
  }
  // underframe & bogies
  b.box(0, 0.95, 0, 2.6, 0.3, L - 1, C('#222'));
  for (const z of [-L / 2 + 3, L / 2 - 3]) {
    b.box(0, 0.6, z, 2.3, 0.5, 2.8, C('#1a1a1a'));
    for (const zz of [-0.9, 0.9]) for (const x of [-0.84, 0.84]) {
      b.geometry(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 12).rotateZ(Math.PI / 2), new THREE.Matrix4().makeTranslation(x, 0.46, z + zz), C('#333'));
    }
  }
  return b.build();
}

export class Railway {
  constructor(scene, roads, mats, castShadow) {
    this.scene = scene;
    this.roads = roads;
    this.mats = mats;
    this.colliders = [];
    this.walkables = [];
    this.crossings = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.buildTrack();
    this.buildStations(castShadow);
    this.buildCrossings();
    this.buildTrain(castShadow);
  }

  buildTrack() {
    const ballast = new GeoBuilder();
    const rails = new GeoBuilder();
    const bal = C('#7c756c');
    const steel = C('#8a8f96');
    for (const r of this.roads.rail) {
      const ang = Math.atan2(r.bx - r.ax, r.bz - r.az);
      const mx = (r.ax + r.bx) / 2;
      const mz = (r.az + r.bz) / 2;
      ballast.place(mx, 0, mz, ang);
      ballast.box(0, 0.12, 0, 3.6, 0.24, r.len + 2, bal, [0, 0, 1, 1], { bottom: true });
      rails.place(mx, 0, mz, ang);
      for (const x of [-GAUGE / 2, GAUGE / 2]) rails.box(x, 0.35, 0, 0.08, 0.14, r.len + 0.2, steel, [0, 0, 1, 1], { bottom: true });
    }
    ballast.setTransform(null);
    const bm = new THREE.Mesh(ballast.build(), this.mats.detail);
    bm.receiveShadow = true;
    const rm = new THREE.Mesh(rails.build(), this.mats.metal);
    this.group.add(bm, rm);

    // sleepers: one instanced mesh for the entire line
    const count = Math.floor(this.roads.railLength / 0.75);
    const geo = new THREE.BoxGeometry(2.6, 0.12, 0.25);
    const sl = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0x6d655c, roughness: 0.95 }), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const pt = this.roads.railPoint(i * 0.75);
      q.setFromAxisAngle(up, Math.atan2(pt.dx, pt.dz));
      p.set(pt.x, 0.27, pt.z);
      m.compose(p, q, one);
      sl.setMatrixAt(i, m);
    }
    sl.computeBoundingSphere();
    sl.receiveShadow = true;
    this.group.add(sl);
  }

  buildStations(castShadow) {
    const fb = new GeoBuilder();
    const db = new GeoBuilder();
    const sb = new GeoBuilder();
    this.stationInfo = [];
    for (const st of STATIONS) {
      const s = this.roads.railParamAtZ(st.z);
      const p = this.roads.railPoint(s);
      const ang = Math.atan2(p.dx, p.dz);
      // perpendicular pointing to the station side
      const px = p.dz * st.side;
      const pz = -p.dx * st.side;
      const platOff = 4.6;
      const plat = { x: p.x + px * platOff, z: p.z + pz * platOff };
      db.place(plat.x, 0, plat.z, ang);
      db.box(0, 0.45, 0, 5.4, 0.9, 170, C('#b9b2a6'));
      db.box(-2.55 * st.side, 0.92, 0, 0.3, 0.06, 170, C('#f5d90a')); // yellow edge line
      // canopy
      for (let z = -30; z <= 30; z += 10) db.box(0.8 * st.side, 2.6, z, 0.3, 3.4, 0.3, C('#8d6e63'));
      db.box(0.4 * st.side, 4.35, 0, 5, 0.15, 66, C('#a1887f'));
      // benches
      for (let z = -20; z <= 20; z += 10) db.box(1.4 * st.side, 1.15, z, 0.6, 0.45, 2.4, C('#5d4037'));
      // yellow station name boards
      sb.place(plat.x, 0, plat.z, ang + Math.PI / 2);
      for (const z of [-55, 0, 55]) {
        sb.quad([z - 2.5, 2.2, 0], [z + 2.5, 2.2, 0], [z + 2.5, 3.8, 0], [z - 2.5, 3.8, 0], C('#fff'), this.mats.signUV(`station_${st.id}`));
        db.place(plat.x, 0, plat.z, ang + Math.PI / 2);
        db.box(z - 2.3, 1.5, -0.1, 0.12, 2.4, 0.12, C('#222'));
        db.box(z + 2.3, 1.5, -0.1, 0.12, 2.4, 0.12, C('#222'));
      }
      db.setTransform(null);
      sb.setTransform(null);
      this.walkables.push({ x: plat.x, z: plat.z, hw: 2.7, hd: 85, c: Math.cos(ang), s: Math.sin(ang), h: 0.9 });
      // station building behind the platform, facing away from the tracks (towards town)
      const bOff = platOff + 2.7 + 6;
      const b = {
        kind: 'house', x: p.x + px * bOff, z: p.z + pz * bOff, rot: Math.atan2(px, pz),
        w: 34, d: 11, floors: 1, paint: '#f3e3b8', shop: false, open: false, winRow: ROW.WIN_A,
        sign: -1, awning: null, tank: false, stair: false, roof: 'flat', balcony: false,
      };
      b.h = FLOOR_H * 1.3;
      b.floors = 1;
      addFacadeBuilding(fb, b, this.mats.factory.size, false);
      // maroon trim + name board on the building front
      db.place(b.x, 0, b.z, b.rot);
      db.box(0, b.h + 0.5, 5.56, 34, 0.25, 0.12, C('#7b1f1f'));
      db.setTransform(null);
      sb.place(b.x, 0, b.z, b.rot);
      sb.quad([-5, 4.4, 5.62], [5, 4.4, 5.62], [5, 5.9, 5.62], [-5, 5.9, 5.62], C('#fff'), this.mats.signUV(`station_${st.id}`));
      sb.setTransform(null);
      this.colliders.push({ type: 'rect', x: b.x, z: b.z, hw: 17, hd: 5.5, c: Math.cos(b.rot), s: Math.sin(b.rot), h: 6 });
      this.stationInfo.push({ ...st, s, x: plat.x, z: plat.z, door: { x: b.x + px * 7, z: b.z + pz * 7 } });
    }
    const add = (bld, mat, shadow) => {
      const m = new THREE.Mesh(bld.build(), mat);
      m.castShadow = shadow && castShadow;
      m.receiveShadow = true;
      this.group.add(m);
    };
    add(fb, this.mats.facade, true);
    add(db, this.mats.detail, true);
    add(sb, this.mats.signs, false);
  }

  buildCrossings() {
    // find road/rail intersections
    for (const r of this.roads.rail) {
      for (const e of this.roads.edges) {
        const hit = segIntersect(r.ax, r.az, r.bx, r.bz, e.a.x, e.a.z, e.b.x, e.b.z);
        if (!hit) continue;
        this.crossings.push({ x: hit.x, z: hit.z, edge: e, closed: false, arm: 0, arms: [] });
      }
    }
    const armGeo = new THREE.BoxGeometry(1, 0.12, 0.12).translate(0.5, 0, 0);
    const pos = armGeo.attributes.position;
    const cols = [];
    for (let i = 0; i < pos.count; i++) {
      const stripe = Math.floor(pos.getX(i) * 8) % 2;
      cols.push(1, stripe ? 1 : 0.1, stripe ? 1 : 0.1);
    }
    armGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const armMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    for (const c of this.crossings) {
      const e = c.edge;
      for (const side of [1, -1]) {
        // barrier on each side of the track, along the road
        const along = 7 * side;
        const bx = c.x + e.dx * along + e.dz * (e.hw + 0.8);
        const bz = c.z + e.dz * along - e.dx * (e.hw + 0.8);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.2, 0.3), postMat);
        post.position.set(bx, 0.6, bz);
        const pivot = new THREE.Object3D();
        pivot.position.set(bx, 1.1, bz);
        // arm points across the road
        pivot.rotation.y = Math.atan2(-e.dx, -e.dz);
        const arm = new THREE.Mesh(armGeo, armMat);
        arm.scale.x = e.w + 1.2;
        const tilt = new THREE.Object3D();
        tilt.add(arm);
        pivot.add(tilt);
        this.group.add(post, pivot);
        c.arms.push(tilt);
      }
    }
  }

  buildTrain(castShadow) {
    const locoGeo = coachGeometry(true);
    const coachGeo = coachGeometry(false);
    this.cars = [];
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 });
    for (let i = 0; i <= COACHES; i++) {
      const mesh = new THREE.Mesh(i === 0 ? locoGeo : coachGeo, mat);
      mesh.castShadow = castShadow;
      mesh.matrixAutoUpdate = true;
      this.group.add(mesh);
      this.cars.push({ mesh, len: i === 0 ? LOCO_LEN : COACH_LEN });
    }
    this.train = { s: 0, dir: 1, speed: 0, wait: 20, state: 'wait', stopAt: null, hidden: false, respawn: 0 };
    this.placeTrain();
    this.train.s = this.trainLength + 10;
    this.placeTrain();
  }

  placeTrain() {
    const t = this.train;
    let off = 0;
    for (const car of this.cars) {
      const s = t.s - t.dir * (off + car.len / 2);
      const p = this.roads.railPoint(s);
      car.mesh.position.set(p.x, 0.35, p.z);
      car.mesh.rotation.y = Math.atan2(p.dx, p.dz);
      car.s = s;
      car.visible = !t.hidden;
      car.mesh.visible = !t.hidden;
      off += car.len + 1;
    }
    this.trainLength = off;
  }

  /** True when a level crossing within `r` of (x,z) has its gates down. */
  crossingClosedNear(x, z, r = 22) {
    for (const c of this.crossings) {
      if (c.closed && (c.x - x) ** 2 + (c.z - z) ** 2 < r * r) return c;
    }
    return null;
  }

  trainHeadPos() {
    return this.roads.railPoint(this.train.s);
  }

  update(dt, events) {
    const t = this.train;
    const L = this.roads.railLength;
    if (t.hidden) {
      t.respawn -= dt;
      if (t.respawn <= 0) {
        t.hidden = false;
        t.dir = -t.dir;
        t.s = t.dir > 0 ? 5 : L - 5;
        t.state = 'run';
        t.speed = CRUISE * 0.6;
      }
    } else if (t.state === 'wait') {
      t.wait -= dt;
      if (t.wait <= 0) {
        t.state = 'run';
        events?.emit('train:horn', this.trainHeadPos());
      }
    } else {
      // find next station ahead
      let target = null;
      for (const st of this.stationInfo) {
        const ahead = st.s + t.dir * (this.trainLength / 2 - 5) - t.s; // stop centred on the platform
        if (ahead * t.dir > 1 && (!target || Math.abs(ahead) < Math.abs(target.ahead))) target = { st, ahead };
      }
      let desired = CRUISE;
      if (target) {
        const dist = Math.abs(target.ahead);
        desired = Math.min(CRUISE, Math.sqrt(2 * 0.6 * dist) + 0.5);
        if (dist < 1.5 && t.lastStop !== target.st.id) {
          t.state = 'wait';
          t.wait = 25;
          t.speed = 0;
          t.lastStop = target.st.id;
          events?.emit('train:arrive', target.st);
        }
      }
      t.speed += Math.max(-1.2, Math.min(0.5, desired - t.speed)) * dt * 2;
      t.s += t.speed * t.dir * dt;
      const tail = t.s - t.dir * this.trainLength;
      if ((t.dir > 0 && tail > L) || (t.dir < 0 && tail < 0)) {
        t.hidden = true;
        t.respawn = 45;
        t.lastStop = null;
      }
    }
    this.placeTrain();

    // level crossings: gates down while the train is within 260 m
    for (const c of this.crossings) {
      let near = false;
      if (!t.hidden) {
        for (const car of [this.cars[0], this.cars[this.cars.length - 1]]) {
          const p = car.mesh.position;
          if ((p.x - c.x) ** 2 + (p.z - c.z) ** 2 < 260 * 260) near = true;
        }
      }
      if (near && !c.closed) events?.emit('train:horn', { x: c.x, z: c.z });
      c.closed = near;
      c.arm += ((near ? 1 : 0) - c.arm) * Math.min(1, dt * 1.5);
      for (const a of c.arms) a.rotation.z = (1 - c.arm) * 1.35;
    }
  }

  /** Returns a car mesh if (x,z) is inside the moving train footprint. */
  hitTest(x, z, r = 0.5) {
    if (this.train.hidden) return null;
    for (const car of this.cars) {
      const p = car.mesh.position;
      const ang = car.mesh.rotation.y;
      const dx = x - p.x;
      const dz = z - p.z;
      const lx = dx * Math.cos(ang) - dz * Math.sin(ang);
      const lz = dx * Math.sin(ang) + dz * Math.cos(ang);
      if (Math.abs(lx) < 1.6 + r && Math.abs(lz) < car.len / 2 + r) return car;
    }
    return null;
  }
}

function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const r1x = bx - ax, r1z = bz - az, r2x = dx - cx, r2z = dz - cz;
  const den = r1x * r2z - r1z * r2x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((cx - ax) * r2z - (cz - az) * r2x) / den;
  const u = ((cx - ax) * r1z - (cz - az) * r1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + r1x * t, z: az + r1z * t };
}
