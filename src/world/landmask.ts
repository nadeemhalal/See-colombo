// Land / water raster. Shared by the build script (to keep filler buildings off water)
// and the game (ground rendering + collision). Pure TypeScript, no Three.js.
import type { Flat } from '../types';

export interface LandMask {
  res: number; // metres per cell
  w: number;
  h: number;
  minX: number;
  minZ: number;
  /** 255 = land, 0 = water */
  data: Uint8Array;
}

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };

function addCrossings(rows: number[][], lines: Flat[], closed: boolean, minZ: number, res: number, h: number) {
  for (const p of lines) {
    const n = p.length / 2;
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      const x1 = p[i * 2], z1 = p[i * 2 + 1];
      const x2 = p[j * 2], z2 = p[j * 2 + 1];
      if (z1 === z2) continue;
      const zLo = Math.min(z1, z2), zHi = Math.max(z1, z2);
      // rows whose centre z is in [zLo, zHi)
      let r0 = Math.ceil((zLo - minZ) / res - 0.5);
      let r1 = Math.ceil((zHi - minZ) / res - 0.5) - 1;
      if (r0 < 0) r0 = 0;
      if (r1 > h - 1) r1 = h - 1;
      for (let r = r0; r <= r1; r++) {
        const zc = minZ + (r + 0.5) * res;
        rows[r].push(x1 + ((zc - z1) * (x2 - x1)) / (z2 - z1));
      }
    }
  }
}

/**
 * Coastline: scanning each row from the west edge (assumed open sea), every coastline
 * crossing toggles sea/land. Water rings and island rings use the even-odd rule.
 * Pier lines are then painted back as land so they are walkable.
 */
export function buildLandMask(
  b: Bounds,
  res: number,
  coast: Flat[],
  water: Flat[],
  piers: { w: number; p: Flat }[] = [],
  landRings: Flat[] = [],
): LandMask {
  const w = Math.ceil((b.maxX - b.minX) / res);
  const h = Math.ceil((b.maxZ - b.minZ) / res);
  const data = new Uint8Array(w * h);
  const coastRows: number[][] = Array.from({ length: h }, () => []);
  const waterRows: number[][] = Array.from({ length: h }, () => []);
  const landRows: number[][] = Array.from({ length: h }, () => []);
  addCrossings(coastRows, coast, false, b.minZ, res, h);
  addCrossings(waterRows, water, true, b.minZ, res, h);
  addCrossings(landRows, landRings, true, b.minZ, res, h);

  for (let r = 0; r < h; r++) {
    const cr = coastRows[r].sort((a, c) => a - c);
    const wr = waterRows[r].sort((a, c) => a - c);
    const lr = landRows[r].sort((a, c) => a - c);
    let ci = 0, wi = 0, li = 0;
    let land = false, inWater = false, forced = false;
    // If there is no coastline crossing in this row at all, the row is entirely land
    // (only happens if the map does not touch the sea on that row).
    if (cr.length === 0) land = true;
    for (let c = 0; c < w; c++) {
      const xc = b.minX + (c + 0.5) * res;
      while (ci < cr.length && cr[ci] < xc) { land = !land; ci++; }
      while (wi < wr.length && wr[wi] < xc) { inWater = !inWater; wi++; }
      while (li < lr.length && lr[li] < xc) { forced = !forced; li++; }
      data[r * w + c] = forced || (land && !inWater) ? 255 : 0;
    }
  }

  // paint piers / breakwaters as land
  for (const pier of piers) {
    const p = pier.p;
    const half = pier.w / 2;
    for (let i = 0; i < p.length / 2 - 1; i++) {
      const x1 = p[i * 2], z1 = p[i * 2 + 1], x2 = p[i * 2 + 2], z2 = p[i * 2 + 3];
      const len = Math.hypot(x2 - x1, z2 - z1);
      const steps = Math.max(1, Math.ceil(len / (res * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const x = x1 + (x2 - x1) * t, z = z1 + (z2 - z1) * t;
        const rad = Math.ceil(half / res);
        const cc = Math.floor((x - b.minX) / res), rr = Math.floor((z - b.minZ) / res);
        for (let dr = -rad; dr <= rad; dr++)
          for (let dc = -rad; dc <= rad; dc++) {
            const c = cc + dc, r = rr + dr;
            if (c < 0 || r < 0 || c >= w || r >= h) continue;
            if (Math.hypot(dc * res, dr * res) <= half) data[r * w + c] = 255;
          }
      }
    }
  }
  return { res, w, h, minX: b.minX, minZ: b.minZ, data };
}

/** Nearest-cell lookup. Outside the mask, the nearest edge cell is used. */
export function isLand(m: LandMask, x: number, z: number): boolean {
  let c = Math.floor((x - m.minX) / m.res);
  let r = Math.floor((z - m.minZ) / m.res);
  if (c < 0) c = 0; else if (c >= m.w) c = m.w - 1;
  if (r < 0) r = 0; else if (r >= m.h) r = m.h - 1;
  return m.data[r * m.w + c] > 127;
}
