// Pre-rendered map of Sivakasi (drawn once) + a rotating circular minimap and a
// full-screen map. Cheap: a single drawImage per frame.
import { WORLD, DISTRICTS, LANDMARKS, RAILWAY } from '../world/MapData.js';

const S = 1024;
const toPx = (v) => ((v + WORLD.half) / (WORLD.half * 2)) * S;
const DCOL = {
  bazaar: '#8d7b6a', commercial: '#8a8279', residential: '#7d8b74', town: '#86806e', printing: '#7a8190',
  fireworks: '#a0705a', match: '#9a7a62', industrial: '#7f7f86', village: '#6f8a5a',
};
const ICON = {
  temple: ['#ffb300', 'க'], busstand: ['#42a5f5', 'B'], market: ['#8bc34a', 'ச'], police: ['#1e88e5', 'P'], hospital: ['#e53935', '+'],
  firestation: ['#ff7043', 'F'], press: ['#ab47bc', 'அ'], fireworks: ['#ff5722', '✦'], matchworks: ['#ff8a65', 'தீ'], hilltemple: ['#ffb300', 'க'],
  school: ['#fdd835', 'ப'], mechanic: ['#90a4ae', 'M'], hotel: ['#ffca28', 'உ'], home: ['#66bb6a', '⌂'], shrine: ['#ffb300', 'க'],
};

export class Minimap {
  constructor(game, canvas) {
    this.game = game;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = S;
    this.drawBase();
  }

  drawBase() {
    const g = this.base.getContext('2d');
    g.fillStyle = '#6e7458';
    g.fillRect(0, 0, S, S);
    for (const d of DISTRICTS) {
      g.fillStyle = DCOL[d.type] || '#777';
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(toPx(d.x), toPx(d.z), (d.r / (WORLD.half * 2)) * S, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.fillStyle = '#8b8471';
    g.beginPath();
    g.arc(toPx(0), toPx(0), (640 / (WORLD.half * 2)) * S, 0, Math.PI * 2);
    g.globalCompositeOperation = 'destination-over';
    g.fill();
    g.globalCompositeOperation = 'source-over';
    // roads
    const roads = this.game.world.roads;
    g.lineCap = 'round';
    for (const pass of [0, 1]) {
      for (const e of roads.edges) {
        g.strokeStyle = pass ? (e.type === 'highway' ? '#ffe08a' : e.type === 'main' ? '#fff3c4' : '#e8e2d4') : '#3c3a35';
        g.lineWidth = Math.max(1.6, (e.w / (WORLD.half * 2)) * S * 1.6) + (pass ? 0 : 1.6);
        g.beginPath();
        g.moveTo(toPx(e.a.x), toPx(e.a.z));
        g.lineTo(toPx(e.b.x), toPx(e.b.z));
        g.stroke();
      }
    }
    // railway
    g.strokeStyle = '#2b2b2b';
    g.lineWidth = 3;
    g.beginPath();
    RAILWAY.forEach(([x, z], i) => (i ? g.lineTo(toPx(x), toPx(z)) : g.moveTo(toPx(x), toPx(z))));
    g.stroke();
    g.strokeStyle = '#f5f5f5';
    g.lineWidth = 1.5;
    g.setLineDash([5, 5]);
    g.stroke();
    g.setLineDash([]);
    // landmarks
    for (const l of LANDMARKS) {
      const [c, t] = ICON[l.type] || ['#fff', '•'];
      const x = toPx(l.x), y = toPx(l.z);
      g.fillStyle = '#111';
      g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = c;
      g.beginPath(); g.arc(x, y, 6.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111';
      g.font = 'bold 8px "Noto Sans Tamil", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, x, y + 0.5);
    }
  }

  worldToMap(x, z) {
    return [toPx(x), toPx(z)];
  }

  drawMinimap(yaw) {
    const c = this.ctx;
    const W = this.canvas.width;
    const R = W / 2;
    const p = this.game.player;
    const v = p.vehicle;
    const range = v ? 150 + Math.min(120, Math.abs(v.speed) * 4) : 110; // metres radius
    const scale = R / ((range / (WORLD.half * 2)) * S);
    c.save();
    c.clearRect(0, 0, W, W);
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = '#4a4f3c';
    c.fillRect(0, 0, W, W);
    c.translate(R, R);
    // rotate so the camera's forward points up (map north = -z)
    c.rotate(Math.PI + yaw);
    c.scale(scale, scale);
    const [px, pz] = this.worldToMap(p.pos.x, p.pos.z);
    c.translate(-px, -pz);
    c.drawImage(this.base, 0, 0);
    // markers
    const blip = (x, z, color, r, shape = 'circle') => {
      const [mx, mz] = this.worldToMap(x, z);
      c.fillStyle = color;
      c.beginPath();
      if (shape === 'square') c.rect(mx - r / scale, mz - r / scale, (2 * r) / scale, (2 * r) / scale);
      else c.arc(mx, mz, r / scale, 0, Math.PI * 2);
      c.fill();
    };
    for (const m of this.game.missions.mapPoints()) blip(m.x, m.z, m.kind === 'mission' ? '#ffc400' : '#29b6f6', 6);
    const flash = Math.floor(performance.now() / 250) % 2;
    for (const pv of this.game.police.pursuers) blip(pv.pos.x, pv.pos.z, flash ? '#ff1744' : '#2979ff', 4.5, 'square');
    c.restore();
    // edge arrows for off-screen mission points
    c.save();
    c.translate(R, R);
    for (const m of this.game.missions.mapPoints()) {
      const dx = m.x - p.pos.x;
      const dz = m.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < range * 0.95) continue;
      const a = Math.atan2(dx, dz) - yaw; // relative to camera forward
      c.save();
      c.rotate(-a + Math.PI);
      c.fillStyle = m.kind === 'mission' ? '#ffc400' : '#29b6f6';
      c.beginPath();
      c.moveTo(0, R - 6);
      c.lineTo(-6, R - 16);
      c.lineTo(6, R - 16);
      c.fill();
      c.restore();
    }
    // player arrow
    const rel = (v ? v.heading : p.heading) - yaw;
    c.rotate(-rel);
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -9);
    c.lineTo(6.5, 7);
    c.lineTo(0, 3.5);
    c.lineTo(-6.5, 7);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
    // north marker
    const nx = R - Math.sin(yaw) * (R - 12);
    const ny = R + Math.cos(yaw) * (R - 12);
    c.fillStyle = '#ff5252';
    c.font = 'bold 13px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('N', nx, ny);
    c.strokeStyle = 'rgba(255,255,255,0.8)';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(R, R, R - 2, 0, Math.PI * 2);
    c.stroke();
  }

  drawFull(canvas) {
    const c = canvas.getContext('2d');
    const W = canvas.width;
    c.drawImage(this.base, 0, 0, W, W);
    const k = W / S;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const d of DISTRICTS) {
      c.font = `600 ${Math.round(13 * k * 1.2)}px "Noto Sans Tamil", sans-serif`;
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 3;
      const x = toPx(d.x) * k;
      const y = toPx(d.z) * k - 14;
      c.strokeText(d.ta, x, y);
      c.fillText(d.ta, x, y);
    }
    for (const m of this.game.missions.mapPoints()) {
      c.fillStyle = m.kind === 'mission' ? '#ffc400' : '#29b6f6';
      c.beginPath();
      c.arc(toPx(m.x) * k, toPx(m.z) * k, 8, 0, Math.PI * 2);
      c.fill();
      if (m.title) {
        c.font = `600 12px "Noto Sans Tamil", sans-serif`;
        c.fillStyle = '#fff';
        c.fillText(m.title.ta, toPx(m.x) * k, toPx(m.z) * k + 16);
      }
    }
    const p = this.game.player;
    const x = toPx(p.pos.x) * k;
    const y = toPx(p.pos.z) * k;
    c.save();
    c.translate(x, y);
    c.rotate(Math.PI - (p.vehicle ? p.vehicle.heading : p.heading));
    c.fillStyle = '#fff';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, -12); c.lineTo(9, 9); c.lineTo(0, 4); c.lineTo(-9, 9); c.closePath();
    c.fill(); c.stroke();
    c.restore();
  }
}
