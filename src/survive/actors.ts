// ============================================================
// GREY CORRIDOR — procedural humanoids + NPC AI state machines
// ============================================================
import * as THREE from 'three';
import { camoTexture, faceTexture, flannelTexture, jacketTexture, vestTexture } from './textures';
import { resolveCollision, losBlocked, type BoxCollider } from './world';
import type { AnimState, ModelKind } from './types';

export type PoseState = AnimState | 'guard';

export interface Humanoid {
  group: THREE.Group;
  head: THREE.Object3D;
  torso: THREE.Mesh;
  armL: THREE.Object3D;
  armR: THREE.Object3D;
  legL: THREE.Object3D;
  legR: THREE.Object3D;
  rifle: THREE.Object3D | null;
  setPose: (pose: PoseState, t: number, moving: number) => void;
}

const SKIN = ['#c9a184', '#b08a68', '#d8b494', '#9c7a5c'];
const CIVIL_TOP = ['#4a5a6e', '#5c4a3d', '#3d5c46', '#555560', '#6e3a3a', '#445066'];
const CIVIL_BOT = ['#2e3138', '#3d3a34', '#2c3a4a', '#4a4a4a'];

function limb(mat: THREE.Material, w: number, len: number): THREE.Group {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
  m.position.y = -len / 2;
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

let camoShared: THREE.Texture | null = null;
function getCamo(): THREE.Texture {
  camoShared ??= camoTexture();
  return camoShared;
}
const faceCache = new Map<string, THREE.Texture>();
function getFace(seed: number, skinHex: string): THREE.Texture {
  const key = `${seed % 8}:${skinHex}`;
  let t = faceCache.get(key);
  if (!t) {
    t = faceTexture(seed % 8, skinHex);
    faceCache.set(key, t);
  }
  return t;
}
const clothCache = new Map<string, THREE.Texture>();
function getJacket(color: string, seed: number): THREE.Texture {
  const key = `j:${color}:${seed % 4}`;
  let t = clothCache.get(key);
  if (!t) {
    t = jacketTexture(color, seed % 4);
    clothCache.set(key, t);
  }
  return t;
}
function getFlannel(c1: string, c2: string): THREE.Texture {
  const key = `f:${c1}:${c2}`;
  let t = clothCache.get(key);
  if (!t) {
    t = flannelTexture(c1, c2);
    clothCache.set(key, t);
  }
  return t;
}
let vestShared: THREE.Texture | null = null;
function getVest(): THREE.Texture {
  vestShared ??= vestTexture();
  return vestShared;
}

export function makeHumanoid(kind: ModelKind, seed = 1, armed = false): Humanoid {
  const g = new THREE.Group();
  const r = (n: number): number => {
    const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const skinHex = SKIN[Math.floor(r(1) * SKIN.length)];
  const skin = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.8 });
  let top: THREE.Material;
  let bot: THREE.Material;
  let hat: THREE.Object3D | null = null;
  if (kind === 'officer') {
    top = new THREE.MeshStandardMaterial({ color: '#ffffff', map: getCamo(), roughness: 0.95 });
    bot = new THREE.MeshStandardMaterial({ color: '#e8e8e0', map: getCamo(), roughness: 0.95 });
  } else if (kind === 'soldier') {
    top = new THREE.MeshStandardMaterial({ color: '#ffffff', map: getCamo(), roughness: 0.95 });
    bot = new THREE.MeshStandardMaterial({ color: '#e2e2d8', map: getCamo(), roughness: 0.95 });
  } else if (kind === 'instructor') {
    top = new THREE.MeshStandardMaterial({ color: '#3a5c46', roughness: 0.9 });
    bot = new THREE.MeshStandardMaterial({ color: '#2c2c30', roughness: 0.9 });
  } else {
    const cTop = CIVIL_TOP[Math.floor(r(2) * CIVIL_TOP.length)];
    const cTop2 = CIVIL_TOP[Math.floor(r(7) * CIVIL_TOP.length)];
    const roll = r(8);
    top =
      roll < 0.42
        ? new THREE.MeshStandardMaterial({ map: getJacket(cTop, seed), roughness: 0.95 })
        : roll < 0.72
          ? new THREE.MeshStandardMaterial({ map: getFlannel(cTop, cTop2), roughness: 0.95 })
          : new THREE.MeshStandardMaterial({ color: cTop, roughness: 0.95 });
    bot = new THREE.MeshStandardMaterial({ color: CIVIL_BOT[Math.floor(r(3) * CIVIL_BOT.length)], roughness: 0.95 });
  }

  // legs
  const legL = limb(bot, 0.17, 0.85);
  legL.position.set(-0.12, 0.85, 0);
  const legR = limb(bot, 0.17, 0.85);
  legR.position.set(0.12, 0.85, 0);
  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.3), top);
  torso.position.y = 1.2;
  torso.castShadow = true;
  g.add(torso);
  // vest + gear for officer/soldier (parented to torso: follows every pose)
  const gearMat = new THREE.MeshStandardMaterial({ color: '#3a3d2c', roughness: 1 });
  if (kind === 'officer' || kind === 'soldier') {
    const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.42, 0.34), new THREE.MeshStandardMaterial({ map: getVest(), roughness: 1 }));
    vest.position.y = 0.02;
    vest.castShadow = true;
    torso.add(vest);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.06), gearMat);
    plate.position.set(0, 0.03, 0.18);
    torso.add(plate);
    for (const s of [-1, 1]) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.36), gearMat);
      strap.position.set(s * 0.17, 0.33, 0);
      torso.add(strap);
      const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.08), gearMat);
      pouch.position.set(s * 0.15, -0.12, 0.19);
      torso.add(pouch);
    }
    const radioMat = new THREE.MeshStandardMaterial({ color: '#1e2124', roughness: 0.7 });
    const radio = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.05), radioMat);
    radio.position.set(-0.2, 0.12, 0.19);
    torso.add(radio);
    const ant = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.3, 0.015), radioMat);
    ant.position.set(-0.2, 0.32, 0.19);
    torso.add(ant);
    if (kind === 'soldier') {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.44, 0.2), gearMat);
      pack.position.set(0, 0.05, -0.24);
      pack.castShadow = true;
      torso.add(pack);
      const bedroll = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), new THREE.MeshStandardMaterial({ color: '#5c5c42', roughness: 1 }));
      bedroll.rotation.z = Math.PI / 2;
      bedroll.position.set(0, 0.3, -0.24);
      torso.add(bedroll);
    }
    if (kind === 'officer') {
      // TCC insignia band (yellow stripe)
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.07, 0.35),
        new THREE.MeshStandardMaterial({ color: '#c9a83a', roughness: 0.8 }),
      );
      band.position.y = 0.18;
      torso.add(band);
    }
  }
  // arms
  const armL = limb(top, 0.14, 0.72);
  armL.position.set(-0.33, 1.5, 0);
  const armR = limb(top, 0.14, 0.72);
  armR.position.set(0.33, 1.5, 0);
  // boots + gloves + belt
  const bootMat = new THREE.MeshStandardMaterial({ color: kind === 'civilian' ? '#2e2a26' : '#22211c', roughness: 0.9 });
  for (const leg of [legL, legR]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.16, 0.3), bootMat);
    boot.position.set(0, -0.78, 0.05);
    boot.castShadow = true;
    leg.add(boot);
  }
  const gloveMat = new THREE.MeshStandardMaterial({ color: kind === 'civilian' ? skinHex : '#2c2c26', roughness: 0.9 });
  for (const arm of [armL, armR]) {
    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.15), gloveMat);
    glove.position.y = -0.68;
    arm.add(glove);
  }
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.28), new THREE.MeshStandardMaterial({ color: '#1f1e1a', roughness: 0.9 }));
  belt.position.y = 0.88;
  g.add(belt);
  // head
  const headG = new THREE.Group();
  headG.position.y = 1.72;
  const faceMat = new THREE.MeshStandardMaterial({ map: getFace(seed, skinHex), roughness: 0.8 });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), [skin, skin, skin, skin, faceMat, skin]);
  head.position.y = 0.12;
  head.castShadow = true;
  headG.add(head);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.09, 0.07), skin);
    ear.position.set(s * 0.15, 0.12, 0);
    headG.add(ear);
  }
  // hair / cap / helmet
  const hairMat = new THREE.MeshStandardMaterial({ color: ['#2b2118', '#4a3a26', '#6e5a3a', '#151515'][Math.floor(r(4) * 4)], roughness: 1 });
  if (kind === 'civilian') {
    if (r(5) < 0.6) {
      const hair = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.1, 0.27), hairMat);
      hair.position.y = 0.28;
      headG.add(hair);
    } else {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.09, 0.3), new THREE.MeshStandardMaterial({ color: CIVIL_TOP[Math.floor(r(6) * CIVIL_TOP.length)], roughness: 1 }));
      cap.position.y = 0.29;
      headG.add(cap);
    }
  } else if (kind === 'officer' || kind === 'instructor') {
    const capMat = new THREE.MeshStandardMaterial({ color: kind === 'officer' ? '#3f4433' : '#2c4434', roughness: 0.9 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.1, 10), capMat);
    cap.position.y = 0.3;
    headG.add(cap);
    if (kind === 'officer') {
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.14), capMat);
      brim.position.set(0, 0.27, 0.2);
      headG.add(brim);
    }
    hat = cap;
  } else {
    const helm = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#3d4430', roughness: 1 }),
    );
    helm.position.y = 0.26;
    headG.add(helm);
    const strapH = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: '#22221e', roughness: 1 }));
    strapH.position.y = 0.3;
    headG.add(strapH);
    hat = helm;
  }
  void hat;
  g.add(legL, legR, armL, armR, headG);

  // rifle
  let rifle: THREE.Object3D | null = null;
  if (armed) {
    rifle = new THREE.Group();
    const rm = new THREE.MeshStandardMaterial({ color: '#24241f', roughness: 0.55, metalness: 0.45 });
    const wm = new THREE.MeshStandardMaterial({ color: '#5c4a30', roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.85), rm);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.25), wm);
    stock.position.set(0, -0.02, 0.42);
    rifle.add(body, stock);
    rifle.position.set(0.2, 1.25, 0.35);
    g.add(rifle);
  }

  const setPose = (pose: PoseState, t: number, moving: number): void => {
    const swing = Math.sin(t * 9) * 0.6 * moving;
    const swing2 = Math.sin(t * 9 + Math.PI) * 0.6 * moving;
    // defaults
    g.rotation.x = 0;
    const baseY = 0;
    if (pose === 'down') {
      g.rotation.x = -Math.PI / 2;
      g.position.y = baseY + 0.3;
      return;
    }
    if (pose === 'sit') {
      legL.rotation.x = -1.5;
      legR.rotation.x = -1.5;
      armL.rotation.x = -0.4;
      armR.rotation.x = -0.4;
      torso.position.y = 0.95;
      headG.position.y = 1.47;
      g.position.y = baseY;
      return;
    }
    torso.position.y = 1.2;
    headG.position.y = 1.72;
    if (pose === 'crouch') {
      const s = 0.72;
      g.scale.set(1, s, 1);
      legL.rotation.x = -0.9;
      legR.rotation.x = -0.9;
      armL.rotation.x = swing * 0.5;
      armR.rotation.x = swing2 * 0.5;
      g.position.y = baseY;
      return;
    }
    g.scale.set(1, 1, 1);
    if (pose === 'aim') {
      legL.rotation.x = swing * 0.3;
      legR.rotation.x = swing2 * 0.3;
      armL.rotation.x = -1.35;
      armR.rotation.x = -1.35;
      if (rifle) {
        rifle.position.set(0.12, 1.5, 0.42);
        rifle.rotation.x = 0;
      }
      g.position.y = baseY;
      return;
    }
    if (rifle) {
      rifle.position.set(0.2, 1.25, 0.35);
      rifle.rotation.x = pose === 'guard' ? -0.5 : 0.25;
    }
    if (pose === 'struggle') {
      const j = Math.sin(t * 30) * 0.25;
      g.rotation.z = j;
      armL.rotation.x = -2 + j * 2;
      armR.rotation.x = -2 - j * 2;
      legL.rotation.x = 0.5 + j;
      legR.rotation.x = -0.5 + j;
      g.position.y = baseY;
      return;
    }
    g.rotation.z = 0;
    legL.rotation.x = swing;
    legR.rotation.x = swing2;
    armL.rotation.x = swing2 * 0.8;
    armR.rotation.x = swing * 0.8;
    if (pose === 'guard') {
      armL.rotation.x = -0.5;
      armR.rotation.x = -0.5;
    }
    // idle breathing
    if (moving < 0.05) {
      torso.position.y = 1.2 + Math.sin(t * 2) * 0.012;
      armL.rotation.x = Math.sin(t * 2) * 0.03;
      armR.rotation.x = -Math.sin(t * 2) * 0.03;
    }
    g.position.y = baseY + Math.abs(Math.sin(t * 9)) * 0.05 * moving;
  };

  return { group: g, head: headG, torso, armL, armR, legL, legR, rifle, setPose };
}

const _steerTmp = new THREE.Vector3();

export function steerToward(
  pos: THREE.Vector3,
  target: THREE.Vector3,
  speed: number,
  dt: number,
  colliders: BoxCollider[],
  radius = 0.45,
): number {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.05) return 0;
  const step = Math.min(d, speed * dt);
  const nx = dx / d;
  const nz = dz / d;
  // try full / x-only / z-only steps, keep the one that gets closest:
  // cheap wall sliding so NPCs go around corners instead of pushing into them
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < 3; i++) {
    const cx = i === 2 ? pos.x : pos.x + nx * step;
    const cz = i === 1 ? pos.z : pos.z + nz * step;
    _steerTmp.set(cx, pos.y, cz);
    resolveCollision(_steerTmp, radius, colliders);
    const score = Math.hypot(_steerTmp.x - target.x, _steerTmp.z - target.z) + i * 0.15;
    if (score < bd) {
      bd = score;
      bi = i;
    }
  }
  pos.x = bi === 2 ? pos.x : pos.x + nx * step;
  pos.z = bi === 1 ? pos.z : pos.z + nz * step;
  resolveCollision(pos, radius, colliders);
  return Math.hypot(pos.x - target.x, pos.z - target.z);
}

// ============================================================ civilians
export type CivilState = 'idle' | 'walk' | 'react' | 'flee' | 'hide' | 'resume';

export class Civilian {
  humanoid: Humanoid;
  pos: THREE.Vector3;
  state: CivilState = 'walk';
  loop: THREE.Vector3[];
  post: THREE.Vector3 | null = null;
  loopIdx = 0;
  dir = 1;
  speed = 1.4;
  stateT = 0;
  stallT = 0;
  yaw = 0;
  private seed: number;

  constructor(loop: THREE.Vector3[], seed: number, scene: THREE.Object3D, post: THREE.Vector3 | null = null) {
    this.seed = seed;
    this.loop = loop;
    this.post = post;
    this.loopIdx = Math.floor(Math.abs(Math.sin(seed * 3.7)) * loop.length);
    this.dir = seed % 2 === 0 ? 1 : -1;
    this.pos = loop[this.loopIdx].clone();
    if (post) this.pos.copy(post);
    this.humanoid = makeHumanoid('civilian', seed, false);
    if (seed % 3 === 0) {
      const bag = new THREE.Mesh(
        new THREE.BoxGeometry(0.34, 0.42, 0.2),
        new THREE.MeshStandardMaterial({ color: '#6e5a3a', roughness: 1 }),
      );
      bag.position.set(-0.45, 0.75, 0.1);
      this.humanoid.group.add(bag);
    }
    this.humanoid.group.position.copy(this.pos);
    scene.add(this.humanoid.group);
  }

  update(dt: number, t: number, danger: THREE.Vector3 | null, gunshot: boolean, colliders: BoxCollider[]): void {
    this.stateT += dt;
    const hd = this.humanoid;
    let moving = 0;
    const dangerDist = danger ? this.pos.distanceTo(danger) : 999;

    switch (this.state) {
      case 'idle':
        hd.setPose('idle', t + this.seed, 0);
        if (this.stateT > 2 + (this.seed % 4)) {
          this.state = 'walk';
          this.stateT = 0;
        }
        break;
      case 'walk': {
        const target = this.post ?? this.loop[this.loopIdx];
        const before = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
        const remain = steerToward(this.pos, target, this.speed, dt, colliders);
        if (before - remain < this.speed * dt * 0.25) this.stallT += dt;
        else this.stallT = 0;
        moving = 0.6;
        this.yaw = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
        hd.setPose('walk', t + this.seed, moving);
        if (this.post) {
          if (remain < 0.4) {
            this.state = 'idle';
            this.stateT = -4 - (this.seed % 5);
          }
        } else if (remain < 0.6 || this.stallT > 2.5) {
          this.stallT = 0;
          this.loopIdx = (this.loopIdx + this.dir + this.loop.length) % this.loop.length;
          if (this.seed % 5 === 0 && Math.random() < 0.2) {
            this.state = 'idle';
            this.stateT = 0;
          }
        }
        break;
      }
      case 'react':
        hd.setPose('idle', t + this.seed, 0);
        // stare at danger
        if (danger) this.yaw = Math.atan2(danger.x - this.pos.x, danger.z - this.pos.z);
        if (this.stateT > 0.9) {
          this.state = dangerDist < 14 ? 'flee' : 'resume';
          this.stateT = 0;
        }
        break;
      case 'flee': {
        if (danger) {
          const away = new THREE.Vector3(this.pos.x - danger.x, 0, this.pos.z - danger.z).normalize().multiplyScalar(10).add(this.pos);
          steerToward(this.pos, away, 3.4, dt, colliders);
          this.yaw = Math.atan2(away.x - this.pos.x, away.z - this.pos.z);
        }
        moving = 1;
        hd.setPose('run', t + this.seed, moving);
        if (this.stateT > 3.5 || dangerDist > 30) {
          this.state = 'hide';
          this.stateT = 0;
        }
        break;
      }
      case 'hide':
        hd.setPose('crouch', t + this.seed, 0);
        if (this.stateT > 5 && dangerDist > 22) {
          this.state = 'resume';
          this.stateT = 0;
        }
        break;
      case 'resume':
        hd.setPose('idle', t + this.seed, 0);
        if (this.stateT > 1) {
          // rejoin nearest loop point
          let best = 0;
          let bd = Infinity;
          for (let i = 0; i < this.loop.length; i++) {
            const d = this.pos.distanceToSquared(this.loop[i]);
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          this.loopIdx = best;
          this.state = 'walk';
          this.stateT = 0;
        }
        break;
    }

    // global transitions
    if ((dangerDist < 9 || gunshot) && (this.state === 'walk' || this.state === 'idle' || this.state === 'resume')) {
      this.state = 'react';
      this.stateT = 0;
    }
    hd.group.position.copy(this.pos);
    hd.group.rotation.y = this.yaw;
  }

  dispose(scene: THREE.Object3D): void {
    scene.remove(this.humanoid.group);
  }
}

// ============================================================ hostiles (frontline AI)
export type HostileState = 'patrol' | 'alert' | 'investigate' | 'engage' | 'reposition' | 'search' | 'dead';

export interface HostileEvents {
  onShoot: (from: THREE.Vector3, target: THREE.Vector3, hit: boolean) => void;
}

export class Hostile {
  humanoid: Humanoid;
  pos: THREE.Vector3;
  state: HostileState = 'patrol';
  hp = 100;
  yaw = 0;
  stateT = 0;
  shootCd = 0;
  lastKnown = new THREE.Vector3();
  hasKnown = false;
  home: THREE.Vector3;
  wanderT = 0;
  wanderTarget: THREE.Vector3;
  accuracy = 0.3;
  dead = false;

  constructor(spawn: THREE.Vector3, seed: number, parent: THREE.Object3D) {
    this.pos = spawn.clone();
    this.home = spawn.clone();
    this.wanderTarget = spawn.clone();
    this.yaw = seed;
    this.humanoid = makeHumanoid('soldier', seed + 500, true);
    this.humanoid.group.position.copy(this.pos);
    parent.add(this.humanoid.group);
  }

  damage(amount: number): boolean {
    if (this.dead) return true;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.dead = true;
      this.state = 'dead';
      this.humanoid.setPose('down', 0, 0);
      return true;
    }
    return false;
  }

  update(
    dt: number,
    t: number,
    playerPos: THREE.Vector3,
    playerCrouch: boolean,
    playerDead: boolean,
    colliders: BoxCollider[],
    cover: THREE.Vector3[],
    ev: HostileEvents,
  ): void {
    if (this.dead) return;
    this.stateT += dt;
    this.shootCd -= dt;
    const hd = this.humanoid;
    const distP = this.pos.distanceTo(playerPos);
    const blocked = losBlocked(this.pos.x, this.pos.z, playerPos.x, playerPos.z, colliders);
    const visRange = playerCrouch ? 26 : 46;
    const seesPlayer = !playerDead && !blocked && distP < visRange;

    if (seesPlayer) {
      this.lastKnown.copy(playerPos);
      this.hasKnown = true;
    }

    switch (this.state) {
      case 'patrol': {
        this.wanderT -= dt;
        if (this.wanderT <= 0) {
          this.wanderT = 3 + Math.random() * 3;
          this.wanderTarget.set(this.home.x + (Math.random() - 0.5) * 24, 0, this.home.z + (Math.random() - 0.5) * 24);
        }
        steerToward(this.pos, this.wanderTarget, 1.6, dt, colliders);
        this.yaw = Math.atan2(this.wanderTarget.x - this.pos.x, this.wanderTarget.z - this.pos.z);
        hd.setPose('walk', t, 0.6);
        if (seesPlayer) {
          this.state = 'alert';
          this.stateT = 0;
        }
        break;
      }
      case 'alert':
        this.yaw = Math.atan2(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z);
        hd.setPose('guard', t, 0);
        if (this.stateT > 0.7) {
          this.state = seesPlayer ? 'engage' : 'investigate';
          this.stateT = 0;
        }
        break;
      case 'investigate': {
        const remain = steerToward(this.pos, this.lastKnown, 2.6, dt, colliders);
        this.yaw = Math.atan2(this.lastKnown.x - this.pos.x, this.lastKnown.z - this.pos.z);
        hd.setPose('walk', t, 0.8);
        if (seesPlayer) {
          this.state = 'engage';
          this.stateT = 0;
        } else if (remain < 1.5 || this.stateT > 8) {
          this.state = 'search';
          this.stateT = 0;
        }
        break;
      }
      case 'engage': {
        this.yaw = Math.atan2(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
        hd.setPose('aim', t, 0);
        // strafe a bit
        if (Math.random() < dt * 0.7) {
          const side = Math.random() < 0.5 ? 1 : -1;
          this.pos.x += Math.cos(this.yaw) * side * 1.4 * dt * 3;
          this.pos.z += -Math.sin(this.yaw) * side * 1.4 * dt * 3;
          resolveCollision(this.pos, 0.45, colliders);
        }
        if (this.shootCd <= 0 && distP < 60) {
          this.shootCd = 0.9 + Math.random() * 1.1;
          const hitChance = this.accuracy * (blocked ? 0 : Math.max(0.15, 1 - distP / 60)) * (playerCrouch ? 0.6 : 1);
          const hit = Math.random() < hitChance;
          ev.onShoot(this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), playerPos.clone().add(new THREE.Vector3(0, 1.3, 0)), hit);
        }
        if (!seesPlayer) {
          this.state = this.hasKnown ? 'investigate' : 'search';
          this.stateT = 0;
        } else if (this.stateT > 5 && cover.length > 0 && Math.random() < dt * 0.5) {
          this.state = 'reposition';
          this.stateT = 0;
          // pick nearest cover away from player
          let best = cover[0];
          let bs = Infinity;
          for (const c of cover) {
            const s = c.distanceToSquared(this.pos) - c.distanceToSquared(playerPos) * 0.3;
            if (s < bs) {
              bs = s;
              best = c;
            }
          }
          this.wanderTarget.copy(best);
        }
        break;
      }
      case 'reposition': {
        const remain = steerToward(this.pos, this.wanderTarget, 3.2, dt, colliders);
        this.yaw = Math.atan2(this.wanderTarget.x - this.pos.x, this.wanderTarget.z - this.pos.z);
        hd.setPose('run', t, 1);
        if (remain < 1.2 || this.stateT > 5) {
          this.state = seesPlayer ? 'engage' : 'investigate';
          this.stateT = 0;
        }
        break;
      }
      case 'search':
        this.yaw += dt * 1.2;
        hd.setPose('guard', t, 0);
        if (seesPlayer) {
          this.state = 'engage';
          this.stateT = 0;
        } else if (this.stateT > 6) {
          this.state = 'patrol';
          this.stateT = 0;
          this.hasKnown = false;
        }
        break;
      case 'dead':
        break;
    }
    hd.group.position.copy(this.pos);
    hd.group.rotation.y = this.yaw;
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.humanoid.group);
  }
}

/** Floating name tag sprite for remote players. */
export function makeNameTag(text: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 56;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(10,12,14,0.55)';
  g.beginPath();
  g.roundRect(28, 6, 200, 42, 10);
  g.fill();
  g.fillStyle = '#e8f2ff';
  g.font = 'bold 26px Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.slice(0, 14), 128, 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.2, 0.48, 1);
  return sp;
}

// ============================================================ foot patrol (inspection pair)
export interface FootPatrolEvents {
  onAlarm: (pos: THREE.Vector3) => void;
  onSpotted: () => void;
  onRadio: () => void;
}

export class FootPatrol {
  guards: Humanoid[] = [];
  waypoints: THREE.Vector3[];
  wpIdx = 0;
  checking: Civilian | null = null;
  checkT = 0;
  alarmCd = 0;
  spotCd = 0;
  checkCd = 4;
  events: FootPatrolEvents = { onAlarm: () => undefined, onSpotted: () => undefined, onRadio: () => undefined };

  constructor(waypoints: THREE.Vector3[], seed: number, parent: THREE.Object3D) {
    this.waypoints = waypoints;
    this.wpIdx = waypoints.length > 0 ? seed % waypoints.length : 0;
    for (let i = 0; i < 2; i++) {
      const h = makeHumanoid('officer', 700 + seed * 10 + i, false);
      const wp = waypoints[this.wpIdx] ?? new THREE.Vector3();
      h.group.position.set(wp.x + i * 1.2, 0, wp.z);
      parent.add(h.group);
      this.guards.push(h);
    }
  }

  update(
    dt: number,
    t: number,
    playerPos: THREE.Vector3,
    playerRunning: boolean,
    civilians: Civilian[],
    colliders: BoxCollider[],
  ): void {
    this.alarmCd -= dt;
    this.spotCd -= dt;
    this.checkCd -= dt;
    const lead = this.guards[0].group.position;
    const dp = lead.distanceTo(playerPos);
    if (dp < 15 && playerRunning && this.alarmCd <= 0) {
      this.alarmCd = 6;
      this.events.onAlarm(playerPos.clone());
    }
    if (dp < 2.4 && this.spotCd <= 0) {
      this.spotCd = 8;
      this.events.onSpotted();
    }
    // ambient document check of a nearby pedestrian
    if (!this.checking && this.checkCd <= 0) {
      let best: Civilian | null = null;
      let bd = 36;
      for (const c of civilians) {
        if (c.state !== 'walk' && c.state !== 'idle') continue;
        const d = lead.distanceToSquared(c.pos);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      if (best) {
        this.checking = best;
        this.checkT = 0;
      }
      this.checkCd = 6 + Math.random() * 6;
    }
    if (this.checking) {
      this.checkT += dt;
      const c = this.checking;
      for (let i = 0; i < 2; i++) {
        const g = this.guards[i];
        const tx = c.pos.x + (i === 0 ? 1.2 : -1.2);
        const tz = c.pos.z + 0.8;
        steerToward(g.group.position, new THREE.Vector3(tx, 0, tz), 2.2, dt, colliders);
        g.group.position.y = 0;
        g.group.rotation.y = Math.atan2(c.pos.x - g.group.position.x, c.pos.z - g.group.position.z);
        g.setPose('guard', t + i, 0);
      }
      if (this.checkT > 5) {
        this.events.onRadio();
        c.state = 'walk';
        c.stateT = 0;
        this.checking = null;
      }
      return;
    }
    if (this.waypoints.length === 0) return;
    const target = this.waypoints[this.wpIdx];
    this.guards.forEach((g, i) => {
      const off = new THREE.Vector3(target.x + i * 1.1, 0, target.z + (i ? 0.4 : 0));
      steerToward(g.group.position, off, 1.9, dt, colliders);
      g.group.position.y = 0;
      g.group.rotation.y = Math.atan2(off.x - g.group.position.x, off.z - g.group.position.z);
      g.setPose('walk', t + i * 2, 0.6);
    });
    if (lead.distanceTo(target) < 2) this.wpIdx = (this.wpIdx + 1) % this.waypoints.length;
  }

  dispose(parent: THREE.Object3D): void {
    for (const g of this.guards) parent.remove(g.group);
  }
}
