// Top-level orchestrator. Owns every system and runs them in a fixed order each frame:
// input → player → police → traffic → NPCs → missions → environment → world streaming
// → camera → dialogue → audio → UI.
import { Engine } from '../core/Engine.js';
import { Input } from '../core/Input.js';
import { EventBus } from '../core/EventBus.js';
import { loadSettings } from '../core/Quality.js';
import { AssetRegistry } from '../core/AssetRegistry.js';
import { World } from '../world/World.js';
import { loadFonts } from '../world/Textures.js';
import { LANDMARKS, POI } from '../world/MapData.js';
import { Environment } from '../environment/Environment.js';
import { FaceAtlas } from '../characters/FaceAtlas.js';
import { buildHuman } from '../characters/HumanModel.js';
import { heroAppearance } from '../characters/Appearance.js';
import { Animator } from '../characters/Animator.js';
import { Player } from '../player/Player.js';
import { CameraRig } from '../player/CameraRig.js';
import { VehicleFactory, SPECS } from '../vehicles/VehicleModels.js';
import { TrafficManager } from '../vehicles/TrafficManager.js';
import { NPCManager } from '../npc/NPCManager.js';
import { PoliceSystem } from '../police/PoliceSystem.js';
import { MissionSystem } from '../missions/MissionSystem.js';
import { DialogueSystem } from '../dialogue/DialogueSystem.js';
import { Lines, HERO } from '../dialogue/tamil.js';
import { Economy } from '../economy/Economy.js';
import { SaveSystem } from '../save/SaveSystem.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { UI } from '../ui/UI.js';

const AUTO_KEY = 'leomathav_autocontinue';

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.settings = loadSettings();
    this.events = new EventBus();
    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sensitivity;
    this.lines = new Lines();
    this.state = 'menu';
    this.ui = new UI(this, uiRoot);
    this.audio = new AudioSystem(this);
    this.dialogue = new DialogueSystem(this, uiRoot);
    this.lmById = Object.fromEntries(LANDMARKS.map((l) => [l.id, l]));
    this.autosave = 60;
    this.cpuMs = 0;
  }

  // ------------------------------------------------------------ boot
  async boot() {
    this.ui.showMenu(SaveSystem.has());
    this.canvas.style.visibility = 'hidden';
    // Everything below happens in the background while the menu is shown.
    this.preloading = this.preload();
    if (sessionStorage.getItem(AUTO_KEY)) {
      sessionStorage.removeItem(AUTO_KEY);
      this.onMenu(SaveSystem.has() ? 'continue' : 'new');
    }
  }

  async preload() {
    const t0 = performance.now();
    this.ui.setMenuStatus('<span class="ta">பின்னணியில் ஏற்றுகிறது…</span><span class="en">Loading in the background…</span>');
    await loadFonts();
    this.engine = new Engine(this.canvas, this.settings);
    this.assets = await new AssetRegistry().init();
    this.world = new World(this.engine, this.events);
    await this.world.init();
    this.faceAtlas = new FaceAtlas(this.engine.preset.textureSize >= 2048 ? 2048 : 1024);
    this.vehicleFactory = new VehicleFactory(this.world.mats);
    this.env = new Environment(this);
    this.engine.onUpdate((dt) => this.update(dt));
    const ms = Math.round(performance.now() - t0);
    this.ui.setMenuStatus(`<span class="ta">தயார் ✓</span><span class="en">Ready • ${this.settings.preset} preset (recommended: ${this.settings.recommended}) • ${ms} ms</span>`);
  }

  async onMenu(act) {
    if (act === 'settings') { this.ui.open('settings'); return; }
    if (act === 'controls') { this.ui.open('controls'); return; }
    if (act !== 'new' && act !== 'continue') return;
    if (this.state !== 'menu' || this.starting) return;
    this.starting = true;
    const save = act === 'continue' ? SaveSystem.load() : null;
    if (act === 'new') SaveSystem.clear();
    this.ui.hideMenu();
    this.ui.showLoading(0.02, 'ஏற்றுகிறது… Loading…');
    await this.preloading;
    await this.startWorld(save);
    this.starting = false;
  }

  async startWorld(save) {
    const ui = this.ui;
    const spawn = save ? { x: save.pos.x, z: save.pos.z, rot: save.heading } : POI.spawn;
    if (!this.player) {
      // hero character (premium glTF if provided, otherwise procedural)
      ui.showLoading(0.1, 'லியோமாதவ் தயாராகிறார்… (hero)');
      await new Promise((r) => setTimeout(r, 0));
      const gltf = await this.assets.loadCharacter('hero');
      let hero = gltf;
      if (!hero) {
        const m = buildHuman(heroAppearance(), this.faceAtlas);
        hero = { ...m, animator: new Animator(m) };
      }
      this.player = new Player(this, hero);
      this.cameraRig = new CameraRig(this.engine.camera, this.world);
      this.economy = new Economy(this);
      this.traffic = new TrafficManager(this);
      this.npcs = new NPCManager(this);
      this.police = new PoliceSystem(this);
      this.missions = new MissionSystem(this);
      for (const p of this.world.landmarks.parked) this.traffic.addParked(p.type, p.x, p.z, p.rot);
      this.traffic.addParked('bike', 50, 141, Math.PI / 2);
      this.traffic.addParked('scooter', 46, 141.5, Math.PI / 2 + 0.2);
      this.traffic.addParked('car', -362, 305, Math.PI / 2);
      this.hookEvents();
    }
    // stream the world around the spawn point (short loading screen)
    await this.world.preload(spawn.x, spawn.z, (f) => ui.showLoading(0.15 + f * 0.6, 'சிவகாசி உருவாகிறது… (streaming city)'));
    // grow the NPC pool with varied, unique characters
    const roles = ['man', 'woman', 'shop_owner', 'police', 'oldman', 'oldwoman', 'student', 'factory_worker', 'vendor', 'passenger', 'driver', 'tea_master', 'boy', 'girl', 'shopper', 'business_owner', 'devotee', 'priest', 'doctor', 'nurse', 'firefighter', 'teacher', 'mechanic', 'security', 'railway', 'amma'];
    const n = Math.min(this.npcs.maxModels, 12 + Math.round(this.engine.preset.npcCount * 0.5));
    for (let i = 0; i < n; i++) {
      this.npcs.buildModel(roles[i % roles.length]);
      if (i % 3 === 0) {
        ui.showLoading(0.75 + (i / n) * 0.23, 'மக்கள் வருகிறார்கள்… (people)');
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    // state
    this.player.spawn(spawn.x, spawn.z, spawn.rot ?? 0);
    this.cameraRig.yaw = (spawn.rot ?? 0);
    this.cameraRig.first = true;
    if (save) {
      this.economy.money = save.money;
      this.player.health = save.health ?? 100;
      this.env.hour = save.hour ?? 9;
      this.env.day = save.day ?? 1;
      this.env.setWeather(save.weather || 'clear');
      this.missions.restore(save.missions);
    } else {
      this.economy.money = 500;
      this.env.hour = 8.6;
      this.missions.restore(null);
    }
    this.env.update(0.001, this.player.pos);
    ui.hideLoading();
    ui.showHud();
    this.canvas.style.visibility = 'visible';
    this.state = 'playing';
    this.engine.start();
    this.canvas.focus();
    if (!save) {
      ui.toast({ ta: `${HERO.ta} — சிவகாசிக்கு வரவேற்கிறோம்!`, en: `${HERO.en} — welcome to Sivakasi!` }, 'good');
      ui.toast({ ta: 'சுட்டியை கிளிக் செய்து கேமராவை கட்டுப்படுத்துங்கள். Esc = இடைநிறுத்தம்', en: 'Click to control the camera. Esc = pause' });
    }
  }

  hookEvents() {
    this.events.on('horn', (e) => {
      const vol = e.player ? 1 : this.audio.atten(e.x, e.z, 140);
      if (vol > 0.02) this.audio.play('horn', { vol, big: SPECS[e.type]?.big, two: SPECS[e.type]?.two });
      if (e.player) this.npcs.panic({ x: e.x, z: e.z }, 0); // just noise
    });
    this.events.on('train:horn', (p) => {
      const vol = this.audio.atten(p.x, p.z, 600);
      if (vol > 0.01) this.audio.play('train', { vol });
    });
    this.events.on('train:arrive', (st) => {
      if (Math.hypot(st.x - this.player.pos.x, st.z - this.player.pos.z) < 250) {
        this.ui.toast({ ta: `ரயில் ${st.ta} நிலையத்துக்கு வந்தது`, en: `Train arriving at ${st.en}` });
      }
    });
    this.events.on('firework', (f) => {
      const d = Math.hypot(f.x - this.player.pos.x, f.z - this.player.pos.z);
      const vol = Math.max(0, 1 - d / 900);
      if (vol > 0.02) this.audio.play('firework', { vol, delay: d / 343 });
    });
  }

  // ------------------------------------------------------------ interaction
  handleInteractions() {
    const p = this.player;
    const input = this.input;
    if (this.dialogue.active || this.ui.modal) return;
    // vehicle enter / exit
    if (p.vehicle) {
      const shop = this.economy.shopNear(p.pos, true);
      if (shop) {
        this.ui.prompt({ ta: `E: ${shop.label.ta} (₹${shop.price})`, en: `E: ${shop.label.en} (₹${shop.price})` });
        if (input.hit('KeyE')) this.economy.buy(shop);
      }
      if (input.hit('KeyF')) p.exit();
      return;
    }
    const talkMission = this.missions.talkPrompt(p.pos);
    if (talkMission) {
      this.ui.prompt({ ta: `E: ${talkMission.ta}`, en: `E: ${talkMission.en}` });
      if (input.hit('KeyE') && this.missions.interact(p.pos)) return;
    }
    const shop = this.economy.shopNear(p.pos, false);
    if (!talkMission && shop) {
      this.ui.prompt({ ta: `E: ${shop.label.ta} (₹${shop.price})`, en: `E: ${shop.label.en} (₹${shop.price})` });
      if (input.hit('KeyE')) this.economy.buy(shop);
    }
    const v = this.traffic.nearest(p.pos, 3.2);
    if (v && p.knock <= 0) {
      if (!talkMission && !shop) this.ui.prompt({ ta: `F: ${v.spec.name} — ஏறு`, en: `F: Get in the ${v.type}` });
      if (input.hit('KeyF')) {
        const hadCrew = !!v.crew;
        const ejected = this.traffic.commandeer(v);
        const side = v.spec.two ? -0.9 : -(v.spec.width / 2 + 0.8);
        ejected.forEach((c, i) => this.npcs.spawnFleeing(c, v.pos.x + Math.cos(v.heading) * side * (i + 1), v.pos.z - Math.sin(v.heading) * side * (i + 1)));
        if (hadCrew || v.type === 'police') this.events.emit('crime', { type: 'carjack', x: v.pos.x, z: v.pos.z });
        p.enter(v);
        return;
      }
    }
    if (!talkMission && !shop) {
      const npc = this.npcs.nearestTalkable(p.pos);
      if (npc) {
        if (!v) this.ui.prompt({ ta: 'E: பேசு', en: 'E: Talk' });
        if (input.hit('KeyE')) {
          const role = npc.npc.ent.role;
          this.npcs.faceTowards(npc.npc, p.pos, 'talk', 4);
          p.heading = Math.atan2(npc.npc.ent.model.mesh.position.x - p.pos.x, npc.npc.ent.model.mesh.position.z - p.pos.z);
          this.dialogue.bark(['வணக்கம்!', 'Vanakkam!'], p.mesh.position, 1.6);
          setTimeout(() => this.dialogue.bark(this.lines.forRole(role, this.env.hour), npc.npc.ent.model.mesh.position, 4), 900);
          p.animator.setState('wave');
        }
      }
    }
  }

  // ------------------------------------------------------------ frame
  update(dt) {
    const input = this.input;
    if (this.state !== 'playing') { input.endFrame(); return; }
    if (input.hit('Escape')) {
      if (this.ui.modal) this.ui.close();
      else this.ui.open('pause');
    }
    if (input.hit('KeyM')) {
      if (this.ui.modal === 'map') this.ui.close();
      else if (!this.ui.modal) this.ui.open('map');
    }
    if (input.hit('F5')) this.save(true);
    const paused = !!this.ui.modal;
    const t0 = performance.now();
    if (!paused) {
      this.player.update(dt, input, this.cameraRig.yaw);
      this.police.update(dt);
      this.traffic.update(dt, this.player.pos, this.cameraRig.forward);
      this.npcs.update(dt, this.player.pos);
      this.missions.update(dt);
      this.handleInteractions();
      this.env.update(dt, this.player.pos);
      this.world.update(dt, this.player.pos, this.env.night);
      this.cameraRig.update(dt, input, this.player);
      this.dialogue.update(dt, input);
      this.checkHealth();
      this.autosave -= dt;
      if (this.autosave <= 0) { this.autosave = 60; this.save(false); }
    }
    this.audio.update(dt);
    this.ui.update(dt);
    this.cpuMs = (this.cpuMs || 0) * 0.95 + (performance.now() - t0) * 0.05;
    input.endFrame();
  }

  checkHealth() {
    if (this.player.health > 0) return;
    const fee = Math.min(300, this.economy.money);
    this.economy.spend(fee, true);
    if (this.missions.active) this.missions.fail({ ta: 'நீங்கள் காயமடைந்தீர்கள்', en: 'You were injured' });
    this.police.clear();
    this.respawn(POI.hospitalDoor, { ta: `மருத்துவமனையில் சேர்க்கப்பட்டீர்கள் — ₹${fee}`, en: `Hospitalised — ₹${fee}` });
  }

  respawn(poi, msg, lines) {
    const p = this.player;
    if (p.vehicle) {
      const v = p.vehicle;
      v.body.remove(p.mesh);
      p.vehicle = null;
      this.traffic.abandon(v);
    }
    p.knock = 0;
    p.health = 100;
    p.spawn(poi.x, poi.z, 0);
    this.cameraRig.first = true;
    this.ui.flash('damage');
    this.ui.toast(msg, 'warn');
    if (lines) this.dialogue.play(lines, { auto: true });
  }

  save(notify) {
    if (this.state !== 'playing') return;
    const ok = SaveSystem.save(this);
    if (notify) this.ui.toast(ok ? { ta: 'விளையாட்டு சேமிக்கப்பட்டது ✓', en: 'Game saved' } : { ta: 'சேமிக்க முடியவில்லை', en: 'Save failed' }, ok ? 'good' : 'warn');
  }

  quitToMenu() {
    this.save(false);
    location.reload();
  }

  reloadForPreset() {
    if (this.state === 'playing') {
      this.save(false);
      sessionStorage.setItem(AUTO_KEY, '1');
    }
    location.reload();
  }
}
