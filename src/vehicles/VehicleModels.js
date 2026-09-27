// Procedural vehicle models typical of Tamil Nadu roads. Each model is one merged
// body mesh (vertex coloured) + one lights mesh; wheels are rendered separately by a
// single shared InstancedMesh (see TrafficManager) so they can spin cheaply.
import * as THREE from 'three';
import { GeoBuilder } from '../world/GeoBuilder.js';
import { mulberry32, pick } from '../core/utils.js';

const C = (h) => new THREE.Color(h);

// Local frame: +z forward, +x = vehicle's LEFT (India: right-hand drive, driver at -x).
export const SPECS = {
  bike: { name: 'பைக்', len: 1.95, width: 0.7, wheelR: 0.3, wheels: [[0, 0.68], [0, -0.66]], maxSpeed: 24, accel: 7, brake: 12, wheelbase: 1.34, circles: [[0, 0.3, 0.55]], seat: [0, 0.8, -0.12], pose: 'drive_bike', two: true, pay: 0 },
  scooter: { name: 'ஸ்கூட்டர்', len: 1.8, width: 0.68, wheelR: 0.24, wheels: [[0, 0.62], [0, -0.6]], maxSpeed: 19, accel: 6, brake: 11, wheelbase: 1.22, circles: [[0, 0.2, 0.55]], seat: [0, 0.74, -0.12], pose: 'drive_bike', two: true },
  auto: { name: 'ஆட்டோ', len: 2.75, width: 1.3, wheelR: 0.24, wheels: [[0, 1.0], [0.58, -0.78], [-0.58, -0.78]], maxSpeed: 14, accel: 4, brake: 9, wheelbase: 1.78, circles: [[0, 0.5, 0.75], [0, -0.6, 0.75]], seat: [0, 0.72, 0.28], pose: 'drive_auto' },
  car: { name: 'கார்', len: 4.0, width: 1.72, wheelR: 0.31, wheels: [[0.74, 1.28], [-0.74, 1.28], [0.74, -1.25], [-0.74, -1.25]], maxSpeed: 32, accel: 7.5, brake: 14, wheelbase: 2.53, circles: [[0, 1.05, 0.95], [0, -1.05, 0.95]], seat: [-0.36, 0.52, -0.15], pose: 'drive_car' },
  police: { name: 'போலீஸ் ஜீப்', len: 4.2, width: 1.8, wheelR: 0.36, wheels: [[0.77, 1.35], [-0.77, 1.35], [0.77, -1.3], [-0.77, -1.3]], maxSpeed: 34, accel: 8, brake: 14, wheelbase: 2.65, circles: [[0, 1.1, 1.0], [0, -1.1, 1.0]], seat: [-0.38, 0.72, 0.0], pose: 'drive_car', siren: true },
  ambulance: { name: 'ஆம்புலன்ஸ்', len: 4.9, width: 1.9, wheelR: 0.36, wheels: [[0.8, 1.6], [-0.8, 1.6], [0.8, -1.5], [-0.8, -1.5]], maxSpeed: 30, accel: 6.5, brake: 12, wheelbase: 3.1, circles: [[0, 1.4, 1.05], [0, 0, 1.05], [0, -1.4, 1.05]], seat: [-0.4, 0.8, 1.2], pose: 'drive_car', siren: true },
  delivery: { name: 'டெம்போ', len: 4.2, width: 1.55, wheelR: 0.3, wheels: [[0.66, 1.3], [-0.66, 1.3], [0.66, -1.25], [-0.66, -1.25]], maxSpeed: 22, accel: 5, brake: 10, wheelbase: 2.55, circles: [[0, 1.1, 0.9], [0, -1.1, 0.9]], seat: [-0.34, 0.75, 1.25], pose: 'drive_car' },
  bus: { name: 'பஸ்', len: 11, width: 2.5, wheelR: 0.52, wheels: [[1.05, 3.7], [-1.05, 3.7], [1.05, -2.9], [-1.05, -2.9]], maxSpeed: 20, accel: 3, brake: 7, wheelbase: 6.6, circles: [[0, 4, 1.35], [0, 1.4, 1.35], [0, -1.4, 1.35], [0, -4, 1.35]], seat: [-0.85, 1.15, 4.5], pose: 'drive_car', big: true },
  truck: { name: 'லாரி', len: 8.2, width: 2.45, wheelR: 0.5, wheels: [[1.02, 2.8], [-1.02, 2.8], [1.02, -2.2], [-1.02, -2.2], [1.02, -3.2], [-1.02, -3.2]], maxSpeed: 19, accel: 2.6, brake: 7, wheelbase: 5.4, circles: [[0, 3, 1.3], [0, 0.5, 1.3], [0, -2.5, 1.3]], seat: [-0.6, 1.25, 3.0], pose: 'drive_car', big: true },
  fire: { name: 'தீயணைப்பு வண்டி', len: 7.6, width: 2.4, wheelR: 0.5, wheels: [[1.0, 2.6], [-1.0, 2.6], [1.0, -2.3], [-1.0, -2.3]], maxSpeed: 24, accel: 3.5, brake: 8, wheelbase: 4.9, circles: [[0, 2.6, 1.3], [0, 0, 1.3], [0, -2.6, 1.3]], seat: [-0.6, 1.25, 2.8], pose: 'drive_car', big: true, siren: true },
};

const CAR_COLORS = ['#f5f5f5', '#c0c4c8', '#1f1f1f', '#8b0000', '#1e3a8a', '#6b7280', '#b91c1c', '#e5e7eb', '#0f5132', '#7c2d12', '#374151', '#fefefe'];
const BIKE_COLORS = ['#111111', '#b71c1c', '#1565c0', '#263238', '#4e342e', '#9e9e9e', '#1b5e20', '#f5f5f5'];
const BUS_LIVERY = [['#c62828', '#fbc02d'], ['#1565c0', '#eceff1'], ['#6a1b9a', '#ffd54f'], ['#e65100', '#ffffff'], ['#2e7d32', '#fff176'], ['#ad1457', '#f8bbd0']];
const TRUCK_CAB = ['#f57c00', '#fbc02d', '#1565c0', '#c62828', '#2e7d32'];

function wheelHousing(b, spec) {
  for (const [x, z] of spec.wheels) {
    if (x === 0) continue;
    b.box(x * 0.98, spec.wheelR + 0.05, z, 0.28, spec.wheelR * 1.1, spec.wheelR * 2.3, C('#161616'), undefined, { top: true, bottom: true });
  }
}

/** Trapezoid "greenhouse" (cabin) from bottom rect to smaller top rect. */
function cabin(b, y0, y1, z0, z1, zt0, zt1, w0, w1, glass, pillar) {
  const hw0 = w0 / 2, hw1 = w1 / 2;
  // front windscreen
  b.quad([-hw0, y0, z1], [hw0, y0, z1], [hw1, y1, zt1], [-hw1, y1, zt1], glass);
  // rear screen
  b.quad([hw0, y0, z0], [-hw0, y0, z0], [-hw1, y1, zt0], [hw1, y1, zt0], glass);
  // sides
  b.quad([hw0, y0, z1], [hw0, y0, z0], [hw1, y1, zt0], [hw1, y1, zt1], glass);
  b.quad([-hw0, y0, z0], [-hw0, y0, z1], [-hw1, y1, zt1], [-hw1, y1, zt0], glass);
  // roof
  b.quad([-hw1, y1, zt1], [hw1, y1, zt1], [hw1, y1, zt0], [-hw1, y1, zt0], pillar);
  // B pillars
  const zm = (zt0 + zt1) / 2;
  for (const s of [-1, 1]) b.box(s * ((hw0 + hw1) / 2), (y0 + y1) / 2, zm, 0.06, y1 - y0, 0.12, pillar);
}

export class VehicleFactory {
  constructor(mats, assets = null) {
    this.mats = mats;
    this.assets = assets;
    this.bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.28 });
    this.lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.lightMat.color.setScalar(0.7);
    this.sirenRed = new THREE.MeshBasicMaterial({ color: 0xff1a1a });
    this.sirenBlue = new THREE.MeshBasicMaterial({ color: 0x1a4dff });
    this.cache = new Map();
    this.wheelGeo = this.buildWheel();
  }

  setNight(n) {
    this.lightMat.color.setScalar(0.55 + n * 1.2);
  }

  buildWheel() {
    const g = new THREE.CylinderGeometry(1, 1, 0.5, 14, 1).rotateZ(Math.PI / 2);
    const n = g.attributes.normal;
    const p = g.attributes.position;
    const cols = [];
    for (let i = 0; i < n.count; i++) {
      const cap = Math.abs(n.getX(i)) > 0.9;
      const r = Math.hypot(p.getY(i), p.getZ(i));
      const hub = cap && r < 0.62;
      const v = hub ? 0.55 : 0.05;
      cols.push(v, v, v * 1.02);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    return g;
  }

  /** Returns { geometry, lights, signs, sirens:[{mesh}], spec } for a type + variant. */
  model(type, variant = 0) {
    const key = `${type}:${variant}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const spec = SPECS[type];
    const rng = mulberry32(variant * 131 + type.length * 977);
    const b = new GeoBuilder();
    const l = new GeoBuilder();
    const sb = new GeoBuilder();
    const siren = [];
    const glass = C('#1c2530');
    const dark = C('#1a1a1a');
    const chrome = C('#c9ccd1');
    const white = C('#ffffff');
    const red = C('#ff2020');
    const amber = C('#ffb300');
    const head = C('#fffbe6');
    const L = spec.len;
    const W = spec.width;

    switch (type) {
      case 'bike':
      case 'scooter': {
        const paint = C(pick(rng, BIKE_COLORS));
        if (type === 'bike') {
          b.box(0, 0.62, 0.15, 0.08, 0.08, 1.0, dark);
          b.box(0, 0.85, 0.25, 0.3, 0.2, 0.5, paint); // tank
          b.box(0, 0.83, -0.28, 0.28, 0.1, 0.6, dark); // seat
          b.box(0, 0.45, 0.05, 0.28, 0.3, 0.45, C('#6b6f75')); // engine
          b.box(-0.18, 0.35, -0.35, 0.08, 0.08, 0.7, chrome); // exhaust
          b.box(0, 0.62, -0.62, 0.22, 0.12, 0.35, paint); // tail
        } else {
          b.box(0, 0.4, -0.1, 0.34, 0.25, 0.9, paint); // floor board
          b.box(0, 0.55, -0.42, 0.38, 0.35, 0.65, paint); // rear body
          b.box(0, 0.78, -0.35, 0.3, 0.1, 0.62, dark); // seat
          b.box(0, 0.8, 0.5, 0.32, 0.75, 0.12, paint); // leg shield
        }
        b.box(0, 0.95, 0.62, 0.06, 0.55, 0.06, chrome); // fork
        b.box(0, 1.12, 0.58, 0.7, 0.04, 0.04, dark); // handlebar
        l.box(0, 1.02, 0.7, 0.16, 0.13, 0.06, head);
        l.box(0, 0.7, -0.8, 0.12, 0.06, 0.04, red);
        break;
      }
      case 'auto': {
        const yellow = C('#f4c20d');
        const green = C('#1b7a3a');
        b.box(0, 0.45, -0.2, W, 0.45, 1.9, yellow);
        b.box(0, 0.5, 0.85, 0.7, 0.55, 0.7, yellow);
        b.box(0, 0.72, -0.2, W + 0.02, 0.1, 1.9, green);
        b.box(0, 1.05, -0.55, W - 0.1, 0.5, 0.1, dark); // rear seat back
        b.box(0, 0.68, -0.4, W - 0.2, 0.12, 0.6, C('#3a2a1f'));
        b.box(0, 0.72, 0.28, 0.4, 0.1, 0.35, C('#3a2a1f')); // driver seat
        // canopy
        b.box(0, 1.78, -0.25, W + 0.05, 0.08, 2.1, C('#111111'));
        for (const s of [-1, 1]) {
          b.box(s * (W / 2), 1.25, -1.1, 0.05, 1.05, 0.05, dark);
          b.box(s * (W / 2 - 0.1), 1.3, 0.75, 0.05, 0.95, 0.05, dark);
        }
        b.box(0, 1.45, 0.82, W - 0.3, 0.6, 0.04, glass); // windscreen
        b.box(0, 1.1, 0.95, 0.8, 0.04, 0.04, dark); // handlebar
        b.box(0, 0.95, -1.18, W, 0.8, 0.06, C('#111')); // rear canvas
        l.box(0, 0.85, 1.21, 0.2, 0.15, 0.04, head);
        l.box(0.5, 0.5, -1.16, 0.12, 0.08, 0.04, red);
        l.box(-0.5, 0.5, -1.16, 0.12, 0.08, 0.04, red);
        break;
      }
      case 'car':
      case 'police':
      case 'ambulance':
      case 'delivery': {
        let paint = C(pick(rng, CAR_COLORS));
        if (type === 'police') paint = C('#f5f5f5');
        if (type === 'ambulance') paint = C('#fdfdfd');
        if (type === 'delivery') paint = C(pick(rng, ['#f5f5f5', '#e0e0e0', '#1565c0', '#fbc02d']));
        const hood = type === 'ambulance' || type === 'delivery' ? 0.75 : 1.05;
        const bodyTop = type === 'police' ? 1.05 : 0.92;
        b.box(0, (0.28 + bodyTop) / 2 + 0.02, 0, W, bodyTop - 0.28, L, paint);
        wheelHousing(b, spec);
        b.box(0, 0.36, L / 2 + 0.03, W - 0.05, 0.18, 0.08, dark); // bumper
        b.box(0, 0.36, -L / 2 - 0.03, W - 0.05, 0.18, 0.08, dark);
        b.box(0, 0.62, L / 2 + 0.01, W * 0.5, 0.18, 0.04, C('#262626')); // grille
        if (type === 'delivery') {
          // cab + open cargo bed
          cabin(b, bodyTop, bodyTop + 0.75, L / 2 - 1.3, L / 2 - 0.2, L / 2 - 1.25, L / 2 - 0.5, W - 0.05, W - 0.2, glass, paint);
          b.box(0, bodyTop + 0.3, -0.55, W, 0.6, 0.05, C('#8d6e63'));
          for (const s of [-1, 1]) b.box(s * W / 2, bodyTop + 0.25, -0.75, 0.05, 0.5, 2.6, C('#8d6e63'));
          for (let i = 0; i < 5; i++) b.box((i % 2 - 0.5) * 0.6, bodyTop + 0.22, -0.9 - Math.floor(i / 2) * 0.55, 0.5, 0.42, 0.5, C('#b08b5a'));
        } else if (type === 'ambulance') {
          b.box(0, bodyTop + 0.85, -0.45, W - 0.02, 1.7, L - 1.3, paint);
          cabin(b, bodyTop, bodyTop + 0.8, L / 2 - 1.25, L / 2 - 0.35, L / 2 - 1.2, L / 2 - 0.75, W - 0.05, W - 0.12, glass, paint);
          for (const s of [-1, 1]) {
            b.box(s * (W / 2 + 0.005), bodyTop + 0.2, -0.3, 0.01, 0.18, L - 1.3, C('#d32f2f'));
            sb.place(s * (W / 2 + 0.02), bodyTop + 0.7, -0.4, s * Math.PI / 2);
            sb.quad([-1.2, 0, 0], [1.2, 0, 0], [1.2, 0.5, 0], [-1.2, 0.5, 0], white, this.mats.signUV('ambulance_text'));
          }
          siren.push(['blue', 0, bodyTop + 1.78, L / 2 - 1.3, 0.9]);
        } else {
          const cabinTop = bodyTop + (type === 'police' ? 0.82 : 0.6);
          const z0 = -L / 2 + (type === 'police' ? 0.25 : 0.55);
          const z1 = L / 2 - hood;
          cabin(b, bodyTop, cabinTop, z0, z1, z0 + (type === 'police' ? 0.05 : 0.35), z1 - 0.45, W - 0.06, W - 0.22, glass, type === 'police' ? paint : paint.clone().multiplyScalar(0.95));
          if (type === 'police') {
            for (const s of [-1, 1]) {
              b.box(s * (W / 2 + 0.005), 0.72, 0, 0.01, 0.16, L - 0.4, C('#0d47a1'));
              b.box(s * (W / 2 + 0.006), 0.6, 0, 0.01, 0.07, L - 0.4, C('#c62828'));
              sb.place(s * (W / 2 + 0.02), 0.78, -0.3, s * Math.PI / 2);
              sb.quad([-0.9, 0, 0], [0.9, 0, 0], [0.9, 0.3, 0], [-0.9, 0.3, 0], white, this.mats.signUV('police_text'));
            }
            b.box(0, 1.0, -L / 2 - 0.05, 0.5, 0.5, 0.1, dark); // spare wheel
            siren.push(['red', 0.3, cabinTop + 0.08, z0 + 0.9, 0.5], ['blue', -0.3, cabinTop + 0.08, z0 + 0.9, 0.5]);
          }
          for (const s of [-1, 1]) b.box(s * (W / 2 + 0.08), bodyTop + 0.12, z1 - 0.1, 0.12, 0.1, 0.06, paint); // mirrors
        }
        l.box(0.55, 0.7, L / 2 + 0.02, 0.3, 0.12, 0.04, head);
        l.box(-0.55, 0.7, L / 2 + 0.02, 0.3, 0.12, 0.04, head);
        l.box(0.62, 0.72, -L / 2 - 0.02, 0.22, 0.14, 0.04, red);
        l.box(-0.62, 0.72, -L / 2 - 0.02, 0.22, 0.14, 0.04, red);
        l.box(0, 0.5, -L / 2 - 0.05, 0.4, 0.12, 0.02, C('#fff59d')); // number plate (yellow for commercial look)
        break;
      }
      case 'bus': {
        const [c1, c2] = pick(rng, BUS_LIVERY);
        const p1 = C(c1);
        const p2 = C(c2);
        b.box(0, 1.75, 0, W, 2.6, L, p2);
        b.box(0, 0.75, 0, W + 0.02, 0.6, L, p1);
        b.box(0, 2.9, 0, W - 0.05, 0.25, L - 0.2, C('#e0e0e0'));
        for (const s of [-1, 1]) {
          // window band + stripes
          b.box(s * (W / 2 + 0.005), 2.15, -0.3, 0.01, 0.95, L - 2.4, glass);
          b.box(s * (W / 2 + 0.008), 1.5, 0, 0.01, 0.12, L, p1);
          b.box(s * (W / 2 + 0.008), 2.72, 0, 0.01, 0.1, L, p1);
          for (let i = 0; i < 9; i++) b.box(s * (W / 2 + 0.01), 2.15, -L / 2 + 1.2 + i * 1.05, 0.02, 0.95, 0.08, p2);
        }
        b.box(W / 2 + 0.01, 1.45, 3.6, 0.02, 2.1, 0.95, C('#263238')); // door (left side)
        b.box(0, 2.0, L / 2 + 0.01, W - 0.25, 1.2, 0.02, glass); // windscreen
        b.box(0, 2.0, -L / 2 - 0.01, W - 0.5, 0.8, 0.02, glass);
        b.box(0, 0.5, L / 2 + 0.05, W, 0.35, 0.1, dark);
        wheelHousing(b, spec);
        sb.place(0, 2.72, L / 2 + 0.03, 0);
        sb.quad([-1.0, 0, 0], [1.0, 0, 0], [1.0, 0.32, 0], [-1.0, 0.32, 0], white, this.mats.signUV(`route${variant % 6}`));
        sb.place(W / 2 + 0.03, 2.72, 0.5, Math.PI / 2);
        sb.quad([-2.2, 0, 0], [2.2, 0, 0], [2.2, 0.26, 0], [-2.2, 0.26, 0], white, this.mats.signUV('bus_tnstc'));
        l.box(0.85, 0.85, L / 2 + 0.04, 0.35, 0.16, 0.04, head);
        l.box(-0.85, 0.85, L / 2 + 0.04, 0.35, 0.16, 0.04, head);
        l.box(0.95, 0.9, -L / 2 - 0.03, 0.2, 0.3, 0.04, red);
        l.box(-0.95, 0.9, -L / 2 - 0.03, 0.2, 0.3, 0.04, red);
        l.box(0.9, 2.95, L / 2 + 0.02, 0.1, 0.06, 0.02, amber);
        l.box(-0.9, 2.95, L / 2 + 0.02, 0.1, 0.06, 0.02, amber);
        break;
      }
      case 'truck':
      case 'fire': {
        const fire = type === 'fire';
        const cab = fire ? C('#c62828') : C(pick(rng, TRUCK_CAB));
        const cabZ = L / 2 - 1.1;
        b.box(0, 1.55, cabZ, W, 1.9, 2.0, cab);
        b.box(0, 2.0, cabZ + 1.01, W - 0.3, 0.8, 0.02, glass);
        for (const s of [-1, 1]) b.box(s * (W / 2 + 0.005), 2.05, cabZ + 0.2, 0.01, 0.6, 0.9, glass);
        b.box(0, 0.75, 0, W - 0.3, 0.35, L - 0.5, dark); // chassis
        b.box(0, 0.62, L / 2 + 0.02, W, 0.3, 0.1, fire ? chrome : C('#2b2b2b'));
        if (fire) {
          b.box(0, 1.6, -1.2, W, 1.8, L - 2.6, cab);
          for (const s of [-1, 1]) {
            b.box(s * (W / 2 + 0.01), 1.2, -1.2, 0.01, 0.12, L - 2.6, C('#fdd835'));
            for (let i = 0; i < 4; i++) b.box(s * (W / 2 + 0.012), 1.8, -3.2 + i * 1.1, 0.02, 0.9, 0.9, C('#b71c1c'));
            sb.place(s * (W / 2 + 0.03), 2.2, -1.2, s * Math.PI / 2);
            sb.quad([-1.3, 0, 0], [1.3, 0, 0], [1.3, 0.45, 0], [-1.3, 0.45, 0], white, this.mats.signUV('fire_text'));
          }
          b.box(0, 2.62, -1.2, 0.7, 0.12, L - 2.2, chrome); // ladder rails
          for (let i = 0; i < 10; i++) b.box(0, 2.66, -3.8 + i * 0.55, 0.7, 0.05, 0.05, chrome);
          siren.push(['red', 0.5, 2.6, cabZ, 0.6], ['blue', -0.5, 2.6, cabZ, 0.6]);
        } else {
          // wooden cargo body, typical painted Tamil Nadu lorry
          const wood = C('#a0522d');
          b.box(0, 1.05, -1.1, W, 0.25, L - 2.3, wood);
          for (const s of [-1, 1]) b.box(s * (W / 2 - 0.03), 1.85, -1.1, 0.06, 1.35, L - 2.3, wood);
          b.box(0, 1.85, -L / 2 + 0.18, W, 1.35, 0.06, C('#8b4513'));
          b.box(0, 1.85, -1.1 + (L - 2.3) / 2 - 0.03, W, 1.35, 0.06, C('#8b4513'));
          b.box(0, 2.62, cabZ, W + 0.1, 0.25, 2.2, C(pick(rng, ['#fdd835', '#43a047', '#e53935']))); // decorated cab top
          b.box(0, 1.2, -L / 2 + 0.15, W - 0.2, 0.2, 0.05, C('#fdd835'));
        }
        wheelHousing(b, spec);
        l.box(0.85, 0.95, L / 2 + 0.03, 0.3, 0.16, 0.04, head);
        l.box(-0.85, 0.95, L / 2 + 0.03, 0.3, 0.16, 0.04, head);
        l.box(0.95, 0.9, -L / 2 - 0.02, 0.2, 0.2, 0.04, red);
        l.box(-0.95, 0.9, -L / 2 - 0.02, 0.2, 0.2, 0.04, red);
        break;
      }
      default: break;
    }
    b.setTransform(null);
    sb.setTransform(null);
    const result = {
      spec,
      geometry: b.build(),
      lights: l.vertexCount ? l.build() : null,
      signs: sb.vertexCount ? sb.build() : null,
      siren,
    };
    this.cache.set(key, result);
    return result;
  }

  /** Build a renderable group for a vehicle instance. */
  instance(type, variant, castShadow = true) {
    const m = this.model(type, variant);
    const group = new THREE.Group();
    const real = this.assets?.vehicleModel(type, m.spec);
    let body;
    let spec = m.spec;
    if (real) {
      // realistic authored vehicle: its own body, lights and (usually) wheels
      body = new THREE.Group();
      body.add(real.object);
      if (real.seat) spec = { ...spec, seat: real.seat };
    } else {
      body = new THREE.Mesh(m.geometry, this.bodyMat);
      body.castShadow = castShadow;
      body.receiveShadow = true;
    }
    group.add(body);
    if (!real && m.lights) group.add(new THREE.Mesh(m.lights, this.lightMat));
    if (!real && m.signs) group.add(new THREE.Mesh(m.signs, this.mats.signs));
    const sirens = [];
    for (const [c, x, y, z, w] of m.siren) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.14, 0.25), c === 'red' ? this.sirenRed : this.sirenBlue);
      mesh.position.set(x, y, z);
      mesh.userData.color = c;
      group.add(mesh);
      sirens.push(mesh);
    }
    return { group, body, sirens, spec, ownWheels: !!real?.ownWheels };
  }
}
