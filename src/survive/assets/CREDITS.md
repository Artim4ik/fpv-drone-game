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
- `facade3.jpg` (from `building_5c.png`, resized to 1024w, q62) — red brick
  apartment block, city residential blocks
