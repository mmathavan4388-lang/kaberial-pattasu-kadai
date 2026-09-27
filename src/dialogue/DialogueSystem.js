// Conversations (typewriter Tamil text + optional English subtitles + optional
// Tamil text-to-speech), phone calls, and floating "barks" above NPC heads.
import * as THREE from 'three';

const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('ta', { granularity: 'grapheme' }) : null;
const graphemes = (s) => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));

export class DialogueSystem {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.box = document.createElement('div');
    this.box.className = 'dlg hidden';
    this.box.innerHTML = '<div class="dlg-speaker"><span class="ta"></span><span class="en"></span></div><div class="dlg-text ta"></div><div class="dlg-sub"></div><div class="dlg-hint">E ▶</div>';
    root.appendChild(this.box);
    this.speakerTa = this.box.querySelector('.dlg-speaker .ta');
    this.speakerEn = this.box.querySelector('.dlg-speaker .en');
    this.text = this.box.querySelector('.dlg-text');
    this.sub = this.box.querySelector('.dlg-sub');
    this.hint = this.box.querySelector('.dlg-hint');
    this.box.addEventListener('click', () => this.advance());
    this.barksEl = document.createElement('div');
    this.barksEl.className = 'barks';
    root.appendChild(this.barksEl);
    this.barks = [];
    this.queue = null;
    this.active = false;
    this.voice = null;
    this.findVoice();
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.onvoiceschanged = () => this.findVoice();
  }

  findVoice() {
    if (typeof speechSynthesis === 'undefined') return;
    const vs = speechSynthesis.getVoices();
    this.voice = vs.find((v) => /^ta/i.test(v.lang)) || null;
  }

  speak(text) {
    const s = this.game.settings;
    if (!s.tamilVoice || !this.voice || typeof speechSynthesis === 'undefined') return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = 1.0;
    u.volume = s.volume;
    speechSynthesis.speak(u);
  }

  /**
   * Play a list of lines: [{ who: {ta,en}, ta, en }]. Resolves when finished.
   * opts.auto = auto-advance, opts.phone = phone call styling, opts.freeze = lock player.
   */
  play(lines, opts = {}) {
    if (this.active) this.finish();
    return new Promise((resolve) => {
      this.queue = { lines, i: -1, opts, resolve };
      this.active = true;
      this.freeze = !!opts.freeze;
      this.box.classList.remove('hidden');
      this.box.classList.toggle('phone', !!opts.phone);
      this.next();
    });
  }

  next() {
    const q = this.queue;
    q.i++;
    if (q.i >= q.lines.length) { this.finish(); return; }
    const l = q.lines[q.i];
    this.speakerTa.textContent = l.who?.ta ?? '';
    this.speakerEn.textContent = this.game.settings.englishSubs && l.who?.en ? l.who.en : '';
    this.sub.textContent = this.game.settings.englishSubs ? l.en || '' : '';
    this.chars = graphemes(l.ta);
    this.shown = 0;
    this.lineTime = 0;
    this.text.textContent = '';
    this.lineDur = 1.6 + this.chars.length * 0.055;
    this.speak(l.ta);
    this.game.events.emit('dialogue:line', l);
  }

  advance() {
    if (!this.active) return;
    if (this.shown < this.chars.length) {
      this.shown = this.chars.length;
      this.text.textContent = this.chars.join('');
      return;
    }
    this.next();
  }

  finish() {
    if (!this.queue) return;
    const r = this.queue.resolve;
    this.queue = null;
    this.active = false;
    this.freeze = false;
    this.box.classList.add('hidden');
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    r?.();
  }

  /** Short floating line above a world position. */
  bark(line, pos, dur = 3.2) {
    if (!line) return;
    const el = document.createElement('div');
    el.className = 'bark';
    el.innerHTML = `<span class="ta">${line[0]}</span>${this.game.settings.englishSubs ? `<span class="en">${line[1]}</span>` : ''}`;
    this.barksEl.appendChild(el);
    this.barks.push({ el, pos: pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y || 0, pos.z), t: dur, follow: pos.isVector3 ? pos : null });
    if (this.barks.length > 5) {
      const b = this.barks.shift();
      b.el.remove();
    }
  }

  update(dt, input) {
    if (this.active) {
      this.lineTime += dt;
      if (this.shown < this.chars.length) {
        this.shown = Math.min(this.chars.length, this.shown + dt * 40);
        this.text.textContent = this.chars.slice(0, Math.floor(this.shown)).join('');
      }
      if (input.hit('KeyE') || input.hit('Enter') || input.hit('Space')) this.advance();
      else if (this.queue?.opts.auto && this.lineTime > this.lineDur) this.next();
    }
    const cam = this.game.engine.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = new THREE.Vector3();
    for (let i = this.barks.length - 1; i >= 0; i--) {
      const b = this.barks[i];
      b.t -= dt;
      if (b.t <= 0) { b.el.remove(); this.barks.splice(i, 1); continue; }
      if (b.follow) b.pos.copy(b.follow);
      v.set(b.pos.x, b.pos.y + 2.2, b.pos.z).project(cam);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      b.el.style.display = visible ? 'block' : 'none';
      b.el.style.transform = `translate(-50%,-100%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      b.el.style.opacity = Math.min(1, b.t * 2);
    }
  }
}
