// Hand-authored (procedural) landmark sites of Sivakasi. Each landmark is a THREE.LOD:
// detailed merged meshes up close, a cheap textured block at distance.
import * as THREE from 'three';
import { LANDMARKS, HILL, terrainHeight } from './MapData.js';
import { GeoBuilder } from './GeoBuilder.js';
import { addFacadeBuilding, addDetails, FLOOR_H, TANK } from './ChunkBuilder.js';
import { ROW } from './Textures.js';
import { mulberry32 } from '../core/utils.js';

const C = (h) => new THREE.Color(h);
const BRIGHT = ['#e53935', '#1e88e5', '#43a047', '#fdd835', '#8e24aa', '#fb8c00', '#00acc1', '#f06292', '#ffffff'];

class SiteBuilder {
  constructor(lm, mats) {
    this.lm = lm;
    this.mats = mats;
    this.fb = new GeoBuilder();
    this.db = new GeoBuilder();
    this.sb = new GeoBuilder();
    this.lb = new GeoBuilder();
    this.metal = new GeoBuilder();
    this.lowB = new GeoBuilder();
    this.pb = new GeoBuilder();
    this.colliders = [];
    this.spots = [];
    this.parked = [];
    this.rng = mulberry32(lm.id.length * 7919 + Math.round(lm.x * 13 + lm.z));
    this.c = Math.cos(lm.rot);
    this.s = Math.sin(lm.rot);
    this.y = terrainHeight(lm.x, lm.z);
    this.base = new THREE.Matrix4().makeRotationY(lm.rot).setPosition(lm.x, this.y, lm.z);
    this.local();
  }

  world(lx, lz) {
    return { x: this.lm.x + lx * this.c + lz * this.s, z: this.lm.z - lx * this.s + lz * this.c };
  }

  local(lx = 0, ly = 0, lz = 0, lrot = 0) {
    const m = this.base.clone().multiply(new THREE.Matrix4().makeRotationY(lrot).setPosition(lx, ly, lz));
    for (const b of [this.db, this.sb, this.lb, this.metal]) b.setTransform(m);
    return this;
  }

  /** Paved forecourt / courtyard (textured) under the site. */
  pave(w, d, color, lx = 0, lz = 0) {
    this.pb.setTransform(this.base);
    const c = C(color);
    const x0 = lx - w / 2, x1 = lx + w / 2, z0 = lz - d / 2, z1 = lz + d / 2;
    this.pb.quad([x0, 0.03, z1], [x1, 0.03, z1], [x1, 0.03, z0], [x0, 0.03, z0], c, [0, 0, w / 3, d / 3]);
  }

  rect(lx, lz, w, d, lrot = 0, h = 6) {
    const p = this.world(lx, lz);
    const r = this.lm.rot + lrot;
    this.colliders.push({ type: 'rect', x: p.x, z: p.z, hw: w / 2, hd: d / 2, c: Math.cos(r), s: Math.sin(r), h });
  }

  circle(lx, lz, r) {
    const p = this.world(lx, lz);
    this.colliders.push({ type: 'circle', x: p.x, z: p.z, r });
  }

  box(lx, ly, lz, sx, sy, sz, col, collide = false) {
    this.db.box(lx, ly, lz, sx, sy, sz, typeof col === 'string' ? C(col) : col);
    if (collide) this.rect(lx, lz, sx, sz, 0, ly + sy / 2);
  }

  /** Textured building (reuses the city facade system). */
  building(lx, lz, lrot, props, collide = true) {
    const p = this.world(lx, lz);
    const b = {
      kind: 'house', w: 10, d: 10, floors: 2, paint: '#f5f0e1', shop: false, open: true,
      winRow: ROW.WIN_A, sign: -1, awning: null, tank: true, stair: false, roof: 'flat', balcony: false,
      ...props,
      x: p.x, z: p.z, rot: this.lm.rot + lrot,
    };
    b.h = b.floors * FLOOR_H;
    addFacadeBuilding(this.fb, b, this.mats.factory.size, false);
    addDetails(this.db, this.sb, this.lb, b, this.mats, this.rng);
    const low = { ...b };
    addFacadeBuilding(this.lowB, low, this.mats.factory.size, true);
    this.local();
    if (collide) this.rect(lx, lz, b.w, b.d, lrot, b.h + 1);
    return b;
  }

  sign(key, lx, ly, lz, w, h, lrot = 0) {
    this.local(lx, ly, lz, lrot);
    const uv = this.mats.signUV(key);
    this.sb.quad([-w / 2, 0, 0], [w / 2, 0, 0], [w / 2, h, 0], [-w / 2, h, 0], C('#fff'), uv);
    this.db.box(0, h / 2, -0.06, w + 0.15, h + 0.15, 0.1, C('#2b2b2b'));
    this.local();
  }

  cyl(lx, ly, lz, rTop, rBot, h, col, segs = 8, collide = false) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, segs);
    this.db.geometry(g, new THREE.Matrix4().makeTranslation(lx, ly + h / 2, lz), C(col));
    if (collide) this.circle(lx, lz, Math.max(rTop, rBot));
  }

  cone(lx, ly, lz, r, h, col, segs = 8) {
    const g = new THREE.ConeGeometry(r, h, segs);
    this.db.geometry(g, new THREE.Matrix4().makeTranslation(lx, ly + h / 2, lz), C(col));
  }

  spot(lx, lz, role, facing = 0) {
    const p = this.world(lx, lz);
    this.spots.push({ x: p.x, z: p.z, role, rot: this.lm.rot + facing, site: this.lm.id });
  }

  park(type, lx, lz, lrot = 0) {
    const p = this.world(lx, lz);
    this.parked.push({ type, x: p.x, z: p.z, rot: this.lm.rot + lrot });
  }

  lowBox(lx, lz, w, d, h, paint = '#e8e0d0', row = ROW.PLAIN) {
    const p = this.world(lx, lz);
    addFacadeBuilding(this.lowB, { kind: [ROW.SHOP, ROW.WIN_A, ROW.WIN_B].includes(row) ? 'house' : 'shed', x: p.x, z: p.z, rot: this.lm.rot, w, d, h, floors: Math.max(1, Math.round(h / FLOOR_H)), paint, roof: 'none', winRow: row }, this.mats.factory.size, true);
  }

  /** Red & white striped temple compound wall with an opening at the front. */
  templeWall(w, d, h, gap) {
    const red = C('#b3261e');
    const white = C('#f3ede2');
    const seg = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 1.4));
      const dx = (x1 - x0) / n;
      const dz = (z1 - z0) / n;
      for (let i = 0; i < n; i++) {
        const cx = x0 + dx * (i + 0.5);
        const cz = z0 + dz * (i + 0.5);
        const horizontal = Math.abs(dx) > Math.abs(dz);
        this.db.box(cx, h / 2, cz, horizontal ? Math.abs(dx) : 0.9, h, horizontal ? 0.9 : Math.abs(dz), i % 2 ? red : white);
      }
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const horizontal = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      this.rect(cx, cz, horizontal ? len : 1, horizontal ? 1 : len, 0, h);
    };
    seg(-w / 2, -d / 2, w / 2, -d / 2);
    seg(-w / 2, -d / 2, -w / 2, d / 2);
    seg(w / 2, -d / 2, w / 2, d / 2);
    seg(-w / 2, d / 2, -gap / 2, d / 2);
    seg(gap / 2, d / 2, w / 2, d / 2);
  }

  /** Dravidian gopuram (tiered temple tower) centred at local (lx, lz). */
  gopuram(lx, lz, baseW, baseD, tiers, withSign = null) {
    const granite = C('#9a948a');
    const bh = baseW * 0.45;
    const door = baseW * 0.25;
    this.db.box(lx - (baseW / 2 + door / 2) / 2, bh / 2, lz, baseW / 2 - door / 2, bh, baseD, granite);
    this.db.box(lx + (baseW / 2 + door / 2) / 2, bh / 2, lz, baseW / 2 - door / 2, bh, baseD, granite);
    this.db.box(lx, bh * 0.85, lz, door, bh * 0.3, baseD, granite);
    this.rect(lx - (baseW / 2 + door / 2) / 2, lz, baseW / 2 - door / 2, baseD, 0, bh);
    this.rect(lx + (baseW / 2 + door / 2) / 2, lz, baseW / 2 - door / 2, baseD, 0, bh);
    let y = bh;
    let w = baseW * 0.95;
    let d = baseD * 0.9;
    const th = baseW * 0.16;
    for (let t = 0; t < tiers; t++) {
      const base = C(t % 2 ? '#f1e3c6' : '#e9d4ad');
      this.db.box(lx, y + th / 2, lz, w, th, d, base);
      this.db.box(lx, y + th - 0.1, lz, w + 0.5, 0.25, d + 0.5, C('#c9a66b')); // cornice
      // painted sculptures on front & back
      const n = Math.max(3, Math.round(w / 1.3));
      for (let i = 0; i < n; i++) {
        const sx = lx - w / 2 + (i + 0.5) * (w / n);
        const col = C(BRIGHT[Math.floor(this.rng() * BRIGHT.length)]);
        const sh = th * (0.45 + this.rng() * 0.3);
        this.db.box(sx, y + th * 0.25 + sh / 2, lz + d / 2 + 0.2, w / n * 0.6, sh, 0.4, col);
        this.db.box(sx, y + th * 0.25 + sh / 2, lz - d / 2 - 0.2, w / n * 0.6, sh, 0.4, col);
      }
      for (let i = 0; i < Math.max(2, Math.round(d / 1.6)); i++) {
        const sz = lz - d / 2 + (i + 0.5) * (d / Math.max(2, Math.round(d / 1.6)));
        const col = C(BRIGHT[Math.floor(this.rng() * BRIGHT.length)]);
        this.db.box(lx + w / 2 + 0.2, y + th * 0.5, sz, 0.4, th * 0.5, d / 4, col);
        this.db.box(lx - w / 2 - 0.2, y + th * 0.5, sz, 0.4, th * 0.5, d / 4, col);
      }
      y += th;
      w *= 0.86;
      d *= 0.8;
    }
    // barrel vault (sala) and golden kalasams
    const vault = new THREE.CylinderGeometry(d * 0.7, d * 0.7, w, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
    this.db.geometry(vault, new THREE.Matrix4().makeTranslation(lx, y, lz), C('#e57373'));
    const k = Math.max(3, Math.round(w / 1.6));
    for (let i = 0; i < k; i++) {
      this.metal.geometry(new THREE.ConeGeometry(0.28, 1.4, 8), new THREE.Matrix4().makeTranslation(lx - w / 2 + (i + 0.5) * (w / k), y + d * 0.7 + 0.6, lz), C('#d4a017'));
    }
    if (withSign) this.sign(withSign, lx, bh + 0.4, lz + baseD / 2 + 0.6, Math.min(baseW * 0.8, 12), 1.3);
    return y + d;
  }

  /** Pillared mandapam hall. */
  mandapam(lx, lz, w, d, h, col = '#b0a898') {
    const nx = Math.max(2, Math.round(w / 3.5));
    const nz = Math.max(2, Math.round(d / 3.5));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const px = lx - w / 2 + 0.5 + (i * (w - 1)) / (nx - 1);
        const pz = lz - d / 2 + 0.5 + (j * (d - 1)) / (nz - 1);
        this.db.box(px, h / 2, pz, 0.55, h, 0.55, C(col));
        this.circle(px, pz, 0.35);
      }
    }
    this.db.box(lx, h + 0.25, lz, w + 0.8, 0.5, d + 0.8, C(col));
    this.db.box(lx, 0.2, lz, w + 0.6, 0.4, d + 0.6, C('#8d877c'));
  }

  vimana(lx, lz, size, tiers, col = '#a8a092') {
    this.db.box(lx, size * 0.4, lz, size, size * 0.8, size, C(col));
    this.rect(lx, lz, size, size, 0, size);
    let y = size * 0.8;
    let s = size * 0.9;
    for (let t = 0; t < tiers; t++) {
      this.db.box(lx, y + s * 0.2, lz, s, s * 0.4, s, C(t % 2 ? '#efe0c0' : '#e2cfa6'));
      y += s * 0.4;
      s *= 0.75;
    }
    this.metal.geometry(new THREE.SphereGeometry(s * 0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.Matrix4().makeTranslation(lx, y, lz), C('#d4a017'));
    this.metal.geometry(new THREE.ConeGeometry(0.25, 1.2, 8), new THREE.Matrix4().makeTranslation(lx, y + s * 0.7 + 0.5, lz), C('#d4a017'));
  }

  finish(castShadow) {
    const high = new THREE.Group();
    const add = (b, mat, shadow = true) => {
      if (!b.vertexCount) return;
      const m = new THREE.Mesh(b.build(), mat);
      m.castShadow = shadow && castShadow;
      m.receiveShadow = true;
      high.add(m);
    };
    add(this.pb, this.mats.sidewalk, false);
    add(this.fb, this.mats.facade);
    add(this.db, this.mats.detail);
    add(this.metal, this.mats.metal);
    add(this.sb, this.mats.signs, false);
    add(this.lb, this.mats.lamp, false);
    const lod = new THREE.LOD();
    lod.addLevel(high, 0);
    if (this.lowB.vertexCount) {
      const low = new THREE.Mesh(this.lowB.build(), this.mats.facadeLow);
      low.receiveShadow = true;
      lod.addLevel(low, 260);
    } else {
      lod.addLevel(new THREE.Group(), 320);
    }
    // LOD distance is measured from the object's position, so pivot at the site
    lod.position.set(this.lm.x, 0, this.lm.z);
    for (const lvl of lod.levels) lvl.object.position.set(-this.lm.x, 0, -this.lm.z);
    lod.userData.id = this.lm.id;
    return lod;
  }
}

// ---------------------------------------------------------------- per-site recipes
const RECIPES = {
  temple(S) {
    S.templeWall(64, 64, 4.2, 6);
    const top = S.gopuram(0, 32, 16, 11, 7, 'lm_temple');
    S.vimana(0, -12, 10, 3);
    S.mandapam(0, 6, 12, 14, 4.2);
    S.cyl(0, 0, 16, 0.18, 0.28, 11, '#d4a017'); // kodimaram (flag post)
    S.circle(0, 16, 0.4);
    S.box(0, 0.4, 20, 2.6, 0.8, 2.6, '#8d877c', true); // balipeedam
    // temple tank-side lamps & flower stalls outside the gate
    for (const x of [-14, -10, 10, 14]) {
      S.box(x, 1, 36.5, 2.6, 0.9, 1.6, '#6d4c41', true);
      S.box(x, 1.55, 36.5, 2.4, 0.2, 1.4, x < 0 ? '#ff8f00' : '#fff59d'); // marigold & jasmine
      S.spot(x, 38.2, 'shop_owner', Math.PI);
    }
    for (let i = 0; i < 6; i++) S.spot(-6 + i * 2.4, 40, 'devotee', Math.PI);
    for (let i = 0; i < 4; i++) S.spot(-4 + i * 2.6, 12, 'devotee', Math.PI);
    S.spot(0, -4, 'priest', 0);
    S.lowBox(0, 0, 64, 64, 4.2, '#e9dcc7');
    S.lowBox(0, 32, 16, 11, top, '#e2cfa6');
  },

  busstand(S) {
    // platform + canopy
    S.box(0, 0.15, 0, 92, 0.3, 11, '#9e9a92');
    for (let x = -44; x <= 44; x += 11) {
      S.box(x, 3, -4.5, 0.5, 6, 0.5, '#d6d0c4');
      S.box(x, 3, 4.5, 0.5, 6, 0.5, '#d6d0c4');
      S.circle(x, -4.5, 0.4);
      S.circle(x, 4.5, 0.4);
    }
    S.box(0, 6.2, 0, 94, 0.5, 13, '#cfc6b4');
    S.box(0, 6.8, 6.4, 94, 0.7, 0.2, '#1565c0');
    S.box(0, 6.8, -6.4, 94, 0.7, 0.2, '#1565c0');
    for (let x = -40; x <= 40; x += 8) S.box(x, 0.75, 0, 2.2, 0.45, 0.6, '#5d4037'); // benches
    S.sign('lm_busstand', 0, 7.2, 6.6, 18, 2.2);
    S.sign('route0', -30, 5.2, 4.8, 5, 0.8);
    S.sign('route1', -15, 5.2, 4.8, 5, 0.8);
    S.sign('route2', 15, 5.2, 4.8, 5, 0.8);
    S.sign('route3', 30, 5.2, 4.8, 5, 0.8);
    // shop row along the back
    for (let i = 0; i < 9; i++) {
      S.building(-44 + i * 10 + 5, -36, 0, { kind: 'shop', w: 9.6, d: 7, floors: 2, paint: ['#fff3c4', '#d7f0ff', '#ffe0e0', '#e6ffd9'][i % 4], shop: true, open: i % 3 !== 1, sign: (i * 5) % 32, awning: ['#1e5bb8', '#2e8b57', '#d9552b'][i % 3], tank: i % 2 === 0 });
      S.spot(-44 + i * 10 + 5, -31.4, 'shop_owner', 0);
    }
    // tea stall (Kannan Tea Stall) at the south-east corner
    S.box(48, 1.2, 36.8, 5, 2.4, 0.6, '#4e342e', true);
    S.box(45.7, 1.2, 38.4, 0.4, 2.4, 3.2, '#4e342e', true);
    S.box(50.3, 1.2, 38.4, 0.4, 2.4, 3.2, '#4e342e', true);
    S.box(48, 0.55, 39.8, 4.2, 1.1, 0.6, '#795548', true);
    for (let i = 0; i < 5; i++) S.cyl(46.2 + i * 0.9, 1.1, 39.8, 0.14, 0.14, 0.35, '#e0f2f1', 8);
    S.box(48, 2.7, 38.8, 5.6, 0.12, 4.6, '#2e7d32');
    S.sign('tea_board', 48, 2.85, 41.2, 5, 1, 0);
    S.box(44, 0.45, 42, 3, 0.1, 0.6, '#8d6e63');
    S.spot(48, 38.6, 'tea_master', 0);
    S.spot(44.5, 43, 'customer', Math.PI);
    S.spot(46.5, 43.3, 'customer', Math.PI);
    // passengers & parked buses
    for (let i = 0; i < 10; i++) S.spot(-40 + i * 9, (i % 2 ? 2.5 : -2.5), 'passenger', i % 2 ? 0 : Math.PI);
    S.park('bus', -28, 14, Math.PI / 2);
    S.park('bus', 8, 14, Math.PI / 2);
    S.park('bus', -10, -14, -Math.PI / 2);
    S.park('bus', 26, -14, -Math.PI / 2);
    S.park('auto', 40, 30, 0.3);
    S.park('auto', 36, 30, 0.2);
    S.lowBox(0, 0, 94, 13, 6.5, '#cfc6b4');
    S.lowBox(0, -36, 90, 7, 6.4, '#fff3c4', ROW.SHOP);
  },

  market(S) {
    S.sign('lm_market', 0, 4.2, 34, 12, 1.8);
    S.box(-6.5, 2.6, 34, 0.5, 5.2, 0.5, '#8d6e63');
    S.box(6.5, 2.6, 34, 0.5, 5.2, 0.5, '#8d6e63');
    const goods = ['#e53935', '#ff9800', '#8bc34a', '#fdd835', '#6d4c41', '#7cb342', '#ab47bc', '#ffffff'];
    for (let r = 0; r < 4; r++) {
      for (let i = 0; i < 6; i++) {
        const x = -30 + i * 12;
        const z = 22 - r * 12;
        S.box(x, 0.45, z, 4, 0.9, 2, '#795548', true);
        for (let g = 0; g < 6; g++) {
          const col = goods[Math.floor(S.rng() * goods.length)];
          S.box(x - 1.5 + (g % 3) * 1.5, 1.05, z - 0.45 + Math.floor(g / 3) * 0.9, 1.2, 0.3, 0.7, col);
        }
        const tarp = C(['#1e5bb8', '#2e8b57', '#d9552b', '#e0b000'][(r + i) % 4]);
        S.local(x, 0, z);
        S.db.quad([-2.6, 2.4, 1.8], [2.6, 2.4, 1.8], [2.6, 2.9, -1.4], [-2.6, 2.9, -1.4], tarp);
        S.db.quad([2.6, 2.4, 1.8], [-2.6, 2.4, 1.8], [-2.6, 2.89, -1.4], [2.6, 2.89, -1.4], tarp.clone().multiplyScalar(0.5));
        S.local();
        for (const [px, pz] of [[-2.4, 1.6], [2.4, 1.6], [-2.4, -1.3], [2.4, -1.3]]) S.box(x + px, 1.3, z + pz, 0.08, 2.6, 0.08, '#555');
        S.spot(x, z - 1.8, 'vendor', 0);
        if (i % 2 === 0) S.spot(x + 1, z + 3.2, 'shopper', Math.PI);
      }
    }
    // covered wholesale shed at the back
    S.mandapam(0, -24, 50, 16, 5, '#9aa3ab');
    S.lowBox(0, 0, 70, 60, 3, '#b08d6a');
  },

  police(S) {
    S.building(0, -4, 0, { kind: 'house', w: 30, d: 14, floors: 2, paint: '#f1e4c6', winRow: ROW.WIN_A, tank: true });
    S.sign('lm_police_board', 0, 3.5, 3.2, 10, 1.6);
    S.sign('lm_police', 0, 6.8, 3.15, 14, 1.4);
    S.box(-12, 0.8, 9.5, 8, 1.6, 0.4, '#c62828', true);
    S.box(12, 0.8, 9.5, 8, 1.6, 0.4, '#c62828', true);
    S.cyl(-8, 0, 7, 0.06, 0.08, 9, '#dddddd');
    S.spot(-3, 9.5, 'police', 0);
    S.spot(3, 9.5, 'police', 0);
    S.spot(0, 4.2, 'police', 0);
    S.park('police', 8, 6.5, Math.PI / 2);
  },

  hospital(S) {
    S.building(0, -3, 0, { kind: 'house', w: 64, d: 16, floors: 3, paint: '#f4f6f0', winRow: ROW.WIN_B, tank: true, stair: true });
    S.box(0, 3.4, 8, 12, 0.3, 6, '#e0e0e0');
    for (const x of [-5.5, 5.5]) { S.box(x, 1.7, 10.6, 0.4, 3.4, 0.4, '#e0e0e0'); S.circle(x, 10.6, 0.3); }
    S.sign('lm_hospital', 0, 3.6, 11.1, 14, 1.6);
    S.sign('lm_hospital_cross', 0, 7.2, 5.15, 4, 2.4);
    for (let i = 0; i < 6; i++) S.spot(-10 + i * 4, 8 + (i % 2), i < 2 ? 'doctor' : i < 4 ? 'nurse' : 'patient', 0);
    S.park('ambulance', 16, 9, Math.PI / 2);
  },

  firestation(S) {
    S.building(0, -1, 0, { kind: 'shop', w: 30, d: 16, floors: 2, paint: '#ef5350', shop: true, open: false, winRow: ROW.WIN_A, tank: false, sign: -1 });
    S.sign('lm_firestation', 0, 3.3, 7.2, 16, 1.5);
    S.cyl(-13, 0, 9, 1.2, 1.2, 0.1, '#9e9e9e');
    S.spot(-6, 9, 'firefighter', 0);
    S.spot(6, 9, 'firefighter', 0);
    S.park('fire', 0, 10.2, Math.PI / 2);
  },

  press(S) {
    S.building(0, -2, 0, { kind: 'press', w: 40, d: 18, floors: 3, paint: '#dfe8f2', shop: true, open: true, winRow: ROW.WIN_B, sign: -1, awning: null });
    S.sign('lm_press', 0, 3.3, 7.25, 16, 1.4);
    for (let i = 0; i < 6; i++) S.box(-16 + i * 1.3, 0.4 + (i % 2) * 0.8, 9.5, 1.1, 0.8, 1.1, '#a1887f', i === 0);
    S.spot(-12, 9, 'factory_worker', 0);
    S.spot(-8, 10, 'factory_worker', Math.PI / 2);
    S.spot(8, 8.5, 'business_owner', 0);
    S.park('delivery', 14, 11, Math.PI / 2);
  },

  fireworks(S) {
    const brick = '#a4553a';
    const W = 130, D = 100;
    const wall = (x0, z0, x1, z1) => {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const w = Math.abs(x1 - x0) || 0.5, d = Math.abs(z1 - z0) || 0.5;
      S.box(cx, 1.3, cz, w, 2.6, d, brick, true);
    };
    wall(-W / 2, -D / 2, W / 2, -D / 2);
    wall(-W / 2, -D / 2, -W / 2, D / 2);
    wall(W / 2, -D / 2, W / 2, D / 2);
    wall(-W / 2, D / 2, -6, D / 2);
    wall(6, D / 2, W / 2, D / 2);
    S.sign('lm_fireworks', 0, 3, D / 2 + 0.4, 18, 1.8);
    S.sign('warn_smoke', -12, 2.6, D / 2 + 0.4, 4.5, 1.2);
    S.sign('warn_danger', 12, 2.6, D / 2 + 0.4, 5.5, 1.2);
    S.building(-40, 36, 0, { kind: 'house', w: 16, d: 9, floors: 1, paint: '#fff8e1', roof: 'flat', tank: true });
    S.spot(-40, 42, 'business_owner', 0);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 4; j++) {
        const x = -45 + i * 18;
        const z = 16 - j * 18;
        S.building(x, z, 0, { kind: 'unit', w: 6, d: 5, floors: 1, paint: '#ffffff', roof: 'shed', tank: false });
        S.box(x, 0.45, z + 5, 5, 0.9, 1.2, '#c9a66b');
        if ((i + j) % 3 === 0) S.spot(x + 2, z + 3.6, 'factory_worker', 0);
      }
    }
    S.cyl(50, 0, -40, 1.4, 1.4, 2.4, '#1a1a1a');
    S.box(50, 5, -40, 0.3, 10, 0.3, '#777');
    S.lowBox(0, 0, W, D, 2.6, '#a4553a', ROW.BRICK);
  },

  matchworks(S) {
    S.building(0, -8, 0, { kind: 'shed', w: 60, d: 12, floors: 1, paint: '#cfd8dc', roof: 'shed' });
    S.building(-8, 12, 0, { kind: 'house', w: 18, d: 9, floors: 2, paint: '#fff3e0', roof: 'flat' });
    S.sign('lm_matchworks', -8, 3.4, 16.7, 14, 1.4);
    for (let r = 0; r < 5; r++) S.box(18, 0.9, 6 + r * 2.4, 16, 0.08, 1.2, '#d7b98e'); // splint drying racks
    for (let i = 0; i < 5; i++) S.spot(12 + i * 3, 5 + (i % 2) * 5, 'factory_worker', Math.PI / 2);
    S.spot(-8, 18, 'business_owner', 0);
  },

  hilltemple(S) {
    // temple on the summit (site origin sits at hill top height)
    S.local();
    S.vimana(0, -3, 8, 3, '#b8ae9c');
    S.mandapam(0, 6, 8, 8, 3.6);
    S.cyl(0, 0, 12, 0.14, 0.2, 8, '#d4a017');
    S.spot(2, 12, 'priest', Math.PI);
    S.spot(-2, 14, 'devotee', Math.PI);
    // stone steps down the east face
    const stepCol = C('#9e9588');
    for (let d = 14; d < HILL.r + 2; d += 1.2) {
      const wx = S.lm.x + d; // rot = PI/2 => local +z is world +x
      const h = terrainHeight(wx, S.lm.z) - S.y;
      S.db.box(0, h + 0.15, d, 3.5, 0.3 + 0.4, 1.2, stepCol);
      if (Math.round(d) % 12 === 0) {
        S.db.box(2.2, h + 1.2, d, 0.15, 2.4, 0.15, C('#555'));
        S.lb.box(2.2, h + 2.4, d, 0.3, 0.15, 0.3, C('#fff'));
      }
    }
    S.lowBox(0, 0, 10, 16, 8, '#b8ae9c');
  },

  school(S) {
    S.building(0, -2, 0, { kind: 'house', w: 56, d: 12, floors: 2, paint: '#f6d77a', winRow: ROW.WIN_A, tank: true });
    S.sign('lm_school', 0, 3.3, 4.2, 16, 1.5);
    S.box(-18, 0.9, 9, 20, 1.8, 0.4, '#e0c060', true);
    S.box(18, 0.9, 9, 20, 1.8, 0.4, '#e0c060', true);
    S.cyl(0, 0, 7, 0.06, 0.08, 8, '#dddddd');
    for (let i = 0; i < 8; i++) S.spot(-12 + i * 3.5, 6 + (i % 3), 'student', Math.PI);
    S.spot(0, 5, 'teacher', 0);
  },

  mechanic(S) {
    S.building(0, -1, 0, { kind: 'shop', w: 16, d: 9, floors: 1, paint: '#b0bec5', shop: true, open: true, sign: -1, awning: '#1e5bb8', tank: false });
    S.sign('lm_mechanic', 0, 3.3, 3.65, 12, 1.3);
    for (let i = 0; i < 4; i++) {
      const g = new THREE.TorusGeometry(0.34, 0.12, 6, 12).rotateX(Math.PI / 2);
      S.db.geometry(g, new THREE.Matrix4().makeTranslation(-7, 0.15 + i * 0.25, 5), C('#151515'));
    }
    S.circle(-7, 5, 0.5);
    S.spot(2, 5, 'mechanic', 0);
    S.park('bike', 4, 6, 0.5);
    S.park('scooter', -2, 6.5, -0.4);
  },

  hotel(S) {
    S.building(0, -1, 0, { kind: 'shop', w: 20, d: 12, floors: 2, paint: '#fff9c4', shop: true, open: true, sign: -1, awning: '#c62828' });
    S.sign('lm_hotel', 0, 3.3, 5.15, 14, 1.4);
    S.spot(-4, 6.4, 'shop_owner', 0);
    S.spot(3, 7.5, 'customer', Math.PI);
  },

  home(S) {
    S.building(0, 0, 0, { kind: 'house', w: 12, d: 10, floors: 2, paint: '#c8e6f5', winRow: ROW.WIN_A, balcony: true, tank: true });
    S.box(-6.5, 0.6, 7, 0.3, 1.2, 4, '#ffffff', true);
    S.box(6.5, 0.6, 7, 0.3, 1.2, 4, '#ffffff', true);
    S.cyl(4.5, 0, 6.5, 0.3, 0.35, 0.8, '#8d6e63');  // tulsi maadam
    S.cone(4.5, 0.8, 6.5, 0.35, 0.6, '#4caf50', 6);
    S.spot(-2, 6, 'amma', 0);
  },

  shrine(S) {
    S.vimana(0, 0, 5, 2, '#fce4ec');
    S.box(0, 0.2, 4.5, 6, 0.4, 3, '#bcaaa4');
    S.cyl(2.5, 0, 5, 0.05, 0.05, 3, '#9e9e9e');
    S.cone(2.5, 3, 5, 0.25, 0.5, '#9e9e9e', 3);
    S.spot(0, 7, 'devotee', Math.PI);
    S.lowBox(0, 0, 5, 5, 5, '#fce4ec');
  },
};

const PAVING = {
  temple: '#c9bfae', busstand: '#b3aca0', market: '#a99d8a', police: '#b8b1a4', hospital: '#c4c0b6', firestation: '#b8b1a4',
  press: '#aea79a', school: '#c2ae8a', mechanic: '#8f8a80', hotel: '#b3aca0', home: '#cfc3b0', shrine: '#c9bfae', matchworks: '#b59c80',
};

// extra paving [width, depth, z offset] so forecourts reach the road
const PAVE_EXTRA = { busstand: [28, 26, 13], temple: [16, 40, 20], hospital: [10, 24, 12], police: [6, 14, 7], firestation: [6, 14, 7], school: [6, 14, 7], press: [4, 14, 7], hotel: [0, 8, 4], mechanic: [0, 8, 4], home: [2, 6, 3] };

export function buildLandmarks(mats, castShadow) {
  const group = new THREE.Group();
  const colliders = [];
  const spots = [];
  const parked = [];
  for (const lm of LANDMARKS) {
    const S = new SiteBuilder(lm, mats);
    const paveCol = PAVING[lm.type];
    if (paveCol) {
      const ext = PAVE_EXTRA[lm.type] || [0, 0, 0];
      S.pave(lm.w + ext[0], lm.d + ext[1], paveCol, 0, ext[2]);
    }
    RECIPES[lm.type]?.(S);
    const lod = S.finish(castShadow);
    group.add(lod);
    colliders.push(...S.colliders);
    spots.push(...S.spots);
    parked.push(...S.parked);
  }
  return { group, colliders, spots, parked };
}
