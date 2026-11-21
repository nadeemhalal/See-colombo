// Converts the raw Overpass download into public/data/city.json (local metres).
// Also generates "filler" buildings along streets where OSM has no footprints, and scatters trees.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BBOX, ORIGIN_FALLBACK, RAW_FILE, OUT_FILE, LANDMARKS } from './config.ts';
import { buildLandMask, isLand } from '../src/world/landmask.ts';
import {
  ROAD_TYPES, AREA_KINDS, BUILDING_STYLES,
  type Area, type Building, type CityData, type Flat, type Landmark, type Place, type Road,
} from '../src/types.ts';

// ---------- raw OSM types ----------
type LatLon = { lat: number; lon: number };
interface OsmEl {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: (LatLon | null)[];
  members?: { type: string; ref: number; role: string; geometry?: (LatLon | null)[]; lat?: number; lon?: number }[];
}

const raw: OsmEl[] = JSON.parse(readFileSync(RAW_FILE, 'utf8')).elements;

// ---------- helpers ----------
let seed = 20261120;
function rand() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a: number, b: number) => a + rand() * (b - a);
const r1 = (v: number) => Math.round(v * 10) / 10;
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];

function names(t?: Record<string, string>) {
  return t ? [t.name, t['name:en']].filter(Boolean) as string[] : [];
}

// ---------- origin & projection ----------
const clock = raw.find((e) => names(e.tags).some((n) => /old colombo lighthouse/i.test(n)));
function centroidLL(e: OsmEl): LatLon | null {
  if (e.type === 'node' && e.lat != null) return { lat: e.lat, lon: e.lon! };
  const pts: LatLon[] = [];
  if (e.geometry) pts.push(...(e.geometry.filter(Boolean) as LatLon[]));
  if (e.members) for (const m of e.members) {
    if (m.geometry) pts.push(...(m.geometry.filter(Boolean) as LatLon[]));
    else if (m.lat != null) pts.push({ lat: m.lat, lon: m.lon! });
  }
  if (!pts.length) return null;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
}
const origin = (clock && centroidLL(clock)) || ORIGIN_FALLBACK;
const M_LAT = 110583; // metres per degree latitude near 7°N
const M_LON = 111320 * Math.cos((origin.lat * Math.PI) / 180);
const projX = (lon: number) => (lon - origin.lon) * M_LON;
const projZ = (lat: number) => -(lat - origin.lat) * M_LAT;

function projLine(g: (LatLon | null)[]): number[] {
  const out: number[] = [];
  for (const p of g) if (p) out.push(r1(projX(p.lon)), r1(projZ(p.lat)));
  return out;
}
function isClosed(g: (LatLon | null)[] | undefined) {
  if (!g || g.length < 4) return false;
  const a = g[0], b = g[g.length - 1];
  return !!a && !!b && a.lat === b.lat && a.lon === b.lon;
}
/** closed geometry -> ring without the duplicate closing point */
function projRing(g: (LatLon | null)[]): number[] {
  return projLine(g).slice(0, -2);
}
function signedArea(p: Flat) {
  let a = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return a / 2;
}
function orient(p: Flat, positive: boolean): Flat {
  if (signedArea(p) > 0 === positive) return p;
  const out: number[] = [];
  for (let i = p.length / 2 - 1; i >= 0; i--) out.push(p[i * 2], p[i * 2 + 1]);
  return out;
}
function pointInRing(x: number, z: number, p: Flat) {
  let inside = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(p: Flat) {
  let x = 0, z = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) { x += p[i * 2]; z += p[i * 2 + 1]; }
  return { x: x / n, z: z / n };
}
function bboxOf(p: Flat) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minZ = Math.min(minZ, p[i + 1]); maxZ = Math.max(maxZ, p[i + 1]);
  }
  return { minX, minZ, maxX, maxZ };
}
function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const dx = bx - ax, dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

/** Join member ways of a multipolygon into closed rings. */
function stitch(parts: LatLon[][]): LatLon[][] {
  const pool = parts.map((p) => p.slice());
  const rings: LatLon[][] = [];
  const same = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;
  while (pool.length) {
    let cur = pool.shift()!;
    let guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 1000) {
      const end = cur[cur.length - 1];
      const i = pool.findIndex((p) => same(p[0], end) || same(p[p.length - 1], end));
      if (i < 0) break;
      let nxt = pool.splice(i, 1)[0];
      if (!same(nxt[0], end)) nxt = nxt.slice().reverse();
      cur = cur.concat(nxt.slice(1));
    }
    if (cur.length >= 4) rings.push(cur);
  }
  return rings;
}
function relationRings(e: OsmEl) {
  const outer: LatLon[][] = [], inner: LatLon[][] = [];
  for (const m of e.members ?? []) {
    if (m.type !== 'way' || !m.geometry) continue;
    const g = m.geometry.filter(Boolean) as LatLon[];
    (m.role === 'inner' ? inner : outer).push(g);
  }
  return { outer: stitch(outer).map((g) => projRing(g)), inner: stitch(inner).map((g) => projRing(g)) };
}

// simple uniform grid index
class Grid<T> {
  cells = new Map<number, T[]>();
  constructor(public size: number) {}
  key(cx: number, cz: number) { return (cx + 5000) * 10000 + (cz + 5000); }
  add(item: T, minX: number, minZ: number, maxX: number, maxZ: number) {
    for (let cx = Math.floor(minX / this.size); cx <= Math.floor(maxX / this.size); cx++)
      for (let cz = Math.floor(minZ / this.size); cz <= Math.floor(maxZ / this.size); cz++) {
        const k = this.key(cx, cz);
        let c = this.cells.get(k);
        if (!c) this.cells.set(k, (c = []));
        c.push(item);
      }
  }
  near(x: number, z: number): T[] {
    return this.cells.get(this.key(Math.floor(x / this.size), Math.floor(z / this.size))) ?? [];
  }
}

// ---------- zones (lat/lon boxes, approximate) ----------
const inLL = (lat: number, lon: number, s: number, w: number, n: number, e: number) => lat >= s && lat <= n && lon >= w && lon <= e;
const zoneOf = (x: number, z: number) => {
  const lat = origin.lat - z / M_LAT, lon = origin.lon + x / M_LON;
  if (inLL(lat, lon, 6.9340, 79.8480, 6.9430, 79.8640)) return 'pettah';
  if (inLL(lat, lon, 6.9290, 79.8395, 6.9390, 79.8490)) return 'fort';
  return 'city';
};

// ---------- classify ----------
const ROAD_W: Record<string, number> = {
  motorway: 14, trunk: 13, primary: 12, secondary: 10, tertiary: 8,
  residential: 6, service: 4, footway: 2.5,
};
function roadClass(hw: string): string | null {
  if (['motorway', 'motorway_link'].includes(hw)) return 'motorway';
  if (['trunk', 'trunk_link'].includes(hw)) return 'trunk';
  if (['primary', 'primary_link'].includes(hw)) return 'primary';
  if (['secondary', 'secondary_link'].includes(hw)) return 'secondary';
  if (['tertiary', 'tertiary_link'].includes(hw)) return 'tertiary';
  if (['residential', 'unclassified', 'living_street', 'road'].includes(hw)) return 'residential';
  if (hw === 'service') return 'service';
  if (['footway', 'path', 'pedestrian', 'cycleway', 'steps', 'track', 'bridleway'].includes(hw)) return 'footway';
  return null;
}
function areaKind(t: Record<string, string>): number {
  const k = (s: (typeof AREA_KINDS)[number]) => AREA_KINDS.indexOf(s);
  if (/^(park|garden|playground)$/.test(t.leisure ?? '')) return k('park');
  if (/^(pitch|stadium)$/.test(t.leisure ?? '')) return k('pitch');
  if (/^(grass|village_green|recreation_ground)$/.test(t.landuse ?? '')) return k('grass');
  if (t.landuse === 'cemetery') return k('cemetery');
  if (t.landuse === 'forest' || /^(wood|scrub)$/.test(t.natural ?? '')) return k('wood');
  if (/^(grassland|wetland)$/.test(t.natural ?? '')) return k('grass');
  if (/^(beach|sand)$/.test(t.natural ?? '')) return k('sand');
  return -1;
}
const isWaterTags = (t: Record<string, string>) =>
  t.natural === 'water' || /^(riverbank|dock)$/.test(t.waterway ?? '') || /^(basin|reservoir)$/.test(t.landuse ?? '') || t.leisure === 'marina';

const roads: Road[] = [];
const rails: Flat[] = [];
const buildings: Building[] = [];
const areas: Area[] = [];
const coast: Flat[] = [];
const water: Flat[] = [];
const land: Flat[] = [];
const waterways: { w: number; p: Flat }[] = [];
const piers: { w: number; p: Flat }[] = [];
const treesOut: number[] = [];
const places: Place[] = [];
const mainRails: { p: Flat; coast: boolean }[] = [];
const stations: { n: string; x: number; z: number }[] = [];
let lotusLL: LatLon | null = null;

function heightOf(t: Record<string, string>, area: number, zone: string): number {
  const h = parseFloat(t.height);
  if (Number.isFinite(h) && h > 0) return h;
  const lv = parseFloat(t['building:levels']);
  if (Number.isFinite(lv) && lv > 0) return lv * 3.4 + 0.8;
  const b = t.building;
  if (/^(roof|carport)$/.test(b)) return 4;
  if (/^(shed|hut|kiosk|garage|garages|toilets)$/.test(b)) return rr(2.6, 3.4);
  if (/^(house|detached|semidetached_house|bungalow)$/.test(b)) return rr(4, 7.5);
  const floors =
    zone === 'pettah' ? Math.round(rr(2, 4.4)) :
    area < 80 ? Math.round(rr(1, 2.4)) :
    area < 400 ? Math.round(rr(2, 3.4)) :
    area < 1500 ? Math.round(rr(2, 5.4)) : Math.round(rr(3, 6.4));
  return floors * 3.4 + 0.6;
}
function styleOf(t: Record<string, string>, h: number, area: number, zone: string): number {
  const s = (n: (typeof BUILDING_STYLES)[number]) => BUILDING_STYLES.indexOf(n);
  if (t.historic || t['heritage'] || /^(church|cathedral|mosque|temple|government)$/.test(t.building)) return s('colonial');
  if (h >= 45) return s('glass');
  if (zone === 'fort' && h <= 24 && rand() < 0.7) return s('colonial');
  if (h <= 8 && area < 300) return s('house');
  return s('plain');
}
function addBuilding(outer: Flat, inner: Flat[], t: Record<string, string>) {
  if (outer.length < 6) return;
  const p = orient(outer, true);
  const area = Math.abs(signedArea(p));
  if (area < 4) return;
  const c = centroid(p);
  const zone = zoneOf(c.x, c.z);
  const h = r1(heightOf(t, area, zone));
  const b: Building = { p, h, s: styleOf(t, h, area, zone) };
  const holes = inner.filter((r) => r.length >= 6).map((r) => orient(r, false));
  if (holes.length) b.holes = holes;
  const n = t.name ?? t['name:en'];
  if (n) b.n = n;
  buildings.push(b);
}

for (const e of raw) {
  const t = e.tags ?? {};
  if (e.type === 'node') {
    if (t.natural === 'tree' && e.lat != null) {
      treesOut.push(r1(projX(e.lon!)), r1(projZ(e.lat)), rand() < 0.4 ? 0 : 1, r1(rr(0.8, 1.25)));
    } else if (t.railway === 'station' && t.name && !stations.some((s) => s.n === t.name)) {
      stations.push({ n: t.name, x: r1(projX(e.lon!)), z: r1(projZ(e.lat!)) });
    } else if (/^(suburb|neighbourhood|quarter)$/.test(t.place ?? '') && t.name) {
      places.push({ n: t.name, x: r1(projX(e.lon!)), z: r1(projZ(e.lat!)), kind: t.place });
    }
    continue;
  }

  const isBuilding = (t.building && t.building !== 'no') ||
    (t['building:part'] && parseFloat(t.height) >= 60);
  const isLotus = names(t).some((n) => /lotus tower/i.test(n));
  if (isLotus) { lotusLL = centroidLL(e); continue; }

  if (e.type === 'relation') {
    if (t.type !== 'multipolygon' && !isBuilding) continue;
    const { outer, inner } = relationRings(e);
    if (isBuilding) {
      for (const o of outer) addBuilding(o, inner.filter((r) => pointInRing(r[0], r[1], o)), t);
    } else if (isWaterTags(t)) {
      water.push(...outer, ...inner);
    } else {
      const k = areaKind(t);
      if (k >= 0) for (const o of outer) {
        const a: Area = { k, p: orient(o, true) };
        const hs = inner.filter((r) => pointInRing(r[0], r[1], o)).map((r) => orient(r, false));
        if (hs.length) a.holes = hs;
        areas.push(a);
      }
    }
    continue;
  }

  // ways
  const g = e.geometry;
  if (!g || g.length < 2) continue;
  const closed = isClosed(g);

  if (t.natural === 'coastline') { coast.push(projLine(g)); continue; }
  if (isBuilding) { if (closed) addBuilding(projRing(g), [], t); continue; }

  if (t.highway || t['area:highway']) {
    if (t.area === 'yes' || t['area:highway']) {
      if (closed) areas.push({ k: AREA_KINDS.indexOf('paved'), p: orient(projRing(g), true) });
      continue;
    }
    const cls = roadClass(t.highway);
    if (!cls) continue;
    const lanes = parseFloat(t.lanes);
    let w = ROAD_W[cls];
    if (Number.isFinite(lanes) && cls !== 'footway') w = Math.max(5, Math.min(24, lanes * 3.3));
    if (t.highway === 'pedestrian') w = 6;
    const road: Road = { t: ROAD_TYPES.indexOf(cls as (typeof ROAD_TYPES)[number]), w, p: projLine(g) };
    if (t.name) road.n = t.name;
    if (t.oneway === 'yes' || t.oneway === 'true' || t.oneway === '1' || /^(roundabout|circular)$/.test(t.junction ?? '') || cls === 'motorway') road.o = 1;
    else if (t.oneway === '-1') road.o = -1;
    roads.push(road);
    continue;
  }
  if (/^(rail|light_rail|narrow_gauge)$/.test(t.railway ?? '')) {
    const p = projLine(g);
    rails.push(p);
    if (!t.service) mainRails.push({ p, coast: /coast/i.test(t.name ?? '') });
    continue;
  }
  if (t.railway === 'platform' && closed) { areas.push({ k: AREA_KINDS.indexOf('paved'), p: orient(projRing(g), true) }); continue; }
  if (isWaterTags(t) && closed) { water.push(projRing(g)); continue; }
  if (/^(islet|island)$/.test(t.place ?? '') && closed) { land.push(projRing(g)); continue; }
  if (/^(canal|river|stream|drain)$/.test(t.waterway ?? '')) {
    const w = t.waterway === 'river' ? 20 : t.waterway === 'canal' ? 8 : 3;
    waterways.push({ w, p: projLine(g) });
    continue;
  }
  if (/^(breakwater|pier|groyne)$/.test(t.man_made ?? '')) {
    if (closed) {
      const ring = projRing(g);
      land.push(ring);
      areas.push({ k: AREA_KINDS.indexOf('paved'), p: orient(ring, true) });
    } else piers.push({ w: t.man_made === 'breakwater' ? 8 : 4, p: projLine(g) });
    continue;
  }
  const k = areaKind(t);
  if (k >= 0 && closed) areas.push({ k, p: orient(projRing(g), true) });
}

// ---------- bounds & land mask ----------
const bounds = {
  minX: r1(projX(BBOX.west)), maxX: r1(projX(BBOX.east)),
  minZ: r1(projZ(BBOX.north)), maxZ: r1(projZ(BBOX.south)),
};
// west edge sanity check: no coastline may cross it
let westCross = 0;
for (const c of coast) for (let i = 0; i < c.length / 2 - 1; i++) {
  const x1 = c[i * 2], x2 = c[i * 2 + 2], z1 = c[i * 2 + 1];
  if ((x1 - bounds.minX) * (x2 - bounds.minX) < 0 && z1 > bounds.minZ && z1 < bounds.maxZ) westCross++;
}
if (westCross) console.warn(`WARNING: coastline crosses the west edge ${westCross} times; land mask may be inverted on some rows.`);

const mask = buildLandMask(bounds, 4, coast, water, piers, land);
let landCells = 0;
for (const v of mask.data) if (v) landCells++;
console.log(`Land mask ${mask.w}x${mask.h}, ${((100 * landCells) / mask.data.length).toFixed(1)}% land`);

// ---------- indices ----------
const roadIdx = new Grid<{ ax: number; az: number; bx: number; bz: number; half: number }>(40);
for (const r of roads) {
  if (ROAD_TYPES[r.t] === 'footway') continue;
  for (let i = 0; i < r.p.length / 2 - 1; i++) {
    const s = { ax: r.p[i * 2], az: r.p[i * 2 + 1], bx: r.p[i * 2 + 2], bz: r.p[i * 2 + 3], half: r.w / 2 };
    roadIdx.add(s, Math.min(s.ax, s.bx) - 20, Math.min(s.az, s.bz) - 20, Math.max(s.ax, s.bx) + 20, Math.max(s.az, s.bz) + 20);
  }
}
for (const rl of rails) for (let i = 0; i < rl.length / 2 - 1; i++) {
  const s = { ax: rl[i * 2], az: rl[i * 2 + 1], bx: rl[i * 2 + 2], bz: rl[i * 2 + 3], half: 4 };
  roadIdx.add(s, Math.min(s.ax, s.bx) - 20, Math.min(s.az, s.bz) - 20, Math.max(s.ax, s.bx) + 20, Math.max(s.az, s.bz) + 20);
}
const bIdx = new Grid<Flat>(40);
for (const b of buildings) { const bb = bboxOf(b.p); bIdx.add(b.p, bb.minX, bb.minZ, bb.maxX, bb.maxZ); }
const aIdx = new Grid<Flat>(60);
for (const a of areas) { const bb = bboxOf(a.p); aIdx.add(a.p, bb.minX, bb.minZ, bb.maxX, bb.maxZ); }

const nearRoad = (x: number, z: number, margin: number) =>
  roadIdx.near(x, z).some((s) => distSeg(x, z, s.ax, s.az, s.bx, s.bz) < s.half + margin);
const inBuilding = (x: number, z: number) => bIdx.near(x, z).some((p) => pointInRing(x, z, p));
const inArea = (x: number, z: number) => aIdx.near(x, z).some((p) => pointInRing(x, z, p));
const inBounds = (x: number, z: number) => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ;

// ---------- filler buildings along streets ----------
const osmBuildingCount = buildings.length;
const FILL_TYPES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'residential']);
for (const r of roads) {
  const cls = ROAD_TYPES[r.t];
  if (!FILL_TYPES.has(cls)) continue;
  for (let i = 0; i < r.p.length / 2 - 1; i++) {
    const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 8) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (const side of [1, -1]) {
      const nx = -uz * side, nz = ux * side;
      let s = rr(1, 4);
      while (s < L - 5) {
        const mid = { x: ax + ux * s, z: az + uz * s };
        const zone = zoneOf(mid.x, mid.z);
        const dense = zone === 'pettah' || zone === 'fort';
        const fw = dense ? rr(5, 9) : cls === 'residential' ? rr(8, 14) : rr(9, 18);
        if (s + fw > L) break;
        const depth = dense ? rr(10, 18) : cls === 'residential' ? rr(9, 16) : rr(12, 24);
        const setback = dense ? rr(0.2, 0.8) : cls === 'residential' ? rr(1.5, 4) : rr(0.5, 3);
        const d = r.w / 2 + 2 + setback + depth / 2;
        const cx = ax + ux * (s + fw / 2) + nx * d, cz = az + uz * (s + fw / 2) + nz * d;
        const hw = fw / 2, hd = depth / 2;
        const pts = [
          [cx - ux * hw - nx * hd, cz - uz * hw - nz * hd],
          [cx + ux * hw - nx * hd, cz + uz * hw - nz * hd],
          [cx + ux * hw + nx * hd, cz + uz * hw + nz * hd],
          [cx - ux * hw + nx * hd, cz - uz * hw + nz * hd],
        ];
        const samples = [
          ...pts,
          [cx, cz],
          [cx - ux * hw, cz - uz * hw], [cx + ux * hw, cz + uz * hw],
          [cx + nx * hd, cz + nz * hd], [cx - nx * hd, cz - nz * hd],
        ];
        let ok = true;
        for (const [x, z] of samples) {
          if (!inBounds(x, z) || !isLand(mask, x, z) || nearRoad(x, z, 0.8) || inBuilding(x, z) || inArea(x, z)) { ok = false; break; }
        }
        if (ok) {
          // reject if any existing building vertex lies inside the candidate
          for (const p of bIdx.near(cx, cz)) {
            for (let k = 0; k < p.length && ok; k += 2) {
              const lx = (p[k] - cx) * ux + (p[k + 1] - cz) * uz;
              const lz = (p[k] - cx) * nx + (p[k + 1] - cz) * nz;
              if (Math.abs(lx) < hw && Math.abs(lz) < hd) ok = false;
            }
            if (!ok) break;
          }
        }
        if (ok) {
          const ring = orient(pts.flatMap(([x, z]) => [r1(x), r1(z)]), true);
          const floors = zone === 'pettah' ? Math.round(rr(2, 4.4))
            : zone === 'fort' ? Math.round(rr(2, 5.4))
            : cls === 'residential' ? Math.round(rr(1, 3.2))
            : Math.round(rr(2, 6.4));
          const h = r1(floors * 3.4 + rr(0.3, 1.2));
          const style = floors <= 2 && cls === 'residential' ? BUILDING_STYLES.indexOf('house')
            : zone === 'fort' && rand() < 0.5 ? BUILDING_STYLES.indexOf('colonial') : BUILDING_STYLES.indexOf('plain');
          buildings.push({ p: ring, h, s: style });
          const bb = bboxOf(ring);
          bIdx.add(ring, bb.minX, bb.minZ, bb.maxX, bb.maxZ);
          s += fw + (dense ? rr(0, 0.4) : rr(0.5, 3));
        } else {
          s += rr(2, 5);
        }
      }
    }
  }
}
const fillerCount = buildings.length - osmBuildingCount;

// ---------- trees ----------
function tryTree(x: number, z: number, kind: number) {
  if (!inBounds(x, z) || !isLand(mask, x, z) || nearRoad(x, z, 0.6) || inBuilding(x, z)) return;
  treesOut.push(r1(x), r1(z), kind, r1(rr(0.75, 1.3)));
}
for (const a of areas) {
  const kind = AREA_KINDS[a.k];
  const density = kind === 'wood' ? 1 / 70 : kind === 'park' ? 1 / 260 : kind === 'cemetery' ? 1 / 400 : kind === 'grass' ? 1 / 2500 : 0;
  if (!density) continue;
  const bb = bboxOf(a.p);
  const n = Math.min(4000, Math.round(Math.abs(signedArea(a.p)) * density));
  for (let i = 0; i < n * 3 && i < 12000; i++) {
    const x = rr(bb.minX, bb.maxX), z = rr(bb.minZ, bb.maxZ);
    if (!pointInRing(x, z, a.p) || (a.holes ?? []).some((hl) => pointInRing(x, z, hl))) continue;
    tryTree(x, z, rand() < (kind === 'grass' ? 0.8 : 0.35) ? 0 : 1);
    if (--i < -1) break;
  }
}
// street trees on quieter roads
for (const r of roads) {
  const cls = ROAD_TYPES[r.t];
  if (!['tertiary', 'residential', 'secondary'].includes(cls)) continue;
  for (let i = 0; i < r.p.length / 2 - 1; i++) {
    const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    for (let s = rr(0, 15); s < L; s += rr(14, 26)) {
      if (rand() > 0.35) continue;
      const side = rand() < 0.5 ? 1 : -1;
      const off = r.w / 2 + 1.4;
      const x = ax + ux * s - uz * off * side, z = az + uz * s + ux * off * side;
      if (roadIdx.near(x, z).some((sg) => distSeg(x, z, sg.ax, sg.az, sg.bx, sg.bz) < sg.half + 0.3)) continue;
      if (!isLand(mask, x, z) || inBuilding(x, z)) continue;
      treesOut.push(r1(x), r1(z), rand() < 0.25 ? 0 : 1, r1(rr(0.8, 1.2)));
    }
  }
}

// ---------- landmarks ----------
const landmarks: Landmark[] = [];
for (const def of LANDMARKS) {
  let best: { e: OsmEl; score: number } | null = null;
  for (const e of raw) {
    if (!names(e.tags).some((n) => def.match.test(n))) continue;
    if (e.tags?.highway) continue;
    // ignore namesakes far from where the landmark should be (there are many St. Anthony's churches)
    const c = centroidLL(e);
    const km = c ? Math.hypot((c.lat - def.lat) * 110.6, (c.lon - def.lon) * 110.4) : 0;
    if (km > 1.5) continue;
    const t = e.tags!;
    const score = (t.building ? 3 : 0) + (t.tourism || t.historic || t.amenity || t.man_made || t.leisure || t.natural ? 2 : 0) + (e.type !== 'node' ? 1 : 0) - km;
    if (!best || score > best.score) best = { e, score };
  }
  let ll: LatLon | null = def.id === 'lotus' ? lotusLL : null;
  if (!ll && best) ll = centroidLL(best.e);
  landmarks.push({
    id: def.id, n: def.name, info: def.info,
    x: r1(projX((ll ?? def).lon)), z: r1(projZ((ll ?? def).lat)), osm: !!ll,
  });
}

// ---------- coastal train routes ----------
// Shortest path over the main-line tracks from Maradana to the south edge of the map, preferring
// ways named Coast(al) Line. The return route is penalised on the first route's edges so it takes
// the other track of the double line where OSM has one.
function trainRoutes() {
  const ids = new Map<string, number>();
  const nodes: { x: number; z: number; adj: { to: number; len: number; coast: boolean }[] }[] = [];
  const node = (x: number, z: number) => {
    const k = `${x},${z}`;
    let id = ids.get(k);
    if (id === undefined) { id = nodes.push({ x, z, adj: [] }) - 1; ids.set(k, id); }
    return id;
  };
  for (const r of mainRails) for (let i = 0; i < r.p.length / 2 - 1; i++) {
    const a = node(r.p[i * 2], r.p[i * 2 + 1]), b = node(r.p[i * 2 + 2], r.p[i * 2 + 3]);
    const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
    if (a === b) continue;
    nodes[a].adj.push({ to: b, len, coast: r.coast });
    nodes[b].adj.push({ to: a, len, coast: r.coast });
  }
  if (!nodes.length) return undefined;
  const nearest = (x: number, z: number) => {
    let best = 0, bd = Infinity;
    nodes.forEach((n, i) => { const d = Math.hypot(n.x - x, n.z - z); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const mar = stations.find((s) => /maradana/i.test(s.n));
  const coastNodes = new Set<number>();
  for (const r of mainRails) if (r.coast) for (let i = 0; i < r.p.length / 2; i++) coastNodes.add(ids.get(`${r.p[i * 2]},${r.p[i * 2 + 1]}`)!);
  let south = -1;
  for (const i of coastNodes) if (south < 0 || nodes[i].z > nodes[south].z) south = i;
  if (!mar || south < 0) return undefined;

  const path = (from: number, to: number, used: Set<string>) => {
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const done = new Uint8Array(nodes.length);
    dist[from] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === to) break;
      done[u] = 1;
      for (const e of nodes[u].adj) {
        const c = e.len * (e.coast ? 1 : 1.4) * (used.has(`${Math.min(u, e.to)}-${Math.max(u, e.to)}`) ? 4 : 1);
        if (dist[u] + c < dist[e.to]) { dist[e.to] = dist[u] + c; prev[e.to] = u; }
      }
    }
    if (prev[to] < 0) return null;
    const seq: number[] = [];
    for (let v = to; v >= 0; v = prev[v]) seq.push(v);
    return seq.reverse();
  };
  const start = nearest(mar.x, mar.z);
  const a = path(start, south, new Set());
  if (!a) return undefined;
  const used = new Set<string>();
  for (let i = 1; i < a.length; i++) used.add(`${Math.min(a[i - 1], a[i])}-${Math.max(a[i - 1], a[i])}`);
  const b = path(south, start, used) ?? [...a].reverse();
  // keep only the part inside the map (OSM returns whole ways, which run on past the bbox),
  // cutting the last segment exactly at the map edge
  const inB = (x: number, z: number) => x > bounds.minX && x < bounds.maxX && z > bounds.minZ && z < bounds.maxZ;
  const flatClip = (seq: number[]): Flat => {
    const out: Flat = [];
    let started = false;
    for (let k = 0; k < seq.length; k++) {
      const n = nodes[seq[k]];
      // point where segment m -> n crosses the map edge (m inside, n outside)
      const edgePt = (m: { x: number; z: number }, n2: { x: number; z: number }) => {
        let lo = 0, hi = 1;
        for (let it = 0; it < 30; it++) { const t = (lo + hi) / 2; if (inB(m.x + (n2.x - m.x) * t, m.z + (n2.z - m.z) * t)) lo = t; else hi = t; }
        out.push(r1(m.x + (n2.x - m.x) * lo), r1(m.z + (n2.z - m.z) * lo));
      };
      if (inB(n.x, n.z)) {
        if (!started && k > 0) edgePt(n, nodes[seq[k - 1]]);
        out.push(n.x, n.z);
        started = true;
        continue;
      }
      if (!started) continue;
      edgePt(nodes[seq[k - 1]], n);
      break;
    }
    return out;
  };
  const A = flatClip(a);
  const B = flatClip(b);

  // Where both routes use the same mapped track, shift each 1.9 m to the left of its direction
  // of travel (Sri Lanka runs on the left), easing in and out over 90 m.
  const segDist = (x: number, z: number, p: Flat) => {
    let best = Infinity;
    for (let i = 2; i < p.length; i += 2) best = Math.min(best, distSeg(x, z, p[i - 2], p[i - 1], p[i], p[i + 1]));
    return best;
  };
  const densify = (p: Flat, step = 10): Flat => {
    const out: Flat = [p[0], p[1]];
    for (let i = 2; i < p.length; i += 2) {
      const dx = p[i] - p[i - 2], dz = p[i + 1] - p[i - 1], n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step));
      for (let k = 1; k <= n; k++) out.push(p[i - 2] + (dx * k) / n, p[i - 1] + (dz * k) / n);
    }
    return out;
  };
  const SEP = 1.9, EASE = 90;
  const separate = (p: Flat, other: Flat): Flat => {
    const d = densify(p);
    const n = d.length / 2;
    const cum = [0];
    for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(d[i * 2] - d[i * 2 - 2], d[i * 2 + 1] - d[i * 2 - 1]));
    const shared = [];
    for (let i = 0; i < n; i++) shared.push(i > 0 && i < n - 1 && segDist(d[i * 2], d[i * 2 + 1], other) < 1.5);
    const out: Flat = [];
    for (let i = 0; i < n; i++) {
      let toFree = Infinity;
      for (let j = 0; j < n; j++) if (!shared[j]) toFree = Math.min(toFree, Math.abs(cum[j] - cum[i]));
      const off = SEP * Math.min(1, toFree / EASE);
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const tx = d[i1 * 2] - d[i0 * 2], tz = d[i1 * 2 + 1] - d[i0 * 2 + 1], tl = Math.hypot(tx, tz) || 1;
      out.push(r1(d[i * 2] + (tz / tl) * off), r1(d[i * 2 + 1] - (tx / tl) * off));
    }
    return out;
  };
  const routes = [separate(A, B), separate(B, A)];

  // the routes are drawn as their own tracks, so drop mapped rail segments they now replace
  const covered = (x: number, z: number) => segDist(x, z, A) < 1.5 || segDist(x, z, B) < 1.5;
  const kept: Flat[] = [];
  for (const r of rails) {
    let run: Flat = [];
    for (let i = 0; i < r.length / 2 - 1; i++) {
      const mx = (r[i * 2] + r[i * 2 + 2]) / 2, mz = (r[i * 2 + 1] + r[i * 2 + 3]) / 2;
      if (covered(mx, mz) && covered(r[i * 2], r[i * 2 + 1]) && covered(r[i * 2 + 2], r[i * 2 + 3])) {
        if (run.length >= 4) kept.push(run);
        run = [];
        continue;
      }
      if (!run.length) run.push(r[i * 2], r[i * 2 + 1]);
      run.push(r[i * 2 + 2], r[i * 2 + 3]);
    }
    if (run.length >= 4) kept.push(run);
  }
  rails.length = 0;
  rails.push(...kept);
  return { routes, stations };
}
const trains = trainRoutes();
if (trains) {
  const len = (p: Flat) => { let s = 0; for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); return s; };
  console.log(`Train routes: ${trains.routes.map((r) => `${(len(r) / 1000).toFixed(2)} km`).join(', ')}; stations: ${stations.map((s) => s.n).join(', ')}`);
}

// ---------- write ----------
const city: CityData = {
  version: 1,
  generated: new Date().toISOString(),
  source: 'OpenStreetMap contributors (ODbL), Overpass API',
  origin: { lat: origin.lat, lon: origin.lon },
  bbox: BBOX,
  bounds,
  roads, rails, buildings, areas, coast, water, land, waterways, piers,
  trees: treesOut,
  fillerCount,
  places,
  landmarks,
  trains,
};
mkdirSync(dirname(OUT_FILE), { recursive: true });
const json = JSON.stringify(city);
writeFileSync(OUT_FILE, json);
console.log(
  `Wrote ${OUT_FILE} (${(json.length / 1e6).toFixed(1)} MB): ${roads.length} roads, ${rails.length} rails, ` +
  `${osmBuildingCount} OSM buildings + ${fillerCount} filler, ${areas.length} areas, ${water.length} water rings, ` +
  `${treesOut.length / 4} trees, ${places.length} places`,
);
for (const l of landmarks) console.log(`  ${l.osm ? 'OSM ' : 'FALLBACK'} ${l.n} @ (${l.x}, ${l.z})`);
void pick;
