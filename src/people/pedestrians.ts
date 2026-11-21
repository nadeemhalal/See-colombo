import * as THREE from 'three';
import type { CityData } from '../types';
import { RoadGraph } from '../traffic/roadGraph';
import type { Circle } from '../traffic/traffic';
import type { Collision } from '../world/collision';
import { PERSON_KINDS, SKIN_TONES, personDepthMaterial, personGeometry, personMaterial } from './models';

interface Ped {
  mesh: number;
  inst: number;
  edge: number; // -1 = inactive
  s: number;
  side: number; // +1 left pavement, -1 right pavement (relative to the edge direction)
  lat: number; // squeeze towards the kerb when a building is in the way
  speed: number;
  x: number; z: number; heading: number;
  phase: number;
  amp: number;
  idleT: number;
  fleeT: number; fx: number; fz: number;
  scale: number;
  /** knocked down: seconds left on the ground, fall progress 0..1, slide velocity */
  downT: number; fall: number; vx: number; vz: number;
}

export interface Threat { x: number; z: number; heading: number; speed: number }

const COUNT = 180;
const SPAWN_MIN = 25, SPAWN_MAX = 170, DESPAWN = 210;
const PAVE_Y = 0.04;
const R = 0.3;
const WALK_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'footway'];
const FOOTWAY = 7;
const SERVICE = 6;

let seed = 11;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};
const pick = <T>(a: T[]) => a[Math.floor(rand() * a.length)];

/** People walking the pavements, idling, crossing side streets and jumping out of the way of the player's tuk-tuk. */
export class Pedestrians {
  group = new THREE.Group();
  peds: Ped[] = [];
  graph: RoadGraph;
  private meshes: THREE.InstancedMesh[] = [];
  private anim: THREE.InstancedBufferAttribute[] = [];
  private hash = new Map<number, number[]>();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private xAxis = new THREE.Vector3(1, 0, 0);
  private qf = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();

  constructor(city: CityData, private collision: Collision, start: THREE.Vector3) {
    this.group.name = 'pedestrians';
    this.graph = new RoadGraph(city, { classes: WALK_CLASSES, ignoreOneway: true });
    const mat = personMaterial();
    const depth = personDepthMaterial();
    PERSON_KINDS.forEach((k, ki) => {
      const n = Math.round(k.weight * COUNT);
      const geo = personGeometry(k.kind);
      const skin = new Float32Array(n * 3), top = new Float32Array(n * 3), lower = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        const kid = k.kind !== 'sarong' && rand() < 0.1;
        c.setHex(pick(SKIN_TONES)).toArray(skin, i * 3);
        // school children in white uniforms
        c.setHex(kid ? 0xf4f4f0 : pick(k.tops)).toArray(top, i * 3);
        c.setHex(kid ? (k.kind === 'dress' ? 0xf4f4f0 : 0x1f2a44) : pick(k.lowers)).toArray(lower, i * 3);
        this.peds.push({ mesh: ki, inst: i, edge: -1, s: 0, side: 1, lat: 0, speed: 0, x: 0, z: 0, heading: 0,
          phase: rand() * 6.28, amp: 0, idleT: 0, fleeT: 0, fx: 0, fz: 0, downT: 0, fall: 0, vx: 0, vz: 0, scale: kid ? 0.74 : 0.93 + rand() * 0.14 });
      }
      geo.setAttribute('aSkin', new THREE.InstancedBufferAttribute(skin, 3));
      geo.setAttribute('aTop', new THREE.InstancedBufferAttribute(top, 3));
      geo.setAttribute('aLower', new THREE.InstancedBufferAttribute(lower, 3));
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
      anim.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aAnim', anim);
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.meshes.push(mesh);
      this.anim.push(anim);
      this.group.add(mesh);
    });
    for (const p of this.peds) this.spawn(p, start, 4, SPAWN_MAX);
  }

  private offset(p: Ped): number {
    const e = this.graph.edges[p.edge];
    if (e.cls === FOOTWAY) return p.side * 0.35;
    const base = e.w / 2 + (e.cls === SERVICE ? 0.6 : 0.9);
    return p.side * Math.max(e.w / 2 + 0.25, base + p.lat);
  }

  private target(p: Ped, out: { x: number; z: number }) {
    const e = this.graph.edges[p.edge];
    const n = this.graph.nodes[e.a];
    const off = this.offset(p);
    out.x = n.x + e.dx * p.s + e.dz * off;
    out.z = n.z + e.dz * p.s - e.dx * off;
    return out;
  }

  private spawn(p: Ped, around: THREE.Vector3, minD: number, maxD: number, view?: THREE.Vector3) {
    const g = this.graph;
    const cand = g.edgesNear(around.x, around.z, maxD);
    const t = { x: 0, z: 0 };
    for (let tries = 0; tries < 10 && cand.length; tries++) {
      const id = cand[Math.floor(rand() * cand.length)];
      const e = g.edges[id];
      if (e.len < 4) continue;
      p.edge = id;
      p.s = rand() * e.len;
      p.side = rand() < 0.5 ? 1 : -1;
      p.lat = (rand() - 0.5) * 0.6;
      this.target(p, t);
      const d = Math.hypot(t.x - around.x, t.z - around.z);
      if (d < minD || d > maxD) continue;
      if (view && d < 120 && ((t.x - around.x) * view.x + (t.z - around.z) * view.z) / d > 0.3) continue;
      if (this.collision.pointBlocked(t.x, 0.5, t.z)) continue;
      p.x = t.x; p.z = t.z;
      p.heading = Math.atan2(e.dx, e.dz);
      p.speed = 1.05 + rand() * 0.45;
      p.idleT = rand() < 0.15 ? 3 + rand() * 15 : 0;
      p.fleeT = 0;
      return;
    }
    p.edge = -1;
  }

  /** collision circles for the player and the traffic */
  circles(out: Circle[] = []): Circle[] {
    for (const p of this.peds) if (p.edge >= 0) out.push({ x: p.x, z: p.z, r: R * p.scale });
    return out;
  }

  /**
   * player: where the player (or their tuk-tuk) is; threat: the player's moving tuk-tuk, if any.
   * density: 0..1 share of people out on the streets (fewer at night).
   */
  /**
   * Knock down everyone within radius of (x,z), shoved away from (fromX,fromZ). force is the shove in
   * m/s: a punch is about 3, a tuk-tuk at speed 8 or more. Returns how many were hit.
   */
  hitAt(x: number, z: number, radius: number, fromX: number, fromZ: number, force: number): number {
    let n = 0;
    for (const p of this.peds) {
      if (p.edge < 0 || p.downT > 0) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > (radius + R) * (radius + R)) continue;
      let ax = p.x - fromX, az = p.z - fromZ;
      const d = Math.hypot(ax, az) || 1;
      ax /= d; az /= d;
      p.vx = ax * force; p.vz = az * force;
      p.downT = 3 + Math.min(4, force * 0.4) + rand() * 1.5;
      p.fall = 0;
      p.heading = Math.atan2(-ax, -az); // falls on their back, facing the hit
      p.fleeT = 0; p.idleT = 0; p.amp = 0;
      n++;
    }
    return n;
  }

  update(dt: number, player: THREE.Vector3, playerR: number, view: THREE.Vector3, threat: Threat | null, density = 1, solids: Circle[] = []) {
    const g = this.graph;
    const active = Math.round(COUNT * density);
    const t = { x: 0, z: 0 };

    this.hash.clear();
    this.peds.forEach((p, i) => {
      if (p.edge < 0) return;
      const k = (Math.floor(p.x / 4) + 8000) * 16000 + Math.floor(p.z / 4) + 8000;
      let c = this.hash.get(k);
      if (!c) this.hash.set(k, (c = []));
      c.push(i);
    });

    this.peds.forEach((p, i) => {
      // thin out at night by parking the higher indices
      const wanted = (i * 7919) % COUNT < active;
      if (!wanted) { p.edge = -1; return; }
      if (p.edge < 0 || Math.hypot(p.x - player.x, p.z - player.z) > DESPAWN) {
        this.spawn(p, player, SPAWN_MIN, SPAWN_MAX, view);
        if (p.edge < 0) return;
      }

      // knocked down: slide to a stop, lie there, get up and run from the player
      if (p.downT > 0) {
        const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
        if (!this.collision.pointBlocked(nx, 0.5, nz)) { p.x = nx; p.z = nz; } else { p.vx *= -0.3; p.vz *= -0.3; }
        const f = Math.exp(-5 * dt);
        p.vx *= f; p.vz *= f;
        p.downT -= dt;
        p.fall = p.downT > 0.8 ? Math.min(1, p.fall + dt * 4) : Math.max(0, p.downT / 0.8);
        if (p.downT <= 0) {
          p.fall = 0;
          let ax = p.x - player.x, az = p.z - player.z;
          const d = Math.hypot(ax, az) || 1;
          p.fx = (ax / d) * 4.4; p.fz = (az / d) * 4.4;
          p.fleeT = 2.5;
        }
        return;
      }

      // get out of the way of the player's tuk-tuk
      if (threat && Math.abs(threat.speed) > 1.5) {
        const hx = Math.sin(threat.heading) * Math.sign(threat.speed), hz = Math.cos(threat.heading) * Math.sign(threat.speed);
        const dx = p.x - threat.x, dz = p.z - threat.z;
        const ahead = dx * hx + dz * hz;
        const lat = dx * hz - dz * hx;
        if (ahead > -1 && ahead < 3 + Math.abs(threat.speed) * 0.7 && Math.abs(lat) < 2.2) {
          const sgn = lat >= 0 ? 1 : -1;
          p.fx = hz * sgn * 4.2 + hx * 1.2;
          p.fz = -hx * sgn * 4.2 + hz * 1.2;
          p.fleeT = 0.9;
          p.idleT = 0;
        }
      }

      let moving = 0;
      if (p.fleeT > 0) {
        p.fleeT -= dt;
        const nx = p.x + p.fx * dt, nz = p.z + p.fz * dt;
        if (!this.collision.pointBlocked(nx, 0.5, nz)) { p.x = nx; p.z = nz; }
        p.heading = Math.atan2(p.fx, p.fz);
        moving = 4.2;
      } else if (p.idleT > 0) {
        p.idleT -= dt;
        // stand facing the road
        const e = g.edges[p.edge];
        const face = Math.atan2(-e.dz * p.side, e.dx * p.side);
        let dh = face - p.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, 3 * dt);
      } else {
        // don't walk into the player
        const pdx = player.x - p.x, pdz = player.z - p.z;
        const hx = Math.sin(p.heading), hz = Math.cos(p.heading);
        const ahead = pdx * hx + pdz * hz;
        const blocked = ahead > 0 && ahead < playerR + 0.9 && Math.abs(pdx * hz - pdz * hx) < playerR + 0.35;
        const sp = blocked ? 0 : p.speed;
        p.s += sp * dt;
        moving = sp;
        let guard = 0;
        while (p.s > g.edges[p.edge].len && guard++ < 6) {
          p.s -= g.edges[p.edge].len;
          if (rand() < 0.08) {
            // turn back the way we came, staying on the same pavement
            const back = g.nodes[g.edges[p.edge].b].out.find((id) => g.edges[id].b === g.edges[p.edge].a);
            if (back !== undefined) { p.edge = back; p.side = -p.side; continue; }
          }
          const nxt = g.next(p.edge, rand);
          if (nxt < 0) { p.edge = -1; break; }
          p.edge = nxt;
          if (rand() < 0.1) p.idleT = 3 + rand() * 12;
        }
        if (p.edge < 0) return;
        this.target(p, t);
        // squeeze towards the kerb when a building sits on the pavement
        if (this.collision.pointBlocked(t.x, 0.5, t.z)) p.lat = Math.max(-1.2, p.lat - dt * 3);
        else if (p.lat < 0) p.lat = Math.min(0, p.lat + dt * 0.3);
        const k = 1 - Math.exp(-4 * dt);
        const ox = p.x, oz = p.z;
        p.x += (t.x - p.x) * k;
        p.z += (t.z - p.z) * k;
        const mx = p.x - ox, mz = p.z - oz;
        if (mx * mx + mz * mz > 1e-6) {
          let dh = Math.atan2(mx, mz) - p.heading;
          dh = Math.atan2(Math.sin(dh), Math.cos(dh));
          p.heading += dh * Math.min(1, 6 * dt);
        }
      }

      // personal space: push apart from neighbours and the player
      const cx = Math.floor(p.x / 4), cz = Math.floor(p.z / 4);
      for (let ix = -1; ix <= 1; ix++)
        for (let iz = -1; iz <= 1; iz++) {
          const c = this.hash.get((cx + ix + 8000) * 16000 + cz + iz + 8000);
          if (!c) continue;
          for (const j of c) {
            if (j <= i) continue;
            const o = this.peds[j];
            if (o.edge < 0) continue;
            const dx = o.x - p.x, dz = o.z - p.z, d = Math.hypot(dx, dz), min = 0.62;
            if (d < min && d > 1e-4) {
              const push = (min - d) * 0.5;
              p.x -= (dx / d) * push; p.z -= (dz / d) * push;
              o.x += (dx / d) * push; o.z += (dz / d) * push;
            }
          }
        }
      const dx = p.x - player.x, dz = p.z - player.z, d = Math.hypot(dx, dz), min = playerR + R;
      if (d < min && d > 1e-4) { p.x = player.x + (dx / d) * min; p.z = player.z + (dz / d) * min; }
      // trains and other big things: step out of them
      for (const o of solids) {
        const ox = p.x - o.x, oz = p.z - o.z;
        if (Math.abs(ox) > o.r + R || Math.abs(oz) > o.r + R) continue;
        const od = Math.hypot(ox, oz), om = o.r + R;
        if (od < om && od > 1e-4) { p.x = o.x + (ox / od) * om; p.z = o.z + (oz / od) * om; }
      }

      // walk cycle
      const targetAmp = moving > 0.1 ? Math.min(1.1, 0.35 + moving * 0.22) : 0;
      p.amp += (targetAmp - p.amp) * Math.min(1, 8 * dt);
      p.phase += dt * (moving > 0.1 ? 2.4 + moving * 2.6 : 0);
    });

    // write instances
    for (const p of this.peds) {
      const mesh = this.meshes[p.mesh];
      if (p.edge < 0) {
        this.m4.makeScale(0, 0, 0);
      } else {
        this.q.setFromAxisAngle(this.up, p.heading);
        let y = PAVE_Y;
        if (p.fall > 0) {
          // tip over backwards about the feet, eased
          const e = p.fall * p.fall * (3 - 2 * p.fall);
          this.q.multiply(this.qf.setFromAxisAngle(this.xAxis, -e * (Math.PI / 2 - 0.08)));
          y += e * 0.12;
        }
        this.m4.compose(this.v.set(p.x, y, p.z), this.q, this.sc.setScalar(p.scale));
      }
      mesh.setMatrixAt(p.inst, this.m4);
      this.anim[p.mesh].setXY(p.inst, p.phase, p.amp);
    }
    for (let i = 0; i < this.meshes.length; i++) {
      this.meshes[i].instanceMatrix.needsUpdate = true;
      this.anim[i].needsUpdate = true;
    }
  }
}

/** share of people out on the street by hour (Colombo is busy from early morning to late evening) */
export function streetDensity(hour: number): number {
  if (hour >= 6.5 && hour < 20.5) return 1;
  if (hour >= 5 && hour < 6.5) return 0.3 + (hour - 5) * 0.45;
  if (hour >= 20.5 && hour < 23) return 1 - (hour - 20.5) * 0.3;
  return 0.2;
}
