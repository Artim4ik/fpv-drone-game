import * as THREE from "three";

function makeCanvas(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  return { canvas, context };
}

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(canvas: HTMLCanvasElement, { srgb = true, repeat = 0, anisotropy = 8 } = {}) {
  const texture = new THREE.CanvasTexture(canvas);
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  if (repeat > 0) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat, repeat);
  }
  texture.anisotropy = anisotropy;
  return texture;
}

/** Ground color map: dry soil, grass patches and pebbles. */
export function makeTerrainTexture() {
  const { canvas, context } = makeCanvas(512);
  const random = mulberry32(1337);
  context.fillStyle = "#9b977f";
  context.fillRect(0, 0, 512, 512);

  for (let index = 0; index < 170; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const radius = 10 + random() * 46;
    const tone = random() < 0.5 ? "112,106,74" : "148,152,112";
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${tone},${0.22 + random() * 0.3})`);
    gradient.addColorStop(1, `rgba(${tone},0)`);
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  for (let index = 0; index < 4600; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const dark = random() < 0.5;
    context.fillStyle = dark
      ? `rgba(56,52,38,${0.14 + random() * 0.4})`
      : `rgba(196,192,166,${0.1 + random() * 0.35})`;
    const size = 1 + random() * 2.2;
    context.fillRect(x, y, size, size);
  }

  for (let index = 0; index < 850; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    context.strokeStyle = `rgba(${58 + Math.floor(random() * 40)},${86 + Math.floor(random() * 52)},46,${0.2 + random() * 0.4})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (random() - 0.5) * 7, y - 3 - random() * 6);
    context.stroke();
  }

  return finish(canvas, { repeat: 64 });
}

/** Camouflage scheme with dirt streaks, scratches and weld panels. */
export function makeCamoTexture(seed: number, base: string, blotches: string[]) {
  const { canvas, context } = makeCanvas(512);
  const random = mulberry32(seed);
  context.fillStyle = base;
  context.fillRect(0, 0, 512, 512);

  for (let index = 0; index < 26; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    const radius = 34 + random() * 86;
    const tone = blotches[Math.floor(random() * blotches.length)];
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, tone);
    gradient.addColorStop(1, `${tone}00`);
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  }

  // Mud streaks running down the plates.
  for (let index = 0; index < 70; index += 1) {
    const x = random() * 512;
    const y = 140 + random() * 300;
    context.strokeStyle = `rgba(46,38,26,${0.06 + random() * 0.18})`;
    context.lineWidth = 1 + random() * 4;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + (random() - 0.5) * 10, y + 40 + random() * 150);
    context.stroke();
  }

  // Paint scratches revealing bare metal.
  for (let index = 0; index < 55; index += 1) {
    const x = random() * 512;
    const y = random() * 512;
    context.strokeStyle = `rgba(176,172,158,${0.12 + random() * 0.3})`;
    context.lineWidth = 0.8;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 6 + random() * 26, y + (random() - 0.5) * 14);
    context.stroke();
  }

  // Weld panel lines.
  context.strokeStyle = "rgba(24,26,20,0.5)";
  context.lineWidth = 2;
  for (let index = 1; index < 4; index += 1) {
    const offset = (index * 512) / 4 + (random() - 0.5) * 26;
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, 512);
    context.stroke();
  }

  return finish(canvas);
}

/** Grayscale bump for rolled steel plates, welds and cast texture. */
export function makeArmorBumpTexture() {
  const { canvas, context } = makeCanvas(256);
  const random = mulberry32(90210);
  context.fillStyle = "#808080";
  context.fillRect(0, 0, 256, 256);
  for (let index = 0; index < 3200; index += 1) {
    const value = 96 + Math.floor(random() * 64);
    context.fillStyle = `rgb(${value},${value},${value})`;
    context.fillRect(random() * 256, random() * 256, 1 + random() * 3, 1 + random() * 3);
  }
  context.strokeStyle = "rgba(180,180,180,0.85)";
  context.lineWidth = 2;
  for (let index = 0; index < 6; index += 1) {
    const y = random() * 256;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(256, y + (random() - 0.5) * 8);
    context.stroke();
  }
  return finish(canvas, { srgb: false });
}

/** Track link pattern for the crawler belts. */
export function makeTrackTexture() {
  const { canvas, context } = makeCanvas(128);
  context.fillStyle = "#191a17";
  context.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 16) {
    context.fillStyle = "#3a3b35";
    context.fillRect(2, y + 2, 124, 11);
    context.fillStyle = "#25261f";
    context.fillRect(56, y + 3, 16, 9);
    context.fillStyle = "#55564c";
    context.fillRect(6, y + 4, 4, 7);
    context.fillRect(118, y + 4, 4, 7);
  }
  const texture = finish(canvas, { repeat: 1 });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 4);
  return texture;
}

/** Tactical marking painted on the turret roof. */
export function makeMarkingTexture() {
  const { canvas, context } = makeCanvas(256);
  context.fillStyle = "#31342d";
  context.fillRect(0, 0, 256, 256);
  context.strokeStyle = "#e9e6d5";
  context.lineWidth = 30;
  context.lineCap = "square";
  context.beginPath();
  context.moveTo(56, 55);
  context.lineTo(194, 55);
  context.lineTo(60, 201);
  context.lineTo(200, 201);
  context.stroke();
  return finish(canvas);
}

/** Soft radial sprite used for smoke, muzzle flashes and fire. */
export function makeSoftParticleTexture(sharpness = 0.18) {
  const { canvas, context } = makeCanvas(128);
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(sharpness, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.24)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return finish(canvas);
}

/**
 * Radial motion-blur disc for fast-spinning propellers:
 * faint translucent disc with light-catching streak arcs.
 */
export function makePropBlurTexture() {
  const { canvas, context } = makeCanvas(128);
  const random = mulberry32(777);
  const gradient = context.createRadialGradient(64, 64, 8, 64, 64, 62);
  gradient.addColorStop(0, "rgba(255,255,255,0.08)");
  gradient.addColorStop(0.72, "rgba(255,255,255,0.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(64, 64, 62, 0, Math.PI * 2);
  context.fill();
  for (let index = 0; index < 9; index += 1) {
    const radius = 24 + random() * 34;
    const start = random() * Math.PI * 2;
    context.strokeStyle = `rgba(255,255,255,${0.14 + random() * 0.3})`;
    context.lineWidth = 1 + random() * 3;
    context.beginPath();
    context.arc(64, 64, radius, start, start + 0.7 + random() * 1.6);
    context.stroke();
  }
  return finish(canvas);
}

/** Ragged dark scorch mark left by warhead detonations. */
export function makeScorchTexture() {
  const { canvas, context } = makeCanvas(256);
  const random = mulberry32(4242);
  const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 124);
  gradient.addColorStop(0, "rgba(8,7,6,0.94)");
  gradient.addColorStop(0.55, "rgba(14,12,10,0.7)");
  gradient.addColorStop(1, "rgba(20,18,14,0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(128, 128, 124, 0, Math.PI * 2);
  context.fill();
  for (let index = 0; index < 60; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 70 + random() * 58;
    const x = 128 + Math.cos(angle) * radius;
    const y = 128 + Math.sin(angle) * radius;
    context.fillStyle = `rgba(10,9,7,${0.2 + random() * 0.4})`;
    context.beginPath();
    context.arc(x, y, 5 + random() * 16, 0, Math.PI * 2);
    context.fill();
  }
  return finish(canvas);
}
