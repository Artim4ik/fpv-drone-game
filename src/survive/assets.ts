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
