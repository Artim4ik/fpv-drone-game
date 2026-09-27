import * as THREE from "three";
import { makeArmorBumpTexture, makeCamoTexture, makeTrackTexture } from "./textures";

export type TankType = "T72B" | "T90";

export type ZoneId =
  | "glacis"
  | "hullSide"
  | "roof"
  | "engine"
  | "track"
  | "turretFront"
  | "turretSide"
  | "barrel";

type ZoneSpec = {
  /** Base armour thickness in mm of RHA. */
  mm: number;
  /** Additional effective thickness provided by dynamic protection vs HEAT. */
  era: number;
  label: string;
  lethal: "kill" | "track" | "gun";
};

/**
 * Armour values follow published figures: the T-72B carries composite plates
 * + Kontakt-1 blocks, the T-90A the heavier Kontakt-5 set which defeats a
 * shaped-charge warhead from the front. Roofs, tracks and the engine
 * compartment stay vulnerable — the attack envelope of a kamikaze drone.
 * ERA detonates reliably but occasionally fails (modelled at 5%).
 */
const ARMOR: Record<TankType, Record<ZoneId, ZoneSpec>> = {
  T72B: {
    glacis: { mm: 205, era: 340, label: "ЛОБОВАЯ ПЛАСТИНА", lethal: "kill" },
    turretFront: { mm: 305, era: 270, label: "БОРОТА БАШНИ", lethal: "kill" },
    turretSide: { mm: 125, era: 90, label: "БОРТ БАШНИ", lethal: "kill" },
    hullSide: { mm: 90, era: 0, label: "БОРТ КОРПУСА", lethal: "kill" },
    roof: { mm: 45, era: 0, label: "КРЫША", lethal: "kill" },
    engine: { mm: 45, era: 0, label: "МОТОРНЫЙ ОТСЕК", lethal: "kill" },
    track: { mm: 55, era: 0, label: "ХОДОВАЯ", lethal: "track" },
    barrel: { mm: 70, era: 0, label: "СТВОЛ", lethal: "gun" },
  },
  T90: {
    glacis: { mm: 235, era: 560, label: "ЛОБ (КОНТАКТ-5)", lethal: "kill" },
    turretFront: { mm: 330, era: 520, label: "БОРОТА БАШНИ (КОНТАКТ-5)", lethal: "kill" },
    turretSide: { mm: 135, era: 210, label: "БОРТ БАШНИ", lethal: "kill" },
    hullSide: { mm: 85, era: 170, label: "БОРТ КОРПУСА (ЭРА)", lethal: "kill" },
    roof: { mm: 50, era: 40, label: "КРЫША", lethal: "kill" },
    engine: { mm: 50, era: 60, label: "МОТОРНЫЙ ОТСЕК", lethal: "kill" },
    track: { mm: 55, era: 0, label: "ХОДОВАЯ", lethal: "track" },
    barrel: { mm: 75, era: 0, label: "СТВОЛ", lethal: "gun" },
  },
};

/** Shaped-charge warhead of an FPV kamikaze: ~560 mm RHA at 90°. */
export const HEAT_PENETRATION = 560;

export const KILL_POINTS: Record<TankType, number> = { T72B: 200, T90: 300 };

const ERA_FAIL_CHANCE = 0.05;

export type HitResolution = {
  zone: ZoneId;
  spec: ZoneSpec;
  effectiveArmor: number;
  penetration: number;
  pen: boolean;
  eraFailed: boolean;
};

export function resolveArmorHit(
  type: TankType,
  zone: ZoneId,
  incidenceCos: number,
): HitResolution {
  const spec = ARMOR[type][zone] ?? ARMOR[type].hullSide;
  // Line-of-sight thickening of the sloped plate.
  const lineOfSight = spec.mm / THREE.MathUtils.clamp(incidenceCos, 0.24, 1);
  // Dynamic protection usually detonates, but has a small failure rate.
  const eraFailed = spec.era > 0 && Math.random() < ERA_FAIL_CHANCE;
  const eraBonus = spec.era > 0 && !eraFailed ? spec.era * (0.86 + Math.random() * 0.3) : 0;
  const effectiveArmor = Math.round(lineOfSight + eraBonus);
  const penetration = Math.round(HEAT_PENETRATION * (0.92 + Math.random() * 0.16));
  return { zone, spec, effectiveArmor, penetration, pen: penetration > effectiveArmor, eraFailed };
}

export function tankLabel(type: TankType) {
  return type === "T72B" ? "Т-72Б" : "Т-90А";
}

export type TankBuild = {
  group: THREE.Group;
  turret: THREE.Group;
  type: TankType;
  /** Materials that receive the shared detailed armour texture when available. */
  armorMaterials: THREE.MeshStandardMaterial[];
};

type Vec = [number, number, number];

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vec,
  zone: ZoneId,
  rotation?: Vec,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(position[0], position[1], position[2]);
  if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.userData.zone = zone;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Complete running gear: road wheels, idler, sprocket and track plates. */
function buildRunningGear(group: THREE.Group, side: number, trackMaterial: THREE.Material, wheelMaterial: THREE.Material, hubMaterial: THREE.Material) {
  const x = side * 1.62;
  const bottom = new THREE.BoxGeometry(0.56, 0.12, 5.4);
  const top = new THREE.BoxGeometry(0.56, 0.1, 5.2);
  addMesh(group, bottom, trackMaterial, [x, 0.08, 0], "track");
  addMesh(group, top, trackMaterial, [x, 1.0, 0], "track");

  for (const z of [-2.62, 2.62]) {
    const drum = new THREE.CylinderGeometry(0.46, 0.46, 0.56, 14);
    drum.rotateZ(Math.PI / 2);
    addMesh(group, drum, wheelMaterial, [x, 0.53, z], "track");
    const hub = new THREE.CylinderGeometry(0.2, 0.2, 0.6, 10);
    hub.rotateZ(Math.PI / 2);
    addMesh(group, hub, hubMaterial, [x, 0.53, z], "track");
  }

  for (let index = 0; index < 6; index += 1) {
    const z = -2.1 + index * 0.84;
    const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.5, 14);
    wheel.rotateZ(Math.PI / 2);
    addMesh(group, wheel, wheelMaterial, [x, 0.42, z], "track");
    const hub = new THREE.CylinderGeometry(0.16, 0.16, 0.54, 8);
    hub.rotateZ(Math.PI / 2);
    addMesh(group, hub, hubMaterial, [x, 0.42, z], "track");
  }

  for (const z of [-1.05, 0.3, 1.65]) {
    const roller = new THREE.CylinderGeometry(0.14, 0.14, 0.44, 8);
    roller.rotateZ(Math.PI / 2);
    addMesh(group, roller, wheelMaterial, [x, 1.14, z], "track");
  }
}

function buildGlacisEra(
  group: THREE.Group,
  material: THREE.Material,
  center: Vec,
  rotX: number,
  brick: Vec,
  cols: number,
  rows: number,
) {
  const cos = Math.cos(rotX);
  const sin = Math.sin(rotX);
  const geometry = new THREE.BoxGeometry(brick[0], brick[1], brick[2]);
  for (let row = 0; row < rows; row += 1) {
    const t = -0.72 + row * (1.45 / Math.max(1, rows - 1));
    for (let col = 0; col < cols; col += 1) {
      const x = (col - (cols - 1) / 2) * (brick[0] + 0.045);
      const localY = 0.09 + brick[1] * 0.5;
      const y = localY * cos - t * sin;
      const z = localY * sin + t * cos;
      addMesh(group, geometry.clone(), material, [center[0] + x, center[1] + y, center[2] + z], "glacis", [
        rotX,
        0,
        0,
      ]);
    }
  }
}

function buildTurretEraArc(
  turret: THREE.Group,
  material: THREE.Material,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  height: number,
  count: number,
) {
  const geometry = new THREE.BoxGeometry(0.36, 0.3, 0.14);
  for (let index = 0; index < count; index += 1) {
    const angle = -0.95 + (index / (count - 1)) * 1.9;
    const x = Math.sin(angle) * radiusX;
    const z = centerZ - Math.cos(angle) * radiusZ;
    const zone: ZoneId = Math.abs(angle) < 0.62 ? "turretFront" : "turretSide";
    addMesh(turret, geometry.clone(), material, [x, height, z], zone, [0, -angle, 0]);
  }
}

export function createTank(
  type: TankType,
  id: number,
  position: THREE.Vector3,
  marking: THREE.Texture,
): TankBuild {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = (id % 2 ? -0.1 : 0.12) + Math.sin(position.z) * 0.08;
  group.userData.targetId = id;

  const seed = 4000 + id * 131 + (type === "T90" ? 77 : 0);
  const camo =
    type === "T90"
      ? makeCamoTexture(seed, "#5c6147", ["#3d4231", "#6f6b4d", "#4a4f39"])
      : makeCamoTexture(seed, "#4e5440", ["#343a2c", "#5f6349", "#424a35"]);
  const bump = makeArmorBumpTexture();
  const trackTexture = makeTrackTexture();

  const armor = new THREE.MeshStandardMaterial({
    map: camo,
    bumpMap: bump,
    bumpScale: 0.9,
    roughness: 0.8,
    metalness: 0.26,
  });
  const armorExtra = new THREE.MeshStandardMaterial({
    map: camo,
    bumpMap: bump,
    bumpScale: 0.6,
    roughness: 0.85,
    metalness: 0.22,
  });
  const dark = new THREE.MeshStandardMaterial({ color: "#1c1e1a", roughness: 0.9, metalness: 0.35 });
  const trackMaterial = new THREE.MeshStandardMaterial({
    map: trackTexture,
    color: "#8d8d85",
    roughness: 0.95,
    metalness: 0.5,
  });
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: "#26271f", roughness: 0.95, metalness: 0.15 });
  const hubMaterial = new THREE.MeshStandardMaterial({ color: "#55564c", roughness: 0.6, metalness: 0.65 });
  const markingMaterial = new THREE.MeshBasicMaterial({
    map: marking,
    side: THREE.DoubleSide,
    transparent: true,
  });

  // Note: armor & armorExtra deliberately get two separate canvas textures so
  // each can be swapped independently for the detailed external texture.
  for (const side of [-1, 1]) buildRunningGear(group, side, trackMaterial, wheelMaterial, hubMaterial);

  // Hull: lower tub, sloped upper glacis, roof plate, rear engine plate.
  addMesh(group, new THREE.BoxGeometry(3.0, 0.85, 6.3), armor, [0, 1.28, 0], "hullSide");
  addMesh(group, new THREE.BoxGeometry(2.95, 0.15, 1.95), armor, [0, 1.45, -2.05], "glacis", [-0.62, 0, 0]);
  addMesh(group, new THREE.BoxGeometry(2.9, 0.1, 3.7), armorExtra, [0, 1.76, 0.55], "roof");
  addMesh(group, new THREE.BoxGeometry(2.9, 0.82, 0.14), armor, [0, 1.3, 3.2], "engine");
  addMesh(group, new THREE.BoxGeometry(0.9, 0.1, 1.3), dark, [-0.85, 1.84, 2.35], "engine");
  addMesh(group, new THREE.BoxGeometry(0.9, 0.1, 1.3), dark, [0.85, 1.84, 2.35], "engine");
  for (const side of [-1, 1]) {
    addMesh(group, new THREE.BoxGeometry(0.5, 0.09, 6.1), armorExtra, [side * 1.76, 1.62, 0], "hullSide");
    // Fender-mounted stowage boxes.
    addMesh(group, new THREE.BoxGeometry(0.4, 0.3, 1.25), armorExtra, [side * 1.76, 1.85, -1.4], "hullSide");
  }

  // Headlights with a slight glow — picked up by the bloom pass.
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: "#c9d2bc",
    emissive: "#9fb07a",
    emissiveIntensity: 0.35,
    roughness: 0.25,
    metalness: 0.4,
  });
  for (const side of [-1, 1]) {
    const lamp = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10);
    lamp.rotateX(Math.PI / 2);
    addMesh(group, lamp, glassMaterial, [side * 1.15, 1.5, -3.16], "hullSide");
  }

  if (type === "T72B") {
    // External fuel drums at the stern.
    const drum = new THREE.CylinderGeometry(0.3, 0.3, 1.3, 10);
    drum.rotateZ(Math.PI / 2);
    addMesh(group, drum, armorExtra, [0.5, 1.95, 2.75], "engine");
    // Exhaust port on the left.
    addMesh(group, new THREE.BoxGeometry(0.42, 0.3, 0.5), dark, [-1.35, 1.55, 2.9], "engine");
    // Kontakt-1 bricks on the glacis.
    buildGlacisEra(group, armorExtra, [0, 1.45, -2.05], -0.62, [0.4, 0.08, 0.36], 6, 4);
  } else {
    // T-90A: side skirts with Kontakt-5 and slat detail.
    const skirt = new THREE.BoxGeometry(0.14, 0.62, 0.88);
    for (const side of [-1, 1]) {
      for (let index = 0; index < 7; index += 1) {
        const z = -2.55 + index * 0.92;
        addMesh(group, skirt.clone(), armorExtra, [side * 1.57, 1.22, z], "hullSide");
      }
    }
    addMesh(group, new THREE.BoxGeometry(0.42, 0.3, 0.5), dark, [-1.35, 1.55, 2.9], "engine");
    buildGlacisEra(group, armorExtra, [0, 1.45, -2.05], -0.62, [0.42, 0.1, 0.4], 6, 4);
  }

  // Turret on a rotation pivot so it can traverse towards the drone.
  const turret = new THREE.Group();
  turret.position.set(0, 1.95, 0.1);
  group.add(turret);

  const turretRadiusTop = type === "T90" ? 1.18 : 1.12;
  const turretRadiusBottom = type === "T90" ? 1.36 : 1.3;
  const main = new THREE.CylinderGeometry(turretRadiusTop, turretRadiusBottom, 0.7, type === "T90" ? 12 : 16);
  main.scale(1, 1, type === "T90" ? 1.06 : 1.12);
  addMesh(turret, main, armor, [0, 0.35, -0.25], "turretSide");

  addMesh(turret, new THREE.BoxGeometry(1.55, 0.52, 0.45), armor, [0, 0.3, -1.42], "turretFront", [0.07, 0, 0]);
  addMesh(turret, new THREE.BoxGeometry(0.72, 0.46, 0.4), armor, [0, 0.35, -1.66], "turretFront");

  // Gun: barrel + bore evacuator + muzzle collar.
  const barrelGeometry = new THREE.CylinderGeometry(0.075, 0.085, 4.3, 10);
  barrelGeometry.rotateX(Math.PI / 2);
  addMesh(turret, barrelGeometry, dark, [0, 0.36, -3.95], "barrel");
  const evacuator = new THREE.CylinderGeometry(0.13, 0.13, 0.85, 10);
  evacuator.rotateX(Math.PI / 2);
  addMesh(turret, evacuator, dark, [0, 0.36, -3.2], "barrel");
  addMesh(turret, new THREE.BoxGeometry(0.34, 0.3, 0.5), armorExtra, [0, 0.36, -1.9], "barrel");

  // Roof, hatches, optics.
  addMesh(turret, new THREE.CylinderGeometry(1.02, 1.02, 0.09, 14), armorExtra, [0, 0.73, -0.25], "roof");
  addMesh(turret, new THREE.CylinderGeometry(0.32, 0.32, 0.1, 10), dark, [0.45, 0.8, -0.05], "roof");
  addMesh(turret, new THREE.CylinderGeometry(0.3, 0.3, 0.1, 10), dark, [-0.5, 0.8, 0.35], "roof");
  addMesh(turret, new THREE.BoxGeometry(0.26, 0.2, 0.26), armorExtra, [-0.4, 0.88, -0.85], "roof");
  for (const side of [-1, 1]) {
    addMesh(turret, new THREE.BoxGeometry(0.3, 0.3, 0.95), armorExtra, [side * 1.14, 0.36, 0.42], "turretSide");
  }

  // Anti-aircraft machine gun on the commander cupola.
  addMesh(turret, new THREE.BoxGeometry(0.18, 0.16, 0.5), dark, [0.45, 0.96, -0.35], "barrel");
  const mgBarrel = new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6);
  mgBarrel.rotateX(Math.PI / 2);
  addMesh(turret, mgBarrel, dark, [0.45, 0.99, -0.85], "barrel");

  // Radio antenna.
  const antenna = new THREE.CylinderGeometry(0.016, 0.028, 1.7, 5);
  addMesh(turret, antenna, dark, [-0.85, 1.5, 0.75], "turretSide", [0.16, 0, 0.1]);

  if (type === "T72B") {
    buildTurretEraArc(turret, armorExtra, -0.25, 1.36, 1.52, 0.42, 7);
  } else {
    buildTurretEraArc(turret, armorExtra, -0.25, 1.42, 1.5, 0.4, 9);
    // Kontakt-5 boxes on the turret cheeks.
    for (const side of [-1, 1]) {
      addMesh(turret, new THREE.BoxGeometry(0.4, 0.42, 0.3), armorExtra, [side * 0.92, 0.38, -1.28], "turretFront", [
        0,
        side * 0.35,
        0,
      ]);
    }
    // Shtora electro-optical jammer "eyes".
    const shtoraMaterial = new THREE.MeshStandardMaterial({
      color: "#3a0d08",
      emissive: "#ff3216",
      emissiveIntensity: 2.6,
      roughness: 0.4,
      metalness: 0.1,
    });
    for (const side of [-1, 1]) {
      const eye = new THREE.CylinderGeometry(0.15, 0.15, 0.07, 12);
      eye.rotateX(Math.PI / 2);
      addMesh(turret, eye, shtoraMaterial, [side * 0.52, 0.3, -1.68], "turretFront");
    }
    const irst = new THREE.BoxGeometry(0.3, 0.22, 0.24);
    addMesh(turret, irst, dark, [0.05, 0.9, -0.95], "roof");
  }

  // Tactical marking on the turret roof (no shadow — it is a decal).
  const mark = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), markingMaterial);
  mark.position.set(0, 0.87, -0.05);
  mark.rotation.x = -Math.PI / 2;
  mark.userData.zone = "roof";
  mark.castShadow = false;
  mark.receiveShadow = false;
  turret.add(mark);

  group.traverse((object) => {
    object.userData.targetId = id;
  });

  return { group, turret, type, armorMaterials: [armor, armorExtra] };
}
