// A single texture atlas of painted face details (brows, eye shadows, lips, beard
// shading, wrinkles, pottu...). It is multiplied with per-character skin colour, so
// 64 cells x many skin tones gives lots of distinct faces with ONE material.
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';

export const GRID = 8;
// cell ranges per face group
export const FACE_GROUPS = {
  hero: [0, 0],
  man: [1, 27],
  woman: [28, 45],
  boy: [46, 51],
  girl: [52, 55],
  oldman: [56, 59],
  oldwoman: [60, 63],
};

// Normalised face layout (u right, v up) shared with the head UV projection.
export const FACE = { eyeY: 0.588, eyeX: 0.155, browY: 0.685, noseY: 0.44, mouthY: 0.293, foreheadY: 0.8 };

export class FaceAtlas {
  constructor(size = 2048) {
    this.size = size;
    this.cell = size / GRID;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    this.canvas = c;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, size, size);
    for (let i = 0; i < GRID * GRID; i++) this.drawCell(g, i);
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.texture.needsUpdate = true;
  }

  group(i) {
    for (const [k, [a, b]] of Object.entries(FACE_GROUPS)) if (i >= a && i <= b) return k;
    return 'man';
  }

  /** UV rectangle of a cell: [u0, v0, u1, v1] */
  cellUV(i) {
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    const pad = 1 / this.size;
    return [col / GRID + pad, 1 - (row + 1) / GRID + pad, (col + 1) / GRID - pad, 1 - row / GRID - pad];
  }

  drawCell(g, i) {
    const S = this.cell;
    const x0 = (i % GRID) * S;
    const y0 = Math.floor(i / GRID) * S;
    const grp = this.group(i);
    const rng = mulberry32(i * 7717 + 3);
    const P = (u, v) => [x0 + u * S, y0 + (1 - v) * S];
    const female = grp === 'woman' || grp === 'girl' || grp === 'oldwoman';
    const old = grp === 'oldman' || grp === 'oldwoman';
    const kid = grp === 'boy' || grp === 'girl';
    const hero = grp === 'hero';

    g.save();
    g.beginPath();
    g.rect(x0, y0, S, S);
    g.clip();
    // soft shading towards the sides (gives the sphere a face-like volume)
    const [cx, cy] = P(0.5, 0.5);
    const rg = g.createRadialGradient(cx, cy, S * 0.12, cx, cy, S * 0.5);
    rg.addColorStop(0, '#ffffff');
    rg.addColorStop(0.7, '#f4efec');
    rg.addColorStop(1, '#ffffff');
    g.fillStyle = rg;
    g.fillRect(x0, y0, S, S);

    const ex = FACE.eyeX + (rng() - 0.5) * 0.015;
    // eye sockets
    for (const s of [-1, 1]) {
      const [x, y] = P(0.5 + s * ex, FACE.eyeY);
      const eg = g.createRadialGradient(x, y, 0, x, y, S * 0.085);
      eg.addColorStop(0, `rgba(90,60,50,${hero ? 0.55 : 0.4})`);
      eg.addColorStop(1, 'rgba(90,60,50,0)');
      g.fillStyle = eg;
      g.beginPath();
      g.ellipse(x, y, S * 0.09, S * 0.065, 0, 0, Math.PI * 2);
      g.fill();
      // lash line
      g.strokeStyle = `rgba(20,12,10,${female ? 0.95 : 0.7})`;
      g.lineWidth = S * (female ? 0.012 : 0.008);
      g.beginPath();
      g.ellipse(x, y + S * 0.005, S * 0.045, S * 0.022, 0, Math.PI * 1.05, Math.PI * 1.95);
      g.stroke();
      if (female) {
        // kajal wing
        g.beginPath();
        g.moveTo(x + s * S * 0.045, y - S * 0.004);
        g.lineTo(x + s * S * 0.062, y - S * 0.014);
        g.stroke();
      }
      if (old) {
        g.strokeStyle = 'rgba(70,45,35,0.35)';
        g.lineWidth = S * 0.005;
        for (let k = 0; k < 3; k++) {
          g.beginPath();
          g.moveTo(x + s * S * 0.06, y + S * (k - 1) * 0.015);
          g.lineTo(x + s * S * 0.09, y + S * (k - 1) * 0.022);
          g.stroke();
        }
      }
    }
    // eyebrows
    const browThick = hero ? 0.03 : female ? 0.014 + rng() * 0.006 : 0.02 + rng() * 0.014;
    const browCol = old ? 'rgba(120,110,100,0.9)' : 'rgba(22,14,10,0.95)';
    for (const s of [-1, 1]) {
      const [bx, by] = P(0.5 + s * (ex + 0.005), FACE.browY + (rng() - 0.5) * 0.01);
      g.strokeStyle = browCol;
      g.lineCap = 'round';
      g.lineWidth = S * browThick;
      g.beginPath();
      const arch = hero ? 0.012 : female ? 0.02 : 0.01;
      g.moveTo(bx - s * S * 0.06, by + S * 0.006);
      g.quadraticCurveTo(bx, by - S * arch, bx + s * S * 0.065, by + S * (hero ? 0.012 : 0.004));
      g.stroke();
    }
    // nose shading & nostrils
    const [nx, ny] = P(0.5, FACE.noseY);
    g.fillStyle = 'rgba(110,70,55,0.25)';
    g.beginPath();
    g.ellipse(nx - S * 0.03, ny + S * 0.02, S * 0.012, S * 0.07, 0.1, 0, Math.PI * 2);
    g.ellipse(nx + S * 0.03, ny + S * 0.02, S * 0.012, S * 0.07, -0.1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(40,20,15,0.7)';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(nx + s * S * 0.022, ny + S * 0.045, S * 0.012, S * 0.007, 0, 0, Math.PI * 2);
      g.fill();
    }
    // nasolabial folds
    g.strokeStyle = `rgba(90,55,45,${old ? 0.45 : 0.18})`;
    g.lineWidth = S * 0.006;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(nx + s * S * 0.05, ny + S * 0.03);
      g.quadraticCurveTo(nx + s * S * 0.085, ny + S * 0.12, nx + s * S * 0.075, ny + S * 0.18);
      g.stroke();
    }
    // lips
    const [mx, my] = P(0.5, FACE.mouthY);
    const lw = S * (0.07 + rng() * 0.015);
    g.fillStyle = female ? `rgba(${150 + rng() * 40},50,60,0.85)` : 'rgba(120,65,60,0.6)';
    g.beginPath();
    g.moveTo(mx - lw, my);
    g.quadraticCurveTo(mx - lw * 0.4, my - S * 0.03, mx, my - S * 0.018);
    g.quadraticCurveTo(mx + lw * 0.4, my - S * 0.03, mx + lw, my);
    g.quadraticCurveTo(mx, my + S * 0.035, mx - lw, my);
    g.fill();
    g.strokeStyle = 'rgba(40,15,15,0.8)';
    g.lineWidth = S * 0.005;
    g.beginPath();
    g.moveTo(mx - lw, my);
    g.quadraticCurveTo(mx, my + S * 0.004, mx + lw, my);
    g.stroke();

    // facial hair (painted layer; thick beards also get geometry)
    if (!female && !kid) {
      const beard = hero ? 1 : rng();
      if (beard > 0.35) {
        const density = hero ? 1800 : 500 + beard * 1200;
        const alpha = hero ? 0.5 : old ? 0.25 : 0.35;
        for (let k = 0; k < density; k++) {
          const a = rng() * Math.PI;
          const r = 0.12 + rng() * 0.25;
          const u = 0.5 + Math.cos(a) * r * 0.9;
          const v = FACE.mouthY + 0.02 - Math.sin(a) * r * 0.7 + 0.1 * (1 - Math.sin(a));
          if (v > FACE.noseY - 0.02) continue;
          const [px, py] = P(u, v);
          g.fillStyle = old ? `rgba(150,145,140,${alpha})` : `rgba(15,10,8,${alpha})`;
          g.fillRect(px, py, S * 0.006, S * 0.01);
        }
        // mustache shadow
        g.fillStyle = old ? 'rgba(140,135,130,0.5)' : 'rgba(15,10,8,0.55)';
        g.beginPath();
        g.ellipse(mx, my - S * 0.045, lw * 1.05, S * 0.02, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
    if (female || rng() < 0.25) {
      // cheeks
      for (const s of [-1, 1]) {
        const [x, y] = P(0.5 + s * 0.2, 0.43);
        const cg = g.createRadialGradient(x, y, 0, x, y, S * 0.08);
        cg.addColorStop(0, female ? 'rgba(220,120,120,0.18)' : 'rgba(160,110,100,0.1)');
        cg.addColorStop(1, 'rgba(220,120,120,0)');
        g.fillStyle = cg;
        g.fillRect(x - S * 0.1, y - S * 0.1, S * 0.2, S * 0.2);
      }
    }
    // pottu / kumkum
    if ((female && rng() < 0.85) || (!female && !kid && rng() < 0.2)) {
      const [px, py] = P(0.5, FACE.foreheadY - (female ? 0.07 : 0.03));
      g.fillStyle = female ? '#b0001a' : '#c2181b';
      g.beginPath();
      if (female) g.arc(px, py, S * 0.014, 0, Math.PI * 2);
      else g.ellipse(px, py, S * 0.006, S * 0.03, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (old) {
      g.strokeStyle = 'rgba(80,50,40,0.28)';
      g.lineWidth = S * 0.005;
      for (let k = 0; k < 3; k++) {
        const [fx, fy] = P(0.5, 0.76 + k * 0.03);
        g.beginPath();
        g.moveTo(fx - S * 0.1, fy);
        g.quadraticCurveTo(fx, fy - S * 0.01, fx + S * 0.1, fy);
        g.stroke();
      }
    }
    // subtle skin pores / variation
    for (let k = 0; k < 900; k++) {
      g.fillStyle = `rgba(120,80,60,${rng() * 0.05})`;
      g.fillRect(x0 + rng() * S, y0 + rng() * S, 2, 2);
    }
    g.restore();
  }
}
