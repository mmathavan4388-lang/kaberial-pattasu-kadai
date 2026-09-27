# LEOMATHAV — சிவகாசி ஓப்பன் வேர்ல்ட் (Sivakasi Open World)

An open-world 3D game set in **Sivakasi, Tamil Nadu**, running in the browser (Three.js + WebGL).
You play **LEOMATHAV (லியோமாதவ்)**, who comes home to Sivakasi. You can walk the bazaar, ride
bikes, drive autos, cars, buses, ambulances and fire engines, talk to Tamil-speaking locals,
run story missions, dodge the police and watch fireworks over the factory belt at night.

```
npm install
npm run dev       # http://localhost:5173
npm run build     # production build in dist/
npm run check     # validates the map layout & chunk generation
```

## Controls

| Key | தமிழ் | English |
| --- | --- | --- |
| W A S D / arrows | நட / வண்டி ஓட்டு | Move / drive |
| Shift | வேகமாக ஓடு | Sprint |
| Space | குதி / ஹேண்ட்பிரேக் | Jump / handbrake |
| F | வண்டியில் ஏறு / இறங்கு | Enter / exit vehicle |
| E | பேசு / வாங்கு / தொடர் | Talk / buy / continue dialogue |
| H / G | ஹாரன் / சைரன் | Horn / siren |
| M | வரைபடம் | Map |
| Mouse, wheel | கேமரா, zoom | Camera, zoom |
| F5 / Esc | சேமி / இடைநிறுத்தம் | Quick save / pause |

## What's in the world

- **Sivakasi town**: bazaar (dense shop rows with Tamil signboards, awnings, water tanks,
  electric poles and wires), commercial streets, residential areas, printing area,
  Sri Bhadrakali Amman temple (gopuram, striped compound wall, mandapam), bus stand with
  route boards and Kannan's tea stall, vegetable market, government hospital, police
  station, fire station, school, mechanic, hotel, and Madhav's home.
- **Industry**: fireworks factory belt (blast-walled sheds, sand banks, warning signs),
  Sri Balaji Fireworks compound, Kamatchi Match Works, industrial estate.
- **Railway**: Virudhunagar – Thiruthangal – Sivakasi – Srivilliputhur line with stations,
  yellow station boards, a passenger train that stops at platforms, and level crossings whose
  gates close (and stop traffic) when the train comes.
- **Thiruthangal** town with its hill temple, outskirts with fields and palmyra palms, tamarind
  avenue trees, and the villages Vembakottai, Naranapuram, Sengamalapatti and Anaiyur.
- Geography is stylised but consistent (north is up on the map; see `src/world/MapData.js`).

## Characters

- **LEOMATHAV**: open olive utility shirt over a beige tee, rolled sleeves, pompadour hair,
  full short beard, cross pendant, dark jeans and boots. The look is **inspired by** the
  reference photo's styling; the procedural model is an original character and does not try
  to reproduce any real person's face.
- **NPCs**: 27 roles (men, women, children, elders, police, shop owners, factory workers,
  students, drivers, doctors, nurses, mechanics, business owners, security guards, railway
  workers, firefighters, priests, vendors, tea masters, teachers...). Faces come from a
  64-cell painted face atlas combined with 10 skin tones, body shapes, hairstyles (braids with
  jasmine, buns, curls, bald), outfits (saree with pallu, churidar, veshti with border, checked
  lungi, uniforms, white coat) and accessories (vibhuti, pottu, glasses, gold chain, towel,
  caps, helmets). Every pooled NPC gets a unique seed, so duplicates are not on screen together.
- **Animation**: procedural and blended per bone: idle breathing, walk and run (the gait is
  driven by distance travelled, so feet don't slide), jump/fall/land, car, bike and auto
  driving poses with steering, talk, wave, phone, work, knockdown and get-up.

## Tamil

All story dialogue, NPC lines, phone calls, mission objectives, HUD and menus are in Tamil,
with optional English subtitles (Settings). Where the browser has a Tamil (`ta-IN`)
speech-synthesis voice, lines are also spoken aloud. The Noto Sans Tamil font is loaded for
the UI and painted signboards.

## Architecture

```
src/
  core/        Engine (renderer, loop, dynamic resolution), Quality presets + hardware
               detection, Input, EventBus, Pool, AssetRegistry (optional glTF pipeline)
  world/       MapData (Sivakasi layout), RoadNetwork (graph, lanes, A*), World (streaming),
               ChunkBuilder (procedural blocks), Landmarks, Railway, Textures, Materials,
               GeoBuilder (mesh merging), Vegetation
  environment/ Sky, day/night, sun shadows, weather (haze/cloud/rain), fireworks
  characters/  HumanModel (rigged skinned mesh), FaceAtlas, Appearance, Animator
  player/      Player controller, CameraRig
  npc/         NPCManager (pool, walkers, role spots, daily schedule, LOD)
  vehicles/    VehicleModels, Vehicle physics, TrafficManager (lane AI)
  police/      PoliceSystem (wanted level, pursuit, busted)
  missions/    MissionSystem + missions.js (story data)
  dialogue/    DialogueSystem, tamil.js (lines)
  economy/     Economy (money, tea stall, hotel, mechanic, hospital)
  audio/       AudioSystem (procedural Web Audio)
  save/        SaveSystem (localStorage)
  ui/          UI (menus, HUD, settings, map), Minimap, ui.css
  game/        Game (wires everything together)
```

## Performance and loading

- **World partition and streaming**: the map is 20×20 chunks of 160 m. Chunks near the player
  get full-detail merged meshes; a far ring gets cheap tiled blocks and low-poly trees. Beyond
  that nothing is drawn. Chunks are built under a per-frame time budget (3–5 ms) and disposed
  when they fall out of range, with hysteresis so borders don't thrash.
- **LOD**: chunk high/low meshes, low-poly far trees, `THREE.LOD` landmarks, and animation LOD
  for NPCs (every frame when near, every third frame at mid range, not simulated when far).
- **Batching**: each chunk is a few merged meshes that share materials (one facade texture
  atlas tinted by vertex colour; one sign atlas). Each character is **one skinned mesh / one
  draw call**. All vehicle wheels in the city are **one instanced mesh**. Trees and railway
  sleepers are instanced too.
- **Pooling**: NPC models, vehicles and firework bursts are pooled and recycled.
- **Dynamic density**: traffic and pedestrian counts follow the time of day and the preset.
  Traffic spawns in a ring around the player, mostly out of view.
- **Dynamic resolution**: if the frame rate drops below ~45 fps the render resolution scales
  down (never the world content), and back up when there's headroom.
- **Fast loading**: every texture, model and sound is generated procedurally, so nothing is
  downloaded except the font. The menu appears immediately while materials, landmarks and the
  railway build in the background. Starting a game only streams the chunks around the spawn
  point and pre-builds a handful of NPCs.
- **Culling**: view-distance culling via streaming and fog, plus frustum culling per chunk
  mesh. WebGL has no practical GPU occlusion queries, so there is no true occlusion culling;
  dense blocks are kept cheap by merging instead.

### Quality presets

| | LOW | MEDIUM | HIGH | ULTRA |
|---|---|---|---|---|
| Shadows | off | 1024 | 2048 | 4096 |
| View distance | 380 m | 560 m | 800 m | 1100 m |
| Detail / far ring (chunks) | 1 / 2 | 1 / 3 | 2 / 5 | 2 / 7 |
| NPCs / traffic | 16 / 10 | 30 / 20 | 46 / 30 | 64 / 40 |
| Texture size | 1024 | 1024 | 2048 | 2048 |
| Bloom, lamp lights | – | –, 2 | ✓, 4 | ✓, 6 |

The recommended preset is picked from the GPU name, CPU threads, device memory and mobile
detection (Settings shows the result). Changing preset saves and reloads into your game.

## Premium assets (optional)

Everything is procedural so the game loads instantly, but the code is ready for authored
assets. Put a `manifest.json` in `public/assets/`:

```json
{ "hero": { "url": "characters/leomathav.glb", "scale": 1,
            "clips": { "idle": "Idle", "walk": "Walk", "run": "Run", "jump": "Jump", "drive_car": "Drive" } } }
```

The glTF hero is then streamed in and used through the same interface as the procedural one
(`src/core/AssetRegistry.js`). The photo-real faces, scanned clothing and mocap animation a
AAA "premium" look needs have to come from authored assets like these; the procedural models
are a stylised, performance-first foundation.

## Development notes

- `dev/char.html` is a character preview page (`npm run dev`, then open `/dev/char.html`;
  add `?close=1` for a face close-up).
- `window.__game` exposes the running game in the browser console for debugging.
