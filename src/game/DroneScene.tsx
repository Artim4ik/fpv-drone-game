import { useEffect, useRef } from "react";
import * as THREE from "three";
import { AudioEngine } from "./audio";
import {
  createFpvState,
  flightHeading,
  HOVER_LEVER,
  stepFpv,
  type FlightMode,
  type FpvControls,
} from "./fpv";
import {
  createTank,
  KILL_POINTS,
  resolveArmorHit,
  tankLabel,
  type TankType,
  type ZoneId,
} from "./tanks";
import {
  makeArmorBumpTexture,
  makeMarkingTexture,
  makeScorchTexture,
  makeSoftParticleTexture,
  makeTerrainTexture,
} from "./textures";

export type Telemetry = {
  altitude: number;
  speed: number;
  heading: number;
  signal: number;
  battery: number;
  range: number | null;
  locked: boolean;
  gamepad: boolean;
  flightMode: FlightMode;
};

export type HitEventKind = "kill" | "hit" | "warn" | "info";

type DroneSceneProps = {
  active: boolean;
  muted: boolean;
  initialAmmo: number;
  onTargetDestroyed: (points: number) => void;
  onBombReleased: () => void;
  onTelemetry: (telemetry: Telemetry) => void;
  onOutOfAmmo: () => void;
  onEvent?: (message: string, kind: HitEventKind, points?: number) => void;
};

type Target = {
  id: number;
  type: TankType;
  label: string;
  group: THREE.Group;
  turret: THREE.Group;
  alive: boolean;
  tracked: boolean;
  gunDead: boolean;
  burning: boolean;
  smokeTimer: number;
  fire: THREE.Sprite[];
};

type Warhead = {
  group: THREE.Group;
  velocity: THREE.Vector3;
  age: number;
  motor: number;
  trailTimer: number;
};

type Puff = {
  sprite: THREE.Sprite;
  drift: THREE.Vector3;
  age: number;
  life: number;
  startOpacity: number;
  growTo: number;
  rise: number;
  startScale: number;
};

type Debris = {
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  life: number;
};

type Blast = { delay: number; position: THREE.Vector3; power: number };

const TERRAIN_SIZE = 520;
const START_POSITION = new THREE.Vector3(0, 18, 62);
const CAM_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, 0));

function terrainHeight(x: number, z: number) {
  return (
    Math.sin(x * 0.045) * 1.7 +
    Math.cos(z * 0.033) * 1.25 +
    Math.sin((x + z) * 0.021) * 1.8 -
    1.1
  );
}

function seededRandom(seed: number) {
  const value = Math.sin(seed * 999.91) * 43758.5453;
  return value - Math.floor(value);
}

function deadzone(value: number, threshold = 0.12) {
  if (Math.abs(value) < threshold) return 0;
  return (value - Math.sign(value) * threshold) / (1 - threshold);
}

function createSky(scene: THREE.Scene) {
  const geometry = new THREE.SphereGeometry(470, 24, 14);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color("#6d8ba6") },
      horizonColor: { value: new THREE.Color("#a8a28f") },
      groundColor: { value: new THREE.Color("#8b8674") },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main() {
        vWorld = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorld;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 groundColor;
      void main() {
        float h = normalize(vWorld).y;
        vec3 sky = mix(horizonColor, topColor, smoothstep(0.02, 0.55, h));
        vec3 color = mix(groundColor, sky, smoothstep(-0.18, 0.02, h));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.renderOrder = -1;
  scene.add(sky);
}

function createTerrain(scene: THREE.Scene) {
  const terrainTexture = makeTerrainTexture();
  const bumpTexture = makeArmorBumpTexture();
  bumpTexture.repeat.set(90, 90);
  bumpTexture.wrapS = THREE.RepeatWrapping;
  bumpTexture.wrapT = THREE.RepeatWrapping;

  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 130, 130);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.attributes.position;
  const colors: number[] = [];
  const low = new THREE.Color("#383c2d");
  const high = new THREE.Color("#77745b");
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const z = positions.getZ(index);
    const y = terrainHeight(x, z);
    positions.setY(index, y);
    color.copy(low).lerp(high, THREE.MathUtils.clamp((y + 4) / 9, 0, 1));
    const noise = seededRandom(index + 13) * 0.08 - 0.04;
    colors.push(color.r + noise, color.g + noise, color.b + noise);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: terrainTexture,
    bumpMap: bumpTexture,
    bumpScale: 0.7,
    roughness: 1,
    metalness: 0,
  });
  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const roadGeometry = new THREE.BufferGeometry();
  const roadVertices: number[] = [];
  const roadIndices: number[] = [];
  const sections = 100;
  for (let index = 0; index <= sections; index += 1) {
    const z = 105 - index * 3.2;
    const centerX = Math.sin(z * 0.018) * 8;
    for (const side of [-1, 1]) {
      const x = centerX + side * 4.6;
      roadVertices.push(x, terrainHeight(x, z) + 0.08, z);
    }
    if (index < sections) {
      const start = index * 2;
      roadIndices.push(start, start + 2, start + 1, start + 1, start + 2, start + 3);
    }
  }
  roadGeometry.setAttribute("position", new THREE.Float32BufferAttribute(roadVertices, 3));
  roadGeometry.setIndex(roadIndices);
  roadGeometry.computeVertexNormals();
  const road = new THREE.Mesh(
    roadGeometry,
    new THREE.MeshStandardMaterial({
      color: "#565447",
      roughness: 1,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  scene.add(road);
}

function addVegetation(scene: THREE.Scene) {
  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.18, 1.4, 5);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#4a3e2d", roughness: 1 });
  const crownGeometry = new THREE.ConeGeometry(0.9, 2.8, 6);
  const crownMaterial = new THREE.MeshStandardMaterial({
    color: "#283426",
    roughness: 1,
    flatShading: true,
  });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, 125);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, 125);
  const transform = new THREE.Object3D();
  for (let index = 0; index < 125; index += 1) {
    let x = seededRandom(index * 3 + 5) * 230 - 115;
    const z = seededRandom(index * 7 + 29) * 310 - 205;
    const roadX = Math.sin(z * 0.018) * 8;
    if (Math.abs(x - roadX) < 12) x += x > roadX ? 14 : -14;
    const y = terrainHeight(x, z);
    const scale = 0.7 + seededRandom(index * 11 + 2) * 0.9;
    transform.position.set(x, y + 0.7 * scale, z);
    transform.scale.setScalar(scale);
    transform.rotation.y = seededRandom(index + 88) * Math.PI;
    transform.updateMatrix();
    trunks.setMatrixAt(index, transform.matrix);
    transform.position.y = y + 2.25 * scale;
    transform.updateMatrix();
    crowns.setMatrixAt(index, transform.matrix);
  }
  scene.add(trunks, crowns);

  const bushGeometry = new THREE.IcosahedronGeometry(0.95, 0);
  bushGeometry.scale(1, 0.55, 1);
  const bushMaterial = new THREE.MeshStandardMaterial({
    color: "#33402b",
    roughness: 1,
    flatShading: true,
  });
  const bushes = new THREE.InstancedMesh(bushGeometry, bushMaterial, 95);
  for (let index = 0; index < 95; index += 1) {
    const x = seededRandom(index * 17 + 61) * 236 - 118;
    const z = seededRandom(index * 23 + 13) * 300 - 210;
    const roadX = Math.sin(z * 0.018) * 8;
    const offset = Math.abs(x - roadX) < 7 ? (x > roadX ? 9 : -9) : 0;
    const scale = 0.55 + seededRandom(index * 5 + 41) * 1.1;
    transform.position.set(x + offset, terrainHeight(x + offset, z) + 0.3 * scale, z);
    transform.scale.setScalar(scale);
    transform.rotation.y = seededRandom(index + 300) * Math.PI;
    transform.updateMatrix();
    bushes.setMatrixAt(index, transform.matrix);
  }
  scene.add(bushes);

  const rockGeometry = new THREE.DodecahedronGeometry(0.55, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: "#6a6a5e",
    roughness: 1,
    flatShading: true,
  });
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 45);
  for (let index = 0; index < 45; index += 1) {
    const x = seededRandom(index * 29 + 7) * 220 - 110;
    const z = seededRandom(index * 31 + 91) * 290 - 205;
    const scale = 0.4 + seededRandom(index + 500) * 1.5;
    transform.position.set(x, terrainHeight(x, z) + 0.2 * scale, z);
    transform.scale.setScalar(scale);
    transform.rotation.set(
      seededRandom(index + 600) * Math.PI,
      seededRandom(index + 700) * Math.PI,
      0,
    );
    transform.updateMatrix();
    rocks.setMatrixAt(index, transform.matrix);
  }
  scene.add(rocks);
}

function addWorldDetails(scene: THREE.Scene) {
  const poleMaterial = new THREE.MeshStandardMaterial({ color: "#36362f", roughness: 1 });
  const poleGeometry = new THREE.CylinderGeometry(0.14, 0.18, 7, 6);
  const crossGeometry = new THREE.BoxGeometry(4.2, 0.16, 0.18);
  for (let index = 0; index < 11; index += 1) {
    const z = 54 - index * 24;
    const x = 25 + Math.sin(z * 0.02) * 4;
    const y = terrainHeight(x, z);
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(x, y + 3.5, z);
    const cross = new THREE.Mesh(crossGeometry, poleMaterial);
    cross.position.set(x, y + 6.3, z);
    scene.add(pole, cross);
  }

  const tentMaterial = new THREE.MeshStandardMaterial({
    color: "#62624d",
    roughness: 1,
    flatShading: true,
  });
  for (const [x, z] of [
    [-22, -40],
    [24, -103],
    [-26, -158],
  ] as Array<[number, number]>) {
    const tent = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 6.5, 3), tentMaterial);
    tent.rotation.z = Math.PI / 2;
    tent.rotation.y = Math.PI / 6;
    tent.position.set(x, terrainHeight(x, z) + 1.6, z);
    scene.add(tent);
  }

  const mountainMaterial = new THREE.MeshStandardMaterial({
    color: "#585a4d",
    roughness: 1,
    flatShading: true,
  });
  for (let index = 0; index < 12; index += 1) {
    const radius = 22 + seededRandom(index + 300) * 28;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(radius, radius * 0.72, 7), mountainMaterial);
    mountain.position.set(-230 + index * 42, -7, -245 - seededRandom(index + 400) * 22);
    mountain.rotation.y = seededRandom(index + 500) * Math.PI;
    scene.add(mountain);
  }
}

function buildWarheadMesh() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: "#414d35",
    metalness: 0.55,
    roughness: 0.42,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: "#191b17",
    metalness: 0.7,
    roughness: 0.38,
  });

  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.5, 12), bodyMaterial);
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -0.45;
  group.add(cone);

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.62, 12), bodyMaterial);
  body.rotation.x = Math.PI / 2;
  body.position.z = -0.08;
  group.add(body);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), darkMaterial);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = 0.35;
  group.add(tail);

  for (let index = 0; index < 4; index += 1) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.24), darkMaterial);
    const angle = (index / 4) * Math.PI * 2;
    fin.position.set(Math.sin(angle) * 0.1, Math.cos(angle) * 0.1, 0.44);
    fin.rotation.z = -angle;
    group.add(fin);
  }
  return group;
}

export default function DroneScene({
  active,
  muted,
  initialAmmo,
  onTargetDestroyed,
  onBombReleased,
  onTelemetry,
  onOutOfAmmo,
  onEvent,
}: DroneSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const mutedRef = useRef(muted);
  const audioRef = useRef<AudioEngine | null>(null);
  const callbacksRef = useRef({ onTargetDestroyed, onBombReleased, onTelemetry, onOutOfAmmo, onEvent });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    mutedRef.current = muted;
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    callbacksRef.current = { onTargetDestroyed, onBombReleased, onTelemetry, onOutOfAmmo, onEvent };
  }, [onBombReleased, onOutOfAmmo, onTargetDestroyed, onTelemetry, onEvent]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#a8a28f");
    scene.fog = new THREE.FogExp2("#9f9a88", 0.0075);

    const camera = new THREE.PerspectiveCamera(79, mount.clientWidth / mount.clientHeight, 0.1, 650);
    camera.position.copy(START_POSITION);
    camera.quaternion.copy(CAM_TILT);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const hemisphere = new THREE.HemisphereLight("#d8d8c8", "#34362d", 2.1);
    const sun = new THREE.DirectionalLight("#fff1cf", 2.5);
    sun.position.set(-70, 110, 45);
    scene.add(hemisphere, sun);

    createSky(scene);
    createTerrain(scene);
    addVegetation(scene);
    addWorldDetails(scene);

    const marking = makeMarkingTexture();
    const coordinates: Array<[number, number]> = [
      [-7, 18],
      [9, -15],
      [-13, -47],
      [7, -78],
      [-4, -108],
      [14, -140],
      [-10, -172],
    ];
    const typeSequence: TankType[] = ["T72B", "T90", "T72B", "T72B", "T90", "T72B", "T90"];
    const targets: Target[] = coordinates.map(([x, z], id) => {
      const type = typeSequence[id % typeSequence.length];
      const tank = createTank(type, id, new THREE.Vector3(x, terrainHeight(x, z), z), marking);
      scene.add(tank.group);
      return {
        id,
        type,
        label: tankLabel(type),
        group: tank.group,
        turret: tank.turret,
        alive: true,
        tracked: false,
        gunDead: false,
        burning: false,
        smokeTimer: 0,
        fire: [],
      };
    });
    const tankGroups = targets.map((target) => target.group);

    const audio = new AudioEngine();
    audio.setMuted(mutedRef.current);
    audio.startContinuous();
    audioRef.current = audio;

    const state = createFpvState(START_POSITION);
    const warheads: Warhead[] = [];
    const puffs: Puff[] = [];
    const debris: Debris[] = [];
    const scheduled: Blast[] = [];
    const scorchMarks: THREE.Mesh[] = [];
    const keys = new Set<string>();
    const raycaster = new THREE.Raycaster();

    const softTexture = makeSoftParticleTexture();
    const fireTexture = makeSoftParticleTexture(0.4);
    const scorchTexture = makeScorchTexture();
    const scorchGeometry = new THREE.PlaneGeometry(1, 1);
    const debrisGeometry = new THREE.BoxGeometry(0.14, 0.14, 0.14);

    let ammo = initialAmmo;
    let boost = false;
    let previousDrop = false;
    let previousLocked = false;
    let modeToggleHeld = false;
    let keyboardThrottle = HOVER_LEVER;
    let fireCooldown = 0;
    let shake = 0;
    let animationFrame = 0;
    let elapsed = 0;
    let telemetryElapsed = 0;
    let lastTime = performance.now();
    let outOfAmmoTimer = 0;
    let missionClosed = false;

    const emit = (message: string, kind: HitEventKind, points?: number) => {
      callbacksRef.current.onEvent?.(message, kind, points);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
        event.preventDefault();
      }
    };
    const onKeyUp = (event: KeyboardEvent) => keys.delete(event.code);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener("resize", resize);

    const spawnPuff = (
      position: THREE.Vector3,
      color: THREE.ColorRepresentation,
      size: number,
      life: number,
      opacity: number,
      growTo: number,
      rise: number,
    ) => {
      if (puffs.length > 320) return;
      const material = new THREE.SpriteMaterial({
        map: softTexture,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.scale.setScalar(size);
      scene.add(sprite);
      puffs.push({
        sprite,
        drift: new THREE.Vector3((Math.random() - 0.5) * 0.7, 0, (Math.random() - 0.5) * 0.7),
        age: 0,
        life,
        startOpacity: opacity,
        growTo,
        rise,
        startScale: size,
      });
    };

    const spawnDebris = (position: THREE.Vector3, power: number) => {
      const count = Math.round(4 + power * 3);
      for (let index = 0; index < count; index += 1) {
        if (debris.length > 60) break;
        const material = new THREE.MeshStandardMaterial({
          color: index % 2 ? "#23241f" : "#3a3128",
          roughness: 0.9,
        });
        const mesh = new THREE.Mesh(debrisGeometry, material);
        mesh.position.copy(position);
        scene.add(mesh);
        debris.push({
          mesh,
          velocity: new THREE.Vector3(
            (Math.random() - 0.5) * 11 * power,
            5 + Math.random() * 9 * power,
            (Math.random() - 0.5) * 11 * power,
          ),
          spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
          age: 0,
          life: 1.1 + Math.random() * 0.9,
        });
      }
    };

    const addScorch = (position: THREE.Vector3, size: number) => {
      const material = new THREE.MeshBasicMaterial({
        map: scorchTexture,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      });
      const mesh = new THREE.Mesh(scorchGeometry, material);
      mesh.position.set(
        position.x,
        terrainHeight(position.x, position.z) + 0.06,
        position.z,
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = Math.random() * Math.PI;
      mesh.scale.setScalar(size);
      scene.add(mesh);
      scorchMarks.push(mesh);
      if (scorchMarks.length > 26) {
        const oldest = scorchMarks.shift();
        if (oldest) {
          scene.remove(oldest);
          (oldest.material as THREE.Material).dispose();
        }
      }
    };

    type ExplosionRecord = {
      core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
      ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
      smoke: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
      light: THREE.PointLight;
      age: number;
      power: number;
    };
    const explosions: ExplosionRecord[] = [];

    const createExplosion = (position: THREE.Vector3, power = 1) => {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(1.15 * power, 12, 8),
        new THREE.MeshBasicMaterial({
          color: "#ffb12b",
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.5 * power, 0.15 * power, 8, 24),
        new THREE.MeshBasicMaterial({
          color: "#ffd27a",
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      const smoke = new THREE.Mesh(
        new THREE.SphereGeometry(1.7 * power, 9, 7),
        new THREE.MeshBasicMaterial({
          color: "#24251f",
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
        }),
      );
      const light = new THREE.PointLight("#ffb347", 0, 36 * power, 2);
      core.position.copy(position).add(new THREE.Vector3(0, 1.0 * power, 0));
      ring.position.copy(core.position);
      ring.rotation.x = Math.PI / 2;
      smoke.position.copy(core.position).add(new THREE.Vector3(0, 1.1 * power, 0));
      light.position.copy(core.position);
      scene.add(core, ring, smoke, light);
      explosions.push({ core, ring, smoke, light, age: 0, power });
      spawnDebris(position, power);
      audio.explosion(camera.position.distanceTo(position));
    };

    const scheduleBlast = (position: THREE.Vector3, power: number, delay: number) => {
      scheduled.push({ delay, position: position.clone(), power });
    };

    const destroyTarget = (target: Target, zoneLabel: string, at: THREE.Vector3) => {
      if (!target.alive) return;
      target.alive = false;
      target.burning = true;
      target.smokeTimer = 0.2;

      target.group.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const original = object.material;
        const list: THREE.Material[] = Array.isArray(original) ? original : [original];
        const burnt: THREE.Material[] = list.map((material) => {
          const clone = material.clone();
          const standard = clone as THREE.MeshStandardMaterial;
          if (standard.color) standard.color.multiplyScalar(0.22);
          if (standard.emissive) standard.emissive.multiplyScalar(0.15);
          if (typeof standard.roughness === "number") standard.roughness = 1;
          return clone;
        });
        list.forEach((material) => material.dispose());
        object.material = Array.isArray(original) ? burnt : burnt[0];
      });

      const fireMaterial = new THREE.SpriteMaterial({
        map: fireTexture,
        color: "#ff8f2e",
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const firePositions: Array<[number, number, number]> = [
        [0.5, 2.7, 1.6],
        [-0.4, 3.0, -0.5],
      ];
      for (const [x, y, z] of firePositions) {
        const flame = new THREE.Sprite(fireMaterial.clone());
        flame.position.set(x, y, z);
        flame.scale.setScalar(1.5);
        flame.userData.baseScale = 1.4 + Math.random() * 0.5;
        flame.userData.targetId = target.id;
        target.group.add(flame);
        target.fire.push(flame);
      }
      fireMaterial.dispose();

      createExplosion(at, 1.45);
      scheduleBlast(target.group.position.clone().add(new THREE.Vector3(0, 2.2, 0)), 1.15, 1.1);
      scheduleBlast(target.group.position.clone().add(new THREE.Vector3(0.6, 2.6, 0.4)), 0.9, 2.4);

      callbacksRef.current.onTargetDestroyed(KILL_POINTS[target.type]);
      emit(`УНИЧТОЖЕН ${target.label} — ${zoneLabel}`, "kill");
    };

    const damageTrack = (target: Target, points: number, message: string) => {
      if (target.tracked) {
        emit(`ХОДОВАЯ УЖЕ ПОДБИТА: ${target.label}`, "info");
        return;
      }
      target.tracked = true;
      emit(message, "hit", points);
    };

    /** Resolves the impact against the armour model. Returns true when an explosion was already created. */
    const handleTankHit = (hit: THREE.Intersection, shotDir: THREE.Vector3) => {
      const targetId = hit.object.userData.targetId as number | undefined;
      const target = targets.find((item) => item.id === targetId);
      if (!target) return false;

      const distance = camera.position.distanceTo(hit.point);
      if (!target.alive) {
        createExplosion(hit.point, 0.9);
        return true;
      }

      const zone = (hit.object.userData.zone ?? "hullSide") as ZoneId;
      const face = hit.face;
      let incidenceCos = 1;
      if (face) {
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        const worldNormal = face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
        incidenceCos = Math.abs(worldNormal.dot(shotDir));
      }

      const resolution = resolveArmorHit(target.type, zone, incidenceCos);

      if (resolution.pen) {
        audio.impact("pen", distance);
        if (resolution.spec.lethal === "kill") {
          destroyTarget(target, resolution.spec.label, hit.point.clone());
          return true;
        }
        if (resolution.spec.lethal === "track") {
          createExplosion(hit.point, 0.55);
          damageTrack(target, 60, `ПОДБИТА ХОДОВАЯ: ${target.label}`);
          return true;
        }
        if (resolution.spec.lethal === "gun") {
          createExplosion(hit.point, 0.5);
          if (target.gunDead) {
            emit(`СТВОЛ УЖЕ ВЫВЕДЕН: ${target.label}`, "info");
          } else {
            target.gunDead = true;
            emit(`СТВОЛ ВЫВЕДЕН ИЗ СТРОЯ: ${target.label}`, "hit", 35);
          }
          return true;
        }
        createExplosion(hit.point, 0.7);
        return true;
      }

      // Armour held: external detonation, sparks and a ricochet scream.
      audio.impact("ricochet", distance);
      createExplosion(hit.point, 0.6);
      emit(
        `БРОНЯ ВЫДЕРЖАЛА: ${target.label} ${resolution.spec.label} (${resolution.effectiveArmor} vs ${resolution.penetration} мм)`,
        "warn",
      );
      return true;
    };

    const fireWarhead = () => {
      if (ammo <= 0 || !activeRef.current || fireCooldown > 0) return;
      ammo -= 1;
      fireCooldown = 0.4;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const group = buildWarheadMesh();
      group.position.copy(camera.position).addScaledVector(direction, 1.6);
      group.quaternion.copy(camera.quaternion);
      scene.add(group);
      const velocity = direction
        .clone()
        .multiplyScalar(55)
        .addScaledVector(state.velocity, 0.5);
      warheads.push({ group, velocity, age: 0, motor: 0.45, trailTimer: 0 });
      shake = Math.max(shake, 0.35);
      callbacksRef.current.onBombReleased();
      audio.launch();
      emit(`ВЫСТРЕЛ ПГ-7В: ОСТАТОК ${ammo}`, "info");
    };

    const detonateWarhead = (index: number) => {
      const warhead = warheads[index];
      scene.remove(warhead.group);
      warhead.group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      warheads.splice(index, 1);
    };

    const splashTracks = (position: THREE.Vector3) => {
      for (const target of targets) {
        if (!target.alive || target.tracked) continue;
        const horizontal = Math.hypot(
          position.x - target.group.position.x,
          position.z - target.group.position.z,
        );
        if (horizontal < 4.2) {
          damageTrack(target, 40, `ОТСКОК ОТ ГРУНТА — ХОДОВАЯ: ${target.label}`);
        }
      }
    };

    const updateWarheads = (delta: number) => {
      if (warheads.length === 0) return;
      scene.updateMatrixWorld();
      for (let index = warheads.length - 1; index >= 0; index -= 1) {
        const warhead = warheads[index];
        warhead.age += delta;
        const previous = warhead.group.position.clone();

        if (warhead.motor > 0) {
          warhead.motor -= delta;
          const direction = warhead.velocity.clone().normalize();
          warhead.velocity.addScaledVector(direction, 170 * delta);
          const speed = warhead.velocity.length();
          if (speed > 130) warhead.velocity.multiplyScalar(130 / speed);
        }
        warhead.velocity.y -= 9.81 * delta;
        const speed = warhead.velocity.length();
        warhead.velocity.multiplyScalar(Math.max(0, 1 - speed * 0.0011 * delta));
        warhead.group.position.addScaledVector(warhead.velocity, delta);
        // Model nose points along -Z, so aim the +Z axis opposite to velocity.
        warhead.group.lookAt(warhead.group.position.clone().sub(warhead.velocity));
        warhead.group.rotateZ(warhead.age * 6);

        // Rocket motor smoke + light flight trail.
        warhead.trailTimer -= delta;
        if (warhead.trailTimer <= 0) {
          const powered = warhead.motor > 0;
          spawnPuff(
            warhead.group.position,
            powered ? 0xd9d4c4 : 0xb8b4a6,
            powered ? 0.55 : 0.34,
            powered ? 0.75 : 0.5,
            powered ? 0.55 : 0.3,
            powered ? 1.9 : 1.1,
            0.35,
          );
          warhead.trailTimer = powered ? 0.03 : 0.09;
        }

        const segment = warhead.group.position.clone().sub(previous);
        const distance = segment.length();
        let impacted = false;
        if (distance > 1e-5) {
          raycaster.set(previous, segment.clone().normalize());
          raycaster.far = distance;
          const hits = raycaster.intersectObjects(tankGroups, true);
          if (hits.length > 0) {
            const handled = handleTankHit(hits[0], segment.clone().normalize());
            if (!handled) createExplosion(hits[0].point, 0.85);
            impacted = true;
          }
        }

        const ground = terrainHeight(warhead.group.position.x, warhead.group.position.z);
        if (!impacted && warhead.group.position.y <= ground + 0.3) {
          warhead.group.position.y = ground + 0.3;
          createExplosion(warhead.group.position, 1.2);
          addScorch(warhead.group.position, 4.6);
          audio.impact("ground", camera.position.distanceTo(warhead.group.position));
          splashTracks(warhead.group.position);
          impacted = true;
        }
        if (!impacted && warhead.age > 7) {
          createExplosion(warhead.group.position, 1.0);
          impacted = true;
        }
        if (impacted) detonateWarhead(index);
      }
    };

    const updateExplosions = (delta: number) => {
      for (let index = explosions.length - 1; index >= 0; index -= 1) {
        const explosion = explosions[index];
        explosion.age += delta;
        const age = explosion.age;
        explosion.core.scale.setScalar(1 + age * 4.6);
        explosion.ring.scale.setScalar(1 + age * 6.4);
        explosion.smoke.scale.setScalar(1 + age * 2.5);
        explosion.smoke.position.y += delta * 2.3;
        explosion.core.material.opacity = Math.max(0, 1 - age * 2.6);
        explosion.ring.material.opacity = Math.max(0, 0.9 - age * 1.9);
        explosion.smoke.material.opacity = Math.max(0, 0.6 - age * 0.3);
        explosion.light.intensity = Math.max(0, 130 * explosion.power * (1 - age * 2.6));
        if (age > 2.1) {
          scene.remove(explosion.core, explosion.ring, explosion.smoke, explosion.light);
          explosion.core.geometry.dispose();
          explosion.core.material.dispose();
          explosion.ring.geometry.dispose();
          explosion.ring.material.dispose();
          explosion.smoke.geometry.dispose();
          explosion.smoke.material.dispose();
          explosions.splice(index, 1);
        }
      }
    };

    const updatePuffs = (delta: number) => {
      for (let index = puffs.length - 1; index >= 0; index -= 1) {
        const puff = puffs[index];
        puff.age += delta;
        const ratio = puff.age / puff.life;
        if (ratio >= 1) {
          scene.remove(puff.sprite);
          puff.sprite.material.dispose();
          puffs.splice(index, 1);
          continue;
        }
        puff.sprite.position.addScaledVector(puff.drift, delta);
        puff.sprite.position.y += puff.rise * delta;
        puff.sprite.scale.setScalar(
          THREE.MathUtils.lerp(puff.startScale, puff.growTo, ratio),
        );
        puff.sprite.material.opacity = puff.startOpacity * (1 - ratio * ratio);
      }
    };

    const updateDebris = (delta: number) => {
      for (let index = debris.length - 1; index >= 0; index -= 1) {
        const piece = debris[index];
        piece.age += delta;
        if (piece.age >= piece.life) {
          scene.remove(piece.mesh);
          piece.mesh.material.dispose();
          debris.splice(index, 1);
          continue;
        }
        piece.velocity.y -= 14 * delta;
        piece.mesh.position.addScaledVector(piece.velocity, delta);
        piece.mesh.rotation.x += piece.spin.x * delta;
        piece.mesh.rotation.y += piece.spin.y * delta;
        const ground = terrainHeight(piece.mesh.position.x, piece.mesh.position.z);
        if (piece.mesh.position.y < ground + 0.1) {
          piece.mesh.position.y = ground + 0.1;
          piece.velocity.multiplyScalar(0.3);
          piece.velocity.y = Math.abs(piece.velocity.y) * 0.35;
        }
      }
    };

    const updateScheduled = (delta: number) => {
      for (let index = scheduled.length - 1; index >= 0; index -= 1) {
        const blast = scheduled[index];
        blast.delay -= delta;
        if (blast.delay <= 0) {
          createExplosion(blast.position, blast.power);
          scheduled.splice(index, 1);
        }
      }
    };

    const updateWrecks = (delta: number) => {
      for (const target of targets) {
        if (target.burning) {
          target.smokeTimer -= delta;
          if (target.smokeTimer <= 0) {
            target.smokeTimer = 0.24;
            const jitter = new THREE.Vector3(
              (Math.random() - 0.5) * 1.6,
              0,
              (Math.random() - 0.5) * 1.6,
            );
            const base = target.group.position.clone().add(jitter);
            spawnPuff(
              base.add(new THREE.Vector3(0, 3 + Math.random() * 0.8, 0)),
              0x2b2c27,
              1.5,
              4.4,
              0.42,
              5.5,
              1.1,
            );
          }
          for (const flame of target.fire) {
            const base = (flame.userData.baseScale as number) ?? 1.4;
            flame.scale.setScalar(base * (0.8 + Math.random() * 0.5));
            flame.material.opacity = 0.55 + Math.random() * 0.4;
          }
        }
        if (!target.alive) continue;
        // The turret slowly slews towards the drone when it gets close.
        const dx = camera.position.x - target.group.position.x;
        const dz = camera.position.z - target.group.position.z;
        const horizontal = Math.hypot(dx, dz);
        if (horizontal < 95) {
          const worldYaw = Math.atan2(-dx, -dz);
          const desired = worldYaw - target.group.rotation.y;
          const deltaAngle =
            (((desired - target.turret.rotation.y + Math.PI) % (Math.PI * 2)) + Math.PI * 2) %
              (Math.PI * 2) -
            Math.PI;
          const maxStep = 0.55 * delta;
          target.turret.rotation.y += THREE.MathUtils.clamp(deltaAngle, -maxStep, maxStep);
        }
      }
    };

    const readControls = (delta: number) => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(gamepads).find((pad) => pad?.connected) ?? null;
      let yawInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      let rollInput = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
      let pitchInput = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      boost = keys.has("KeyE");
      let drop = keys.has("Space");

      const keyboardUp = keys.has("ShiftLeft") || keys.has("ShiftRight");
      const keyboardDown = keys.has("ControlLeft") || keys.has("ControlRight");
      // The keyboard throttle is a lever that slews, like a real mode-2 stick.
      if (keyboardUp) keyboardThrottle = Math.min(1, keyboardThrottle + 0.75 * delta);
      if (keyboardDown) keyboardThrottle = Math.max(0, keyboardThrottle - 0.75 * delta);
      let throttle = keyboardThrottle;

      if (gamepad) {
        yawInput += deadzone(gamepad.axes[0] ?? 0);
        rollInput += deadzone(gamepad.axes[2] ?? 0);
        pitchInput += -deadzone(gamepad.axes[3] ?? 0);
        throttle = (1 - deadzone(gamepad.axes[1] ?? 0, 0.08)) / 2;
        boost ||= Boolean(gamepad.buttons[0]?.pressed);
        drop ||= Boolean(gamepad.buttons[7]?.pressed) || (gamepad.buttons[7]?.value ?? 0) > 0.55;
        if (keyboardUp) throttle = Math.min(1, throttle + 0.2);
        if (keyboardDown) throttle = Math.max(0, throttle - 0.2);
      }

      return {
        controls: {
          yaw: THREE.MathUtils.clamp(yawInput, -1, 1),
          roll: THREE.MathUtils.clamp(rollInput, -1, 1),
          pitch: THREE.MathUtils.clamp(pitchInput, -1, 1),
          throttle,
          boost,
        } satisfies FpvControls,
        drop,
        gamepad: Boolean(gamepad),
      };
    };

    const updateTelemetry = (gamepadConnected: boolean) => {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      let closestRange: number | null = null;
      let smallestAngle = Number.POSITIVE_INFINITY;
      for (const target of targets) {
        if (!target.alive) continue;
        const toTarget = target.group.position.clone().sub(camera.position);
        const distance = toTarget.length();
        const angle = forward.angleTo(toTarget.normalize());
        if (angle < smallestAngle && forward.dot(toTarget) > 0) {
          smallestAngle = angle;
          closestRange = distance;
        }
      }
      const ground = terrainHeight(camera.position.x, camera.position.z);
      const homeDistance = Math.hypot(
        camera.position.x - START_POSITION.x,
        camera.position.z - START_POSITION.z,
      );
      const locked = smallestAngle < 0.115 && closestRange !== null;
      if (locked && !previousLocked) audio.beep();
      previousLocked = locked;

      callbacksRef.current.onTelemetry({
        altitude: Math.max(0, camera.position.y - ground),
        speed: state.velocity.length() * 3.6,
        heading: flightHeading(state),
        signal: THREE.MathUtils.clamp(100 - homeDistance * 0.16, 42, 100),
        battery: THREE.MathUtils.clamp(100 - elapsed * 0.21 - (boost ? 3 : 0), 0, 100),
        range: closestRange,
        locked,
        gamepad: gamepadConnected,
        flightMode: state.mode,
      });
    };

    const animate = (now: number) => {
      animationFrame = window.requestAnimationFrame(animate);
      const delta = Math.min((now - lastTime) / 1000, 0.04);
      lastTime = now;
      const { controls: rawControls, drop, gamepad } = readControls(delta);
      const controls: FpvControls = { ...rawControls };

      if (activeRef.current) {
        elapsed += delta;

        if (keys.has("KeyC") && !modeToggleHeld) {
          state.mode = state.mode === "ANGLE" ? "ACRO" : "ANGLE";
          emit(`РЕЖИМ ПОЛЁТА: ${state.mode}`, "info");
        }
        modeToggleHeld = keys.has("KeyC");

        const ground = terrainHeight(state.position.x, state.position.z);
        const result = stepFpv(state, controls, delta, ground, elapsed);
        state.position.x = THREE.MathUtils.clamp(state.position.x, -122, 122);
        state.position.z = THREE.MathUtils.clamp(state.position.z, -218, 88);

        if (result.groundImpact > 5.5) {
          shake = Math.max(shake, Math.min(1, result.groundImpact / 14));
          audio.thud(result.groundImpact);
        }

        if (drop && !previousDrop) fireWarhead();
        previousDrop = drop;
        fireCooldown = Math.max(0, fireCooldown - delta);

        if (ammo === 0 && warheads.length === 0 && targets.some((target) => target.alive)) {
          outOfAmmoTimer += delta;
          if (outOfAmmoTimer > 2.2 && !missionClosed) {
            missionClosed = true;
            callbacksRef.current.onOutOfAmmo();
          }
        }
      } else {
        modeToggleHeld = keys.has("KeyC");
        previousDrop = drop;
        state.velocity.multiplyScalar(Math.exp(-2.8 * delta));
        const ground = terrainHeight(state.position.x, state.position.z);
        stepFpv(
          state,
          { pitch: 0, roll: 0, yaw: 0, throttle: HOVER_LEVER, boost: false },
          delta,
          ground,
          elapsed,
        );
        state.position.x = THREE.MathUtils.clamp(state.position.x, -122, 122);
        state.position.z = THREE.MathUtils.clamp(state.position.z, -218, 88);
      }

      updateWarheads(delta);
      updateExplosions(delta);
      updatePuffs(delta);
      updateDebris(delta);
      updateScheduled(delta);
      updateWrecks(delta);

      // Camera = body attitude * FPV camera uptilt * motor vibration.
      camera.position.copy(state.position);
      camera.quaternion.copy(state.orientation).multiply(CAM_TILT);
      const vibration =
        0.0011 +
        state.motorSpool * 0.003 +
        (controls.boost ? 0.0016 : 0) +
        Math.min(0.02, state.velocity.length() * 0.0004);
      const jitter = new THREE.Euler(
        Math.sin(elapsed * 47) * vibration + (Math.random() - 0.5) * shake * 0.05,
        Math.sin(elapsed * 39 + 1.7) * vibration + (Math.random() - 0.5) * shake * 0.05,
        Math.sin(elapsed * 31 + 3.1) * vibration * 0.7,
        "YXZ",
      );
      camera.quaternion.multiply(new THREE.Quaternion().setFromEuler(jitter));
      shake *= Math.exp(-4.2 * delta);

      audio.updateMotor(state.motorSpool, Math.abs(state.velocity.y) * 0.02);
      audio.updateWind(state.velocity.length());
      let nearestTank = Number.POSITIVE_INFINITY;
      for (const target of targets) {
        if (!target.alive) continue;
        const distance = camera.position.distanceTo(target.group.position);
        if (distance < nearestTank) nearestTank = distance;
      }
      audio.updateAmbient(
        Number.isFinite(nearestTank) ? THREE.MathUtils.clamp(1 - (nearestTank - 6) / 85, 0, 1) : 0,
      );

      telemetryElapsed += delta;
      if (telemetryElapsed > 0.1) {
        updateTelemetry(gamepad);
        telemetryElapsed = 0;
      }
      renderer.render(scene, camera);
    };

    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", resize);
      scene.traverse((object) => {
        if (object instanceof THREE.Sprite) {
          object.material.dispose();
          object.material.map?.dispose();
          return;
        }
        if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          }
        }
      });
      softTexture.dispose();
      fireTexture.dispose();
      scorchTexture.dispose();
      scorchGeometry.dispose();
      debrisGeometry.dispose();
      audio.dispose();
      audioRef.current = null;
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [initialAmmo]);

  return <div ref={mountRef} className="scene-mount" aria-label="Трехмерная сцена полета FPV-дрона" />;
}
