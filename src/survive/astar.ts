// ============================================================
// GREY CORRIDOR — A* navigation over vendored PathFinding.js (MIT)
// Grid is baked once per zone from colliders; finders run on clones.
// ============================================================
import * as THREE from 'three';
import Grid from './pf/Grid';
import AStarFinder from './pf/AStarFinder';
import type { BoxCollider } from './world';

export interface NavGrid {
  grid: unknown;
  finder: unknown;
  bounds: number;
  cell: number;
  n: number;
}

/** Bake a walkable grid: cells whose center falls inside a collider (+margin) are blocked. */
export function buildNavGrid(colliders: BoxCollider[], bounds: number, cell = 2): NavGrid {
  const n = Math.max(8, Math.ceil((bounds * 2) / cell));
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const G = Grid as any;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
  const F = AStarFinder as any;
  const grid = new G(n, n) as {
    setWalkableAt: (x: number, y: number, v: boolean) => void;
    clone: () => unknown;
  };
  for (let gy = 0; gy < n; gy++) {
    for (let gx = 0; gx < n; gx++) {
      const wx = -bounds + (gx + 0.5) * cell;
      const wz = -bounds + (gy + 0.5) * cell;
      for (const c of colliders) {
        if (wx > c.x0 - 0.7 && wx < c.x1 + 0.7 && wz > c.z0 - 0.7 && wz < c.z1 + 0.7) {
          grid.setWalkableAt(gx, gy, false);
          break;
        }
      }
    }
  }
  const finder = new F({ allowDiagonal: true, dontCrossCorners: true }) as {
    findPath: (ax: number, ay: number, bx: number, by: number, g: unknown) => Array<[number, number]>;
  };
  return { grid, finder, bounds, cell, n };
}

function toCell(nav: NavGrid, x: number, z: number): [number, number] {
  const gx = Math.max(0, Math.min(nav.n - 1, Math.floor((x + nav.bounds) / nav.cell)));
  const gz = Math.max(0, Math.min(nav.n - 1, Math.floor((z + nav.bounds) / nav.cell)));
  return [gx, gz];
}

/** A* route in world coords (start excluded). Empty array = no route; falls back to direct steering. */
export function findNavPath(nav: NavGrid, sx: number, sz: number, tx: number, tz: number): THREE.Vector3[] {
  try {
    const [ax, ay] = toCell(nav, sx, sz);
    const [bx, by] = toCell(nav, tx, tz);
    if (ax === bx && ay === by) return [new THREE.Vector3(tx, 0, tz)];
    const grid = nav.grid as { clone: () => unknown };
    const finder = nav.finder as {
      findPath: (ax: number, ay: number, bx: number, by: number, g: unknown) => Array<[number, number]>;
    };
    const raw = finder.findPath(ax, ay, bx, by, grid.clone());
    if (!raw || raw.length < 2) return [];
    const out: THREE.Vector3[] = [];
    for (let i = 1; i < raw.length; i++) {
      out.push(
        new THREE.Vector3(-nav.bounds + (raw[i][0] + 0.5) * nav.cell, 0, -nav.bounds + (raw[i][1] + 0.5) * nav.cell),
      );
    }
    return out;
  } catch {
    return [];
  }
}
