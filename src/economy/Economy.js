// Money, shops and services.
import { formatMoney } from '../core/utils.js';
import { POI } from '../world/MapData.js';

export class Economy {
  constructor(game) {
    this.game = game;
    this.money = 500;
    this.shops = [
      { id: 'tea', pos: POI.teaShop, r: 2.8, price: 15, label: { ta: 'டீ + வடை வாங்கு', en: 'Buy tea & vada' }, heal: 15, line: ['சூடா டீ, நல்லா குடிங்க!', 'Hot tea, enjoy!'] },
      { id: 'hotel', pos: POI.hotelCounter, r: 3, price: 80, label: { ta: 'பரோட்டா சாப்பிடு', en: 'Eat parotta meal' }, heal: 50, line: ['பரோட்டா சால்னா ரெடி!', 'Parotta with salna, ready!'] },
      { id: 'mechanic', pos: POI.mechanic, r: 6, price: 250, label: { ta: 'வண்டியை சரி செய்', en: 'Repair vehicle' }, repair: true, line: ['வண்டி புதுசு மாதிரி ஆயிடுச்சு!', 'Good as new!'] },
      { id: 'hospital', pos: POI.hospitalDoor, r: 3, price: 120, label: { ta: 'சிகிச்சை பெறு', en: 'Get treatment' }, heal: 100, line: ['இப்போ பரவாயில்லை. ஓய்வு எடுங்க.', "You're fine now. Get some rest."] },
    ];
  }

  earn(n, reason) {
    this.money += n;
    this.game.ui.toast({ ta: `+${formatMoney(n)} ${reason?.ta ?? ''}`, en: reason?.en ?? '' }, 'money');
    this.game.audio?.play('cash');
  }

  spend(n, force = false) {
    if (!force && this.money < n) return false;
    this.money = Math.max(0, this.money - n);
    return true;
  }

  shopNear(pos, inVehicle) {
    for (const s of this.shops) {
      if (inVehicle && !s.repair) continue;
      if (!inVehicle && s.repair) continue;
      if (Math.hypot(s.pos.x - pos.x, s.pos.z - pos.z) < s.r) return s;
    }
    return null;
  }

  buy(shop) {
    const g = this.game;
    if (shop.repair && g.player.vehicle?.health >= 100) {
      g.ui.toast({ ta: 'வண்டி நல்லா தான் இருக்கு.', en: 'The vehicle is already fine.' });
      return;
    }
    if (shop.heal && g.player.health >= 100) {
      g.ui.toast({ ta: 'உடம்பு நல்லா இருக்கு, இப்போ வேண்டாம்.', en: "You're already at full health." });
      return;
    }
    if (!this.spend(shop.price)) {
      g.ui.toast({ ta: 'பணம் போதவில்லை!', en: 'Not enough money!' }, 'warn');
      return;
    }
    if (shop.heal) g.player.health = Math.min(100, g.player.health + shop.heal);
    if (shop.repair && g.player.vehicle) g.player.vehicle.health = 100;
    g.audio?.play('cash');
    g.dialogue.bark(shop.line, { x: shop.pos.x, y: 0, z: shop.pos.z });
    g.ui.toast({ ta: `-${formatMoney(shop.price)} ${shop.label.ta}`, en: shop.label.en });
  }
}
