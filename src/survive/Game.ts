// ============================================================
// GREY CORRIDOR — game orchestrator: player, chapters, AI glue,
// encounters, combat, missions, VFX, net sync. All fictional.
// ============================================================
import * as THREE from 'three';
import { World, nearCover, resolveCollision, losBlocked, type ZoneData } from './world';
import { makeHumanoid, Civilian, FootPatrol, Hostile, steerToward, makeNameTag, type Humanoid } from './actors';
import { VanAI } from './minibus';
import { AudioEngine } from './audio';
import { NetClient, type ChatMsg } from './net';
import {
  CHAPTER_LABELS,
  DEFAULT_STATS,
  QUALITY_PRESETS,
  loadSave,
  makeDoc,
  storeSave,
  type ChapterId,
  type DocKind,
  type EncounterStage,
  type GameDoc,
  type HudSnapshot,
  type MiniDot,
  type Objective,
  type PlayerStats,
  type Quality,
} from './types';
import { softDotTexture, targetFaceTexture } from './textures';
import type { AnimState } from '../../shared/protocol';

export interface GameOptions {
  name: string;
  quality: Quality;
  onHud: (h: HudSnapshot) => void;
  onDocs: (docs: GameDoc[]) => void;
  onChat: (lines: ChatMsg[]) => void;
  onEvent: (kind: string, data?: unknown) => void;
}

interface Remote {
  mesh: Humanoid;
  tag: THREE.Sprite;
  target: THREE.Vector3;
  yaw: number;
  anim: AnimState;
  moving: number;
}

interface RangeTarget {
  mesh: THREE.Mesh;
  stand: THREE.Mesh;
  alive: boolean;
  pos: THREE.Vector3;
}

interface Particle {
  alive: boolean;
  life: number;
  maxLife: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
}

const DIALOG = {
  greet: ['— Документы, пожалуйста.', '— Где вы зарегистрированы?'],
  checking: ['— Минуту… проверяем.', '— Стойте спокойно.'],
  ok: ['— Всё в порядке. Можете идти.', '— Свободны. Не задерживайтесь на улице.'],
  bad: ['— Этого недостаточно.', '— Без действительных документов — пройдёмте в машину.'],
  forged: ['— Что это за… Печать не та.', '— Подделка. В машину. Сейчас же.'],
  block: ['— Стоять. Проверка не окончена.', '— Ещё шаг — и поедете с нами.'],
  grab: ['— Держи его!', '— В машину его!'],
};

const RIDE_SUBS = [
  '— …база, это 0417, везём одного. Приём.',
  '— Сиди тихо. Приедем — разберутся.',
  'Двигатель гудит. Город плывёт за окном.',
  '— …понял, к северным воротам. Конец связи.',
  'Машина сворачивает. Впереди — КПП учебного центра.',
];

const CONVOY_SUBS = [
  'Колонна идёт на север. Долина Крежны — 40 км.',
  '— Не высовываться. Держим дистанцию.',
  'Блокпост. Проверка. Шлагбаум поднимается…',
  'Дальше — разбитые посёлки. Приготовиться.',
];

export class Game {
  private mount: HTMLElement;
  private opts: GameOptions;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private lastNow = 0;
  private raf = 0;
  private world = new World();
  private zone: ZoneData | null = null;
  private audio = new AudioEngine();
  net = new NetClient();
  private chatLines: ChatMsg[] = [];

  // player
  private player!: Humanoid;
  private playerKind: 'civilian' | 'soldier' = 'civilian';
  private pos = new THREE.Vector3();
  private vy = 0;
  private grounded = true;
  private camYaw = Math.PI;
  private camPitch = -0.18;
  private camDist = 4.4;
  private keys = new Set<string>();
  private health = 100;
  private stamina = 100;
  private crouch = false;
  private armed = false;
  private aiming = false;
  private ammo = 0;
  private reserve = 0;
  private reloading = 0;
  private lastHurt = -99;
  private lastShot = -99;
  private bloom = 0;
  private dead = false;
  private deadT = 0;
  private carrying = false;
  private vaultT = 0;
  private anim: AnimState = 'idle';
  private moveSpeed = 0;

  // chapters / flow
  private chapter: ChapterId = 'city';
  private paused = false;
  private quality: Quality;
  private time = 0;
  private docs: GameDoc[] = [];
  private selDoc = 0;
  private encounter: EncounterStage = 'none';
  private dialogLines: string[] = [];
  private dialogOptions: string[] = [];
  private leaveAttempts = 0;
  private struggle = 0;
  private struggleT = 0;
  private heat = 0;
  private cityT = 0;
  private survivedT = 0;
  private surviveNeed = 90;
  private surviveActive = false;
  private stationDone = false;
  private detained = false;
  private victory = false;
  private fade: 'none' | 'out' | 'in' = 'none';
  private fadeT = 0;
  private fadeNext: (() => void) | null = null;
  private rideT = 0;
  private rideSub = 0;
  private objective: Objective = { title: '', detail: '' };
  private message: string | null = null;
  private messageT = 0;
  private prompt: string | null = null;
  private hurtT = -99;
  private shake = 0;
  private stats: PlayerStats = { ...DEFAULT_STATS };
  private kills = 0;
  private shotsFired = 0;
  private shotsHit = 0;

  // city actors
  private van: VanAI | null = null;
  private officers: Humanoid[] = [];
  private officerState: 'invan' | 'exiting' | 'approach' | 'dialog' | 'escort' | 'return' | 'stagger' = 'invan';
  private officerT = 0;
  private driver: Humanoid | null = null;
  private civilians: Civilian[] = [];
  private gunshotCity = false;
  private footPatrols: FootPatrol[] = [];
  private lastShownDoc: GameDoc | null = null;
  private summonsT = 0;
  private warnedChase = false;
  private dismountLostT = 0;
  private lastMx = 0;
  private lastMz = 0;
  private tmpLead = new THREE.Vector3();
  private hornCd = 0;
  private officePos = new THREE.Vector3(-60, 0, 84);

  // training
  private instructor: Humanoid | null = null;
  private exIdx = 0;
  private exT = 0;
  private exCp = 0;
  private exFail = 0;
  private rangeTargets: RangeTarget[] = [];
  private hasRifle = false;

  // frontline
  private mission = 0;
  private defendT = 0;
  private hostiles: Hostile[] = [];
  private wavesSpawned = 0;
  private cratePos = new THREE.Vector3(-20, 0, -52);
  private crateTaken = false;
  private evacPos = new THREE.Vector3(10, 0, 150);
  private ambientT = 5;

  // fx
  private particles!: THREE.Points;
  private pGeo!: THREE.BufferGeometry;
  private pData: Particle[] = [];
  private pCount = 500;
  private pCursor = 0;
  private muzzleLight!: THREE.PointLight;
  private muzzleSprite!: THREE.Sprite;
  private muzzleT = 99;
  private tracers: THREE.Mesh[] = [];
  private tracerT: number[] = [];
  private flashes: Array<{ light: THREE.PointLight; sprite: THREE.Sprite; t: number }> = [];
  private sun!: THREE.DirectionalLight;
  private hemi!: THREE.HemisphereLight;
  private fps = 60;

  private remotes = new Map<string, Remote>();
  private hudT = 0;
  private disposed = false;

  constructor(mount: HTMLElement, opts: GameOptions) {
    this.mount = mount;
    this.opts = opts;
    this.quality = opts.quality;
    const saved = loadSave();
    if (saved) this.stats = { ...DEFAULT_STATS, ...saved.stats };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.mount.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);
    this.camera.rotation.order = 'YXZ';

    this.sun = new THREE.DirectionalLight('#ffe8c4', 2.2);
    this.sun.position.set(-60, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -90;
    this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90;
    this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.camera.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.hemi = new THREE.HemisphereLight('#cfd8e8', '#3a382f', 0.9);
    this.scene.add(this.sun, this.hemi, this.sun.target);

    this.initParticles();
    this.muzzleLight = new THREE.PointLight('#ffca6a', 0, 18, 1.8);
    this.scene.add(this.muzzleLight);
    this.muzzleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: '#ffcf7a', transparent: true, opacity: 0, depthWrite: false }));
    this.muzzleSprite.scale.set(1.4, 1.4, 1);
    this.scene.add(this.muzzleSprite);
    const tracerGeo = new THREE.BoxGeometry(0.06, 0.06, 1);
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0 }));
      m.visible = false;
      this.scene.add(m);
      this.tracers.push(m);
      this.tracerT.push(99);
    }

    this.applyQuality(opts.quality);
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.addEventListener('click', this.onCanvasClick);

    this.net.on({
      onStatus: () => undefined,
      onChat: (m) => this.pushChat(m),
      onRemoteEvent: (from, kind, data) => this.onRemoteEvent(from, kind, data),
    });
    this.net.connect(opts.name, 'civilian');

    this.buildPlayer('civilian');
    this.loadChapter('city');
    this.loop();
  }

  // ================================================================ setup
  private initParticles(): void {
    this.pGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(this.pCount * 3);
    const colors = new Float32Array(this.pCount * 3);
    const sizes = new Float32Array(this.pCount);
    for (let i = 0; i < this.pCount; i++) {
      this.pData.push({ alive: false, life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 1 });
      positions[i * 3 + 1] = -999;
    }
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.pGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.pGeo.setAttribute('psize', new THREE.BufferAttribute(sizes, 1));
    const mat = new THREE.PointsMaterial({
      size: 0.35,
      map: softDotTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(this.pGeo, mat);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  spawnParticles(x: number, y: number, z: number, n: number, color: string, speed: number, life: number, up = 2): void {
    const budget = QUALITY_PRESETS[this.quality].particles;
    n = Math.max(1, Math.floor(n * budget));
    const c = new THREE.Color(color);
    const posA = this.pGeo.attributes.position as THREE.BufferAttribute;
    const colA = this.pGeo.attributes.color as THREE.BufferAttribute;
    for (let k = 0; k < n; k++) {
      const i = this.pCursor;
      this.pCursor = (this.pCursor + 1) % this.pCount;
      const p = this.pData[i];
      p.alive = true;
      p.life = 0;
      p.maxLife = life * (0.6 + Math.random() * 0.8);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = Math.random() * up + 0.5;
      p.size = 1;
      posA.setXYZ(i, x, y, z);
      colA.setXYZ(i, c.r, c.g, c.b);
    }
    posA.needsUpdate = true;
    colA.needsUpdate = true;
  }

  private updateParticles(dt: number): void {
    const posA = this.pGeo.attributes.position as THREE.BufferAttribute;
    let dirty = false;
    for (let i = 0; i < this.pCount; i++) {
      const p = this.pData[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) {
        p.alive = false;
        posA.setY(i, -999);
        dirty = true;
        continue;
      }
      p.vy -= 6 * dt;
      posA.setXYZ(i, posA.getX(i) + p.vx * dt, Math.max(0.05, posA.getY(i) + p.vy * dt), posA.getZ(i) + p.vz * dt);
      dirty = true;
    }
    if (dirty) posA.needsUpdate = true;
  }

  private fireTracer(a: THREE.Vector3, b: THREE.Vector3): void {
    let bi = 0;
    for (let i = 0; i < this.tracers.length; i++) {
      if (this.tracerT[i] > 0.12) {
        bi = i;
        break;
      }
    }
    const m = this.tracers[bi];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    m.position.copy(mid);
    m.lookAt(b);
    m.scale.set(1, 1, a.distanceTo(b));
    (m.material as THREE.MeshBasicMaterial).opacity = 0.9;
    m.visible = true;
    this.tracerT[bi] = 0;
  }

  private explosionFx(p: THREE.Vector3, big: boolean): void {
    this.spawnParticles(p.x, p.y + 0.5, p.z, big ? 40 : 16, '#ff9a3a', big ? 9 : 5, big ? 1.4 : 0.8, 6);
    this.spawnParticles(p.x, p.y + 1, p.z, big ? 20 : 8, '#2a2a26', 3, big ? 2.2 : 1.2, 4);
    const light = new THREE.PointLight('#ff9a4a', big ? 120 : 40, big ? 40 : 20, 1.8);
    light.position.copy(p).add(new THREE.Vector3(0, 2, 0));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDotTexture(), color: '#ffcf8a', transparent: true, opacity: 1, depthWrite: false }));
    sprite.position.copy(light.position);
    sprite.scale.set(big ? 8 : 4, big ? 8 : 4, 1);
    this.scene.add(light, sprite);
    this.flashes.push({ light, sprite, t: 0 });
    this.audio.explosion(this.pos.distanceTo(p));
    this.shake = Math.min(1, this.shake + (big ? 0.5 : 0.2));
  }

  private buildPlayer(kind: 'civilian' | 'soldier'): void {
    if (this.player) this.scene.remove(this.player.group);
    this.playerKind = kind;
    this.player = makeHumanoid(kind === 'soldier' ? 'soldier' : 'civilian', 7, this.armed);
    this.scene.add(this.player.group);
  }

  private setArmed(armed: boolean): void {
    if (this.armed === armed) return;
    this.armed = armed;
    this.buildPlayer(this.playerKind);
  }

  // ================================================================ chapters
  private clearActors(): void {
    for (const c of this.civilians) c.dispose(this.scene);
    this.civilians = [];
    for (const fp of this.footPatrols) fp.dispose(this.scene);
    this.footPatrols = [];
    for (const h of this.hostiles) h.dispose(this.scene);
    this.hostiles = [];
    for (const o of this.officers) this.scene.remove(o.group);
    this.officers = [];
    if (this.driver) {
      this.scene.remove(this.driver.group);
      this.driver = null;
    }
    if (this.instructor) {
      this.scene.remove(this.instructor.group);
      this.instructor = null;
    }
    for (const t of this.rangeTargets) {
      this.scene.remove(t.mesh, t.stand);
    }
    this.rangeTargets = [];
    if (this.van) {
      this.van.dispose(this.scene);
      this.van = null;
    }
  }

  private loadChapter(ch: ChapterId): void {
    // minibus ride reuses the live city scene (van, officers, pedestrians)
    if (ch !== 'minibus') this.clearActors();
    this.chapter = ch;
    this.audio.setChapterAmbience(ch);
    this.net.setLocal({ x: this.pos.x, y: this.pos.y, z: this.pos.z, ry: this.camYaw, anim: this.anim, speed: 0, chapter: ch, health: this.health });

    if (ch === 'city') {
      this.scene.background = new THREE.Color('#9aa3b5');
      this.scene.fog = new THREE.FogExp2('#9aa3b5', 0.0075);
      this.sun.color.set('#ffd9a8');
      this.sun.intensity = 2.0;
      this.hemi.intensity = 0.85;
      this.zone = this.world.load(this.scene, 'city');
      this.pos.copy(this.zone.spawn);
      this.camYaw = this.zone.spawnYaw;
      this.buildPlayer('civilian');
      this.setArmed(false);
      // van + officers + driver
      this.van = new VanAI(this.zone.route, this.zone.hotspots, this.scene);
      this.van.events.onHorn = () => this.audio.horn();
      this.van.events.onDismount = () => {
        this.officerState = 'exiting';
        this.officerT = 0;
        this.showMessage('Патрульные идут к вам…', 2.5);
      };
      this.van.events.onDoorsOpened = () => {
        this.audio.doorVan();
        this.officerState = 'exiting';
        this.officerT = 0;
      };
      this.van.events.onCheckReady = () => this.beginDialog();
      this.van.events.onChaseStart = () => {
        this.showMessage('Погоня! Отрывайтесь от патруля!', 3);
        this.audio.whistle();
        this.audio.shout();
      };
      this.van.events.onGiveUp = () => {
        this.showMessage('Патруль отстал. Затаитесь.', 3);
        this.encounter = 'none';
        this.officerState = 'return';
      };
      this.van.events.onArrived = () => undefined;
      for (let i = 0; i < 2; i++) {
        const o = makeHumanoid('officer', 20 + i, false);
        o.group.visible = false;
        this.scene.add(o.group);
        this.officers.push(o);
      }
      this.driver = makeHumanoid('officer', 99, false);
      this.scene.add(this.driver.group);
      // civilians
      for (let i = 0; i < 9; i++) {
        const loop = this.zone.walkLoops[(i * 5 + 2) % this.zone.walkLoops.length];
        this.civilians.push(new Civilian(loop, 10 + i * 7, this.scene));
      }
      // queue at the market + crowd at the bus stop
      const queueSpots = [
        new THREE.Vector3(6.4, 0, -34),
        new THREE.Vector3(6.4, 0, -32.6),
        new THREE.Vector3(6.4, 0, -31.2),
        new THREE.Vector3(7.6, 0, -22.4),
        new THREE.Vector3(9.4, 0, -22.6),
      ];
      queueSpots.forEach((q, qi) => {
        const zq = this.zone;
        if (!zq) return;
        const loop = zq.walkLoops[(qi * 3 + 1) % zq.walkLoops.length];
        this.civilians.push(new Civilian(loop, 200 + qi * 13, this.scene, q));
      });
      // foot patrol teams between hotspots
      {
        const zf = this.zone;
        if (zf) {
          const hw = zf.hotspots.length > 0 ? zf.hotspots : zf.route;
          for (let f = 0; f < 2; f++) {
            const fp = new FootPatrol(hw, f * 2 + 1, this.scene);
            fp.events.onAlarm = () => {
              if (!this.van || this.detained) return;
              if (this.van.state === 'patrol' || this.van.state === 'notice' || this.van.state === 'stakeout') {
                this.van.suspicion = 1;
                this.audio.whistle();
                this.showMessage('Пеший патруль заметил вас!', 2.5);
              }
            };
            fp.events.onSpotted = () => {
              if (!this.van || this.detained || this.encounter === 'dialog' || this.encounter === 'struggle') return;
              this.audio.shout();
              this.showMessage('— Стояти! Документи!', 2.5);
              if (this.van.state === 'patrol' || this.van.state === 'notice' || this.van.state === 'stakeout') {
                this.van.suspicion = 1;
              }
            };
            fp.events.onRadio = () => this.audio.radioBlip();
            this.footPatrols.push(fp);
          }
        }
      }
      this.objective = { title: 'Найдите документы', detail: 'Осмотрите район: дворы, гаражи, машины. [E] — взять', progress: `0/${this.zone.pickups.length}` };
    } else if (ch === 'minibus') {
      // keep city visuals (ride through the city)
      this.ensureRideCast();
      this.detained = true;
      this.encounter = 'detained';
      this.rideT = 0;
      this.rideSub = 0;
      this.dialogLines = [RIDE_SUBS[0]];
      this.objective = { title: 'Вас везут…', detail: 'Учебный центр «Северный»', progress: '' };
      this.van?.startTransport();
      this.officerState = 'invan';
    } else if (ch === 'training') {
      this.scene.background = new THREE.Color('#a8bfd4');
      this.scene.fog = new THREE.FogExp2('#a8bfd4', 0.006);
      this.sun.color.set('#fff2dc');
      this.sun.intensity = 2.4;
      this.hemi.intensity = 1.0;
      this.zone = this.world.load(this.scene, 'training');
      this.pos.copy(this.zone.spawn);
      this.camYaw = this.zone.spawnYaw;
      this.buildPlayer('soldier');
      this.setArmed(false);
      this.detained = false;
      this.encounter = 'none';
      this.instructor = makeHumanoid('instructor', 300, false);
      this.scene.add(this.instructor.group);
      this.exIdx = 0;
      this.exCp = 0;
      this.exT = 0;
      this.setupExercise();
      this.showMessage('Учебный центр «Северный». Слушайте инструктора.', 4);
    } else if (ch === 'transport') {
      this.scene.background = new THREE.Color('#8a94a8');
      this.scene.fog = new THREE.FogExp2('#8a94a8', 0.008);
      this.zone = this.world.load(this.scene, 'transport');
      this.rideT = 0;
      this.rideSub = 0;
      this.dialogLines = [CONVOY_SUBS[0]];
      this.objective = { title: 'Колонна на север', detail: 'Долина Крежны', progress: '' };
      this.pos.set(0, 0, 10);
    } else {
      this.scene.background = new THREE.Color('#7d8894');
      this.scene.fog = new THREE.FogExp2('#7d8894', 0.009);
      this.sun.color.set('#d8dce4');
      this.sun.intensity = 1.6;
      this.hemi.intensity = 0.9;
      this.zone = this.world.load(this.scene, 'frontline');
      this.pos.copy(this.zone.spawn);
      const gy = this.zone.groundY(this.pos.x, this.pos.z);
      this.pos.y = gy;
      this.camYaw = Math.PI;
      this.buildPlayer('soldier');
      this.setArmed(true);
      this.ammo = 30;
      this.reserve = 90;
      this.health = 100;
      this.dead = false;
      this.mission = 0;
      this.crateTaken = false;
      this.carrying = false;
      this.setupMission();
      this.showMessage('Долина Крежны. Держитесь команды.', 4);
    }
  }

  /** Safety: the minibus chapter must always have a van + officers. */
  private ensureRideCast(): void {
    if (!this.zone) return;
    if (!this.van) {
      this.van = new VanAI(this.zone.route, this.zone.hotspots, this.scene);
      this.van.pos.copy(this.pos);
    }
    while (this.officers.length < 2) {
      const o = makeHumanoid('officer', 20 + this.officers.length, false);
      this.scene.add(o.group);
      this.officers.push(o);
    }
    if (!this.driver) {
      this.driver = makeHumanoid('officer', 99, false);
      this.scene.add(this.driver.group);
    }
  }

  private fadeTo(next: () => void): void {
    if (this.fade !== 'none') return; // never restart an in-flight transition (stuck black screen)
    this.fade = 'out';
    this.fadeT = 0;
    this.fadeNext = next;
  }

  // ================================================================ city flow
  private beginDialog(): void {
    if (this.chapter !== 'city' || this.detained || this.encounter === 'dialog' || this.encounter === 'struggle') return;
    this.encounter = 'dialog';
    // officers keep their current state (exiting -> approach); UI shows at once
    this.dialogLines = [...DIALOG.greet];
    this.leaveAttempts = 0;
    this.audio.stingSuspicion();
    this.refreshDialogOptions();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private bestDoc(): GameDoc | null {
    const order: DocKind[] = ['exemption', 'civil_id', 'temp_pass', 'medical', 'registration', 'forged', 'incomplete'];
    for (const k of order) {
      const d = this.docs.find((x) => x.kind === k);
      if (d) return d;
    }
    return null;
  }

  private refreshDialogOptions(): void {
    const b = this.bestDoc();
    this.selDoc = b ? this.docs.indexOf(b) : 0;
    this.dialogOptions = [
      b ? `Показать: ${b.title}` : 'Документов нет',
      'Другой документ',
      'Попытаться уйти',
      'Бежать!',
    ];
  }

  chooseDialog(i: number): void {
    if (this.encounter !== 'dialog' || this.dialogOptions.length === 0) return;
    this.audio.uiClick();
    if (i === 0) {
      const d = this.docs[this.selDoc];
      this.lastShownDoc = d ?? null;
      if (!d) {
        this.dialogLines = ['— Нет документов? Тогда проедем с нами.', '— В машину.'];
        this.audio.stingDetained();
        this.dialogOptions = [];
        window.setTimeout(() => this.grabPlayer(), 1400);
        return;
      }
      if (d.valid) {
        this.dialogLines = [...DIALOG.ok];
        this.audio.stingRelease();
        window.setTimeout(() => this.releasePlayer(), 1800);
      } else if (d.kind === 'forged') {
        this.dialogLines = [...DIALOG.checking];
        window.setTimeout(() => {
          if (this.encounter !== 'dialog') return;
          this.dialogLines = [...DIALOG.forged];
          this.audio.stingDetained();
          window.setTimeout(() => this.grabPlayer(), 1600);
        }, 2200);
      } else if (d.kind === 'summons') {
        this.dialogLines = ['— Это повестка, а не документы.', '— Раз она у тебя — поедешь с нами.'];
        this.audio.stingDetained();
        this.dialogOptions = [];
        window.setTimeout(() => this.grabPlayer(), 1600);
      } else {
        this.dialogLines = [...DIALOG.bad];
        this.audio.stingDetained();
        window.setTimeout(() => this.grabPlayer(), 1800);
      }
      this.dialogOptions = [];
    } else if (i === 1) {
      if (this.docs.length === 0) {
        this.dialogLines = ['— Нет документов? Тогда проедем с нами.'];
        return;
      }
      this.selDoc = (this.selDoc + 1) % this.docs.length;
      const d = this.docs[this.selDoc];
      this.dialogOptions[0] = `Показать: ${d.title}`;
      this.pushHud();
    } else if (i === 2) {
      this.leaveAttempts++;
      if (this.leaveAttempts >= 2) {
        this.dialogLines = ['— Я сказал — стоять!', '— Держи его!'];
        this.audio.whistle();
        window.setTimeout(() => this.grabPlayer(), 900);
        this.dialogOptions = [];
      } else {
        this.dialogLines = [...DIALOG.block];
      }
    } else if (i === 3) {
      // run!
      this.encounter = 'suspicion';
      this.dialogOptions = [];
      this.dialogLines = [...DIALOG.grab];
      this.audio.whistle();
      this.van?.startChase();
      this.officerState = 'escort';
    }
  }

  private releasePlayer(): void {
    if (this.chapter !== 'city') return;
    this.encounter = 'released';
    this.showMessage('Проверка пройдена. Патруль уходит.', 3);
    this.officerState = 'return';
    this.van?.release();
    this.surviveActive = true;
    const weak = this.lastShownDoc && (this.lastShownDoc.kind === 'medical' || this.lastShownDoc.kind === 'registration');
    if ((weak || Math.random() < 0.3) && this.summonsT <= 0) {
      const sd = makeDoc('summons', Math.floor(Math.random() * 100000));
      this.docs.push(sd);
      this.opts.onDocs([...this.docs]);
      this.summonsT = 150;
      this.audio.radioBlip();
      window.setTimeout(() => this.showMessage('Вам вручили повестку. Явиться на участок!', 4), 2600);
    }
    this.objective = { title: 'Переждите облаву', detail: 'Не попадайтесь патрулю на глаза', progress: `${Math.floor(this.surviveNeed - this.survivedT)}с` };
    window.setTimeout(() => {
      if (this.encounter === 'released') this.encounter = 'none';
    }, 2500);
  }

  private grabPlayer(): void {
    if (this.chapter !== 'city' || this.detained) return;
    // officers lunge: start struggle QTE
    this.encounter = 'struggle';
    this.struggle = 0.25;
    this.struggleT = 6;
    this.officerState = 'escort';
    this.audio.stingDetained();
    this.shake = 0.7;
  }

  private detainPlayer(): void {
    if (this.detained) return;
    this.detained = true;
    this.showMessage('Вас задержали.', 3);
    this.fadeTo(() => this.loadChapter('minibus'));
  }

  private escapeGrab(): void {
    this.encounter = 'suspicion';
    this.officerState = 'stagger';
    this.officerT = 0;
    this.heat++;
    this.showMessage('Вы вырвались! Бегите!', 3);
    this.van?.startChase();
  }

  // ================================================================ training
  private setupExercise(): void {
    if (!this.zone || !this.instructor) return;
    this.world.hideBeacons();
    this.exCp = 0;
    this.exT = 0;
    this.exFail = 0;
    const z = this.zone;
    if (this.exIdx === 0) {
      this.objective = { title: 'Упражнение 1: бег', detail: 'Пройдите 6 контрольных точек по кругу за 75 сек', progress: '0/6' };
      const p = z.route[0];
      this.world.setBeaconVisible(0, 'cp', p.x, 1, p.z, true);
      this.instructor.group.position.set(z.route[0].x + 3, 0, z.route[0].z + 3);
    } else if (this.exIdx === 1) {
      this.objective = { title: 'Упражнение 2: полоса препятствий', detail: 'Vault: [Space] у стенки • Низкая планка: [C] • Канат: держать [E]', progress: '0/4' };
      this.world.setBeaconVisible(0, 'ob', -24, 1, -62, true);
      this.instructor.group.position.set(-28, 0, -58);
    } else if (this.exIdx === 2) {
      this.objective = { title: 'Упражнение 3: стрельба', detail: 'Возьмите винтовку на столе [E], поразите 8 мишеней', progress: '0/8' };
      this.world.setBeaconVisible(0, 'gun', -14, 1, -78, true);
      this.instructor.group.position.set(-14, 0, -74);
      this.spawnRangeTargets(8);
    } else {
      this.objective = { title: 'Финальная оценка', detail: '3 точки + 5 мишеней за 120 сек. Винтовка с собой', progress: '' };
      this.setArmed(true);
      this.ammo = 30;
      this.reserve = 120;
      this.world.setBeaconVisible(0, 'ev', z.route[1].x, 1, z.route[1].z, true);
      this.instructor.group.position.set(0, 0, 40);
      this.spawnRangeTargets(5);
    }
  }

  private spawnRangeTargets(n: number): void {
    if (!this.zone) return;
    for (const t of this.rangeTargets) this.scene.remove(t.mesh, t.stand);
    this.rangeTargets = [];
    const tex = targetFaceTexture();
    for (let i = 0; i < n; i++) {
      const x = -21 + i * (42 / Math.max(1, n - 1));
      const z = -95 - (i % 3) * 7;
      const stand = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.6, 0.15), new THREE.MeshStandardMaterial({ color: '#5c4a30' }));
      stand.position.set(x, 0.8, z);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(1.1, 1.4),
        new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }),
      );
      mesh.position.set(x, 1.9, z);
      mesh.userData.rangeTarget = true;
      this.scene.add(stand, mesh);
      this.rangeTargets.push({ mesh, stand, alive: true, pos: new THREE.Vector3(x, 1.9, z) });
    }
  }

  private updateTraining(dt: number): void {
    if (!this.zone) return;
    const z = this.zone;
    this.exT += dt;
    if (this.exIdx === 0) {
      // running: touch checkpoints in order
      const p = z.route[this.exCp];
      if (this.pos.distanceTo(p) < 3) {
        this.exCp++;
        this.audio.checkpoint();
        this.spawnParticles(p.x, 1, p.z, 8, '#9fe07a', 2, 0.6);
        if (this.exCp >= z.route.length) {
          this.stats.endurance = Math.min(100, this.stats.endurance + 18);
          this.stats.stamina = Math.min(100, this.stats.stamina + 14);
          this.nextExercise('Бег сдан! Выносливость повышена.');
          return;
        }
        const np = z.route[this.exCp];
        this.world.setBeaconVisible(0, 'cp', np.x, 1, np.z, true);
      }
      this.objective.progress = `${this.exCp}/${z.route.length} • ${Math.max(0, Math.ceil(75 - this.exT))}с`;
      if (this.exT > 75) {
        this.exFail++;
        this.exT = 0;
        this.exCp = 0;
        const fp = z.route[0];
        this.world.setBeaconVisible(0, 'cp', fp.x, 1, fp.z, true);
        this.showMessage('Норматив провален. Ещё раз!', 3);
      }
    } else if (this.exIdx === 1) {
      const gates = [
        { x: -24, z: -62, need: 'vault' },
        { x: -8, z: -62, need: 'crouch' },
        { x: 8, z: -62, need: 'pass' },
        { x: 24, z: -62, need: 'climb' },
      ];
      const g = gates[this.exCp];
      const d = Math.hypot(this.pos.x - g.x, this.pos.z - g.z);
      if (g.need === 'vault') {
        if (d < 2.2 && this.vaultT > 0) this.passGate();
        else if (d < 2.2) this.prompt = '[Space] — перелезть';
      } else if (g.need === 'crouch') {
        if (d < 2 && this.pos.z < -62 && this.crouch) this.passGate();
        else if (d < 4) this.prompt = 'Пригнитесь [C] и пройдите под планкой';
      } else if (g.need === 'pass') {
        if (d < 2) this.passGate();
      } else {
        if (d < 2.4) {
          this.prompt = 'Держите [E] — взобраться';
          if (this.keys.has('KeyE')) {
            this.exFail += dt;
            if (this.exFail > 2) {
              this.exFail = 0;
              this.pos.z -= 3;
              this.audio.vault();
              this.passGate();
            }
          }
        }
      }
      const ng = gates[this.exCp];
      if (ng) this.world.setBeaconVisible(0, 'ob', ng.x, 1, ng.z, true);
      this.objective.progress = `${this.exCp}/4`;
    } else if (this.exIdx === 2) {
      if (!this.hasRifle) {
        const d = Math.hypot(this.pos.x + 14, this.pos.z + 78);
        if (d < 2.6) {
          this.prompt = '[E] — взять винтовку';
          if (this.keys.has('KeyE') && !this.eHeld) {
            this.eHeld = true;
            this.hasRifle = true;
            this.setArmed(true);
            this.ammo = 30;
            this.reserve = 300;
            this.audio.pickup();
            this.world.hideBeacons();
            this.showMessage('Поразите все мишени. ПКМ — прицелиться.', 3);
          }
        }
      } else {
        const left = this.rangeTargets.filter((t) => t.alive).length;
        this.objective.progress = `${this.rangeTargets.length - left}/${this.rangeTargets.length}`;
        if (left === 0) {
          const acc = this.shotsFired > 0 ? this.shotsHit / this.shotsFired : 0;
          this.stats.accuracy = Math.min(100, this.stats.accuracy + 10 + Math.round(acc * 20));
          this.stats.handling = Math.min(100, this.stats.handling + 12);
          this.shotsFired = 0;
          this.shotsHit = 0;
          this.nextExercise('Стрельба сдана! Меткость повышена.');
        }
      }
    } else {
      // eval: 3 run points then targets
      const pts = [z.route[1], z.route[3], z.route[5]];
      if (this.exCp < 3) {
        const p = pts[this.exCp];
        this.world.setBeaconVisible(0, 'ev', p.x, 1, p.z, true);
        if (this.pos.distanceTo(p) < 3) {
          this.exCp++;
          this.audio.checkpoint();
        }
        this.objective.progress = `точки ${this.exCp}/3 • ${Math.max(0, Math.ceil(120 - this.exT))}с`;
      } else {
        this.world.hideBeacons();
        const left = this.rangeTargets.filter((t) => t.alive).length;
        this.objective.progress = `мишени ${this.rangeTargets.length - left}/${this.rangeTargets.length} • ${Math.max(0, Math.ceil(120 - this.exT))}с`;
        if (left === 0) {
          this.stats.reaction = Math.min(100, this.stats.reaction + 15);
          this.stats.movement = Math.min(100, this.stats.movement + 12);
          storeSave({ stats: this.stats, chapter: 'transport', docsFound: this.docs.length, bestEval: Math.round(this.exT) });
          this.showMessage('Оценка сдана! Получите снаряжение.', 3);
          this.audio.missionOk();
          this.fadeTo(() => this.loadChapter('transport'));
          return;
        }
      }
      if (this.exT > 120) {
        this.exT = 0;
        this.exCp = 0;
        this.spawnRangeTargets(5);
        this.showMessage('Время вышло. Ещё раз!', 3);
      }
    }
    // instructor faces player
    if (this.instructor) {
      this.instructor.group.rotation.y = Math.atan2(this.pos.x - this.instructor.group.position.x, this.pos.z - this.instructor.group.position.z);
      this.instructor.setPose('guard', this.time, 0);
    }
  }

  private passGate(): void {
    this.exCp++;
    this.audio.checkpoint();
    this.stats.movement = Math.min(100, this.stats.movement + 4);
    if (this.exCp >= 4) {
      this.stats.movement = Math.min(100, this.stats.movement + 8);
      this.nextExercise('Полоса пройдена!');
    }
  }

  private nextExercise(msg: string): void {
    this.showMessage(msg, 3);
    this.audio.missionOk();
    this.exIdx++;
    this.setupExercise();
  }

  // ================================================================ frontline
  private setupMission(): void {
    if (!this.zone) return;
    this.world.hideBeacons();
    const z = this.zone;
    if (this.mission === 0) {
      this.objective = { title: 'Миссия 1: передовой пост', detail: 'Двигайтесь к посту. Осторожно — противник в посёлке', progress: '' };
      this.world.setBeaconVisible(0, 'post', 0, z.groundY(0, 120), 120, true);
      this.spawnHostiles(2);
    } else if (this.mission === 1) {
      this.objective = { title: 'Миссия 2: припасы', detail: 'Найдите ящик в посёлке [E], отнесите на пост', progress: '' };
      this.world.setBeaconVisible(0, 'crate', this.cratePos.x, z.groundY(this.cratePos.x, this.cratePos.z), this.cratePos.z, true);
      this.spawnHostiles(2);
    } else if (this.mission === 2) {
      this.objective = { title: 'Миссия 3: оборона', detail: 'Удерживайте пост 90 секунд', progress: '90с' };
      this.defendT = 90;
      this.wavesSpawned = 0;
      this.world.setBeaconVisible(0, 'post', 0, z.groundY(0, 120), 120, true);
    } else {
      this.objective = { title: 'Эвакуация', detail: 'Отходите к точке эвакуации', progress: '' };
      this.world.setBeaconVisible(0, 'evac', this.evacPos.x, z.groundY(this.evacPos.x, this.evacPos.z), this.evacPos.z, true);
    }
    this.net.sendEvent('objective', { title: this.objective.title, detail: this.objective.detail });
  }

  private spawnHostiles(n: number): void {
    if (!this.zone || !this.zone.enemySpawns.length) return;
    for (let i = 0; i < n; i++) {
      const s = this.zone.enemySpawns[Math.floor(Math.random() * this.zone.enemySpawns.length)];
      const h = new Hostile(new THREE.Vector3(s.x + (Math.random() - 0.5) * 10, 0, s.z + (Math.random() - 0.5) * 10), Math.floor(Math.random() * 1000), this.scene);
      h.pos.y = this.zone.groundY(h.pos.x, h.pos.z);
      this.hostiles.push(h);
    }
  }

  private updateFrontline(dt: number): void {
    if (!this.zone) return;
    const z = this.zone;
    // ambient distant battle
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 6 + Math.random() * 10;
      const ax = (Math.random() - 0.5) * 300;
      const az = -80 - Math.random() * 100;
      this.explosionFx(new THREE.Vector3(ax, z.groundY(ax, az), az), true);
    }
    // hostiles
    for (let i = this.hostiles.length - 1; i >= 0; i--) {
      const h = this.hostiles[i];
      h.update(dt, this.time, this.pos, this.crouch, this.dead, z.colliders, z.coverPoints, {
        onShoot: (from, target, hit) => {
          this.audio.gunshot(from.distanceTo(this.pos), true);
          this.fireTracer(from, hit ? target : target.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)));
          this.spawnParticles(from.x, from.y, from.z, 3, '#ffcf7a', 2, 0.2, 1);
          if (hit && !this.dead) this.damagePlayer(7 + Math.random() * 6);
        },
      });
      h.pos.y = z.groundY(h.pos.x, h.pos.z);
      if (h.dead && h.stateT > 20) {
        h.dispose(this.scene);
        this.hostiles.splice(i, 1);
      }
    }

    if (this.dead) {
      this.deadT += dt;
      if (this.deadT > 3) this.respawn();
      return;
    }

    if (this.mission === 0) {
      if (Math.hypot(this.pos.x - 0, this.pos.z - 120) < 6) {
        this.mission = 1;
        this.audio.missionOk();
        this.showMessage('Пост достигнут. Новая задача.', 3);
        this.setupMission();
      }
    } else if (this.mission === 1) {
      if (!this.crateTaken) {
        const d = Math.hypot(this.pos.x - this.cratePos.x, this.pos.z - this.cratePos.z);
        if (d < 3) {
          this.prompt = '[E] — взять ящик с припасами';
          if (this.keys.has('KeyE') && !this.eHeld) {
            this.eHeld = true;
            this.crateTaken = true;
            this.carrying = true;
            this.setArmed(false);
            this.audio.pickup();
            this.world.setBeaconVisible(0, 'post', 0, z.groundY(0, 120), 120, true);
            this.objective.detail = 'Отнесите ящик на пост';
          }
        }
      } else if (Math.hypot(this.pos.x - 0, this.pos.z - 120) < 6) {
        this.carrying = false;
        this.setArmed(true);
        this.reserve = 120;
        this.mission = 2;
        this.audio.missionOk();
        this.showMessage('Припасы доставлены. Приготовиться к обороне!', 3);
        this.setupMission();
      }
    } else if (this.mission === 2) {
      this.defendT -= dt;
      this.objective.progress = `${Math.max(0, Math.ceil(this.defendT))}с • противник: ${this.hostiles.filter((h) => !h.dead).length}`;
      const want = this.defendT > 60 ? 3 : this.defendT > 30 ? 4 : 5;
      const alive = this.hostiles.filter((h) => !h.dead).length;
      if (alive < want && this.wavesSpawned < 12) {
        this.spawnHostiles(1);
        this.wavesSpawned++;
      }
      if (this.defendT <= 0) {
        this.mission = 3;
        this.audio.missionOk();
        this.showMessage('Пост удержан! Отходите.', 3);
        this.setupMission();
      }
    } else {
      if (Math.hypot(this.pos.x - this.evacPos.x, this.pos.z - this.evacPos.z) < 6) {
        this.victory = true;
        storeSave({ stats: this.stats, chapter: 'frontline', docsFound: this.docs.length, bestEval: 0 });
        this.audio.missionOk();
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
    // resupply at post
    if (Math.hypot(this.pos.x, this.pos.z - 120) < 5 && this.reserve < 60 && this.armed) {
      this.prompt = '[E] — пополнить боеприпасы';
      if (this.keys.has('KeyE') && !this.eHeld) {
        this.eHeld = true;
        this.reserve = 120;
        this.audio.reload();
      }
    }
  }

  private damagePlayer(amount: number): void {
    if (this.dead || this.chapter !== 'frontline') return;
    this.health -= amount;
    this.lastHurt = this.time;
    this.hurtT = this.time;
    this.shake = Math.min(1, this.shake + 0.25);
    this.audio.hurt();
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deadT = 0;
      this.showMessage('Вы ранены. Эвакуация к посту…', 3);
    }
  }

  private respawn(): void {
    if (!this.zone) return;
    this.dead = false;
    this.health = 100;
    this.pos.set(10, 0, this.mission >= 1 ? 126 : 150);
    this.pos.y = this.zone.groundY(this.pos.x, this.pos.z);
    this.ammo = 30;
    this.reserve = Math.max(this.reserve, 60);
    if (this.mission === 2) this.defendT = Math.max(25, this.defendT);
  }

  // ================================================================ input
  private eHeld = false;
  private onKeyDown = (e: KeyboardEvent): void => {
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
    if (e.code === 'Tab') e.preventDefault();
    this.keys.add(e.code);
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (this.encounter === 'dialog') return;
      this.paused = !this.paused;
      this.opts.onEvent('pause', this.paused);
    }
    if (this.encounter === 'dialog') {
      if (e.code === 'Digit1') this.chooseDialog(0);
      if (e.code === 'Digit2') this.chooseDialog(1);
      if (e.code === 'Digit3') this.chooseDialog(2);
      if (e.code === 'Digit4') this.chooseDialog(3);
    }
    if (e.code === 'KeyE' && this.encounter === 'struggle') {
      this.struggle = Math.min(1, this.struggle + 0.09);
    }
  };
  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    const tgt = e.target as HTMLElement | null;
    const typing = !!tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA');
    if (e.code === 'KeyE') this.eHeld = false;
    if (e.code === 'KeyC' && !typing && this.chapter !== 'minibus' && this.chapter !== 'transport') this.crouch = !this.crouch;
  };
  private onMouseDown = (e: MouseEvent): void => {
    this.audio.resume();
    if (e.button === 0) {
      if (this.encounter === 'struggle') this.struggle = Math.min(1, this.struggle + 0.06);
      else if (this.armed && document.pointerLockElement) this.tryShoot();
    }
    if (e.button === 2) this.aiming = true;
  };
  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 2) this.aiming = false;
  };
  private onMouseMove = (e: MouseEvent): void => {
    if (this.paused) return;
    if (document.pointerLockElement === this.renderer.domElement) {
      this.camYaw -= e.movementX * 0.0024;
      this.camPitch -= e.movementY * 0.0022;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch, -1.1, 0.7);
    } else if (e.buttons === 1 && this.encounter !== 'dialog') {
      this.camYaw -= e.movementX * 0.004;
      this.camPitch = THREE.MathUtils.clamp(this.camPitch - e.movementY * 0.003, -1.1, 0.7);
    }
  };
  private onCanvasClick = (): void => {
    this.audio.resume();
    if (this.encounter === 'dialog' || this.paused || this.victory) return;
    if (document.pointerLockElement !== this.renderer.domElement) {
      try {
        const r = this.renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined;
        if (r && typeof r.catch === 'function') r.catch(() => undefined);
      } catch {
        /* ignore */
      }
    }
  };

  private resize = (): void => {
    const w = this.mount.clientWidth || 1;
    const h = this.mount.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  applyQuality(q: Quality): void {
    this.quality = q;
    const p = QUALITY_PRESETS[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, p.pixelRatio));
    this.renderer.shadowMap.enabled = p.shadows;
    this.sun.castShadow = p.shadows;
    const sm = p.shadowMap;
    if (this.sun.shadow.mapSize.x !== sm) {
      this.sun.shadow.mapSize.set(sm, sm);
      if (this.sun.shadow.map) {
        this.sun.shadow.map.dispose();
        this.sun.shadow.map = null;
      }
    }
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m instanceof THREE.Mesh) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mm of mats) mm.needsUpdate = true;
      }
    });
  }

  setPaused(p: boolean): void {
    this.paused = p;
  }

  setMuted(m: boolean): void {
    this.audio.setMuted(m);
  }

  sendChat(text: string): void {
    this.net.sendChat(text);
  }

  private pushChat(m: ChatMsg): void {
    this.chatLines.push(m);
    if (this.chatLines.length > 40) this.chatLines.shift();
    this.opts.onChat([...this.chatLines]);
  }

  private onRemoteEvent(_from: string, kind: string, data: unknown): void {
    if (kind === 'objective' && !this.net.isHost && data && typeof data === 'object') {
      const d = data as { title?: string; detail?: string };
      if (d.title) {
        // show host objective as shared team task (display only)
        this.objective = { title: `(Команда) ${d.title}`, detail: d.detail ?? '', progress: this.objective.progress };
      }
    }
  }

  private showMessage(text: string, dur = 2.5): void {
    this.message = text;
    this.messageT = dur;
  }

  // ================================================================ combat
  private raycaster = new THREE.Raycaster();
  private tryShoot(): void {
    if (!this.armed || this.reloading > 0 || this.dead || this.carrying) return;
    if (this.chapter !== 'training' && this.chapter !== 'frontline') return;
    if (this.time - this.lastShot < 0.13) return;
    if (this.ammo <= 0) {
      this.audio.uiClick();
      this.startReload();
      return;
    }
    this.lastShot = this.time;
    this.ammo--;
    this.shotsFired++;
    if (this.chapter === 'frontline' || (this.chapter === 'training' && this.hasRifle)) {
      // shots counted for accuracy only on range
    }
    this.audio.gunshot(0, false);
    this.bloom = Math.min(1, this.bloom + (this.aiming ? 0.08 : 0.22));
    this.camPitch += 0.011 + Math.random() * 0.008;
    this.shake = Math.min(1, this.shake + 0.06);

    // muzzle fx
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const muz = this.pos.clone().add(new THREE.Vector3(0, 1.5, 0)).addScaledVector(fwd, 0.9);
    this.muzzleLight.position.copy(muz);
    this.muzzleLight.intensity = 26;
    this.muzzleSprite.position.copy(muz);
    (this.muzzleSprite.material as THREE.SpriteMaterial).opacity = 1;
    this.muzzleT = 0;
    this.spawnParticles(muz.x, muz.y, muz.z, 3, '#ffcf7a', 3, 0.15, 1);

    // direction with spread
    const spread = (this.aiming ? 0.006 : 0.03) + this.bloom * 0.03 + (this.moveSpeed > 1 ? 0.02 : 0);
    const dir = fwd.clone();
    dir.x += (Math.random() - 0.5) * spread * 2;
    dir.y += (Math.random() - 0.5) * spread * 2;
    dir.z += (Math.random() - 0.5) * spread * 2;
    dir.normalize();
    this.raycaster.set(this.camera.position, dir);
    this.raycaster.far = 160;

    // gather hittables
    const targets: THREE.Object3D[] = [];
    if (this.chapter === 'training') {
      for (const t of this.rangeTargets) if (t.alive) targets.push(t.mesh);
    } else {
      for (const h of this.hostiles) {
        if (!h.dead) {
          h.humanoid.group.traverse((o) => {
            if (o instanceof THREE.Mesh) {
              o.userData.hostile = h;
              targets.push(o);
            }
          });
        }
      }
    }
    const hits = this.raycaster.intersectObjects(targets, false);
    let end: THREE.Vector3;
    if (hits.length > 0) {
      const h = hits[0];
      end = h.point.clone();
      this.shotsHit++;
      const hostile = (h.object.userData.hostile as Hostile | undefined) ?? null;
      if (hostile) {
        const killed = hostile.damage(34 + Math.random() * 12);
        this.spawnParticles(end.x, end.y, end.z, 6, '#7a1a1a', 3, 0.5);
        if (killed) {
          this.kills++;
          this.showMessage(`Противник уничтожен (${this.kills})`, 1.6);
          this.net.sendEvent('kill', { kills: this.kills });
        }
      } else {
        // range target
        const rt = this.rangeTargets.find((t) => t.mesh === h.object);
        if (rt && rt.alive) {
          rt.alive = false;
          rt.mesh.rotation.x = -Math.PI / 2.3;
          this.audio.checkpoint();
          this.spawnParticles(end.x, end.y, end.z, 6, '#d8d2bc', 2, 0.5);
        }
      }
    } else {
      end = this.camera.position.clone().addScaledVector(dir, 120);
      // impact dust if hits ground
      if (dir.y < -0.05) {
        const t = (this.camera.position.y - 0.2) / -dir.y;
        if (t < 120) {
          const gp = this.camera.position.clone().addScaledVector(dir, t);
          this.spawnParticles(gp.x, gp.y + 0.2, gp.z, 4, '#8a8070', 2, 0.5);
          end = gp;
        }
      }
    }
    this.fireTracer(muz, end);
    if (this.ammo === 0) this.startReload();
  }

  private startReload(): void {
    if (this.reloading > 0 || this.reserve <= 0 || this.ammo >= 30) return;
    this.reloading = 2.1 - this.stats.handling * 0.008;
    this.audio.reload();
  }

  // ================================================================ interact (city)
  private eCityInteract(): void {
    if (!this.zone || this.eHeld) return;
    // pickups
    for (const p of this.zone.pickups) {
      if (p.taken) continue;
      if (Math.hypot(this.pos.x - p.pos.x, this.pos.z - p.pos.z) < 2.2) {
        this.eHeld = true;
        p.taken = true;
        p.group.visible = false;
        const seed = Math.floor(Math.random() * 100000);
        const doc = makeDoc(p.docKind, seed);
        this.docs.push(doc);
        this.opts.onDocs([...this.docs]);
        this.audio.pickup();
        this.showMessage(`Найдено: ${doc.title}`, 2.5);
        this.objective.progress = `${this.docs.length}/${this.zone.pickups.length}`;
        if (this.docs.length >= 1 && this.objective.title === 'Найдите документы') {
          this.objective = { title: 'Патруль в районе', detail: 'Не бегайте рядом с микроавтобусом. Документы: [Tab]', progress: `${this.docs.length} док.` };
        }
        return;
      }
    }
    // report to the office with a summons (they were waiting)
    if (this.summonsT > 0 && !this.eHeld) {
      const o = this.officePos;
      if (Math.hypot(this.pos.x - o.x, this.pos.z - o.z) < 3.5) {
        this.eHeld = true;
        this.summonsT = 0;
        this.world.setBeaconVisible(1, 'office', 0, -50, 0, false);
        this.showMessage('На участке вас уже ждали…', 3);
        this.audio.stingDetained();
        this.detainPlayer();
        return;
      }
    }
    // bus station final event
    if (this.surviveActive && this.survivedTDone() && !this.stationDone) {
      const d = Math.hypot(this.pos.x - 8.5, this.pos.z + 24);
      if (d < 3) {
        this.eHeld = true;
        this.stationDone = true;
        this.scriptedFinalCheck();
      }
    }
  }

  private scriptedFinalCheck(): void {
    // patrol was waiting: force encounter near station
    this.showMessage('Патруль уже здесь…', 2.5);
    if (this.van) {
      this.van.pos.set(14, 0, -10);
      this.van.state = 'slow';
      this.van.suspicion = 1;
    }
    this.objective = { title: 'Облава на остановке', detail: 'Патруль требует проверки', progress: '' };
    this.audio.stingSuspicion();
  }

  // ================================================================ per-frame
  private loop = (): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const nowMs = performance.now();
    const dt = this.lastNow > 0 ? Math.min((nowMs - this.lastNow) / 1000, 0.05) : 0.016;
    this.lastNow = nowMs;
    this.time += dt;
    if (!this.paused && !this.victory) this.update(dt);
    this.updateFx(dt);
    this.renderer.render(this.scene, this.camera);
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
    this.hudT += dt;
    if (this.hudT > 0.12) {
      this.hudT = 0;
      this.pushHud();
    }
    // net local state
    this.net.setLocal({
      x: this.pos.x,
      y: this.pos.y,
      z: this.pos.z,
      ry: this.camYaw,
      anim: this.anim,
      speed: this.moveSpeed,
      chapter: this.chapter,
      health: this.health,
    });
    this.updateRemotes(dt);
  };

  private update(dt: number): void {
    if (!this.zone) return;
    const z = this.zone;
    this.messageT = Math.max(0, this.messageT - dt);
    if (this.messageT <= 0) this.message = null;
    this.prompt = null;
    this.bloom = Math.max(0, this.bloom - dt * 1.4);
    this.muzzleT += dt;
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        const need = 30 - this.ammo;
        const take = Math.min(need, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
    // health regen
    if (this.time - this.lastHurt > 6 && this.health < 100 && !this.dead) {
      this.health = Math.min(100, this.health + dt * 8);
    }

    // fade sequencing
    if (this.fade === 'out') {
      this.fadeT += dt;
      if (this.fadeT > 0.9) {
        this.fade = 'in';
        this.fadeT = 0;
        try {
          this.fadeNext?.();
        } catch (err) {
          console.error('[grey] chapter transition failed', err);
          this.fade = 'none';
        }
        this.fadeNext = null;
      }
    } else if (this.fade === 'in') {
      this.fadeT += dt;
      if (this.fadeT > 0.9) {
        this.fade = 'none';
      }
    }

    if (this.chapter === 'city') this.updateCity(dt, z);
    else if (this.chapter === 'minibus') this.updateMinibus(dt, z);
    else if (this.chapter === 'training') {
      this.updatePlayer(dt, z, true);
      this.updateTraining(dt);
    } else if (this.chapter === 'transport') this.updateTransport(dt);
    else {
      this.updatePlayer(dt, z, true);
      this.updateFrontline(dt);
    }

    // camera
    this.updateCamera(dt, z);
    // van audio
    if (this.van && (this.chapter === 'city' || this.chapter === 'minibus')) {
      const d = this.chapter === 'minibus' ? 3 : this.pos.distanceTo(this.van.pos);
      this.audio.updateEngine(this.van.rpm01, d, true);
    } else {
      this.audio.updateEngine(0, 999, false);
    }
    // sun follows the player so shadows stay crisp across the map
    this.sun.position.set(this.pos.x - 60, 90, this.pos.z + 40);
    this.sun.target.position.set(this.pos.x, 0, this.pos.z);
    this.sun.target.updateMatrixWorld();
    z.update(dt, this.time);
    this.updateParticles(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
  }

  private updateFx(dt: number): void {
    if (this.muzzleT < 0.06) {
      this.muzzleLight.intensity = 26;
    } else {
      this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 400);
      (this.muzzleSprite.material as THREE.SpriteMaterial).opacity = Math.max(0, (this.muzzleSprite.material as THREE.SpriteMaterial).opacity - dt * 14);
    }
    for (let i = 0; i < this.tracers.length; i++) {
      this.tracerT[i] += dt;
      if (this.tracerT[i] > 0.1) this.tracers[i].visible = false;
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t += dt;
      f.light.intensity = Math.max(0, f.light.intensity - dt * 220);
      (f.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, 1 - f.t * 2);
      f.sprite.scale.multiplyScalar(1 + dt * 2);
      if (f.t > 1) {
        this.scene.remove(f.light, f.sprite);
        this.flashes.splice(i, 1);
      }
    }
  }

  // ---------------- player movement ----------------
  private updatePlayer(dt: number, z: ZoneData, canShoot: boolean): void {
    void canShoot;
    if (this.dead) {
      this.anim = 'down';
      this.player.setPose('down', 0, 0);
      this.player.group.position.copy(this.pos);
      return;
    }
    const locked = this.encounter === 'dialog' || this.encounter === 'struggle' || this.encounter === 'detained';
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const wantSprint = this.keys.has('ShiftLeft') && fwd > 0 && !this.crouch && this.stamina > 1;
    const speedMul = 1 + this.stats.movement * 0.004;
    let speed = this.crouch ? 1.7 : wantSprint ? 6.4 * speedMul : 3.6 * speedMul;
    if (this.aiming) speed *= 0.55;
    if (this.carrying) speed *= 0.62;
    if (locked) speed = 0;

    // stamina
    if (wantSprint && (fwd !== 0 || strafe !== 0)) this.stamina = Math.max(0, this.stamina - dt * 13);
    else this.stamina = Math.min(100, this.stamina + dt * (9 + this.stats.stamina * 0.08));

    const sin = Math.sin(this.camYaw);
    const cos = Math.cos(this.camYaw);
    let mx = 0;
    let mz = 0;
    if (!locked) {
      mx = strafe * cos - fwd * sin;
      mz = -fwd * cos - strafe * sin;
      const l = Math.hypot(mx, mz);
      if (l > 0.01) {
        mx = (mx / l) * speed;
        mz = (mz / l) * speed;
      }
    }
    this.moveSpeed = THREE.MathUtils.lerp(this.moveSpeed, Math.hypot(mx, mz), 1 - Math.exp(-dt * 8));
    if (Math.hypot(mx, mz) > 0.5) {
      this.lastMx = mx;
      this.lastMz = mz;
    }
    this.pos.x += mx * dt;
    this.pos.z += mz * dt;
    // vault action
    if (this.vaultT > 0) {
      this.vaultT -= dt;
      this.pos.y += dt * 2.2;
      if (this.vaultT <= 0.4) {
        // move forward over obstacle
        this.pos.x += -Math.sin(this.camYaw) * dt * 3;
        this.pos.z += -Math.cos(this.camYaw) * dt * 3;
      }
    } else {
      // jump / gravity
      const gy = z.groundY(this.pos.x, this.pos.z);
      if (this.keys.has('Space') && this.grounded && !locked) {
        // vault check (training): low wall ahead?
        if (this.chapter === 'training' && this.exIdx === 1 && this.exCp === 0 && Math.hypot(this.pos.x + 24, this.pos.z + 62) < 3.4) {
          this.vaultT = 0.8;
          this.audio.vault();
          this.pos.z -= 0.5;
        } else {
          this.vy = 4.6;
          this.grounded = false;
        }
      }
      this.vy -= 13 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= gy) {
        this.pos.y = gy;
        this.vy = 0;
        this.grounded = true;
      }
    }
    if (!(this.vaultT > 0.3)) resolveCollision(this.pos, 0.45, z.colliders);
    const B = z.bounds;
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, -B, B);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, -B, B);

    // footsteps
    if (this.moveSpeed > 1 && this.grounded) {
      this.stepT -= dt * this.moveSpeed;
      if (this.stepT <= 0) {
        this.stepT = 2.4;
        this.audio.footstep(this.moveSpeed > 5, this.chapter === 'frontline' ? 'dirt' : 'asphalt');
      }
    }

    // pose
    if (this.encounter === 'struggle') this.anim = 'struggle';
    else if (this.crouch) this.anim = 'crouch';
    else if (this.aiming && this.armed) this.anim = 'aim';
    else if (this.moveSpeed > 5) this.anim = 'run';
    else if (this.moveSpeed > 0.6) this.anim = 'walk';
    else this.anim = 'idle';
    this.player.setPose(this.anim, this.time, Math.min(1, this.moveSpeed / 6));
    this.player.group.position.copy(this.pos);
    if (this.moveSpeed > 0.5) {
      const targetYaw = Math.atan2(mx, mz);
      let dy = targetYaw - this.player.group.rotation.y;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      this.player.group.rotation.y += dy * Math.min(1, dt * 10);
    } else if (this.aiming) {
      this.player.group.rotation.y = this.camYaw + Math.PI;
    }

    // reload key
    if (this.keys.has('KeyR')) this.startReload();

    // city interactions
    if (this.chapter === 'city' && this.keys.has('KeyE') && this.encounter !== 'struggle') this.eCityInteract();
    else if (this.chapter === 'city') this.eHeld = this.eHeld && this.keys.has('KeyE');
  }

  private stepT = 0;

  // ---------------- city ----------------
  private updateCity(dt: number, z: ZoneData): void {
    this.cityT += dt;
    this.updatePlayer(dt, z, false);
    if (!this.van) return;

    const vDist = Math.hypot(this.pos.x - this.van.pos.x, this.pos.z - this.van.pos.z);
    const blocked = losBlocked(this.van.pos.x, this.van.pos.z, this.pos.x, this.pos.z, z.colliders);
    const inCover = nearCover(this.pos.x, this.pos.z, z.colliders);
    const hidden = this.crouch && blocked && (inCover || vDist > 30);
    if (hidden && this.van.state !== 'chase') this.prompt = 'ВЫ СКРЫТЫ';
    const running = this.moveSpeed > 5;
    this.van.aggression = Math.min(2.5, 1 + this.heat * 0.4 + (this.summonsT > 0 ? 0.5 : 0));
    if (this.van.state === 'chase' && this.moveSpeed > 0.5) {
      const ml = Math.hypot(this.lastMx, this.lastMz) || 1;
      this.tmpLead.set(this.pos.x + (this.lastMx / ml) * 4, 0, this.pos.z + (this.lastMz / ml) * 4);
    } else {
      this.tmpLead.copy(this.pos);
    }
    this.van.update(dt, this.time, this.tmpLead, running, hidden, this.detained, z.colliders);
    if (vDist < 2.6 && vDist > 0.01 && !this.detained) {
      const px = (this.pos.x - this.van.pos.x) / vDist;
      const pz = (this.pos.z - this.van.pos.z) / vDist;
      this.pos.x = this.van.pos.x + px * 2.6;
      this.pos.z = this.van.pos.z + pz * 2.6;
      resolveCollision(this.pos, 0.45, z.colliders);
      this.shake = Math.min(1, this.shake + dt * 3);
      this.hornCd -= dt;
      if (this.hornCd <= 0) {
        this.hornCd = 2.5;
        this.audio.horn();
        this.showMessage('Бусик прижал!', 1.6);
      }
    }

    // civilians
    const danger = this.van.state === 'chase' || this.van.state === 'slow' || this.van.state === 'dismount' ? this.van.pos : this.van.state === 'check' ? this.van.pos : null;
    for (const c of this.civilians) c.update(dt, this.time, danger, this.gunshotCity, z.colliders);
    this.gunshotCity = false;
    for (const fp of this.footPatrols) fp.update(dt, this.time, this.pos, running, this.civilians, z.colliders);

    // driver follows van
    if (this.driver) {
      this.driver.group.position.copy(this.van.pos).add(new THREE.Vector3(Math.sin(this.van.yaw + Math.PI / 2) * -0.5, 0.1, Math.cos(this.van.yaw + Math.PI / 2) * -0.5));
      this.driver.group.position.y = 0.35;
      this.driver.group.rotation.y = this.van.yaw;
      this.driver.setPose('sit', this.time, 0);
    }

    this.updateOfficers(dt, z);

    // suspicion HUD + auto-approach dialog trigger fallback
    if (this.van.state === 'notice' || this.van.state === 'slow') {
      this.encounter = this.encounter === 'dialog' || this.encounter === 'struggle' ? this.encounter : 'suspicion';
      if (this.encounter === 'suspicion' && this.van.suspicion > 0.9) {
        this.dialogLines = ['Патруль обратил на вас внимание…'];
      }
    } else if (this.van.state === 'patrol' && this.encounter === 'suspicion' && this.officerState !== 'escort') {
      this.encounter = 'none';
      this.dialogLines = [];
    }

    // dismount: foot officers converge; talk when they reach the player
    if (this.van.state === 'dismount' && !this.detained) {
      if (this.encounter === 'none' || this.encounter === 'suspicion') {
        for (const o of this.officers) {
          if (o.group.visible && o.group.position.distanceTo(this.pos) < 2.4) {
            this.beginDialog();
            this.officerState = 'approach';
            break;
          }
        }
      }
      if (vDist > 45) this.dismountLostT += dt;
      else this.dismountLostT = 0;
      if (this.dismountLostT > 8) {
        this.dismountLostT = 0;
        this.van.recall();
        this.officerState = 'return';
        this.encounter = 'none';
        this.dialogLines = [];
        this.showMessage('Патруль отстал. Затаитесь.', 3);
      }
    } else {
      this.dismountLostT = 0;
    }

    // officers catch player during chase -> struggle
    if ((this.van.state === 'chase' || this.officerState === 'escort') && this.encounter !== 'struggle' && !this.detained) {
      for (const o of this.officers) {
        if (o.group.visible && o.group.position.distanceTo(this.pos) < 1.5 && this.officerState === 'escort') {
          this.grabPlayer();
          break;
        }
      }
    }

    // a passerby warns you once per chase
    if (this.van.state === 'chase' && !this.warnedChase) {
      this.warnedChase = true;
      let bw = 324;
      for (const c of this.civilians) {
        const d = c.pos.distanceToSquared(this.pos);
        if (d < bw) bw = d;
      }
      if (bw < 324) {
        this.showMessage('Прохожий: «Тікай! Бусик!»', 2.5);
        this.audio.shout();
      }
    }
    if (this.van.state !== 'chase') this.warnedChase = false;

    // struggle QTE
    if (this.encounter === 'struggle' && !this.detained) {
      this.struggleT -= dt;
      this.struggle = Math.max(0, this.struggle - dt * 0.22);
      this.shake = Math.min(1, this.shake + dt * 1.5);
      if (this.struggle >= 1) this.escapeGrab();
      else if (this.struggleT <= 0) this.detainPlayer();
    }

    // survive timer after first release
    if (this.surviveActive && !this.survivedTDone() && this.summonsT <= 0) {
      if (this.van.state === 'patrol' || this.van.state === 'leave') {
        this.survivedT += dt;
        const left = Math.max(0, Math.ceil(this.surviveNeed - this.survivedT));
        this.objective = { title: 'Переждите облаву', detail: 'Не попадайтесь патрулю на глаза', progress: `${left}с` };
        if (this.survivedT >= this.surviveNeed && !this.stationDone) {
          this.objective = { title: 'Уходите из района', detail: 'Доберитесь до автобусной остановки [E]', progress: '' };
          this.world.setBeaconVisible(0, 'bus', 8.5, 1, -24, true);
          this.showMessage('Путь свободен. К остановке!', 3);
        }
      }
    }
    // summons countdown
    if (this.summonsT > 0) {
      this.summonsT -= dt;
      const office = this.officePos;
      this.world.setBeaconVisible(1, 'office', office.x, 1, office.z, true);
      this.objective = {
        title: 'Повестка: явиться на участок',
        detail: `Участок ТИД №7 отмечен. Осталось ${Math.max(0, Math.ceil(this.summonsT))}с — или не являйтесь и прячьтесь`,
        progress: `${Math.max(0, Math.ceil(this.summonsT))}с`,
      };
      if (Math.hypot(this.pos.x - office.x, this.pos.z - office.z) < 3.5) {
        this.prompt = '[E] — зайти на участок';
      }
      if (this.summonsT <= 0) {
        this.heat += 2;
        this.world.setBeaconVisible(1, 'office', 0, -50, 0, false);
        this.showMessage('Неявка по повестке. Объявлен розыск!', 4);
        this.audio.siren();
        this.objective = { title: 'Розыск', detail: 'Патрули ищут именно вас. Доберитесь до остановки', progress: '' };
      }
    }
    // pickup prompt
    for (const p of z.pickups) {
      if (!p.taken && Math.hypot(this.pos.x - p.pos.x, this.pos.z - p.pos.z) < 2.2) {
        this.prompt = `[E] — ${p.label}`;
      }
    }
    if (this.survivedTDone() && this.surviveActive && !this.stationDone && Math.hypot(this.pos.x - 8.5, this.pos.z + 24) < 3) {
      this.prompt = '[E] — сесть на автобус';
    }
  }

  private survivedTDone(): boolean {
    return this.survivedT >= this.surviveNeed;
  }

  private tmpV = new THREE.Vector3();

  private updateOfficers(dt: number, z: ZoneData): void {
    if (!this.van) return;
    const door = this.van.doorWorldPos(this.tmpV);
    if (this.officerState === 'invan') {
      for (const o of this.officers) o.group.visible = false;
      return;
    }
    if (this.officerState === 'exiting') {
      this.officerT += dt;
      this.officers.forEach((o, i) => {
        o.group.visible = true;
        const t = Math.min(1, this.officerT * 1.2 - i * 0.35);
        o.group.position.lerpVectors(door, new THREE.Vector3(door.x + 1 + i, 0, door.z + 0.5 - i), Math.max(0, t));
        o.group.rotation.y = Math.atan2(this.pos.x - o.group.position.x, this.pos.z - o.group.position.z);
        o.setPose('walk', this.time + i, 0.7);
      });
      if (this.officerT > 1.8) this.officerState = 'approach';
      return;
    }
    if (this.officerState === 'approach' || this.officerState === 'dialog') {
      // walk to flank player, then guard
      this.officers.forEach((o, i) => {
        o.group.visible = true;
        const side = i === 0 ? 1 : -1;
        const tx = this.pos.x + Math.cos(this.time * 0.2) * 0 + side * 1.8;
        const tz = this.pos.z + 0.6 - i * 1.2;
        const d = Math.hypot(o.group.position.x - tx, o.group.position.z - tz);
        if (d > 1.1) {
          steerToward(o.group.position, this.tmpV.set(tx, 0, tz), 3.4, dt, z.colliders);
          o.setPose('walk', this.time + i, 0.8);
        } else {
          o.setPose('guard', this.time + i, 0);
        }
        o.group.position.y = 0;
        o.group.rotation.y = Math.atan2(this.pos.x - o.group.position.x, this.pos.z - o.group.position.z);
      });
      return;
    }
    if (this.officerState === 'escort') {
      // chase / grab player
      this.officers.forEach((o, i) => {
        const d = Math.hypot(o.group.position.x - this.pos.x, o.group.position.z - this.pos.z);
        if (this.encounter === 'struggle') {
          // hold positions at sides
          const side = i === 0 ? 1 : -1;
          o.group.position.x = THREE.MathUtils.lerp(o.group.position.x, this.pos.x + side * 0.8, dt * 6);
          o.group.position.z = THREE.MathUtils.lerp(o.group.position.z, this.pos.z, dt * 6);
          o.setPose('struggle', this.time + i, 0);
        } else if (d > 1.2) {
          steerToward(o.group.position, this.pos, 6.0, dt, z.colliders);
          o.setPose('run', this.time + i, 1);
        } else {
          o.setPose('guard', this.time + i, 0);
        }
        o.group.position.y = 0;
        o.group.rotation.y = Math.atan2(this.pos.x - o.group.position.x, this.pos.z - o.group.position.z);
      });
      return;
    }
    if (this.officerState === 'stagger') {
      this.officerT += dt;
      for (const o of this.officers) o.setPose('idle', this.time, 0);
      if (this.officerT > 3.5) this.officerState = 'escort';
      return;
    }
    if (this.officerState === 'return') {
      let allIn = true;
      this.officers.forEach((o, i) => {
        void i;
        const d = Math.hypot(o.group.position.x - door.x, o.group.position.z - door.z);
        if (d > 0.8) {
          allIn = false;
          steerToward(o.group.position, door, 3, dt, z.colliders);
          o.setPose('walk', this.time, 0.8);
        } else {
          o.group.visible = false;
        }
      });
      if (allIn) this.officerState = 'invan';
    }
    // separation so the pair never stacks inside each other
    if (this.officers.length >= 2) {
      const a = this.officers[0];
      const b = this.officers[1];
      if (a.group.visible && b.group.visible) {
        const dx = b.group.position.x - a.group.position.x;
        const dz = b.group.position.z - a.group.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 0.9 && d > 0.001) {
          const push = (0.9 - d) * 0.5;
          const nx = dx / d;
          const nz = dz / d;
          a.group.position.x -= nx * push;
          a.group.position.z -= nz * push;
          b.group.position.x += nx * push;
          b.group.position.z += nz * push;
        }
      }
    }
    // officers walk around the van instead of through it (except boarding)
    const ost: string = this.officerState;
    if (this.van && (ost === 'approach' || ost === 'dialog' || ost === 'escort')) {
      for (const o of this.officers) {
        if (!o.group.visible) continue;
        const ox = o.group.position.x - this.van.pos.x;
        const oz = o.group.position.z - this.van.pos.z;
        const od = Math.hypot(ox, oz);
        if (od < 2.3 && od > 0.001) {
          o.group.position.x = this.van.pos.x + (ox / od) * 2.3;
          o.group.position.z = this.van.pos.z + (oz / od) * 2.3;
        }
      }
    }
  }

  // ---------------- minibus ride ----------------
  private updateMinibus(dt: number, z: ZoneData): void {
    if (!this.van) return;
    this.rideT += dt;
    // keep riding route
    this.van.update(dt, this.time, new THREE.Vector3(9999, 0, 9999), false, true, true, z.colliders);
    // seat player + officers inside
    const yaw = this.van.yaw;
    const seat = (lx: number, lz: number): THREE.Vector3 =>
      new THREE.Vector3(lx, 0.55, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(this.van!.pos);
    this.pos.copy(seat(-0.4, -0.9));
    this.player.setPose('sit', this.time, 0);
    this.player.group.position.copy(this.pos);
    this.player.group.rotation.y = yaw + Math.PI / 2;
    this.officers.forEach((o, i) => {
      o.group.visible = true;
      o.group.position.copy(seat(0.45, -0.9 + i * 1.0));
      o.group.rotation.y = yaw - Math.PI / 2;
      o.setPose('sit', this.time + i, 0);
    });
    if (this.driver) {
      this.driver.group.position.copy(seat(-0.5, 1.5));
      this.driver.group.rotation.y = yaw;
      this.driver.setPose('sit', this.time, 0);
    }
    this.anim = 'sit';
    // suspension bumps
    this.shake = Math.max(this.shake, 0.12 + (Math.sin(this.time * 7) > 0.96 ? 0.25 : 0));
    // subtitles
    const subIdx = Math.min(RIDE_SUBS.length - 1, Math.floor(this.rideT / 7));
    if (subIdx !== this.rideSub) {
      this.rideSub = subIdx;
      this.dialogLines = [RIDE_SUBS[subIdx]];
      if (subIdx === 0 || subIdx === 3) this.audio.radioBlip();
    }
    if (this.rideT > 34) {
      this.fadeTo(() => this.loadChapter('training'));
    }
    // interior camera handled in updateCamera
  }

  // ---------------- transport ride ----------------
  private updateTransport(dt: number): void {
    this.rideT += dt;
    this.pos.z = 10 - this.rideT * 14;
    this.pos.y = 1.6;
    this.anim = 'sit';
    this.player.setPose('sit', this.time, 0);
    this.player.group.position.copy(this.pos);
    this.player.group.rotation.y = Math.PI;
    this.shake = Math.max(this.shake, 0.1 + (Math.sin(this.time * 6.3) > 0.97 ? 0.2 : 0));
    const subIdx = Math.min(CONVOY_SUBS.length - 1, Math.floor(this.rideT / 8));
    if (subIdx !== this.rideSub) {
      this.rideSub = subIdx;
      this.dialogLines = [CONVOY_SUBS[subIdx]];
    }
    if (this.rideT > 30) {
      this.fadeTo(() => this.loadChapter('frontline'));
    }
  }

  // ---------------- camera ----------------
  private camPos = new THREE.Vector3();
  private updateCamera(dt: number, z: ZoneData): void {
    const shakeX = (Math.random() - 0.5) * this.shake * 0.3;
    const shakeY = (Math.random() - 0.5) * this.shake * 0.3;

    if (this.chapter === 'minibus' && this.van) {
      // interior view: look forward through windshield + side window
      const yaw = this.van.yaw;
      const eye = new THREE.Vector3(-0.55, 1.35, -1.6).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(this.van.pos);
      this.camera.position.lerp(eye, 1 - Math.exp(-dt * 6));
      const look = new THREE.Vector3(0, 1.15, 4).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(this.van.pos);
      this.camera.lookAt(look);
      this.camera.fov = 58;
      this.camera.updateProjectionMatrix();
      return;
    }
    if (this.chapter === 'transport') {
      // truck bed: look back at road + convoy
      this.camera.position.set(this.pos.x + 1.2, this.pos.y + 1.4, this.pos.z + 3.5);
      this.camera.lookAt(this.pos.x - 1, this.pos.y + 0.6, this.pos.z - 20);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
      return;
    }

    const targetDist = this.aiming && this.armed ? 2.2 : this.crouch ? 3.6 : this.camDist;
    this.camPos.set(
      this.pos.x + Math.sin(this.camYaw) * Math.cos(this.camPitch) * targetDist,
      this.pos.y + 1.7 - Math.sin(this.camPitch) * targetDist,
      this.pos.z + Math.cos(this.camYaw) * Math.cos(this.camPitch) * targetDist,
    );
    // keep camera above ground
    const gy = z.groundY(this.camPos.x, this.camPos.z) + 0.4;
    if (this.camPos.y < gy) this.camPos.y = gy;
    this.camera.position.lerp(this.camPos, 1 - Math.exp(-dt * 14));
    const lookY = this.pos.y + (this.crouch ? 1.0 : 1.5);
    this.camera.lookAt(this.pos.x + shakeX, lookY + shakeY, this.pos.z);
    const wantFov = this.aiming && this.armed ? 42 : 62;
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, wantFov, 1 - Math.exp(-dt * 10));
    this.camera.updateProjectionMatrix();
  }

  // ---------------- remotes ----------------
  private updateRemotes(dt: number): void {
    const seen = new Set<string>();
    for (const [id, s] of this.net.remotes) {
      seen.add(id);
      let r = this.remotes.get(id);
      if (!r) {
        const mesh = makeHumanoid(s.model, id.length * 31 + id.charCodeAt(0), s.chapter === 'frontline');
        const tag = makeNameTag(s.name);
        tag.position.y = 2.2;
        mesh.group.add(tag);
        this.scene.add(mesh.group);
        r = { mesh, tag, target: new THREE.Vector3(s.x, s.y, s.z), yaw: s.ry, anim: s.anim, moving: 0 };
        this.remotes.set(id, r);
      }
      r.target.set(s.x, s.y, s.z);
      r.yaw = s.ry + Math.PI;
      r.anim = s.anim;
      r.moving = THREE.MathUtils.clamp(s.speed / 6, 0, 1);
      const sameChapter = s.chapter === this.chapter || (s.chapter === 'city' && this.chapter === 'minibus');
      r.mesh.group.visible = sameChapter;
      if (sameChapter) {
        r.mesh.group.position.lerp(r.target, 1 - Math.exp(-dt * 10));
        r.mesh.group.rotation.y = r.yaw;
        r.mesh.setPose(r.anim === 'run' || r.anim === 'walk' ? r.anim : r.anim, this.time, r.moving);
      }
    }
    for (const [id, r] of [...this.remotes]) {
      if (!seen.has(id)) {
        this.scene.remove(r.mesh.group);
        this.remotes.delete(id);
      }
    }
  }

  // ---------------- hud ----------------
  private pushHud(): void {
    const dots: MiniDot[] = [];
    dots.push({ x: this.pos.x, z: this.pos.z, kind: 'player' });
    if (this.zone) {
      for (const p of this.zone.pickups) if (!p.taken) dots.push({ x: p.pos.x, z: p.pos.z, kind: 'pickup' });
      for (const b of this.zone.beacons) if (b.visible) dots.push({ x: b.pos.x, z: b.pos.z, kind: 'checkpoint' });
    }
    if (this.van && this.chapter === 'city') dots.push({ x: this.van.pos.x, z: this.van.pos.z, kind: 'van' });
    for (const h of this.hostiles) if (!h.dead) dots.push({ x: h.pos.x, z: h.pos.z, kind: 'enemy' });
    for (const [, r] of this.remotes) {
      if (r.mesh.group.visible) dots.push({ x: r.mesh.group.position.x, z: r.mesh.group.position.z, kind: 'ally' });
    }
    const suspicion = this.van ? this.van.suspicion : 0;
    const online = this.net.status === 'online';
    const hud: HudSnapshot = {
      chapter: this.chapter,
      chapterLabel: CHAPTER_LABELS[this.chapter],
      health: Math.round(this.health),
      stamina: Math.round(this.stamina),
      suspicion,
      encounter: this.encounter,
      dialogLines: [...this.dialogLines],
      docCount: this.docs.length,
      validCount: this.docs.filter((d) => d.valid).length,
      objective: { ...this.objective },
      ammo: this.ammo,
      reserve: this.reserve,
      armed: this.armed,
      fps: Math.round(this.fps),
      ping: this.net.ping,
      players: 1 + this.net.remoteCount(),
      online,
      isHost: this.net.isHost,
      muted: this.audio.isMuted,
      quality: this.quality,
      dots,
      compass: ((THREE.MathUtils.radToDeg(this.camYaw) % 360) + 360) % 360,
      message: this.message,
      messageT: this.messageT,
      struggle: this.struggle,
      detained: this.detained,
      dead: this.dead,
      victory: this.victory,
      stats: { ...this.stats },
      prompt: this.prompt ?? (this.reloading > 0 ? 'Перезарядка…' : null),
      dialogOptions: [...this.dialogOptions],
      hurtT: this.hurtT,
      fade: this.fade,
    };
    this.opts.onHud(hud);
  }

  getDocs(): GameDoc[] {
    return this.docs;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    this.renderer.domElement.removeEventListener('click', this.onCanvasClick);
    this.net.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
