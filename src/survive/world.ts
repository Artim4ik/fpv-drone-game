// ============================================================
// GREY CORRIDOR — procedural zones: city / training / frontline
// All geometry is generated in code. Collision = XZ AABBs.
// ============================================================
import * as THREE from 'three';
import { brickTexture, carPaintTexture, dirtTexture, facadeTexture, glowTexture, grassTexture, pavementTexture, plankTexture, plateUATexture, roadTexture, ruinTexture, scorchDecalTexture, signTexture, signTextTexture, awningTexture, softDotTexture, treadTexture, uaFlagTexture } from './textures';
import { photoTexture } from './assets';
import type { DocKind } from './types';

export interface BoxCollider {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export function resolveCollision(pos: THREE.Vector3, radius: number, cols: BoxCollider[]): void {
  for (const c of cols) {
    const nx = Math.max(c.x0, Math.min(c.x1, pos.x));
    const nz = Math.max(c.z0, Math.min(c.z1, pos.z));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < radius * radius) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * radius;
        pos.z = nz + (dz / d) * radius;
      } else {
        // inside the box: push out along the smallest penetration axis
        const px0 = pos.x - c.x0;
        const px1 = c.x1 - pos.x;
        const pz0 = pos.z - c.z0;
        const pz1 = c.z1 - pos.z;
        const m = Math.min(px0, px1, pz0, pz1);
        if (m === px0) pos.x = c.x0 - radius;
        else if (m === px1) pos.x = c.x1 + radius;
        else if (m === pz0) pos.z = c.z0 - radius;
        else pos.z = c.z1 + radius;
      }
    }
  }
}

/** Cheap segment-vs-AABB LOS test (sampled). */
export function losBlocked(ax: number, az: number, bx: number, bz: number, cols: BoxCollider[]): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(2, Math.min(24, Math.floor(dist / 2)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = ax + dx * t;
    const z = az + dz * t;
    for (const c of cols) {
      if (x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1) return true;
    }
  }
  return false;
}

/** True when standing right next to a wall/prop (but not inside it). */
export function nearCover(x: number, z: number, cols: BoxCollider[], pad = 1.3): boolean {
  for (const c of cols) {
    if (x > c.x0 - pad && x < c.x1 + pad && z > c.z0 - pad && z < c.z1 + pad) {
      const inside = x > c.x0 && x < c.x1 && z > c.z0 && z < c.z1;
      if (!inside) return true;
    }
  }
  return false;
}

/** Push a point out of colliders (for pickups/props placement). */
export function nudgeOut(pos: THREE.Vector3, cols: BoxCollider[], pad = 1.4): void {
  for (let tries = 0; tries < 24; tries++) {
    let inside = false;
    for (const c of cols) {
      if (pos.x > c.x0 - pad && pos.x < c.x1 + pad && pos.z > c.z0 - pad && pos.z < c.z1 + pad) {
        inside = true;
        break;
      }
    }
    if (!inside) break;
    pos.x += 2;
    if (pos.x > 97) pos.x = -97;
  }
}

export interface Pickup {
  id: number;
  pos: THREE.Vector3;
  group: THREE.Group;
  glow: THREE.Sprite;
  taken: boolean;
  docKind: DocKind;
  label: string;
}

export interface Beacon {
  id: string;
  pos: THREE.Vector3;
  group: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  visible: boolean;
}

export interface ZoneData {
  group: THREE.Group;
  colliders: BoxCollider[];
  pickups: Pickup[];
  beacons: Beacon[];
  route: THREE.Vector3[];
  walkLoops: THREE.Vector3[][];
  spawn: THREE.Vector3;
  spawnYaw: number;
  bounds: number;
  groundY: (x: number, z: number) => number;
  coverPoints: THREE.Vector3[];
  enemySpawns: THREE.Vector3[];
  hotspots: THREE.Vector3[];
  update: (dt: number, t: number) => void;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const geoBox = new THREE.BoxGeometry(1, 1, 1);
const geoCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
const geoCone = new THREE.ConeGeometry(0.5, 1, 8);
const geoSphere = new THREE.SphereGeometry(1, 10, 8);

function box(mat: THREE.Material, sx: number, sy: number, sz: number, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(geoBox, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeBeacon(color: number, height = 30): Beacon {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, height, 12, 1, true), mat);
  pillar.position.y = height / 2;
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.12, 8, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.25;
  group.add(pillar, ring);
  group.visible = false;
  return { id: '', pos: new THREE.Vector3(), group, mat, visible: false };
}

function setBeacon(b: Beacon, id: string, x: number, y: number, z: number, visible: boolean): void {
  b.id = id;
  b.pos.set(x, y, z);
  b.group.position.set(x, y, z);
  b.group.visible = visible;
  b.visible = visible;
}

// ============================================================ CITY
const SHOPS: Array<[string, string]> = [
  ['ПРОДУКТИ', '#1f4d3a'],
  ['АПТЕКА', '#27556e'],
  ['КАВА З СОБОЮ', '#5c3a22'],
  ['ПЕКАРНЯ', '#6e5227'],
  ['РЕМОНТ ВЗУТТЯ', '#444444'],
  ['КІОСК', '#6e2742'],
  ['КВІТИ', '#4a5c2a'],
  ['НОВА ПОШТА', '#8c2f26'],
  ['РОЗЕТКА', '#2a6e3a'],
  ['ОЩАДБАНК', '#2a3a5c'],
];

function buildCity(): ZoneData {
  const group = new THREE.Group();
  const colliders: BoxCollider[] = [];
  const pickups: Pickup[] = [];
  const beacons: Beacon[] = [];
  const walkLoops: THREE.Vector3[][] = [];
  const rnd = mulberry(1234);

  const HALF = 100;
  const ROADS = [-56, 0, 56];
  const ROAD_W = 10;

  // ground base (Kyiv courtyards dirt)
  const groundMat = new THREE.MeshStandardMaterial({ map: photoTexture('dirt', 20, 20, dirtTexture), color: '#c6cbd4', roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 60, HALF * 2 + 60), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);

  // sidewalk slabs under blocks
  const paveMat = new THREE.MeshStandardMaterial({ map: pavementTexture(), roughness: 0.95 });
  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 1 });
  const roadMatX = roadMat.clone();
  roadMatX.map = roadTexture();
  if (roadMatX.map) roadMatX.map.rotation = Math.PI / 2;

  const spans: Array<[number, number]> = [
    [-100, -61],
    [-51, -5],
    [5, 51],
    [61, 100],
  ];
  for (const [a, b] of spans) {
    for (const [c, d] of spans) {
      const w = b - a;
      const dd = d - c;
      const slab = new THREE.Mesh(new THREE.PlaneGeometry(w, dd), paveMat);
      slab.rotation.x = -Math.PI / 2;
      slab.position.set((a + b) / 2, 0, (c + d) / 2);
      slab.receiveShadow = true;
      group.add(slab);
    }
  }
  // roads
  for (const r of ROADS) {
    const rz = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, HALF * 2), roadMat);
    rz.rotation.x = -Math.PI / 2;
    rz.position.set(r, 0.02, 0);
    rz.receiveShadow = true;
    group.add(rz);
    const rx = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, ROAD_W), roadMatX);
    rx.rotation.x = -Math.PI / 2;
    rx.position.set(0, 0.02, r);
    rx.receiveShadow = true;
    group.add(rx);
  }

  // facades cache: real panel-house photos mixed with procedural variety
  const facades: THREE.Texture[] = [];
  facades.push(photoTexture('facade1', 1, 1, () => facadeTexture(40, 9, 5)));
  facades.push(facadeTexture(57, 6, 6));
  facades.push(photoTexture('facade2', 1, 1, () => facadeTexture(74, 8, 4)));
  facades.push(facadeTexture(91, 5, 7));
  facades.push(photoTexture('facade3', 1, 1, () => facadeTexture(108, 9, 6)));
  facades.push(facadeTexture(125, 7, 5));
  const roofMat = new THREE.MeshStandardMaterial({ color: '#3c3a34', roughness: 1 });

  const addCollider = (x: number, z: number, w: number, d: number): void => {
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
  };

  // buildings per block
  let shopIdx = 0;
  const carColors = ['#5a6068', '#3a4a5c', '#6e2f28', '#2f4a3a', '#777264', '#22242a', '#7a6a4a'];
  const carPaintTex = carPaintTexture();
  const treadTex = treadTexture();
  const carMatCache = new Map<string, THREE.MeshStandardMaterial>();
  const carMat = (c: string): THREE.MeshStandardMaterial => {
    let m = carMatCache.get(c);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color: c, map: carPaintTex, roughness: 0.4, metalness: 0.4 });
      carMatCache.set(c, m);
    }
    return m;
  };
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1c2228', roughness: 0.15, metalness: 0.7 });
  const tireMat = new THREE.MeshStandardMaterial({ color: '#ffffff', map: treadTex, roughness: 0.9 });
  const carPlates = [plateUATexture('АА 2210 КА'), plateUATexture('КА 7781 АА'), plateUATexture('АА 0456 КВ')];

  const buildCar = (burned: boolean): THREE.Group => {
    const car = new THREE.Group();
    const col = burned ? '#1a1a1a' : carColors[Math.floor(rnd() * carColors.length)];
    const body = box(carMat(col), 1.8, 0.62, 4.2, 0, 0.62, 0);
    const cabin = box(burned ? carMat(col) : glassMat, 1.6, 0.55, 2.1, 0, 1.18, -0.2);
    car.add(body, cabin);
    for (const [wx, wz] of [[-0.85, 1.3], [0.85, 1.3], [-0.85, -1.3], [0.85, -1.3]]) {
      const wheel = new THREE.Mesh(geoCyl, tireMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.scale.set(0.66, 0.3, 0.66);
      wheel.position.set(wx, 0.33, wz);
      car.add(wheel);
    }
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.14), new THREE.MeshBasicMaterial({ map: carPlates[Math.floor(rnd() * carPlates.length)] }));
    plate.position.set(0, 0.55, -2.11);
    plate.rotation.y = Math.PI;
    car.add(plate);
    if (burned) {
      const scorch = box(new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 1 }), 1.9, 0.2, 4.3, 0, 1.0, 0);
      car.add(scorch);
    }
    return car;
  };

  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3e2d', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3d5230', roughness: 1 });
  const buildTree = (x: number, z: number, s: number): void => {
    const t = new THREE.Group();
    const trunk = new THREE.Mesh(geoCyl, trunkMat);
    trunk.scale.set(0.36 * s, 2.4 * s, 0.36 * s);
    trunk.position.y = 1.2 * s;
    trunk.castShadow = true;
    const c1 = new THREE.Mesh(geoSphere, leafMat);
    c1.scale.set(1.9 * s, 1.7 * s, 1.9 * s);
    c1.position.y = 3.1 * s;
    c1.castShadow = true;
    const c2 = new THREE.Mesh(geoSphere, leafMat);
    c2.scale.set(1.3 * s, 1.1 * s, 1.3 * s);
    c2.position.set(0.7 * s, 2.4 * s, 0.4 * s);
    c2.castShadow = true;
    t.add(trunk, c1, c2);
    t.position.set(x, 0, z);
    group.add(t);
    addCollider(x, z, 0.5, 0.5);
  };

  const dumpMat = new THREE.MeshStandardMaterial({ color: '#2f4a3a', roughness: 0.9 });
  const crateMat = new THREE.MeshStandardMaterial({ map: photoTexture('wood', 1, 1, plankTexture), roughness: 1 });
  const fenceMat = new THREE.MeshStandardMaterial({ color: '#5c5a52', roughness: 0.9 });
  const garageMat = new THREE.MeshStandardMaterial({ map: photoTexture('brick', 2, 1, brickTexture), roughness: 0.95 });
  const doorMat = new THREE.MeshStandardMaterial({ color: '#1e2126', roughness: 0.8 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: '#4a4a48', roughness: 0.9 });

  spans.forEach(([ax, bx], bi) => {
    spans.forEach(([az, bz], bj) => {
      const cx = (ax + bx) / 2;
      const cz = (az + bz) / 2;
      const w = bx - ax;
      const d = bz - az;
      // 1-2 buildings per block, each confined to its own half (never overlap)
      const nB = bi === 0 && bj === 3 ? 1 : 1 + Math.floor(rnd() * 2);
      const vertical = (bi + bj) % 2 === 0;
      const IN = 4;
      for (let k = 0; k < nB; k++) {
        const maxW = nB === 2 && vertical ? w / 2 - IN - 2.5 : w - 2 * IN;
        const maxD = nB === 2 && !vertical ? d / 2 - IN - 2.5 : d - 2 * IN;
        const bw = Math.min(9 + rnd() * 11, Math.max(10, maxW));
        const bd = Math.min(8 + rnd() * 9, Math.max(9, maxD));
        const bh = 12 + rnd() * 18;
        let px: number;
        let pz: number;
        if (nB === 1) {
          px = ax + IN + bw / 2 + rnd() * Math.max(0, w - 2 * IN - bw);
          pz = az + IN + bd / 2 + rnd() * Math.max(0, d - 2 * IN - bd);
        } else if (vertical) {
          px = k === 0 ? ax + IN + bw / 2 + rnd() * Math.max(0, cx - 1.5 - (ax + IN) - bw) : cx + 1.5 + bw / 2 + rnd() * Math.max(0, bx - IN - (cx + 1.5) - bw);
          pz = az + IN + bd / 2 + rnd() * Math.max(0, d - 2 * IN - bd);
        } else {
          pz = k === 0 ? az + IN + bd / 2 + rnd() * Math.max(0, cz - 1.5 - (az + IN) - bd) : cz + 1.5 + bd / 2 + rnd() * Math.max(0, bz - IN - (cz + 1.5) - bd);
          px = ax + IN + bw / 2 + rnd() * Math.max(0, w - 2 * IN - bw);
        }
        if (bi === 0 && bj === 3) pz = Math.max(pz, 79);
        const tex = facades[(bi * 4 + bj + k) % facades.length].clone();
        tex.needsUpdate = true;
        tex.repeat.set(Math.max(1, Math.round(bw / 12)), Math.max(1, Math.round(bh / 14)));
        const side = new THREE.MeshStandardMaterial({ map: tex, color: '#c3cbdc', roughness: 0.9 });
        const bld = new THREE.Mesh(geoBox, [side, side, roofMat, roofMat, side, side]);
        bld.scale.set(bw, bh, bd);
        bld.position.set(px, bh / 2, pz);
        bld.castShadow = true;
        bld.receiveShadow = true;
        group.add(bld);
        addCollider(px, pz, bw, bd);
        const doorM = box(doorMat, 1.6, 2.4, 0.2, px - bw * 0.25, 1.2, pz + bd / 2 + 0.05);
        doorM.castShadow = false;
        group.add(doorM);
        group.add(box(canopyMat, 2.6, 0.15, 1.4, px - bw * 0.25, 2.6, pz + bd / 2 + 0.7));
        // shop sign on some buildings
        if (rnd() < 0.55 && shopIdx < 24) {
          const [text, bg] = SHOPS[shopIdx % SHOPS.length];
          shopIdx++;
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(Math.min(9, bw * 0.7), 1.7),
            new THREE.MeshBasicMaterial({ map: signTexture(text, bg) }),
          );
          sign.position.set(px, 3.4, pz + bd / 2 + 0.06);
          group.add(sign);
          const awn = box(new THREE.MeshStandardMaterial({ color: bg, roughness: 0.8 }), Math.min(9, bw * 0.7), 0.15, 1.6, px, 2.4, pz + bd / 2 + 0.8);
          awn.castShadow = false;
          group.add(awn);
        }
      }
      // courtyard props
      const nDump = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < nDump; k++) {
        const dp = new THREE.Vector3(cx + (rnd() - 0.5) * w * 0.6, 0, cz + (rnd() - 0.5) * d * 0.6);
        nudgeOut(dp, colliders, 2);
        const px = dp.x;
        const pz = dp.z;
        const dump = box(dumpMat, 2.2, 1.3, 1.2, px, 0.65, pz, (rnd() - 0.5) * 0.3);
        group.add(dump);
        addCollider(px, pz, 2.2, 1.4);
      }
      for (let k = 0; k < 3; k++) {
        const cp = new THREE.Vector3(cx + (rnd() - 0.5) * w * 0.7, 0, cz + (rnd() - 0.5) * d * 0.7);
        nudgeOut(cp, colliders, 1.2);
        const px = cp.x;
        const pz = cp.z;
        const s = 0.8 + rnd() * 0.8;
        group.add(box(crateMat, s, s, s, px, s / 2, pz, rnd() * 1.2));
      }
      if (rnd() < 0.55) {
        const bp = new THREE.Vector3(cx + (rnd() - 0.5) * w * 0.4, 0, cz + (rnd() - 0.5) * d * 0.4);
        nudgeOut(bp, colliders, 1.6);
        const bx = bp.x;
        const bz = bp.z;
        group.add(box(crateMat, 1.8, 0.1, 0.5, bx, 0.5, bz));
        group.add(box(crateMat, 1.8, 0.5, 0.1, bx, 0.85, bz - 0.25));
        addCollider(bx, bz, 1.8, 0.6);
      }
      if (rnd() < 0.7) {
        const tp = new THREE.Vector3(cx + (rnd() - 0.5) * w * 0.5, 0, cz + (rnd() - 0.5) * d * 0.5);
        nudgeOut(tp, colliders, 1.2);
        buildTree(tp.x, tp.z, 0.9 + rnd() * 0.7);
      }
      // parked car in courtyard
      if (rnd() < 0.6) {
        const vp = new THREE.Vector3(cx + (rnd() - 0.5) * w * 0.55, 0, cz + (rnd() - 0.5) * d * 0.55);
        nudgeOut(vp, colliders, 2.6);
        const px = vp.x;
        const pz = vp.z;
        const car = buildCar(false);
        car.position.set(px, 0, pz);
        car.rotation.y = rnd() * Math.PI;
        group.add(car);
        addCollider(px, pz, 3.4, 3.4);
      }
      // garages in one corner block (abandoned lot)
      if (bi === 0 && bj === 3) {
        for (let k = 0; k < 4; k++) {
          const px = ax + 6 + k * 7;
          const pz = az + 6;
          const gar = box(garageMat, 6, 2.6, 5, px, 1.3, pz);
          group.add(gar);
          addCollider(px, pz, 6, 5);
        }
        const wreck = buildCar(true);
        const wp = new THREE.Vector3(cx + 8, 0, cz + 6);
        nudgeOut(wp, colliders, 2.6);
        wreck.position.set(wp.x, 0, wp.z);
        wreck.rotation.y = 0.7;
        group.add(wreck);
        addCollider(wp.x, wp.z, 3.4, 3.4);
        const scorch = new THREE.Mesh(
          new THREE.PlaneGeometry(6, 6),
          new THREE.MeshStandardMaterial({ map: photoTexture('scorch', 1, 1, scorchDecalTexture), roughness: 1, transparent: true, opacity: 0.85, depthWrite: false }),
        );
        scorch.rotation.x = -Math.PI / 2;
        scorch.rotation.z = 0.7;
        scorch.position.set(wp.x, 0.04, wp.z);
        scorch.receiveShadow = true;
        group.add(scorch);
      }
      // walk loop around block (sidewalk)
      const m = 2.2;
      walkLoops.push([
        new THREE.Vector3(ax + m, 0, az + m),
        new THREE.Vector3(bx - m, 0, az + m),
        new THREE.Vector3(bx - m, 0, bz - m),
        new THREE.Vector3(ax + m, 0, bz - m),
      ]);
    });
  });

  // market row: stalls with canopies (nudged out of buildings)
  {
    const stallWood = new THREE.MeshStandardMaterial({ map: photoTexture('wood', 1, 1, plankTexture), roughness: 1 });
    const stallCloth = new THREE.MeshStandardMaterial({ map: awningTexture('#a8352c'), roughness: 0.85, side: THREE.DoubleSide });
    const stallCloth2 = new THREE.MeshStandardMaterial({ map: awningTexture('#2c5f8a'), roughness: 0.85, side: THREE.DoubleSide });
    for (let sxi = 0; sxi < 4; sxi++) {
      const sp = new THREE.Vector3(7, 0, -38 + sxi * 6);
      group.add(box(stallWood, 2.6, 0.9, 1.4, sp.x, 0.45, sp.z));
      const legs: Array<[number, number]> = [[-1.2, -0.6], [1.2, -0.6], [-1.2, 0.6], [1.2, 0.6]];
      for (const [ox, oz] of legs) {
        group.add(box(stallWood, 0.12, 2.2, 0.12, sp.x + ox, 1.1, sp.z + oz));
      }
      const cloth = box(sxi % 2 ? stallCloth2 : stallCloth, 3, 0.12, 2, sp.x, 2.25, sp.z, 0.06);
      cloth.castShadow = false;
      group.add(cloth);
      group.add(box(crateMat, 0.7, 0.7, 0.7, sp.x - 0.6, 1.25, sp.z));
      group.add(box(crateMat, 0.6, 0.6, 0.6, sp.x + 0.5, 1.2, sp.z + 0.2));
      addCollider(sp.x, sp.z, 2.8, 1.8);
    }
  }

  // street lights along roads
  const poleMat = new THREE.MeshStandardMaterial({ color: '#2c2c2c', roughness: 0.8 });
  const lampHeadMat = new THREE.MeshStandardMaterial({ color: '#444444', emissive: '#ffca7a', emissiveIntensity: 2.6 });
  const lampLights: THREE.PointLight[] = [];
  const wirePts: THREE.Vector3[] = [];
  for (const r of ROADS) {
    for (let i = -2; i <= 2; i++) {
      const p = i * 40 + 12;
      for (const [x, z, horiz] of [[r + 6.5, p, false], [p, r - 6.5, true]] as Array<[number, number, boolean]>) {
        const pole = box(poleMat, 0.25, 7, 0.25, x, 3.5, z);
        pole.castShadow = false;
        group.add(pole);
        const arm = box(poleMat, horiz ? 0.2 : 2.2, 0.15, horiz ? 2.2 : 0.2, horiz ? x : x - 1, 6.9, horiz ? z + 1 : z);
        arm.castShadow = false;
        group.add(arm);
        const head = box(lampHeadMat, 0.7, 0.25, 0.4, horiz ? x : x - 2, 6.8, horiz ? z + 2 : z);
        head.castShadow = false;
        group.add(head);
        addCollider(x, z, 0.4, 0.4);
        wirePts.push(new THREE.Vector3(x, 6.9, z));
      }
    }
  }
  // sagging wires between lamp poles
  {
    const pts: number[] = [];
    for (let i = 1; i < wirePts.length; i++) {
      const a = wirePts[i - 1];
      const b = wirePts[i];
      if (a.distanceTo(b) > 60) continue;
      const segs = 6;
      for (let sgm = 0; sgm < segs; sgm++) {
        const t0 = sgm / segs;
        const t1 = (sgm + 1) / segs;
        const sag = (t: number): number => Math.sin(t * Math.PI) * -0.8;
        pts.push(a.x + (b.x - a.x) * t0, a.y + sag(t0), a.z + (b.z - a.z) * t0);
        pts.push(a.x + (b.x - a.x) * t1, a.y + sag(t1), a.z + (b.z - a.z) * t1);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#1a1a1a', transparent: true, opacity: 0.7 })));
  }

  // a few real point lights near spawn (dusk mood)
  const lampGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffca7a', transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending });
  for (const [x, z] of [[6.5, 12], [12, -6.5], [-49.5, -44], [62.5, 52]]) {
    const pl = new THREE.PointLight('#ffca7a', 12, 26, 1.8);
    pl.position.set(x, 6.6, z);
    group.add(pl);
    lampLights.push(pl);
    const lgs = new THREE.Sprite(lampGlowMat);
    lgs.scale.set(2.6, 2.6, 1);
    lgs.position.set(x, 6.6, z);
    group.add(lgs);
  }

  // Khreshchatyk street plates on lamp poles near the center
  const streetTex = signTexture('ВУЛ. ХРЕЩАТИК', '#2a3a5c');
  for (const [px, pz, ry] of [[6.5, -28, Math.PI / 2], [6.5, 12, Math.PI / 2], [12, -6.5, 0], [-28, -6.5, 0]] as Array<[number, number, number]>) {
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.55), new THREE.MeshBasicMaterial({ map: streetTex, side: THREE.DoubleSide }));
    plate.position.set(px, 3.4, pz);
    plate.rotation.y = ry;
    group.add(plate);
  }

  // ground clutter: scattered paper scraps
  {
    const clutGeo = new THREE.PlaneGeometry(0.4, 0.3);
    const clutMat = new THREE.MeshStandardMaterial({ color: '#b8b4a4', roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 70; i++) {
      const m = new THREE.Mesh(clutGeo, clutMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = rnd() * Math.PI * 2;
      m.position.set((rnd() - 0.5) * 190, 0.03 + rnd() * 0.02, (rnd() - 0.5) * 190);
      group.add(m);
    }
  }

  // bus stop
  const stopGlass = new THREE.MeshStandardMaterial({ color: '#9fb4c0', transparent: true, opacity: 0.3, roughness: 0.2 });
  const shelter = new THREE.Group();
  shelter.add(box(poleMat, 0.15, 2.6, 0.15, -2, 1.3, 0));
  shelter.add(box(poleMat, 0.15, 2.6, 0.15, 2, 1.3, 0));
  shelter.add(box(fenceMat, 4.6, 0.15, 1.6, 0, 2.65, 0));
  const back = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.8), stopGlass);
  back.position.set(0, 1.4, -0.7);
  shelter.add(back);
  shelter.position.set(6.5, 0, -24);
  group.add(shelter);
  addCollider(6.5, -24, 4.6, 1.8);
  // prefabricated kiosks (Kyiv classic) near the bus stop
  const kioskGlass = new THREE.MeshStandardMaterial({ color: '#20262c', roughness: 0.2, metalness: 0.5 });
  const kioskRoof = new THREE.MeshStandardMaterial({ color: '#6e2742', roughness: 0.8 });
  for (const [kx, kz, ry, label] of [[14.5, -17, 0.15, 'КІОСК'], [13.5, -31, -0.12, 'ТЮТЮН']] as Array<[number, number, number, string]>) {
    const kp = new THREE.Vector3(kx, 0, kz);
    nudgeOut(kp, colliders, 2.4);
    const k = new THREE.Group();
    k.add(box(garageMat, 3.2, 2.5, 2.6, 0, 1.25, 0));
    k.add(box(kioskRoof, 3.6, 0.18, 3.0, 0, 2.6, 0));
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.9), kioskGlass);
    win.position.set(0, 1.6, 1.31);
    k.add(win);
    const ks = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), new THREE.MeshBasicMaterial({ map: signTexture(label, '#6e2742') }));
    ks.position.set(0, 2.25, 1.32);
    k.add(ks);
    k.position.set(kp.x, 0, kp.z);
    k.rotation.y = ry;
    group.add(k);
    addCollider(kp.x, kp.z, 3.4, 2.8);
  }
  const stopPlate = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), new THREE.MeshBasicMaterial({ map: signTexture('ЗУПИНКА', '#27556e') }));
  stopPlate.position.set(4.05, 2.2, -24);
  stopPlate.rotation.y = -Math.PI / 2;
  group.add(stopPlate);

  // traffic cars (animated in update)
  const traffic: Array<{ g: THREE.Group; s: number; speed: number }> = [];
  const route = [new THREE.Vector3(-56, 0, -56), new THREE.Vector3(56, 0, -56), new THREE.Vector3(56, 0, 56), new THREE.Vector3(-56, 0, 56)];
  const headGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffe9a8', transparent: true, opacity: 0.75, depthWrite: false, blending: THREE.AdditiveBlending });
  const tailGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff3a2a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  for (let i = 0; i < 3; i++) {
    const car = buildCar(false);
    for (const s of [-1, 1]) {
      const hg = new THREE.Sprite(headGlowMat);
      hg.scale.set(0.9, 0.9, 1);
      hg.position.set(s * 0.6, 0.7, 2.2);
      car.add(hg);
      const tg = new THREE.Sprite(tailGlowMat);
      tg.scale.set(0.55, 0.55, 1);
      tg.position.set(s * 0.6, 0.7, -2.15);
      car.add(tg);
    }
    group.add(car);
    traffic.push({ g: car, s: i / 3, speed: 0.014 + rnd() * 0.006 });
  }
  const routeLen = 4 * 112;
  const routePoint = (s: number, out: THREE.Vector3): THREE.Vector3 => {
    const d = ((s % 1) + 1) % 1 * routeLen;
    const seg = Math.floor(d / 112);
    const t = (d % 112) / 112;
    const a = route[seg % 4];
    const b = route[(seg + 1) % 4];
    // drive on right side: offset perpendicular +2.4
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    const px = -dz / len;
    const pz = dx / len;
    out.set(a.x + dx * t + px * 2.4, 0, a.z + dz * t + pz * 2.4);
    return out;
  };

  // document pickups
  const dotTex = softDotTexture();
  const pickupDefs: Array<[number, number, DocKind, string]> = [
    [-28, -20, 'registration', 'Тека з паперами'],
    [24, 30, 'incomplete', 'Незаповнений бланк'],
    [-80, 70, 'temp_pass', 'Перепустка в гаражах'],
    [80, -72, 'civil_id', 'Чийсь паспорт'],
    [30, -80, 'medical', 'Меддовідка'],
    [-70, -80, 'forged', 'Підозрілий згорток'],
    [78, 74, 'exemption', 'Запечатаний конверт'],
  ];
  const paperMat = new THREE.MeshStandardMaterial({ color: '#e8e2ce', roughness: 0.9, emissive: '#555540', emissiveIntensity: 0.4 });
  pickupDefs.forEach(([x, z, kind, label], id) => {
    const g = new THREE.Group();
    const paper = box(paperMat, 0.5, 0.06, 0.7, 0, 0.5, 0, 0.4);
    paper.castShadow = false;
    const glowMat = new THREE.SpriteMaterial({ map: dotTex, color: '#ffd27a', transparent: true, opacity: 0.55, depthWrite: false });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(2.4, 2.4, 1);
    glow.position.y = 0.5;
    g.add(paper, glow);
    g.position.set(x, 0, z);
    group.add(g);
    pickups.push({ id, pos: new THREE.Vector3(x, 0, z), group: g, glow, taken: false, docKind: kind, label });
  });

  // nudge pickups out of building colliders so they stay reachable
  for (const p of pickups) {
    for (let tries = 0; tries < 24; tries++) {
      let inside = false;
      for (const c of colliders) {
        if (p.pos.x > c.x0 - 1.4 && p.pos.x < c.x1 + 1.4 && p.pos.z > c.z0 - 1.4 && p.pos.z < c.z1 + 1.4) {
          inside = true;
          break;
        }
      }
      if (!inside) break;
      p.pos.x += 2;
      if (p.pos.x > 97) p.pos.x = -97;
    }
    p.group.position.set(p.pos.x, 0, p.pos.z);
  }

  // mission beacons pool
  for (let i = 0; i < 4; i++) {
    const b = makeBeacon(i === 0 ? 0xffd27a : 0x7ad2ff);
    group.add(b.group);
    beacons.push(b);
  }

  // ---------------- KYIV COURTYARD LIFE ----------------
  const nudgeFree = (x: number, z: number, r = 1.4): [number, number] => {
    let px = x;
    let pz = z;
    for (let tries = 0; tries < 40; tries++) {
      let inside = false;
      for (const c of colliders) {
        if (px > c.x0 - r && px < c.x1 + r && pz > c.z0 - r && pz < c.z1 + r) {
          inside = true;
          break;
        }
      }
      if (!inside) return [px, pz];
      px += 2.5;
      if (px > 94) {
        px = -94;
        pz += 2.5;
        if (pz > 94) pz = -94;
      }
    }
    return [px, pz];
  };

  // kiosk with lit window (faces the spawn street)
  const kioskWinMat = new THREE.MeshStandardMaterial({ color: '#5a4a33', emissive: '#ffd9a0', emissiveIntensity: 1.8 });
  let kioskLight: THREE.PointLight;
  let kioskGlow: THREE.Sprite;
  {
    const [kx, kz] = nudgeFree(15.5, -24, 2.6);
    const kBody = new THREE.MeshStandardMaterial({ color: '#3f5a44', roughness: 0.85 });
    group.add(box(kBody, 3, 2.6, 2.5, kx, 1.3, kz));
    group.add(box(new THREE.MeshStandardMaterial({ color: '#2c2c2c', roughness: 0.9 }), 3.4, 0.15, 2.9, kx, 2.7, kz));
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), kioskWinMat);
    win.position.set(kx, 1.6, kz + 1.26);
    group.add(win);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 0.62),
      new THREE.MeshBasicMaterial({ map: signTextTexture('ПРОДУКТИ', '#7a1f1f') }),
    );
    sign.position.set(kx, 2.35, kz + 1.27);
    group.add(sign);
    kioskLight = new THREE.PointLight('#ffca7a', 8, 15, 1.8);
    kioskLight.position.set(kx, 2.4, kz + 2.2);
    group.add(kioskLight);
    kioskGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffca7a', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    kioskGlow.scale.set(4, 3, 1);
    kioskGlow.position.set(kx, 1.8, kz + 1.6);
    group.add(kioskGlow);
    addCollider(kx, kz, 3.2, 2.7);
  }

  // playground with animated swings
  const swings: THREE.Group[] = [];
  {
    const [px, pz] = nudgeFree(36, 62, 4);
    const frameM = new THREE.MeshStandardMaterial({ color: '#b3541e', roughness: 0.7 });
    for (const fx of [-2.2, 2.2]) {
      group.add(box(frameM, 0.14, 2.6, 0.14, px + fx, 1.3, pz));
    }
    group.add(box(frameM, 4.8, 0.12, 0.12, px, 2.6, pz));
    for (let i = 0; i < 2; i++) {
      const sw = new THREE.Group();
      sw.position.set(px - 1.1 + i * 2.2, 2.55, pz);
      const ropeM = new THREE.MeshStandardMaterial({ color: '#888888', roughness: 0.8 });
      sw.add(box(ropeM, 0.04, 1.5, 0.04, -0.28, -0.75, 0));
      sw.add(box(ropeM, 0.04, 1.5, 0.04, 0.28, -0.75, 0));
      sw.add(box(new THREE.MeshStandardMaterial({ color: '#4a6b8a', roughness: 0.8 }), 0.66, 0.07, 0.3, 0, -1.5, 0));
      sw.userData.ph = i * Math.PI * 0.8;
      group.add(sw);
      swings.push(sw);
    }
    addCollider(px, pz, 5, 1.2);
  }

  // benches with grannies on watch
  {
    const woodM = new THREE.MeshStandardMaterial({ color: '#6b5136', roughness: 0.9 });
    const ironM = new THREE.MeshStandardMaterial({ color: '#2e3238', roughness: 0.7 });
    const granny = (x: number, z: number, ry: number, coat: string, scarf: string): void => {
      const fig = new THREE.Group();
      fig.position.set(x, 0.46, z);
      fig.rotation.y = ry;
      fig.add(box(new THREE.MeshStandardMaterial({ color: '#3a3a42', roughness: 1 }), 0.42, 0.34, 0.36, 0, 0.17, 0.05));
      fig.add(box(new THREE.MeshStandardMaterial({ color: coat, roughness: 1 }), 0.38, 0.5, 0.26, 0, 0.55, 0));
      fig.add(box(new THREE.MeshStandardMaterial({ color: '#c9a186', roughness: 0.8 }), 0.24, 0.26, 0.24, 0, 0.92, 0));
      fig.add(box(new THREE.MeshStandardMaterial({ color: scarf, roughness: 1 }), 0.28, 0.12, 0.28, 0, 1.06, 0));
      const armM = new THREE.MeshStandardMaterial({ color: coat, roughness: 1 });
      fig.add(box(armM, 0.09, 0.09, 0.4, -0.16, 0.52, 0.2));
      fig.add(box(armM, 0.09, 0.09, 0.4, 0.16, 0.52, 0.2));
      group.add(fig);
    };
    const benchDefs: Array<[number, number, number, string, string]> = [
      [24, 52, Math.PI, '#5c3a52', '#b8b0a0'],
      [27.5, 55, Math.PI, '#3a4a5c', '#7a8a9a'],
    ];
    benchDefs.forEach(([bxx, bzz, ry, coat, scarf]) => {
      const [px, pz] = nudgeFree(bxx, bzz, 1.6);
      group.add(box(woodM, 1.9, 0.09, 0.45, px, 0.46, pz));
      group.add(box(woodM, 1.9, 0.45, 0.08, px, 0.75, pz + 0.24));
      group.add(box(ironM, 0.08, 0.46, 0.4, px - 0.8, 0.23, pz));
      group.add(box(ironM, 0.08, 0.46, 0.4, px + 0.8, 0.23, pz));
      granny(px - 0.45, pz, ry, coat, scarf);
      granny(px + 0.45, pz, ry, scarf, coat);
      addCollider(px, pz, 2, 0.7);
    });
  }

  // dovecote + pigeons
  const pigeons: THREE.Group[] = [];
  {
    const [dx, dz] = nudgeFree(46, 50, 1.6);
    group.add(box(trunkMat, 0.25, 5, 0.25, dx, 2.5, dz));
    group.add(box(crateMat, 1.3, 1, 1.3, dx, 5.5, dz));
    group.add(box(new THREE.MeshStandardMaterial({ color: '#5a3a2a', roughness: 0.9 }), 1.5, 0.14, 1.5, dx, 6.05, dz));
    addCollider(dx, dz, 0.6, 0.6);
    const pgM = new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 0.9 });
    const pgD = new THREE.MeshStandardMaterial({ color: '#5a5e66', roughness: 0.9 });
    for (let i = 0; i < 7; i++) {
      const pg = new THREE.Group();
      pg.add(box(i % 2 ? pgM : pgD, 0.16, 0.14, 0.26, 0, 0.1, 0));
      pg.add(box(i % 2 ? pgD : pgM, 0.1, 0.1, 0.1, 0, 0.2, 0.14));
      const cx = 28 + (rnd() - 0.5) * 10;
      const cz = 56 + (rnd() - 0.5) * 10;
      pg.position.set(cx, i === 0 ? 7 : 0.02, cz);
      pg.userData = { cx, cz, ph: rnd() * 6.28, wt: rnd() * 2, dir: rnd() * 6.28, peck: 0, fly: i === 0 };
      group.add(pg);
      pigeons.push(pg);
    }
  }

  // laundry lines
  const cloths: THREE.Mesh[] = [];
  {
    const [lx, lz] = nudgeFree(33, 42, 3);
    const poleM = new THREE.MeshStandardMaterial({ color: '#4a4a48', roughness: 0.8 });
    group.add(box(poleM, 0.1, 2.4, 0.1, lx - 3, 1.2, lz));
    group.add(box(poleM, 0.1, 2.4, 0.1, lx + 3, 1.2, lz));
    group.add(box(poleM, 6.1, 0.025, 0.025, lx, 2.25, lz));
    const cols = ['#d8d4c8', '#7a9ab8', '#c48a9a'];
    for (let i = 0; i < 3; i++) {
      const cl = new THREE.Mesh(
        new THREE.PlaneGeometry(0.75, 0.95),
        new THREE.MeshStandardMaterial({ color: cols[i], roughness: 1, side: THREE.DoubleSide }),
      );
      cl.position.set(lx - 1.8 + i * 1.8, 1.75, lz);
      cl.userData.ph = i * 2.1;
      group.add(cl);
      cloths.push(cl);
    }
    addCollider(lx, lz, 6.4, 0.5);
  }

  // transformer substation booth
  {
    const [tx, tz] = nudgeFree(40, -40, 2.4);
    const tBody = new THREE.MeshStandardMaterial({ color: '#5c6258', roughness: 0.85 });
    group.add(box(tBody, 3.4, 2.4, 2.2, tx, 1.2, tz));
    group.add(box(new THREE.MeshStandardMaterial({ color: '#3c3a34', roughness: 1 }), 3.7, 0.15, 2.5, tx, 2.5, tz));
    group.add(box(new THREE.MeshStandardMaterial({ color: '#2f4a3a', roughness: 0.8 }), 0.9, 1.8, 0.1, tx - 0.7, 0.9, tz + 1.12));
    const warn = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.32), new THREE.MeshBasicMaterial({ map: signTextTexture('НЕ ВЛІЗАЙ', '#8a7a1a', '#1a1a1a') }));
    warn.position.set(tx + 0.6, 1.7, tz + 1.13);
    group.add(warn);
    addCollider(tx, tz, 3.6, 2.4);
  }

  // sandbox
  {
    const [sx, sz] = nudgeFree(30, 70, 3);
    const edgeM = new THREE.MeshStandardMaterial({ color: '#7a6248', roughness: 0.9 });
    group.add(box(edgeM, 4.2, 0.3, 0.25, sx, 0.15, sz - 2));
    group.add(box(edgeM, 4.2, 0.3, 0.25, sx, 0.15, sz + 2));
    group.add(box(edgeM, 0.25, 0.3, 4.2, sx - 2, 0.15, sz));
    group.add(box(edgeM, 0.25, 0.3, 4.2, sx + 2, 0.15, sz));
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshStandardMaterial({ color: '#c2a878', roughness: 1 }));
    sand.rotation.x = -Math.PI / 2;
    sand.position.set(sx, 0.06, sz);
    group.add(sand);
    addCollider(sx, sz, 4.2, 4.2);
  }

  // football pitch with goals
  {
    const [fx, fz] = nudgeFree(-28, -28, 11);
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(20, 12), new THREE.MeshStandardMaterial({ color: '#4a5c38', roughness: 1 }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.set(fx, 0.04, fz);
    group.add(pitch);
    const goalM = new THREE.MeshStandardMaterial({ color: '#d8d8d8', roughness: 0.6 });
    for (const gx of [-9, 9]) {
      group.add(box(goalM, 0.12, 2.2, 0.12, fx + gx, 1.1, fz - 1.6));
      group.add(box(goalM, 0.12, 2.2, 0.12, fx + gx, 1.1, fz + 1.6));
      group.add(box(goalM, 0.12, 0.12, 3.3, fx + gx, 2.2, fz));
      addCollider(fx + gx, fz, 0.4, 3.4);
    }
  }

  // trash bins
  {
    const binM = new THREE.MeshStandardMaterial({ color: '#2f4a3a', roughness: 0.9 });
    const binM2 = new THREE.MeshStandardMaterial({ color: '#4a4d52', roughness: 0.9 });
    [[8, 56], [9.3, 56.2], [13.5, 38]].forEach(([ix, iz], i) => {
      const [px, pz] = nudgeFree(ix, iz, 0.9);
      const bin = new THREE.Mesh(geoCyl, i === 2 ? binM2 : binM);
      bin.scale.set(0.7, 1.1, 0.7);
      bin.position.set(px, 0.55, pz);
      bin.castShadow = true;
      group.add(bin);
      addCollider(px, pz, 0.8, 0.8);
    });
  }

  // boiler-house chimney with smoke + red aircraft beacon
  const smokes: THREE.Sprite[] = [];
  let beaconTop: THREE.Sprite;
  {
    const [hx, hz] = nudgeFree(-72, -70, 3.4);
    const chim = new THREE.Mesh(geoCyl, new THREE.MeshStandardMaterial({ map: photoTexture('brick', 3, 4, brickTexture), roughness: 0.95 }));
    chim.scale.set(4, 26, 4);
    chim.position.set(hx, 13, hz);
    chim.castShadow = true;
    group.add(chim);
    group.add(box(new THREE.MeshStandardMaterial({ color: '#8a8f98', roughness: 0.7 }), 5, 2.2, 6, hx + 5, 1.1, hz + 1));
    const smokeMat = new THREE.SpriteMaterial({ map: softDotTexture(), color: '#7a7f88', transparent: true, opacity: 0.3, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(smokeMat.clone());
      s.userData.ph = i / 8;
      s.userData.hx = hx;
      s.userData.hz = hz;
      group.add(s);
      smokes.push(s);
    }
    beaconTop = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ff2a2a', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending }));
    beaconTop.scale.set(2.4, 2.4, 1);
    beaconTop.position.set(hx, 26.6, hz);
    group.add(beaconTop);
    addCollider(hx, hz, 4.4, 4.4);
    addCollider(hx + 5, hz + 1, 5.2, 6.2);
  }

  // wind-blown papers
  const papers: THREE.Mesh[] = [];
  {
    const paperM = new THREE.MeshStandardMaterial({ color: '#c8c4b4', roughness: 1, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.42), paperM);
      p.position.set((rnd() - 0.5) * 160, 0.2 + rnd() * 1.6, (rnd() - 0.5) * 160);
      p.userData = { vx: 1.5 + rnd() * 2, vy: 0.4 + rnd() * 0.8, ph: rnd() * 6.28 };
      group.add(p);
      papers.push(p);
    }
  }

  // ground mist
  const mists: THREE.Sprite[] = [];
  {
    const mistMat = new THREE.SpriteMaterial({ map: softDotTexture(), color: '#aeb8cc', transparent: true, opacity: 0.12, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Sprite(mistMat);
      const sc = 20 + rnd() * 16;
      m.scale.set(sc, sc * 0.36, 1);
      m.position.set((rnd() - 0.5) * 190, 0.7 + rnd() * 1.1, (rnd() - 0.5) * 190);
      m.userData.sp = 0.4 + rnd() * 0.7;
      group.add(m);
      mists.push(m);
    }
  }

  // drizzle streaks
  let drizzleGeo: THREE.BufferGeometry;
  let drizzlePos: Float32Array;
  const DRIZZLE_N = 320;
  {
    drizzlePos = new Float32Array(DRIZZLE_N * 6);
    for (let i = 0; i < DRIZZLE_N; i++) {
      const x = (rnd() - 0.5) * 150;
      const y = rnd() * 32;
      const z = (rnd() - 0.5) * 150;
      drizzlePos.set([x, y, z, x + 0.12, y - 0.8, z], i * 6);
    }
    drizzleGeo = new THREE.BufferGeometry();
    drizzleGeo.setAttribute('position', new THREE.BufferAttribute(drizzlePos, 3));
    const lines = new THREE.LineSegments(drizzleGeo, new THREE.LineBasicMaterial({ color: '#9fb2cc', transparent: true, opacity: 0.26 }));
    lines.frustumCulled = false;
    group.add(lines);
  }

  // puddles on the roads
  {
    const pudM = new THREE.MeshStandardMaterial({ color: '#141a22', roughness: 0.12, metalness: 0.6 });
    const spots: Array<[number, number, number]> = [[2, -30, 2.4], [-2.5, 25, 1.8], [0.5, 70, 3], [-56, -10, 2.2], [30, 2.5, 2.6], [60, -2, 1.7], [-30, -56, 2.1]];
    for (const [px, pz, pr] of spots) {
      const p = new THREE.Mesh(new THREE.CircleGeometry(pr, 18), pudM);
      p.rotation.x = -Math.PI / 2;
      p.position.set(px, 0.035, pz);
      group.add(p);
    }
  }

  // dying lamp near the garages (horror flicker)
  let flickerMat: THREE.MeshStandardMaterial;
  let flickerGlow: THREE.Sprite;
  {
    const [fx, fz] = nudgeFree(-38, -64, 1);
    const poleM = new THREE.MeshStandardMaterial({ color: '#2e3238', roughness: 0.8 });
    group.add(box(poleM, 0.16, 6.4, 0.16, fx, 3.2, fz));
    flickerMat = new THREE.MeshStandardMaterial({ color: '#333333', emissive: '#ffd9a0', emissiveIntensity: 2 });
    group.add(box(flickerMat, 0.6, 0.22, 0.35, fx, 6.4, fz));
    flickerGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd9a0', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    flickerGlow.scale.set(3.4, 3.4, 1);
    flickerGlow.position.set(fx, 6.4, fz);
    group.add(flickerGlow);
    addCollider(fx, fz, 0.5, 0.5);
  }


  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const update = (dt: number, t: number): void => {
    for (const car of traffic) {
      car.s += car.speed * dt;
      routePoint(car.s, tmp);
      routePoint(car.s + 0.004, tmp2);
      car.g.position.copy(tmp);
      car.g.rotation.y = Math.atan2(tmp2.x - tmp.x, tmp2.z - tmp.z);
    }
    for (const p of pickups) {
      if (p.taken) continue;
      p.group.position.y = 0.15 + Math.sin(t * 2 + p.id) * 0.12;
      p.group.rotation.y = t * 0.8 + p.id;
      (p.glow.material as THREE.SpriteMaterial).opacity = 0.4 + Math.sin(t * 3 + p.id * 2) * 0.2;
    }
    for (const b of beacons) {
      if (!b.visible) continue;
      b.mat.opacity = 0.28 + Math.sin(t * 3) * 0.12;
    }
    for (const s of swings) s.rotation.x = Math.sin(t * 1.7 + (s.userData.ph as number)) * 0.55;
    for (const c of cloths) c.rotation.x = Math.sin(t * 2.1 + (c.userData.ph as number)) * 0.22;
    for (const pg of pigeons) {
      const u = pg.userData;
      if (u.fly as boolean) {
        const a = t * 0.5 + (u.ph as number);
        pg.position.set((u.cx as number) + Math.cos(a) * 14, 7 + Math.sin(t * 0.9 + (u.ph as number)) * 1.5, (u.cz as number) + Math.sin(a) * 14);
        pg.rotation.y = -a;
      } else if ((u.peck as number) > 0) {
        u.peck = (u.peck as number) - dt;
        pg.rotation.x = 0.5;
      } else {
        pg.rotation.x = 0;
        u.wt = (u.wt as number) - dt;
        if ((u.wt as number) <= 0) {
          u.wt = 1 + Math.random() * 3;
          u.dir = Math.random() * Math.PI * 2;
          if (Math.random() < 0.45) u.peck = 1.2;
        }
        const dir = u.dir as number;
        pg.position.x += Math.cos(dir) * dt * 0.7;
        pg.position.z += Math.sin(dir) * dt * 0.7;
        pg.position.y = 0.02 + Math.abs(Math.sin(t * 9 + (u.ph as number))) * 0.1;
        pg.rotation.y = -dir + Math.PI / 2;
        const pdx = pg.position.x - (u.cx as number);
        const pdz = pg.position.z - (u.cz as number);
        if (pdx * pdx + pdz * pdz > 110) u.dir = Math.atan2(-pdz, -pdx);
      }
    }
    for (const p of papers) {
      const u = p.userData;
      p.position.x += (u.vx as number) * dt;
      p.position.y += Math.sin(t * 2 + (u.ph as number)) * (u.vy as number) * dt;
      if (p.position.y < 0.05) p.position.y = 0.05;
      if (p.position.y > 3) p.position.y = 3;
      p.rotation.x += dt * 3;
      p.rotation.y += dt * 2.2;
      if (p.position.x > 100) p.position.x = -100;
    }
    for (const m of mists) {
      m.position.x += (m.userData.sp as number) * dt;
      if (m.position.x > 110) m.position.x = -110;
    }
    for (const s of smokes) {
      const k = (t * 0.09 + (s.userData.ph as number)) % 1;
      s.position.set((s.userData.hx as number) + k * 6, 26 + k * 17, (s.userData.hz as number) + k * 2);
      const sc = 3 + k * 8;
      s.scale.set(sc, sc, 1);
      (s.material as THREE.SpriteMaterial).opacity = 0.3 * (1 - k);
    }
    beaconTop.material.opacity = Math.sin(t * 4) > 0.55 ? 1 : 0.06;
    const fl = Math.sin(t * 13.7) + Math.sin(t * 7.3 + 1.7) + Math.sin(t * 31);
    const flOn = fl > 0.9 ? 1 : 0.1;
    flickerMat.emissiveIntensity = 2 * flOn;
    flickerGlow.material.opacity = 0.5 * flOn;
    for (let i = 0; i < DRIZZLE_N; i++) {
      const o = i * 6;
      drizzlePos[o + 1] -= 22 * dt;
      drizzlePos[o + 4] = drizzlePos[o + 1] - 0.8;
      if (drizzlePos[o + 1] < 0) {
        drizzlePos[o + 1] = 32;
        drizzlePos[o + 4] = 31.2;
      }
    }
    drizzleGeo.attributes.position.needsUpdate = true;
  };

  group.userData.blackout = (on: boolean): void => {
    lampGlowMat.opacity = on ? 0 : 0.6;
    lampHeadMat.emissiveIntensity = on ? 0.1 : 2.6;
    for (const pl of lampLights) pl.visible = !on;
    kioskLight.visible = !on;
    kioskWinMat.emissiveIntensity = on ? 0.05 : 1.8;
    kioskGlow.visible = !on;
  };

  const hotspots = [
    new THREE.Vector3(2, 0, -18),
    new THREE.Vector3(2, 0, -30),
    new THREE.Vector3(-58, 0, -50),
    new THREE.Vector3(56, 0, 8),
  ];

  return {
    group,
    colliders,
    pickups,
    beacons,
    route,
    walkLoops,
    spawn: new THREE.Vector3(2, 0, 40),
    spawnYaw: Math.PI,
    bounds: HALF,
    groundY: () => 0,
    coverPoints: [],
    enemySpawns: [],
    hotspots,
    update,
  };
}

// ============================================================ TRAINING
function buildTraining(): ZoneData {
  const group = new THREE.Group();
  const colliders: BoxCollider[] = [];
  const beacons: Beacon[] = [];
  const rnd = mulberry(77);
  const HALF = 120;

  const groundMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + 120, HALF * 2 + 120), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  ground.receiveShadow = true;
  group.add(ground);

  // parade dirt square
  const dirtMat = new THREE.MeshStandardMaterial({ map: photoTexture('dirt', 6, 6, dirtTexture), color: '#b2b6ba', roughness: 1 });
  const square = new THREE.Mesh(new THREE.PlaneGeometry(70, 50), dirtMat);
  square.rotation.x = -Math.PI / 2;
  square.position.set(0, 0, 40);
  square.receiveShadow = true;
  group.add(square);

  const wallMat = new THREE.MeshStandardMaterial({ color: '#8a8578', roughness: 0.95 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 1 });
  const woodMat = new THREE.MeshStandardMaterial({ map: photoTexture('wood', 1, 1, plankTexture), roughness: 1 });
  const metalMat = new THREE.MeshStandardMaterial({ color: '#3a4148', roughness: 0.6, metalness: 0.4 });

  const addCollider = (x: number, z: number, w: number, d: number): void => {
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
  };

  // barracks x2
  for (const bz of [75, 95]) {
    group.add(box(wallMat, 26, 5, 8, -20, 2.5, bz));
    group.add(box(roofMat, 27, 0.6, 9, -20, 5.3, bz));
    addCollider(-20, bz, 26, 8);
  }
  // classroom + storage
  group.add(box(wallMat, 14, 4, 8, 22, 2, 78));
  addCollider(22, 78, 14, 8);
  group.add(box(metalMat, 10, 3.4, 6, 22, 1.7, 92));
  addCollider(22, 92, 10, 6);
  // flag pole with Ukrainian colors
  const pole = box(metalMat, 0.25, 12, 0.25, 0, 6, 30);
  group.add(pole);
  const bannerMat = new THREE.MeshStandardMaterial({ map: uaFlagTexture(), roughness: 0.9, side: THREE.DoubleSide });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2), bannerMat);
  banner.position.set(1.8, 10.6, 30);
  group.add(banner);

  // running track: oval loop of cones
  const trackPts: THREE.Vector3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    trackPts.push(new THREE.Vector3(Math.cos(a) * 55, 0, -30 + Math.sin(a) * 30));
  }
  const coneMat = new THREE.MeshStandardMaterial({ color: '#c9562e', roughness: 0.8 });
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    const cone = new THREE.Mesh(geoCone, coneMat);
    cone.scale.set(0.7, 1, 0.7);
    cone.position.set(Math.cos(a) * 55, 0.5, -30 + Math.sin(a) * 30);
    group.add(cone);
  }

  // obstacle course: 4 gates along x from -30..30 at z=-62
  const obstacles: Array<{ x: number; kind: 'vault' | 'crouch' | 'weave' | 'climb' }> = [
    { x: -24, kind: 'vault' },
    { x: -8, kind: 'crouch' },
    { x: 8, kind: 'weave' },
    { x: 24, kind: 'climb' },
  ];
  for (const o of obstacles) {
    if (o.kind === 'vault' || o.kind === 'climb') {
      const h = o.kind === 'vault' ? 1.2 : 2.2;
      group.add(box(woodMat, 4, h, 0.4, o.x, h / 2, -62));
      addCollider(o.x, -62, 4, 0.6);
    } else if (o.kind === 'crouch') {
      group.add(box(woodMat, 4, 0.25, 3, o.x, 1.05, -62));
      group.add(box(woodMat, 0.3, 1.1, 0.3, o.x - 1.8, 0.55, -63));
      group.add(box(woodMat, 0.3, 1.1, 0.3, o.x + 1.8, 0.55, -63));
      group.add(box(woodMat, 0.3, 1.1, 0.3, o.x - 1.8, 0.55, -61));
      group.add(box(woodMat, 0.3, 1.1, 0.3, o.x + 1.8, 0.55, -61));
      // low bar: must crouch (game checks), no hard collider
    } else {
      for (let k = -1; k <= 1; k++) {
        group.add(box(metalMat, 0.3, 1.8, 0.3, o.x + k * 1.6, 0.9, -62 + (k % 2) * 1.2));
      }
    }
  }

  // shooting range: firing line z=-78, targets at z=-95..-110
  const rangeDirt = new THREE.Mesh(new THREE.PlaneGeometry(50, 40), dirtMat);
  rangeDirt.rotation.x = -Math.PI / 2;
  rangeDirt.position.set(0, 0.01, -95);
  group.add(rangeDirt);
  const berm = box(dirtMat, 52, 4, 4, 0, 2, -116);
  group.add(berm);
  addCollider(0, -116, 52, 4);

  // equipment table with rifles near range
  group.add(box(woodMat, 3, 0.15, 1, -14, 0.95, -78));
  group.add(box(woodMat, 0.15, 1, 0.15, -15.3, 0.5, -78));
  group.add(box(woodMat, 0.15, 1, 0.15, -12.7, 0.5, -78));
  const rifleMat = new THREE.MeshStandardMaterial({ color: '#2c2c28', roughness: 0.6, metalness: 0.4 });
  for (let i = 0; i < 3; i++) {
    group.add(box(rifleMat, 0.12, 0.12, 1.1, -14.8 + i * 0.8, 1.1, -78, 0.2));
  }

  // perimeter fence
  const fenceMat = new THREE.MeshStandardMaterial({ color: '#5c5a52', roughness: 0.9 });
  for (let x = -HALF; x <= HALF; x += 8) {
    group.add(box(fenceMat, 0.2, 2.4, 0.2, x, 1.2, -HALF));
    group.add(box(fenceMat, 0.2, 2.4, 0.2, x, 1.2, HALF));
  }
  for (let z = -HALF; z <= HALF; z += 8) {
    group.add(box(fenceMat, 0.2, 2.4, 0.2, -HALF, 1.2, z));
    group.add(box(fenceMat, 0.2, 2.4, 0.2, HALF, 1.2, z));
  }
  // watch tower
  group.add(box(woodMat, 3, 7, 3, 60, 3.5, 60));
  group.add(box(woodMat, 4, 2.4, 4, 60, 8.2, 60));
  group.add(box(roofMat, 4.6, 0.4, 4.6, 60, 9.6, 60));
  addCollider(60, 60, 3.4, 3.4);

  // scattered trees outside fence
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3e2d', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3d5230', roughness: 1 });
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2;
    const r = HALF + 10 + rnd() * 60;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const s = 0.9 + rnd() * 1.1;
    const trunk = new THREE.Mesh(geoCyl, trunkMat);
    trunk.scale.set(0.35 * s, 2.4 * s, 0.35 * s);
    trunk.position.set(x, 1.2 * s, z);
    const crown = new THREE.Mesh(geoCone, leafMat);
    crown.scale.set(2.6 * s, 3.8 * s, 2.6 * s);
    crown.position.set(x, 3.8 * s, z);
    group.add(trunk, crown);
  }

  for (let i = 0; i < 6; i++) {
    const b = makeBeacon(i === 0 ? 0x9fe07a : 0x7ad2ff);
    group.add(b.group);
    beacons.push(b);
  }

  const bannerMesh = banner;
  const update = (_dt: number, t: number): void => {
    bannerMesh.rotation.y = Math.sin(t * 1.4) * 0.25;
    for (const b of beacons) {
      if (!b.visible) continue;
      b.mat.opacity = 0.28 + Math.sin(t * 3) * 0.12;
    }
  };

  // expose track + obstacle + range points via beacons set by Game; store in route/walkLoops slots
  return {
    group,
    colliders,
    pickups: [],
    beacons,
    route: trackPts,
    walkLoops: [trackPts],
    spawn: new THREE.Vector3(0, 0, 50),
    spawnYaw: Math.PI,
    bounds: HALF - 4,
    groundY: () => 0,
    coverPoints: [],
    enemySpawns: [],
    hotspots: [],
    update,
  };
}

// ============================================================ FRONTLINE
function terrainH(x: number, z: number): number {
  return Math.sin(x * 0.03) * 2.2 + Math.cos(z * 0.025) * 2.6 + Math.sin((x + z) * 0.012) * 2.0 - 2.0;
}

function buildFrontline(): ZoneData {
  const group = new THREE.Group();
  const colliders: BoxCollider[] = [];
  const beacons: Beacon[] = [];
  const coverPoints: THREE.Vector3[] = [];
  const enemySpawns: THREE.Vector3[] = [];
  const rnd = mulberry(9001);
  const HALF = 200;

  // terrain
  const seg = 90;
  const tg = new THREE.PlaneGeometry(HALF * 2, HALF * 2, seg, seg);
  tg.rotateX(-Math.PI / 2);
  const pos = tg.attributes.position;
  const colors: number[] = [];
  const cLow = new THREE.Color('#4a4433');
  const cHigh = new THREE.Color('#5c663c');
  const cc = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainH(x, z);
    pos.setY(i, y);
    cc.copy(cLow).lerp(cHigh, THREE.MathUtils.clamp((y + 4) / 10, 0, 1));
    const n = rnd() * 0.07 - 0.035;
    colors.push(cc.r + n, cc.g + n, cc.b + n);
  }
  tg.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  tg.computeVertexNormals();
  const terrain = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrain.receiveShadow = true;
  group.add(terrain);

  const addCollider = (x: number, z: number, w: number, d: number): void => {
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
  };

  // road along z
  const roadMat = new THREE.MeshStandardMaterial({ map: photoTexture('dirt', 2, 40, dirtTexture), color: '#a9a49a', roughness: 1 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(9, HALF * 2), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(10, 0.15, 0);
  // conform roughly: sample terrain heights
  const rp = road.geometry.attributes.position;
  for (let i = 0; i < rp.count; i++) {
    const lx = rp.getX(i) + 10;
    const lz = rp.getZ(i);
    rp.setY(i, terrainH(lx, lz) + 0.18);
  }
  road.geometry.computeVertexNormals();
  group.add(road);

  // ruined village: broken houses
  for (let i = 0; i < 8; i++) {
    const x = -80 + (i % 4) * 42 + (rnd() - 0.5) * 10;
    const z = -70 + Math.floor(i / 4) * 60 + (rnd() - 0.5) * 10;
    const y = terrainH(x, z);
    const w = 8 + rnd() * 6;
    const d = 7 + rnd() * 5;
    const h = 2 + rnd() * 4.5;
    const tex = ruinTexture(100 + i * 13);
    tex.repeat.set(2, 1);
    const m = new THREE.Mesh(geoBox, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    m.scale.set(w, h, d);
    m.position.set(x, y + h / 2 - 0.3, z);
    m.rotation.y = (rnd() - 0.5) * 0.4;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    addCollider(x, z, w, d);
    // rubble
    for (let k = 0; k < 4; k++) {
      const rb = new THREE.Mesh(geoCone, new THREE.MeshStandardMaterial({ color: '#5a564c', roughness: 1 }));
      rb.scale.set(1.5 + rnd() * 2, 1 + rnd(), 1.5 + rnd() * 2);
      rb.position.set(x + (rnd() - 0.5) * (w + 6), terrainH(x, z) + 0.3, z + (rnd() - 0.5) * (d + 6));
      group.add(rb);
    }
  }
  // ruined industrial hall
  const hallX = 70;
  const hallZ = -40;
  const hallY = terrainH(hallX, hallZ);
  const hallTex = ruinTexture(555);
  const hall = new THREE.Mesh(geoBox, new THREE.MeshStandardMaterial({ map: hallTex, roughness: 1 }));
  hall.scale.set(30, 8, 16);
  hall.position.set(hallX, hallY + 3.4, hallZ);
  hall.castShadow = true;
  group.add(hall);
  addCollider(hallX, hallZ, 30, 16);

  // sandbag lines + trenches near forward post
  const bagMat = new THREE.MeshStandardMaterial({ color: '#8a7a5c', roughness: 1 });
  const bagGeo = new THREE.CapsuleGeometry(0.35, 0.7, 3, 6);
  const sandbagLine = (x: number, z: number, len: number, ry: number): void => {
    const n = Math.floor(len / 1.1);
    for (let i = 0; i < n; i++) {
      for (let row = 0; row < 2; row++) {
        const bag = new THREE.Mesh(bagGeo, bagMat);
        const off = (i - n / 2) * 1.1;
        const bx = x + Math.cos(ry) * off;
        const bz = z + Math.sin(ry) * off;
        bag.position.set(bx, terrainH(bx, bz) + 0.4 + row * 0.55, bz);
        bag.rotation.z = Math.PI / 2;
        bag.rotation.y = -ry;
        bag.castShadow = true;
        group.add(bag);
      }
    }
    coverPoints.push(new THREE.Vector3(x, 0, z));
  };

  const postX = 0;
  const postZ = 120;
  sandbagLine(postX - 8, postZ - 6, 10, 0);
  sandbagLine(postX + 8, postZ - 6, 10, 0);
  sandbagLine(postX, postZ + 8, 16, Math.PI / 2);
  addCollider(postX - 8, postZ - 6, 10, 1.2);
  addCollider(postX + 8, postZ - 6, 10, 1.2);

  // trenches (dark sunken boxes)
  const trenchMat = new THREE.MeshStandardMaterial({ color: '#241f16', roughness: 1 });
  for (const [tx, tz, len] of [[-30, 60, 24], [35, 40, 30], [-10, -20, 20]] as Array<[number, number, number]>) {
    const ty = terrainH(tx, tz);
    const tr = box(trenchMat, len, 0.6, 2.4, tx, ty - 0.1, tz, 0.2);
    tr.castShadow = false;
    tr.receiveShadow = true;
    group.add(tr);
    sandbagLine(tx, tz - 1.8, len, 0);
  }

  // scorch marks near trenches
  const scorchMatF = new THREE.MeshStandardMaterial({ map: photoTexture('scorch', 1, 1, scorchDecalTexture), roughness: 1, transparent: true, opacity: 0.9, depthWrite: false });
  for (const [sx, sz] of [[-30, 60], [35, 40], [-10, -20]] as Array<[number, number]>) {
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), scorchMatF);
    sm.rotation.x = -Math.PI / 2;
    sm.rotation.z = rnd() * 3;
    sm.position.set(sx + 3, terrainH(sx + 3, sz + 2) + 0.22, sz + 2);
    sm.receiveShadow = true;
    group.add(sm);
  }

  // checkpoints with barrier + mast
  const mastMat = new THREE.MeshStandardMaterial({ color: '#6e2f28', roughness: 0.8 });
  for (const [cx, cz] of [[10, 60], [10, -60]] as Array<[number, number]>) {
    const cy = terrainH(cx, cz);
    sandbagLine(cx - 6, cz, 6, Math.PI / 2);
    sandbagLine(cx + 6, cz, 6, Math.PI / 2);
    const bar = box(new THREE.MeshStandardMaterial({ color: '#c9562e', roughness: 0.8 }), 5, 0.25, 0.25, cx, cy + 1.1, cz, 0.12);
    group.add(bar);
    group.add(box(mastMat, 0.2, 1.3, 0.2, cx - 2.5, cy + 0.65, cz));
    const mast = box(mastMat, 0.18, 7, 0.18, cx + 5, cy + 3.5, cz + 3);
    group.add(mast);
    const flagm = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.4), new THREE.MeshStandardMaterial({ map: uaFlagTexture(), side: THREE.DoubleSide, roughness: 0.9 }));
    flagm.position.set(cx + 6.2, cy + 5.8, cz + 3);
    group.add(flagm);
  }

  // wrecks
  const wreckMat = new THREE.MeshStandardMaterial({ color: '#1c1a16', roughness: 1 });
  for (const [wx, wz, ry] of [[-25, -40, 0.5], [30, 90, 2.2], [14, -110, 0.1]] as Array<[number, number, number]>) {
    const wy = terrainH(wx, wz);
    group.add(box(wreckMat, 2, 1.2, 4.4, wx, wy + 0.7, wz, ry));
    addCollider(wx, wz, 3.4, 3.4);
    coverPoints.push(new THREE.Vector3(wx, 0, wz));
  }

  // supply crates at post
  const crateMat = new THREE.MeshStandardMaterial({ color: '#4a5c3a', roughness: 0.9 });
  for (let i = 0; i < 5; i++) {
    const cx = postX - 4 + (i % 3) * 1.6;
    const cz = postZ + 3 + Math.floor(i / 3) * 1.6;
    group.add(box(crateMat, 1.4, 1.1, 1.4, cx, terrainH(cx, cz) + 0.55, cz, rnd()));
  }

  // radio mast at post
  const radioMat = new THREE.MeshStandardMaterial({ color: '#333638', roughness: 0.7, metalness: 0.4 });
  const rmy = terrainH(postX + 6, postZ + 4);
  group.add(box(radioMat, 0.3, 14, 0.3, postX + 6, rmy + 7, postZ + 4));
  const dishMat = new THREE.MeshStandardMaterial({ color: '#8c2f26', emissive: '#ff2a1a', emissiveIntensity: 2 });
  group.add(box(dishMat, 0.4, 0.4, 0.4, postX + 6, rmy + 14.2, postZ + 4));

  // forest patches
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#3e3423', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#33452a', roughness: 1 });
  const treeTrunks = new THREE.InstancedMesh(geoCyl, trunkMat, 110);
  const treeCrowns = new THREE.InstancedMesh(geoCone, leafMat, 110);
  const dummy = new THREE.Object3D();
  let ti = 0;
  const patches: Array<[number, number, number]> = [[-120, -60, 45], [120, 60, 50], [-100, 120, 40], [90, -120, 55], [-40, -140, 35]];
  for (const [px, pz, pr] of patches) {
    const n = 22;
    for (let i = 0; i < n && ti < 110; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * pr;
      const x = Math.max(-HALF + 8, Math.min(HALF - 8, px + Math.cos(a) * r));
      const z = Math.max(-HALF + 8, Math.min(HALF - 8, pz + Math.sin(a) * r));
      if (Math.abs(x - 10) < 8) continue;
      const y = terrainH(x, z);
      const s = 0.9 + rnd() * 1.3;
      dummy.position.set(x, y + 1.2 * s, z);
      dummy.scale.set(0.4 * s, 2.4 * s, 0.4 * s);
      dummy.rotation.y = rnd() * Math.PI;
      dummy.updateMatrix();
      treeTrunks.setMatrixAt(ti, dummy.matrix);
      dummy.position.y = y + 3.9 * s;
      dummy.scale.set(2.6 * s, 3.8 * s, 2.6 * s);
      dummy.updateMatrix();
      treeCrowns.setMatrixAt(ti, dummy.matrix);
      ti++;
    }
  }
  treeTrunks.count = ti;
  treeCrowns.count = ti;
  treeTrunks.castShadow = true;
  treeCrowns.castShadow = true;
  group.add(treeTrunks, treeCrowns);

  // enemy spawn areas (north + village + hall)
  enemySpawns.push(
    new THREE.Vector3(-60, 0, -80),
    new THREE.Vector3(0, 0, -60),
    new THREE.Vector3(60, 0, -50),
    new THREE.Vector3(70, 0, -20),
    new THREE.Vector3(-30, 0, -120),
    new THREE.Vector3(40, 0, -130),
  );

  for (let i = 0; i < 6; i++) {
    const b = makeBeacon(i === 0 ? 0xff6a4a : 0x7ad2ff);
    group.add(b.group);
    beacons.push(b);
  }

  const update = (_dt: number, t: number): void => {
    for (const b of beacons) {
      if (!b.visible) continue;
      b.mat.opacity = 0.28 + Math.sin(t * 3) * 0.12;
    }
  };

  return {
    group,
    colliders,
    pickups: [],
    beacons,
    route: [],
    walkLoops: [],
    spawn: new THREE.Vector3(10, 0, 150),
    spawnYaw: Math.PI,
    bounds: HALF - 6,
    groundY: terrainH,
    coverPoints,
    enemySpawns,
    hotspots: [],
    update,
  };
}

// ============================================================ TRANSPORT (road ride)
function buildTransport(): ZoneData {
  const group = new THREE.Group();
  const rnd = mulberry(5150);
  const LEN = 600;

  const groundMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, LEN + 200), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.05, -LEN / 2);
  group.add(ground);

  const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: 1 });
  const road = new THREE.Mesh(new THREE.PlaneGeometry(8, LEN), roadMat);
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.02, -LEN / 2);
  group.add(road);

  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3e2d', roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#3d5230', roughness: 1 });
  for (let i = 0; i < 90; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const x = side * (9 + rnd() * 60);
    const z = 20 - rnd() * LEN;
    const s = 0.9 + rnd() * 1.2;
    const trunk = new THREE.Mesh(geoCyl, trunkMat);
    trunk.scale.set(0.35 * s, 2.4 * s, 0.35 * s);
    trunk.position.set(x, 1.2 * s, z);
    const crown = new THREE.Mesh(geoCone, leafMat);
    crown.scale.set(2.6 * s, 3.8 * s, 2.6 * s);
    crown.position.set(x, 3.8 * s, z);
    group.add(trunk, crown);
  }
  // checkpoint arches along the way
  const archMat = new THREE.MeshStandardMaterial({ color: '#5c5a52', roughness: 0.9 });
  for (const z of [-120, -320, -480]) {
    group.add(box(archMat, 0.6, 6, 0.6, -5, 3, z));
    group.add(box(archMat, 0.6, 6, 0.6, 5, 3, z));
    group.add(box(archMat, 11, 0.8, 0.8, 0, 6.2, z));
  }

  return {
    group,
    colliders: [],
    pickups: [],
    beacons: [],
    route: [],
    walkLoops: [],
    spawn: new THREE.Vector3(0, 0, 10),
    spawnYaw: Math.PI,
    bounds: 40,
    groundY: () => 0,
    coverPoints: [],
    enemySpawns: [],
    hotspots: [],
    update: () => undefined,
  };
}

// ============================================================ WORLD
export type ZoneId = 'city' | 'training' | 'transport' | 'frontline';

export class World {
  zone: ZoneData | null = null;
  zoneId: ZoneId = 'city';

  load(scene: THREE.Scene, id: ZoneId): ZoneData {
    if (this.zone) {
      scene.remove(this.zone.group);
      this.zone.group.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            const mm = m as THREE.MeshStandardMaterial;
            if (mm.map && !this.sharedTexture(mm.map)) mm.map.dispose();
            if (!this.sharedMaterial(m)) m.dispose();
          }
        }
      });
    }
    this.zoneId = id;
    this.zone = id === 'city' ? buildCity() : id === 'training' ? buildTraining() : id === 'transport' ? buildTransport() : buildFrontline();
    scene.add(this.zone.group);
    return this.zone;
  }

  private sharedTexture(_t: THREE.Texture): boolean {
    return false;
  }
  private sharedMaterial(m: THREE.Material): boolean {
    void m;
    return false;
  }

  setBeaconVisible(index: number, id: string, x: number, y: number, z: number, visible: boolean): void {
    const b = this.zone?.beacons[index];
    if (b) setBeacon(b, id, x, y, z, visible);
  }

  hideBeacons(): void {
    if (!this.zone) return;
    for (const b of this.zone.beacons) {
      b.group.visible = false;
      b.visible = false;
    }
  }
}
