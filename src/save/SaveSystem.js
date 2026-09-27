// Local save/load (versioned JSON in localStorage).
const KEY = 'leomathav_save_v1';

export class SaveSystem {
  static has() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  static load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
  }

  static clear() {
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  }

  static save(game) {
    const p = game.player;
    const data = {
      v: 1,
      time: Date.now(),
      pos: { x: p.pos.x, z: p.pos.z },
      heading: p.heading,
      health: p.health,
      money: game.economy.money,
      hour: game.env.hour,
      day: game.env.day,
      weather: game.env.weather,
      missions: game.missions.serialize(),
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }
}
