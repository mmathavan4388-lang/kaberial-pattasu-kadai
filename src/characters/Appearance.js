// Appearance recipes: a role + seed -> a full look (face cell, skin, hair, outfit,
// accessories, body shape). Seeds are unique per pooled NPC, so the same face/outfit
// combination is never spawned twice at once.
import { mulberry32, pick } from '../core/utils.js';
import { FACE_GROUPS } from './FaceAtlas.js';

const SKIN = ['#8d5524', '#a0673d', '#b27a4f', '#7a4a2a', '#c68a5c', '#6b3e22', '#9a6440', '#b5835a', '#5c3317', '#a8744d'];
const SHIRTS = ['#f5f5f5', '#8fb3d9', '#e8d9b5', '#9e9e9e', '#c5e1a5', '#90caf9', '#ffe082', '#bcaaa4', '#b39ddb', '#80cbc4', '#ef9a9a', '#546e7a', '#5d4037', '#ffffff', '#cfd8dc'];
const PANTS = ['#2b3445', '#37474f', '#4e342e', '#212121', '#5d6b7a', '#8d7b68', '#263238', '#3e2723'];
const SAREE = ['#c2185b', '#d84315', '#6a1b9a', '#2e7d32', '#f9a825', '#1565c0', '#ad1457', '#00838f', '#ef6c00', '#8e24aa', '#b71c1c', '#004d40'];
const BORDER = ['#ffd54f', '#ffca28', '#ffb300', '#e0c070', '#b71c1c', '#1b5e20'];
const LUNGI = ['#1a237e', '#4a148c', '#1b5e20', '#b71c1c', '#006064', '#3e2723'];
const HAIR = ['#0d0a08', '#15100c', '#1c140e', '#0a0a0a', '#2a1a10'];

export const ROLES = [
  'man', 'woman', 'boy', 'girl', 'oldman', 'oldwoman', 'police', 'shop_owner', 'factory_worker',
  'student', 'driver', 'doctor', 'nurse', 'mechanic', 'business_owner', 'security', 'railway',
  'firefighter', 'devotee', 'priest', 'vendor', 'tea_master', 'passenger', 'customer', 'shopper', 'teacher', 'amma',
];

function faceFrom(group, rng) {
  const [a, b] = FACE_GROUPS[group];
  return a + Math.floor(rng() * (b - a + 1));
}

function base(rng, group) {
  const female = group === 'woman' || group === 'girl' || group === 'oldwoman';
  const kid = group === 'boy' || group === 'girl';
  const old = group === 'oldman' || group === 'oldwoman';
  return {
    group, female, kid, old,
    face: faceFrom(group, rng),
    skin: pick(rng, SKIN),
    height: kid ? 1.15 + rng() * 0.3 : female ? 1.5 + rng() * 0.14 : 1.62 + rng() * 0.16,
    width: kid ? 0.9 : 0.92 + rng() * 0.18,
    belly: kid ? 0 : rng() < 0.35 ? rng() * (old ? 0.05 : 0.04) : 0,
    shoulders: female ? 0.92 : 1 + rng() * 0.08,
    stoop: old ? 0.12 + rng() * 0.1 : 0,
    hair: female ? (kid ? 'braid' : rng() < 0.65 ? 'braid' : 'bun') : kid ? 'short' : pick(rng, ['short', 'short', 'side', 'curly', 'side']),
    hairColor: old ? pick(rng, ['#9e9e9e', '#bdbdbd', '#757575', '#e0e0e0']) : pick(rng, HAIR),
    jasmine: female && !kid && rng() < 0.55,
    beard: !female && !kid && rng() < 0.22 ? 'short' : 'none',
    mustache: !female && !kid && rng() < 0.75,
    top: 'shirt', topColor: pick(rng, SHIRTS), innerColor: null, sleeves: rng() < 0.5 ? 0.45 : 1,
    bottom: 'pants', bottomColor: pick(rng, PANTS), border: null,
    shoes: rng() < 0.6 ? 'chappal' : 'shoes', shoeColor: pick(rng, ['#3e2723', '#212121', '#5d4037', '#6d4c41']),
    acc: [],
  };
}

/** Build an appearance for a role. */
export function makeAppearance(role, seed) {
  const rng = mulberry32(seed * 2654435761);
  let group = 'man';
  const femaleRoles = { nurse: 1, amma: 1 };
  const maybeFemale = ['shop_owner', 'factory_worker', 'student', 'doctor', 'devotee', 'vendor', 'passenger', 'customer', 'shopper', 'teacher'];
  if (role === 'woman' || femaleRoles[role]) group = 'woman';
  else if (role === 'boy' || role === 'girl' || role === 'oldman' || role === 'oldwoman') group = role;
  else if (maybeFemale.includes(role) && rng() < 0.45) group = 'woman';
  if ((role === 'passenger' || role === 'devotee' || role === 'shopper' || role === 'customer') && rng() < 0.2) group = rng() < 0.5 ? 'oldman' : 'oldwoman';
  if (role === 'student' && rng() < 0.5) group = rng() < 0.5 ? 'boy' : 'girl';

  const a = base(rng, group);
  a.role = role;

  const saree = () => {
    a.top = 'blouse';
    a.topColor = pick(rng, SAREE);
    a.bottom = 'saree';
    a.bottomColor = rng() < 0.5 ? a.topColor : pick(rng, SAREE);
    a.border = pick(rng, BORDER);
    a.sleeves = 0.3;
    a.shoes = 'chappal';
  };
  const churidar = () => {
    a.top = 'kurta';
    a.topColor = pick(rng, [...SAREE, '#f8bbd0', '#b2dfdb', '#fff59d']);
    a.bottom = 'pants';
    a.bottomColor = pick(rng, ['#fafafa', '#f8bbd0', '#212121', a.topColor]);
    a.sleeves = 0.6;
    a.acc.push('dupatta');
  };
  const traditionalMan = () => {
    a.bottom = rng() < 0.6 ? 'veshti' : 'lungi';
    a.bottomColor = a.bottom === 'veshti' ? '#f4f1e8' : pick(rng, LUNGI);
    a.border = a.bottom === 'veshti' ? pick(rng, ['#c9a227', '#1b5e20', '#b71c1c', '#1a237e']) : null;
    a.shoes = 'chappal';
  };

  if (a.female && !a.kid) {
    if (a.old || rng() < 0.65) saree();
    else churidar();
  }
  if (group === 'oldman') {
    traditionalMan();
    a.topColor = rng() < 0.6 ? '#f4f4f0' : a.topColor;
    if (rng() < 0.4) { a.top = 'banian'; a.topColor = '#f2f2ee'; }
    if (rng() < 0.6) a.acc.push('towel');
    if (rng() < 0.5) a.acc.push('glasses');
    a.hair = rng() < 0.4 ? 'bald' : 'short';
    a.mustache = rng() < 0.8;
  }
  if (group === 'oldwoman') a.hair = 'bun';
  if (group === 'boy') {
    a.top = 'shirt'; a.sleeves = 0.3;
    a.bottom = 'shorts';
  }
  if (group === 'girl') {
    a.top = 'shirt'; a.sleeves = 0.3;
    a.bottom = 'skirt';
    a.bottomColor = pick(rng, ['#1a237e', '#4a148c', '#b71c1c', '#2e7d32']);
  }
  if (group === 'man' && role === 'man' && rng() < 0.4) traditionalMan();

  switch (role) {
    case 'police':
      a.top = 'shirt'; a.topColor = '#b39b6a'; a.bottom = 'pants'; a.bottomColor = '#a88f5e'; a.sleeves = 0.45;
      a.shoes = 'shoes'; a.shoeColor = '#1a1a1a'; a.acc.push('cap_police', 'belt'); a.mustache = rng() < 0.9; break;
    case 'shop_owner':
      if (!a.female) { a.top = rng() < 0.6 ? 'banian' : 'shirt'; a.topColor = a.top === 'banian' ? '#f2f2ee' : a.topColor; traditionalMan(); a.acc.push('towel', 'vibhuti'); if (rng() < 0.4) a.acc.push('goldchain'); }
      break;
    case 'tea_master':
      a.top = 'banian'; a.topColor = '#f0efe6'; a.bottom = 'lungi'; a.bottomColor = pick(rng, LUNGI); a.shoes = 'chappal'; a.acc.push('towel'); break;
    case 'factory_worker':
      if (!a.female) { a.topColor = pick(rng, ['#8d9ba8', '#a1887f', '#90a4ae', '#bcaaa4']); if (rng() < 0.5) traditionalMan(); if (rng() < 0.4) a.acc.push('headcloth'); }
      break;
    case 'student':
      if (!a.female && !a.kid) { a.top = 'shirt'; a.bottom = 'pants'; a.bottomColor = pick(rng, ['#1a237e', '#263238', '#37474f']); a.shoes = 'shoes'; }
      a.acc.push('bag'); break;
    case 'boy': case 'girl':
      if (rng() < 0.6) { a.topColor = '#f5f5f5'; a.acc.push('bag'); a.bottomColor = a.bottom === 'shorts' ? '#1a237e' : a.bottomColor; }
      break;
    case 'driver':
      a.top = 'shirt'; a.topColor = '#b8a27a'; a.sleeves = 0.45; if (rng() < 0.5) traditionalMan(); break;
    case 'doctor':
      a.acc.push('coat', 'stethoscope'); if (rng() < 0.5) a.acc.push('glasses');
      if (!a.female) { a.top = 'shirt'; a.bottom = 'pants'; a.shoes = 'shoes'; }
      break;
    case 'nurse':
      a.top = 'shirt'; a.topColor = '#fafafa'; a.bottom = 'skirt'; a.bottomColor = '#fafafa'; a.sleeves = 0.3; a.acc.push('nursecap'); a.shoes = 'shoes'; a.shoeColor = '#f5f5f5'; break;
    case 'mechanic':
      a.top = 'shirt'; a.topColor = '#243b6b'; a.bottom = 'pants'; a.bottomColor = '#243b6b'; a.sleeves = 0.45; a.acc.push('grease'); break;
    case 'business_owner':
      a.top = 'shirt'; a.topColor = '#fbfbf7'; a.bottom = 'veshti'; a.bottomColor = '#f7f5ee'; a.border = '#c9a227';
      a.acc.push('goldchain', 'watch', 'vibhuti'); a.belly = 0.03 + rng() * 0.03; if (rng() < 0.5) a.acc.push('glasses'); break;
    case 'security':
      a.top = 'shirt'; a.topColor = '#5c6b80'; a.bottom = 'pants'; a.bottomColor = '#2c3440'; a.acc.push('cap_security'); a.shoes = 'shoes'; break;
    case 'railway':
      a.top = 'shirt'; a.topColor = '#3f5f8a'; a.bottom = 'pants'; a.bottomColor = '#2b3445'; a.acc.push('vest'); a.shoes = 'shoes'; break;
    case 'firefighter':
      a.top = 'shirt'; a.topColor = '#34404d'; a.bottom = 'pants'; a.bottomColor = '#34404d'; a.sleeves = 1; a.acc.push('helmet_fire', 'reflect'); a.shoes = 'shoes'; break;
    case 'priest':
      a.top = 'bare'; a.bottom = 'veshti'; a.bottomColor = '#f7f2e4'; a.border = '#c9a227'; a.acc.push('thread', 'vibhuti'); a.hair = rng() < 0.5 ? 'bald' : 'short'; a.shoes = 'none'; a.mustache = false; break;
    case 'devotee':
      if (!a.female) { traditionalMan(); a.acc.push('vibhuti'); }
      a.shoes = 'none'; break;
    case 'vendor':
      if (!a.female) { traditionalMan(); a.acc.push('towel'); }
      break;
    case 'teacher':
      if (!a.female) { a.top = 'shirt'; a.topColor = pick(rng, ['#e3f2fd', '#fff8e1', '#f1f8e9']); a.bottom = 'pants'; a.shoes = 'shoes'; }
      if (rng() < 0.5) a.acc.push('glasses');
      break;
    case 'amma':
      a.group = 'woman'; a.face = 44; a.hair = 'bun'; a.hairColor = '#2a2522'; a.height = 1.55; a.belly = 0.03;
      a.top = 'blouse'; a.topColor = '#6a1b9a'; a.bottom = 'saree'; a.bottomColor = '#6a1b9a'; a.border = '#ffca28'; a.jasmine = true; break;
    default: break;
  }
  if (a.top === 'banian') a.sleeves = 0;
  if (a.top === 'bare') a.sleeves = 0;
  return a;
}

/** LEOMATHAV — hero look (reference: open olive utility shirt over a beige tee,
 *  pompadour hair, full short beard, cross pendant). */
export function heroAppearance() {
  return {
    group: 'hero', role: 'hero', female: false, kid: false, old: false, hero: true,
    face: 0, skin: '#a8714b', height: 1.8, width: 1.02, belly: 0, shoulders: 1.1, stoop: 0,
    hair: 'pompadour', hairColor: '#0f0b09', jasmine: false,
    beard: 'full', mustache: true,
    top: 'openshirt', topColor: '#5f6b45', innerColor: '#c9b89b', sleeves: 0.62,
    bottom: 'pants', bottomColor: '#2a3242', border: null,
    shoes: 'shoes', shoeColor: '#4a3426',
    acc: ['cross', 'pockets', 'watch', 'collar'],
  };
}
