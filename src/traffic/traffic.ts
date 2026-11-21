import * as THREE from 'three';
import { RoadGraph } from './roadGraph';
import { VEHICLE_TYPES, vehicleMaterial, type VehicleType } from './models';

export interface Circle { x: number; z: number; r: number }

export interface Agent {
  type: number;
  inst: number;
  edge: number;
  s: number; // distance along edge
  lane: number;
  speed: number;
  factor: number; // personal speed multiplier
  x: number; z: number; heading: number;
  stopT: number;
  ghostT: number;
  honkT: number;
  /** crash: shoved off its lane, sliding and spinning until it stops, then it rejoins traffic */
  crashT: number; cvx: number; cvz: number; spin: number; tilt: number;
}

const COUNT = 140;
const SPAWN_MIN = 70, SPAWN_MAX = 280, DESPAWN = 340;
const ROAD_Y = 0.07;

let seed = 7;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

/** Ambient traffic driving on the left, following each other and stopping for the player. */
export class Traffic {
  group = new THREE.Group();
  agents: Agent[] = [];
  private meshes: THREE.InstancedMesh[] = [];
  private hash = new Map<number, number[]>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();

  private eul = new THREE.Euler();
  /** called when a car honks at the player (distance in metres) */
  onHonk: (dist: number) => void = () => {};

  constructor(public graph: RoadGraph, start: THREE.Vector3) {
    this.group.name = 'traffic';
    const counts = VEHICLE_TYPES.map((t) => Math.round(t.weight * COUNT));
    VEHICLE_TYPES.forEach((t, ti) => {
      const mesh = new THREE.InstancedMesh(t.geo(), vehicleMaterial(), counts[ti]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false; // instances move every frame
      this.meshes.push(mesh);
      this.group.add(mesh);
      const c = new THREE.Color();
      for (let i = 0; i < counts[ti]; i++) {
        c.setHex(t.colors[Math.floor(rand() * t.colors.length)]);
        mesh.setColorAt(i, c);
        const a: Agent = { type: ti, inst: i, edge: -1, s: 0, lane: 0, speed: 0, factor: 0.85 + rand() * 0.3,
          x: 0, z: 0, heading: 0, stopT: 0, ghostT: 0, crashT: 0, cvx: 0, cvz: 0, spin: 0, tilt: 0, honkT: 0 };
        this.spawn(a, start, 20, SPAWN_MAX);
        this.agents.push(a);
      }
    });
  }

  private spawn(a: Agent, around: THREE.Vector3, minD: number, maxD: number, view?: THREE.Vector3) {
    const t = VEHICLE_TYPES[a.type];
    const cand = this.graph.edgesNear(around.x, around.z, maxD).filter((id) => {
      const e = this.graph.edges[id];
      if (t.majorOnly && e.cls > 3) return false;
      const n = this.graph.nodes[e.a];
      const d = Math.hypot(n.x - around.x, n.z - around.z);
      if (d < minD) return false;
      // prefer spawning out of view
      if (view && d < 200) {
        const dot = ((n.x - around.x) * view.x + (n.z - around.z) * view.z) / d;
        if (dot > 0.2) return false;
      }
      return e.len > t.len;
    });
    if (!cand.length) { a.edge = -1; return; }
    for (let tries = 0; tries < 8; tries++) {
      const edge = cand[Math.floor(rand() * cand.length)];
      const s = rand() * this.graph.edges[edge].len;
      const lane = rand() < 0.5 ? 0 : 1;
      this.place(a, edge, s, lane);
      // don't drop on top of another vehicle
      if (!this.agents.some((o) => o !== a && o.edge >= 0 && Math.hypot(o.x - a.x, o.z - a.z) < 8)) break;
    }
    a.speed = 0;
    a.stopT = 0;
  }

  /**
   * The player's vehicle (circle at x,z with radius r, velocity vx,vz, mass in tonnes) rams traffic.
   * Momentum is shared out by mass: a bicycle flies, a bus barely moves. Returns the share of the
   * player's speed lost (0..1) and the impact strength, for sound.
   */
  ram(x: number, z: number, r: number, vx: number, vz: number, mass: number): { loss: number; impact: number } {
    let loss = 0, impact = 0;
    for (const a of this.agents) {
      if (a.edge < 0) continue;
      const t = VEHICLE_TYPES[a.type];
      // nearest point on the vehicle's centre line
      const hx = Math.sin(a.heading), hz = Math.cos(a.heading), half = Math.max(0, t.len / 2 - t.width / 2);
      const along = THREE.MathUtils.clamp((x - a.x) * hx + (z - a.z) * hz, -half, half);
      const px = a.x + hx * along, pz = a.z + hz * along;
      const dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
      if (d > r + t.width / 2 + 0.15 || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      const closing = vx * nx + vz * nz - (a.crashT > 0 ? a.cvx * nx + a.cvz * nz : a.speed * (hx * nx + hz * nz));
      if (closing < 1) continue;
      const m2 = t.mass;
      const push = (2 * mass / (mass + m2)) * closing * 0.75;
      a.cvx = (a.crashT > 0 ? a.cvx : hx * a.speed) + nx * push + vx * 0.15 * (mass / (mass + m2));
      a.cvz = (a.crashT > 0 ? a.cvz : hz * a.speed) + nz * push + vz * 0.15 * (mass / (mass + m2));
      // off-centre hits spin the vehicle
      a.spin += (along / Math.max(0.5, t.len / 2)) * push * 0.6 + (rand() - 0.5) * push * 0.2;
      a.speed = 0;
      a.crashT = 3.5 + Math.min(3, push * 0.4);
      if (t.twoWheel && push > 1.5) a.tilt = 0.001;
      loss = Math.max(loss, m2 / (mass + m2));
      impact = Math.max(impact, closing);
    }
    return { loss, impact };
  }

  /** the traffic vehicle whose outline is nearest (x,z), within maxD metres */
  nearest(x: number, z: number, maxD: number): Agent | null {
    let best: Agent | null = null, bd = maxD;
    for (const a of this.agents) {
      if (a.edge < 0) continue;
      const t = VEHICLE_TYPES[a.type];
      const hx = Math.sin(a.heading), hz = Math.cos(a.heading), half = Math.max(0, t.len / 2 - t.width / 2);
      const along = THREE.MathUtils.clamp((x - a.x) * hx + (z - a.z) * hz, -half, half);
      const d = Math.max(0, Math.hypot(x - a.x - hx * along, z - a.z - hz * along) - t.width / 2);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  /** take a vehicle out of traffic for the player: returns its type, colour and pose; it respawns elsewhere later */
  take(a: Agent) {
    const c = new THREE.Color();
    this.meshes[a.type].getColorAt(a.inst, c);
    const out = { type: a.type, color: c.getHex(), x: a.x, z: a.z, heading: a.heading, speed: a.crashT > 0 ? 0 : a.speed };
    a.edge = -1;
    a.crashT = 0; a.tilt = 0; a.spin = 0; a.cvx = a.cvz = 0;
    return out;
  }

  private place(a: Agent, edge: number, s: number, lane: number) {
    const e = this.graph.edges[edge];
    const n = this.graph.nodes[e.a];
    const off = this.graph.laneOffset(edge, lane);
    a.edge = edge; a.s = s; a.lane = lane;
    a.x = n.x + e.dx * s + e.dz * off;
    a.z = n.z + e.dz * s - e.dx * off;
    a.heading = Math.atan2(e.dx, e.dz);
  }

  /** after a crash: slide with tyre friction, spin down, two-wheelers fall over, then rejoin the lane */
  private slide(a: Agent, dt: number) {
    const t = VEHICLE_TYPES[a.type];
    a.x += a.cvx * dt; a.z += a.cvz * dt;
    const f = Math.exp(-(t.twoWheel ? 3.5 : 2.4) * dt);
    a.cvx *= f; a.cvz *= f;
    a.heading += a.spin * dt;
    a.spin *= Math.exp(-2.2 * dt);
    if (a.tilt) a.tilt = Math.min(Math.PI / 2 - 0.15, a.tilt + dt * 5);
    a.crashT -= dt;
    if (a.crashT <= 0) {
      // back onto the road: nearest point of its current edge, then the normal lane smoothing takes over
      const e = this.graph.edges[a.edge], n = this.graph.nodes[e.a];
      a.s = THREE.MathUtils.clamp((a.x - n.x) * e.dx + (a.z - n.z) * e.dz, 0, e.len);
      a.tilt = 0; a.spin = 0; a.cvx = a.cvz = 0; a.crashT = 0;
    }
  }

  private key(x: number, z: number) { return (Math.floor(x / 16) + 2000) * 4000 + Math.floor(z / 16) + 2000; }

  /** Circles approximating every vehicle, for the player's collision. */
  circles(out: Circle[] = []): Circle[] {
    for (const a of this.agents) {
      if (a.edge < 0) continue;
      const t = VEHICLE_TYPES[a.type];
      const r = t.width / 2;
      const n = Math.max(1, Math.round(t.len / t.width));
      const hx = Math.sin(a.heading), hz = Math.cos(a.heading);
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 0 : (i / (n - 1) - 0.5) * (t.len - t.width);
        out.push({ x: a.x + hx * k, z: a.z + hz * k, r });
      }
    }
    return out;
  }

  /**
   * player: position and radius of whatever the player is (on foot or driving).
   * view: camera forward on the ground plane, used to respawn cars out of sight.
   */
  update(dt: number, player: THREE.Vector3, playerR: number, view: THREE.Vector3, extraObstacles: Circle[] = []) {
    const g = this.graph;
    this.hash.clear();
    this.agents.forEach((a, i) => {
      if (a.edge < 0) return;
      const k = this.key(a.x, a.z);
      let c = this.hash.get(k);
      if (!c) this.hash.set(k, (c = []));
      c.push(i);
    });

    for (const a of this.agents) {
      if (a.edge < 0 || Math.hypot(a.x - player.x, a.z - player.z) > DESPAWN) {
        this.spawn(a, player, SPAWN_MIN, SPAWN_MAX, view);
        if (a.edge < 0) continue;
      }
      const t: VehicleType = VEHICLE_TYPES[a.type];
      if (a.crashT > 0) { this.slide(a, dt); continue; }
      const e = g.edges[a.edge];
      let want = Math.min(t.maxSpeed, e.speed) * a.factor;

      // slow for junctions and sharp turns
      const remain = e.len - a.s;
      if (remain < 10 && g.nodes[e.b].out.length > 2) want = Math.min(want, 4 + remain * 0.5);

      const hx = Math.sin(a.heading), hz = Math.cos(a.heading);
      const look = 6 + a.speed * 1.6;
      // gap to an obstacle ahead in our lane; latR = its half width, lonR = its half length
      const limitBy = (ox: number, oz: number, latR: number, lonR: number, oh: number | null) => {
        const dx = ox - a.x, dz = oz - a.z;
        const ahead = dx * hx + dz * hz;
        if (ahead <= 0 || ahead > look + t.len / 2 + lonR) return Infinity;
        const lat = Math.abs(dx * hz - dz * hx);
        if (lat > t.width / 2 + latR + 0.25) return Infinity;
        if (oh !== null && Math.cos(oh - a.heading) < -0.3) return Infinity; // oncoming, other lane
        return ahead - t.len / 2 - lonR;
      };

      let gap = Infinity;
      if (a.ghostT <= 0) {
        const cx = Math.floor(a.x / 16), cz = Math.floor(a.z / 16);
        for (let ix = -1; ix <= 1; ix++)
          for (let iz = -1; iz <= 1; iz++) {
            const c = this.hash.get((cx + ix + 2000) * 4000 + cz + iz + 2000);
            if (!c) continue;
            for (const j of c) {
              const o = this.agents[j];
              if (o === a) continue;
              const ot = VEHICLE_TYPES[o.type];
              gap = Math.min(gap, limitBy(o.x, o.z, ot.width / 2, ot.len / 2, o.heading));
            }
          }
        for (const ob of extraObstacles) gap = Math.min(gap, limitBy(ob.x, ob.z, ob.r, ob.r, null));
      }
      const playerGap = limitBy(player.x, player.z, playerR, playerR, null);
      gap = Math.min(gap, playerGap);
      if (gap < Infinity) want = Math.min(want, Math.max(0, (gap - 1.5) * 1.1));

      const accel = want > a.speed ? 2.6 : 7;
      a.speed += Math.sign(want - a.speed) * Math.min(Math.abs(want - a.speed), accel * dt);

      // gridlock breaker: after waiting a while, drive through other cars (never the player)
      a.ghostT -= dt;
      if (a.speed < 0.3 && want < 0.3) {
        a.stopT += dt;
        if (a.stopT > 7 && playerGap === Infinity) { a.ghostT = 3; a.stopT = 0; }
      } else a.stopT = 0;

      a.honkT -= dt;
      if (playerGap < 4 && a.speed < 1 && a.honkT <= 0) {
        a.honkT = 3 + rand() * 4;
        this.onHonk(Math.hypot(player.x - a.x, player.z - a.z));
      }

      // advance along the graph
      a.s += a.speed * dt;
      let guard = 0;
      while (a.s > g.edges[a.edge].len && guard++ < 10) {
        a.s -= g.edges[a.edge].len;
        const nxt = g.next(a.edge, rand, !!t.majorOnly);
        if (nxt < 0) { a.edge = -1; break; }
        a.edge = nxt;
        if (!g.edges[nxt].oneway) a.lane = 0;
      }
      if (a.edge < 0) continue;

      const ce = g.edges[a.edge];
      const n = g.nodes[ce.a];
      const off = g.laneOffset(a.edge, a.lane);
      const tx = n.x + ce.dx * a.s + ce.dz * off;
      const tz = n.z + ce.dz * a.s - ce.dx * off;
      // smooth over the lane-offset jumps at corners
      const k = 1 - Math.exp(-8 * dt);
      a.x += (tx - a.x) * k;
      a.z += (tz - a.z) * k;
      let dh = Math.atan2(ce.dx, ce.dz) - a.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * Math.min(1, (2 + a.speed) * dt);
    }

    // write instances
    for (const a of this.agents) {
      const mesh = this.meshes[a.type];
      if (a.edge < 0) {
        this.m4.makeScale(0, 0, 0);
      } else {
        this.q.setFromEuler(this.eul.set(0, a.heading, a.tilt, 'YXZ'));
        this.m4.compose(new THREE.Vector3(a.x, ROAD_Y, a.z), this.q, new THREE.Vector3(1, 1, 1));
      }
      mesh.setMatrixAt(a.inst, this.m4);
    }
    for (const m of this.meshes) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = false;
    }
  }
}
