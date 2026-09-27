import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { AudioEngine } from "./audio";
import { createFpvState, flightHeading, HOVER_LEVER, stepFpv, type FlightMode, type FpvControls } from "./fpv";
import { createTank, KILL_POINTS, resolveArmorHit, tankLabel, type TankBuild, type TankType, type ZoneId } from "./tanks";
import {
  makeArmorBumpTexture,
  makeMarkingTexture,
  makePropBlurTexture,
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
  respawning: boolean;
  /** Throttle stick position 0..1 (like the left stick of a transmitter). */
  throttle: number;
  /** Body attitude in radians for the artificial horizon. */
  roll: number;
  pitch: number;
  /** Power system readouts of a real FPV OSD. */
  voltage: number;
  current: number;
  consumedMah: number;
};

export type HitEventKind = "kill" | "hit" | "warn" | "info";
/** Keyboard layout: "yawAD" — A/D рулят, "rollAD" — A/D кренят (Q/E руль). */
export type ControlScheme = "yawAD" | "rollAD";

type DroneSceneProps = {
  active: boolean;
  muted: boolean;
  controlScheme: ControlScheme;
  onTargetDestroyed: (points: number) => void;
  onTelemetry: (telemetry: Telemetry) => void;
  onEvent?: (message: string, kind: HitEventKind, points?: number) => void;
};

type Target = {
  id: number;
  type: TankType;
  label: string;
  group: THREE.Group;
  turret: THREE.Group;
  armorMaterials: THREE.MeshStandardMaterial[];
  alive: boolean;
  tracked: boolean;
  gunDead: boolean;
  burning: boolean;
  smokeTimer: number;
  fire: THREE.Sprite[];
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
const SUN_OFFSET = new THREE.Vector3(-70, 110, 45);
/** Real FPV cameras sit tilted up ~13° on the frame. */
const CAM_TILT = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.23, 0, 0));
/** Base lens of a wide FPV camera (plus speed-driven widening). */
const BASE_FOV = 88;
const RESPAWN_DELAY = 1.6;
const GROUND_DEATH_SPEED = 5.2;
const SKIM_DEATH_SPEED = 11;

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

/** Progressive keyboard deflection: taps give partial rate, holds give full. */
function rampAxis(current: number, target: number, dt: number) {
  const rate = target === 0 ? 11 : 8;
  return current + (target - current) * (1 - Math.exp(-dt * rate));
}

/** Radial deadzone that keeps stick direction intact (no axis distortion). */
function radialStick(x: number, y: number, dead: number) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < dead) return { x: 0, y: 0 };
  const scale = Math.min(1, (magnitude - dead) / (1 - dead)) / magnitude;
  return { x: x * scale, y: y * scale };
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
  sky.renderOrder = -2;
  scene.add(sky);

  // HDR sun disc — the bloom pass turns it into a hot glow.
  const sunMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(7, 6.1, 4.6),
    fog: false,
  });
  const sunDisc = new THREE.Mesh(new THREE.SphereGeometry(15, 16, 12), sunMaterial);
  sunDisc.renderOrder = -1;
  scene.add(sunDisc);

  return { sky, sunDisc };
}

// Renderer handle used to bake the sky environment map.
let renderer: THREE.WebGLRenderer | null = null;

function buildEnvironmentMap(sky: THREE.Mesh, target: THREE.Scene) {
  if (!renderer) return;
  const envScene = new THREE.Scene();
  envScene.add(sky.clone());
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0, 0.1, 1000);
  target.environment = env.texture;
  target.environmentIntensity = 0.5;
  pmrem.dispose();
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
  road.receiveShadow = true;
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
  trunks.castShadow = true;
  crowns.castShadow = true;
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
  bushes.castShadow = true;
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
  rocks.castShadow = true;
  rocks.receiveShadow = true;
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
    pole.castShadow = true;
    const cross = new THREE.Mesh(crossGeometry, poleMaterial);
    cross.position.set(x, y + 6.3, z);
    cross.castShadow = true;
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
    tent.castShadow = true;
    tent.receiveShadow = true;
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

/**
 * Visible airframe for the FPV feed: carbon arms, motors and propellers in
 * front of the lens — like a real 5" quad seen through a wide FPV camera.
 */
function buildDroneRig(propBlur: THREE.Texture) {
  const rig = new THREE.Group();
  const carbon = new THREE.MeshStandardMaterial({
    color: "#14151a",
    roughness: 0.65,
    metalness: 0.35,
  });
  const motorMaterial = new THREE.MeshStandardMaterial({
    color: "#4a4d55",
    roughness: 0.35,
    metalness: 0.85,
  });
  const bladeMaterial = new THREE.MeshStandardMaterial({
    color: "#1b1d22",
    roughness: 0.5,
    metalness: 0.2,
    side: THREE.DoubleSide,
  });
  const blurMaterial = new THREE.MeshBasicMaterial({
    map: propBlur,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
    color: "#cfd4c6",
  });

  const spinnerPhases: THREE.Group[] = [];
  const frontPositions: Array<[number, number]> = [
    [-0.42, -0.26],
    [0.42, -0.26],
  ];

  for (const [x, y] of frontPositions) {
    // Carbon arm reaching out from under the camera.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.028, 0.5), carbon);
    arm.position.set(x * 0.5, y - 0.06, -0.24);
    arm.lookAt(new THREE.Vector3(x, y, -0.5));
    rig.add(arm);

    const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.042, 0.05, 10), motorMaterial);
    motor.position.set(x, y, -0.5);
    rig.add(motor);

    const spinner = new THREE.Group();
    spinner.position.set(x, y, -0.5);
    for (const angle of [0, Math.PI / 2]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.004, 0.035), bladeMaterial);
      blade.rotation.y = angle;
      spinner.add(blade);
    }
    const blur = new THREE.Mesh(new THREE.CircleGeometry(0.185, 24), blurMaterial);
    blur.rotation.x = -Math.PI / 2;
    blur.userData.isPropBlur = true;
    spinner.add(blur);
    rig.add(spinner);
    spinnerPhases.push(spinner);
  }

  // A glimpse of the front frame plate at the bottom of the feed.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.16), carbon);
  plate.position.set(0, -0.33, -0.34);
  rig.add(plate);

  return { rig, spinnerPhases, blurMaterial };
}

export default function DroneScene({
  active,
  muted,
  controlScheme,
  onTargetDestroyed,
  onTelemetry,
  onEvent,
}: DroneSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const mutedRef = useRef(muted);
  const controlSchemeRef = useRef(controlScheme);
  const audioRef = useRef<AudioEngine | null>(null);
  const callbacksRef = useRef({ onTargetDestroyed, onTelemetry, onEvent });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    mutedRef.current = muted;
    audioRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    controlSchemeRef.current = controlScheme;
  }, [controlScheme]);

  useEffect(() => {
    callbacksRef.current = { onTargetDestroyed, onTelemetry, onEvent };
  }, [onTelemetry, onEvent, onTargetDestroyed]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#a8a28f");
    scene.fog = new THREE.FogExp2("#9f9a88", 0.0075);

    const camera = new THREE.PerspectiveCamera(BASE_FOV, mount.clientWidth / mount.clientHeight, 0.1, 650);
    camera.position.copy(START_POSITION);
    camera.quaternion.copy(CAM_TILT);

    // The airframe itself in view: arms, motors and spinning props.
    const propBlurTexture = makePropBlurTexture();
    const droneRig = buildDroneRig(propBlurTexture);
    camera.add(droneRig.rig);
    scene.add(camera);
    let propAngle = 0;

    const webglRenderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
    });
    renderer = webglRenderer;
    webglRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    webglRenderer.setSize(mount.clientWidth, mount.clientHeight);
    webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
    webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    webglRenderer.toneMappingExposure = 1.0;
    webglRenderer.shadowMap.enabled = true;
    webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mount.appendChild(webglRenderer.domElement);

    const hemisphere = new THREE.HemisphereLight("#d8d8c8", "#34362d", 1.55);
    const sun = new THREE.DirectionalLight("#fff1cf", 2.7);
    sun.position.copy(START_POSITION).add(SUN_OFFSET);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -75;
    sun.shadow.camera.right = 75;
    sun.shadow.camera.top = 75;
    sun.shadow.camera.bottom = -75;
    sun.shadow.camera.near = 15;
    sun.shadow.camera.far = 330;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.035;
    scene.add(hemisphere, sun, sun.target);

    const { sky, sunDisc } = createSky(scene);
    buildEnvironmentMap(sky, scene);
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
      const tank: TankBuild = createTank(
        type,
        id,
        new THREE.Vector3(x, terrainHeight(x, z), z),
        marking,
      );
      scene.add(tank.group);
      return {
        id,
        type,
        label: tankLabel(type),
        group: tank.group,
        turret: tank.turret,
        armorMaterials: tank.armorMaterials,
        alive: true,
        tracked: false,
        gunDead: false,
        burning: false,
        smokeTimer: 0,
        fire: [],
      };
    });
    const tankGroups = targets.map((target) => target.group);

    // Detailed third-party armour texture (AI-generated asset in /public).
    new THREE.TextureLoader().load(
      "textures/tank_armor.jpg",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = Math.min(8, webglRenderer.capabilities.getMaxAnisotropy());
        const superseded = new Set<THREE.Texture>();
        for (const target of targets) {
          for (const material of target.armorMaterials) {
            if (material.map) superseded.add(material.map);
            material.map = texture;
            material.color.set(1, 1, 1);
            material.needsUpdate = true;
          }
        }
        superseded.forEach((texture) => texture.dispose());
      },
      undefined,
      () => {
        // Keep the procedural camo if the file is unavailable.
      },
    );

    const audio = new AudioEngine();
    audio.setMuted(mutedRef.current);
    audio.startContinuous();
    audioRef.current = audio;

    const state = createFpvState(START_POSITION);
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

    let destroyed = false;
    let respawnTimer = 0;
    const tumble = new THREE.Vector3();
    let boost = false;
    let previousLocked = false;
    // Throttle stick starts at 0: no input → the drone falls.
    let keyboardThrottle = 0;
    // Progressive keyboard deflections (partial rates on short taps).
    let keyPitch = 0;
    let keyRoll = 0;
    let keyYaw = 0;
    let shake = 0;
    let animationFrame = 0;
    let elapsed = 0;
    let telemetryElapsed = 0;
    let lastTime = performance.now();

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
      webglRenderer.setSize(width, height);
      composer.setSize(width, height);
    };
    window.addEventListener("resize", resize);

    const composer = new EffectComposer(webglRenderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(mount.clientWidth, mount.clientHeight),
      0.42,
      0.55,
      0.85,
    );
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const cameraRight = new THREE.Vector3();
    const toSource = new THREE.Vector3();
    const panFor = (worldPos: THREE.Vector3) => {
      cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      toSource.copy(worldPos).sub(camera.position);
      if (toSource.lengthSq() < 1e-6) return 0;
      toSource.normalize();
      return THREE.MathUtils.clamp(cameraRight.dot(toSource) * 0.85, -1, 1);
    };

    /** Controller rumble for impacts and explosions (when a gamepad is on). */
    const rumble = (power: number, duration: number) => {
      try {
        const pads = navigator.getGamepads?.() ?? [];
        for (const pad of pads) {
          const actuator = pad?.vibrationActuator;
          if (!actuator || typeof actuator.playEffect !== "function") continue;
          void actuator
            .playEffect("dual-rumble", {
              duration,
              weakMagnitude: Math.min(1, power * 0.7),
              strongMagnitude: Math.min(1, power),
            })
            .catch(() => undefined);
        }
      } catch {
        // Rumble is optional.
      }
    };

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
        mesh.castShadow = true;
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
      mesh.position.set(position.x, terrainHeight(position.x, position.z) + 0.06, position.z);
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
      const distance = camera.position.distanceTo(position);
      audio.explosion(distance, panFor(position));
      if (distance < 32) rumble(Math.min(0.85, 1 - distance / 38), 320);
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

    const splashTracks = (position: THREE.Vector3) => {
      for (const target of targets) {
        if (!target.alive || target.tracked) continue;
        const horizontal = Math.hypot(
          position.x - target.group.position.x,
          position.z - target.group.position.z,
        );
        if (horizontal < 4.2) {
          damageTrack(target, 40, `ОТСКОК — ХОДОВАЯ: ${target.label}`);
        }
      }
    };

    /** The drone detonates: feed dies, camera tumbles, respawn is scheduled. */
    const destroyDrone = (blast: boolean) => {
      if (destroyed) return;
      destroyed = true;
      respawnTimer = RESPAWN_DELAY;
      tumble.set(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 14,
      );
      if (blast) {
        createExplosion(state.position, 1.15);
        addScorch(state.position, 4.2);
        splashTracks(state.position);
      }
      audio.staticBurst();
      rumble(1, 600);
      shake = 1;
      droneRig.rig.visible = false;
      emit("БОРТ УНИЧТОЖЕН — ПЕРЕЗАПУСК В ВОЗДУХЕ", "info");
    };

    const respawnDrone = () => {
      destroyed = false;
      const yaw = (Math.random() - 0.5) * 0.4;
      state.position.set(
        START_POSITION.x + (Math.random() - 0.5) * 9,
        15 + Math.random() * 8,
        START_POSITION.z + (Math.random() - 0.5) * 7,
      );
      state.velocity.set(0, 0, 0);
      state.yawAngle = yaw;
      state.pitchAngle = 0;
      state.rollAngle = 0;
      state.orientation.setFromEuler(new THREE.Euler(0, yaw, 0, "YXZ"));
      state.pitchCmd = 0;
      state.rollCmd = 0;
      state.yawCmd = 0;
      // Fresh airframe: throttle stick rests at 0 — push it up to fly.
      state.throttleLever = 0;
      state.motorSpool = 0;
      droneRig.rig.visible = true;
      audio.armBeeps();
      emit("НОВЫЙ БОРТ В ВОЗДУХЕ — ПРОДОЛЖАЕМ", "info");
    };

    /**
     * Kamikaze impact against a tank: the warhead detonates on contact and the
     * armour model decides whether the hit penetrates.
     */
    const kamikazeImpact = (hit: THREE.Intersection, shotDir: THREE.Vector3) => {
      const targetId = hit.object.userData.targetId as number | undefined;
      const target = targets.find((item) => item.id === targetId);
      const distance = camera.position.distanceTo(hit.point);
      const pan = panFor(hit.point);

      if (!target) {
        createExplosion(hit.point, 1.1);
        destroyDrone(false);
        return;
      }

      if (!target.alive) {
        emit(`ПОПАДАНИЕ В СГОРЕВШУЮ ТЕХНИКУ: ${target.label}`, "info");
        createExplosion(hit.point, 1.0);
        destroyDrone(false);
        return;
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
      const eraNote = resolution.eraFailed ? " (ЭРА НЕ СРАБОТАЛА)" : "";

      if (resolution.pen) {
        audio.impact("pen", distance, pan);
        if (resolution.spec.lethal === "kill") {
          destroyTarget(target, resolution.spec.label, hit.point.clone());
        } else if (resolution.spec.lethal === "track") {
          createExplosion(hit.point, 0.85);
          damageTrack(target, 60, `ПОДБИТА ХОДОВАЯ: ${target.label}`);
        } else if (resolution.spec.lethal === "gun") {
          createExplosion(hit.point, 0.75);
          if (target.gunDead) {
            emit(`СТВОЛ УЖЕ ВЫВЕДЕН: ${target.label}`, "info");
          } else {
            target.gunDead = true;
            emit(`СТВОЛ ВЫВЕДЕН ИЗ СТРОЯ: ${target.label}`, "hit", 35);
          }
        } else {
          createExplosion(hit.point, 1.0);
        }
      } else {
        audio.impact("ricochet", distance, pan);
        createExplosion(hit.point, 1.05);
        emit(
          `БРОНЯ ВЫДЕРЖАЛА: ${target.label} ${resolution.spec.label} (${resolution.effectiveArmor} vs ${resolution.penetration} мм)${eraNote}`,
          "warn",
        );
      }

      destroyDrone(false);
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
        puff.sprite.scale.setScalar(THREE.MathUtils.lerp(puff.startScale, puff.growTo, ratio));
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

    /** Pack sag: less battery → slightly weaker motors. */
    const batteryThrustScale = () => {
      const pct = THREE.MathUtils.clamp(100 - elapsed * 0.21 - (boost ? 3 : 0), 0, 100);
      return 0.9 + 0.1 * (pct / 100);
    };

    const readControls = (delta: number) => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(gamepads).find((pad) => pad?.connected) ?? null;
      const scheme = controlSchemeRef.current;

      // Keyboard targets by scheme. W/S always pitches, arrows always work.
      const pitchTarget =
        (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) -
        (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      const arrowsRoll =
        (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
      const rollTarget =
        scheme === "rollAD"
          ? (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0) + arrowsRoll
          : arrowsRoll;
      const yawTarget =
        scheme === "rollAD"
          ? (keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0)
          : (keys.has("KeyD") || keys.has("KeyE") ? 1 : 0) -
            (keys.has("KeyA") || keys.has("KeyQ") ? 1 : 0);

      keyPitch = rampAxis(keyPitch, pitchTarget, delta);
      keyRoll = rampAxis(keyRoll, THREE.MathUtils.clamp(rollTarget, -1, 1), delta);
      keyYaw = rampAxis(keyYaw, THREE.MathUtils.clamp(yawTarget, -1, 1), delta);

      boost = keys.has("Space");
      const assist = keys.has("KeyX");

      const keyboardUp = keys.has("ShiftLeft") || keys.has("ShiftRight");
      const keyboardDown = keys.has("ControlLeft") || keys.has("ControlRight");
      // Throttle behaves like a transmitter stick: Shift pushes it up,
      // releasing springs it back to 0 (no thrust → the drone falls),
      // Ctrl slams it to idle instantly.
      if (keyboardUp) {
        keyboardThrottle = Math.min(1, keyboardThrottle + 1.05 * delta);
      } else if (keyboardDown) {
        keyboardThrottle = Math.max(0, keyboardThrottle - 4.5 * delta);
      } else {
        keyboardThrottle = Math.max(0, keyboardThrottle - 1.15 * delta);
      }
      let yaw = keyYaw;
      let roll = keyRoll;
      let pitch = keyPitch;
      let throttle = keyboardThrottle;

      if (gamepad) {
        // Radial deadzones keep diagonal input honest on both sticks.
        const left = radialStick(gamepad.axes[0] ?? 0, gamepad.axes[1] ?? 0, 0.08);
        const right = radialStick(gamepad.axes[2] ?? 0, gamepad.axes[3] ?? 0, 0.1);
        yaw = THREE.MathUtils.clamp(yaw + left.x, -1, 1);
        roll = THREE.MathUtils.clamp(roll + right.x, -1, 1);
        pitch = THREE.MathUtils.clamp(pitch - right.y, -1, 1);
        throttle = (1 - left.y) / 2;
        boost ||= Boolean(gamepad.buttons[0]?.pressed);
        if (keyboardUp) throttle = Math.min(1, throttle + 0.2);
        if (keyboardDown) throttle = Math.max(0, throttle - 0.2);
      }

      return {
        controls: {
          yaw,
          roll,
          pitch,
          throttle,
          boost,
          assist,
        } satisfies FpvControls,
        gamepad: Boolean(gamepad),
      };
    };

    const updateTelemetry = (gamepadConnected: boolean) => {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      let closestRange: number | null = null;
      let smallestAngle = Number.POSITIVE_INFINITY;
      if (!destroyed) {
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
      }
      const ground = terrainHeight(camera.position.x, camera.position.z);
      const homeDistance = Math.hypot(
        camera.position.x - START_POSITION.x,
        camera.position.z - START_POSITION.z,
      );
      const locked = !destroyed && smallestAngle < 0.115 && closestRange !== null;
      if (locked && !previousLocked) audio.beep();
      previousLocked = locked;

      const batteryPct = THREE.MathUtils.clamp(100 - elapsed * 0.21 - (boost ? 3 : 0), 0, 100);

      callbacksRef.current.onTelemetry({
        altitude: Math.max(0, camera.position.y - ground),
        speed: state.velocity.length() * 3.6,
        heading: flightHeading(state),
        signal: THREE.MathUtils.clamp(100 - homeDistance * 0.16, 42, 100),
        battery: batteryPct,
        range: closestRange,
        locked,
        gamepad: gamepadConnected,
        flightMode: state.mode,
        respawning: destroyed,
        throttle: state.throttleLever,
        roll: state.rollAngle,
        pitch: state.pitchAngle,
        voltage: 13.2 + batteryPct * 0.036,
        current: 4 + state.throttleLever * 46 + (boost ? 18 : 0),
        consumedMah: Math.round((100 - batteryPct) * 52),
      });
    };

    const animate = (now: number) => {
      animationFrame = window.requestAnimationFrame(animate);
      const delta = Math.min((now - lastTime) / 1000, 0.04);
      lastTime = now;
      const { controls, gamepad } = readControls(delta);

      if (activeRef.current) {
        elapsed += delta;
        const previousPosition = state.position.clone();

        if (destroyed) {
          // The ruined airframe tumbles down while the feed is dead.
          stepFpv(
            state,
            { pitch: 0, roll: 0, yaw: 0, throttle: 0, boost: false, assist: false },
            delta,
            terrainHeight(state.position.x, state.position.z),
            elapsed,
          );
          const spin = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(tumble.x * delta, tumble.y * delta, tumble.z * delta),
          );
          state.orientation.multiply(spin);
          respawnTimer -= delta;
          if (respawnTimer <= 0) respawnDrone();
        } else {
          const ground = terrainHeight(state.position.x, state.position.z);
          const result = stepFpv(
            state,
            controls,
            delta,
            ground,
            elapsed,
            batteryThrustScale(),
          );
          state.position.x = THREE.MathUtils.clamp(state.position.x, -122, 122);
          state.position.z = THREE.MathUtils.clamp(state.position.z, -218, 88);

          // Drone vs armour: segment raycast so nothing tunnels through.
          const segment = state.position.clone().sub(previousPosition);
          const segmentLength = segment.length();
          if (segmentLength > 1e-4) {
            scene.updateMatrixWorld();
            raycaster.set(previousPosition, segment.clone().normalize());
            raycaster.far = segmentLength;
            const hits = raycaster.intersectObjects(tankGroups, true);
            if (hits.length > 0) {
              kamikazeImpact(hits[0], segment.clone().normalize());
            }
          }

          if (!destroyed) {
            const horizontalSpeed = Math.hypot(state.velocity.x, state.velocity.z);
            const onGround = state.position.y <= ground + 0.3;
            if (result.groundImpact > GROUND_DEATH_SPEED) {
              shake = Math.max(shake, Math.min(1, result.groundImpact / 14));
              audio.thud(result.groundImpact);
              destroyDrone(true);
            } else if (onGround && horizontalSpeed > SKIM_DEATH_SPEED) {
              audio.thud(horizontalSpeed);
              destroyDrone(true);
            } else if (result.groundImpact > 1.5) {
              shake = Math.max(shake, Math.min(0.6, result.groundImpact / 16));
              audio.thud(result.groundImpact);
            }
          }
        }
      } else if (!destroyed) {
        state.velocity.multiplyScalar(Math.exp(-2.8 * delta));
        const ground = terrainHeight(state.position.x, state.position.z);
        stepFpv(
          state,
          { pitch: 0, roll: 0, yaw: 0, throttle: HOVER_LEVER, boost: false, assist: false },
          delta,
          ground,
          elapsed,
          batteryThrustScale(),
        );
        state.position.x = THREE.MathUtils.clamp(state.position.x, -122, 122);
        state.position.z = THREE.MathUtils.clamp(state.position.z, -218, 88);
      }

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

      // Follow-mechanics: sky, sun disc and shadow frustum ride with the drone.
      sky.position.copy(camera.position);
      sunDisc.position.copy(camera.position).addScaledVector(SUN_OFFSET, 3.4);
      sun.position.copy(camera.position).add(SUN_OFFSET);
      sun.target.position.set(camera.position.x, 0, camera.position.z);
      sun.target.updateMatrixWorld();

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

      // Speed sensation: the lens opens up as the drone accelerates.
      const speedFov = BASE_FOV + THREE.MathUtils.clamp((state.velocity.length() - 9) * 0.3, 0, 12);
      if (Math.abs(camera.fov - speedFov) > 0.02) {
        camera.fov += (speedFov - camera.fov) * (1 - Math.exp(-delta * 3));
        camera.updateProjectionMatrix();
      }

      // Visible airframe: props spin with motor RPM, blur fades in with speed.
      propAngle += (7 + state.motorSpool * 130) * delta;
      droneRig.spinnerPhases.forEach((spinner, index) => {
        spinner.rotation.y = (index % 2 === 0 ? 1 : -1) * propAngle + index * 1.7;
      });
      droneRig.blurMaterial.opacity = THREE.MathUtils.clamp(
        (state.motorSpool - 0.12) * 0.9,
        0,
        0.5,
      );
      composer.render();
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
      propBlurTexture.dispose();
      composer.dispose();
      audio.dispose();
      audioRef.current = null;
      renderer = null;
      webglRenderer.dispose();
      webglRenderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="scene-mount" aria-label="Трехмерная сцена полета FPV-дрона" />;
}
