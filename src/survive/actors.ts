// ============================================================
// GREY CORRIDOR — procedural humanoids + NPC AI state machines
// ============================================================
import * as THREE from 'three';
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

export function makeHumanoid(kind: ModelKind, seed = 1, armed = false): Humanoid {
  const g = new THREE.Group();
  const r = (n: number): number => {
    const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const skin = new THREE.MeshStandardMaterial({ color: SKIN[Math.floor(r(1) * SKIN.length)], roughness: 0.8 });
  let top: THREE.Material;
  let bot: THREE.Material;
  let hat: THREE.Object3D | null = null;
  if (kind === 'officer') {
    top = new THREE.MeshStandardMaterial({ color: '#2b3a55', roughness: 0.85 });
    bot = new THREE.MeshStandardMaterial({ color: '#232a38', roughness: 0.9 });
  } else if (kind === 'soldier') {
    top = new THREE.MeshStandardMaterial({ color: '#4a5238', roughness: 0.95 });
    bot = new THREE.MeshStandardMaterial({ color: '#3d4430', roughness: 0.95 });
  } else if (kind === 'instructor') {
    top = new THREE.MeshStandardMaterial({ color: '#3a5c46', roughness: 0.9 });
    bot = new THREE.MeshStandardMaterial({ color: '#2c2c30', roughness: 0.9 });
  } else {
    top = new THREE.MeshStandardMaterial({ color: CIVIL_TOP[Math.floor(r(2) * CIVIL_TOP.length)], roughness: 0.95 });
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
  // vest for officer/soldier
  if (kind === 'officer' || kind === 'soldier') {
    const vest = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.42, 0.34),
      new THREE.MeshStandardMaterial({ color: kind === 'officer' ? '#1c2436' : '#33392a', roughness: 1 }),
    );
    vest.position.y = 1.22;
    vest.castShadow = true;
    g.add(vest);
    if (kind === 'officer') {
      // fictional insignia band (plain yellow stripe, invented)
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.07, 0.35),
        new THREE.MeshStandardMaterial({ color: '#c9a83a', roughness: 0.8 }),
      );
      band.position.y = 1.38;
      g.add(band);
    }
  }
  // arms
  const armL = limb(top, 0.14, 0.72);
  armL.position.set(-0.33, 1.5, 0);
  const armR = limb(top, 0.14, 0.72);
  armR.position.set(0.33, 1.5, 0);
  // head
  const headG = new THREE.Group();
  headG.position.y = 1.72;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.26), skin);
  head.position.y = 0.12;
  head.castShadow = true;
  headG.add(head);
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
    const capMat = new THREE.MeshStandardMaterial({ color: kind === 'officer' ? '#1c2436' : '#2c4434', roughness: 0.9 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.18, 0.1, 10), capMat);
    cap.position.y = 0.3;
    headG.add(cap);
    hat = cap;
  } else {
    const helm = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#3d4430', roughness: 1 }),
    );
    helm.position.y = 0.26;
    headG.add(helm);
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
  pos.x += (dx / d) * step;
  pos.z += (dz / d) * step;
  resolveCollision(pos, radius, colliders);
  return d - step;
}

// ============================================================ civilians
export type CivilState = 'idle' | 'walk' | 'react' | 'flee' | 'hide' | 'resume';

export class Civilian {
  humanoid: Humanoid;
  pos: THREE.Vector3;
  state: CivilState = 'walk';
  loop: THREE.Vector3[];
  loopIdx = 0;
  dir = 1;
  speed = 1.4;
  stateT = 0;
  stallT = 0;
  yaw = 0;
  private seed: number;

  constructor(loop: THREE.Vector3[], seed: number, scene: THREE.Object3D) {
    this.seed = seed;
    this.loop = loop;
    this.loopIdx = Math.floor(Math.abs(Math.sin(seed * 3.7)) * loop.length);
    this.dir = seed % 2 === 0 ? 1 : -1;
    this.pos = loop[this.loopIdx].clone();
    this.humanoid = makeHumanoid('civilian', seed, false);
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
        const target = this.loop[this.loopIdx];
        const before = Math.hypot(target.x - this.pos.x, target.z - this.pos.z);
        const remain = steerToward(this.pos, target, this.speed, dt, colliders);
        if (before - remain < this.speed * dt * 0.25) this.stallT += dt;
        else this.stallT = 0;
        moving = 0.6;
        this.yaw = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
        hd.setPose('walk', t + this.seed, moving);
        if (remain < 0.6 || this.stallT > 2.5) {
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
