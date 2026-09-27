// ============================================================
// GREY CORRIDOR — procedural canvas textures (no external assets)
// ============================================================
import * as THREE from 'three';

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

function rand(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Apartment block facade with windows, balconies, weathering. */
export function facadeTexture(seed: number, floors = 5, cols = 6): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rand(seed);
  const base = 150 + Math.floor(r() * 40);
  const tint = r();
  const baseColor = tint < 0.33 ? `rgb(${base},${base - 12},${base - 30})` : tint < 0.66 ? `rgb(${base - 18},${base - 8},${base - 20})` : `rgb(${base - 30},${base - 22},${base - 12})`;
  g.fillStyle = baseColor;
  g.fillRect(0, 0, 256, 256);
  // panel-house seams
  g.fillStyle = 'rgba(30,28,24,0.35)';
  for (let f = 1; f < floors; f++) g.fillRect(0, (f * 256) / floors - 1, 256, 2);
  for (let vx = 0; vx < 256; vx += 64) g.fillRect(vx, 0, 2, 256);
  // grime streaks
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(40,36,30,${0.03 + r() * 0.06})`;
    const x = r() * 256;
    g.fillRect(x, r() * 100, 2 + r() * 5, 60 + r() * 190);
  }
  const ww = 256 / cols;
  const wh = 256 / floors;
  for (let f = 0; f < floors; f++) {
    for (let col = 0; col < cols; col++) {
      const x = col * ww + ww * 0.22;
      const y = f * wh + wh * 0.2;
      const w = ww * 0.56;
      const h = wh * 0.55;
      const lit = r() < 0.28;
      g.fillStyle = '#3a3a38';
      g.fillRect(x - 2, y - 2, w + 4, h + 4);
      if (lit) {
        g.fillStyle = r() < 0.5 ? '#d8a94e' : '#c9d4d8';
      } else {
        const sky = 40 + Math.floor(r() * 30);
        g.fillStyle = `rgb(${sky - 8},${sky},${sky + 12})`;
      }
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(20,20,20,0.85)';
      g.fillRect(x + w / 2 - 1, y, 2, h);
      // balcony slab on some windows
      if (r() < 0.3) {
        g.fillStyle = 'rgba(90,86,78,0.9)';
        g.fillRect(x - 4, y + h + 2, w + 8, 5);
      }
      // curtains
      if (r() < 0.4 && !lit) {
        g.fillStyle = 'rgba(200,195,180,0.25)';
        g.fillRect(x + 2, y + 2, w - 4, h * 0.35);
      }
      // air-conditioner box on some windows
      if (r() < 0.22) {
        g.fillStyle = 'rgba(214,212,200,0.95)';
        g.fillRect(x + w + 3, y + h * 0.3, 10, 8);
        g.fillStyle = 'rgba(60,58,52,0.9)';
        g.fillRect(x + w + 4, y + h * 0.3 + 2, 8, 1);
        g.fillRect(x + w + 4, y + h * 0.3 + 5, 8, 1);
      }
    }
  }
  // drainpipes
  for (let pi = 0; pi < 3; pi++) {
    const px = 20 + r() * 216;
    g.fillStyle = 'rgba(50,48,44,0.85)';
    g.fillRect(px, 0, 5, 256);
    g.fillStyle = 'rgba(140,136,126,0.5)';
    g.fillRect(px, 0, 1, 256);
  }
  return toTexture(c);
}

/** Shop / street sign with fictional text. */
export function signTexture(text: string, bg = '#1f4d3a', fg = '#e8e4d2'): THREE.CanvasTexture {
  const [c, g] = canvas(512, 128);
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 6;
  g.strokeRect(6, 6, 500, 116);
  g.fillStyle = fg;
  g.font = 'bold 56px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 18), 256, 66);
  return toTexture(c);
}

/** Asphalt road with lane dashes (tile along length). */
export function roadTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#41423c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 52 + Math.random() * 32;
    g.fillStyle = `rgb(${v},${v},${v - 4})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  // cracks
  g.strokeStyle = 'rgba(15,15,14,0.5)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    let x = Math.random() * 256;
    let y = 0;
    g.moveTo(x, y);
    while (y < 256) {
      x += (Math.random() - 0.5) * 30;
      y += 20 + Math.random() * 30;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // edge lines + asphalt patches
  g.fillStyle = '#a8a294';
  g.fillRect(6, 0, 5, 256);
  g.fillRect(245, 0, 5, 256);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = `rgba(20,20,18,${0.12 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * 200, Math.random() * 200, 30 + Math.random() * 50, 20 + Math.random() * 40);
  }
  // center dashes
  g.fillStyle = '#b9b49a';
  g.fillRect(124, 20, 8, 90);
  g.fillRect(124, 150, 8, 90);
  return toTexture(c, 1, 30);
}

export function pavementTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#6b6a60';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(30,30,28,0.6)';
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32, 128);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i * 32);
    g.lineTo(128, i * 32);
    g.stroke();
  }
  for (let i = 0; i < 250; i++) {
    g.fillStyle = `rgba(20,20,18,${Math.random() * 0.15})`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  return toTexture(c, 8, 8);
}

export function dirtTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#4a4132';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1600; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(60,52,38,0.5)' : 'rgba(96,86,64,0.4)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
  }
  return toTexture(c, 10, 10);
}

export function grassTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#44502f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.4 ? 'rgba(52,66,34,0.6)' : v < 0.8 ? 'rgba(96,104,60,0.5)' : 'rgba(70,78,44,0.6)';
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 4);
  }
  return toTexture(c, 12, 12);
}

/** Fictional ID photo — abstract generated portrait (no real person). */
export function docPhotoTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(96, 120);
  const r = rand(seed);
  const bgHue = 200 + Math.floor(r() * 30);
  g.fillStyle = `hsl(${bgHue},30%,62%)`;
  g.fillRect(0, 0, 96, 120);
  // shoulders
  const jacket = ['#3d4a5c', '#5c4a3d', '#445c46', '#555555'][Math.floor(r() * 4)];
  g.fillStyle = jacket;
  g.beginPath();
  g.ellipse(48, 130, 40, 42, 0, Math.PI, 0);
  g.fill();
  // neck + head
  const skin = 150 + Math.floor(r() * 60);
  g.fillStyle = `rgb(${skin},${skin - 30},${skin - 55})`;
  g.fillRect(40, 66, 16, 22);
  g.beginPath();
  g.ellipse(48, 52, 21, 26, 0, 0, Math.PI * 2);
  g.fill();
  // hair
  g.fillStyle = ['#2b2118', '#4a3a26', '#6e5a3a', '#1a1a1a', '#7a6a55'][Math.floor(r() * 5)];
  g.beginPath();
  g.ellipse(48, 36, 21, 15, 0, Math.PI, 0);
  g.fill();
  // glasses sometimes
  if (r() < 0.3) {
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.strokeRect(30, 46, 15, 11);
    g.strokeRect(51, 46, 15, 11);
  }
  return toTexture(c);
}

/** Fictional ID photo as data-URL for the document wallet UI. */
export function docPhotoUrl(seed: number): string {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 120;
  const g = c.getContext('2d')!;
  let s = (Math.abs(seed) >>> 0 || 1) * 2654435761 >>> 0;
  const r = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const bgHue = 200 + Math.floor(r() * 30);
  g.fillStyle = `hsl(${bgHue},30%,62%)`;
  g.fillRect(0, 0, 96, 120);
  const jacket = ['#3d4a5c', '#5c4a3d', '#445c46', '#555555'][Math.floor(r() * 4)];
  g.fillStyle = jacket;
  g.beginPath();
  g.ellipse(48, 130, 40, 42, 0, Math.PI, 0);
  g.fill();
  const skin = 150 + Math.floor(r() * 60);
  g.fillStyle = `rgb(${skin},${skin - 30},${skin - 55})`;
  g.fillRect(40, 66, 16, 22);
  g.beginPath();
  g.ellipse(48, 52, 21, 26, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ['#2b2118', '#4a3a26', '#6e5a3a', '#1a1a1a', '#7a6a55'][Math.floor(r() * 5)];
  g.beginPath();
  g.ellipse(48, 36, 21, 15, 0, Math.PI, 0);
  g.fill();
  if (r() < 0.3) {
    g.strokeStyle = '#222';
    g.lineWidth = 2;
    g.strokeRect(30, 46, 15, 11);
    g.strokeRect(51, 46, 15, 11);
  }
  return c.toDataURL();
}

/** Paper-target face for the shooting range. */
export function targetFaceTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 160);
  g.fillStyle = '#d8d2bc';
  g.fillRect(0, 0, 128, 160);
  g.fillStyle = '#3a3a36';
  g.beginPath();
  g.ellipse(64, 62, 30, 42, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#d8d2bc';
  g.beginPath();
  g.ellipse(64, 62, 18, 28, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#8c2f26';
  g.beginPath();
  g.ellipse(64, 62, 8, 12, 0, 0, Math.PI * 2);
  g.fill();
  return toTexture(c);
}

/** Damaged concrete with scorch marks for frontline ruins. */
export function ruinTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256);
  const r = rand(seed);
  g.fillStyle = '#7a766c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(30,28,24,${r() * 0.2})`;
    g.fillRect(r() * 256, r() * 256, 3, 3);
  }
  // scorch blotches
  for (let i = 0; i < 5; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const rad = 30 + r() * 60;
    const grad = g.createRadialGradient(x, y, 5, x, y, rad);
    grad.addColorStop(0, 'rgba(12,10,8,0.85)');
    grad.addColorStop(1, 'rgba(12,10,8,0)');
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // broken window holes
  for (let i = 0; i < 4; i++) {
    g.fillStyle = '#0c0c0c';
    g.fillRect(20 + r() * 200, 20 + r() * 200, 24 + r() * 20, 30 + r() * 24);
  }
  return toTexture(c);
}

/** Soft round particle sprite. */
export function softDotTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return toTexture(c);
}

/** Simple brick courses (fallback when the photo is unavailable). */
export function brickTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#8c4a34';
  g.fillRect(0, 0, 128, 128);
  const r = rand(77);
  for (let row = 0; row < 8; row++) {
    const y = row * 16;
    g.fillStyle = 'rgba(210,200,185,0.8)';
    g.fillRect(0, y, 128, 2);
    const off = row % 2 ? 16 : 0;
    for (let x = off; x < 128; x += 32) g.fillRect(x, y, 2, 16);
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(40,20,12,${0.1 + r() * 0.15})`;
      g.fillRect(r() * 128, y + 2 + r() * 12, 3, 3);
    }
  }
  return toTexture(c);
}

/** Wooden planks (fallback when the photo is unavailable). */
export function plankTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = rand(99);
  for (let p = 0; p < 4; p++) {
    const base = 100 + Math.floor(r() * 30);
    g.fillStyle = `rgb(${base},${base - 28},${base - 58})`;
    g.fillRect(0, p * 32, 128, 32);
    g.fillStyle = 'rgba(30,20,12,0.7)';
    g.fillRect(0, p * 32, 128, 2);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(60,42,24,${0.2 + r() * 0.25})`;
      g.fillRect(r() * 128, p * 32 + 3 + r() * 26, 20 + r() * 60, 1);
    }
  }
  return toTexture(c);
}

/** Dark soot blot (fallback when the photo is unavailable). */
export function scorchDecalTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(10,8,6,0.95)');
  grad.addColorStop(0.6, 'rgba(16,14,11,0.7)');
  grad.addColorStop(1, 'rgba(20,18,14,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

/** MM-14-ish digital camo pixel pattern for TCC uniforms. */
export function camoTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = rand(1415);
  g.fillStyle = '#6a6b4e';
  g.fillRect(0, 0, 128, 128);
  const cols = ['#5c5c40', '#4a4a34', '#7a7a58', '#3e3e2c', '#6a6b4e', '#565636'];
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(x, y, 8, 8);
    }
  }
  return toTexture(c);
}

/** Ukrainian blue-yellow flag with slight wave shading. */
export function uaFlagTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(120, 80);
  g.fillStyle = '#2f6fd0';
  g.fillRect(0, 0, 120, 40);
  g.fillStyle = '#ffd83a';
  g.fillRect(0, 40, 120, 40);
  for (let x = 0; x < 120; x += 4) {
    const sh = Math.sin((x / 120) * Math.PI * 2) * 0.08;
    g.fillStyle = sh > 0 ? `rgba(255,255,255,${sh})` : `rgba(0,0,0,${-sh})`;
    g.fillRect(x, 0, 4, 80);
  }
  return toTexture(c);
}

/** Ukrainian vehicle plate with blue UA band. */
export function plateUATexture(text: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = '#f2f2ee';
  g.fillRect(0, 0, 256, 64);
  g.strokeStyle = '#1a1a1a';
  g.lineWidth = 3;
  g.strokeRect(2, 2, 252, 60);
  // UA band: blue over yellow with white UA
  g.fillStyle = '#27438c';
  g.fillRect(4, 4, 32, 56);
  g.fillStyle = '#ffd83a';
  g.fillRect(4, 34, 32, 26);
  g.fillStyle = '#f2f2ee';
  g.font = 'bold 17px Arial';
  g.textAlign = 'center';
  g.fillText('UA', 20, 27);
  // plate text fitted into the remaining width
  g.fillStyle = '#1a1a1a';
  let fs = 40;
  g.font = `bold ${fs}px Arial`;
  try {
    while (fs > 12 && (g.measureText(text).width as number) > 200) {
      fs -= 2;
      g.font = `bold ${fs}px Arial`;
    }
  } catch {
    /* measure unavailable (stub) */
  }
  g.fillText(text, 146, 47);
  return toTexture(c);
}

/** Star-shaped muzzle flash (for additive blending). */
export function muzzleTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,246,220,1)');
  grad.addColorStop(0.25, 'rgba(255,210,120,0.9)');
  grad.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  grad.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = 'rgba(255,240,200,0.95)';
  g.fillRect(30, 4, 4, 56);
  g.fillRect(4, 30, 56, 4);
  return toTexture(c);
}

/** Tight round glow sprite (beacons, lamps). */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return toTexture(c);
}

/** Padded winter jacket with zipper + pockets (civilians). */
export function jacketTexture(base: string, seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const r = rand(seed * 17 + 3);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 10; y < 128; y += 18) g.fillRect(0, y, 128, 2);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  for (let y = 12; y < 128; y += 18) g.fillRect(0, y, 128, 2);
  g.fillStyle = 'rgba(20,20,20,0.85)';
  g.fillRect(62, 0, 4, 128);
  g.fillStyle = 'rgba(180,180,180,0.8)';
  for (let y = 4; y < 128; y += 8) g.fillRect(62, y, 4, 2);
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(14, 84, 30, 4);
  g.fillRect(84, 84, 30, 4);
  for (let i = 0; i < 120; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
    g.fillRect(r() * 128, r() * 128, 2, 2);
  }
  return toTexture(c);
}

/** Checkered flannel shirt (civilians). */
export function flannelTexture(c1: string, c2: string): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = c1;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = c2;
  g.globalAlpha = 0.55;
  for (let x = 0; x < 128; x += 32) g.fillRect(x, 0, 14, 128);
  for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 14);
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.fillRect(62, 0, 3, 128);
  return toTexture(c);
}

/** Tactical vest with MOLLE webbing + buckles (TCC / soldiers). */
export function vestTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#4a4a34';
  g.fillRect(0, 0, 128, 128);
  for (let y = 12; y < 128; y += 24) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, y, 128, 3);
    g.fillStyle = '#56563e';
    g.fillRect(0, y + 3, 128, 12);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let x = 8; x < 128; x += 20) g.fillRect(x, y + 3, 3, 12);
  }
  g.fillStyle = '#26261e';
  g.fillRect(56, 46, 16, 10);
  g.fillRect(56, 94, 16, 10);
  return toTexture(c);
}

/** Low-poly face: eyes, brows, nose, mouth, facial-hair variants. */
export function faceTexture(variant: number, skin: string): THREE.CanvasTexture {
  const [c, g] = canvas(96, 112);
  const r = rand(variant * 131 + 7);
  g.fillStyle = skin;
  g.fillRect(0, 0, 96, 112);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 93, 96, 19);
  const ey = 42 + Math.floor(r() * 7);
  for (const ex of [22, 58]) {
    g.fillStyle = '#e8e4da';
    g.fillRect(ex, ey, 14, 9);
    g.fillStyle = '#2a2a2e';
    g.fillRect(ex + 4 + Math.floor(r() * 4), ey + 1, 6, 7);
    g.fillStyle = 'rgba(40,30,20,0.9)';
    g.fillRect(ex - 2, ey - 9, 18, 4);
  }
  g.fillStyle = 'rgba(0,0,0,0.15)';
  g.fillRect(44, ey + 12, 7, 17);
  g.fillStyle = 'rgba(120,62,56,0.9)';
  g.fillRect(35, 90, 26, 4);
  if (variant % 4 === 1) {
    g.fillStyle = 'rgba(50,42,34,0.35)';
    g.fillRect(12, 75, 72, 33);
  } else if (variant % 4 === 2) {
    g.fillStyle = '#3a2e22';
    g.fillRect(12, 78, 72, 30);
    g.fillStyle = skin;
    g.fillRect(35, 87, 26, 9);
  } else if (variant % 4 === 3) {
    g.fillStyle = '#3a2e22';
    g.fillRect(32, 82, 32, 5);
  }
  return toTexture(c);
}

/** Car paint: white base with dirt gradient at the bottom (multiplies body color). */
export function carPaintTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.45, 'rgba(70,64,55,0.08)');
  grad.addColorStop(0.78, 'rgba(52,47,40,0.3)');
  grad.addColorStop(1, 'rgba(38,34,28,0.52)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  // rain streaks running down
  for (let i = 0; i < 16; i++) {
    const x = Math.random() * 128;
    const y0 = 30 + Math.random() * 60;
    g.fillStyle = `rgba(60,55,48,${0.05 + Math.random() * 0.08})`;
    g.fillRect(x, y0, 2 + Math.random() * 3, 128 - y0);
  }
  // road grime speckle, denser at the very bottom
  for (let i = 0; i < 220; i++) {
    const y = 64 + Math.pow(Math.random(), 0.6) * 64;
    g.fillStyle = `rgba(40,36,30,${0.08 + Math.random() * 0.25})`;
    g.fillRect(Math.random() * 128, y, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  return toTexture(c);
}

/** Tire tread chevrons (wraps around the tire). */
export function treadTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 32);
  g.fillStyle = '#161616';
  g.fillRect(0, 0, 64, 32);
  g.fillStyle = 'rgba(70,70,70,0.9)';
  for (let x = 0; x < 64; x += 8) {
    g.fillRect(x, 0, 3, 13);
    g.fillRect(x + 4, 17, 3, 13);
  }
  return toTexture(c, 6, 1);
}

// --- Kyiv street signage / market awnings ---
export function signTextTexture(text: string, bg = '#1d4d2b', fg = '#f5f2e4', w = 512, h = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = fg;
  g.lineWidth = 6;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.fillStyle = fg;
  g.font = 'bold ' + Math.floor(h * 0.52) + 'px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function awningTexture(c1 = '#a8352c', c2 = '#e8e2d2'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) {
    g.fillStyle = i % 2 ? c1 : c2;
    g.fillRect(i * 32, 0, 32, 256);
  }
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(0,0,0,0.25)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------------- brainrot parody portraits (original pixel art) ----------------
export type BrainrotKind = 'tung' | 'trala' | 'bomba' | 'cappu' | 'lirili' | 'baller' | 'huggy' | 'vlad' | 'beast' | 'glasha';

function px(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string): void {
  g.fillStyle = c;
  g.fillRect(x, y, w, h);
}

/** Original blocky portraits for the brainrot-chase mode (96x128). */
export function brainrotTexture(kind: BrainrotKind): THREE.CanvasTexture {
  const [c, g] = canvas(96, 128);
  g.clearRect(0, 0, 96, 128);
  const eye = (x: number, y: number, angry: boolean): void => {
    px(g, x, y, 10, 12, '#ffffff');
    px(g, x + (angry ? 5 : 2), y + 5, 5, 6, '#101010');
    if (angry) {
      px(g, x - 2, y - 4, 14, 3, '#101010');
    }
  };
  if (kind === 'tung') {
    // wooden log + bat
    px(g, 26, 14, 44, 100, '#6e4a26');
    px(g, 26, 14, 8, 100, '#54371c');
    px(g, 62, 14, 8, 100, '#54371c');
    for (let y = 26; y < 108; y += 14) px(g, 30, y, 36, 2, '#54371c');
    px(g, 26, 8, 44, 8, '#8a6134');
    px(g, 30, 10, 36, 2, '#54371c');
    eye(34, 40, true);
    eye(54, 40, true);
    px(g, 36, 66, 26, 10, '#2a1608');
    px(g, 36, 66, 26, 3, '#ffffff');
    px(g, 30, 100, 12, 14, '#3a2512');
    px(g, 56, 100, 12, 14, '#3a2512');
    g.save();
    g.translate(70, 70);
    g.rotate(-0.7);
    px(g, -6, -44, 12, 44, '#c49a5a');
    px(g, -4, 0, 8, 14, '#5c4526');
    g.restore();
  } else if (kind === 'trala') {
    // shark with sneakers
    px(g, 12, 44, 64, 34, '#7a8a99');
    px(g, 12, 62, 64, 16, '#d8dce2');
    px(g, 68, 52, 16, 10, '#7a8a99');
    px(g, 4, 36, 12, 20, '#5c6a78');
    px(g, 38, 28, 12, 18, '#5c6a78');
    px(g, 20, 52, 8, 8, '#ffffff');
    px(g, 22, 54, 4, 4, '#101010');
    px(g, 24, 68, 34, 4, '#ffffff');
    for (const lx of [20, 42, 60]) {
      px(g, lx, 78, 8, 18, '#5c6a78');
      px(g, lx - 3, 94, 16, 10, '#d83a3a');
      px(g, lx - 3, 100, 16, 4, '#ffffff');
    }
  } else if (kind === 'bomba') {
    // croc bomber plane
    px(g, 18, 52, 60, 22, '#3f7a3a');
    px(g, 18, 62, 60, 4, '#2c5a28');
    px(g, 62, 56, 22, 12, '#3f7a3a');
    px(g, 66, 64, 4, 5, '#ffffff');
    px(g, 74, 64, 4, 5, '#ffffff');
    px(g, 30, 44, 10, 10, '#ffffff');
    px(g, 32, 46, 5, 5, '#101010');
    px(g, 8, 74, 80, 10, '#6e5233');
    px(g, 40, 20, 8, 34, '#6e5233');
    px(g, 28, 12, 32, 6, '#9a9aa2');
    px(g, 41, 4, 6, 22, '#9a9aa2');
    px(g, 36, 84, 12, 14, '#2c2c30');
  } else if (kind === 'cappu') {
    // ninja coffee cup
    px(g, 30, 34, 36, 12, '#101010');
    px(g, 58, 28, 20, 8, '#101010');
    px(g, 28, 46, 40, 48, '#d8b98a');
    px(g, 28, 46, 40, 8, '#8a5a2a');
    px(g, 64, 56, 10, 22, '#d8b98a');
    eye(36, 58, true);
    eye(52, 58, true);
    px(g, 42, 80, 12, 3, '#101010');
    px(g, 34, 94, 10, 16, '#3a3a3a');
    px(g, 52, 94, 10, 16, '#3a3a3a');
    px(g, 20, 60, 10, 26, '#c9c9c9');
    px(g, 66, 78, 14, 6, '#c9c9c9');
  } else if (kind === 'lirili') {
    // cactus elephant
    px(g, 14, 44, 18, 30, '#8a8a92');
    px(g, 64, 44, 18, 30, '#8a8a92');
    px(g, 28, 26, 40, 66, '#3f8a3f');
    px(g, 28, 26, 40, 6, '#2c6a2c');
    for (let y = 36; y < 86; y += 10) {
      px(g, 32, y, 4, 4, '#1e4a1e');
      px(g, 60, y + 4, 4, 4, '#1e4a1e');
    }
    eye(36, 44, false);
    eye(52, 44, false);
    px(g, 42, 60, 12, 32, '#8a8a92');
    px(g, 40, 88, 16, 8, '#6a6a72');
    px(g, 30, 92, 12, 14, '#6e4a26');
    px(g, 54, 92, 12, 14, '#6e4a26');
    px(g, 30, 102, 12, 4, '#3a2a18');
    px(g, 54, 102, 12, 4, '#3a2a18');
  } else if (kind === 'baller') {
    // dancing cup ballerina
    px(g, 36, 18, 24, 18, '#d8b98a');
    px(g, 36, 14, 24, 6, '#f2e8d8');
    px(g, 42, 4, 12, 10, '#ffd23a');
    eye(40, 22, false);
    eye(50, 22, false);
    px(g, 46, 52, 4, 14, '#d8a184');
    px(g, 20, 60, 56, 20, '#e88ab0');
    px(g, 28, 76, 40, 8, '#c46a90');
    px(g, 30, 40, 8, 22, '#d8a184');
    px(g, 58, 40, 8, 22, '#d8a184');
    px(g, 40, 84, 7, 24, '#d8a184');
    px(g, 49, 84, 7, 24, '#d8a184');
    px(g, 38, 106, 11, 6, '#e88ab0');
    px(g, 47, 106, 11, 6, '#e88ab0');
  } else if (kind === 'huggy') {
    // tall blue hugger (parody)
    px(g, 38, 20, 20, 20, '#2a4ad8');
    px(g, 42, 24, 6, 8, '#ffffff');
    px(g, 50, 24, 6, 8, '#ffffff');
    px(g, 43, 26, 4, 4, '#101010');
    px(g, 51, 26, 4, 4, '#101010');
    px(g, 38, 32, 20, 6, '#8a1020');
    px(g, 40, 32, 16, 2, '#ffffff');
    px(g, 44, 40, 4, 8, '#d81a2a');
    px(g, 38, 42, 6, 6, '#d81a2a');
    px(g, 52, 42, 6, 6, '#d81a2a');
    px(g, 36, 48, 24, 44, '#2a4ad8');
    px(g, 42, 54, 12, 30, '#d8cfa8');
    px(g, 14, 50, 10, 50, '#2a4ad8');
    px(g, 72, 50, 10, 50, '#2a4ad8');
    px(g, 12, 96, 14, 8, '#d8cfa8');
    px(g, 70, 96, 14, 8, '#d8cfa8');
    px(g, 38, 92, 8, 26, '#2a4ad8');
    px(g, 50, 92, 8, 26, '#2a4ad8');
  } else if (kind === 'vlad') {
    // vlogger with cap + A4 paper
    px(g, 28, 40, 40, 40, '#d8a184');
    px(g, 28, 28, 40, 16, '#1a1a1a');
    px(g, 60, 34, 16, 6, '#1a1a1a');
    g.fillStyle = '#ffffff';
    g.font = 'bold 13px Arial';
    g.fillText('Б4', 38, 41);
    eye(36, 52, false);
    eye(52, 52, false);
    px(g, 40, 68, 16, 4, '#7a3a2a');
    px(g, 24, 80, 48, 40, '#2a6ad8');
    px(g, 24, 80, 48, 8, '#1a4aa8');
    px(g, 66, 70, 20, 28, '#f2f2f2');
    px(g, 68, 76, 16, 2, '#9a9aa2');
    px(g, 68, 82, 16, 2, '#9a9aa2');
  } else if (kind === 'beast') {
    // generous beast in black tee
    px(g, 28, 36, 40, 30, '#d8a184');
    px(g, 28, 58, 40, 22, '#5c3a22');
    px(g, 40, 62, 16, 6, '#7a3a2a');
    eye(36, 44, false);
    eye(52, 44, false);
    px(g, 24, 80, 48, 42, '#1a1a1a');
    g.fillStyle = '#ffd23a';
    g.font = 'bold 11px Arial';
    g.fillText('ЗВІР', 33, 102);
    px(g, 66, 84, 18, 22, '#3f7a3a');
    g.fillStyle = '#ffffff';
    g.font = 'bold 14px Arial';
    g.fillText('$', 70, 100);
  } else {
    // glasha: grandma with selfie stick
    px(g, 20, 30, 56, 14, '#c42a2a');
    px(g, 20, 30, 10, 50, '#c42a2a');
    px(g, 66, 30, 10, 50, '#c42a2a');
    px(g, 30, 34, 6, 6, '#ffffff');
    px(g, 60, 34, 6, 6, '#ffffff');
    px(g, 32, 44, 32, 30, '#d8a184');
    px(g, 36, 52, 8, 8, '#ffffff');
    px(g, 52, 52, 8, 8, '#ffffff');
    px(g, 38, 54, 4, 4, '#101010');
    px(g, 54, 54, 4, 4, '#101010');
    px(g, 40, 66, 16, 3, '#7a3a2a');
    px(g, 24, 74, 48, 46, '#7a4a8a');
    px(g, 68, 20, 5, 60, '#3a3a3a');
    px(g, 60, 8, 20, 16, '#1a1a1a');
    px(g, 62, 10, 16, 12, '#7ad2ff');
  }
  const t = toTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  return t;
}
