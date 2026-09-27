// ============================================================
// GREY CORRIDOR — the white minibus: hero asset + patrol AI
// Fictional inspection vehicle. Patrol -> notice -> stop -> doors.
// ============================================================
import * as THREE from 'three';
import { resolveCollision, type BoxCollider } from './world';

export type VanState = 'patrol' | 'stakeout' | 'notice' | 'slow' | 'stop' | 'doors' | 'check' | 'dismount' | 'chase' | 'transport' | 'leave';

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

  // hollow shell: floor pan + side walls + roof + hood + rear (real cabin inside)
  const shellPanels: THREE.Mesh[] = [];
  const panel = (w: number, h: number, d: number, x: number, y: number, z: number, mat: THREE.Material = paint): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    shellPanels.push(m);
    body.add(m);
    return m;
  };
  const glass = (w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glassMat);
    m.position.set(x, y, z);
    body.add(m);
    return m;
  };
  // floor + hood + roof + rear
  panel(1.9, 0.15, 5.6, 0, 0.62, -0.1, trimMat);
  panel(1.96, 0.7, 0.9, 0, 1.05, 3.15); // hood (was: nose)
  panel(1.96, 0.12, 5.1, 0, 2.4, -0.35); // roof
  panel(1.96, 1.7, 0.1, 0, 1.55, -2.92); // rear doors
  glass(0.7, 0.5, 0.04, -0.45, 1.85, -2.98);
  glass(0.7, 0.5, 0.04, 0.45, 1.85, -2.98);
  // left wall (driver side): solid lower + glass band + pillars + rail
  panel(0.08, 0.75, 5.6, -0.96, 1.05, -0.1);
  glass(0.06, 0.62, 3.3, -0.96, 1.75, -0.75);
  glass(0.06, 0.62, 0.9, -0.96, 1.75, 1.65);
  for (const pz of [-2.45, -0.75, 0.95, 1.2, 2.12]) panel(0.08, 0.62, 0.12, -0.96, 1.75, pz);
  panel(0.08, 0.3, 5.1, -0.96, 2.19, -0.35);
  // right wall: cab + REAR sections, OPENING for the sliding door (z 0.06..1.04)
  panel(0.08, 0.75, 1.7, 0.96, 1.05, 1.95);
  panel(0.08, 0.75, 2.9, 0.96, 1.05, -1.45);
  glass(0.06, 0.62, 2.2, 0.96, 1.75, -1.7);
  glass(0.06, 0.62, 0.75, 0.96, 1.75, 1.55);
  for (const pz of [-2.85, -0.5, 0.0, 1.1, 2.12]) panel(0.08, 0.62, 0.12, 0.96, 1.75, pz);
  panel(0.08, 0.3, 5.1, 0.96, 2.19, -0.35);
  // slanted windshield + A-pillars
  const shield = glass(1.8, 1.0, 0.06, 0, 1.87, 2.45);
  shield.rotation.x = -0.53;
  for (const s of [-1, 1]) {
    const ap = panel(0.09, 1.0, 0.09, s * 0.92, 1.87, 2.45);
    ap.rotation.x = -0.53;
  }

  // sliding door (right side) — rides OUTSIDE the wall on rails, slides back
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.55, 1.1), paint);
  door.position.set(1.06, 1.32, 0.55);
  door.castShadow = true;
  body.add(door);
  const doorGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.75), glassMat);
  doorGlass.position.set(0, 0.42, 0);
  door.add(doorGlass);

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
  beacon.position.set(0, 2.56, 1.8);
  body.add(beacon);

  // fictional livery stripe + text (canvas decal)
  const stripeMat = new THREE.MeshStandardMaterial({ color: '#27436e', roughness: 0.5 });
  const stripeL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 5.5), stripeMat);
  stripeL.position.set(-1.0, 1.28, -0.15);
  const stripeRF = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 1.7), stripeMat);
  stripeRF.position.set(1.0, 1.28, 1.95);
  const stripeRR = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 2.9), stripeMat);
  stripeRR.position.set(1.0, 1.28, -1.45);
  body.add(stripeL, stripeRF, stripeRR);
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
  const decalL = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.35), new THREE.MeshBasicMaterial({ map: ltex }));
  decalL.position.set(-1.02, 0.95, -0.4);
  decalL.rotation.y = -Math.PI / 2;
  const decalR = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.35), new THREE.MeshBasicMaterial({ map: ltex }));
  decalR.position.set(1.02, 0.95, -1.45);
  decalR.rotation.y = Math.PI / 2;
  body.add(decalL, decalR);
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
  const floorMat = new THREE.Mesh(new THREE.BoxGeometry(1.84, 0.05, 5.5), new THREE.MeshStandardMaterial({ color: '#1b1d20', roughness: 1 }));
  floorMat.position.set(0, 0.72, -0.1);
  body.add(floorMat);
  const dome = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.03, 0.3),
    new THREE.MeshStandardMaterial({ color: '#443c2a', emissive: '#ffd9a0', emissiveIntensity: 2.2 }),
  );
  dome.position.set(0, 2.32, -0.5);
  body.add(dome);
  const cabinLight = new THREE.PointLight('#ffd9a0', 4, 5, 1.6);
  cabinLight.position.set(0, 2.0, -0.5);
  body.add(cabinLight);

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
const CITY_ROADS = [-56, 0, 56];

/** Snap a point to the nearest road center-line — vans stay on roads. */
export function nearestRoadPoint(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  let bx = CITY_ROADS[0];
  let bz = p.z;
  let bd = Infinity;
  for (const r of CITY_ROADS) {
    const dx = Math.abs(p.x - r);
    if (dx < bd) {
      bd = dx;
      bx = r;
      bz = p.z;
    }
    const dz = Math.abs(p.z - r);
    if (dz < bd) {
      bd = dz;
      bx = p.x;
      bz = r;
    }
  }
  return out.set(bx, 0, bz);
}

export function isNearRoad(p: THREE.Vector3, pad = 7): boolean {
  for (const r of CITY_ROADS) {
    if (Math.abs(p.x - r) < pad || Math.abs(p.z - r) < pad) return true;
  }
  return false;
}

export interface VanEvents {
  onDoorsOpened: () => void;
  onCheckReady: () => void;
  onChaseStart: () => void;
  onGiveUp: () => void;
  onArrived: () => void;
  onHorn: () => void;
  onDismount: () => void;
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
  reversing = 0;
  stuckT = 0;
  stuckCount = 0;
  stuckDecay = 0;
  prevX = 0;
  prevZ = 0;
  prevSpeed = 0;
  lastTurn = 0;
  dismountedFired = false;
  tmpRoad = new THREE.Vector3();
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
    onDismount: () => undefined,
  };

  constructor(route: THREE.Vector3[], hotspots: THREE.Vector3[], parent: THREE.Object3D) {
    this.route = route;
    this.hotspots = hotspots.length > 0 ? hotspots : route;
    this.rig = buildMinibusMesh();
    this.pos = route.length > 0 ? route[0].clone() : new THREE.Vector3();
    this.prevX = this.pos.x;
    this.prevZ = this.pos.z;
    this.rig.group.position.copy(this.pos);
    parent.add(this.rig.group);
  }

  /** Where officers / player enter. */
  doorWorldPos(out: THREE.Vector3): THREE.Vector3 {
    out.set(1.5, 0, 0.5).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw).add(this.pos);
    return out;
  }

  toDismount(): void {
    if (this.state === 'dismount') return;
    this.state = 'dismount';
    this.stateT = 0;
    this.doorT = this.doorT >= 1 ? 1 : 0;
    this.dismountedFired = false;
    this.stuckCount = 0;
    this.reversing = 0;
  }

  recall(): void {
    this.state = 'leave';
    this.stateT = 0;
    this.cooldown = 20;
    this.stuckCount = 0;
    this.reversing = 0;
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
    if (this.state === 'check' || this.state === 'doors' || this.state === 'stop' || this.state === 'dismount') {
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
        // pull toward the nearest ROAD point to the player (never through blocks)
        nearestRoadPoint(playerPos, this.tmpRoad);
        steerTarget = this.tmpRoad;
        const dRoad = Math.hypot(this.pos.x - this.tmpRoad.x, this.pos.z - this.tmpRoad.z);
        targetSpeed = dRoad > 5 ? 6.5 : 0;
        rig.indicatorOn = true;
        if (dRoad < 5) {
          this.state = 'stop';
          this.stateT = 0;
        }
        if (distP > 55) {
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
          this.events.onDoorsOpened();
          if (distP < 9) {
            this.state = 'check';
            this.stateT = 0;
            this.events.onCheckReady();
          } else {
            this.toDismount();
          }
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
        // chase along roads when the player ducks inside blocks (officers hunt on foot)
        if (isNearRoad(playerPos)) {
          steerTarget = playerPos;
        } else {
          nearestRoadPoint(playerPos, this.tmpRoad);
          steerTarget = this.tmpRoad;
        }
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
      case 'dismount': {
        targetSpeed = 0;
        rig.brakeOn = true;
        this.doorT = Math.min(1, this.doorT + dt / 1.3);
        rig.setDoor(this.doorT);
        if (this.doorT >= 1 && !this.dismountedFired) {
          this.dismountedFired = true;
          this.events.onDismount();
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
    if (this.reversing > 0) {
      this.reversing -= dt;
      this.yaw += dt * 0.9;
      this.speed = THREE.MathUtils.lerp(this.speed, -4, 1 - Math.exp(-dt * 4));
      this.pos.x += Math.sin(this.yaw) * this.speed * dt;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    } else {
      this.speed = THREE.MathUtils.lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * 2.2));
    }
    if (steerTarget && this.reversing <= 0) {
      const wantYaw = Math.atan2(steerTarget.x - this.pos.x, steerTarget.z - this.pos.z);
      let dy = wantYaw - this.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      const turn = THREE.MathUtils.clamp(dy * 2.2, -1.4, 1.4);
      this.lastTurn = turn;
      this.yaw += turn * dt * Math.min(1, 0.5 + this.speed / 5);
      this.pos.x += Math.sin(this.yaw) * this.speed * dt;
      this.pos.z += Math.cos(this.yaw) * this.speed * dt;
      const steerVis = THREE.MathUtils.clamp(dy, -0.5, 0.5);
      rig.steerL.rotation.y = steerVis;
      rig.steerR.rotation.y = steerVis;
    }
    resolveCollision(this.pos, 1.6, colliders);
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -100, 100);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -100, 100);
    // stuck detection: reversing maneuver, then dismount / give up
    const movedD = Math.hypot(this.pos.x - this.prevX, this.pos.z - this.prevZ);
    this.prevX = this.pos.x;
    this.prevZ = this.pos.z;
    if (this.reversing <= 0 && targetSpeed > 2 && this.speed > 2.5 && movedD < this.speed * dt * 0.3) {
      this.stuckT += dt;
    } else if (this.reversing <= 0) {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
    }
    if (this.stuckT > 2 && (this.state === 'slow' || this.state === 'chase' || this.state === 'patrol' || this.state === 'stakeout')) {
      this.stuckT = 0;
      this.stuckCount++;
      this.reversing = 1.1;
    }
    this.stuckDecay += dt;
    if (this.stuckDecay > 25) {
      this.stuckDecay = 0;
      this.stuckCount = 0;
    }
    if (this.state === 'slow' && (this.stuckCount >= 3 || this.stateT > 30)) {
      this.toDismount();
    } else if (this.state === 'chase' && this.stuckCount >= 4) {
      this.state = 'leave';
      this.stateT = 0;
      this.cooldown = 30;
      this.rig.setDoor(0);
      this.stuckCount = 0;
      this.events.onGiveUp();
    } else if ((this.state === 'patrol' || this.state === 'stakeout') && this.stuckCount >= 4) {
      this.stuckCount = 0;
      this.routeIdx = (this.routeIdx + 1) % this.route.length;
    }

    // --- visuals ---
    rig.group.position.copy(this.pos);
    rig.group.rotation.y = this.yaw;
    this.wheelSpin += (this.speed / 0.36) * dt;
    for (const w of rig.wheels) w.rotation.x = this.wheelSpin;
    // suspension bob + body roll in turns + pitch under accel/brake
    rig.body.position.y = Math.sin(t * 9) * 0.012 * Math.min(1, this.speed / 8) + Math.sin(t * 23) * 0.004;
    const accel = (this.speed - this.prevSpeed) / Math.max(dt, 0.001);
    this.prevSpeed = this.speed;
    rig.body.rotation.x = THREE.MathUtils.lerp(rig.body.rotation.x, THREE.MathUtils.clamp(-accel * 0.004, -0.05, 0.05), 1 - Math.exp(-dt * 5));
    const rollTarget = THREE.MathUtils.clamp(-this.lastTurn * this.speed * 0.012, -0.07, 0.07) + Math.sin(t * 7) * 0.003 * Math.min(1, this.speed / 8);
    rig.body.rotation.z = THREE.MathUtils.lerp(rig.body.rotation.z, rollTarget, 1 - Math.exp(-dt * 4));
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
      rig.beaconMat.emissiveIntensity = this.state === 'check' || this.state === 'doors' || this.state === 'slow' || this.state === 'dismount' ? 1.5 + Math.sin(t * 6) * 1.5 : 0;
    }
    this.rpm01 = THREE.MathUtils.clamp(this.speed / 12, 0.08, 1);
  }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.rig.group);
  }
}
