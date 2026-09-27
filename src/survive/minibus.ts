// ============================================================
// GREY CORRIDOR — the white minibus: hero asset + patrol AI
// Fictional inspection vehicle. Patrol -> notice -> stop -> doors.
// ============================================================
import * as THREE from 'three';
import { resolveCollision, type BoxCollider } from './world';

export type VanState = 'patrol' | 'stakeout' | 'notice' | 'slow' | 'stop' | 'doors' | 'check' | 'chase' | 'transport' | 'leave';

export interface VanRig {
  group: THREE.Group;
  body: THREE.Group;
  wheels: THREE.Mesh[];
  steerL: THREE.Group;
  steerR: THREE.Group;
  door: THREE.Mesh;
  headMat: THREE.MeshStandardMaterial;
  tailMat: THREE.MeshStandardMaterial;
  indLMat: THREE.MeshStandardMaterial;
  indRMat: THREE.MeshStandardMaterial;
  beaconMat: THREE.MeshStandardMaterial;
  headlight: THREE.SpotLight;
  doorOpen01: number;
  indicatorOn: boolean;
  brakeOn: boolean;
  setDoor: (open01: number) => void;
}

function buildMinibusMesh(): VanRig {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);

  const paint = new THREE.MeshStandardMaterial({ color: '#e8e9e6', roughness: 0.32, metalness: 0.12 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#26282c', roughness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#2a3a44', roughness: 0.08, metalness: 0.65, transparent: true, opacity: 0.75 });
  const tireMat = new THREE.MeshStandardMaterial({ color: '#131313', roughness: 0.95 });
  const hubMat = new THREE.MeshStandardMaterial({ color: '#8c8c88', roughness: 0.4, metalness: 0.7 });

  // main hull: lower + upper + nose taper
  const lower = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.05, 5.9), paint);
  lower.position.y = 0.95;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.95, 5.3), paint);
  upper.position.set(0, 1.95, -0.25);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.96, 0.7, 0.9), paint);
  nose.position.set(0, 1.05, 3.15);
  body.add(lower, upper, nose);
  for (const m of [lower, upper, nose]) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
  // windshield + side glass
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, 0.08), glassMat);
  shield.position.set(0, 1.85, 2.62);
  shield.rotation.x = -0.28;
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 2.6), glassMat);
  sideL.position.set(-0.99, 1.95, 0.6);
  const sideR = sideL.clone();
  sideR.position.x = 0.99;
  const driverL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.9), glassMat);
  driverL.position.set(-0.99, 1.85, 2.0);
  const driverR = driverL.clone();
  driverR.position.x = 0.99;
  body.add(shield, sideL, sideR, driverL, driverR);

  // sliding door (right side) — slides back when open
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 1.15), paint);
  door.position.set(1.0, 1.35, 0.55);
  door.castShadow = true;
  body.add(door);
  const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.5, 0.8), glassMat);
  doorGlass.position.set(0, 0.4, 0);
  door.add(doorGlass);
  // dark interior visible behind door
  const innerDark = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.5, 1.15), new THREE.MeshStandardMaterial({ color: '#0c0d0e', roughness: 1 }));
  innerDark.position.set(0.72, 1.35, 0.55);
  body.add(innerDark);

  // bumpers, grille, mirrors
  const bumpF = new THREE.Mesh(new THREE.BoxGeometry(2.02, 0.35, 0.25), trimMat);
  bumpF.position.set(0, 0.5, 3.55);
  const bumpR = bumpF.clone();
  bumpR.position.z = -2.98;
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.28, 0.1), trimMat);
  grille.position.set(0, 0.95, 3.58);
  body.add(bumpF, bumpR, grille);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.06), trimMat);
    arm.position.set(s * 1.1, 1.85, 2.45);
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.2), trimMat);
    mir.position.set(s * 1.24, 1.8, 2.45);
    body.add(arm, mir);
  }

  // headlights / taillights / indicators / beacon
  const headMat = new THREE.MeshStandardMaterial({ color: '#fff6da', emissive: '#ffe9a8', emissiveIntensity: 2.4 });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.1), headMat);
    h.position.set(s * 0.68, 1.05, 3.58);
    body.add(h);
  }
  const tailMat = new THREE.MeshStandardMaterial({ color: '#5c1410', emissive: '#ff2a1a', emissiveIntensity: 0.7 });
  for (const s of [-1, 1]) {
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.55, 0.1), tailMat);
    tl.position.set(s * 0.88, 1.1, -2.97);
    body.add(tl);
  }
  const indLMat = new THREE.MeshStandardMaterial({ color: '#6e4a10', emissive: '#ff9a1a', emissiveIntensity: 0 });
  const indRMat = indLMat.clone();
  const indL = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.1), indLMat);
  indL.position.set(-0.95, 1.05, 3.58);
  const indR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.1), indRMat);
  indR.position.set(0.95, 1.05, 3.58);
  body.add(indL, indR);
  const beaconMat = new THREE.MeshStandardMaterial({ color: '#2a4a8c', emissive: '#2a6aff', emissiveIntensity: 0 });
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.18, 10), beaconMat);
  beacon.position.set(0, 2.52, 1.8);
  body.add(beacon);

  // fictional livery stripe + text (canvas decal)
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(2.02, 0.3, 5.5),
    new THREE.MeshStandardMaterial({ color: '#27436e', roughness: 0.5 }),
  );
  stripe.position.set(0, 1.28, -0.15);
  body.add(stripe);
  const lc = document.createElement('canvas');
  lc.width = 512;
  lc.height = 64;
  const lg = lc.getContext('2d')!;
  lg.fillStyle = '#27436e';
  lg.fillRect(0, 0, 512, 64);
  lg.fillStyle = '#e8e9e6';
  lg.font = 'bold 34px Arial';
  lg.textAlign = 'center';
  lg.textBaseline = 'middle';
  lg.fillText('ТИД • ИНСПЕКЦИЯ • 0417', 256, 34);
  const ltex = new THREE.CanvasTexture(lc);
  ltex.colorSpace = THREE.SRGBColorSpace;
  for (const s of [-1, 1]) {
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.4), new THREE.MeshBasicMaterial({ map: ltex }));
    decal.position.set(s * 1.02, 1.62, -0.4);
    decal.rotation.y = s * Math.PI / 2;
    if (s < 0) decal.rotation.y = -Math.PI / 2;
    body.add(decal);
  }
  // plate
  const pc = document.createElement('canvas');
  pc.width = 128;
  pc.height = 32;
  const pg = pc.getContext('2d')!;
  pg.fillStyle = '#f2f2ee';
  pg.fillRect(0, 0, 128, 32);
  pg.fillStyle = '#1a1a1a';
  pg.font = 'bold 24px Arial';
  pg.textAlign = 'center';
  pg.fillText('ВГ 0417', 64, 25);
  const ptex = new THREE.CanvasTexture(pc);
  ptex.colorSpace = THREE.SRGBColorSpace;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.14), new THREE.MeshBasicMaterial({ map: ptex }));
  plate.position.set(0, 0.52, 3.69);
  body.add(plate);

  // interior: driver + benches + seats (visible through door/glass)
  const seatMat = new THREE.MeshStandardMaterial({ color: '#3a3f4a', roughness: 0.95 });
  const dashMat = new THREE.MeshStandardMaterial({ color: '#22252a', roughness: 0.8 });
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.4, 0.5), dashMat);
  dash.position.set(0, 1.35, 2.3);
  body.add(dash);
  const wheelM = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 16), dashMat);
  wheelM.position.set(-0.5, 1.5, 2.1);
  wheelM.rotation.x = -0.5;
  body.add(wheelM);
  const mkSeat = (x: number, z: number): void => {
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.55), seatMat);
    base.position.set(x, 0.95, z);
    const backr = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.12), seatMat);
    backr.position.set(x, 1.3, z - 0.26);
    body.add(base, backr);
  };
  mkSeat(-0.5, 1.5);
  mkSeat(0.5, 1.5);
  for (const z of [0.1, -0.9]) {
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.14, 0.55), seatMat);
    bench.position.set(0, 0.95, z);
    const benchBack = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 0.12), seatMat);
    benchBack.position.set(0, 1.3, z - 0.26);
    body.add(bench, benchBack);
  }

  // wheels with steering groups in front
  const wheels: THREE.Mesh[] = [];
  const mkWheel = (x: number, z: number, steered: boolean): THREE.Group | THREE.Mesh => {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 14), tireMat);
    tire.rotation.z = Math.PI / 2;
    tire.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.28, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    tire.add(hub);
    wheels.push(tire);
    if (steered) {
      const steer = new THREE.Group();
      steer.position.set(x, 0.36, z);
      steer.add(tire);
      group.add(steer);
      return steer;
    }
    tire.position.set(x, 0.36, z);
    group.add(tire);
    return tire;
  };
  const steerL = mkWheel(-0.95, 2.05, true) as THREE.Group;
  const steerR = mkWheel(0.95, 2.05, true) as THREE.Group;
  mkWheel(-0.95, -1.85, false);
  mkWheel(0.95, -1.85, false);

  // headlight beam
  const headlight = new THREE.SpotLight('#ffeec4', 60, 45, 0.5, 0.5, 1.6);
  headlight.position.set(0, 1.4, 3.2);
  headlight.target.position.set(0, 0.4, 14);
  group.add(headlight, headlight.target);

  const rig: VanRig = {
    group,
    body,
    wheels,
    steerL,
    steerR,
    door,
    headMat,
    tailMat,
    indLMat,
    indRMat,
    beaconMat,
    headlight,
    doorOpen01: 0,
    indicatorOn: false,
    brakeOn: false,
    setDoor(open01: number) {
      rig.doorOpen01 = THREE.MathUtils.clamp(open01, 0, 1);
      door.position.z = 0.55 - rig.doorOpen01 * 1.2;
    },
  };
  return rig;
}

// ============================================================ patrol AI
export interface VanEvents {
  onDoorsOpened: () => void;
  onCheckReady: () => void;
  onChaseStart: () => void;
  onGiveUp: () => void;
  onArrived: () => void;
  onHorn: () => void;
}

export class VanAI {
  rig: VanRig;
  state: VanState = 'patrol';
  pos: THREE.Vector3;
  yaw = 0;
  speed = 0;
  route: THREE.Vector3[];
  routeIdx = 0;
  suspicion = 0;
  aggression = 1;
  hotspots: THREE.Vector3[] = [];
  stakeIdx = 0;
  stakeT = 0;
  stakeDur = 20;
  patrolT = 0;
  hornCd = 0;
  stateT = 0;
  doorT = 0;
  chaseT = 0;
  lostT = 0;
  cooldown = 0;
  rpm01 = 0;
  wheelSpin = 0;
  transportT = 0;
  events: VanEvents = {
    onDoorsOpened: () => undefined,
    onCheckReady: () => undefined,
    onChaseStart: () => undefined,
    onGiveUp: () => undefined,
    onArrived: () => undefined,
    onHorn: () => undefined,
  };

  constructor(route: THREE.Vector3[], hotspots: THREE.Vector3[], parent: THREE.Object3D) {
    this.route = route;
    this.hotspots = hotspots.length > 0 ? hotspots : route;
    this.rig = buildMinibusMesh();
    this.pos = route.length > 0 ? route[0].clone() : new THREE.Vector3();
    this.rig.group.position.copy(this.pos);
    parent.add(this.rig.group);
  }

  /** Where officers / player enter. */
  doorWorldPos(out: THREE.Vector3): THREE.Vector3 {
    out.set(1.4, 0, 0.55).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.pos);
    return out;
  }

  startTransport(): void {
    this.state = 'transport';
    this.stateT = 0;
    this.transportT = 0;
    this.rig.setDoor(0);
  }

  release(): void {
    // officers return: close doors, leave
    this.state = 'leave';
    this.stateT = 0;
    this.cooldown = 25;
  }

  startChase(): void {
    if (this.state === 'check' || this.state === 'doors' || this.state === 'stop') {
      this.state = 'chase';
      this.stateT = 0;
      this.chaseT = 0;
      this.lostT = 0;
      this.events.onChaseStart();
    }
  }

  update(
    dt: number,
    t: number,
    playerPos: THREE.Vector3,
    playerRunning: boolean,
    playerHidden: boolean,
    playerDetained: boolean,
    colliders: BoxCollider[],
  ): void {
    this.stateT += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const rig = this.rig;
    const distP = Math.hypot(playerPos.x - this.pos.x, playerPos.z - this.pos.z);
    let targetSpeed = 0;
    let steerTarget: THREE.Vector3 | null = null;

    switch (this.state) {
      case 'patrol': {
        targetSpeed = 8.5 + this.aggression * 1.2;
        steerTarget = this.route[this.routeIdx];
        if (this.pos.distanceTo(steerTarget) < 6) {
          this.routeIdx = (this.routeIdx + 1) % this.route.length;
        }
        this.patrolT += dt;
        if (this.patrolT > 30 && this.cooldown <= 0 && this.hotspots.length > 0) {
          this.patrolT = 0;
          this.stakeT = 0;
          this.stakeIdx = (this.stakeIdx + 1) % this.hotspots.length;
          this.state = 'stakeout';
          this.stateT = 0;
          this.stakeDur = 16 + Math.random() * 16;
        }
        // notice player: close, visible-ish, cooldown elapsed
        if (this.cooldown <= 0 && distP < 30 && !playerHidden && !playerDetained) {
          this.state = 'notice';
          this.stateT = 0;
        }
        this.suspicion = Math.max(0, this.suspicion - dt * 0.2);
        break;
      }
      case 'notice': {
        targetSpeed = 6;
        steerTarget = this.route[this.routeIdx];
        this.suspicion = Math.min(1, this.suspicion + dt * (0.55 + this.aggression * 0.45));
        if (playerRunning && distP < 30) this.suspicion = Math.min(1, this.suspicion + dt * (0.5 + this.aggression * 0.4));
        if (this.suspicion >= 1) {
          this.state = 'slow';
          this.stateT = 0;
        } else if (distP > 42 || playerHidden) {
          this.state = 'patrol';
        }
        if (this.stateT > 6 && this.suspicion < 1) this.state = 'patrol';
        break;
      }
      case 'slow': {
        // pull toward player
        steerTarget = playerPos;
        targetSpeed = distP > 8 ? 5 : 0;
        rig.indicatorOn = true;
        if (distP < 7.5) {
          this.state = 'stop';
          this.stateT = 0;
        }
        if (distP > 50) {
          this.state = 'patrol';
          rig.indicatorOn = false;
        }
        break;
      }
      case 'stop': {
        targetSpeed = 0;
        rig.brakeOn = true;
        if (this.stateT > 1.2) {
          this.state = 'doors';
          this.stateT = 0;
          this.doorT = 0;
        }
        break;
      }
      case 'doors': {
        targetSpeed = 0;
        this.doorT = Math.min(1, this.doorT + dt / 1.3);
        rig.setDoor(this.doorT);
        if (this.doorT >= 1 && this.stateT > 1.6) {
          this.state = 'check';
          this.stateT = 0;
          this.events.onDoorsOpened();
          this.events.onCheckReady();
        }
        break;
      }
      case 'check': {
        targetSpeed = 0;
        // Game drives the dialog; van waits. Chase is triggered externally.
        break;
      }
      case 'chase': {
        this.chaseT += dt;
        if (distP > 55) this.lostT += dt;
        else this.lostT = 0;
        if (playerHidden) this.lostT += dt * 1.5;
        this.hornCd -= dt;
        if (distP < 22 && this.hornCd <= 0) {
          this.hornCd = 3;
          this.events.onHorn();
        }
        steerTarget = playerPos;
        targetSpeed = distP > 6 ? 7.5 : 0;
        rig.beaconMat.emissiveIntensity = 2 + Math.sin(t * 12) * 2;
        if (this.lostT > 7 || this.chaseT > 60) {
          this.state = 'leave';
          this.stateT = 0;
          this.cooldown = 30;
          this.rig.setDoor(0);
          this.events.onGiveUp();
        }
        break;
      }
      case 'stakeout': {
        const spot = this.hotspots[this.stakeIdx];
        if (this.suspicion >= 1 && !playerHidden) {
          this.state = 'slow';
          this.stateT = 0;
          break;
        }
        if (this.pos.distanceTo(spot) < 4) {
          targetSpeed = 0;
          this.stakeT += dt;
          if (!playerHidden && !playerDetained && distP < 24) {
            this.suspicion = Math.min(1, this.suspicion + dt * (0.5 + this.aggression * 0.4));
            if (this.suspicion >= 1) {
              this.state = 'slow';
              this.stateT = 0;
              break;
            }
          } else {
            this.suspicion = Math.max(0, this.suspicion - dt * 0.3);
          }
          if (this.stakeT > this.stakeDur) {
            this.state = 'leave';
            this.stateT = 0;
          }
        } else {
          steerTarget = spot;
          targetSpeed = 7;
        }
        break;
      }
      case 'transport': {
        this.transportT += dt;
        targetSpeed = 11;
        steerTarget = this.route[this.routeIdx];
        if (this.pos.distanceTo(steerTarget) < 8) {
          this.routeIdx = (this.routeIdx + 1) % this.route.length;
        }
        if (this.transportT > 34) {
          this.events.onArrived();
        }
        break;
      }
      case 'leave': {
        targetSpeed = 8;
        rig.setDoor(Math.max(0, rig.doorOpen01 - dt / 1.2));
        steerTarget = this.route[this.routeIdx];
        if (this.pos.distanceTo(steerTarget) < 6) {
          this.routeIdx = (this.routeIdx + 1) % this.route.length;
        }
        if (this.stateT > 4) {
          this.state = 'patrol';
          rig.indicatorOn = false;
          rig.brakeOn = false;
        }
        break;
      }
    }

    // --- drive ---
    this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * 2.2));
    if (steerTarget) {
      const wantYaw = Math.atan2(steerTarget.x - this.pos.x, steerTarget.z - this.pos.z);
      let dy = wantYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const turn = THREE.MathUtils.clamp(dy * 2.2, -1.4, 1.4);
      this.yaw += turn * dt * Math.min(1, 0.3 + this.speed / 6);
      this.pos.x += Math.sin(this.yaw) * this.speed * dt;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      const steerVis = THREE.MathUtils.clamp(dy, -0.5, 0.5);
      rig.steerL.rotation.y = steerVis;
      rig.steerR.rotation.y = steerVis;
    }
    resolveCollision(this.pos, 1.6, colliders);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -100, 100);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -100, 100);

    // --- visuals ---
    rig.group.position.copy(this.pos);
    rig.group.rotation.y = this.yaw;
    this.wheelSpin += (this.speed / 0.36) * dt;
    for (const w of rig.wheels) w.rotation.x = this.wheelSpin;
    // suspension bob
    rig.body.position.y = Math.sin(t * 9) * 0.012 * Math.min(1, this.speed / 8) + Math.sin(t * 23) * 0.004;
    rig.body.rotation.z = Math.sin(t * 7) * 0.003 * Math.min(1, this.speed / 8);
    // brake / indicators
    const braking = targetSpeed < this.speed - 0.5 || this.state === 'stop';
    rig.tailMat.emissiveIntensity = braking ? 3 : 0.7;
    if (rig.indicatorOn || this.state === 'slow' || this.state === 'stop') {
      const blink = Math.sin(t * 8) > 0 ? 2.5 : 0;
      rig.indRMat.emissiveIntensity = blink;
    } else {
      rig.indRMat.emissiveIntensity = 0;
    }
    if (this.state !== 'chase') {
      rig.beaconMat.emissiveIntensity = this.state === 'check' || this.state === 'doors' ? 1.5 + Math.sin(t * 6) * 1.5 : 0;
    }
    this.rpm01 = THREE.MathUtils.clamp(this.speed / 12, 0.08, 1);
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.rig.group);
  }
}
