// ============================================================
// GREY CORRIDOR — GLSL fire billboards
// Fragment shader: scidian/drop shaders/frag_fire.glsl (MIT,
// https://github.com/scidian/drop), mirrored as frag_fire.ts for
// bundler/Node compatibility (regen: python3 -c "import json;
// open('frag_fire.ts','w').write('export default '+json.dumps(open(
// 'frag_fire.glsl').read())+';')"). Vertex passthrough + canvas
// noise texture are local glue. u_shape=1 (procedural candle).
// ============================================================
import * as THREE from 'three';
import fragFire from './assets/shaders/frag_fire';

const VERT = `varying vec2 coordinates;
void main() {
  coordinates = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

let noiseShared: THREE.Texture | null = null;

/** RGBA white-noise texture (shader samples the .a channel for wisps). */
function noiseTexture(): THREE.Texture {
  if (noiseShared) return noiseShared;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  if (!g) throw new Error('no 2d context');
  const img = g.createImageData(S, S);
  let seed = 1234567;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const r1 = seed / 4294967296;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const r2 = seed / 4294967296;
    img.data[i] = r1 * 255;
    img.data[i + 1] = r2 * 255;
    img.data[i + 2] = (r1 * 0.5 + r2 * 0.5) * 255;
    img.data[i + 3] = r2 * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  noiseShared = t;
  return t;
}

let dummyShared: THREE.DataTexture | null = null;

/** Unused flame-mask sampler (shape is procedural) — must still be bound. */
function dummyTexture(): THREE.DataTexture {
  if (!dummyShared) {
    dummyShared = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    dummyShared.needsUpdate = true;
  }
  return dummyShared;
}

export interface FireOptions {
  start?: string;
  end?: string;
  smoke?: string;
  intensity?: number;
  speed?: number;
  /** pixel size in uv steps (4 = chunky pixels) */
  pixel?: number;
  /** color bit depth 1..256 (low = posterized pixel look) */
  bitrate?: number;
  alpha?: number;
}

export function makeFireMaterial(o: FireOptions = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: fragFire,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      u_texture_noise: { value: noiseTexture() },
      u_texture_flame: { value: dummyTexture() },
      u_alpha: { value: o.alpha ?? 1 },
      u_time: { value: Math.random() * 20 },
      u_pos: { value: new THREE.Vector2(0, 0) },
      u_width: { value: 64 },
      u_height: { value: 64 },
      u_shape: { value: 1 },
      u_start_color: { value: new THREE.Color(o.start ?? '#ffd23a') },
      u_end_color: { value: new THREE.Color(o.end ?? '#ff3a1a') },
      u_smoke_color: { value: new THREE.Color(o.smoke ?? '#1a1a1a') },
      u_intensity: { value: o.intensity ?? 0.6 },
      u_smoothness: { value: 0.45 },
      u_wavy: { value: 0.45 },
      u_speed: { value: o.speed ?? 14 },
      u_pixel_x: { value: o.pixel ?? 4 },
      u_pixel_y: { value: o.pixel ?? 4 },
      u_bitrate: { value: o.bitrate ?? 10 },
    },
  });
}

/** Camera-facing handled by caller (billboard via lookAt or sprite-like quad). */
export function makeFireQuad(w: number, h: number, o: FireOptions = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), makeFireMaterial(o));
  m.frustumCulled = false;
  return m;
}

/** Advance a fire material's clock. */
export function tickFire(mat: THREE.ShaderMaterial, dt: number): void {
  const u = mat.uniforms['u_time'] as { value: number } | undefined;
  if (u) u.value += dt;
}
