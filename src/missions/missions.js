// Story missions (Tamil first, English subtitles). Positions are world metres.
import { POI } from '../world/MapData.js';

const LEO = { ta: 'மாதவ்', en: 'Madhav' };
const MUTHU = { ta: 'முத்து', en: 'Muthu' };
const PERIYAPPA = { ta: 'பெரியப்பா', en: 'Uncle Periyasamy' };
const KANNAN = { ta: 'கண்ணன் (டீ கடை)', en: 'Kannan (tea stall)' };
const SELVAM = { ta: 'மேனேஜர் செல்வம்', en: 'Manager Selvam' };
const SHOPKEEPER = { ta: 'கடைக்காரர் ராஜா', en: 'Shopkeeper Raja' };
const RAMASAMY = { ta: 'மேற்பார்வையாளர் ராமசாமி', en: 'Supervisor Ramasamy' };
const OFFICER = { ta: 'தீயணைப்பு அதிகாரி', en: 'Fire Officer' };
const NURSE = { ta: 'செவிலியர் மேரி', en: 'Nurse Mary' };
const WORKER = { ta: 'தொழிலாளி', en: 'Worker' };
const AMMA = { ta: 'அம்மா', en: 'Amma' };
const ATHAI = { ta: 'அத்தை', en: 'Aunt' };

const L = (who, ta, en) => ({ who, ta, en });

export const MISSIONS = [
  {
    id: 'welcome',
    title: { ta: 'சிவகாசிக்கு வருக', en: 'Welcome to Sivakasi' },
    giver: { x: 64, z: 124 },
    auto: true,
    steps: [
      {
        type: 'talk', npc: { id: 'muthu', role: 'man', name: MUTHU, x: 63, z: 124.5, rot: Math.PI },
        objective: { ta: 'முத்துவிடம் பேசு', en: 'Talk to Muthu' },
        lines: [
          L(MUTHU, 'டேய் லியோ! எத்தனை வருஷம் ஆச்சு! சென்னையிலிருந்து எப்போ வந்த?', 'Hey Leo! How many years has it been! When did you get in from Chennai?'),
          L(LEO, 'இப்போ தான் பஸ்ல இறங்கினேன், முத்து. ஊர் ரொம்ப மாறிடுச்சு.', 'Just got off the bus, Muthu. The town has changed so much.'),
          L(MUTHU, 'மாறினாலும் நம்ம சிவகாசி தான்! வா, முதல்ல கண்ணன் கடையில ஒரு டீ குடிப்போம்.', "Changed or not, it's still our Sivakasi! Come, let's have a tea at Kannan's first."),
        ],
      },
      { type: 'goto', x: POI.teaShop.x, z: POI.teaShop.z, r: 3, objective: { ta: 'கண்ணன் டீ ஸ்டாலுக்கு போ', en: "Go to Kannan's Tea Stall" } },
      {
        type: 'talk', npc: { id: 'kannan', role: 'tea_master', name: KANNAN, x: 124, z: 114.6, rot: 0 },
        objective: { ta: 'டீ ஆர்டர் பண்ணு', en: 'Order tea' },
        lines: [
          L(KANNAN, 'வாங்க தம்பி! ஸ்பெஷல் டீ, சூடா இருக்கு!', 'Welcome! Special tea, piping hot!'),
          L(LEO, 'ரெண்டு டீ போடுங்கண்ணே. சக்கரை கம்மியா.', 'Two teas please, anna. Less sugar.'),
          L(MUTHU, 'உங்க பெரியப்பா கோவில் பக்கத்துல உனக்காக காத்திருக்காரு. போய் பார்த்துட்டு வா.', 'Your uncle is waiting for you near the temple. Go and see him.'),
        ],
      },
      { type: 'goto', x: -30, z: -78, r: 4, objective: { ta: 'பத்ரகாளியம்மன் கோவில் அருகே பெரியப்பாவை சந்தி', en: 'Meet your uncle near the Bhadrakali Amman temple' } },
      {
        type: 'talk', npc: { id: 'periyappa', role: 'business_owner', name: PERIYAPPA, x: -28, z: -80.5, rot: -Math.PI / 2 },
        objective: { ta: 'பெரியப்பாவிடம் பேசு', en: 'Talk to your uncle' },
        lines: [
          L(PERIYAPPA, 'வா மாதவா! உன்னை பார்த்ததுல ரொம்ப சந்தோஷம்.', "Come, Madhava! So happy to see you."),
          L(PERIYAPPA, 'நம்ம அச்சகத்துக்கு ஒரு நம்பிக்கையான ஆள் வேணும். அது நீ தான்.', 'Our printing press needs someone trustworthy. That is you.'),
          L(LEO, 'கண்டிப்பா பெரியப்பா. என்ன வேலை வேணும்னாலும் சொல்லுங்க.', "Of course, uncle. Tell me whatever you need."),
          L(PERIYAPPA, 'இந்தா, செலவுக்கு கொஞ்சம் பணம். அச்சகத்துல செல்வம் உனக்கு வேலை சொல்லுவான்.', "Here, some money for expenses. Selvam at the press will give you work."),
        ],
      },
      { type: 'reward', money: 1000 },
      {
        type: 'phone', caller: AMMA,
        lines: [
          L(AMMA, 'டேய் மாதவ், எங்கடா இருக்க? சாப்பிட்டியா?', 'Madhav, where are you? Did you eat?'),
          L(LEO, 'சாப்பிட்டேன்மா. பெரியப்பாவை பார்த்துட்டேன்.', 'I ate, Ma. I just met uncle.'),
          L(AMMA, 'சரி, சீக்கிரம் வீட்டுக்கு வா. ராத்திரி ரொம்ப சுத்தாதே.', "Okay, come home soon. Don't roam around late at night."),
          L(LEO, 'சரிம்மா, வந்துடுறேன்.', "Okay Ma, I'll come."),
        ],
      },
    ],
  },
  {
    id: 'press_delivery',
    title: { ta: 'அச்சக டெலிவரி', en: 'Press Delivery' },
    requires: ['welcome'],
    giver: { x: -225, z: -427 },
    steps: [
      {
        type: 'talk', npc: { id: 'selvam', role: 'business_owner', name: SELVAM, x: -222, z: -426, rot: Math.PI },
        objective: { ta: 'அச்சக மேனேஜரிடம் பேசு', en: 'Talk to the press manager' },
        lines: [
          L(SELVAM, 'நீ தான் பெரியசாமி ஐயாவோட மருமகனா? சரி, உடனே ஒரு வேலை இருக்கு.', "You're Periyasamy sir's nephew? Good, there's an urgent job."),
          L(SELVAM, 'இந்த காலண்டர் பார்சல் திருத்தங்கல் ராஜா கடைக்கு போகணும். மூணு நிமிஷத்துக்குள்ள!', 'This calendar parcel must reach Raja\'s shop in Thiruthangal. Within three minutes!'),
          L(LEO, 'கவலைப்படாதீங்க, டைமுக்குள்ள கொண்டு போறேன்.', "Don't worry, I'll get it there on time."),
        ],
      },
      { type: 'enter', objective: { ta: 'ஒரு வண்டியை எடு (F)', en: 'Get a vehicle (F)' } },
      { type: 'goto', x: -1016, z: -679, r: 7, timer: 180, objective: { ta: 'திருத்தங்கல் ராஜா கடைக்கு பார்சலை கொண்டு போ', en: "Deliver the parcel to Raja's shop in Thiruthangal" } },
      {
        type: 'talk', npc: { id: 'raja', role: 'shop_owner', name: SHOPKEEPER, x: -1015, z: -678, rot: -0.73 },
        objective: { ta: 'பார்சலை ஒப்படை', en: 'Hand over the parcel' },
        lines: [
          L(SHOPKEEPER, 'வந்துட்டீங்களா! சரியான நேரத்துல வந்தீங்க, ரொம்ப நன்றி!', "You're here! Right on time, thank you so much!"),
          L(LEO, 'செல்வம் சார் அனுப்பினாரு. அடுத்த ஆர்டருக்கும் கூப்பிடுங்க.', 'Selvam sir sent it. Call us for the next order too.'),
        ],
      },
      { type: 'reward', money: 1500 },
    ],
  },
  {
    id: 'fireworks_safety',
    title: { ta: 'பட்டாசு ஆலை பாதுகாப்பு', en: 'Fireworks Factory Safety' },
    requires: ['welcome'],
    giver: { x: 1122, z: 360 },
    steps: [
      {
        type: 'talk', npc: { id: 'ramasamy', role: 'factory_worker', name: RAMASAMY, x: 1120, z: 362, rot: -Math.PI / 2 },
        objective: { ta: 'மேற்பார்வையாளரிடம் பேசு', en: 'Talk to the supervisor' },
        lines: [
          L(RAMASAMY, 'இன்னைக்கு பாதுகாப்பு ஆய்வு நாள். மூணு கூடங்களையும் சரி பார்க்கணும்.', "Today is safety inspection day. All three sheds must be checked."),
          L(RAMASAMY, 'மணல் வாளி, தண்ணி டிரம், மின்சார இணைப்பு — எல்லாம் பாருங்க.', 'Sand buckets, water drums, wiring — check everything.'),
          L(LEO, 'சரிங்க, இப்போவே பார்க்கிறேன்.', "Okay, I'll check right now."),
        ],
      },
      { type: 'goto', x: 1160, z: 387, r: 3, objective: { ta: 'முதல் கூடத்தை ஆய்வு செய் (1/3)', en: 'Inspect the first shed (1/3)' } },
      { type: 'goto', x: 1178, z: 351, r: 3, objective: { ta: 'இரண்டாவது கூடத்தை ஆய்வு செய் (2/3)', en: 'Inspect the second shed (2/3)' } },
      { type: 'goto', x: 1214, z: 333, r: 3, objective: { ta: 'மூன்றாவது கூடத்தை ஆய்வு செய் (3/3)', en: 'Inspect the third shed (3/3)' } },
      {
        type: 'say',
        lines: [
          L(LEO, 'இங்க யாரோ பீடி பிடிச்சிருக்காங்க! மணல் வாளியும் காலியா இருக்கு. இது ரொம்ப ஆபத்து!', "Someone smoked a beedi here! And the sand bucket is empty. This is really dangerous!"),
          L(LEO, 'உடனே தீயணைப்பு நிலையத்துக்கு தெரியப்படுத்தணும்.', 'I have to alert the fire station right away.'),
        ],
      },
      { type: 'goto', x: POI.fireStationDoor.x, z: POI.fireStationDoor.z, r: 5, timer: 240, objective: { ta: 'தீயணைப்பு நிலையத்துக்கு விரைந்து செல்', en: 'Rush to the fire station' } },
      {
        type: 'talk', npc: { id: 'officer', role: 'firefighter', name: OFFICER, x: 377, z: 141, rot: Math.PI },
        objective: { ta: 'அதிகாரியிடம் புகார் சொல்', en: 'Report to the officer' },
        lines: [
          L(LEO, 'சார், பாலாஜி பட்டாசு ஆலையில பாதுகாப்பு குறைபாடு இருக்கு. பீடி துண்டு கூட கிடந்தது.', "Sir, there's a safety lapse at Balaji Fireworks. There was even a beedi butt."),
          L(OFFICER, 'நல்ல வேலை பண்ணீங்க தம்பி. ஒரு சின்ன தீப்பொறி கூட பெரிய விபத்தா மாறும்.', "Good work. Even a small spark can turn into a big disaster."),
          L(OFFICER, 'உடனே ஆய்வுக் குழுவை அனுப்புறோம். இந்தாங்க, உங்களுக்கு ஒரு வெகுமதி.', 'We are sending an inspection team now. Here, a reward for you.'),
        ],
      },
      { type: 'reward', money: 2000 },
    ],
  },
  {
    id: 'ambulance_run',
    title: { ta: 'உயிர் காக்கும் ஓட்டம்', en: 'Life-Saving Run' },
    requires: ['press_delivery'],
    giver: { x: 225, z: -196 },
    steps: [
      {
        type: 'talk', npc: { id: 'nurse', role: 'nurse', name: NURSE, x: 222, z: -196, rot: 0 },
        objective: { ta: 'செவிலியரிடம் பேசு', en: 'Talk to the nurse' },
        lines: [
          L(NURSE, 'மாதவ்! தீப்பெட்டி ஆலையில ஒருத்தருக்கு கையில காயம். ஆம்புலன்ஸ் டிரைவர் லீவு!', "Madhav! A worker at the match factory hurt his hand. Our ambulance driver is on leave!"),
          L(NURSE, 'நீ ஆம்புலன்ஸ் ஓட்டுவியா? சீக்கிரம்!', 'Can you drive the ambulance? Hurry!'),
          L(LEO, 'சாவியை குடுங்க. இப்போவே போறேன்!', "Give me the keys. I'm going now!"),
        ],
      },
      { type: 'enter', vehicle: 'ambulance', objective: { ta: 'ஆம்புலன்ஸில் ஏறு (F) — சைரன்: G', en: 'Get in the ambulance (F) — siren: G' } },
      { type: 'goto', x: -985, z: 388, r: 9, timer: 170, vehicle: 'ambulance', objective: { ta: 'காமாட்சி தீப்பெட்டி ஆலைக்கு விரை', en: 'Race to Kamatchi Match Works' } },
      {
        type: 'say',
        lines: [
          L(WORKER, 'அண்ணே, சீக்கிரம்! ரத்தம் நிக்கல.', "Anna, hurry! The bleeding won't stop."),
          L(LEO, 'ஏறுங்க, பத்து நிமிஷத்துல ஆஸ்பத்திரி!', "Get in, hospital in ten minutes!"),
        ],
      },
      { type: 'goto', x: 225, z: -190, r: 9, timer: 170, vehicle: 'ambulance', objective: { ta: 'அரசு மருத்துவமனைக்கு திரும்பு', en: 'Return to the Government Hospital' } },
      {
        type: 'say',
        lines: [
          L(NURSE, 'சரியான நேரத்துல கொண்டு வந்துட்ட! அவருக்கு ஒண்ணும் ஆகாது.', "You brought him just in time! He'll be fine."),
          L(NURSE, 'சிவகாசிக்கு உன்னை மாதிரி ஆட்கள் தான் வேணும்.', 'Sivakasi needs people like you.'),
        ],
      },
      { type: 'reward', money: 2500 },
    ],
  },
  {
    id: 'station_guest',
    title: { ta: 'ரயில் நிலைய விருந்தாளி', en: 'Guest at the Station' },
    requires: ['welcome'],
    giver: { x: POI.home.x, z: POI.home.z },
    steps: [
      {
        type: 'talk', npc: { id: 'amma', role: 'amma', name: AMMA, x: -377, z: 308.5, rot: 0 },
        objective: { ta: 'அம்மாவிடம் பேசு', en: 'Talk to Amma' },
        lines: [
          L(AMMA, 'வந்துட்டியா மாதவ்! உன் அத்தை மதுரையிலிருந்து ரயில்ல வர்றாங்க.', "You're back, Madhav! Your aunt is coming by train from Madurai."),
          L(AMMA, 'ஸ்டேஷனுக்கு போய் கூட்டிட்டு வா. பத்திரமா கூட்டிட்டு வரணும்.', 'Go to the station and bring her home. Bring her safely.'),
          L(LEO, 'சரிம்மா, இப்போவே போறேன்.', "Okay Ma, going now."),
        ],
      },
      { type: 'goto', station: 'sivakasi_rs', r: 6, objective: { ta: 'சிவகாசி ரயில் நிலையத்துக்கு போ', en: 'Go to Sivakasi railway station' } },
      {
        type: 'talk', npc: { id: 'athai', role: 'oldwoman', name: ATHAI, station: 'sivakasi_rs' },
        objective: { ta: 'அத்தையை வரவேற்கவும்', en: 'Welcome your aunt' },
        lines: [
          L(ATHAI, 'மாதவா! எவ்வளவு வளர்ந்துட்ட! உங்க அப்பா மாதிரியே இருக்க.', 'Madhava! How you have grown! You look just like your father.'),
          L(LEO, 'வாங்க அத்தை. பயணம் எப்படி இருந்தது?', 'Welcome, aunt. How was the journey?'),
          L(ATHAI, 'நல்லா இருந்தது. முதல்ல பத்ரகாளியம்மன் கோவிலுக்கு போயிட்டு வீட்டுக்கு போகலாம்.', "It was good. Let's go to the Bhadrakali Amman temple first, then home."),
        ],
      },
      { type: 'enter', objective: { ta: 'அத்தைக்காக ஒரு வண்டியை எடு (ஆட்டோ / கார்)', en: 'Get a vehicle for your aunt (auto / car)' } },
      { type: 'goto', x: -30, z: -78, r: 8, vehicle: true, objective: { ta: 'கோவிலுக்கு கூட்டிட்டு போ', en: 'Take her to the temple' } },
      {
        type: 'say',
        lines: [
          L(ATHAI, 'அம்மன் அருளால எல்லாம் நல்லா நடக்கும். சரி, வீட்டுக்கு போகலாம்.', "With the Goddess's grace all will be well. Now, let's go home."),
        ],
      },
      { type: 'goto', x: POI.home.x, z: POI.home.z - 4, r: 8, vehicle: true, objective: { ta: 'அத்தையை வீட்டுக்கு கூட்டிட்டு போ', en: 'Take your aunt home' } },
      {
        type: 'say',
        lines: [
          L(AMMA, 'வாங்க அண்ணி! மாதவ், நல்லா பார்த்துக்கிட்ட. இன்னைக்கு ராத்திரி விருந்து!', 'Welcome, sister-in-law! Madhav, you took good care of her. Feast tonight!'),
        ],
      },
      { type: 'reward', money: 1200 },
    ],
  },
];
