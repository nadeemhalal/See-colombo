import type { CityData } from '../types';
import { ROAD_TYPES } from '../types';

export interface GNode { x: number; z: number; out: number[] }
export interface GEdge {
  a: number; b: number;
  len: number;
  dx: number; dz: number; // unit direction a -> b
  speed: number; // m/s target for this road class
  w: number; // carriageway width
  oneway: boolean;
  /** 0 motorway .. 5 residential */
  cls: number;
}

// typical Colombo traffic speeds (m/s)
const CLASS_SPEED = [16, 12, 11, 10, 8.5, 6.5];
const DRIVEABLE = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential'];

export interface GraphOptions {
  /** road classes to include (default: drivable roads) */
  classes?: readonly string[];
  /** treat every way as two-way (pedestrians) */
  ignoreOneway?: boolean;
}

/** Directed road graph built from the road polylines. Ways connect where they share a vertex. */
export class RoadGraph {
  nodes: GNode[] = [];
  edges: GEdge[] = [];
  private grid = new Map<number, number[]>();
  private static CELL = 100;

  constructor(city: CityData, opts: GraphOptions = {}) {
    const allowed = new Set(opts.classes ?? DRIVEABLE);
    const ids = new Map<string, number>();
    const node = (x: number, z: number) => {
      const k = `${x},${z}`;
      let id = ids.get(k);
      if (id === undefined) {
        id = this.nodes.push({ x, z, out: [] }) - 1;
        ids.set(k, id);
      }
      return id;
    };
    for (const r of city.roads) {
      const cls = ROAD_TYPES[r.t];
      if (!allowed.has(cls)) continue;
      const o = opts.ignoreOneway ? 0 : r.o;
      const p = r.p;
      for (let i = 0; i < p.length / 2 - 1; i++) {
        const a = node(p[i * 2], p[i * 2 + 1]);
        const b = node(p[i * 2 + 2], p[i * 2 + 3]);
        if (a === b) continue;
        const dx = this.nodes[b].x - this.nodes[a].x, dz = this.nodes[b].z - this.nodes[a].z;
        const len = Math.hypot(dx, dz);
        if (len < 0.3) continue;
        const base = { len, speed: CLASS_SPEED[r.t] ?? 6.5, w: r.w, oneway: !!o, cls: r.t };
        if (o !== -1) this.addEdge({ ...base, a, b, dx: dx / len, dz: dz / len });
        if (o !== 1) this.addEdge({ ...base, a: b, b: a, dx: -dx / len, dz: -dz / len });
      }
    }
  }

  private addEdge(e: GEdge) {
    const id = this.edges.push(e) - 1;
    this.nodes[e.a].out.push(id);
    const n = this.nodes[e.a];
    const C = RoadGraph.CELL;
    const k = (Math.floor(n.x / C) + 1000) * 2000 + Math.floor(n.z / C) + 1000;
    let c = this.grid.get(k);
    if (!c) this.grid.set(k, (c = []));
    c.push(id);
  }

  /** Edges whose start node lies within `radius` of (x, z). */
  edgesNear(x: number, z: number, radius: number): number[] {
    const C = RoadGraph.CELL;
    const out: number[] = [];
    for (let cx = Math.floor((x - radius) / C); cx <= Math.floor((x + radius) / C); cx++)
      for (let cz = Math.floor((z - radius) / C); cz <= Math.floor((z + radius) / C); cz++) {
        const c = this.grid.get((cx + 1000) * 2000 + cz + 1000);
        if (!c) continue;
        for (const id of c) {
          const n = this.nodes[this.edges[id].a];
          if (Math.hypot(n.x - x, n.z - z) <= radius) out.push(id);
        }
      }
    return out;
  }

  /** Pick the next edge at the end of `from`; avoids U-turns unless it's a dead end. */
  next(from: number, rand: () => number, preferMajor = false): number {
    const e = this.edges[from];
    const outs = this.nodes[e.b].out.filter((id) => this.edges[id].b !== e.a);
    if (!outs.length) {
      const back = this.nodes[e.b].out;
      return back.length ? back[0] : -1;
    }
    // weight: keep going roughly straight, stay on bigger roads
    let total = 0;
    const w = outs.map((id) => {
      const o = this.edges[id];
      const straight = e.dx * o.dx + e.dz * o.dz; // -1..1
      let wt = 0.4 + Math.max(0, straight) * 1.6 + (o.cls <= e.cls ? 0.6 : 0);
      if (preferMajor && o.cls >= 5) wt *= 0.05;
      total += wt;
      return wt;
    });
    let r = rand() * total;
    for (let i = 0; i < outs.length; i++) { r -= w[i]; if (r <= 0) return outs[i]; }
    return outs[outs.length - 1];
  }

  /** Lateral offset from the centre line for left-hand traffic. */
  laneOffset(edge: number, laneIdx = 0): number {
    const e = this.edges[edge];
    if (e.oneway) return e.w >= 8 ? (laneIdx ? -e.w / 4 : e.w / 4) : 0;
    return Math.max(1.4, e.w / 4);
  }
}
