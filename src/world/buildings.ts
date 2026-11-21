import * as THREE from 'three';
import { addLampLight } from './lamplight';
import type { Building, CityData, Flat } from '../types';
import { BUILDING_STYLES, ROAD_TYPES } from '../types';
import { MeshBuilder, chunkedInstances } from './geom';

// Buildings are built in 250 m chunks, in full detail only near the player (streamed in and out as you
// move), with a cheap box per building standing in for everything further away.
const CHUNK = 250;
const DETAIL_IN = 520; // build full detail for chunks closer than this (m, to the chunk edge)
const DETAIL_OUT = 760; // and drop it again beyond this

// Colombo street colours: whitewash and cream, sun-faded pastels, ochre, terracotta, mint and
// sky blue; colonial buildings in buff, cream and red brick.
const PALETTES: Record<string, number[]> = {
  plain: [0xeeeae0, 0xe9dfc4, 0xd8c7a0, 0xdcd6c8, 0xcfc9bd, 0xe6e0d2, 0xbfbcb4, 0xe4d6b6],
  pastel: [0xd9a95b, 0xc4734f, 0xe2a58f, 0xb9d8c2, 0x9fcfcf, 0xa9c6dd, 0xeedc8e, 0xc8b7d6, 0xe8b9a0, 0x9cc7a4],
  glass: [0x8fa3b3, 0x6f8494, 0xa9b6bf, 0x5d6f7c, 0x7f97a6, 0xb4bcc2],
  colonial: [0xefe6cf, 0xe3cf9f, 0xd2b07a, 0xf3eddc, 0xb8613f, 0xe8d8a8, 0xc9d6c4],
  house: [0xf2efe6, 0xe8dcc0, 0xd7e3d0, 0xe9d6c4, 0xf0e2a8, 0xdfe7ea, 0xe8cfc0, 0xb9d8c2, 0xe2a58f, 0xa9c6dd],
};
const TILE = [0xb5583b, 0xa64d33, 0xc0663f, 0x9c4a35];

// aWall.z tags what a vertex belongs to, for the shader:
// 0 flat roof / ledge, 1 facade, 2 parapet, 3 clay tile roof, 4 corrugated sheet awning, 5 balcony front
const ROOF = 0, FACADE = 1, PARAPET = 2, TILES = 3, SHEET = 4, BALC = 5;
// aSeed.y style for the shader: 0 plain, 1 glass curtain wall, 2 colonial, 3 house, 4 ribbon-window tower
const TOWER = 4;
// awning sheets: zinc, rusty zinc, blue and green tarps, red and yellow painted metal, asbestos grey, cyan
const SHEETS = [0x8f8a80, 0x7a5a44, 0x2f6fb0, 0x2f7a4a, 0xa8322a, 0xd9a52b, 0xa9a49a, 0x3b8fb3];

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function area(p: Flat) {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}
function inside(x: number, z: number, p: Flat) {
  let c = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

export interface BuildingMeshes {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  /** 0 = day, 1 = night (window lights) */
  setNight(v: number): void;
  /** stream detail in and out around (x,z); builds at most `budget` chunks this call */
  update(x: number, z: number, budget?: number): void;
  /** how many chunks are built in full detail */
  readonly detailChunks: number;
}

export function buildBuildings(city: CityData): BuildingMeshes {
  // the chunk being built right now (addBuilding writes into it)
  let curMb: MeshBuilder | null = null;
  const getMb = (_x: number, _z: number) => curMb!;

  const wallCol = new THREE.Color();
  const roofCol = new THREE.Color();
  const ledgeCol = new THREE.Color();
  let tanks: { x: number; y: number; z: number; blue: boolean; s: number }[] = [];

  // road centre lines on a coarse grid, to find which walls face a street and how much pavement is in front
  const RC = 30;
  const roadGrid = new Map<number, number[]>(); // per cell: ax, az, bx, bz, half width, repeated
  const rkey = (cx: number, cz: number) => (cx + 5000) * 10000 + cz + 5000;
  for (const rd of city.roads) {
    if (ROAD_TYPES[rd.t] === 'footway') continue;
    for (let k = 0; k + 3 < rd.p.length; k += 2) {
      const ax = rd.p[k], az = rd.p[k + 1], bx = rd.p[k + 2], bz = rd.p[k + 3];
      const x0 = Math.floor((Math.min(ax, bx) - 10) / RC), x1 = Math.floor((Math.max(ax, bx) + 10) / RC);
      const z0 = Math.floor((Math.min(az, bz) - 10) / RC), z1 = Math.floor((Math.max(az, bz) + 10) / RC);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        let c = roadGrid.get(rkey(gx, gz));
        if (!c) roadGrid.set(rkey(gx, gz), (c = []));
        c.push(ax, az, bx, bz, rd.w / 2);
      }
    }
  }
  const onRoad = (x: number, z: number) => {
    const c = roadGrid.get(rkey(Math.floor(x / RC), Math.floor(z / RC)));
    if (!c) return false;
    for (let k = 0; k < c.length; k += 5) {
      const ax = c[k], az = c[k + 1], dx = c[k + 2] - ax, dz = c[k + 3] - az;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < c[k + 4]) return true;
    }
    return false;
  };
  /** metres of open ground between a wall (midpoint, outward normal) and the road edge; 0 = no road in front */
  const streetGap = (mx: number, mz: number, nx: number, nz: number) => {
    for (let t = 0.5; t <= 12; t += 0.5) if (onRoad(mx + nx * t, mz + nz * t)) return t;
    return 0;
  };

  // which buildings belong to which chunk (by centroid)
  interface Chunk { key: string; cx: number; cz: number; ids: number[]; detail: THREE.Object3D[] | null; lod: THREE.InstancedMesh | null }
  const chunkMap = new Map<string, Chunk>();
  city.buildings.forEach((b, i) => {
    const n = b.p.length / 2;
    let x = 0, z = 0;
    for (let k = 0; k < n; k++) { x += b.p[k * 2]; z += b.p[k * 2 + 1]; }
    x /= n; z /= n;
    const gx = Math.floor(x / CHUNK), gz = Math.floor(z / CHUNK), key = `${gx},${gz}`;
    let c = chunkMap.get(key);
    if (!c) chunkMap.set(key, (c = { key, cx: (gx + 0.5) * CHUNK, cz: (gz + 0.5) * CHUNK, ids: [], detail: null, lod: null }));
    c.ids.push(i);
  });

  function addBuilding(b: Building, i: number) {
    const style = BUILDING_STYLES[b.s];
    const r0 = hash(i + 0.13), r1 = hash(i + 7.7), r2 = hash(i + 3.3), r3 = hash(i + 5.1);
    const pastel = (style === 'plain' && r0 < 0.42) || (style === 'house' && r0 < 0.3);
    const pal = pastel ? PALETTES.pastel : PALETTES[style];
    wallCol.setHex(pal[Math.floor(r1 * pal.length)]);
    wallCol.offsetHSL(0, -0.03 * r2, (r2 - 0.5) * 0.07);
    roofCol.setHex(0x9a958c).offsetHSL(0, 0, (r1 - 0.5) * 0.12);
    ledgeCol.copy(wallCol).lerp(new THREE.Color(0xd8d4cc), 0.35);

    const n = b.p.length / 2;
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += b.p[k * 2]; cz += b.p[k * 2 + 1]; }
    cx /= n; cz /= n;
    const mb = getMb(cx, cz);
    // tall plain buildings are modern towers: some full curtain wall, the rest ribbon windows
    const tower = b.h >= 40 && style !== 'colonial' && style !== 'glass';
    const seed = [hash(i * 1.37), tower ? (r3 < 0.35 ? 1 : TOWER) : b.s];
    const A = area(b.p);
    const shop = style === 'plain' && b.h < 18;
    const flats = (style === 'plain' || style === 'house') && b.h >= 13 && b.h < 40 && A > 120;

    // small houses (and some low colonial buildings) get red clay tile hip roofs
    const hip = !b.holes?.length && n <= 12 && A < 360 && b.h < 11 &&
      (style === 'house' || (style === 'colonial' && r3 < 0.5) || (style === 'plain' && b.h < 7 && r3 < 0.35));
    if (shop && !hip) shopFronts(mb, b.p, b.h, wallCol, seed, i);
    else walls(mb, b.p, b.h, wallCol, seed, !hip);
    for (const ring of b.holes ?? []) walls(mb, ring, b.h, wallCol, seed, !hip);
    if (style === 'colonial' && b.h >= 6.5 && !hip) arcade(mb, b.p, wallCol, seed);
    if (flats && r2 < 0.75) balconies(mb, b.p, b.h, ledgeCol, seed, i);
    if (hip) {
      roofCol.setHex(TILE[Math.floor(r2 * TILE.length)]).offsetHSL(0, 0, (r3 - 0.5) * 0.06);
      hipRoof(mb, b.p, b.h, cx, cz, A, roofCol, seed);
    } else {
      roof(mb, b.p, b.holes, b.h, roofCol, seed);
      // stairwell head-room box on flat roofs (every Colombo walk-up has one), plant rooms on towers
      if (b.h > 5 && A > 70 && r2 > 0.2) stairBox(mb, b.p, b.h, cx, cz, tower ? 0.42 : 0, ledgeCol, roofCol, seed);
      // a water tank on the roof of most low and mid-rise buildings
      if (b.h < 32 && style !== 'glass' && r3 < 0.62) {
        for (let k = 0; k < n; k++) {
          const tx = cx + (b.p[k * 2] - cx) * 0.45, tz = cz + (b.p[k * 2 + 1] - cz) * 0.45;
          if (inside(tx, tz, b.p)) { tanks.push({ x: tx, y: b.h, z: tz, blue: r1 < 0.45, s: 0.8 + r2 * 0.5 }); break; }
        }
      }
    }
    // concrete sunshade ledges over each floor's windows, typical of Sri Lankan buildings
    if ((style === 'plain' || style === 'house') && b.h < 26 && b.h > 3.2) ledges(mb, b.p, b.h, ledgeCol, seed);
  }

  // one vertical quad from (ax,az) to (bx,bz), outward normal (nx,nz), u = distance along the wall
  function quad(mb: MeshBuilder, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number,
    c: THREE.Color, tag: number, seed: number[], u = 0, uy0 = y0) {
    const L = Math.hypot(bx - ax, bz - az);
    const a0 = mb.vert(ax, y0, az, nx, 0, nz, c, { aWall: [u, uy0, tag], aSeed: seed });
    const b0 = mb.vert(bx, y0, bz, nx, 0, nz, c, { aWall: [u + L, uy0, tag], aSeed: seed });
    const b1 = mb.vert(bx, y1, bz, nx, 0, nz, c, { aWall: [u + L, uy0 + y1 - y0, tag], aSeed: seed });
    const a1 = mb.vert(ax, y1, az, nx, 0, nz, c, { aWall: [u, uy0 + y1 - y0, tag], aSeed: seed });
    mb.triFacing(a0, b0, b1, nx, 0, nz);
    mb.triFacing(a0, b1, a1, nx, 0, nz);
  }
  // a horizontal quad from four corners [x, y, z, (u, v)]
  function flat(mb: MeshBuilder, pts: number[][], ny: number, c: THREE.Color, tag: number, seed: number[]) {
    const v = pts.map((p) => mb.vert(p[0], p[1], p[2], 0, ny, 0, c, { aWall: [p[3] ?? p[0], p[4] ?? p[2], tag], aSeed: seed }));
    mb.triFacing(v[0], v[1], v[2], 0, ny, 0);
    mb.triFacing(v[0], v[2], v[3], 0, ny, 0);
  }
  // a box between y0 and y1 on a w x d rectangle centred on (x,z), long side along (dx,dz)
  function box(mb: MeshBuilder, x: number, z: number, dx: number, dz: number, w: number, d: number, y0: number, y1: number,
    c: THREE.Color, sideTag: number, seed: number[], topCol = c) {
    const px = -dz, pz = dx;
    const cs = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [x + dx * (w / 2) * a + px * (d / 2) * b, z + dz * (w / 2) * a + pz * (d / 2) * b]);
    let u = 0;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = cs[k], [bx, bz] = cs[(k + 1) % 4];
      const L = Math.hypot(bx - ax, bz - az) || 1;
      let nx = (bz - az) / L, nz = -(bx - ax) / L;
      if (nx * ((ax + bx) / 2 - x) + nz * ((az + bz) / 2 - z) < 0) { nx = -nx; nz = -nz; }
      quad(mb, ax, az, bx, bz, y0, y1, nx, nz, c, sideTag, seed, u);
      u += L;
    }
    flat(mb, cs.map(([a, b]) => [a, y1, b]), 1, topCol, ROOF, seed);
  }

  /**
   * Low commercial buildings: the street front is a row of narrow shophouses, each with its own
   * paint colour, a false-front parapet of its own height and often an awning over the pavement.
   */
  function shopFronts(mb: MeshBuilder, ring: Flat, h: number, base: THREE.Color, seed: number[], bi: number) {
    const n = ring.length / 2;
    let u = 0;
    const plotCol = new THREE.Color(), sheet = new THREE.Color();
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L, tx = (bx - ax) / L, tz = (bz - az) / L;
      const gap = L > 4 ? streetGap((ax + bx) / 2, (az + bz) / 2, nx, nz) : 0;
      const top = h + 0.85;
      if (!gap) {
        // side and back walls: plain, as before
        quad(mb, ax, az, bx, bz, -0.3, h, nx, nz, base, FACADE, seed, u);
        quad(mb, ax, az, bx, bz, h, top, nx, nz, base, PARAPET, seed, u);
        quad(mb, ax, az, bx, bz, h, top, -nx, -nz, base, PARAPET, seed, u);
        u += L;
        continue;
      }
      // split the street front into plots 4 to 7 m wide
      const plots: number[] = [0];
      let t = 0, q = 0;
      while (t < L) {
        const w = 4 + hash(bi * 13.1 + k * 3.7 + q++) * 3;
        t = L - t - w < 2.5 ? L : t + w;
        plots.push(Math.min(t, L));
      }
      for (let pi = 0; pi + 1 < plots.length; pi++) {
        const s0 = plots[pi], s1 = plots[pi + 1];
        const hr = hash(bi * 7.3 + k * 11.1 + pi * 1.7), hr2 = hash(bi * 3.1 + k * 5.3 + pi * 9.1);
        const x0 = ax + tx * s0, z0 = az + tz * s0, x1 = ax + tx * s1, z1 = az + tz * s1;
        if (hr < 0.45) plotCol.copy(base).offsetHSL((hr2 - 0.5) * 0.06, 0, (hr - 0.22) * 0.12);
        else {
          const pal = hr2 < 0.55 ? PALETTES.pastel : PALETTES.plain;
          plotCol.setHex(pal[Math.floor(hash(hr * 91 + hr2) * pal.length)]).offsetHSL(0, -0.03, (hr2 - 0.5) * 0.06);
        }
        // false front: each shop's parapet a different height
        const pTop = h + 0.6 + hr2 * 1.7;
        quad(mb, x0, z0, x1, z1, -0.3, h, nx, nz, plotCol, FACADE, seed, u + s0);
        quad(mb, x0, z0, x1, z1, h, pTop, nx, nz, plotCol, PARAPET, seed, u + s0);
        // side returns, so steps between neighbouring parapets aren't paper thin
        for (const [ex, ez, sgn] of [[x0, z0, -1], [x1, z1, 1]] as const) {
          quad(mb, ex, ez, ex - nx * 0.25, ez - nz * 0.25, h, pTop, tx * sgn, tz * sgn, plotCol, PARAPET, seed, 0);
        }
        flat(mb, [[x0, pTop, z0], [x1, pTop, z1], [x1 - nx * 0.25, pTop, z1 - nz * 0.25], [x0 - nx * 0.25, pTop, z0 - nz * 0.25]], 1, plotCol, ROOF, seed);
        // awning over the shop front
        const depth = Math.min(2.2, gap - 0.6);
        if (hr > 0.28 && depth > 0.7 && s1 - s0 > 2) {
          sheet.setHex(SHEETS[Math.floor(hash(hr2 * 77 + hr) * SHEETS.length)]);
          awning(mb, x0, z0, x1, z1, nx, nz, depth, sheet, seed, hr2 < 0.4);
        }
      }
      u += L;
    }
  }

  /** a sloping sheet awning over the pavement at the top of the ground floor; deep ones stand on thin posts */
  function awning(mb: MeshBuilder, x0: number, z0: number, x1: number, z1: number, nx: number, nz: number, depth: number,
    c: THREE.Color, seed: number[], posts: boolean) {
    const yIn = 2.45, yOut = 2.1, ox = nx * depth, oz = nz * depth;
    const tx = x1 - x0, tz = z1 - z0, L = Math.hypot(tx, tz);
    const ix = (tx / L) * 0.15, iz = (tz / L) * 0.15;
    const p = [[x0 + ix, yIn, z0 + iz, 0, 0], [x1 - ix, yIn, z1 - iz, L, 0], [x1 - ix + ox, yOut, z1 - iz + oz, L, depth], [x0 + ix + ox, yOut, z0 + iz + oz, 0, depth]];
    const v = p.map((q) => mb.vert(q[0], q[1], q[2], nx * 0.15, 1, nz * 0.15, c, { aWall: [q[3], q[4], SHEET], aSeed: seed }));
    mb.triFacing(v[0], v[1], v[2], 0, 1, 0); mb.triFacing(v[0], v[2], v[3], 0, 1, 0);
    const w = p.map((q) => mb.vert(q[0], q[1] - 0.03, q[2], 0, -1, 0, c, { aWall: [q[3], q[4], SHEET], aSeed: seed }));
    mb.triFacing(w[0], w[1], w[2], 0, -1, 0); mb.triFacing(w[0], w[2], w[3], 0, -1, 0);
    quad(mb, p[3][0], p[3][2], p[2][0], p[2][2], yOut - 0.18, yOut, nx, nz, c, SHEET, seed, 0, 0);
    if (posts && depth > 1.3) {
      const pc = new THREE.Color(0x5a5650);
      const cnt = Math.max(2, Math.round(L / 3.2) + 1);
      for (let k = 0; k < cnt; k++) {
        const f = k / (cnt - 1);
        const px = p[3][0] + (p[2][0] - p[3][0]) * f - nx * 0.06, pz = p[3][2] + (p[2][2] - p[3][2]) * f - nz * 0.06;
        box(mb, px, pz, tx / L, tz / L, 0.07, 0.07, 0, yOut, pc, ROOF, seed);
      }
    }
  }

  /** colonial street fronts: a deep verandah on columns along the pavement, balustrade above (Fort, Pettah) */
  function arcade(mb: MeshBuilder, ring: Flat, c: THREE.Color, seed: number[]) {
    const n = ring.length / 2;
    const slab = new THREE.Color().copy(c).lerp(new THREE.Color(0xf2efe6), 0.4);
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 9) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L, tx = (bx - ax) / L, tz = (bz - az) / L;
      const gap = streetGap((ax + bx) / 2, (az + bz) / 2, nx, nz);
      const D = Math.min(3.0, gap - 0.4);
      if (!gap || D < 1.8) continue;
      const y = 4.2, ox = nx * D, oz = nz * D;
      flat(mb, [[ax, y + 0.35, az], [bx, y + 0.35, bz], [bx + ox, y + 0.35, bz + oz], [ax + ox, y + 0.35, az + oz]], 1, slab, ROOF, seed);
      flat(mb, [[ax, y, az], [bx, y, bz], [bx + ox, y, bz + oz], [ax + ox, y, az + oz]], -1, slab, ROOF, seed);
      quad(mb, ax + ox, az + oz, bx + ox, bz + oz, y, y + 0.35, nx, nz, slab, PARAPET, seed, 0);
      quad(mb, ax + ox, az + oz, bx + ox, bz + oz, y + 0.35, y + 1.25, nx, nz, c, BALC, seed, 0, 0);
      quad(mb, ax + ox, az + oz, bx + ox, bz + oz, y + 0.35, y + 1.25, -nx, -nz, c, BALC, seed, 0, 0);
      const cnt = Math.max(2, Math.round(L / 3.6));
      for (let q = 0; q < cnt; q++) {
        const f = (q + 0.5) / cnt;
        const px = ax + tx * L * f + nx * (D - 0.3), pz = az + tz * L * f + nz * (D - 0.3);
        box(mb, px, pz, tx, tz, 0.42, 0.42, 0, y, slab, ROOF, seed);
        box(mb, px, pz, tx, tz, 0.6, 0.6, 0, 0.45, slab, ROOF, seed);
      }
    }
  }

  /** apartment balconies: slab with a solid or railing front, on the long or street-facing walls of each floor */
  function balconies(mb: MeshBuilder, ring: Flat, h: number, c: THREE.Color, seed: number[], bi: number) {
    const n = ring.length / 2;
    const railing = hash(bi * 2.9) < 0.45;
    const front = new THREE.Color().copy(c).offsetHSL(0, 0, railing ? 0 : -0.04);
    const bseed = [seed[0], railing ? 1 : 0];
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 7) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L, tx = (bx - ax) / L, tz = (bz - az) / L;
      const gap = streetGap((ax + bx) / 2, (az + bz) / 2, nx, nz);
      if (!gap) continue; // only onto a street, never onto a neighbour's wall
      const D = 1.15;
      const runs: [number, number][] = L > 18 ? [[0.08, 0.46], [0.54, 0.92]] : [[0.15, 0.85]];
      for (let y = 3.4; y < h - 2.5; y += 3.4) {
        for (const [f0, f1] of runs) {
          const x0 = ax + tx * L * f0, z0 = az + tz * L * f0, x1 = ax + tx * L * f1, z1 = az + tz * L * f1;
          const ox = nx * D, oz = nz * D, w = L * (f1 - f0);
          flat(mb, [[x0, y, z0], [x1, y, z1], [x1 + ox, y, z1 + oz], [x0 + ox, y, z0 + oz]], 1, c, ROOF, seed);
          flat(mb, [[x0, y - 0.16, z0], [x1, y - 0.16, z1], [x1 + ox, y - 0.16, z1 + oz], [x0 + ox, y - 0.16, z0 + oz]], -1, c, ROOF, seed);
          quad(mb, x0 + ox, z0 + oz, x1 + ox, z1 + oz, y - 0.16, y + 1.05, nx, nz, front, BALC, bseed, 0, -0.16);
          quad(mb, x0, z0, x0 + ox, z0 + oz, y - 0.16, y + 1.05, -tx, -tz, front, BALC, bseed, w, -0.16);
          quad(mb, x1 + ox, z1 + oz, x1, z1, y - 0.16, y + 1.05, tx, tz, front, BALC, bseed, w, -0.16);
        }
      }
    }
  }

  /** the stairwell head-room box on a flat roof, or a plant-room crown on a tower (scale = share of the footprint) */
  function stairBox(mb: MeshBuilder, ring: Flat, h: number, cx: number, cz: number, scale: number, c: THREE.Color, top: THREE.Color, seed: number[]) {
    const n = ring.length / 2;
    let best = 0, dx = 1, dz = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n, ex = ring[j * 2] - ring[k * 2], ez = ring[j * 2 + 1] - ring[k * 2 + 1], L = Math.hypot(ex, ez);
      if (L > best) { best = L; dx = ex / L; dz = ez / L; }
    }
    if (scale > 0) {
      const crown: number[] = [];
      for (let k = 0; k < n; k++) crown.push(cx + (ring[k * 2] - cx) * scale, cz + (ring[k * 2 + 1] - cz) * scale);
      walls(mb, crown, h + 4.5, c, [seed[0], 0], true, PARAPET, h);
      roof(mb, crown, undefined, h + 4.5, top, seed);
      return;
    }
    for (const f of [0.45, 0.25, 0]) {
      const x = cx + (ring[0] - cx) * f, z = cz + (ring[1] - cz) * f;
      const ok = [[1.6, 1.6], [-1.6, 1.6], [-1.6, -1.6], [1.6, -1.6]].every(([a, b]) => inside(x + dx * a - dz * b, z + dz * a + dx * b, ring));
      if (ok) { box(mb, x, z, dx, dz, 2.8, 2.6, h, h + 2.6, c, PARAPET, seed, top); return; }
    }
  }

  function walls(mb: MeshBuilder, ring: Flat, h: number, c: THREE.Color, seed: number[], parapet: boolean, tagFacade = FACADE, y0 = -0.3) {
    const n = ring.length / 2;
    let u = 0;
    const top = parapet ? h + 0.85 : h;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      // outward normal for a positive-area ring is (dz, -dx); holes are stored negative, so the same formula points into the courtyard
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const quad = (y0: number, y1: number, tag: number, sx: number, sz: number) => {
        const a0 = mb.vert(ax, y0, az, sx, 0, sz, c, { aWall: [u, y0, tag], aSeed: seed });
        const b0 = mb.vert(bx, y0, bz, sx, 0, sz, c, { aWall: [u + L, y0, tag], aSeed: seed });
        const b1 = mb.vert(bx, y1, bz, sx, 0, sz, c, { aWall: [u + L, y1, tag], aSeed: seed });
        const a1 = mb.vert(ax, y1, az, sx, 0, sz, c, { aWall: [u, y1, tag], aSeed: seed });
        mb.triFacing(a0, b0, b1, sx, 0, sz);
        mb.triFacing(a0, b1, a1, sx, 0, sz);
      };
      quad(y0, h, tagFacade, nx, nz);
      if (parapet) {
        quad(h, top, PARAPET, nx, nz); // outside
        quad(h, top, PARAPET, -nx, -nz); // inside face, seen from the roof
      }
      u += L;
    }
  }

  function roof(mb: MeshBuilder, outer: Flat, holes: Flat[] | undefined, h: number, c: THREE.Color, seed: number[]) {
    const toV = (f: Flat) => {
      const v: THREE.Vector2[] = [];
      for (let k = 0; k < f.length; k += 2) v.push(new THREE.Vector2(f[k], f[k + 1]));
      return v;
    };
    const contour = toV(outer);
    const hs = (holes ?? []).map(toV);
    let tris: number[][];
    try { tris = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { return; }
    const base = mb.count;
    for (const v of [contour, ...hs].flat()) mb.vert(v.x, h, v.y, 0, 1, 0, c, { aWall: [v.x, v.y, ROOF], aSeed: seed });
    for (const t of tris) mb.triFacing(base + t[0], base + t[1], base + t[2], 0, 1, 0);
  }

  /** A hip roof: eaves overhanging the walls, sloping up to a small flat ridge area. */
  function hipRoof(mb: MeshBuilder, ring: Flat, h: number, cx: number, cz: number, A: number, c: THREE.Color, seed: number[]) {
    const n = ring.length / 2;
    const rise = THREE.MathUtils.clamp(Math.sqrt(A) * 0.17, 1.1, 2.5);
    const eave: number[] = [], top: number[] = [];
    for (let k = 0; k < n; k++) {
      const px = ring[k * 2], pz = ring[k * 2 + 1];
      const d = Math.hypot(px - cx, pz - cz) || 1;
      const s = 1 + 0.5 / d;
      eave.push(cx + (px - cx) * s, cz + (pz - cz) * s);
      top.push(cx + (px - cx) * 0.22, cz + (pz - cz) * 0.22);
    }
    const e = new THREE.Vector3(), f = new THREE.Vector3(), nrm = new THREE.Vector3();
    const yE = h - 0.15, yT = h + rise;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const p0 = [eave[k * 2], yE, eave[k * 2 + 1]], p1 = [eave[j * 2], yE, eave[j * 2 + 1]];
      const p2 = [top[j * 2], yT, top[j * 2 + 1]], p3 = [top[k * 2], yT, top[k * 2 + 1]];
      e.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      f.set(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      nrm.crossVectors(e, f).normalize();
      if (nrm.y < 0) nrm.negate();
      if (!Number.isFinite(nrm.x)) continue;
      const v = (p: number[]) => mb.vert(p[0], p[1], p[2], nrm.x, nrm.y, nrm.z, c, { aWall: [p[0] + p[2], p[1], TILES], aSeed: seed });
      const a = v(p0), b = v(p1), cc = v(p2), d = v(p3);
      mb.triFacing(a, b, cc, nrm.x, nrm.y, nrm.z);
      mb.triFacing(a, cc, d, nrm.x, nrm.y, nrm.z);
      // underside of the eave, so the overhang isn't see-through from below
      const u0 = mb.vert(p0[0], yE, p0[2], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      const u1 = mb.vert(p1[0], yE, p1[2], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      const u2 = mb.vert(ring[j * 2], yE, ring[j * 2 + 1], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      const u3 = mb.vert(ring[k * 2], yE, ring[k * 2 + 1], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      mb.triFacing(u0, u1, u2, 0, -1, 0);
      mb.triFacing(u0, u2, u3, 0, -1, 0);
    }
    const base = mb.count;
    for (let k = 0; k < n; k++) mb.vert(top[k * 2], yT, top[k * 2 + 1], 0, 1, 0, c, { aWall: [top[k * 2] + top[k * 2 + 1], yT, TILES], aSeed: seed });
    for (let k = 1; k < n - 1; k++) mb.triFacing(base, base + k, base + k + 1, 0, 1, 0);
  }

  function ledges(mb: MeshBuilder, ring: Flat, h: number, c: THREE.Color, seed: number[]) {
    const n = ring.length / 2;
    const D = 0.38, T = 0.1;
    const gaps: number[] = [];
    for (let y = 3.0; y < h - 0.6; y += 3.4) {
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 4) continue;
        const nx = (bz - az) / L, nz = -(bx - ax) / L;
        // street-facing walls only: side and back walls are rarely seen close up, and this halves the cost
        if (y < 4 && !(gaps[k] = streetGap((ax + bx) / 2, (az + bz) / 2, nx, nz))) continue;
        if (!gaps[k]) continue;
        const ox = nx * D, oz = nz * D;
        const tag = { aWall: [0, 0, ROOF], aSeed: seed };
        // top
        let a = mb.vert(ax, y, az, 0, 1, 0, c, tag), b = mb.vert(bx, y, bz, 0, 1, 0, c, tag);
        let cc = mb.vert(bx + ox, y, bz + oz, 0, 1, 0, c, tag), d = mb.vert(ax + ox, y, az + oz, 0, 1, 0, c, tag);
        mb.triFacing(a, b, cc, 0, 1, 0); mb.triFacing(a, cc, d, 0, 1, 0);
        // front edge
        a = mb.vert(ax + ox, y - T, az + oz, nx, 0, nz, c, tag); b = mb.vert(bx + ox, y - T, bz + oz, nx, 0, nz, c, tag);
        cc = mb.vert(bx + ox, y, bz + oz, nx, 0, nz, c, tag); d = mb.vert(ax + ox, y, az + oz, nx, 0, nz, c, tag);
        mb.triFacing(a, b, cc, nx, 0, nz); mb.triFacing(a, cc, d, nx, 0, nz);
      }
    }
  }

  const uNight = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aWall; attribute vec2 aSeed;
        varying vec3 vWall; varying vec2 vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWall = aWall; vSeed = aSeed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vWall; varying vec2 vSeed;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }
        vec3 hsv(float h, float s, float v) {
          vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return v * mix(vec3(1.0), k, s);
        }
        float gWin; float gGlass; vec3 gLit;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        gWin = 0.0; gGlass = 0.0; gLit = vec3(0.0);
        float tag = vWall.z;
        // weathered plaster: broad blotches and fine grain
        float blotch = vnoise(vWall.xy * vec2(0.35, 0.5) + vSeed.x * 50.0);
        float grain = vnoise(vWall.xy * 6.0);
        if (tag > 3.5 && tag < 4.5) {
          // corrugated sheet awning: ridges across the width, rust and dirt
          float ridge = 0.5 + 0.5 * sin(vWall.x * 6.2832 * 7.0);
          diffuseColor.rgb *= 0.78 + 0.26 * ridge;
          // a little rust along the front edge and in patches, dirt streaks running down the slope
          float rust = smoothstep(0.7, 0.95, vnoise(vWall.xy * vec2(0.8, 2.0) + vSeed.x * 30.0)) * 0.3 + smoothstep(0.75, 1.0, vWall.y / 2.2) * 0.15;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.26, 0.15), rust);
          diffuseColor.rgb *= 0.9 + 0.12 * vnoise(vec2(vWall.x * 3.0, vWall.y * 0.4));
        } else if (tag > 4.5) {
          // balcony front: plaster with a coping line, or a steel railing over a dark gap
          float y = vWall.y;
          if (vSeed.y > 0.5) {
            float bar = step(0.78, fract(vWall.x * 8.0));
            float rail = step(0.92, y) + step(y, 0.05);
            float gapZone = step(0.05, y) * step(y, 0.92);
            vec3 steel = vec3(0.16, 0.17, 0.18);
            diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.32, steel, bar), gapZone);
            diffuseColor.rgb = mix(diffuseColor.rgb, steel, min(rail, 1.0) * 0.8);
          } else {
            diffuseColor.rgb *= 0.9 + 0.12 * blotch;
            diffuseColor.rgb *= 1.0 - 0.25 * (1.0 - smoothstep(0.82, 0.9, y)) * step(0.72, y);
            diffuseColor.rgb *= mix(0.8, 1.0, smoothstep(-0.2, 0.4, y));
          }
        } else if (tag > 2.5) {
          // clay tiles: rows of courses with staggered joints
          float row = vWall.y * 3.4;
          float course = smoothstep(0.0, 0.18, fract(row));
          float joint = step(0.07, fract(vWall.x * 4.0 + floor(row) * 0.5));
          diffuseColor.rgb *= (0.74 + 0.26 * course) * (0.9 + 0.1 * joint);
          diffuseColor.rgb *= 0.82 + 0.3 * blotch;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.27, 0.24), smoothstep(0.62, 0.9, vnoise(vWall.xy * 1.3 + 7.0)) * 0.35);
        } else if (tag < 0.5) {
          // concrete roofs and ledges: rain-stained
          diffuseColor.rgb *= 0.8 + 0.25 * blotch + 0.06 * grain;
        } else {
          diffuseColor.rgb *= 0.9 + 0.14 * blotch + 0.05 * grain;
        }
        if (tag > 0.5 && tag < 1.5) {
          float style = vSeed.y; // 0 plain, 1 glass, 2 colonial, 3 house
          float floorH = (style > 0.5 && style < 1.5) || style > 3.5 ? 3.6 : 3.4;
          float bayW = style > 3.5 ? 1.5 : style > 1.5 && style < 2.5 ? 3.2 : style > 2.5 ? 4.2 : 2.9;
          vec2 cell = vec2(vWall.x / bayW, vWall.y / floorH);
          vec2 f = fract(cell);
          float upper = step(1.0, cell.y);
          float r = h21(floor(cell) + vSeed.x * 91.0);
          float bldg = h21(vSeed.xx * 13.0);
          float frame = 0.0;
          vec3 frameCol = vec3(0.86, 0.85, 0.82);
          if (style > 0.5 && style < 1.5) {
            // glass curtain wall: thin mullions and slab edges
            gWin = step(0.06, f.x) * step(f.x, 0.94) * step(0.14, f.y) * step(f.y, 0.96);
            gGlass = 1.0;
          } else if (style > 1.5 && style < 2.5) {
            // colonial: tall windows with arched tops and green timber shutters
            float arch = step(length(vec2((f.x - 0.5) * 2.4, max(f.y - 0.7, 0.0) * 3.4)), 0.42);
            float win = min(step(0.3, f.x) * step(f.x, 0.7) * step(0.18, f.y) * step(f.y, 0.7) + arch * step(0.7, f.y), 1.0);
            float shutter = (step(0.17, f.x) * step(f.x, 0.29) + step(0.71, f.x) * step(f.x, 0.83)) * step(0.18, f.y) * step(f.y, 0.78);
            gWin = win * step(0.5, cell.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.36, 0.25) * (0.85 + 0.3 * step(0.5, fract(f.y * 14.0))), shutter * step(0.5, cell.y) * step(0.35, bldg));
            // cornice line at each floor
            diffuseColor.rgb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.05, f.y)) * step(0.5, cell.y);
          } else if (style > 3.5) {
            // modern tower: continuous ribbon windows between white or grey spandrel bands, thin mullions
            float glassBand = step(0.34, f.y) * step(f.y, 0.97);
            float mullion = step(0.95, f.x);
            gWin = glassBand * (1.0 - mullion);
            gGlass = 1.0;
            vec3 spandrel = mix(vec3(0.86, 0.86, 0.84), vec3(0.55, 0.58, 0.6), step(0.5, bldg));
            diffuseColor.rgb = mix(diffuseColor.rgb, spandrel * (0.92 + 0.08 * grain), 1.0 - gWin);
          } else {
            float x0 = style > 2.5 ? 0.3 : 0.16, x1 = style > 2.5 ? 0.62 : 0.84, y0 = style > 2.5 ? 0.32 : 0.3, y1 = style > 2.5 ? 0.75 : 0.82;
            float inner = step(x0, f.x) * step(f.x, x1) * step(y0, f.y) * step(f.y, y1);
            float outer = step(x0 - 0.035, f.x) * step(f.x, x1 + 0.035) * step(y0 - 0.05, f.y) * step(f.y, y1 + 0.03);
            float on = style > 2.5 ? step(0.35, r + 0.3) : upper;
            gWin = inner * on;
            frame = (outer - inner) * on;
            // rust and mould streaks running down from the sills
            float streak = step(x0 + 0.05, f.x) * step(f.x, x1 - 0.05) * (1.0 - smoothstep(y0 - 0.4, y0, f.y)) * step(f.y, y0) * step(0.55, h21(floor(cell) + 3.0)) * on;
            diffuseColor.rgb *= 1.0 - 0.22 * streak * (0.5 + 0.5 * vnoise(vec2(vWall.x * 9.0, 0.0)));
            // split air-conditioner units hung under some windows, with a shadow below
            if (style < 0.5) {
              float ac = step(0.72, h21(floor(cell) + 5.5)) * upper;
              float acBox = step(0.36, f.x) * step(f.x, 0.64) * step(0.06, f.y) * step(f.y, 0.24) * ac;
              float acShadow = step(0.36, f.x) * step(f.x, 0.66) * step(0.0, f.y) * step(f.y, 0.06) * ac;
              float fan = step(length(vec2((f.x - 0.45) * 3.0, (f.y - 0.15) * 4.5)), 0.22);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.86, 0.83) * (1.0 - 0.35 * fan * step(0.5, fract(f.x * 60.0))), acBox);
              diffuseColor.rgb *= 1.0 - 0.35 * acShadow;
            }
            // window grilles on many Colombo buildings
            float grille = step(0.88, fract(f.x * 9.0)) * step(0.5, bldg);
            gWin *= 1.0 - grille * 0.8;
            frame = max(frame, inner * grille * on);
            if (style < 0.5 && vWall.y < 3.4 && vWall.y > -0.2) {
              // ground floor: open shopfronts or roller shutters under a painted signboard
              float bay = floor(vWall.x / 5.5);
              float bx = fract(vWall.x / 5.5);
              float sr = h21(vec2(bay, vSeed.x * 37.0));
              float sign = step(2.5, vWall.y) * step(vWall.y, 3.3);
              vec3 signCol = hsv(sr * 1.3, 0.7, 0.85);
              if (sr < 0.15) signCol = vec3(0.93);
              // painted lettering: blocky glyphs in a central band
              vec2 g = vec2(vWall.x * 4.5, (vWall.y - 2.5) * 7.0);
              float glyph = step(0.42, h21(floor(g) + bay * 7.0)) * step(0.18, fract(g.x)) * step(0.2, fract(g.y))
                * step(1.0, g.y) * step(g.y, 4.6) * step(0.12, bx) * step(bx, 0.88);
              vec3 ink = dot(signCol, vec3(0.33)) > 0.55 ? vec3(0.12, 0.1, 0.1) : vec3(0.97, 0.95, 0.88);
              signCol = mix(signCol, ink, glyph);
              float shut = 0.55 + 0.1 * step(0.5, fract(vWall.y * 6.0));
              vec3 shop = mix(diffuseColor.rgb * 0.35, vec3(0.34, 0.35, 0.37) * shut, step(0.5, sr));
              diffuseColor.rgb = mix(shop, signCol, sign);
              // lit signboards and bright shop interiors after dark
              gLit += sign * mix(signCol, vec3(1.0), 0.3) * 0.9 * uNight;
              gLit += (1.0 - sign) * step(sr, 0.5) * step(0.3, vWall.y) * vec3(1.0, 0.8, 0.55) * 0.35 * uNight;
            }
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, frameCol * (0.85 + 0.15 * bldg), frame);
          vec3 glassCol = mix(vec3(0.1, 0.13, 0.16), vec3(0.3, 0.38, 0.44), r * 0.6);
          if (gGlass > 0.5) glassCol = mix(vec3(0.18, 0.28, 0.34), vec3(0.42, 0.55, 0.62), r * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, gWin);
          // night: some windows lit, warm bulbs or cool tube lights, at different brightness
          float lit = step(0.66, r);
          vec3 lamp = mix(vec3(1.0, 0.7, 0.4), vec3(0.85, 0.93, 1.0), step(0.62, h21(floor(cell) + 7.7)));
          gLit += gWin * lit * lamp * (0.3 + 0.7 * h21(floor(cell) + 3.1)) * 0.75 * uNight;
          // grime toward the ground
          diffuseColor.rgb *= mix(0.74, 1.0, smoothstep(-0.3, 2.2, vWall.y));
        } else if (tag > 1.5 && tag < 2.5) {
          // parapet: a lighter coping on top, stains below it
          diffuseColor.rgb *= 0.92;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, gWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.3, gWin * gGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gLit;`);
  };
  addLampLight(material);

  const group = new THREE.Group();
  group.name = 'buildings';

  // rooftop water tanks: black or blue plastic on a little stand
  const tankGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.15, 8).translate(0, 1.0, 0);
  const standGeo = new THREE.BoxGeometry(1.4, 0.42, 1.4).translate(0, 0.21, 0);
  const tankMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8c8880, roughness: 0.9 });
  const placeTank = (t: (typeof tanks)[number], m4: THREE.Matrix4) => m4.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z);

  // ---- far stand-ins: one box per building, coloured like it, with a window pattern
  const lodMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  lodMat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLod; varying vec3 vLodN;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vLod = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        vLodN = normalize(mat3(modelMatrix * instanceMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec3 vLod; varying vec3 vLodN;
        float lh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float lodWin;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        lodWin = 0.0;
        if (abs(vLodN.y) < 0.5) {
          float u = abs(vLodN.x) > abs(vLodN.z) ? vLod.z : vLod.x;
          vec2 cell = vec2(u / 3.0, vLod.y / 3.4);
          vec2 f = fract(cell);
          lodWin = step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.82) * step(1.0, cell.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.2, 0.24), lodWin * 0.85);
          diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(0.0, 3.0, vLod.y));
        } else diffuseColor.rgb *= 0.62;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += lodWin * step(0.66, lh(floor(vec2((abs(vLodN.x) > abs(vLodN.z) ? vLod.z : vLod.x) / 3.0, vLod.y / 3.4)) + floor(vLod.xz / 50.0))) * vec3(1.0, 0.75, 0.45) * 0.55 * uNight;`);
  };
  lodMat.customProgramCacheKey = () => 'bld-lod';
  const lodGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const lodCol = new THREE.Color();
  for (const c of chunkMap.values()) {
    const mesh = new THREE.InstancedMesh(lodGeo, lodMat, c.ids.length);
    c.ids.forEach((bi, n) => {
      const b = city.buildings[bi];
      const np = b.p.length / 2;
      // oriented to the longest wall, sized to the footprint's extent along and across it
      let best = 0, dx = 1, dz = 0;
      for (let k = 0; k < np; k++) {
        const j = (k + 1) % np, ex = b.p[j * 2] - b.p[k * 2], ez = b.p[j * 2 + 1] - b.p[k * 2 + 1], L = Math.hypot(ex, ez);
        if (L > best) { best = L; dx = ex / L; dz = ez / L; }
      }
      let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
      for (let k = 0; k < np; k++) {
        const x = b.p[k * 2], z = b.p[k * 2 + 1], a = x * dx + z * dz, cc = -x * dz + z * dx;
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, cc); c1 = Math.max(c1, cc);
      }
      const am = (a0 + a1) / 2, cm = (c0 + c1) / 2;
      // shrink a little: a footprint's bounding box is bigger than the building
      const w = (a1 - a0) * 0.92, d = (c1 - c0) * 0.92;
      q.setFromAxisAngle(up, Math.atan2(dx, dz) - Math.PI / 2);
      m4.compose(new THREE.Vector3(am * dx - cm * dz, 0, am * dz + cm * dx), q, new THREE.Vector3(w, b.h, d));
      mesh.setMatrixAt(n, m4);
      const style = BUILDING_STYLES[b.s];
      const r0 = hash(bi + 0.13), r1 = hash(bi + 7.7);
      const pastel = (style === 'plain' && r0 < 0.42) || (style === 'house' && r0 < 0.3);
      const pal = pastel ? PALETTES.pastel : PALETTES[b.h >= 40 && style !== 'colonial' ? 'glass' : style];
      lodCol.setHex(pal[Math.floor(r1 * pal.length)]);
      mesh.setColorAt(n, lodCol);
    });
    mesh.computeBoundingSphere();
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    c.lod = mesh;
    group.add(mesh);
  }

  // ---- full detail, built on demand
  const buildChunk = (c: Chunk) => {
    curMb = new MeshBuilder(true, { aWall: 3, aSeed: 2 });
    tanks = [];
    for (const i of c.ids) addBuilding(city.buildings[i], i);
    const objs: THREE.Object3D[] = [];
    if (curMb.count) {
      const m = new THREE.Mesh(curMb.build(), material);
      m.castShadow = true;
      m.receiveShadow = true;
      objs.push(m);
    }
    if (tanks.length) {
      for (const m of [
        ...chunkedInstances(tanks, tankGeo, tankMat, 1e6, placeTank, (t, col) => col.setHex(t.blue ? 0x2f6fb0 : 0x1d1f22)),
        ...chunkedInstances(tanks, standGeo, standMat, 1e6, placeTank),
      ]) { m.castShadow = true; m.receiveShadow = true; objs.push(m); }
    }
    curMb = null;
    for (const o of objs) group.add(o);
    c.detail = objs;
    if (c.lod) c.lod.visible = false;
  };
  const dropChunk = (c: Chunk) => {
    for (const o of c.detail ?? []) {
      group.remove(o);
      if (o instanceof THREE.InstancedMesh) o.dispose();
      else if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    c.detail = null;
    if (c.lod) c.lod.visible = true;
  };
  let detailChunks = 0;
  const chunks = [...chunkMap.values()];
  const edgeDist = (c: Chunk, x: number, z: number) =>
    Math.hypot(Math.max(0, Math.abs(x - c.cx) - CHUNK / 2), Math.max(0, Math.abs(z - c.cz) - CHUNK / 2));
  const update = (x: number, z: number, budget = 1) => {
    const want: { c: Chunk; d: number }[] = [];
    for (const c of chunks) {
      const d = edgeDist(c, x, z);
      if (c.detail && d > DETAIL_OUT) { dropChunk(c); detailChunks--; }
      else if (!c.detail && d < DETAIL_IN) want.push({ c, d });
    }
    want.sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(budget, want.length); k++) { buildChunk(want[k].c); detailChunks++; }
  };
  return {
    group, material, update,
    setNight: (v) => (uNight.value = v),
    get detailChunks() { return detailChunks; },
  };
}
