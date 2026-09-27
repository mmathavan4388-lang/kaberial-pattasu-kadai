// Procedural, fully rigged human. Every character (hero or NPC) is ONE SkinnedMesh:
// body, face, hair, clothes and accessories are merged into a single geometry with
// per-vertex colours + skin weights, sharing one material with the face atlas.
// => 1 draw call per character, smooth GPU skinning, lots of visual variety.
import * as THREE from 'three';
import { GeoBuilder } from '../world/GeoBuilder.js';
import { clamp, smoothstep } from '../core/utils.js';

// name, parent, bind position (model space, 1.75 m reference body, facing +z)
export const BONE_DEFS = [
  ['hips', null, [0, 0.98, 0]],
  ['spine', 'hips', [0, 1.1, 0]],
  ['chest', 'spine', [0, 1.3, 0]],
  ['neck', 'chest', [0, 1.5, 0]],
  ['head', 'neck', [0, 1.62, 0]],
  ['upperArmL', 'chest', [0.19, 1.44, 0]],
  ['foreArmL', 'upperArmL', [0.212, 1.155, 0]],
  ['handL', 'foreArmL', [0.228, 0.915, 0.01]],
  ['upperArmR', 'chest', [-0.19, 1.44, 0]],
  ['foreArmR', 'upperArmR', [-0.212, 1.155, 0]],
  ['handR', 'foreArmR', [-0.228, 0.915, 0.01]],
  ['thighL', 'hips', [0.095, 0.94, 0]],
  ['shinL', 'thighL', [0.1, 0.52, 0]],
  ['footL', 'shinL', [0.1, 0.09, 0]],
  ['thighR', 'hips', [-0.095, 0.94, 0]],
  ['shinR', 'thighR', [-0.1, 0.52, 0]],
  ['footR', 'shinR', [-0.1, 0.09, 0]],
];
export const BI = Object.fromEntries(BONE_DEFS.map((b, i) => [b[0], i]));
const BP = Object.fromEntries(BONE_DEFS.map((b) => [b[0], new THREE.Vector3(...b[2])]));
const HEAD_C = new THREE.Vector3(0, 1.702, 0.012);
const HEAD_R = 0.105;

const col = (h) => new THREE.Color(h);
const gauss = (d, s) => Math.exp(-(d * d) / (2 * s * s));

let sharedMaterial = null;
export function characterMaterial(faceTexture) {
  if (!sharedMaterial) {
    sharedMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: faceTexture, roughness: 0.62, metalness: 0.0 });
  }
  return sharedMaterial;
}

class SkinWriter {
  constructor() {
    this.si = [];
    this.sw = [];
    this.fn = () => [[0, 1]];
  }
  onVertex(b) {
    const n = b.pos.length;
    const w = this.fn(b.pos[n - 3], b.pos[n - 2], b.pos[n - 1]);
    this.si.push(w[0][0], w[1] ? w[1][0] : 0, 0, 0);
    this.sw.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
  }
  finish(g) {
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
  }
}

// ------------------------------------------------------------------ weights
const rigid = (name) => () => [[BI[name], 1]];

function limbWeights(self, parent, joint, dir, blend) {
  const si = BI[self];
  const pi = BI[parent];
  return (x, y, z) => {
    const t = (x - joint.x) * dir.x + (y - joint.y) * dir.y + (z - joint.z) * dir.z;
    const w = clamp(0.5 + (0.5 * t) / blend, 0, 1);
    return w >= 0.999 ? [[si, 1]] : [[si, w], [pi, 1 - w]];
  };
}

function torsoWeights(x, y) {
  const H = BI.hips, S = BI.spine, C = BI.chest, N = BI.neck;
  if (y < 1.0) return [[H, 1]];
  if (y < 1.1) { const w = (y - 1.0) / 0.1; return [[S, w], [H, 1 - w]]; }
  if (y < 1.2) return [[S, 1]];
  if (y < 1.3) { const w = (y - 1.2) / 0.1; return [[C, w], [S, 1 - w]]; }
  if (y < 1.49) return [[C, 1]];
  const w = clamp((y - 1.49) / 0.06, 0, 1);
  return [[N, w], [C, 1 - w]];
}

// ------------------------------------------------------------------ helpers
function colorize(g, fn) {
  const p = g.attributes.position;
  const arr = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(p.getX(i), p.getY(i), p.getZ(i), c);
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Tapered capsule between two points. */
function limb(p0, p1, r0, r1, radial = 10) {
  const len = p0.distanceTo(p1);
  const g = new THREE.CapsuleGeometry(1, len, 4, radial);
  const pos = g.attributes.position;
  const half = len / 2 + 1;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    // y in [-len/2-1, len/2+1] in units where radius = 1 for caps; remap radius
    const t = clamp((y + len / 2) / len, 0, 1); // 0 at p0 end, 1 at p1 end
    const r = r0 + (r1 - r0) * t;
    const capY = y > len / 2 ? len / 2 + (y - len / 2) * r : y < -len / 2 ? -len / 2 + (y + len / 2) * r : y;
    pos.setXYZ(i, pos.getX(i) * r, capY, pos.getZ(i) * r);
  }
  void half;
  g.computeVertexNormals();
  const dir = new THREE.Vector3().subVectors(p1, p0).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  // capsule +y end maps to p1
  const m = new THREE.Matrix4().compose(new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

function sphere(r, sx, sy, sz, at, ws = 10, hs = 8) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(sx, sy, sz);
  g.translate(at.x, at.y, at.z);
  return g;
}

function boxAt(w, h, d, at, rot = null) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rot) g.rotateX(rot.x || 0).rotateY(rot.y || 0).rotateZ(rot.z || 0);
  g.translate(at.x, at.y, at.z);
  return g;
}

/** Thin strip (cloth band / chain) through a list of points, double sided. */
function strip(points, width, thickness = 0.006) {
  const b = new GeoBuilder();
  const white = new THREE.Color(1, 1, 1);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const c = points[i + 1];
    const dir = new THREE.Vector3().subVectors(c, a);
    const len = dir.length();
    dir.normalize();
    const mid = new THREE.Vector3().addVectors(a, c).multiplyScalar(0.5);
    // outward normal ~ away from the body axis
    const out = new THREE.Vector3(mid.x, 0, mid.z).normalize();
    const side = new THREE.Vector3().crossVectors(dir, out).normalize();
    const nrm = new THREE.Vector3().crossVectors(side, dir).normalize();
    const m = new THREE.Matrix4().makeBasis(side, dir, nrm).setPosition(mid);
    b.setTransform(m);
    b.box(0, 0, 0, width, len + thickness, thickness, white);
  }
  return b.build();
}

/** Keep only triangles whose vertices pass `keep`, then drop unused vertices. */
function filterTriangles(g, keep) {
  const pos = g.attributes.position;
  const idx = g.index.array;
  const tris = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    if (keep(pos.getX(a), pos.getY(a), pos.getZ(a)) && keep(pos.getX(b), pos.getY(b), pos.getZ(b)) && keep(pos.getX(c), pos.getY(c), pos.getZ(c))) tris.push(a, b, c);
  }
  const remap = new Map();
  const out = new THREE.BufferGeometry();
  const names = Object.keys(g.attributes);
  const data = Object.fromEntries(names.map((n) => [n, []]));
  const index = tris.map((v) => {
    if (!remap.has(v)) {
      remap.set(v, remap.size);
      for (const n of names) {
        const at = g.attributes[n];
        for (let k = 0; k < at.itemSize; k++) data[n].push(at.array[v * at.itemSize + k]);
      }
    }
    return remap.get(v);
  });
  for (const n of names) out.setAttribute(n, new THREE.Float32BufferAttribute(data[n], g.attributes[n].itemSize));
  out.setIndex(index);
  return out;
}

/** Sculpt the head sphere into a head shape (local coords around head centre). */
function sculptHead(x, y, z, R, a) {
  x *= 0.83; y *= 1.1; z *= 0.98;
  if (y < 0) {
    const t = Math.pow(-y / (1.1 * R), 1.5);
    x *= 1 - (a.female || a.kid ? 0.32 : 0.24) * t;
    if (z > 0) z *= 1 - 0.08 * t;
    else z *= 1 - 0.38 * t;
    if (z > 0 && y < -0.6 * R) z += 0.01 * (a.hero ? 1.3 : 1);
  }
  if (z < 0 && y > 0) z *= 1.06;
  if (y > 0.3 * R && z > 0) z *= 0.97;
  // cheekbones
  if (z > 0.04 && Math.abs(y) < 0.3 * R) x *= 1.03;
  return [x, y, z];
}

function headShell(R, a, scale, keep) {
  let g = new THREE.SphereGeometry(R, 24, 18);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = sculptHead(pos.getX(i), pos.getY(i), pos.getZ(i), R, a);
    pos.setXYZ(i, x * scale, y * scale, z * scale);
  }
  if (keep) g = filterTriangles(g, keep);
  g.computeVertexNormals();
  return g;
}

function hairline(x, z) {
  const back = -0.078, side = 0.03, front = 0.062 - Math.min(1, Math.abs(x) / 0.09) * 0.025;
  if (z < -0.04) return back;
  if (z < 0.02) return back + ((z + 0.04) / 0.06) * (side - back);
  if (z < 0.07) return side + ((z - 0.02) / 0.05) * (front - side);
  return front;
}

// ------------------------------------------------------------------ build
export function buildHuman(app, atlas) {
  const b = new GeoBuilder();
  const sw = new SkinWriter();
  b.extra = sw;
  const W = app.width;
  const skin = col(app.skin);
  const top = col(app.acc.includes('coat') ? '#fafafa' : app.topColor);
  const shirt = col(app.topColor);
  const bottom = col(app.bottomColor);
  const hairC = col(app.hairColor);
  // every non-face part samples a white texel of the atlas (tinted by vertex colour)
  const cu = atlas.cellUV(app.face);
  const bodyUV = [cu[0] + 0.002, cu[1] + 0.002];
  const add = (g, weights, color = null, uv = bodyUV) => {
    sw.fn = weights;
    b.geometry(g, null, color, uv);
  };

  // ---------------- torso
  const prof = app.female
    ? [[0.001, 0.86], [0.12, 0.87], [0.176, 0.92], [0.178, 0.99], [0.14, 1.08], [0.142, 1.17], [0.16, 1.27], [0.168, 1.36], [0.17, 1.42], [0.15, 1.47], [0.09, 1.515], [0.05, 1.535], [0.001, 1.54]]
    : [[0.001, 0.86], [0.12, 0.87], [0.162, 0.92], [0.165, 0.99], [0.152, 1.07], [0.158, 1.17], [0.176, 1.27], [0.192, 1.36], [0.196, 1.42], [0.172, 1.48], [0.1, 1.52], [0.055, 1.54], [0.001, 1.545]];
  const torso = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
  {
    const pos = torso.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      x *= W * (y > 1.3 ? app.shoulders : 1);
      let depth = 0.62 + (app.female ? 0 : 0.06 * gauss(y - 1.33, 0.08));
      if (z > 0) {
        depth += app.belly * 8 * gauss(y - 1.1, 0.09);
        if (app.female && !app.kid) depth += 0.2 * gauss(y - 1.31, 0.055) * gauss(x, 0.12);
      }
      z *= depth * W;
      pos.setXYZ(i, x, y, z);
    }
    torso.computeVertexNormals();
  }
  const belt = app.bottom === 'pants' ? col(app.acc.includes('belt') ? '#3b2a1a' : '#2a1d14') : null;
  colorize(torso, (x, y, z, c) => {
    const front = z > 0;
    if (y < 0.985) { c.copy(app.bottom === 'shorts' || app.bottom === 'pants' ? bottom : app.bottom === 'saree' ? bottom : app.bottom === 'skirt' ? bottom : bottom); return; }
    if (belt && y < 1.005) { c.copy(belt); return; }
    if (app.top === 'bare') { c.copy(skin); return; }
    if (app.bottom === 'saree' && y < 1.19) { c.copy(skin); return; }
    if (app.top === 'banian' && ((Math.abs(x) > 0.1 && y > 1.36) || (front && y > 1.38 && Math.abs(x) < 0.08))) { c.copy(skin); return; }
    if ((app.top === 'shirt' || app.top === 'kurta' || app.top === 'openshirt') && front && y > 1.47 && Math.abs(x) < 0.045) { c.copy(skin); return; }
    if (app.top === 'openshirt' && front && Math.abs(x) < 0.062 && y > 1.0) { c.copy(col(app.innerColor)); return; }
    if (app.acc.includes('coat') && front && Math.abs(x) < 0.06) { c.copy(shirt); return; }
    if (app.acc.includes('vest') && y > 1.02 && y < 1.46) { c.copy(col(Math.abs(y - 1.22) < 0.025 ? '#e0e0e0' : '#ff6d00')); return; }
    if (app.acc.includes('reflect') && (Math.abs(y - 1.12) < 0.02 || Math.abs(y - 1.3) < 0.02)) { c.copy(col('#fdd835')); return; }
    if (app.bottom === 'lungi' && false) return;
    c.copy(top);
    if (app.acc.includes('grease') && Math.sin(x * 60) * Math.cos(y * 40) > 0.85) c.multiplyScalar(0.6);
  });
  add(torso, (x, y) => torsoWeights(x, y));

  // ---------------- neck & head
  const neck = new THREE.CylinderGeometry(0.056 * W, 0.064 * W, 0.15, 12);
  neck.translate(0, 1.56, 0.0);
  add(neck, (x, y) => (y < 1.52 ? [[BI.neck, 0.5], [BI.chest, 0.5]] : [[BI.neck, 1]]), skin);

  const [u0, v0, u1, v1] = atlas.cellUV(app.face);
  const head = new THREE.SphereGeometry(HEAD_R, 28, 22);
  {
    const pos = head.attributes.position;
    const uv = head.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const [x, y, z] = sculptHead(pos.getX(i), pos.getY(i), pos.getZ(i), HEAD_R, app);
      pos.setXYZ(i, x, y, z);
      let u = x / 0.2 + 0.5;
      let v = y / 0.231 + 0.5;
      if (z < 0.015) {
        const du = u - 0.5, dv = v - 0.5;
        const m = Math.max(Math.abs(du), Math.abs(dv), 1e-3);
        u = 0.5 + (du / m) * 0.499;
        v = 0.5 + (dv / m) * 0.499;
      }
      u = clamp(u, 0.001, 0.999);
      v = clamp(v, 0.001, 0.999);
      uv.setXY(i, u0 + u * (u1 - u0), v0 + v * (v1 - v0));
    }
    head.computeVertexNormals();
    head.translate(HEAD_C.x, HEAD_C.y, HEAD_C.z);
  }
  const headW = rigid('head');
  add(head, headW, skin, null);
  const whiteUV = [u0 + 0.002, v0 + 0.002];
  const addH = (g, color) => { sw.fn = headW; b.geometry(g, null, color, whiteUV); };
  const hc = HEAD_C;
  const at = (x, y, z) => new THREE.Vector3(hc.x + x, hc.y + y, hc.z + z);
  // ears
  for (const s of [-1, 1]) addH(sphere(0.028, 0.35, 1, 0.65, at(s * 0.088, 0.004, -0.008)), skin.clone().multiplyScalar(0.95));
  // eyes (sclera, iris, upper lid)
  const irisC = col(app.hero ? '#2a170d' : '#3b2416');
  for (const s of [-1, 1]) {
    addH(sphere(0.0125, 1, 1, 1, at(s * 0.031, 0.0203, 0.0835), 12, 10), col('#f2ede6'));
    addH(sphere(0.0071, 1, 1, 0.6, at(s * 0.031, 0.0203, 0.0945), 10, 8), irisC);
    addH(sphere(0.0016, 1, 1, 1, at(s * 0.028, 0.0235, 0.099), 4, 3), col('#ffffff')); // catch light
    const lid = new THREE.SphereGeometry(0.0138, 12, 6, 0, Math.PI * 2, 0, 1.25);
    lid.translate(s * 0.031 + hc.x, 0.0203 + hc.y, 0.0835 + hc.z);
    addH(lid, skin.clone().multiplyScalar(0.82));
  }
  // nose
  {
    const nose = new THREE.ConeGeometry(0.017, 0.058, 4);
    nose.rotateY(Math.PI / 4);
    nose.scale(0.8, 1, 1);
    nose.rotateX(1.95);
    nose.translate(hc.x, hc.y - 0.012, hc.z + 0.098);
    addH(nose, skin.clone().multiplyScalar(0.97));
    for (const s of [-1, 1]) addH(sphere(0.0095, 1, 0.8, 1, at(s * 0.0115, -0.03, 0.094)), skin.clone().multiplyScalar(0.95));
  }
  // lips
  const lipC = app.female ? skin.clone().lerp(col('#a3293a'), 0.45) : skin.clone().multiplyScalar(0.72).lerp(col('#7a3b35'), 0.25);
  addH(sphere(0.02, 1.25, 0.3, 0.45, at(0, -0.0445, 0.0915)), lipC);
  addH(sphere(0.019, 1.2, 0.35, 0.45, at(0, -0.053, 0.0895)), lipC.clone().multiplyScalar(1.05));
  // brows (hero gets sculpted thick brows)
  if (app.hero || (!app.female && !app.kid)) {
    for (const s of [-1, 1]) {
      addH(boxAt(0.036, app.hero ? 0.0085 : 0.006, 0.01, at(s * 0.032, 0.0435, 0.093), { z: s * -0.12 }), app.old ? col('#8a8580') : hairC);
    }
  }
  // facial hair geometry
  if (app.beard !== 'none') {
    const full = app.beard === 'full';
    const sc = full ? 1.038 : 1.022;
    const beard = headShell(HEAD_R, app, sc, (x, y, z) => {
      const ax = Math.abs(x);
      const limit = ax > 0.05 ? -0.036 - (ax - 0.05) * 0.25 : -0.026;
      if (y > limit || z < -0.012) return false;
      if (y < -0.1 && z < 0.035) return false; // no flap under the jaw
      if (ax < 0.03 && y > -0.066 && y < -0.028 && z > 0) return false; // mouth opening
      return true;
    });
    if (full) {
      const p = beard.attributes.position;
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) < -0.095 && p.getZ(i) > 0.02) { p.setY(i, p.getY(i) - 0.006); p.setZ(i, p.getZ(i) + 0.004); }
      }
      beard.computeVertexNormals();
    }
    beard.translate(hc.x, hc.y, hc.z);
    addH(beard, hairC.clone().lerp(col('#3a2a20'), 0.25));
  }
  if (app.mustache) {
    const m = app.old ? col('#a5a09a') : hairC.clone().lerp(col('#3a2a20'), 0.2);
    addH(boxAt(0.046, 0.009, 0.008, at(0, -0.034, 0.0975)), m);
    for (const s of [-1, 1]) addH(boxAt(0.012, 0.013, 0.007, at(s * 0.026, -0.041, 0.093), { z: s * 0.3 }), m);
  }

  // ---------------- hair
  if (app.hair === 'bald') {
    const band = headShell(HEAD_R, app, 1.03, (x, y, z) => y > -0.07 && y < 0.035 && z < 0.03);
    band.translate(hc.x, hc.y, hc.z);
    addH(band, hairC);
  } else {
    const sc = app.hair === 'pompadour' ? 1.058 : app.hair === 'curly' ? 1.085 : app.female ? 1.055 : 1.05;
    const hair = headShell(HEAD_R, app, sc, (x, y, z) => {
      let line = hairline(x, z);
      if (app.female && z < 0.05) line -= 0.03;
      return y > line - 0.004;
    });
    if (app.hair === 'pompadour') {
      const p = hair.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const y = p.getY(i);
        const z = p.getZ(i);
        // faded sides, volume on top-front (swept back)
        const sideFade = Math.abs(x) > 0.07 && y < 0.07 ? 0.965 : 1;
        const lift = y > 0.03 ? 0.022 * smoothstep(0.03, 0.1, y) * (0.6 + 0.4 * smoothstep(-0.05, 0.08, z)) : 0;
        p.setXYZ(i, x * sideFade, y + lift, z * sideFade + lift * 0.3);
      }
      hair.computeVertexNormals();
    }
    hair.translate(hc.x, hc.y, hc.z);
    addH(hair, hairC);
    if (app.hair === 'pompadour') {
      const quiff = sphere(0.066, 0.92, 0.46, 1.0, at(0, 0.112, 0.03), 14, 10);
      addH(quiff, hairC);
    }
    if (app.hair === 'side') addH(sphere(0.05, 1, 0.35, 1.1, at(0.025, 0.106, 0.015)), hairC);
    if (app.hair === 'curly') {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        addH(sphere(0.03, 1, 0.8, 1, at(Math.cos(a) * 0.05, 0.1 + (i % 2) * 0.01, Math.sin(a) * 0.05)), hairC);
      }
    }
    if (app.hair === 'bun') {
      addH(sphere(0.045, 1, 0.9, 0.8, at(0, 0.0, -0.118)), hairC);
      if (app.jasmine) for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        addH(sphere(0.009, 1, 1, 1, at(Math.cos(a) * 0.046, Math.sin(a) * 0.043, -0.118 - 0.01), 5, 4), col('#fbfbf0'));
      }
    }
    if (app.hair === 'braid') {
      const pts = [];
      const top = HEAD_C.y - 0.02;
      const bottomY = app.kid ? 1.25 : 1.0;
      const n = 9;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        pts.push(new THREE.Vector3(0, top - t * (top - bottomY), -0.115 - 0.03 * Math.sin(t * Math.PI) - t * 0.02));
      }
      pts.forEach((p, i) => {
        const r = 0.03 * (1 - (i / n) * 0.5);
        const g = sphere(r, 1, 1.4, 0.85, p, 8, 6);
        const wts = p.y > 1.6 ? headW : (x, y) => torsoWeights(x, Math.min(y, 1.48));
        sw.fn = wts;
        b.geometry(g, null, hairC, whiteUV);
        if (app.jasmine && i < 4) {
          for (const s of [-1, 1]) {
            sw.fn = wts;
            b.geometry(sphere(0.01, 1, 1, 1, new THREE.Vector3(s * 0.028, p.y, p.z - 0.005), 5, 4), null, col('#fbfbf0'), whiteUV);
          }
        }
      });
    }
  }

  // ---------------- face marks & headwear
  if (app.acc.includes('vibhuti')) {
    for (let i = 0; i < 3; i++) addH(boxAt(0.06, 0.0035, 0.004, at(0, 0.052 + i * 0.008, 0.094 - i * 0.002)), col('#ece9e2'));
    addH(boxAt(0.007, 0.007, 0.004, at(0, 0.041, 0.097)), col('#c2181b'));
  }
  if (app.acc.includes('glasses')) {
    const fr = col(app.old ? '#6d5a3a' : '#1a1a1a');
    for (const s of [-1, 1]) {
      const ring = new THREE.TorusGeometry(0.019, 0.0025, 4, 14);
      ring.translate(hc.x + s * 0.031, hc.y + 0.02, hc.z + 0.104);
      addH(ring, fr);
      addH(boxAt(0.004, 0.004, 0.09, at(s * 0.078, 0.022, 0.058)), fr);
    }
    addH(boxAt(0.024, 0.004, 0.004, at(0, 0.024, 0.104)), fr);
  }
  if (app.acc.includes('cap_police') || app.acc.includes('cap_security')) {
    const cc = col(app.acc.includes('cap_police') ? '#9c8554' : '#27324a');
    addH(new THREE.CylinderGeometry(0.108, 0.1, 0.075, 16).translate(hc.x, hc.y + 0.1, hc.z - 0.005), cc);
    addH(new THREE.CylinderGeometry(0.1, 0.1, 0.015, 16).translate(hc.x, hc.y + 0.07, hc.z - 0.005), col(app.acc.includes('cap_police') ? '#5a2a1a' : '#111'));
    addH(boxAt(0.14, 0.008, 0.06, at(0, 0.065, 0.1), { x: 0.25 }), col('#151515'));
    if (app.acc.includes('cap_police')) addH(boxAt(0.025, 0.025, 0.006, at(0, 0.1, 0.105)), col('#d4a017'));
  }
  if (app.acc.includes('helmet_fire')) {
    addH(new THREE.SphereGeometry(0.125, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.95, 0.9, 1.05).translate(hc.x, hc.y + 0.035, hc.z - 0.005), col('#c62828'));
    addH(new THREE.CylinderGeometry(0.14, 0.15, 0.012, 18).translate(hc.x, hc.y + 0.03, hc.z - 0.02), col('#b71c1c'));
  }
  if (app.acc.includes('nursecap')) addH(boxAt(0.08, 0.03, 0.05, at(0, 0.12, 0.02)), col('#ffffff'));
  if (app.acc.includes('headcloth')) {
    const t = new THREE.TorusGeometry(0.1, 0.024, 6, 18).rotateX(Math.PI / 2).scale(0.9, 1, 1.05);
    t.translate(hc.x, hc.y + 0.075, hc.z - 0.005);
    addH(t, col('#eeeeee'));
  }

  // ---------------- arms
  const sleeveLen = app.top === 'bare' || app.top === 'banian' ? 0 : (app.sleeves ?? 0.5) * 0.53;
  const armTop = app.acc.includes('coat') ? col('#fafafa') : shirt;
  for (const s of ['L', 'R']) {
    const sh = BP[`upperArm${s}`].clone();
    sh.x *= app.shoulders * W;
    const el = BP[`foreArm${s}`].clone();
    el.x = sh.x + (el.x - BP[`upperArm${s}`].x);
    const wr = BP[`hand${s}`].clone();
    wr.x = el.x + (wr.x - BP[`foreArm${s}`].x);
    const r0 = 0.052 * W * (app.female ? 0.88 : 1);
    const upper = limb(sh, el, r0, r0 * 0.82);
    const upLen = sh.distanceTo(el);
    const dirU = new THREE.Vector3().subVectors(el, sh).normalize();
    colorize(upper, (x, y, z, c) => {
      const t = (x - sh.x) * dirU.x + (y - sh.y) * dirU.y + (z - sh.z) * dirU.z;
      if (t < sleeveLen) c.copy(Math.abs(t - sleeveLen) < 0.018 && app.hero ? armTop.clone().multiplyScalar(0.8) : armTop);
      else c.copy(skin);
    });
    add(upper, limbWeights(`upperArm${s}`, 'chest', sh, dirU, 0.07));
    const fore = limb(el, wr, r0 * 0.8, r0 * 0.62);
    const dirF = new THREE.Vector3().subVectors(wr, el).normalize();
    colorize(fore, (x, y, z, c) => {
      const t = upLen + (x - el.x) * dirF.x + (y - el.y) * dirF.y + (z - el.z) * dirF.z;
      if (t < sleeveLen) c.copy(Math.abs(t - sleeveLen) < 0.02 && app.hero ? armTop.clone().multiplyScalar(0.8) : armTop);
      else c.copy(skin);
    });
    add(fore, limbWeights(`foreArm${s}`, `upperArm${s}`, el, dirF, 0.05));
    const sign = s === 'L' ? 1 : -1;
    const hand = sphere(0.046, 0.52, 1.0, 0.85, new THREE.Vector3(wr.x + sign * 0.004, wr.y - 0.055, wr.z + 0.003), 10, 8);
    add(hand, limbWeights(`hand${s}`, `foreArm${s}`, wr, new THREE.Vector3(0, -1, 0), 0.03), skin);
    const thumb = limb(new THREE.Vector3(wr.x - sign * 0.005, wr.y - 0.02, wr.z + 0.02), new THREE.Vector3(wr.x - sign * 0.012, wr.y - 0.06, wr.z + 0.04), 0.012, 0.01, 6);
    add(thumb, rigid(`hand${s}`), skin);
    if (s === 'L' && app.acc.includes('watch')) {
      const band = new THREE.CylinderGeometry(r0 * 0.66, r0 * 0.66, 0.02, 10);
      band.translate(wr.x - dirF.x * 0.03, wr.y - dirF.y * 0.03 + 0.0, wr.z);
      add(band, rigid('foreArmL'), col('#2b2b2b'));
      add(boxAt(0.028, 0.012, 0.028, new THREE.Vector3(wr.x + 0.022, wr.y + 0.03, wr.z)), rigid('foreArmL'), col('#c0c4c8'));
    }
  }

  // ---------------- legs & feet
  const bare = app.bottom === 'veshti' || app.bottom === 'lungi' || app.bottom === 'saree' || app.bottom === 'skirt';
  for (const s of ['L', 'R']) {
    const hip = BP[`thigh${s}`].clone();
    const knee = BP[`shin${s}`].clone();
    const ank = BP[`foot${s}`].clone();
    hip.x *= W; knee.x *= W; ank.x *= W;
    const tr = (app.female ? 0.082 : 0.078) * W;
    const thigh = limb(hip, knee, tr, tr * 0.72);
    colorize(thigh, (x, y, z, c) => {
      if (bare) c.copy(skin);
      else if (app.bottom === 'shorts') c.copy(y > 0.66 ? bottom : skin);
      else c.copy(bottom);
    });
    const dirT = new THREE.Vector3().subVectors(knee, hip).normalize();
    add(thigh, limbWeights(`thigh${s}`, 'hips', hip, dirT, 0.08));
    const shin = limb(knee, ank, tr * 0.7, tr * 0.5);
    const dirS = new THREE.Vector3().subVectors(ank, knee).normalize();
    add(shin, limbWeights(`shin${s}`, `thigh${s}`, knee, dirS, 0.05), bare || app.bottom === 'shorts' ? skin : bottom);
    const foot = ank.clone();
    if (app.shoes === 'shoes') {
      add(boxAt(0.095, 0.075, 0.25, new THREE.Vector3(foot.x, 0.04, foot.z + 0.045)), rigid(`foot${s}`), col(app.shoeColor));
      add(boxAt(0.1, 0.02, 0.255, new THREE.Vector3(foot.x, 0.008, foot.z + 0.045)), rigid(`foot${s}`), col('#151515'));
    } else {
      add(boxAt(0.082, 0.05, 0.22, new THREE.Vector3(foot.x, 0.04, foot.z + 0.045)), rigid(`foot${s}`), skin);
      if (app.shoes === 'chappal') {
        add(boxAt(0.095, 0.016, 0.25, new THREE.Vector3(foot.x, 0.008, foot.z + 0.045)), rigid(`foot${s}`), col(app.shoeColor));
        add(boxAt(0.086, 0.012, 0.03, new THREE.Vector3(foot.x, 0.055, foot.z + 0.08)), rigid(`foot${s}`), col(app.shoeColor));
      }
    }
  }

  // ---------------- skirts / drapes
  const hipsW = rigid('hips');
  const skirt = (topY, botY, rTop, rBot, colorFn, thetaStart = 0, thetaLen = Math.PI * 2) => {
    const g = new THREE.CylinderGeometry(rTop * W, rBot * W, topY - botY, 22, 5, true, thetaStart, thetaLen);
    g.translate(0, (topY + botY) / 2, 0);
    g.scale(1, 1, 0.8);
    colorize(g, colorFn);
    // render the inside too (cloth is seen from below while walking)
    const inner = g.clone();
    const idx = inner.index.array;
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i]; idx[i] = idx[i + 2]; idx[i + 2] = t; }
    const n = inner.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    add(g, hipsW);
    add(inner, hipsW);
  };
  const border = app.border ? col(app.border) : null;
  if (app.bottom === 'veshti') {
    skirt(1.0, 0.08, 0.175, 0.205, (x, y, z, c) => c.copy(border && y < 0.15 && y > 0.1 ? border : bottom));
    add(boxAt(0.05, 0.85, 0.01, new THREE.Vector3(0.03, 0.54, 0.17 * 0.8 * W + 0.01)), hipsW, bottom.clone().multiplyScalar(0.93));
  } else if (app.bottom === 'lungi') {
    const dark = bottom.clone().multiplyScalar(0.55);
    const light = bottom.clone().lerp(col('#ffffff'), 0.35);
    skirt(1.0, 0.1, 0.175, 0.21, (x, y, z, c) => {
      const a = Math.atan2(x, z);
      const k = (Math.floor(a * 3) + Math.floor(y / 0.09)) % 2;
      c.copy(Math.abs(k) ? dark : light);
    });
  } else if (app.bottom === 'saree') {
    skirt(1.02, 0.015, 0.18, 0.235, (x, y, z, c) => c.copy(border && y < 0.1 ? border : bottom));
    for (let i = 0; i < 5; i++) {
      add(boxAt(0.018, 0.9, 0.012, new THREE.Vector3(-0.04 + i * 0.02, 0.52, 0.2 * 0.8 * W + 0.01)), hipsW, bottom.clone().multiplyScalar(0.85 + (i % 2) * 0.1));
    }
    // pallu across the chest and down the back
    const pallu = strip([
      new THREE.Vector3(0.14 * W, 1.47, 0.035), new THREE.Vector3(0.07, 1.36, 0.155 * W), new THREE.Vector3(-0.04, 1.2, 0.13 * W),
      new THREE.Vector3(-0.15 * W, 1.02, 0.125 * W),
    ], 0.2, 0.008);
    colorize(pallu, (x, y, z, c) => c.copy(bottom.clone().multiplyScalar(1.05)));
    add(pallu, (x, y) => torsoWeights(x, y));
    const back = strip([
      new THREE.Vector3(0.14 * W, 1.47, 0.02), new THREE.Vector3(0.15 * W, 1.3, -0.125 * W), new THREE.Vector3(0.16 * W, 1.0, -0.14 * W), new THREE.Vector3(0.17 * W, 0.8, -0.16 * W),
    ], 0.22, 0.008);
    colorize(back, (x, y, z, c) => c.copy(border && y < 0.86 ? border : bottom));
    add(back, (x, y) => torsoWeights(x, Math.max(y, 1.0)));
  } else if (app.bottom === 'skirt') {
    skirt(1.0, app.role === 'nurse' ? 0.5 : 0.56, 0.172, 0.25, (x, y, z, c) => c.copy(bottom));
  }
  if (app.top === 'kurta') skirt(0.99, 0.6, 0.174, 0.23, (x, y, z, c) => c.copy(top));
  if (app.acc.includes('coat')) skirt(1.02, 0.58, 0.19, 0.24, (x, y, z, c) => c.copy(col('#fafafa')), 0.5, Math.PI * 2 - 1.0);

  // ---------------- torso accessories
  const chestW = (x, y) => torsoWeights(x, y);
  const surfZ = (x, y) => {
    // approximate front surface depth of the torso at (x,y)
    const r = y > 1.3 ? 0.192 * W * app.shoulders : 0.165 * W;
    const d = 0.62 + (app.female ? 0 : 0.06 * gauss(y - 1.33, 0.08));
    return Math.sqrt(Math.max(0, r * r - x * x)) * d * W;
  };
  if (app.acc.includes('cross')) {
    const chainPts = [
      new THREE.Vector3(-0.07, 1.5, -0.02), new THREE.Vector3(-0.06, 1.45, surfZ(0.06, 1.45) + 0.004),
      new THREE.Vector3(-0.035, 1.37, surfZ(0.035, 1.37) + 0.005), new THREE.Vector3(0, 1.31, surfZ(0, 1.31) + 0.006),
    ];
    const chainR = chainPts.map((p) => new THREE.Vector3(-p.x, p.y, p.z)).reverse();
    const chain = strip([...chainPts, ...chainR.slice(1)], 0.004, 0.004);
    add(chain, chestW, col('#d0d4d8'));
    const cz = surfZ(0, 1.27) + 0.008;
    add(boxAt(0.012, 0.075, 0.006, new THREE.Vector3(0, 1.265, cz)), rigid('chest'), col('#e3e6ea'));
    add(boxAt(0.044, 0.012, 0.006, new THREE.Vector3(0, 1.283, cz)), rigid('chest'), col('#e3e6ea'));
  }
  if (app.acc.includes('goldchain')) {
    const pts = [new THREE.Vector3(-0.07, 1.5, -0.02), new THREE.Vector3(-0.05, 1.44, surfZ(0.05, 1.44) + 0.004), new THREE.Vector3(0, 1.4, surfZ(0, 1.4) + 0.005), new THREE.Vector3(0.05, 1.44, surfZ(0.05, 1.44) + 0.004), new THREE.Vector3(0.07, 1.5, -0.02)];
    add(strip(pts, 0.007, 0.006), chestW, col('#d4a017'));
  }
  if (app.acc.includes('pockets')) {
    for (const s of [-1, 1]) {
      const x = s * 0.1 * W;
      const z = surfZ(x, 1.34) + 0.005;
      add(boxAt(0.075, 0.085, 0.01, new THREE.Vector3(x, 1.33, z), { y: s * 0.45 }), rigid('chest'), shirt.clone().multiplyScalar(0.92));
      add(boxAt(0.08, 0.022, 0.014, new THREE.Vector3(x, 1.372, z + 0.003), { y: s * 0.45 }), rigid('chest'), shirt.clone().multiplyScalar(0.78));
    }
  }
  if (app.acc.includes('collar') || app.top === 'shirt' || app.top === 'openshirt' || app.acc.includes('coat')) {
    const cc = (app.acc.includes('coat') ? col('#fafafa') : shirt).clone().multiplyScalar(0.93);
    // collar band hugging the neck base, open at the front
    const ring = [];
    for (let i = 0; i <= 10; i++) {
      const a = -2.5 + (i / 10) * 5.0;
      ring.push(new THREE.Vector3(Math.sin(a) * 0.097 * W * app.shoulders, 1.528 + Math.abs(Math.cos(a)) * 0.01, -Math.cos(a) * 0.072 * W));
    }
    add(strip(ring, 0.04, 0.008), (x, y) => torsoWeights(x, Math.min(y, 1.5)), cc);
    if (app.top === 'openshirt') {
      for (const s of [-1, 1]) {
        const pts = [];
        for (let y = 1.47; y >= 1.0; y -= 0.07) pts.push(new THREE.Vector3(s * 0.068, y, surfZ(0.068, y) + 0.004));
        const edge = strip(pts, 0.022, 0.004);
        add(edge, chestW, shirt.clone().multiplyScalar(0.92));
      }
    }
  }
  if (app.acc.includes('towel')) {
    const pts = [new THREE.Vector3(0.12, 1.12, surfZ(0.12, 1.12) + 0.01), new THREE.Vector3(0.13, 1.4, surfZ(0.13, 1.4) + 0.012), new THREE.Vector3(0.13, 1.52, 0.0), new THREE.Vector3(0.13, 1.35, -0.13), new THREE.Vector3(0.12, 1.15, -0.12)];
    add(strip(pts, 0.13, 0.01), chestW, col('#f3f1ea'));
  }
  if (app.acc.includes('dupatta')) {
    for (const s of [-1, 1]) {
      const pts = [new THREE.Vector3(s * 0.1, 1.05, surfZ(0.1, 1.05) + 0.02), new THREE.Vector3(s * 0.12, 1.38, surfZ(0.12, 1.38) + 0.03), new THREE.Vector3(s * 0.13, 1.52, 0.0), new THREE.Vector3(s * 0.13, 1.3, -0.14), new THREE.Vector3(s * 0.12, 1.02, -0.13)];
      const d = strip(pts, 0.14, 0.008);
      add(d, chestW, top.clone().lerp(col('#ffffff'), 0.4));
    }
  }
  if (app.acc.includes('thread')) {
    const pts = [new THREE.Vector3(0.13, 1.47, 0.03), new THREE.Vector3(0.04, 1.3, surfZ(0.04, 1.3) + 0.004), new THREE.Vector3(-0.08, 1.1, surfZ(0.08, 1.1) + 0.004), new THREE.Vector3(-0.16, 1.0, 0.02)];
    add(strip(pts, 0.008, 0.005), chestW, col('#f5f0dc'));
  }
  if (app.acc.includes('stethoscope')) {
    const pts = [new THREE.Vector3(-0.06, 1.51, -0.03), new THREE.Vector3(-0.07, 1.42, surfZ(0.07, 1.42) + 0.01), new THREE.Vector3(-0.06, 1.25, surfZ(0.06, 1.25) + 0.01)];
    add(strip(pts, 0.008, 0.008), chestW, col('#263238'));
    const pts2 = pts.map((p) => new THREE.Vector3(-p.x, p.y, p.z));
    add(strip(pts2, 0.008, 0.008), chestW, col('#263238'));
    add(boxAt(0.03, 0.03, 0.01, new THREE.Vector3(0.06, 1.23, surfZ(0.06, 1.23) + 0.012)), rigid('chest'), col('#b0bec5'));
  }
  if (app.acc.includes('bag')) {
    add(boxAt(0.26, 0.34, 0.12, new THREE.Vector3(0, 1.22, -0.17 * W)), rigid('chest'), col(app.kid ? '#1565c0' : '#37474f'));
    for (const s of [-1, 1]) add(strip([new THREE.Vector3(s * 0.1, 1.08, surfZ(0.1, 1.08) + 0.012), new THREE.Vector3(s * 0.11, 1.4, surfZ(0.11, 1.4) + 0.012), new THREE.Vector3(s * 0.11, 1.5, 0.0), new THREE.Vector3(s * 0.1, 1.38, -0.14)], 0.035, 0.008), chestW, col('#263238'));
  }
  if (app.acc.includes('belt')) add(boxAt(0.05, 0.035, 0.012, new THREE.Vector3(0, 0.995, surfZ(0, 0.995) + 0.008)), rigid('hips'), col('#c9a227'));

  // ---------------- skeleton
  const geometry = b.build();
  const bones = BONE_DEFS.map(([name]) => {
    const bone = new THREE.Bone();
    bone.name = name;
    return bone;
  });
  BONE_DEFS.forEach(([name, parent, p], i) => {
    const pos = new THREE.Vector3(...p);
    if (name.startsWith('upperArm')) pos.x *= app.shoulders * W;
    if (name.startsWith('foreArm') || name.startsWith('hand')) {
      const s = name.endsWith('L') ? 'L' : 'R';
      pos.x = BP[`upperArm${s}`].x * app.shoulders * W + (p[0] - BP[`upperArm${s}`].x);
    }
    if (name.startsWith('thigh') || name.startsWith('shin') || name.startsWith('foot')) pos.x *= W;
    bones[i].userData.bind = pos.clone();
    if (parent) {
      const pp = bones[BI[parent]].userData.bind;
      bones[i].position.copy(pos).sub(pp);
      bones[BI[parent]].add(bones[i]);
    } else {
      bones[i].position.copy(pos);
    }
  });
  const mesh = new THREE.SkinnedMesh(geometry, characterMaterial(atlas.texture));
  mesh.add(bones[0]);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.4);
  const s = app.height / 1.75;
  mesh.scale.setScalar(s);
  mesh.userData.appearance = app;
  const boneMap = Object.fromEntries(bones.map((bn) => [bn.name, bn]));
  return { mesh, bones: boneMap, scale: s, appearance: app };
}
