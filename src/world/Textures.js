// Procedurally painted textures (no downloads => instant loading).
// Facade atlas is tinted per-building through vertex colours, so one material
// serves every building in the city (few draw calls, many looks).
import * as THREE from 'three';
import { mulberry32 } from '../core/utils.js';
import { LANDMARKS, STATIONS } from './MapData.js';

export const FACADE_ROWS = 8;
export const ROW = { SHUTTER: 0, SHOP: 1, WIN_A: 2, WIN_B: 3, HOUSE: 4, BRICK: 5, SHED: 6, PLAIN: 7 };

export const TAMIL_FONT = '"Noto Sans Tamil", "Latha", "Tamil Sangam MN", sans-serif';

export async function loadFonts() {
  if (!document.fonts?.load) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load(`700 40px "Noto Sans Tamil"`, 'சிவகாசி'),
        document.fonts.load(`400 40px "Noto Sans Tamil"`, 'சிவகாசி'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* offline: system font fallback */ }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function noise(ctx, w, h, amount, rng, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rng() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rng() * w, rng() * h, 1 + rng() * 3, 1 + rng() * 3);
  }
}

function stains(ctx, x, y, w, h, rng, n = 6) {
  for (let i = 0; i < n; i++) {
    const sx = x + rng() * w;
    const sw = 4 + rng() * 20;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, 'rgba(60,50,40,0.18)');
    g.addColorStop(1, 'rgba(60,50,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx, y, sw, h * (0.3 + rng() * 0.7));
  }
}

function finish(tex, anisotropy, repeat = true) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export class TextureFactory {
  constructor(preset) {
    this.size = preset.textureSize;
    this.aniso = preset.anisotropy;
    this.rng = mulberry32(1234);
  }

  // ------------------------------------------------------------ facades
  buildFacades() {
    const S = this.size;
    const rowH = S / FACADE_ROWS;
    const bayW = S / 4;
    const [c, g] = canvas(S, S);
    const [ce, ge] = canvas(S, S);
    const rng = this.rng;
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, S, S);

    for (let r = 0; r < FACADE_ROWS; r++) {
      const y = r * rowH;
      // plaster base (near white so vertex colour tint shows through)
      g.fillStyle = r === ROW.BRICK ? '#b4583a' : r === ROW.SHED ? '#c9ccd0' : '#f4f1ea';
      g.fillRect(0, y, S, rowH);
      noise(g, S, rowH, 900, rng, 0.06);
      g.save();
      g.translate(0, y);
      for (let b = 0; b < 4; b++) {
        const x = b * bayW;
        this.drawBay(g, ge, r, x, bayW, rowH, rng, y);
      }
      g.restore();
      stains(g, 0, y, S, rowH, rng, r === ROW.PLAIN ? 14 : 6);
      // floor slab band at the bottom of each floor
      if (r !== ROW.BRICK && r !== ROW.SHED) {
        g.fillStyle = 'rgba(0,0,0,0.10)';
        g.fillRect(0, y + rowH - rowH * 0.05, S, rowH * 0.05);
      }
    }
    this.facade = finish(new THREE.CanvasTexture(c), this.aniso);
    this.facadeEmissive = finish(new THREE.CanvasTexture(ce), this.aniso);
    return { map: this.facade, emissive: this.facadeEmissive };
  }

  drawBay(g, ge, row, x, w, h, rng, yAbs) {
    const u = w / 256;
    const win = (wx, wy, ww, wh, style) => {
      // sunshade shadow, frame, glass / shutters, grill
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(wx - 6 * u, wy - 10 * u, ww + 12 * u, 8 * u);
      g.fillStyle = '#5b5046';
      g.fillRect(wx - 3 * u, wy - 3 * u, ww + 6 * u, wh + 6 * u);
      if (style === 0) {
        g.fillStyle = rng() < 0.5 ? '#2f6f63' : '#2d4f7a';
        g.fillRect(wx, wy, ww / 2 - 1, wh);
        g.fillRect(wx + ww / 2 + 1, wy, ww / 2 - 1, wh);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        for (let i = 0; i < 4; i++) g.fillRect(wx + 3, wy + (i * wh) / 4 + 4, ww - 6, 2);
      } else {
        const gr = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
        gr.addColorStop(0, '#26303a');
        gr.addColorStop(0.5, '#4d6272');
        gr.addColorStop(1, '#1d242b');
        g.fillStyle = gr;
        g.fillRect(wx, wy, ww, wh);
      }
      g.strokeStyle = '#1c1c1c';
      g.lineWidth = Math.max(1, 2 * u);
      for (let i = 1; i < 5; i++) {
        g.beginPath();
        g.moveTo(wx + (i * ww) / 5, wy);
        g.lineTo(wx + (i * ww) / 5, wy + wh);
        g.stroke();
      }
      const lit = rng() < 0.45;
      ge.fillStyle = lit ? (rng() < 0.8 ? (rng() < 0.5 ? '#ffc27a' : '#ffb35c') : '#e2f0ff') : '#000';
      ge.fillRect(x + (wx - x), yAbs + wy, ww, wh);
    };

    switch (row) {
      case ROW.SHUTTER: {
        // rolling shutter + frame
        const sx = x + 14 * u, sw = w - 28 * u, sy = h * 0.18, sh = h * 0.82;
        const open = rng() < 0.55;
        if (open) {
          g.fillStyle = '#2a2622';
          g.fillRect(sx, sy, sw, sh);
          this.drawGoods(g, sx, sy, sw, sh, rng);
          ge.fillStyle = '#ffe2a8';
          ge.fillRect(sx, yAbs + sy, sw, sh);
          g.fillStyle = '#8d9398';
          g.fillRect(sx, sy, sw, sh * 0.14);
        } else {
          for (let i = 0; i < 26; i++) {
            g.fillStyle = i % 2 ? '#9aa0a4' : '#80868b';
            g.fillRect(sx, sy + (i * sh) / 26, sw, sh / 26);
          }
          g.fillStyle = 'rgba(40,30,20,0.25)';
          g.fillRect(sx, sy + sh * 0.6, sw, sh * 0.4);
        }
        g.fillStyle = '#e6e0d6';
        g.fillRect(x, 0, w, sy - 2 * u);
        break;
      }
      case ROW.SHOP: {
        const sx = x + 10 * u, sw = w - 20 * u, sy = h * 0.2, sh = h * 0.8;
        g.fillStyle = '#332b24';
        g.fillRect(sx, sy, sw, sh);
        this.drawGoods(g, sx, sy, sw, sh, rng);
        g.fillStyle = '#7b6a55';
        g.fillRect(sx, sy + sh * 0.72, sw, sh * 0.28);
        ge.fillStyle = '#ffd89a';
        ge.fillRect(sx, yAbs + sy, sw, sh * 0.72);
        break;
      }
      case ROW.WIN_A:
        win(x + 60 * u, h * 0.25, 136 * u, h * 0.5, 0);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x + 50 * u, h * 0.2, 156 * u, 4 * u);
        break;
      case ROW.WIN_B:
        win(x + 48 * u, h * 0.22, 160 * u, h * 0.55, 1);
        if (rng() < 0.4) {
          g.fillStyle = '#e8e8e6';
          g.fillRect(x + 200 * u, h * 0.5, 44 * u, 30 * u); // AC outdoor unit
          g.fillStyle = '#777';
          g.beginPath();
          g.arc(x + 222 * u, h * 0.5 + 15 * u, 11 * u, 0, Math.PI * 2);
          g.fill();
        }
        break;
      case ROW.HOUSE: {
        if (rng() < 0.5) {
          g.fillStyle = '#6b3f22';
          g.fillRect(x + 20 * u, h * 0.22, 80 * u, h * 0.78);
          g.fillStyle = '#4e2c16';
          g.fillRect(x + 26 * u, h * 0.26, 32 * u, h * 0.7);
          g.fillRect(x + 62 * u, h * 0.26, 32 * u, h * 0.7);
          // kolam in front of door
          g.strokeStyle = 'rgba(255,255,255,0.8)';
          g.lineWidth = 2 * u;
          g.beginPath();
          g.arc(x + 60 * u, h * 0.97, 18 * u, Math.PI, 0);
          g.stroke();
          win(x + 140 * u, h * 0.3, 90 * u, h * 0.4, 0);
        } else {
          win(x + 30 * u, h * 0.3, 90 * u, h * 0.4, 0);
          win(x + 140 * u, h * 0.3, 90 * u, h * 0.4, 0);
        }
        break;
      }
      case ROW.BRICK: {
        const bh = h / 16;
        for (let i = 0; i < 16; i++) {
          const off = i % 2 ? w / 16 : 0;
          for (let j = -1; j < 8; j++) {
            const v = 150 + Math.floor(rng() * 60);
            g.fillStyle = `rgb(${v},${Math.floor(v * 0.45)},${Math.floor(v * 0.3)})`;
            g.fillRect(x + off + (j * w) / 8 + 1, i * bh + 1, w / 8 - 2, bh - 2);
          }
        }
        if (rng() < 0.5) {
          g.fillStyle = '#3b2e24';
          g.fillRect(x + w * 0.35, h * 0.35, w * 0.3, h * 0.65);
        }
        break;
      }
      case ROW.SHED: {
        for (let i = 0; i < 32; i++) {
          g.fillStyle = i % 2 ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)';
          g.fillRect(x + (i * w) / 32, 0, w / 64, h);
        }
        g.fillStyle = '#2c3a44';
        g.fillRect(x + 30 * u, h * 0.08, w - 60 * u, h * 0.16);
        ge.fillStyle = rng() < 0.5 ? '#ffe6b0' : '#000';
        ge.fillRect(x + 30 * u, yAbs + h * 0.08, w - 60 * u, h * 0.16);
        g.fillStyle = 'rgba(90,60,30,0.35)';
        g.fillRect(x, h * 0.85, w, h * 0.15);
        break;
      }
      case ROW.PLAIN:
      default:
        if (rng() < 0.6) win(x + 100 * u, h * 0.3, 56 * u, h * 0.35, 1);
        break;
    }
  }

  drawGoods(g, sx, sy, sw, sh, rng) {
    const shelves = 4;
    for (let s = 0; s < shelves; s++) {
      const yy = sy + sh * 0.15 + (s * sh * 0.8) / shelves;
      g.fillStyle = '#5a4632';
      g.fillRect(sx + 4, yy + sh * 0.17, sw - 8, 3);
      for (let k = 0; k < 14; k++) {
        const hue = Math.floor(rng() * 360);
        g.fillStyle = `hsl(${hue},${55 + rng() * 35}%,${40 + rng() * 25}%)`;
        const bw = sw / 16;
        g.fillRect(sx + 6 + k * (sw - 12) / 14, yy + sh * 0.17 - sh * (0.06 + rng() * 0.1), bw * 0.8, sh * (0.06 + rng() * 0.1));
      }
    }
  }

  /** Tileable 4 bays x 4 floors facade used by distant (low LOD) buildings. */
  buildLowFacade() {
    const S = 256;
    const [c, g] = canvas(S, S);
    const [ce, ge] = canvas(S, S);
    const rng = mulberry32(55);
    g.fillStyle = '#f1ede4';
    g.fillRect(0, 0, S, S);
    noise(g, S, S, 1500, rng, 0.07);
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, S, S);
    const cell = S / 4;
    for (let fy = 0; fy < 4; fy++) {
      for (let bx = 0; bx < 4; bx++) {
        const x = bx * cell;
        const y = fy * cell;
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.fillRect(x + cell * 0.18, y + cell * 0.22, cell * 0.64, cell * 0.06);
        g.fillStyle = rng() < 0.5 ? '#2c3d4c' : '#35505c';
        g.fillRect(x + cell * 0.24, y + cell * 0.3, cell * 0.52, cell * 0.42);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(x + cell * 0.24, y + cell * 0.3, cell * 0.52, cell * 0.06);
        if (rng() < 0.45) {
          ge.fillStyle = rng() < 0.82 ? '#ffbe6e' : '#d8eeff';
          ge.fillRect(x + cell * 0.24, y + cell * 0.3, cell * 0.52, cell * 0.42);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.fillRect(0, (fy + 1) * cell - 3, S, 3);
    }
    // keep the top-left texel area plain for windowless sheds
    g.fillStyle = '#e9e5dc';
    g.fillRect(0, 0, 6, 6);
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, 6, 6);
    return { map: finish(new THREE.CanvasTexture(c), this.aniso), emissive: finish(new THREE.CanvasTexture(ce), this.aniso) };
  }

  // ------------------------------------------------------------ signs
  buildSigns() {
    const S = this.size;
    const cols = 4;
    const rows = 32;
    const cw = S / cols;
    const ch = S / rows;
    const [c, g] = canvas(S, S);
    const [ce, ge] = canvas(S, S);
    ge.fillStyle = '#000';
    ge.fillRect(0, 0, S, S);
    this.signCells = new Map();
    let idx = 0;
    const add = (key, draw, glow = 0.5) => {
      if (idx >= cols * rows) return;
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const x = col * cw;
      const y = row * ch;
      g.save();
      g.beginPath();
      g.rect(x, y, cw, ch);
      g.clip();
      draw(g, x, y, cw, ch);
      g.restore();
      ge.globalAlpha = glow;
      ge.drawImage(c, x, y, cw, ch, x, y, cw, ch);
      ge.globalAlpha = 1;
      const pad = 1 / S;
      this.signCells.set(key, {
        u0: x / S + pad, u1: (x + cw) / S - pad,
        v0: 1 - (y + ch) / S + pad, v1: 1 - y / S - pad,
      });
      idx++;
    };

    const board = (ta, en, bg, fg, sub = '#fff', border = null) => (gg, x, y, w, h) => {
      const gr = gg.createLinearGradient(0, y, 0, y + h);
      gr.addColorStop(0, bg[0]);
      gr.addColorStop(1, bg[1]);
      gg.fillStyle = gr;
      gg.fillRect(x, y, w, h);
      if (border) {
        gg.strokeStyle = border;
        gg.lineWidth = h * 0.06;
        gg.strokeRect(x + h * 0.05, y + h * 0.05, w - h * 0.1, h - h * 0.1);
      }
      gg.fillStyle = fg;
      gg.textAlign = 'center';
      gg.textBaseline = 'middle';
      let fs = h * (en ? 0.42 : 0.55);
      gg.font = `700 ${fs}px ${TAMIL_FONT}`;
      while (gg.measureText(ta).width > w * 0.92 && fs > 6) {
        fs *= 0.92;
        gg.font = `700 ${fs}px ${TAMIL_FONT}`;
      }
      gg.fillText(ta, x + w / 2, y + h * (en ? 0.4 : 0.52));
      if (en) {
        gg.fillStyle = sub;
        gg.font = `600 ${h * 0.2}px "Segoe UI", Arial, sans-serif`;
        gg.fillText(en.toUpperCase(), x + w / 2, y + h * 0.8);
      }
    };

    const palettes = [
      [['#c0151b', '#8e0d12'], '#ffe45c'], [['#0b4fa3', '#07366f'], '#ffffff'],
      [['#f6c21c', '#e0a409'], '#8a0e0e'], [['#17813d', '#0c5a29'], '#fff7c2'],
      [['#7b1fa2', '#4a126a'], '#ffffff'], [['#ff6f00', '#d15400'], '#ffffff'],
      [['#fafafa', '#e0e0e0'], '#b3121b'], [['#101010', '#303030'], '#ffcf33'],
    ];
    this.shopSigns = [];
    SHOP_NAMES.forEach(([ta, en], i) => {
      const [bg, fg] = palettes[i % palettes.length];
      const key = `shop${i}`;
      add(key, board(ta, en, bg, fg, fg === '#8a0e0e' ? '#5a0a0a' : '#fff'), 0.55);
      this.shopSigns.push(key);
    });
    for (const l of LANDMARKS) {
      add(`lm_${l.id}`, board(l.ta, l.en, ['#12306b', '#0a1f47'], '#ffffff', '#ffd54f', '#ffd54f'), 0.6);
    }
    add('lm_police_board', board('காவல் நிலையம்', 'Police Station', ['#c62828', '#1565c0'], '#ffffff'), 0.6);
    add('lm_hospital_cross', (gg, x, y, w, h) => {
      gg.fillStyle = '#fff';
      gg.fillRect(x, y, w, h);
      gg.fillStyle = '#d50000';
      gg.fillRect(x + w / 2 - h * 0.12, y + h * 0.1, h * 0.24, h * 0.8);
      gg.fillRect(x + w / 2 - h * 0.4, y + h * 0.38, h * 0.8, h * 0.24);
    }, 0.8);
    for (const s of STATIONS) {
      add(`station_${s.id}`, (gg, x, y, w, h) => {
        gg.fillStyle = '#ffd400';
        gg.fillRect(x, y, w, h);
        gg.strokeStyle = '#111';
        gg.lineWidth = h * 0.05;
        gg.strokeRect(x + 3, y + 3, w - 6, h - 6);
        gg.fillStyle = '#111';
        gg.textAlign = 'center';
        gg.textBaseline = 'middle';
        gg.font = `700 ${h * 0.42}px ${TAMIL_FONT}`;
        gg.fillText(s.ta, x + w / 2, y + h * 0.38);
        gg.font = `800 ${h * 0.26}px Arial, sans-serif`;
        gg.fillText(s.en, x + w / 2, y + h * 0.78);
      }, 0.3);
    }
    BANNERS.forEach(([ta, en], i) => {
      const bg = [['#ff9800', '#e65100'], ['#ad1457', '#6a0f3a'], ['#1b5e20', '#0d3d12'], ['#ffeb3b', '#fbc02d']][i % 4];
      add(`banner${i}`, board(ta, en, bg, i % 4 === 3 ? '#b71c1c' : '#fff', i % 4 === 3 ? '#b71c1c' : '#fff', '#fff'), 0.4);
    });
    add('warn_smoke', board('புகை பிடிக்காதே!', 'No Smoking — Explosives', ['#ffeb3b', '#fdd835'], '#b71c1c', '#b71c1c', '#b71c1c'), 0.2);
    add('warn_danger', board('அபாயம் — வெடிபொருள் பகுதி', 'Danger: Explosive Zone', ['#d32f2f', '#b71c1c'], '#fff', '#fff', '#fff'), 0.2);
    ROUTES.forEach((r, i) => {
      add(`route${i}`, (gg, x, y, w, h) => {
        gg.fillStyle = '#0a0a0a';
        gg.fillRect(x, y, w, h);
        gg.fillStyle = '#ff9d1a';
        gg.textAlign = 'center';
        gg.textBaseline = 'middle';
        gg.font = `700 ${h * 0.5}px ${TAMIL_FONT}`;
        gg.fillText(r, x + w / 2, y + h * 0.55);
      }, 1);
    });
    add('police_text', board('காவல்  POLICE', null, ['#f5f5f5', '#e0e0e0'], '#0d47a1'), 0.1);
    add('ambulance_text', board('108 ஆம்புலன்ஸ்', null, ['#ffffff', '#eeeeee'], '#c62828'), 0.1);
    add('fire_text', board('தீயணைப்பு', null, ['#c62828', '#b71c1c'], '#ffffff'), 0.1);
    add('tea_board', board('கண்ணன் டீ ஸ்டால்', 'Tea • Coffee • Vada', ['#1b5e20', '#0d3d12'], '#ffeb3b'), 0.6);
    add('bus_tnstc', board('தமிழ்நாடு அரசுப் போக்குவரத்துக் கழகம்', null, ['#e8e8e8', '#cfcfcf'], '#0d47a1'), 0.05);

    this.signs = finish(new THREE.CanvasTexture(c), this.aniso, false);
    this.signsEmissive = finish(new THREE.CanvasTexture(ce), this.aniso, false);
    return { map: this.signs, emissive: this.signsEmissive, cells: this.signCells, shopSigns: this.shopSigns };
  }

  // ------------------------------------------------------------ ground / roads
  buildRoad(marked) {
    const [c, g] = canvas(256, 512);
    const rng = mulberry32(marked ? 77 : 78);
    g.fillStyle = marked ? '#4a4a4c' : '#5a5550';
    g.fillRect(0, 0, 256, 512);
    noise(g, 256, 512, 5000, rng, 0.12);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(30,30,30,${0.1 + rng() * 0.15})`;
      g.beginPath();
      g.ellipse(rng() * 256, rng() * 512, 10 + rng() * 30, 20 + rng() * 60, rng() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // dusty worn edges typical of Tamil Nadu roads
    const eg = g.createLinearGradient(0, 0, 256, 0);
    eg.addColorStop(0, 'rgba(160,120,80,0.65)');
    eg.addColorStop(0.08, 'rgba(160,120,80,0)');
    eg.addColorStop(0.92, 'rgba(160,120,80,0)');
    eg.addColorStop(1, 'rgba(160,120,80,0.65)');
    g.fillStyle = eg;
    g.fillRect(0, 0, 256, 512);
    if (marked) {
      g.fillStyle = 'rgba(245,245,235,0.85)';
      g.fillRect(14, 0, 5, 512);
      g.fillRect(237, 0, 5, 512);
      g.fillRect(126, 40, 5, 180);
      g.fillRect(126, 296, 5, 180);
    }
    const t = finish(new THREE.CanvasTexture(c), this.aniso);
    return t;
  }

  buildSoil() {
    const [c, g] = canvas(512, 512);
    const rng = mulberry32(99);
    g.fillStyle = '#b8a68e';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 14000; i++) {
      const r = 140 + rng() * 70;
      g.fillStyle = `rgba(${r},${r * 0.86},${r * 0.7},${0.08 + rng() * 0.18})`;
      g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 3, 1 + rng() * 3);
    }
    // pebbles
    for (let i = 0; i < 500; i++) {
      const v = 90 + rng() * 80;
      g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.9},0.5)`;
      g.beginPath();
      g.arc(rng() * 512, rng() * 512, 0.6 + rng() * 1.6, 0, Math.PI * 2);
      g.fill();
    }
    // sparse dry grass tufts
    for (let i = 0; i < 90; i++) {
      g.fillStyle = `rgba(${110 + rng() * 40},${115 + rng() * 40},${60 + rng() * 20},${0.18 + rng() * 0.2})`;
      g.beginPath();
      g.arc(rng() * 512, rng() * 512, 1 + rng() * 3, 0, Math.PI * 2);
      g.fill();
    }
    return finish(new THREE.CanvasTexture(c), this.aniso);
  }

  buildPaving() {
    const [c, g] = canvas(128, 128);
    const rng = mulberry32(5);
    g.fillStyle = '#a8a39a';
    g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const v = 150 + rng() * 30;
        g.fillStyle = `rgb(${v},${v * 0.97},${v * 0.92})`;
        g.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
      }
    }
    noise(g, 128, 128, 800, rng, 0.1);
    return finish(new THREE.CanvasTexture(c), this.aniso);
  }

  buildCrops() {
    const [c, g] = canvas(256, 256);
    const rng = mulberry32(8);
    g.fillStyle = '#6b5a3a';
    g.fillRect(0, 0, 256, 256);
    for (let r = 0; r < 16; r++) {
      for (let i = 0; i < 120; i++) {
        const gshade = 90 + rng() * 80;
        g.fillStyle = `rgb(${gshade * 0.45},${gshade},${gshade * 0.3})`;
        g.fillRect(r * 16 + 3 + rng() * 8, rng() * 256, 2 + rng() * 3, 4 + rng() * 6);
      }
    }
    return finish(new THREE.CanvasTexture(c), this.aniso);
  }
}

// Fictional Sivakasi shop names (Tamil, English)
export const SHOP_NAMES = [
  ['முருகன் ஸ்டோர்ஸ்', 'Murugan Stores'],
  ['ஸ்ரீ காளீஸ்வரி பட்டாசு கடை', 'Sri Kaleeswari Crackers'],
  ['லட்சுமி டெக்ஸ்டைல்ஸ்', 'Lakshmi Textiles'],
  ['அண்ணாச்சி மளிகை', 'Annachi Maligai'],
  ['செல்வம் நகை மாளிகை', 'Selvam Jewellery'],
  ['ராஜா மெடிக்கல்ஸ்', 'Raja Medicals'],
  ['விநாயகா ஆப்செட் பிரிண்டர்ஸ்', 'Vinayaka Offset Printers'],
  ['கணேஷ் பேக்கரி', 'Ganesh Bakery'],
  ['சிவா மொபைல்ஸ்', 'Siva Mobiles'],
  ['அன்னபூர்ணா உணவகம்', 'Annapoorna Restaurant'],
  ['பாண்டியன் ஹார்டுவேர்ஸ்', 'Pandian Hardwares'],
  ['மீனாட்சி ஸ்வீட்ஸ்', 'Meenakshi Sweets'],
  ['ஜெயா பேன்சி ஸ்டோர்', 'Jaya Fancy Store'],
  ['வேலன் டிராவல்ஸ்', 'Velan Travels'],
  ['சக்தி எலக்ட்ரிக்கல்ஸ்', 'Sakthi Electricals'],
  ['பாலு சலூன்', 'Balu Saloon'],
  ['கற்பகம் காலண்டர்ஸ்', 'Karpagam Calendars'],
  ['ஸ்ரீ ராம் டைரீஸ்', 'Sri Ram Diaries'],
  ['தேவி ஸ்டுடியோ', 'Devi Studio'],
  ['அருணா பழக்கடை', 'Aruna Fruits'],
  ['மணி சைக்கிள் ஷாப்', 'Mani Cycle Shop'],
  ['கோபால் டெய்லர்ஸ்', 'Gopal Tailors'],
  ['கார்த்திக் மொபைல் சர்வீஸ்', 'Karthik Mobile Service'],
  ['ஸ்டார் பட்டாசு', 'Star Crackers'],
  ['பொன்னி அரிசி மண்டி', 'Ponni Rice Mandi'],
  ['ரஹ்மத் பிரியாணி', 'Rahmath Biryani'],
  ['ஜோசப் பேப்பர் மார்ட்', 'Joseph Paper Mart'],
  ['மாரி பாத்திரக் கடை', 'Mari Vessels'],
  ['அய்யனார் டிரேடர்ஸ்', 'Ayyanar Traders'],
  ['செந்தில் ஆட்டோ ஸ்பேர்ஸ்', 'Senthil Auto Spares'],
  ['பாத்திமா ஃபேன்சி', 'Fathima Fancy'],
  ['குமரன் சில்க்ஸ்', 'Kumaran Silks'],
];

const BANNERS = [
  ['தீபாவளி நல்வாழ்த்துக்கள்', 'Happy Deepavali'],
  ['பொங்கல் நல்வாழ்த்துக்கள்', 'Happy Pongal'],
  ['சிவகாசி பட்டாசுத் திருவிழா', 'Sivakasi Crackers Festival'],
  ['பாதுகாப்பாக பட்டாசு வெடியுங்கள்', 'Burst crackers safely'],
  ['ஹெல்மெட் அணியுங்கள் — உயிர் காப்போம்', 'Wear helmet, save lives'],
  ['கல்வியே செல்வம்', 'Education is wealth'],
];

const ROUTES = [
  'சிவகாசி ⇄ விருதுநகர்',
  'சிவகாசி ⇄ சாத்தூர்',
  'சிவகாசி ⇄ ஸ்ரீவில்லிபுத்தூர்',
  'சிவகாசி ⇄ திருத்தங்கல்',
  'சிவகாசி ⇄ மதுரை',
  'சிவகாசி ⇄ வெம்பக்கோட்டை',
];
export const ROUTE_COUNT = ROUTES.length;
