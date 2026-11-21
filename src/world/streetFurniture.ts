import * as THREE from 'three';
import type { CityData, Flat } from '../types';
import type { Collision } from './collision';
import type { RoadGraph } from '../traffic/roadGraph';
import { partKit, vehicleMaterial } from '../traffic/models';
import { TRAIN_CAR_W } from '../traffic/models';

// Bus stops (shelters at the kerb), bus stations, traffic lights at signalled junctions (which the
// traffic obeys) and raised platforms with name boards at the railway stations. Positions come from
// OpenStreetMap; everything static is merged into one mesh per 1 km region.

const { box, limb, col, merge } = partKit;
type Part = THREE.BufferGeometry;

const CONCRETE = 0xb9b3a7, CONCRETE_DARK = 0x8f8a80, POLE = 0x5b5f63, SIGN_BLUE = 0x1d4f91, BENCH = 0x7d5a3c;
const SIGNAL_BODY = 0x1b1d1f, PLATFORM_EDGE = 0xe3c22b;
const REGION = 1000;

/** green / amber / red timings (s) for a junction with two groups of approaches */
const GREEN = 14, AMBER = 3, ALL_RED = 1.5;
const CYCLE2 = 2 * (GREEN + AMBER + ALL_RED);
/** a signalled crossing on a plain road: traffic green, then a pedestrian phase */
const X_GREEN = 20, X_RED = 9, CYCLE1 = X_GREEN + AMBER + X_RED;

export const Light = { Red: 0, Amber: 1, Green: 2 } as const;
export type Light = (typeof Light)[keyof typeof Light];

interface Junction { groups: number; offset: number; state: Light[] /* per group */ }
interface Approach { j: number; group: number; head: number }
/** where an edge's traffic must stop: distance along the edge of the stop line (may be past its end) */
export interface StopLine { s: number; approach: number }
export interface BusStopMark { s: number; id: number }

const rand = (() => {
  let seed = 90210;
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
})();

export class StreetFurniture {
  group = new THREE.Group();
  private junctions: Junction[] = [];
  private approaches: Approach[] = [];
  private stopLines = new Map<number, StopLine>();
  private busMarks = new Map<number, BusStopMark>();
  private lenses: THREE.InstancedMesh[] = [];
  private time = 0;
  private lastNight = -1;
  /** for the debug overlay / tests */
  stats = { stops: 0, shelters: 0, junctions: 0, heads: 0, platforms: 0 };

  constructor(city: CityData, private graph: RoadGraph, private collision: Collision) {
    this.group.name = 'street-furniture';
    const regions = new Map<number, Part[]>();
    const put = (x: number, z: number, parts: Part[]) => {
      const k = (Math.floor(x / REGION) + 100) * 1000 + Math.floor(z / REGION) + 100;
      let r = regions.get(k);
      if (!r) regions.set(k, (r = []));
      r.push(...parts);
    };
    const heads: THREE.Matrix4[] = [];
    this.buildSignals(city.signals ?? [], put, heads);
    this.buildBusStops(city.busStops ?? [], put);
    this.buildBusStations(city.busStations ?? [], put);
    this.buildPlatforms(city, put);

    const mat = vehicleMaterial();
    for (const parts of regions.values()) {
      const m = new THREE.Mesh(merge(parts), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }
    // signal lenses: red, amber, green, one instance per head; colours change with the light
    const lensGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.03, 12).rotateX(Math.PI / 2);
    [0.31, 0, -0.31].forEach((dy) => {
      const mesh = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), Math.max(1, heads.length));
      const off = new THREE.Matrix4().makeTranslation(0, dy, 0.14);
      heads.forEach((h, i) => mesh.setMatrixAt(i, h.clone().multiply(off)));
      mesh.count = heads.length;
      mesh.setColorAt(0, new THREE.Color());
      this.lenses.push(mesh);
      this.group.add(mesh);
    });
    this.stats.heads = heads.length;
    this.stats.junctions = this.junctions.length;
    this.update(0, 0);
  }

  // ---------------------------------------------------------------- traffic signals

  private buildSignals(sig: Flat, put: (x: number, z: number, p: Part[]) => void, heads: THREE.Matrix4[]) {
    const g = this.graph;
    if (!sig.length) return;
    // incoming edges per node, and how many roads meet there
    const incoming = new Map<number, number[]>();
    g.edges.forEach((e, id) => { let l = incoming.get(e.b); if (!l) incoming.set(e.b, (l = [])); l.push(id); });
    const degree = (n: number) => {
      const nb = new Set<number>();
      for (const id of g.nodes[n].out) nb.add(g.edges[id].b);
      for (const id of incoming.get(n) ?? []) nb.add(g.edges[id].a);
      return nb.size;
    };
    const nodesNear = (x: number, z: number, r: number) => {
      const out = new Set<number>();
      for (const id of g.edgesNear(x, z, r)) {
        const e = g.edges[id];
        for (const n of [e.a, e.b]) if (Math.hypot(g.nodes[n].x - x, g.nodes[n].z - z) <= r) out.add(n);
      }
      return [...out];
    };

    // each signal node -> the junction it controls (or a crossing on a plain road)
    const picked: { n: number; crossing: boolean }[] = [];
    for (let i = 0; i < sig.length; i += 2) {
      const x = sig[i], z = sig[i + 1];
      const near = nodesNear(x, z, 35).sort((a, b) => Math.hypot(g.nodes[a].x - x, g.nodes[a].z - z) - Math.hypot(g.nodes[b].x - x, g.nodes[b].z - z));
      const j = near.find((n) => degree(n) >= 3);
      if (j !== undefined) picked.push({ n: j, crossing: false });
      else if (near.length && Math.hypot(g.nodes[near[0]].x - x, g.nodes[near[0]].z - z) < 6) picked.push({ n: near[0], crossing: true });
    }
    // merge nodes of one junction (dual carriageways meet at several nodes)
    const clusters: { nodes: Set<number>; crossing: boolean }[] = [];
    for (const p of picked) {
      const P = g.nodes[p.n];
      const c = clusters.find((c) => c.crossing === p.crossing && [...c.nodes].some((n) => Math.hypot(g.nodes[n].x - P.x, g.nodes[n].z - P.z) < 25));
      if (c) c.nodes.add(p.n);
      else clusters.push({ nodes: new Set([p.n]), crossing: p.crossing });
    }

    for (const c of clusters) {
      const ji = this.junctions.length;
      const app = [...c.nodes].flatMap((n) => (incoming.get(n) ?? []).filter((id) => !c.nodes.has(g.edges[id].a)));
      if (app.length < 2 && !c.crossing) continue;
      if (!app.length) continue;
      // group approaches by axis: those within 45 degrees of the first approach (either way) go together
      const ax = g.edges[app[0]];
      let groups = 1;
      const groupOf = (id: number) => {
        if (c.crossing) return 0;
        const e = g.edges[id];
        const along = Math.abs(e.dx * ax.dx + e.dz * ax.dz);
        return along > Math.SQRT1_2 ? 0 : 1;
      };
      for (const id of app) if (groupOf(id) === 1) groups = 2;
      this.junctions.push({ groups, offset: rand() * 40, state: [Light.Green, Light.Red] });
      // the widest road here sets how far back cars stop
      const wide = Math.max(...app.map((id) => g.edges[id].w));
      for (const id of app) {
        const e = g.edges[id];
        const stopDist = c.crossing ? 3 : Math.min(14, wide / 2 + 2.5);
        const ai = this.approaches.length;
        const approach: Approach = { j: ji, group: groupOf(id), head: -1 };
        this.approaches.push(approach);
        // stop lines back along the approach, through plain road nodes, so cars see them in time
        let cur = id, ahead = 0, guard = 0;
        while (guard++ < 12) {
          const ce = g.edges[cur];
          const s = ce.len + ahead - stopDist;
          if (!this.stopLines.has(cur)) this.stopLines.set(cur, { s, approach: ai });
          ahead += ce.len;
          if (ahead > 60 || degree(ce.a) !== 2) break;
          const prev = (incoming.get(ce.a) ?? []).find((p) => g.edges[p].a !== ce.b);
          if (prev === undefined) break;
          cur = prev;
        }
        // the signal: on the left kerb at the stop line, facing the cars coming up to it
        const B = g.nodes[e.b];
        const lx = e.dz, lz = -e.dx;
        const kerb = e.w / 2 + 0.7;
        const px = B.x - e.dx * stopDist + lx * kerb, pz = B.z - e.dz * stopDist + lz * kerb;
        if (this.collision.pointBlocked(px, 0.5, pz)) continue;
        const h = Math.atan2(-e.dx, -e.dz);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h), new THREE.Vector3(1, 1, 1));
        approach.head = heads.length;
        heads.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.75, 0)));
        put(px, pz, signalPole().map((p) => p.applyMatrix4(m)));
        this.collision.addCircle(px, pz, 0.15, 3.5);
      }
    }
  }

  /** the light an edge's traffic faces, if it leads to a signal (and where the stop line is) */
  stopLine(edge: number): StopLine | undefined { return this.stopLines.get(edge); }
  light(st: StopLine): Light {
    const a = this.approaches[st.approach];
    return this.junctions[a.j].state[a.group];
  }
  busStop(edge: number): BusStopMark | undefined { return this.busMarks.get(edge); }

  /** advance the signal cycles and recolour the lenses; night 0..1 makes them brighter (for bloom) */
  update(dt: number, night: number) {
    this.time += dt;
    let changed = false;
    for (const j of this.junctions) {
      const before0 = j.state[0], before1 = j.state[1];
      if (j.groups === 1) {
        const t = (this.time + j.offset) % CYCLE1;
        j.state[0] = t < X_GREEN ? Light.Green : t < X_GREEN + AMBER ? Light.Amber : Light.Red;
      } else {
        const t = (this.time + j.offset) % CYCLE2, half = GREEN + AMBER + ALL_RED;
        const phase = (u: number) => (u < GREEN ? Light.Green : u < GREEN + AMBER ? Light.Amber : Light.Red);
        j.state[0] = t < half ? phase(t) : Light.Red;
        j.state[1] = t >= half ? phase(t - half) : Light.Red;
      }
      if (j.state[0] !== before0 || j.state[1] !== before1) changed = true;
    }
    const n = Math.round(night * 10) / 10;
    if (!changed && n === this.lastNight) return;
    this.lastNight = n;
    const k = 1 + 2.2 * n;
    const on = [new THREE.Color(1.0 * k, 0.12 * k, 0.08 * k), new THREE.Color(1.0 * k, 0.62 * k, 0.05 * k), new THREE.Color(0.15 * k, 1.0 * k, 0.4 * k)];
    const off = [new THREE.Color(0.16, 0.03, 0.03), new THREE.Color(0.16, 0.11, 0.02), new THREE.Color(0.02, 0.13, 0.05)];
    const lensFor = [Light.Red, Light.Amber, Light.Green];
    for (const a of this.approaches) {
      if (a.head < 0) continue;
      const st = this.junctions[a.j].state[a.group];
      for (let li = 0; li < 3; li++) this.lenses[li].setColorAt(a.head, st === lensFor[li] ? on[li] : off[li]);
    }
    for (const l of this.lenses) if (l.instanceColor) l.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- bus stops

  /** nearest drivable road edge to (x, z): edge id, distance along it and how far off its centre line */
  private nearestEdge(x: number, z: number, r: number) {
    const g = this.graph;
    let best = -1, bs = 0, bd = r, side = 1;
    for (const id of g.edgesNear(x, z, r + 50)) {
      const e = g.edges[id], A = g.nodes[e.a];
      const s = THREE.MathUtils.clamp((x - A.x) * e.dx + (z - A.z) * e.dz, 0, e.len);
      const px = A.x + e.dx * s, pz = A.z + e.dz * s;
      const d = Math.hypot(x - px, z - pz);
      // prefer the direction whose left kerb (the bus's side) the stop is on
      const left = (x - px) * e.dz - (z - pz) * e.dx >= 0;
      const score = d - (left ? 0.5 : 0);
      if (score < bd) { bd = score; best = id; bs = s; side = left ? 1 : -1; }
    }
    return best < 0 ? null : { id: best, s: bs, side };
  }

  private buildBusStops(stops: Flat, put: (x: number, z: number, p: Part[]) => void) {
    const g = this.graph;
    let id = 0;
    for (let i = 0; i < stops.length; i += 3) {
      const x = stops[i], z = stops[i + 1], shelter = stops[i + 2] === 1;
      const ne = this.nearestEdge(x, z, 30);
      if (!ne) continue;
      const e = g.edges[ne.id], A = g.nodes[e.a];
      // always on the left kerb of the chosen direction, so buses going that way pull in to it
      const lx = e.dz, lz = -e.dx;
      const cx = A.x + e.dx * ne.s, cz = A.z + e.dz * ne.s;
      let placed = false;
      for (const off of shelter ? [e.w / 2 + 1.9, e.w / 2 + 1.3] : []) {
        const px = cx + lx * off, pz = cz + lz * off;
        if (this.blockedBox(px, pz, e.dx, e.dz, 2.2, 1.0)) continue;
        const h = Math.atan2(-lx, -lz); // open side faces the road
        const m = new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h), new THREE.Vector3(1, 1, 1));
        put(px, pz, busShelter(rand()).map((p) => p.applyMatrix4(m)));
        // back wall and roof posts
        const bx = px + lx * 0.75, bz = pz + lz * 0.75;
        const wx = e.dx * 2.0, wz = e.dz * 2.0, tx = lx * 0.08, tz = lz * 0.08;
        this.collision.addPolygon([bx - wx - tx, bz - wz - tz, bx + wx - tx, bz + wz - tz, bx + wx + tx, bz + wz + tz, bx - wx + tx, bz - wz + tz], undefined, 2.4);
        for (const s of [1, -1]) this.collision.addCircle(px - lx * 0.75 + e.dx * 1.9 * s, pz - lz * 0.75 + e.dz * 1.9 * s, 0.08, 2.4);
        placed = true;
        this.stats.shelters++;
        break;
      }
      if (!placed) {
        // just the sign by the kerb
        const off = e.w / 2 + 0.6, px = cx + lx * off, pz = cz + lz * off;
        if (this.collision.pointBlocked(px, 0.5, pz)) continue;
        const h = Math.atan2(-lx, -lz);
        const m = new THREE.Matrix4().compose(new THREE.Vector3(px, 0, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h), new THREE.Vector3(1, 1, 1));
        put(px, pz, busSign(0, 0).map((p) => p.applyMatrix4(m)));
        this.collision.addCircle(px, pz, 0.06, 2.6);
      }
      // buses pull up with their door by the stop
      if (!this.busMarks.has(ne.id)) this.busMarks.set(ne.id, { s: ne.s, id: id++ });
      this.stats.stops++;
    }
  }

  /** is a rectangle (half length hl along d, half depth hd across) blocked by a building */
  private blockedBox(x: number, z: number, dx: number, dz: number, hl: number, hd: number) {
    for (const a of [-1, 0, 1]) for (const b of [-1, 1]) {
      if (this.collision.pointBlocked(x + dx * hl * a + dz * hd * b, 0.5, z + dz * hl * a - dx * hd * b)) return true;
    }
    return false;
  }

  private buildBusStations(st: { n: string; x: number; z: number }[], put: (x: number, z: number, p: Part[]) => void) {
    for (const s of st) {
      const ne = this.nearestEdge(s.x, s.z, 80);
      if (!ne) continue;
      const e = this.graph.edges[ne.id];
      // the canopy sits on the station's node, turned to line up with the nearest road
      if (this.blockedBox(s.x, s.z, e.dx, e.dz, 9, 4)) continue;
      const h = Math.atan2(e.dx, e.dz) + Math.PI / 2;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h), new THREE.Vector3(1, 1, 1));
      put(s.x, s.z, busStationCanopy().map((p) => p.applyMatrix4(m)));
      for (const px of [-8, -2.7, 2.7, 8]) for (const pz of [-2.6, 2.6]) {
        const v = new THREE.Vector3(px, 0, pz).applyMatrix4(m);
        this.collision.addCircle(v.x, v.z, 0.18, 4);
      }
    }
  }

  // ---------------------------------------------------------------- railway platforms

  private buildPlatforms(city: CityData, put: (x: number, z: number, p: Part[]) => void) {
    const rails = city.rails;
    const stations = city.trains?.stations ?? [];
    const HALF = 45; // platform half length (m)
    const near = (x: number, z: number) => {
      // every rail segment within reach, as (rail index, segment index, distance, t)
      const out: { r: number; i: number; d: number; t: number }[] = [];
      rails.forEach((p, r) => {
        for (let i = 0; i < p.length / 2 - 1; i++) {
          const ax = p[i * 2], az = p[i * 2 + 1], dx = p[i * 2 + 2] - ax, dz = p[i * 2 + 3] - az;
          const l2 = dx * dx + dz * dz || 1;
          const t = THREE.MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1);
          const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
          if (d < 90) out.push({ r, i, d, t });
        }
      });
      return out.sort((a, b) => a.d - b.d);
    };
    for (const st of stations) {
      const cand = near(st.x, st.z);
      if (!cand.length) continue;
      const c0 = cand[0], p = rails[c0.r];
      const ax = p[c0.i * 2], az = p[c0.i * 2 + 1];
      let dx = p[c0.i * 2 + 2] - ax, dz = p[c0.i * 2 + 3] - az;
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const cx = ax + dx * L * c0.t, cz = az + dz * L * c0.t;
      const nx = dz, nz = -dx;
      // other tracks alongside: their offsets across the line
      let lo = 0, hi = 0;
      for (const c of cand) {
        const q = rails[c.r];
        const qx = q[c.i * 2] + (q[c.i * 2 + 2] - q[c.i * 2]) * c.t, qz = q[c.i * 2 + 1] + (q[c.i * 2 + 3] - q[c.i * 2 + 1]) * c.t;
        const along = (qx - cx) * dx + (qz - cz) * dz, across = (qx - cx) * nx + (qz - cz) * nz;
        if (Math.abs(along) > 30 || Math.abs(across) > 14) continue;
        // only tracks running the same way
        const ex = q[c.i * 2 + 2] - q[c.i * 2], ez = q[c.i * 2 + 3] - q[c.i * 2 + 1];
        if (Math.abs((ex * dx + ez * dz) / (Math.hypot(ex, ez) || 1)) < 0.9) continue;
        lo = Math.min(lo, across); hi = Math.max(hi, across);
      }
      const inner = TRAIN_CAR_W / 2 + 0.15, depth = 4.2;
      let boardDone = false;
      for (const side of [1, -1]) {
        const o1 = (side > 0 ? hi : -lo) + inner, o2 = o1 + depth;
        // follow the track's polyline for the platform's length
        const pts = sampleAlong(p, c0.i, c0.t, -HALF, HALF, 5);
        const ring: number[] = [];
        for (const q of pts) ring.push(q.x + q.nx * o1 * side, q.z + q.nz * o1 * side);
        for (let k = pts.length - 1; k >= 0; k--) ring.push(pts[k].x + pts[k].nx * o2 * side, pts[k].z + pts[k].nz * o2 * side);
        if (this.collision.pointBlocked(cx + nx * (o1 + depth / 2) * side, 0.5, cz + nz * (o1 + depth / 2) * side)) continue;
        const parts: Part[] = [];
        parts.push(prism(ring, 0, 0.95, CONCRETE));
        // yellow safety line along the edge
        const edge: number[] = [];
        for (const q of pts) edge.push(q.x + q.nx * (o1 + 0.35) * side, q.z + q.nz * (o1 + 0.35) * side);
        for (let k = pts.length - 1; k >= 0; k--) edge.push(pts[k].x + pts[k].nx * (o1 + 0.5) * side, pts[k].z + pts[k].nz * (o1 + 0.5) * side);
        parts.push(prism(edge, 0.95, 0.955, PLATFORM_EDGE));
        // canopy over the middle with posts, benches under it
        const mid = pts.filter((q) => Math.abs(q.s) <= 26);
        const roof: number[] = [];
        for (const q of mid) roof.push(q.x + q.nx * (o1 + 0.5) * side, q.z + q.nz * (o1 + 0.5) * side);
        for (let k = mid.length - 1; k >= 0; k--) roof.push(mid[k].x + mid[k].nx * (o2 - 0.2) * side, mid[k].z + mid[k].nz * (o2 - 0.2) * side);
        parts.push(prism(roof, 4.1, 4.25, 0x7a3b2e));
        for (const q of mid) {
          if (Math.round(q.s) % 10 !== 0) continue;
          const px = q.x + q.nx * (o1 + 2.6) * side, pz = q.z + q.nz * (o1 + 2.6) * side;
          parts.push(limb([px, 0.95, pz], [px, 4.12, pz], 0.09, 0x5d6166));
          if (Math.round(q.s) % 20 === 0 && Math.abs(q.s) > 2) {
            const bx = q.x + q.nx * (o1 + 3.3) * side, bz = q.z + q.nz * (o1 + 3.3) * side;
            const h = Math.atan2(q.nx * side, q.nz * side);
            parts.push(...bench().map((g) => g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(bx, 0.95, bz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h + Math.PI), new THREE.Vector3(1, 1, 1)))));
          }
          this.collision.addCircle(px, pz, 0.12, 4.2);
        }
        put(cx, cz, parts);
        this.collision.addPolygon(ring, undefined, 0.95);
        this.stats.platforms++;
        // station name board at the middle of the platform
        const q = pts.find((u) => Math.abs(u.s) < 3) ?? pts[Math.floor(pts.length / 2)];
        const bx = q.x + q.nx * (o1 + 1.6) * side, bz = q.z + q.nz * (o1 + 1.6) * side;
        const h = Math.atan2(q.dx, q.dz) + Math.PI / 2;
        this.group.add(nameBoard(st.n, bx, bz, h));
        boardDone = true;
      }
      void boardDone;
    }
  }
}

/** points every `step` m along polyline p, from `from` to `to` metres either side of (segment i, t) */
function sampleAlong(p: Flat, i0: number, t0: number, from: number, to: number, step: number) {
  const n = p.length / 2;
  const segLen = (i: number) => Math.hypot(p[i * 2 + 2] - p[i * 2], p[i * 2 + 3] - p[i * 2 + 1]);
  const out: { x: number; z: number; nx: number; nz: number; dx: number; dz: number; s: number }[] = [];
  for (let s = from; s <= to + 1e-6; s += step) {
    let i = i0, t = t0 * segLen(i0) + s; // distance into segment i
    while (t < 0 && i > 0) { i--; t += segLen(i); }
    while (t > segLen(i) && i < n - 2) { t -= segLen(i); i++; }
    const L = segLen(i) || 1;
    const dx = (p[i * 2 + 2] - p[i * 2]) / L, dz = (p[i * 2 + 3] - p[i * 2 + 1]) / L;
    out.push({ x: p[i * 2] + dx * t, z: p[i * 2 + 1] + dz * t, nx: dz, nz: -dx, dx, dz, s });
  }
  return out;
}

/** a flat ring (x, z pairs) raised from y0 to y1 */
function prism(ring: number[], y0: number, y1: number, hex: number): Part {
  const shape = new THREE.Shape();
  shape.moveTo(ring[0], -ring[1]);
  for (let i = 2; i < ring.length; i += 2) shape.lineTo(ring[i], -ring[i + 1]);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false, curveSegments: 1 });
  g.rotateX(-Math.PI / 2); // shape y (= -z) -> world -z... extrusion -> +y
  g.translate(0, y0, 0);
  return col(g, hex);
}

function signalPole(): Part[] {
  return [
    limb([0, 0, 0], [0, 2.3, 0], 0.07, POLE),
    box(0.36, 1.0, 0.26, 0, 2.75, 0, SIGNAL_BODY), // housing
    box(0.5, 1.12, 0.03, 0, 2.75, -0.14, 0x111111), // backboard
    ...[0.31, 0, -0.31].map((dy) => box(0.26, 0.04, 0.14, 0, 2.75 + dy + 0.12, 0.2, SIGNAL_BODY)), // visors
    box(0.25, 0.08, 0.25, 0, 0.04, 0, CONCRETE_DARK),
  ];
}

function bench(): Part[] {
  return [
    box(1.8, 0.06, 0.42, 0, 0.46, 0, BENCH), box(1.8, 0.35, 0.05, 0, 0.7, -0.2, BENCH),
    box(0.06, 0.45, 0.4, 0.8, 0.22, 0, POLE), box(0.06, 0.45, 0.4, -0.8, 0.22, 0, POLE),
  ];
}

/** the blue bus stop sign on a pole, at local (x, z) */
function busSign(x: number, z: number): Part[] {
  return [
    limb([x, 0, z], [x, 2.6, z], 0.035, POLE),
    box(0.55, 0.38, 0.04, x, 2.45, z + 0.04, SIGN_BLUE),
    box(0.34, 0.16, 0.01, x, 2.47, z + 0.065, 0xf2f2f2), // bus pictogram plate
    box(0.22, 0.07, 0.012, x, 2.48, z + 0.072, SIGN_BLUE),
  ];
}

/** concrete bus shelter, open towards local +Z (the road) */
function busShelter(r: number): Part[] {
  const wall = r < 0.4 ? 0xd9d1bf : r < 0.7 ? 0xc9d6dc : 0xe1d5b8;
  const roof = r < 0.5 ? 0x7c2d24 : 0x3d5568;
  return [
    box(4.4, 0.15, 1.9, 0, 0.075, 0, CONCRETE_DARK),
    box(4.0, 2.1, 0.14, 0, 1.2, -0.75, wall),
    box(0.14, 2.1, 1.0, 1.95, 1.2, -0.3, wall), box(0.14, 2.1, 1.0, -1.95, 1.2, -0.3, wall),
    box(4.5, 0.12, 2.3, 0, 2.4, 0.05, roof, 0.07),
    limb([1.9, 0.15, 0.75], [1.9, 2.35, 0.75], 0.06, POLE), limb([-1.9, 0.15, 0.75], [-1.9, 2.35, 0.75], 0.06, POLE),
    ...bench().map((g) => g.translate(0, 0.15, -0.42)),
    ...busSign(2.55, 0.85),
    box(1.6, 0.6, 0.03, -0.6, 1.5, -0.67, 0x2f6d9e), // poster panel
  ];
}

/** a bus stand: a long canopy on posts with benches (local x along the bays) */
function busStationCanopy(): Part[] {
  const out: Part[] = [box(17.5, 0.15, 6.4, 0, 0.075, 0, CONCRETE_DARK), box(18.2, 0.22, 7.0, 0, 4.1, 0, 0x6e7a80, 0.05)];
  for (const px of [-8, -2.7, 2.7, 8]) for (const pz of [-2.6, 2.6]) out.push(limb([px, 0.15, pz], [px, 4.0, pz], 0.12, POLE));
  for (const px of [-5.3, 0, 5.3]) out.push(...bench().map((g) => g.translate(px, 0.15, 0)));
  out.push(...busSign(8.6, 3.0));
  return out;
}

/** station name board on two legs, with the name painted on a canvas */
function nameBoard(name: string, x: number, z: number, h: number) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f1e6'; ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 502, 118);
  ctx.fillStyle = '#1b1b1b';
  let size = 64;
  ctx.font = `bold ${size}px sans-serif`;
  while (ctx.measureText(name).width > 470 && size > 20) { size -= 4; ctx.font = `bold ${size}px sans-serif`; }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name, 256, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const g = new THREE.Group();
  const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 0.06), [frame, frame, frame, frame, face, face]);
  board.position.y = 0.95 + 2.3;
  board.castShadow = true;
  g.add(board);
  for (const s of [1, -1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 6), frame);
    leg.position.set(s * 1.25, 0.95 + 1.0, 0);
    g.add(leg);
  }
  g.position.set(x, 0, z);
  g.rotation.y = h;
  return g;
}
