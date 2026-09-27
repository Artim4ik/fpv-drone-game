import { useEffect, useRef } from "react";
import * as THREE from "three";

export type Telemetry = {
  altitude: number;
  speed: number;
  heading: number;
  signal: number;
  battery: number;
  range: number | null;
  locked: boolean;
  gamepad: boolean;
};

type DroneSceneProps = {
  active: boolean;
  muted: boolean;
  initialAmmo: number;
  onTargetDestroyed: (points: number) => void;
  onBombReleased: () => void;
  onTelemetry: (telemetry: Telemetry) => void;
  onOutOfAmmo: () => void;
};

type Target = {
  id: number;
  group: THREE.Group;
  alive: boolean;
};

type Bomb = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
};

type Explosion = {
  core: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  smoke: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  age: number;
};

const TERRAIN_SIZE = 520;
const START_POSITION = new THREE.Vector3(0, 18, 62);

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

function makeMarkingTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
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
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function createTerrain(scene: THREE.Scene) {
  const geometry = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 110, 110);
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
    roughness: 1,
    metalness: 0,
    flatShading: true,
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
    new THREE.MeshStandardMaterial({ color: "#565447", roughness: 1, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  scene.add(road);

  const trunkGeometry = new THREE.CylinderGeometry(0.13, 0.18, 1.4, 5);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#4a3e2d", roughness: 1 });
  const crownGeometry = new THREE.ConeGeometry(0.9, 2.8, 6);
  const crownMaterial = new THREE.MeshStandardMaterial({ color: "#283426", roughness: 1, flatShading: true });
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

  const mountainMaterial = new THREE.MeshStandardMaterial({ color: "#585a4d", roughness: 1, flatShading: true });
  for (let index = 0; index < 12; index += 1) {
    const radius = 22 + seededRandom(index + 300) * 28;
    const mountain = new THREE.Mesh(new THREE.ConeGeometry(radius, radius * 0.72, 7), mountainMaterial);
    mountain.position.set(-230 + index * 42, -7, -245 - seededRandom(index + 400) * 22);
    mountain.rotation.y = seededRandom(index + 500) * Math.PI;
    scene.add(mountain);
  }
}

function createVehicle(id: number, position: THREE.Vector3, marking: THREE.Texture) {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = (id % 2 ? -0.08 : 0.1) + Math.sin(position.z) * 0.1;
  group.userData.targetId = id;

  const armor = new THREE.MeshStandardMaterial({ color: id % 2 ? "#4a513d" : "#555744", roughness: 0.8, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: "#1e211d", roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.15, 7), armor);
  body.position.y = 1.25;
  const upper = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.8, 4.2), armor);
  upper.position.set(0, 2.15, -0.2);
  upper.rotation.x = -0.04;
  const leftTrack = new THREE.Mesh(new THREE.BoxGeometry(0.82, 1, 7.3), dark);
  leftTrack.position.set(-2.1, 0.75, 0);
  const rightTrack = leftTrack.clone();
  rightTrack.position.x = 2.1;
  const turret = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.7, 0.75, 8), armor);
  turret.position.set(0, 2.85, -0.45);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 4.8), dark);
  barrel.position.set(0, 2.98, -3.05);
  barrel.rotation.x = -0.035;
  const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 8), dark);
  hatch.position.set(0.5, 3.3, -0.3);
  const mark = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 1.7),
    new THREE.MeshBasicMaterial({ map: marking, side: THREE.DoubleSide }),
  );
  mark.position.set(-0.55, 3.3, 0.35);
  mark.rotation.x = -Math.PI / 2;
  group.add(body, upper, leftTrack, rightTrack, turret, barrel, hatch, mark);
  group.traverse((object) => {
    object.userData.targetId = id;
  });
  return group;
}

function createTargets(scene: THREE.Scene) {
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
  return coordinates.map(([x, z], id) => {
    const group = createVehicle(id, new THREE.Vector3(x, terrainHeight(x, z), z), marking);
    scene.add(group);
    return { id, group, alive: true };
  });
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

  const tentMaterial = new THREE.MeshStandardMaterial({ color: "#62624d", roughness: 1, flatShading: true });
  for (const [x, z] of [[-22, -40], [24, -103], [-26, -158]] as Array<[number, number]>) {
    const tent = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 3.8, 6.5, 3), tentMaterial);
    tent.rotation.z = Math.PI / 2;
    tent.rotation.y = Math.PI / 6;
    tent.position.set(x, terrainHeight(x, z) + 1.6, z);
    scene.add(tent);
  }
}

let audioContext: AudioContext | null = null;

function playTone(type: "drop" | "blast", muted: boolean) {
  if (muted) return;
  try {
    audioContext ??= new AudioContext();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type === "blast" ? "sawtooth" : "sine";
    oscillator.frequency.setValueAtTime(type === "blast" ? 95 : 420, audioContext.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(type === "blast" ? 38 : 180, audioContext.currentTime + 0.25);
    gain.gain.setValueAtTime(type === "blast" ? 0.18 : 0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + (type === "blast" ? 0.55 : 0.2));
    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start();
    oscillator.stop(audioContext.currentTime + (type === "blast" ? 0.58 : 0.22));
  } catch {
    // Audio is optional and may be blocked by browser autoplay policies.
  }
}

function deadzone(value: number, threshold = 0.12) {
  if (Math.abs(value) < threshold) return 0;
  return (value - Math.sign(value) * threshold) / (1 - threshold);
}

export default function DroneScene({
  active,
  muted,
  initialAmmo,
  onTargetDestroyed,
  onBombReleased,
  onTelemetry,
  onOutOfAmmo,
}: DroneSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const mutedRef = useRef(muted);
  const callbacksRef = useRef({ onTargetDestroyed, onBombReleased, onTelemetry, onOutOfAmmo });

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    callbacksRef.current = { onTargetDestroyed, onBombReleased, onTelemetry, onOutOfAmmo };
  }, [onBombReleased, onOutOfAmmo, onTargetDestroyed, onTelemetry]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#a8a28f");
    scene.fog = new THREE.FogExp2("#9f9a88", 0.008);

    const camera = new THREE.PerspectiveCamera(79, mount.clientWidth / mount.clientHeight, 0.1, 650);
    camera.position.copy(START_POSITION);
    camera.rotation.order = "YXZ";

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const hemisphere = new THREE.HemisphereLight("#d8d8c8", "#34362d", 2.1);
    const sun = new THREE.DirectionalLight("#fff1cf", 2.4);
    sun.position.set(-70, 110, 45);
    scene.add(hemisphere, sun);

    createTerrain(scene);
    addWorldDetails(scene);
    const targets = createTargets(scene);
    const bombs: Bomb[] = [];
    const explosions: Explosion[] = [];
    const keys = new Set<string>();
    let ammo = initialAmmo;
    let yaw = 0;
    let pitch = -0.055;
    let roll = 0;
    let currentSpeed = 0;
    let boost = false;
    let previousDrop = false;
    let animationFrame = 0;
    let elapsed = 0;
    let telemetryElapsed = 0;
    let lastTime = performance.now();
    let outOfAmmoTimer = 0;
    let missionClosed = false;

    const onKeyDown = (event: KeyboardEvent) => {
      keys.add(event.code);
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
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

    const createExplosion = (position: THREE.Vector3) => {
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(1.25, 12, 8),
        new THREE.MeshBasicMaterial({ color: "#ffb12b", transparent: true, opacity: 1 }),
      );
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.6, 0.16, 8, 24),
        new THREE.MeshBasicMaterial({ color: "#ffd27a", transparent: true, opacity: 0.9 }),
      );
      const smoke = new THREE.Mesh(
        new THREE.SphereGeometry(1.8, 9, 7),
        new THREE.MeshBasicMaterial({ color: "#24251f", transparent: true, opacity: 0.58, depthWrite: false }),
      );
      core.position.copy(position).add(new THREE.Vector3(0, 1.1, 0));
      ring.position.copy(core.position);
      ring.rotation.x = Math.PI / 2;
      smoke.position.copy(core.position).add(new THREE.Vector3(0, 1.2, 0));
      scene.add(core, ring, smoke);
      explosions.push({ core, ring, smoke, age: 0 });
      playTone("blast", mutedRef.current);
    };

    const destroyTarget = (target: Target, direct: boolean) => {
      if (!target.alive) return;
      target.alive = false;
      const position = target.group.position.clone();
      scene.remove(target.group);
      createExplosion(position);
      callbacksRef.current.onTargetDestroyed(direct ? 200 : 125);
    };

    const detonate = (bomb: Bomb, directTarget: Target | null) => {
      const position = bomb.mesh.position.clone();
      scene.remove(bomb.mesh);
      bomb.mesh.geometry.dispose();
      (bomb.mesh.material as THREE.Material).dispose();
      if (directTarget) destroyTarget(directTarget, true);
      for (const target of targets) {
        if (!target.alive || target === directTarget) continue;
        const horizontalDistance = Math.hypot(position.x - target.group.position.x, position.z - target.group.position.z);
        if (horizontalDistance < 9.5) destroyTarget(target, false);
      }
      createExplosion(position);
    };

    const releaseBomb = () => {
      if (ammo <= 0 || !activeRef.current) return;
      ammo -= 1;
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      const geometry = new THREE.CapsuleGeometry(0.22, 0.72, 5, 8);
      const material = new THREE.MeshStandardMaterial({ color: "#282a25", metalness: 0.65, roughness: 0.35 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(camera.position).addScaledVector(direction, 1.7);
      mesh.position.y -= 0.65;
      mesh.quaternion.copy(camera.quaternion);
      scene.add(mesh);
      const velocity = direction.multiplyScalar(Math.max(13, currentSpeed * 0.34));
      velocity.y -= 3.2;
      bombs.push({ mesh, velocity, age: 0 });
      callbacksRef.current.onBombReleased();
      playTone("drop", mutedRef.current);
    };

    const updateBombs = (delta: number) => {
      for (let index = bombs.length - 1; index >= 0; index -= 1) {
        const bomb = bombs[index];
        bomb.age += delta;
        bomb.velocity.y -= 13.5 * delta;
        bomb.mesh.position.addScaledVector(bomb.velocity, delta);
        bomb.mesh.rotateX(delta * 3);
        let directTarget: Target | null = null;
        for (const target of targets) {
          if (target.alive && bomb.mesh.position.distanceTo(target.group.position.clone().add(new THREE.Vector3(0, 1.5, 0))) < 3.7) {
            directTarget = target;
            break;
          }
        }
        const ground = terrainHeight(bomb.mesh.position.x, bomb.mesh.position.z);
        if (directTarget || bomb.mesh.position.y <= ground + 0.25 || bomb.age > 9) {
          detonate(bomb, directTarget);
          bombs.splice(index, 1);
        }
      }
    };

    const updateExplosions = (delta: number) => {
      for (let index = explosions.length - 1; index >= 0; index -= 1) {
        const explosion = explosions[index];
        explosion.age += delta;
        const age = explosion.age;
        explosion.core.scale.setScalar(1 + age * 4.8);
        explosion.ring.scale.setScalar(1 + age * 6.5);
        explosion.smoke.scale.setScalar(1 + age * 2.6);
        explosion.smoke.position.y += delta * 2.4;
        explosion.core.material.opacity = Math.max(0, 1 - age * 2.5);
        explosion.ring.material.opacity = Math.max(0, 0.9 - age * 1.8);
        explosion.smoke.material.opacity = Math.max(0, 0.58 - age * 0.32);
        if (age > 1.8) {
          scene.remove(explosion.core, explosion.ring, explosion.smoke);
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

    const readControls = () => {
      const gamepads = navigator.getGamepads?.() ?? [];
      const gamepad = Array.from(gamepads).find((pad) => pad?.connected) ?? null;
      let yawInput = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      let throttleInput = (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 1 : 0) - (keys.has("ControlLeft") || keys.has("ControlRight") ? 1 : 0);
      let rollInput = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
      let pitchInput = (keys.has("KeyW") || keys.has("ArrowUp") ? 1 : 0) - (keys.has("KeyS") || keys.has("ArrowDown") ? 1 : 0);
      boost = keys.has("KeyE");
      let drop = keys.has("Space");
      if (gamepad) {
        yawInput += deadzone(gamepad.axes[0] ?? 0);
        throttleInput += -deadzone(gamepad.axes[1] ?? 0);
        rollInput += deadzone(gamepad.axes[2] ?? 0);
        pitchInput += -deadzone(gamepad.axes[3] ?? 0);
        boost ||= Boolean(gamepad.buttons[0]?.pressed);
        drop ||= Boolean(gamepad.buttons[7]?.pressed) || (gamepad.buttons[7]?.value ?? 0) > 0.55;
      }
      return {
        yawInput: THREE.MathUtils.clamp(yawInput, -1, 1),
        throttleInput: THREE.MathUtils.clamp(throttleInput, -1, 1),
        rollInput: THREE.MathUtils.clamp(rollInput, -1, 1),
        pitchInput: THREE.MathUtils.clamp(pitchInput, -1, 1),
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
      const homeDistance = Math.hypot(camera.position.x - START_POSITION.x, camera.position.z - START_POSITION.z);
      callbacksRef.current.onTelemetry({
        altitude: Math.max(0, camera.position.y - ground),
        speed: currentSpeed * 3.6,
        heading: (THREE.MathUtils.radToDeg(yaw) + 360) % 360,
        signal: THREE.MathUtils.clamp(100 - homeDistance * 0.16, 42, 100),
        battery: THREE.MathUtils.clamp(100 - elapsed * 0.21 - (boost ? 3 : 0), 0, 100),
        range: closestRange,
        locked: smallestAngle < 0.115 && closestRange !== null,
        gamepad: gamepadConnected,
      });
    };

    const animate = (now: number) => {
      animationFrame = window.requestAnimationFrame(animate);
      const delta = Math.min((now - lastTime) / 1000, 0.04);
      lastTime = now;
      const controls = readControls();

      if (activeRef.current) {
        elapsed += delta;
        yaw -= controls.yawInput * delta * 1.38;
        yaw -= controls.rollInput * delta * 0.33;
        pitch = THREE.MathUtils.lerp(pitch, -controls.pitchInput * 0.5 - 0.035, 1 - Math.exp(-delta * 5));
        roll = THREE.MathUtils.lerp(roll, -controls.rollInput * 0.62, 1 - Math.exp(-delta * 6));
        camera.rotation.set(pitch + Math.sin(elapsed * 9) * 0.0018, yaw, roll, "YXZ");

        const targetSpeed = 11 + Math.max(0, controls.pitchInput) * 11 + (boost ? 12 : 0);
        currentSpeed = THREE.MathUtils.lerp(currentSpeed, targetSpeed, 1 - Math.exp(-delta * 2.4));
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        camera.position.addScaledVector(forward, currentSpeed * delta);
        camera.position.addScaledVector(right, controls.rollInput * 6.5 * delta);
        camera.position.y += controls.throttleInput * 10.5 * delta;

        camera.position.x = THREE.MathUtils.clamp(camera.position.x, -122, 122);
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, -218, 88);
        const ground = terrainHeight(camera.position.x, camera.position.z);
        camera.position.y = THREE.MathUtils.clamp(camera.position.y, ground + 2.2, 68);

        if (controls.drop && !previousDrop) releaseBomb();
        previousDrop = controls.drop;
        updateBombs(delta);

        if (ammo === 0 && bombs.length === 0 && targets.some((target) => target.alive)) {
          outOfAmmoTimer += delta;
          if (outOfAmmoTimer > 2.2 && !missionClosed) {
            missionClosed = true;
            callbacksRef.current.onOutOfAmmo();
          }
        }
      } else {
        currentSpeed = THREE.MathUtils.lerp(currentSpeed, 0, 1 - Math.exp(-delta * 3));
      }

      updateExplosions(delta);
      telemetryElapsed += delta;
      if (telemetryElapsed > 0.1) {
        updateTelemetry(controls.gamepad);
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
        if (object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if ("map" in material && material.map instanceof THREE.Texture) material.map.dispose();
            material.dispose();
          }
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [initialAmmo]);

  return <div ref={mountRef} className="scene-mount" aria-label="Трехмерная сцена полета FPV-дрона" />;
}