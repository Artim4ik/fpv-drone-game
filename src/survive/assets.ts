// ============================================================
// GREY CORRIDOR — photo asset registry (GitHub-sourced, CC-BY/MIT)
// Each URL is a static `new URL()` so Vite inlines it into the
// single-file build. photoTexture() falls back to procedural
// canvas textures when loading fails (e.g. Node QA harness).
// See ./assets/CREDITS.md for sources and licenses.
// ============================================================
import * as THREE from 'three';

export const ASSET_URLS = {
  dirt: new URL('./assets/dirt.jpg', import.meta.url).href,
  scorch: new URL('./assets/scorch.jpg', import.meta.url).href,
  brick: new URL('./assets/bricktile.jpg', import.meta.url).href,
  wood: new URL('./assets/wood.jpg', import.meta.url).href,
  particle: new URL('./assets/particle.png', import.meta.url).href,
  spark: new URL('./assets/sparkStretched.png', import.meta.url).href,
  spark1: new URL('./assets/spark1.png', import.meta.url).href,
  disc: new URL('./assets/disc.png', import.meta.url).href,
  circle: new URL('./assets/circle.png', import.meta.url).href,
  sprite: new URL('./assets/sprite.png', import.meta.url).href,
  facade1: new URL('./assets/facade1.jpg', import.meta.url).href,
  facade2: new URL('./assets/facade2.jpg', import.meta.url).href,
  facade3: new URL('./assets/facade3.jpg', import.meta.url).href,
  fire: new URL('./assets/fire.png', import.meta.url).href,
  lensdirt: new URL('./assets/lensdirt.jpg', import.meta.url).href,
  cannon: new URL('./assets/cannonBlast.mp3', import.meta.url).href,
  alarm: new URL('./assets/sfx/alarm.wav', import.meta.url).href,
  blast_far: new URL('./assets/sfx/blast_far.wav', import.meta.url).href,
  blast_near: new URL('./assets/sfx/blast_near.wav', import.meta.url).href,
  launch: new URL('./assets/sfx/launch.wav', import.meta.url).href,
  rumble: new URL('./assets/sfx/rumble.wav', import.meta.url).href,
  launch2: new URL('./assets/sfx/launch2.wav', import.meta.url).href,
  blast_alt: new URL('./assets/sfx/blast_alt.wav', import.meta.url).href,
  deepboom: new URL('./assets/sfx/deepboom.wav', import.meta.url).href,
  night: new URL('./assets/sfx/night.wav', import.meta.url).href,
  engine: new URL('./assets/sfx/engine.wav', import.meta.url).href,
  honk: new URL('./assets/sfx/honk.wav', import.meta.url).href,
  thud: new URL('./assets/sfx/thud.wav', import.meta.url).href,
  glass: new URL('./assets/sfx/glass.wav', import.meta.url).href,
  bell: new URL('./assets/sfx/bell.wav', import.meta.url).href,
  crowd: new URL('./assets/sfx/crowd.wav', import.meta.url).href,
  step_as: new URL('./assets/sfx/step_as.wav', import.meta.url).href,
  step_gr: new URL('./assets/sfx/step_gr.wav', import.meta.url).href,
  gunshot: new URL('./assets/sfx/gunshot.wav', import.meta.url).href,
  crow: new URL('./assets/sfx/crow.wav', import.meta.url).href,
  creak: new URL('./assets/sfx/creak.wav', import.meta.url).href,
  growl: new URL('./assets/sfx/growl.wav', import.meta.url).href,
  tx_ball: new URL('./assets/tex/ball.png', import.meta.url).href,
  tx_bat: new URL('./assets/tex/bat.png', import.meta.url).href,
  tx_butterfly1: new URL('./assets/tex/butterfly1.png', import.meta.url).href,
  tx_butterfly2: new URL('./assets/tex/butterfly2.png', import.meta.url).href,
  tx_butterfly3: new URL('./assets/tex/butterfly3.png', import.meta.url).href,
  tx_cloud_black_smoke: new URL('./assets/tex/cloud_black_smoke.png', import.meta.url).href,
  tx_cloud_blastmotes0: new URL('./assets/tex/cloud_blastmotes0.png', import.meta.url).href,
  tx_cloud_yellow_smoke: new URL('./assets/tex/cloud_yellow_smoke.png', import.meta.url).href,
  tx_enemy_fly_1: new URL('./assets/tex/enemy_fly_1.png', import.meta.url).href,
  tx_enemy_fly_2: new URL('./assets/tex/enemy_fly_2.png', import.meta.url).href,
  tx_enemy_walk_1: new URL('./assets/tex/enemy_walk_1.png', import.meta.url).href,
  tx_enemy_walk_2: new URL('./assets/tex/enemy_walk_2.png', import.meta.url).href,
  tx_fire_particle: new URL('./assets/tex/fire_particle.png', import.meta.url).href,
  tx_flare: new URL('./assets/tex/flare.png', import.meta.url).href,
  tx_flash_particle: new URL('./assets/tex/flash_particle.png', import.meta.url).href,
  tx_flipbook: new URL('./assets/tex/flipbook.png', import.meta.url).href,
  tx_fsm_body: new URL('./assets/tex/fsm_body.png', import.meta.url).href,
  tx_fsm_sword: new URL('./assets/tex/fsm_sword.png', import.meta.url).href,
  tx_human: new URL('./assets/tex/human.png', import.meta.url).href,
  tx_human2: new URL('./assets/tex/human2.png', import.meta.url).href,
  tx_iso_bone_pile_1: new URL('./assets/tex/iso_bone_pile_1.png', import.meta.url).href,
  tx_iso_candle: new URL('./assets/tex/iso_candle.png', import.meta.url).href,
  tx_iso_coin_pile: new URL('./assets/tex/iso_coin_pile.png', import.meta.url).href,
  tx_iso_fire: new URL('./assets/tex/iso_fire.png', import.meta.url).href,
  tx_iso_glow: new URL('./assets/tex/iso_glow.png', import.meta.url).href,
  tx_iso_paw_prints: new URL('./assets/tex/iso_paw_prints.png', import.meta.url).href,
  tx_iso_sparkle: new URL('./assets/tex/iso_sparkle.png', import.meta.url).href,
  tx_iso_vase_1: new URL('./assets/tex/iso_vase_1.png', import.meta.url).href,
  tx_iso_wall_skull: new URL('./assets/tex/iso_wall_skull.png', import.meta.url).href,
  tx_kin_player: new URL('./assets/tex/kin_player.png', import.meta.url).href,
  tx_mask: new URL('./assets/tex/mask.png', import.meta.url).href,
  tx_occultist: new URL('./assets/tex/occultist.png', import.meta.url).href,
  tx_pf_bullet: new URL('./assets/tex/pf_bullet.png', import.meta.url).href,
  tx_pf_coin: new URL('./assets/tex/pf_coin.png', import.meta.url).href,
  tx_pf_enemy: new URL('./assets/tex/pf_enemy.png', import.meta.url).href,
  tx_player_up1: new URL('./assets/tex/player_up1.png', import.meta.url).href,
  tx_player_walk1: new URL('./assets/tex/player_walk1.png', import.meta.url).href,
  tx_player_walk2: new URL('./assets/tex/player_walk2.png', import.meta.url).href,
  tx_quokka: new URL('./assets/tex/quokka.png', import.meta.url).href,
  tx_rat: new URL('./assets/tex/rat.png', import.meta.url).href,
  tx_raven: new URL('./assets/tex/raven.png', import.meta.url).href,
  tx_scroll_brown: new URL('./assets/tex/scroll_brown.png', import.meta.url).href,
  tx_scroll_cyan: new URL('./assets/tex/scroll_cyan.png', import.meta.url).href,
  tx_scroll_grey: new URL('./assets/tex/scroll_grey.png', import.meta.url).href,
  tx_smoke_particle: new URL('./assets/tex/smoke_particle.png', import.meta.url).href,
  tx_spark_particle2: new URL('./assets/tex/spark_particle2.png', import.meta.url).href,
  tx_wolf: new URL('./assets/tex/wolf.png', import.meta.url).href,
  ic_binoculars: new URL('./assets/icons/binoculars.svg', import.meta.url).href,
  ic_briefcase: new URL('./assets/icons/briefcase.svg', import.meta.url).href,
  ic_bullet_impacts: new URL('./assets/icons/bullet_impacts.svg', import.meta.url).href,
  ic_cat: new URL('./assets/icons/cat.svg', import.meta.url).href,
  ic_dove: new URL('./assets/icons/dove.svg', import.meta.url).href,
  ic_envelope: new URL('./assets/icons/envelope.svg', import.meta.url).href,
  ic_files: new URL('./assets/icons/files.svg', import.meta.url).href,
  ic_first_aid_kit: new URL('./assets/icons/first_aid_kit.svg', import.meta.url).href,
  ic_flashlight: new URL('./assets/icons/flashlight.svg', import.meta.url).href,
  ic_heavy_bullets: new URL('./assets/icons/heavy_bullets.svg', import.meta.url).href,
  ic_key_card: new URL('./assets/icons/key_card.svg', import.meta.url).href,
  ic_land_mine: new URL('./assets/icons/land_mine.svg', import.meta.url).href,
  ic_notebook: new URL('./assets/icons/notebook.svg', import.meta.url).href,
  ic_paw_print: new URL('./assets/icons/paw_print.svg', import.meta.url).href,
  ic_raven: new URL('./assets/icons/raven.svg', import.meta.url).href,
  ic_sitting_dog: new URL('./assets/icons/sitting_dog.svg', import.meta.url).href,
  ic_syringe: new URL('./assets/icons/syringe.svg', import.meta.url).href,
  ic_walkie_talkie: new URL('./assets/icons/walkie_talkie.svg', import.meta.url).href,
} as const;

export type AssetKey = keyof typeof ASSET_URLS;

const cache = new Map<string, THREE.Texture>();
let loader: THREE.TextureLoader | null = null;

/**
 * Load a photo texture (cached). On any failure returns the fallback
 * procedural texture so the game never breaks without assets.
 */
export function photoTexture(
  key: AssetKey,
  repeatX = 1,
  repeatY = 1,
  fallback?: () => THREE.Texture,
): THREE.Texture {
  const ck = `${key}:${repeatX}x${repeatY}`;
  const hit = cache.get(ck);
  if (hit) return hit;
  let tex: THREE.Texture | null = null;
  try {
    loader ??= new THREE.TextureLoader();
    const t = loader.load(ASSET_URLS[key]);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeatX, repeatY);
    t.anisotropy = 4;
    tex = t;
  } catch {
    tex = null;
  }
  if (!tex) {
    try {
      tex = fallback ? fallback() : new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    } catch {
      tex = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    }
    if (fallback) {
      // procedural fallbacks come pre-tiled; keep as-is
    }
  }
  cache.set(ck, tex);
  return tex;
}

/**
 * Load a pixel-art texture (cached): NearestFilter + ClampToEdge so
 * pixel sprites stay crisp. Falls back to procedural on failure.
 */
export function pixelTexture(key: AssetKey, fallback?: () => THREE.Texture): THREE.Texture {
  const t = photoTexture(key, 1, 1, fallback);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
