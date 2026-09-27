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
    }
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
  g.fillStyle = '#33342f';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const v = 40 + Math.random() * 30;
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
  // center dashes
  g.fillStyle = '#b9b49a';
  g.fillRect(124, 20, 8, 90);
  g.fillRect(124, 150, 8, 90);
  return toTexture(c, 1, 6);
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
