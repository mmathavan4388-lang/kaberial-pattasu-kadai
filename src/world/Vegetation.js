// Tree geometries (built once, instanced everywhere): palmyra palm (Tamil Nadu's
// state tree), neem, tamarind/banyan and roadside shrubs.
import * as THREE from 'three';
import { GeoBuilder } from './GeoBuilder.js';
import { mulberry32 } from '../core/utils.js';

const C = (h) => new THREE.Color(h);

function trunk(b, h, r0, r1, col, segs = 6, lean = 0) {
  const g = new THREE.CylinderGeometry(r1, r0, h, segs, 3, true);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + h / 2;
    pos.setX(i, pos.getX(i) + lean * (y / h) * (y / h));
  }
  g.computeVertexNormals();
  const m = new THREE.Matrix4().makeTranslation(0, h / 2, 0);
  b.geometry(g, m, col);
}

export function palmGeometry() {
  const b = new GeoBuilder();
  const rng = mulberry32(11);
  const H = 11;
  trunk(b, H, 0.32, 0.22, C('#5e5348'), 7, 0.4);
  // dead frond skirt
  const skirt = new THREE.ConeGeometry(0.9, 1.6, 7, 1, true);
  b.geometry(skirt, new THREE.Matrix4().makeTranslation(0.4, H - 0.6, 0), C('#6b5236'));
  // fan-shaped palmyra fronds
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rng() * 0.3;
    const tilt = 0.25 + rng() * 0.8;
    const fan = new THREE.CircleGeometry(1.5 + rng() * 0.5, 9, -0.9, 1.8);
    const m = new THREE.Matrix4()
      .makeTranslation(0.4, H + 0.2, 0)
      .multiply(new THREE.Matrix4().makeRotationY(a))
      .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + tilt))
      .multiply(new THREE.Matrix4().makeTranslation(0, 1.6, 0));
    const g = rng();
    b.geometry(fan, m, new THREE.Color().setHSL(0.24 + g * 0.05, 0.45, 0.2 + g * 0.1));
    // stalk
    b.geometry(new THREE.CylinderGeometry(0.03, 0.04, 1.2, 3), m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.2, 0)), C('#5b6b2a'));
  }
  return b.build();
}

function canopy(b, cx, cy, cz, r, rng, hue = 0.27, n = 6) {
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(r * (0.55 + rng() * 0.35), 1);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const s = 0.85 + rng() * 0.3;
      pos.setXYZ(k, pos.getX(k) * s, pos.getY(k) * s * 0.8, pos.getZ(k) * s);
    }
    g.computeVertexNormals();
    const a = rng() * Math.PI * 2;
    const d = r * 0.55 * rng();
    const m = new THREE.Matrix4().makeTranslation(cx + Math.cos(a) * d, cy + (rng() - 0.3) * r * 0.5, cz + Math.sin(a) * d);
    b.geometry(g, m, new THREE.Color().setHSL(hue + rng() * 0.05, 0.42 + rng() * 0.15, 0.2 + rng() * 0.1));
  }
}

export function neemGeometry() {
  const b = new GeoBuilder();
  const rng = mulberry32(21);
  trunk(b, 3.2, 0.28, 0.2, C('#4d4036'), 6, 0.3);
  // branches
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Matrix4()
      .makeTranslation(0.2, 3, 0)
      .multiply(new THREE.Matrix4().makeRotationY(i * 2.1))
      .multiply(new THREE.Matrix4().makeRotationZ(0.7))
      .multiply(new THREE.Matrix4().makeTranslation(0, 1, 0));
    b.geometry(new THREE.CylinderGeometry(0.08, 0.13, 2, 5), m, C('#4d4036'));
  }
  canopy(b, 0.2, 5.2, 0, 2.8, rng, 0.25, 7);
  return b.build();
}

export function tamarindGeometry() {
  const b = new GeoBuilder();
  const rng = mulberry32(31);
  trunk(b, 4, 0.55, 0.4, C('#3e342c'), 7, 0.5);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Matrix4()
      .makeTranslation(0.3, 3.8, 0)
      .multiply(new THREE.Matrix4().makeRotationY(i * 1.6))
      .multiply(new THREE.Matrix4().makeRotationZ(0.8))
      .multiply(new THREE.Matrix4().makeTranslation(0, 1.6, 0));
    b.geometry(new THREE.CylinderGeometry(0.15, 0.25, 3.2, 5), m, C('#3e342c'));
  }
  canopy(b, 0.3, 7, 0, 5, rng, 0.23, 9);
  return b.build();
}

export function shrubGeometry() {
  const b = new GeoBuilder();
  const rng = mulberry32(41);
  canopy(b, 0, 0.6, 0, 1.1, rng, 0.2, 4);
  return b.build();
}

export const TREE_TYPES = ['palm', 'neem', 'tamarind', 'shrub'];

/** Very cheap versions (~20-40 triangles) used for distant chunks. */
function lowTree(trunkH, trunkR, crownR, crownY, crownSquash, trunkCol, crownCol, palm = false) {
  const b = new GeoBuilder();
  b.geometry(new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 4, 1, true), new THREE.Matrix4().makeTranslation(0, trunkH / 2, 0), C(trunkCol));
  const crown = palm ? new THREE.OctahedronGeometry(crownR, 0) : new THREE.IcosahedronGeometry(crownR, 0);
  crown.scale(1, crownSquash, 1);
  b.geometry(crown, new THREE.Matrix4().makeTranslation(palm ? 0.4 : 0, crownY, 0), C(crownCol));
  return b.build();
}

export function buildLowTreeGeometries() {
  return {
    palm: lowTree(11, 0.3, 2.4, 11.2, 0.45, '#5e5348', '#3d5a26', true),
    neem: lowTree(3.2, 0.28, 3.2, 5.2, 0.75, '#4d4036', '#40612a'),
    tamarind: lowTree(4, 0.5, 5.2, 7, 0.7, '#3e342c', '#3a5a26'),
    shrub: lowTree(0.3, 0.1, 1.2, 0.6, 0.7, '#4d4036', '#50642e'),
  };
}

export function buildTreeGeometries() {
  return {
    palm: palmGeometry(),
    neem: neemGeometry(),
    tamarind: tamarindGeometry(),
    shrub: shrubGeometry(),
  };
}
