import type { Flat } from '../types';

export interface Solid {
  rings: Flat[]; // [outer, ...holes]
  h: number;
  minX: number; minZ: number; maxX: number; maxZ: number;
}
interface Circle { x: number; z: number; r: number; h: number }

const CELL = 20;

function pointInRing(x: number, z: number, p: Flat) {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export interface ResolveResult {
  /** height of the lowest solid we were pushed out of this step (for ledge climbing), Infinity if none */
  blockedBy: number;
}

/** Building footprints + tree trunks in a uniform grid, for the player and the camera. */
export class Collision {
  private cells = new Map<number, (Solid | Circle)[]>();

  private key(cx: number, cz: number) { return (cx + 10000) * 20000 + (cz + 10000); }

  private insert(item: Solid | Circle, minX: number, minZ: number, maxX: number, maxZ: number) {
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++)
      for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
        const k = this.key(cx, cz);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(item);
      }
  }

  addPolygon(outer: Flat, holes: Flat[] | undefined, h: number) {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      minX = Math.min(minX, outer[i]); maxX = Math.max(maxX, outer[i]);
      minZ = Math.min(minZ, outer[i + 1]); maxZ = Math.max(maxZ, outer[i + 1]);
    }
    const s: Solid = { rings: [outer, ...(holes ?? [])], h, minX, minZ, maxX, maxZ };
    this.insert(s, minX, minZ, maxX, maxZ);
  }

  addCircle(x: number, z: number, r: number, h: number) {
    this.insert({ x, z, r, h }, x - r, z - r, x + r, z + r);
  }

  private near(x: number, z: number) {
    return this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];
  }

  private inside(s: Solid, x: number, z: number) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) return false;
    if (!pointInRing(x, z, s.rings[0])) return false;
    for (let i = 1; i < s.rings.length; i++) if (pointInRing(x, z, s.rings[i])) return false;
    return true;
  }

  /** Highest roof under (x,z) that the feet are at or above (within `snap` metres). 0 = street level. */
  groundAt(x: number, z: number, feetY: number, snap = 0.35): number {
    let g = 0;
    for (const it of this.near(x, z)) {
      if ('rings' in it) {
        if (it.h > g && it.h <= feetY + snap && this.inside(it, x, z)) g = it.h;
      }
    }
    return g;
  }

  /** True if a point is inside something solid (used by the camera). */
  pointBlocked(x: number, y: number, z: number): boolean {
    for (const it of this.near(x, z)) {
      if ('rings' in it) { if (y < it.h && this.inside(it, x, z)) return true; }
    }
    return false;
  }

  /** Push a circle (x,z,r) out of everything taller than the feet. Mutates pos. */
  resolve(pos: { x: number; z: number }, r: number, feetY: number): ResolveResult {
    let blockedBy = Infinity;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (const it of this.near(pos.x, pos.z)) {
        if (!('rings' in it)) {
          if (feetY >= it.h) continue;
          const dx = pos.x - it.x, dz = pos.z - it.z;
          const d = Math.hypot(dx, dz), min = r + it.r;
          if (d < min && d > 1e-6) { pos.x = it.x + (dx / d) * min; pos.z = it.z + (dz / d) * min; moved = true; }
          continue;
        }
        if (feetY >= it.h - 0.05) continue;
        if (pos.x < it.minX - r || pos.x > it.maxX + r || pos.z < it.minZ - r || pos.z > it.maxZ + r) continue;
        // closest point on all ring edges
        let best = Infinity, bx = 0, bz = 0;
        for (const ring of it.rings) {
          const n = ring.length / 2;
          for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const ax = ring[i * 2], az = ring[i * 2 + 1], ex = ring[j * 2] - ax, ez = ring[j * 2 + 1] - az;
            const l2 = ex * ex + ez * ez;
            let t = l2 ? ((pos.x - ax) * ex + (pos.z - az) * ez) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = ax + t * ex, pz = az + t * ez;
            const d = (pos.x - px) ** 2 + (pos.z - pz) ** 2;
            if (d < best) { best = d; bx = px; bz = pz; }
          }
        }
        const d = Math.sqrt(best);
        const ins = this.inside(it, pos.x, pos.z);
        if (!ins && d >= r) continue;
        let nx = pos.x - bx, nz = pos.z - bz;
        const l = Math.hypot(nx, nz) || 1;
        nx /= l; nz /= l;
        if (ins) { nx = -nx; nz = -nz; }
        pos.x = bx + nx * r;
        pos.z = bz + nz * r;
        blockedBy = Math.min(blockedBy, it.h);
        moved = true;
      }
      if (!moved) break;
    }
    return { blockedBy };
  }
}
