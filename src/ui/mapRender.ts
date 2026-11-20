import type { CityData, Flat } from '../types';
import { ROAD_TYPES, AREA_KINDS } from '../types';
import type { LandMask } from '../world/landmask';

export const MAP_MPP = 2; // metres per pixel of the pre-rendered map

export interface RoadLabel { x: number; z: number; a: number; n: string; major: boolean }

/** Pre-renders the whole city to one canvas, used by both the minimap and the full map. */
export function renderCityMap(city: CityData, mask: LandMask) {
  const { minX, minZ, maxX, maxZ } = city.bounds;
  const W = Math.ceil((maxX - minX) / MAP_MPP), H = Math.ceil((maxZ - minZ) / MAP_MPP);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;

  // land / water from the mask
  const mc = document.createElement('canvas');
  mc.width = mask.w; mc.height = mask.h;
  const mctx = mc.getContext('2d')!;
  const img = mctx.createImageData(mask.w, mask.h);
  for (let i = 0; i < mask.data.length; i++) {
    const land = mask.data[i] > 127;
    img.data[i * 4] = land ? 226 : 128;
    img.data[i * 4 + 1] = land ? 222 : 176;
    img.data[i * 4 + 2] = land ? 212 : 200;
    img.data[i * 4 + 3] = 255;
  }
  mctx.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(mc, (mask.minX - minX) / MAP_MPP, (mask.minZ - minZ) / MAP_MPP, (mask.w * mask.res) / MAP_MPP, (mask.h * mask.res) / MAP_MPP);

  const tx = (x: number) => (x - minX) / MAP_MPP;
  const tz = (z: number) => (z - minZ) / MAP_MPP;
  const path = (p: Flat, close: boolean) => {
    ctx.moveTo(tx(p[0]), tz(p[1]));
    for (let i = 2; i < p.length; i += 2) ctx.lineTo(tx(p[i]), tz(p[i + 1]));
    if (close) ctx.closePath();
  };

  const areaCol: Record<string, string> = {
    grass: '#b9d39a', park: '#a9cd8c', wood: '#93bb78', sand: '#eee0b8', paved: '#d6d1c6', pitch: '#a5d08e', cemetery: '#bcc9a6',
  };
  for (const a of city.areas) {
    ctx.beginPath();
    path(a.p, true);
    for (const h of a.holes ?? []) path(h, true);
    ctx.fillStyle = areaCol[AREA_KINDS[a.k]] ?? '#ccc';
    ctx.fill('evenodd');
  }

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#8fb6c9';
  for (const w of city.waterways) { ctx.lineWidth = w.w / MAP_MPP; ctx.beginPath(); path(w.p, false); ctx.stroke(); }

  ctx.fillStyle = '#c9c1b3';
  ctx.strokeStyle = '#b3aa9a';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  city.buildings.forEach((b) => path(b.p, true));
  ctx.fill();
  ctx.stroke();

  // rails
  ctx.strokeStyle = '#8a8580';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  for (const r of [...city.rails, ...(city.trains?.routes ?? [])]) { ctx.beginPath(); path(r, false); ctx.stroke(); }
  ctx.setLineDash([]);

  // roads: casing then fill, minor first
  const order = [7, 6, 5, 4, 3, 2, 1, 0];
  const fill = ['#f6c36b', '#f6c36b', '#fbe08a', '#fdf0b8', '#ffffff', '#ffffff', '#f4f2ee', '#efe9de'];
  for (const pass of [0, 1]) {
    for (const t of order) {
      for (const r of city.roads) {
        if (r.t !== t) continue;
        const w = Math.max(t === 7 ? 1.2 : 2.2, r.w / MAP_MPP);
        if (pass === 0) {
          if (t === 7) continue;
          ctx.strokeStyle = '#a49c8e';
          ctx.lineWidth = w + 1.6;
        } else {
          ctx.strokeStyle = fill[t];
          ctx.lineWidth = w;
        }
        ctx.beginPath();
        path(r.p, false);
        ctx.stroke();
      }
    }
  }

  // street name anchors (drawn live so they stay upright)
  const labels: RoadLabel[] = [];
  const named = new Map<string, Flat[]>();
  const majorNames = new Set<string>();
  for (const r of city.roads) {
    if (!r.n || ROAD_TYPES[r.t] === 'footway' || ROAD_TYPES[r.t] === 'service') continue;
    let a = named.get(r.n);
    if (!a) named.set(r.n, (a = []));
    a.push(r.p);
    if (r.t <= 3) majorNames.add(r.n);
  }
  for (const [n, parts] of named) {
    const major = majorNames.has(n);
    let since = 120;
    for (const p of parts) {
      for (let i = 0; i < p.length / 2 - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const L = Math.hypot(bx - ax, bz - az);
        since += L;
        if (since > 260 && L > 25) {
          labels.push({ x: (ax + bx) / 2, z: (az + bz) / 2, a: Math.atan2(bz - az, bx - ax), n, major });
          since = 0;
        }
      }
    }
  }
  return { canvas, labels, W, H };
}
