# Asset credits (survive mode)

Photo textures and the explosion recording below were fetched from
public GitHub repositories. Everything else (facades, roads, signs,
camo, plates, UI, SFX) is generated procedurally in code.

## BabylonJS/Assets — https://github.com/BabylonJS/Assets
License: **CC-BY 4.0** (attribution: "Babylon.js Assets")

- `bricktile.jpg` — kiosk / garage brick walls
- `wood.jpg` — crates, benches, market stalls, bus stop
- `dirt.jpg` (resized 1024→512, q65) — city ground, training dirt, frontline roads
- `rock.png` → `scorch.jpg` (resized 512→256, q60) — scorch / soot decals
- `particle.png` — smoke / dust puffs (VFX)
- `sparkStretched.png` — tracers and sparks (VFX)
- `lensdirt.jpg` — subtle fullscreen lens-grime overlay
- `cannonBlast.mp3` — distant explosion thump (frontline)

## three.js examples — https://github.com/mrdoob/three.js
License: **MIT**

- `sprite.png`, `sprites/disc.png`, `sprites/circle.png`, `sprites/spark1.png`
  — particle sprites (exhaust, dust, muzzle smoke)

## Procedural (this repo, no license constraints)

`src/survive/textures.ts` + `src/survive/audio.ts`: Kyiv panel-house
facades, asphalt with markings, pavement, grass, shop signs, TCC van
livery, Ukrainian plates, MM-14 camo, UA flag, muzzle flash, engine /
siren / doors / gunfire / ambience — all synthesized at runtime.

## Silent-Edge — https://github.com/MustafaBioS/Silent-Edge
License: **MIT**

- `facade1.jpg` (from `apartment_block6.png`, resized to 1024w, q62) — beige
  panel tower with balconies, city residential blocks
- `facade2.jpg` (from `apartments2.png`, resized to 1024w, q62) — dark brick
  tower block, city residential blocks
- `facade3.jpg` (from `apartments5.png`, resized to 1024w, q62) — red-brick
  residential tower with balconies, city residential blocks

## miko-2025/defensk (MIT) — https://github.com/miko-2025/defensk
Game SFX (Pixabay-sourced, royalty-free), converted to mono WAV:
- `sfx/alarm.wav` (from `audio/alarm.mp3`, 16kHz) — air-raid alarm loop
- `sfx/blast_far.wav` (from `audio/distant-explosion-199372.mp3`, 16kHz) — distant blast / thunder
- `sfx/blast_near.wav` (from `audio/explosion.wav`, 22050Hz) — close explosion crack
- `sfx/launch.wav` (from `audio/missile-blast-2-95177.mp3`, 16kHz) — distant launch whoosh
- `sfx/rumble.wav` (from `audio/quake.mp3`, 4s cut, 11025Hz) — looping deep rumble bed
- `sfx/launch2.wav` (from `audio/heavy-missile-launch-213841.mp3`, 16kHz) — distant missile launch
- `sfx/blast_alt.wav` (from `audio/distant-explosion-edited.wav`, 22050Hz) — blast variant
- `sfx/deepboom.wav` (from `audio/nuke-333673.mp3`, 3s cut, 11025Hz) — deep detonation boom

## godotengine/godot-demo-projects (MIT) — https://github.com/godotengine/godot-demo-projects
- `sfx/night.wav` (from `3d/truck_town/town/sound/mood_night.ogg`, 3.1s loop, 16kHz) — night ambience bed
- `sfx/engine.wav` (from `3d/truck_town/vehicles/engine.wav`, loop, 16kHz) — vehicle engine
- `sfx/honk.wav` (from `3d/truck_town/vehicles/honk_1.wav`, 16kHz) — car horn
- `sfx/thud.wav` (from `3d/truck_town/vehicles/impact_2.wav`, 16kHz) — landing/body thud
- `sfx/glass.wav` (from `audio/audio_effects/sfx/glass_breaking.wav`, 22050Hz) — glass break

## Offline DSP synthesis (this repo, no external source)
numpy-synthesized one-shots/loops: `bell.wav` (church bell partials), `crowd.wav`
(bazaar murmur), `step_as.wav` / `step_gr.wav` (footsteps), `gunshot.wav`,
`crow.wav`, `creak.wav` (door), `growl.wav` (horror FM sting).

## crawl/crawl — rltiles (public domain / CC0) — https://github.com/crawl/crawl
Dungeon Crawl Stone Soup tiles are public domain (CC0). Used from `crawl-ref/source/rltiles/`:
- `tex/wolf.png`, `rat.png`, `bat.png`, `raven.png`, `quokka.png`, `butterfly1/2/3.png` (mon/animals)
- `tex/human.png`, `human2.png`, `occultist.png` (mon/humanoids/humans)
- `tex/scroll_brown/cyan/grey.png` (item/scroll), `tex/cloud_black_smoke.png`,
  `cloud_blastmotes0.png`, `cloud_yellow_smoke.png` (effect)

## godotengine/godot-demo-projects (MIT) — https://github.com/godotengine/godot-demo-projects
- `tex/fire_particle/smoke_particle/spark_particle2/mask/flipbook.png` (2d/particles)
- `tex/iso_fire/glow/sparkle/candle/bone_pile_1/coin_pile/paw_prints/wall_skull/vase_1.png`
  (2d/isometric/decorations)
- `tex/enemy_fly_1/2, enemy_walk_1/2, player_walk1/2, player_up1.png` (2d/dodge_the_creeps/art)
- `tex/kin_player, fsm_body, fsm_sword, pf_coin, pf_enemy, pf_bullet.png`
  (2d/kinematic_character, 2d/finite_state_machine, 2d/physics_platformer)

## game-icons/icons (CC-BY 3.0) — https://github.com/game-icons/icons
SVG item/animal icons by Delapouite and Lorc (see per-file authors on game-icons.net):
`icons/*.svg` (first_aid_kit, heavy_bullets, notebook, walkie_talkie, key_card,
sitting_dog, cat, dove, raven, paw_print, briefcase, flashlight, binoculars,
bullet_impacts, land_mine, syringe, envelope, files).

## mrdoob/three.js (MIT) — https://github.com/mrdoob/three.js
- `tex/ball.png` (examples/textures/sprites) — spark1/disc/circle were already vendored.

## BabylonJS/Assets (CC-BY-4.0) — https://github.com/BabylonJS/Assets
- `tex/flare.png`, `flash_particle.png` (particles/textures/explosion)

## scidian/drop (MIT) — https://github.com/scidian/drop
- `shaders/frag_fire.glsl` — pixelable GLSL fire (simplex noise by Ashima Arts, MIT).

## qiao/PathFinding.js (MIT) — https://github.com/qiao/PathFinding.js
- A* core vendored to `src/survive/pf/` (Grid/Node/Util/Heuristic/DiagonalMovement/AStarFinder),
  converted to ESM; uses npm `heap` (MIT).
