// DOM user interface: main menu, loading screen, HUD, prompts, toasts, mission
// banners, phone calls, pause/settings/controls/map screens. Tamil first, with
// English subtitles when enabled.
import { Minimap } from './Minimap.js';
import { PRESETS, PRESET_ORDER, saveSettings } from '../core/Quality.js';
import { formatMoney } from '../core/utils.js';
import { districtAt } from '../world/MapData.js';

const h = (tag, cls, html = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const CONTROLS = [
  ['W A S D / ↑ ↓ ← →', 'நட / வண்டி ஓட்டு', 'Move / Drive'],
  ['Shift', 'வேகமாக ஓடு', 'Sprint'],
  ['Space', 'குதி / ஹேண்ட்பிரேக்', 'Jump / Handbrake'],
  ['F', 'வண்டியில் ஏறு / இறங்கு', 'Enter / exit vehicle'],
  ['E', 'பேசு / வாங்கு / தொடர்', 'Talk / Buy / Continue'],
  ['H', 'ஹாரன்', 'Horn'],
  ['G', 'சைரன் (அவசர வண்டிகள்)', 'Siren (emergency vehicles)'],
  ['M', 'வரைபடம்', 'Map'],
  ['Mouse / சுட்டி', 'கேமரா • Wheel: zoom', 'Camera • Wheel: zoom'],
  ['F5', 'சேமி', 'Quick save'],
  ['Esc', 'இடைநிறுத்தம்', 'Pause'],
];

const TIPS = [
  ['சிவகாசி — இந்தியாவின் பட்டாசு தலைநகரம்.', 'Sivakasi — the fireworks capital of India.'],
  ['இந்தியாவில் வாகனங்கள் சாலையின் இடது பக்கம் செல்லும்.', 'In India, traffic keeps to the left.'],
  ['டீ கடையில் டீ குடித்து ஆரோக்கியத்தை மீட்டெடுங்கள்.', 'Drink tea at a tea stall to restore health.'],
  ['ரயில் வரும்போது லெவல் கிராசிங் கேட் மூடப்படும்.', 'Level-crossing gates close when a train approaches.'],
  ['இரவில் பட்டாசு ஆலைப் பகுதியில் வாணவேடிக்கை பாருங்கள்.', 'Watch the fireworks over the factory belt at night.'],
];

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.modal = null;
    this.promptMsg = null;
    this.hudTimer = 0;
    this.build();
  }

  t(obj) {
    if (!obj) return '';
    const en = this.game.settings.englishSubs && obj.en ? `<span class="en">${obj.en}</span>` : '';
    return `<span class="ta">${obj.ta}</span>${en}`;
  }

  get modalOpen() {
    return !!this.modal || !this.menu.classList.contains('hidden');
  }

  build() {
    const r = this.root;
    // ---------------- main menu
    this.menu = h('div', 'screen menu');
    this.menu.innerHTML = `
      <canvas class="menu-bg"></canvas>
      <div class="menu-inner">
        <div class="title-ta">லியோமாதவ்</div>
        <div class="title">LEOMATHAV</div>
        <div class="subtitle">சிவகாசி ஓப்பன் வேர்ல்ட் <span>• SIVAKASI OPEN WORLD</span></div>
        <div class="menu-buttons">
          <button data-act="new"><span class="ta">புதிய விளையாட்டு</span><span class="en">New Game</span></button>
          <button data-act="continue"><span class="ta">தொடர்</span><span class="en">Continue</span></button>
          <button data-act="settings"><span class="ta">அமைப்புகள்</span><span class="en">Settings</span></button>
          <button data-act="controls"><span class="ta">கட்டுப்பாடுகள்</span><span class="en">Controls</span></button>
        </div>
        <div class="menu-status"></div>
      </div>`;
    r.appendChild(this.menu);
    this.menu.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      this.game.audio.unlock();
      this.game.audio.play('click');
      this.game.onMenu(b.dataset.act);
    }));
    this.menuStatus = this.menu.querySelector('.menu-status');
    this.startMenuFx();

    // ---------------- loading
    this.loading = h('div', 'screen loading hidden');
    this.loading.innerHTML = `<div class="load-inner"><div class="title-ta small">லியோமாதவ்</div><div class="load-label"></div><div class="bar"><div class="fill"></div></div><div class="tip"></div></div>`;
    r.appendChild(this.loading);

    // ---------------- HUD
    this.hud = h('div', 'hud hidden');
    this.hud.innerHTML = `
      <div class="hud-tl"><div class="clock"></div><div class="place"></div></div>
      <div class="hud-tr"><div class="money"></div><div class="stars"></div><div class="health"><div class="hfill"></div></div></div>
      <div class="objective hidden"><div class="obj-text"></div><div class="obj-timer"></div></div>
      <div class="prompt hidden"></div>
      <div class="toasts"></div>
      <div class="banner hidden"></div>
      <div class="speedo hidden"><div class="kmh">0</div><div class="unit">km/h</div><div class="vname"></div><div class="vhealth"><div class="vfill"></div></div></div>
      <canvas class="minimap" width="210" height="210"></canvas>
      <div class="fps hidden"></div>
      <div class="phone hidden"><div class="phone-icon">📞</div><div class="phone-name"></div><div class="phone-sub"><span class="ta">அழைப்பு வருகிறது…</span></div></div>
      <div class="flash"></div>`;
    r.appendChild(this.hud);
    const q = (s) => this.hud.querySelector(s);
    this.el = {
      clock: q('.clock'), place: q('.place'), money: q('.money'), stars: q('.stars'), hfill: q('.hfill'),
      objective: q('.objective'), objText: q('.obj-text'), objTimer: q('.obj-timer'), prompt: q('.prompt'), toasts: q('.toasts'),
      banner: q('.banner'), speedo: q('.speedo'), kmh: q('.kmh'), vname: q('.vname'), vfill: q('.vfill'), fps: q('.fps'),
      phone: q('.phone'), phoneName: q('.phone-name'), flash: q('.flash'),
    };
    this.minimap = null;
    this.minimapCanvas = q('.minimap');

    // ---------------- modal container
    this.modalEl = h('div', 'screen modal hidden');
    r.appendChild(this.modalEl);
    this.modalEl.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act) { this.game.audio.play('click'); this.onModalAction(act, e.target.closest('[data-act]')); }
    });
    this.modalEl.addEventListener('input', (e) => this.onModalInput(e));
  }

  // ------------------------------------------------------------ menu fx
  startMenuFx() {
    const cv = this.menu.querySelector('.menu-bg');
    const g = cv.getContext('2d');
    const parts = [];
    let last = performance.now();
    let spawn = 0;
    const skyline = [];
    for (let x = 0; x < 2000; x += 14 + Math.random() * 30) skyline.push([x, 40 + Math.random() * 90, 12 + Math.random() * 28, Math.random() < 0.08]);
    const loop = () => {
      if (this.menu.classList.contains('hidden')) { this.menuFxOn = false; return; }
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight; }
      const W = cv.width, H = cv.height;
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#0b0f2a');
      gr.addColorStop(0.55, '#3b1d4a');
      gr.addColorStop(0.85, '#c2553a');
      gr.addColorStop(1, '#f2a65a');
      g.fillStyle = gr;
      g.fillRect(0, 0, W, H);
      spawn -= dt;
      if (spawn <= 0) {
        spawn = 0.35 + Math.random() * 0.7;
        const cx = Math.random() * W, cy = H * (0.12 + Math.random() * 0.35);
        const hue = Math.floor(Math.random() * 360);
        for (let i = 0; i < 70; i++) {
          const a = Math.random() * Math.PI * 2, s = 40 + Math.random() * 130;
          parts.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1.6 + Math.random(), hue: hue + Math.random() * 30 });
        }
      }
      g.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy += 40 * dt; p.vx *= 0.985; p.vy *= 0.985;
        p.x += p.vx * dt; p.y += p.vy * dt;
        g.fillStyle = `hsla(${p.hue},100%,65%,${Math.min(1, p.life)})`;
        g.fillRect(p.x, p.y, 2.4, 2.4);
      }
      g.globalCompositeOperation = 'source-over';
      // skyline silhouette with a gopuram
      g.fillStyle = '#120b16';
      const base = H;
      for (const [x, hgt, w, gop] of skyline) {
        const X = (x / 2000) * W;
        if (gop) {
          g.beginPath();
          g.moveTo(X, base - 60); g.lineTo(X + 18, base - 190); g.lineTo(X + 42, base - 190); g.lineTo(X + 60, base - 60); g.fill();
          g.fillRect(X + 22, base - 205, 16, 15);
        }
        g.fillRect(X, base - hgt, w, hgt);
      }
    };
    this.menuFxOn = true;
    requestAnimationFrame(loop);
  }

  showMenu(hasSave) {
    this.menu.classList.remove('hidden');
    this.hud.classList.add('hidden');
    this.menu.querySelector('[data-act="continue"]').disabled = !hasSave;
    if (!this.menuFxOn) this.startMenuFx();
  }

  hideMenu() {
    this.menu.classList.add('hidden');
  }

  setMenuStatus(text) {
    this.menuStatus.innerHTML = text;
  }

  showLoading(frac, label) {
    this.loading.classList.remove('hidden');
    this.loading.querySelector('.fill').style.width = `${Math.round(frac * 100)}%`;
    if (label) this.loading.querySelector('.load-label').textContent = label;
    const tip = this.loading.querySelector('.tip');
    if (!tip.dataset.set) {
      const t = TIPS[Math.floor(Math.random() * TIPS.length)];
      tip.innerHTML = this.t({ ta: t[0], en: t[1] });
      tip.dataset.set = '1';
    }
  }

  hideLoading() {
    this.loading.classList.add('hidden');
    this.loading.querySelector('.tip').dataset.set = '';
  }

  showHud() {
    this.hud.classList.remove('hidden');
    if (!this.minimap) this.minimap = new Minimap(this.game, this.minimapCanvas);
  }

  // ------------------------------------------------------------ HUD
  prompt(msg) {
    this.promptMsg = msg;
  }

  toast(msg, kind = 'info') {
    const e = h('div', `toast ${kind}`, this.t(msg));
    this.el.toasts.appendChild(e);
    setTimeout(() => e.classList.add('out'), 3600);
    setTimeout(() => e.remove(), 4200);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  flash(kind) {
    const f = this.el.flash;
    f.className = `flash ${kind}`;
    void f.offsetWidth;
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 250);
  }

  setObjective(obj, timer = null) {
    this.objective = obj;
    this.el.objective.classList.toggle('hidden', !obj);
    if (obj) this.el.objText.innerHTML = this.t(obj);
    this.setTimer(timer);
  }

  setTimer(t) {
    if (t === null || t === undefined) { this.el.objTimer.textContent = ''; return; }
    const s = Math.max(0, Math.ceil(t));
    this.el.objTimer.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.el.objTimer.classList.toggle('urgent', s < 20);
  }

  missionBanner(title, kind, reason) {
    const b = this.el.banner;
    const head = { start: { ta: 'பணி தொடக்கம்', en: 'MISSION' }, done: { ta: 'பணி நிறைவு!', en: 'MISSION PASSED' }, fail: { ta: 'பணி தோல்வி', en: 'MISSION FAILED' } }[kind];
    b.className = `banner ${kind}`;
    b.innerHTML = `<div class="b-head">${this.t(head)}</div><div class="b-title">${this.t(title)}</div>${reason ? `<div class="b-reason">${this.t(reason)}</div>` : ''}`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => b.classList.add('hidden'), 3800);
  }

  ringPhone(caller) {
    return new Promise((resolve) => {
      const p = this.el.phone;
      this.el.phoneName.innerHTML = this.t(caller);
      p.classList.remove('hidden');
      this.game.audio.play('ring');
      this.game.player.animator.setState('phone');
      setTimeout(() => this.game.audio.play('ring'), 1000);
      setTimeout(() => { p.classList.add('hidden'); resolve(); }, 2200);
    });
  }

  update(dt) {
    const g = this.game;
    // prompt (set every frame by systems)
    const pm = this.promptMsg;
    this.el.prompt.classList.toggle('hidden', !pm || g.dialogue.active);
    if (pm && pm !== this.lastPrompt) this.el.prompt.innerHTML = this.t(pm);
    this.lastPrompt = pm;
    this.promptMsg = null;

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.2;
      const env = g.env;
      const wIcon = { clear: '☀', hazy: '🌫', cloudy: '☁', rain: '🌧' }[env.weather];
      this.el.clock.innerHTML = `${env.timeString()} <small>• நாள் ${env.day} ${wIcon}</small>`;
      const d = districtAt(g.player.pos.x, g.player.pos.z);
      this.el.place.innerHTML = this.t(d);
      this.el.money.textContent = formatMoney(g.economy.money);
      const lvl = g.police.level;
      this.el.stars.innerHTML = lvl ? '★'.repeat(lvl) + '<span class="off">' + '★'.repeat(5 - lvl) + '</span>' : '';
      this.el.stars.classList.toggle('flash', lvl > 0 && g.police.unseen < 1);
      this.el.hfill.style.width = `${g.player.health}%`;
      this.el.hfill.classList.toggle('low', g.player.health < 30);
      const v = g.player.vehicle;
      this.el.speedo.classList.toggle('hidden', !v);
      if (v) {
        this.el.kmh.textContent = Math.round(Math.abs(v.speed) * 3.6);
        this.el.vname.textContent = v.spec.name;
        this.el.vfill.style.width = `${v.health}%`;
      }
      this.el.fps.classList.toggle('hidden', !g.settings.showFps);
      if (g.settings.showFps) {
        const w = g.world.stats;
        const info = g.engine.renderer.info.render;
        this.el.fps.textContent = `${Math.round(g.engine.fps)} fps • cpu ${g.cpuMs.toFixed(1)}ms • ${g.settings.preset} • res ${(g.engine.resScale * 100) | 0}% • draw ${info.calls} • tris ${(info.triangles / 1000) | 0}k • chunks ${w.high}/${w.low} • npc ${g.npcs.walkers.length + g.npcs.statics.length}/${g.npcs.pool.length} • cars ${g.traffic.active.length}`;
      }
    }
    if (this.minimap && !this.modal) this.minimap.drawMinimap(g.cameraRig.yaw);
    if (this.modal === 'map') this.minimap.drawFull(this.modalEl.querySelector('canvas'));
  }

  // ------------------------------------------------------------ modals
  open(kind) {
    this.modal = kind;
    this.game.input.releasePointer();
    this.modalEl.classList.remove('hidden');
    const s = this.game.settings;
    if (kind === 'pause') {
      this.modalEl.innerHTML = `<div class="panel"><h2>${this.t({ ta: 'இடைநிறுத்தம்', en: 'Paused' })}</h2>
        <button data-act="resume">${this.t({ ta: 'தொடர்', en: 'Resume' })}</button>
        <button data-act="map">${this.t({ ta: 'வரைபடம்', en: 'Map' })}</button>
        <button data-act="save">${this.t({ ta: 'சேமி', en: 'Save game' })}</button>
        <button data-act="settings">${this.t({ ta: 'அமைப்புகள்', en: 'Settings' })}</button>
        <button data-act="controls">${this.t({ ta: 'கட்டுப்பாடுகள்', en: 'Controls' })}</button>
        <button data-act="quit">${this.t({ ta: 'முதன்மை மெனு', en: 'Main menu' })}</button></div>`;
    } else if (kind === 'controls') {
      this.modalEl.innerHTML = `<div class="panel wide"><h2>${this.t({ ta: 'கட்டுப்பாடுகள்', en: 'Controls' })}</h2>
        <table class="controls">${CONTROLS.map(([k, ta, en]) => `<tr><td class="key">${k}</td><td>${this.t({ ta, en })}</td></tr>`).join('')}</table>
        <button data-act="back">${this.t({ ta: 'பின்செல்', en: 'Back' })}</button></div>`;
    } else if (kind === 'map') {
      const size = Math.max(280, Math.min(innerWidth - 80, innerHeight - 190));
      this.modalEl.innerHTML = `<div class="panel map"><h2>${this.t({ ta: 'சிவகாசி வரைபடம்', en: 'Map of Sivakasi' })}</h2>
        <canvas width="${size}" height="${size}"></canvas>
        <div class="legend">🟡 ${this.t({ ta: 'புதிய பணி', en: 'New mission' })} &nbsp; 🔵 ${this.t({ ta: 'இலக்கு', en: 'Objective' })}</div>
        <button data-act="back">${this.t({ ta: 'மூடு (M)', en: 'Close (M)' })}</button></div>`;
    } else if (kind === 'settings') {
      const hw = s.hardware || {};
      this.pendingPreset = s.preset;
      this.modalEl.innerHTML = `<div class="panel wide"><h2>${this.t({ ta: 'அமைப்புகள்', en: 'Settings' })}</h2>
        <div class="section">${this.t({ ta: 'கிராபிக்ஸ் தரம்', en: 'Graphics quality' })}</div>
        <div class="presets">${PRESET_ORDER.map((p) => `<button data-act="preset" data-p="${p}" class="${p === s.preset ? 'sel' : ''}">${p}${p === s.recommended ? '<small>பரிந்துரை • Recommended</small>' : ''}</button>`).join('')}</div>
        <div class="preset-info"></div>
        <div class="hw">GPU: ${hw.gpu || '?'} • CPU threads: ${hw.cores || '?'} • RAM: ${hw.memory || '?'} GB</div>
        <label><input type="checkbox" data-k="dynamicResolution" ${s.dynamicResolution ? 'checked' : ''}> ${this.t({ ta: 'தானியங்கி ரெசல்யூஷன் (வேகம் குறைந்தால்)', en: 'Dynamic resolution' })}</label>
        <label><input type="checkbox" data-k="englishSubs" ${s.englishSubs ? 'checked' : ''}> ${this.t({ ta: 'ஆங்கில துணைத்தலைப்புகள்', en: 'English subtitles' })}</label>
        <label><input type="checkbox" data-k="tamilVoice" ${s.tamilVoice ? 'checked' : ''}> ${this.t({ ta: 'தமிழ் குரல் (உலாவியில் இருந்தால்)', en: 'Tamil voice (if the browser has one)' })}</label>
        <label><input type="checkbox" data-k="showFps" ${s.showFps ? 'checked' : ''}> ${this.t({ ta: 'FPS / செயல்திறன் காட்டு', en: 'Show FPS / performance' })}</label>
        <label>${this.t({ ta: 'ஒலி', en: 'Volume' })} <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-k="volume"></label>
        <label>${this.t({ ta: 'சுட்டி உணர்திறன்', en: 'Mouse sensitivity' })} <input type="range" min="0.3" max="2.5" step="0.1" value="${s.sensitivity}" data-k="sensitivity"></label>
        <div class="row"><button data-act="apply">${this.t({ ta: 'பயன்படுத்து', en: 'Apply' })}</button><button data-act="back">${this.t({ ta: 'பின்செல்', en: 'Back' })}</button></div></div>`;
      this.showPresetInfo(s.preset);
    }
  }

  showPresetInfo(p) {
    const P = PRESETS[p];
    const el = this.modalEl.querySelector('.preset-info');
    if (!el) return;
    el.innerHTML = `${this.t({ ta: 'நிழல்', en: 'Shadows' })}: ${P.shadows ? P.shadowMapSize : 'off'} • ${this.t({ ta: 'பார்வை தூரம்', en: 'View distance' })}: ${P.viewDistance} m • NPC: ${P.npcCount} • ${this.t({ ta: 'வாகனங்கள்', en: 'Traffic' })}: ${P.trafficCount} • Tex: ${P.textureSize} • Bloom: ${P.bloom ? 'on' : 'off'}`;
  }

  close() {
    this.modal = null;
    this.modalEl.classList.add('hidden');
    this.modalEl.innerHTML = '';
  }

  onModalInput(e) {
    const k = e.target.dataset.k;
    if (!k) return;
    const s = this.game.settings;
    s[k] = e.target.type === 'checkbox' ? e.target.checked : parseFloat(e.target.value);
    if (k === 'volume') this.game.audio.setVolume(s.volume);
    if (k === 'sensitivity') this.game.input.sensitivity = s.sensitivity;
    saveSettings(s);
  }

  onModalAction(act, el) {
    const g = this.game;
    switch (act) {
      case 'resume': this.close(); break;
      case 'map': this.open('map'); break;
      case 'save': g.save(true); break;
      case 'settings': this.open('settings'); break;
      case 'controls': this.open('controls'); break;
      case 'quit': this.close(); g.quitToMenu(); break;
      case 'back': this.close(); if (g.state === 'playing') this.open('pause'); break;
      case 'preset':
        this.pendingPreset = el.dataset.p;
        this.modalEl.querySelectorAll('.presets button').forEach((b) => b.classList.toggle('sel', b.dataset.p === this.pendingPreset));
        this.showPresetInfo(this.pendingPreset);
        break;
      case 'apply':
        if (this.pendingPreset && this.pendingPreset !== g.settings.preset) {
          g.settings.preset = this.pendingPreset;
          saveSettings(g.settings);
          g.reloadForPreset();
        } else {
          saveSettings(g.settings);
          this.close();
          if (g.state === 'playing') this.open('pause');
        }
        break;
      default: break;
    }
  }
}
