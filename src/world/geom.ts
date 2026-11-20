import * as THREE from 'three';
import type { Flat } from '../types';

/** Accumulates triangles for one merged BufferGeometry. */
export class MeshBuilder {
  pos: number[] = [];
  nor: number[] = [];
  idx: number[] = [];
  col: number[] | null;
  extra: Record<string, { size: number; data: number[] }> = {};

  constructor(withColor = false, extra: Record<string, number> = {}) {
    this.col = withColor ? [] : null;
    for (const [k, size] of Object.entries(extra)) this.extra[k] = { size, data: [] };
  }
  get count() { return this.pos.length / 3; }

  vert(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0, c?: THREE.Color, ex?: Record<string, number[]>) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    if (this.col && c) this.col.push(c.r, c.g, c.b);
    if (ex) for (const k in ex) this.extra[k].data.push(...ex[k]);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }

  /** Adds a triangle and flips its winding if the geometric normal disagrees with the wanted normal. */
  triFacing(a: number, b: number, c: number, wx: number, wy: number, wz: number) {
    const p = this.pos;
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (nx * wx + ny * wy + nz * wz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (this.col) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    for (const [k, e] of Object.entries(this.extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(e.data, e.size));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Flat ribbon along a polyline with mitred joints and round end caps. */
export function ribbon(mb: MeshBuilder, p: Flat, width: number, y: number, caps = true, offset = 0) {
  const n = p.length / 2;
  if (n < 2) return;
  const half = width / 2;
  const left: number[] = [];
  for (let i = 0; i < n; i++) {
    // segment normals (left side = (-dz, dx))
    let nx = 0, nz = 0;
    const segN = (a: number, b: number) => {
      const dx = p[b * 2] - p[a * 2], dz = p[b * 2 + 1] - p[a * 2 + 1];
      const l = Math.hypot(dx, dz) || 1;
      return [-dz / l, dx / l];
    };
    let n0: number[] | null = null, n1: number[] | null = null;
    if (i > 0) n0 = segN(i - 1, i);
    if (i < n - 1) n1 = segN(i, i + 1);
    if (n0 && n1) {
      nx = n0[0] + n1[0]; nz = n0[1] + n1[1];
      const l = Math.hypot(nx, nz);
      if (l < 1e-3) { nx = n1[0]; nz = n1[1]; }
      else {
        nx /= l; nz /= l;
        const d = nx * n1[0] + nz * n1[1];
        const m = Math.min(1 / Math.max(d, 0.25), 3);
        nx *= m; nz *= m;
      }
    } else { const s = (n0 ?? n1)!; nx = s[0]; nz = s[1]; }
    const cx = p[i * 2] + nx * offset, cz = p[i * 2 + 1] + nz * offset;
    left.push(
      mb.vert(cx + nx * half, y, cz + nz * half),
      mb.vert(cx - nx * half, y, cz - nz * half),
    );
  }
  for (let i = 0; i < n - 1; i++) {
    const a = left[i * 2], b = left[i * 2 + 1], c = left[i * 2 + 2], d = left[i * 2 + 3];
    mb.triFacing(a, b, c, 0, 1, 0);
    mb.triFacing(b, d, c, 0, 1, 0);
  }
  if (caps && offset === 0) {
    disc(mb, p[0], p[1], half, y);
    disc(mb, p[(n - 1) * 2], p[(n - 1) * 2 + 1], half, y);
  }
}

export function disc(mb: MeshBuilder, x: number, z: number, r: number, y: number, seg = 10) {
  const c = mb.vert(x, y, z);
  const first = mb.count;
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    mb.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r);
  }
  for (let i = 0; i < seg; i++) mb.triFacing(c, first + i, first + ((i + 1) % seg), 0, 1, 0);
}

/** Dashed centre line along a polyline. */
export function dashes(mb: MeshBuilder, p: Flat, width: number, y: number, dash: number, gap: number) {
  let carry = 0;
  for (let i = 0; i < p.length / 2 - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    let s = carry;
    while (s < L) {
      const e = Math.min(s + dash, L);
      if (e - s > 0.3) ribbon(mb, [ax + ux * s, az + uz * s, ax + ux * e, az + uz * e], width, y, false);
      s += dash + gap;
    }
    carry = s - L;
  }
}

/** Flat polygon (with holes) at height y. */
export function flatPolygon(mb: MeshBuilder, outer: Flat, holes: Flat[] | undefined, y: number, c?: THREE.Color) {
  const toV = (f: Flat) => {
    const v: THREE.Vector2[] = [];
    for (let i = 0; i < f.length; i += 2) v.push(new THREE.Vector2(f[i], f[i + 1]));
    return v;
  };
  const contour = toV(outer);
  const hs = (holes ?? []).map(toV);
  let tris: number[][];
  try { tris = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { return; }
  const base = mb.count;
  for (const v of [contour, ...hs].flat()) mb.vert(v.x, y, v.y, 0, 1, 0, c);
  for (const t of tris) mb.triFacing(base + t[0], base + t[1], base + t[2], 0, 1, 0);
}

/**
 * Instances split into square chunks so the frustum culls the ones off screen.
 * `place(i, m4)` writes the matrix of item i; `color(i, c)` (optional) its colour.
 */
export function chunkedInstances<T extends { x: number; z: number }>(
  items: T[], geo: THREE.BufferGeometry, mat: THREE.Material, chunk: number,
  place: (item: T, m4: THREE.Matrix4) => void, color?: (item: T, c: THREE.Color) => void,
): THREE.InstancedMesh[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = `${Math.floor(it.x / chunk)},${Math.floor(it.z / chunk)}`;
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(it);
  }
  const out: THREE.InstancedMesh[] = [];
  const m4 = new THREE.Matrix4(), c = new THREE.Color();
  for (const list of groups.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => {
      place(it, m4);
      mesh.setMatrixAt(i, m4);
      if (color) { color(it, c); mesh.setColorAt(i, c); }
    });
    mesh.computeBoundingSphere();
    out.push(mesh);
  }
  return out;
}
