import * as THREE from 'three';
import type { CityData } from '../types';
import { RoadGraph } from '../traffic/roadGraph';
import type { Circle } from '../traffic/traffic';
import type { Collision } from '../world/collision';
import { personDepthMaterial, personGeometry, personMaterial } from './models';
import { kidLook, looks, soloLook, visitorKid, type Look } from './looks';

interface Ped {
  /** 0 adult, 1 child (which body) */
  mesh: number;
  inst: number;
  /** per-person shader inputs: styles (4), palette A (4), palette B (4), accessory bits (1) */
  attrs: Float32Array;
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
  /** running away along the pavements (seconds left) */
  runT: number;
  /** pose for the shader: upper-body bend about the hips and arm reach (radians) */
  bend: number; reach: number;
  /** width factor (instance x/z scale) and walking speed factor */
  girth: number; speedMul: number;
  /** walking with others: group id (-1 alone), the leader's index (-1 if this is the leader or alone),
   * place relative to the leader (m, leader's left and forward), and whether they've split up */
  gid: number; leader: number; ox: number; oz: number; detached: boolean;
  followers: number[];
  /** taxi fare: 0 no, 1 waiting at the kerb waving, 2 riding in the player's tuk-tuk (not drawn) */
  fare: number;
  /** while riding: height of the instance root so the hips rest on the tuk-tuk's bench */
  sy: number;
}

export interface Threat { x: number; z: number; heading: number; speed: number }

// adults and children are two instanced meshes (two draw calls for everyone)
const ADULTS = 150, KIDS = 40, COUNT = ADULTS + KIDS;
/** people closer than this (m) get the detailed body and cast shadows */
const NEAR_DETAIL = 40;

interface Layer {
  mesh: THREE.InstancedMesh;
  opt: THREE.InstancedBufferAttribute; colA: THREE.InstancedBufferAttribute; colB: THREE.InstancedBufferAttribute;
  acc: THREE.InstancedBufferAttribute; anim: THREE.InstancedBufferAttribute;
  /** which person is in each slot (attributes are only copied when that changes) */
  occ: Int32Array;
  n: number; dirty: boolean;
}
const SPAWN_MIN = 25, SPAWN_MAX = 170, DESPAWN = 210;
const PAVE_Y = 0.04;
/** hip height of the body model (models.ts HIP_Y), for seating */
const SEAT_HIP = 0.9;
const R = 0.3;
const WALK_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'footway'];
const FOOTWAY = 7;
const SERVICE = 6;

let seed = 11;
const rand = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

/** People walking the pavements, idling, crossing side streets and jumping out of the way of the player's tuk-tuk. */
export class Pedestrians {
  group = new THREE.Group();
  peds: Ped[] = [];
  graph: RoadGraph;
  /** per body (adult, child): a detailed layer for people near the player and a simple one, without
   * shadows, for everyone further away. People who are out are packed into them every frame. */
  private layers: Layer[][] = [];
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
    // ---- who is out: families, tourist couples, groups of friends, school children, older couples,
    // office workers walking together, and everyone else on their own
    interface Member { look: Look; kid: boolean; ox: number; oz: number }
    const groups: Member[][] = [];
    let adults = ADULTS, kids = KIDS;
    const side = () => (rand() < 0.5 ? 1 : -1);
    const take = (m: Member[]) => { groups.push(m); for (const x of m) { if (x.kid) kids--; else adults--; } };
    for (let f = 0; f < 11 && kids >= 1 && adults >= 2; f++) {
      const visitors = rand() < 0.25, sx = side();
      const mum = visitors ? looks.tourist(rand, true) : (rand() < 0.5 ? looks.sareeLady(rand) : looks.dressLady(rand));
      const dad = visitors ? looks.tourist(rand, false) : (rand() < 0.5 ? looks.casualMan(rand) : looks.officeMan(rand));
      const m: Member[] = [{ look: dad, kid: false, ox: 0, oz: 0 }, { look: mum, kid: false, ox: 0.7 * sx, oz: 0 }];
      const n = Math.min(kids, rand() < 0.45 ? 2 : 1);
      for (let k = 0; k < n; k++) {
        const fem = rand() < 0.5;
        m.push({ look: visitors ? visitorKid(rand, fem) : kidLook(rand, false, fem), kid: true, ox: (k === 0 ? 0.35 : -0.35) * sx, oz: 0.85 });
      }
      take(m);
    }
    while (kids >= 2) {
      const n = Math.min(kids, rand() < 0.5 ? 3 : 2), m: Member[] = [];
      for (let k = 0; k < n; k++) m.push({ look: kidLook(rand, true, rand() < 0.5), kid: true, ox: [0, 0.6, -0.6][k], oz: 0 });
      take(m);
    }
    if (kids === 1 && groups.length) { groups[0].push({ look: kidLook(rand, false, rand() < 0.5), kid: true, ox: 0, oz: 1.1 }); kids--; }
    const pair = (a: Look, b: Look) => take([{ look: a, kid: false, ox: 0, oz: 0 }, { look: b, kid: false, ox: 0.65 * side(), oz: 0 }]);
    for (let k = 0; k < 7; k++) pair(looks.tourist(rand, rand() < 0.5), looks.tourist(rand, rand() < 0.5));
    for (let k = 0; k < 6; k++) {
      const n = rand() < 0.5 ? 3 : 2, m: Member[] = [];
      for (let j = 0; j < n; j++) m.push({ look: looks.genz(rand, rand() < 0.5), kid: false, ox: [0, 0.62, -0.62][j], oz: 0 });
      take(m);
    }
    for (let k = 0; k < 2; k++) pair(looks.elder(rand, false), looks.elder(rand, true));
    for (let k = 0; k < 3; k++) pair(rand() < 0.5 ? looks.officeMan(rand) : looks.officeWoman(rand), rand() < 0.5 ? looks.officeMan(rand) : looks.officeWoman(rand));
    while (adults > 0) take([{ look: soloLook(rand), kid: false, ox: 0, oz: 0 }]);

    // ---- palette of every colour used, in a float texture the shader indexes
    const palette: number[] = [], palIndex = new Map<number, number>();
    const ci = (hex: number) => {
      let i = palIndex.get(hex);
      if (i === undefined) { i = palette.length; palIndex.set(hex, i); palette.push(hex); }
      return i;
    };
    const perMesh: { look: Look; ped: Ped }[][] = [[], []];
    groups.forEach((g, gi) => {
      const solo = g.length === 1;
      const leaderIdx = this.peds.length;
      const slow = Math.min(...g.map((m) => m.look.speed));
      g.forEach((m, j) => {
        const mesh = m.kid ? 1 : 0;
        const ped: Ped = { mesh, inst: perMesh[mesh].length, attrs: new Float32Array(13), edge: -1, s: 0, side: 1, lat: 0, speed: 0, x: 0, z: 0, heading: 0,
          phase: rand() * 6.28, amp: 0, idleT: 0, fleeT: 0, fx: 0, fz: 0, downT: 0, fall: 0, vx: 0, vz: 0, runT: 0, bend: 0, reach: 0, fare: 0, sy: 0,
          scale: m.look.height / 1.73, girth: m.look.girth, speedMul: j === 0 ? slow : m.look.speed,
          gid: solo ? -1 : gi, leader: j === 0 ? -1 : leaderIdx, ox: m.ox, oz: m.oz, detached: false, followers: [] };
        if (j > 0) this.peds[leaderIdx].followers.push(this.peds.length);
        this.peds.push(ped);
        perMesh[mesh].push({ look: m.look, ped });
      });
    });
    for (const list of perMesh) for (const { look } of list) for (const c of [look.skin, look.topC, look.lowerC, look.hairC, look.accent, look.shoe]) ci(c);
    const palData = new Float32Array(256 * 4), col = new THREE.Color();
    palette.slice(0, 256).forEach((hex, i) => { col.setHex(hex); palData.set([col.r, col.g, col.b, 1], i * 4); });
    const palTex = new THREE.DataTexture(palData, 256, 1, THREE.RGBAFormat, THREE.FloatType);
    palTex.needsUpdate = true;

    const mat = personMaterial(palTex);
    const depth = personDepthMaterial();
    perMesh.forEach((list, mi) => {
      const n = list.length;
      for (const { look: l, ped } of list) {
        ped.attrs = new Float32Array([l.lower, l.top, l.hair, l.head, ci(l.skin), ci(l.topC), ci(l.lowerC), ci(l.hairC), ci(l.accent), ci(l.shoe), l.fem, l.stoop, l.acc]);
      }
      const layers: Layer[] = [];
      for (const low of [false, true]) {
        const geo = personGeometry(mi === 1, low);
        const dyn = (size: number) => {
          const a = new THREE.InstancedBufferAttribute(new Float32Array(n * size), size);
          a.setUsage(THREE.DynamicDrawUsage);
          return a;
        };
        const L: Layer = { mesh: null!, opt: dyn(4), colA: dyn(4), colB: dyn(4), acc: dyn(1), anim: dyn(4), occ: new Int32Array(n).fill(-1), n: 0, dirty: false };
        geo.setAttribute('aOpt', L.opt);
        geo.setAttribute('aColA', L.colA);
        geo.setAttribute('aColB', L.colB);
        geo.setAttribute('aAcc', L.acc);
        geo.setAttribute('aAnim', L.anim);
        const mesh = new THREE.InstancedMesh(geo, mat, n);
        mesh.customDepthMaterial = depth;
        mesh.castShadow = !low; // far away, a person's shadow is a few pixels
        mesh.receiveShadow = true;
        mesh.frustumCulled = false;
        mesh.count = 0;
        L.mesh = mesh;
        layers.push(L);
        this.group.add(mesh);
      }
      this.layers.push(layers);
    });
    for (const p of this.peds) if (p.leader < 0) this.spawn(p, start, 4, SPAWN_MAX);
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
      p.speed = (1.05 + rand() * 0.35) * p.speedMul;
      p.idleT = rand() < 0.15 ? 3 + rand() * 15 : 0;
      p.fleeT = 0;
      this.gather(p, around);
      return;
    }
    p.edge = -1;
  }

  /** put a leader's companions in place beside them (those not already off on their own nearby) */
  private gather(L: Ped, player: THREE.Vector3) {
    const t = { x: 0, z: 0 };
    for (const fi of L.followers) {
      const f = this.peds[fi];
      if (f.detached && f.edge >= 0 && Math.hypot(f.x - player.x, f.z - player.z) < 60) continue;
      this.slot(f, L, t);
      f.x = t.x; f.z = t.z; f.heading = L.heading; f.edge = L.edge; f.side = L.side;
      f.detached = false; f.downT = 0; f.fall = 0; f.runT = 0; f.fleeT = 0; f.idleT = 0; f.bend = 0; f.reach = 0;
    }
  }

  /** where a companion walks: beside or a little ahead of the leader, turned with them */
  private slot(f: Ped, L: Ped, out: { x: number; z: number }) {
    const c = Math.cos(L.heading), sn = Math.sin(L.heading);
    out.x = L.x + c * f.ox + sn * f.oz;
    out.z = L.z - sn * f.ox + c * f.oz;
    if (this.collision.pointBlocked(out.x, 0.5, out.z)) {
      // no room beside them (a wall, a pillar): fall in behind
      out.x = L.x - sn * (0.8 + Math.abs(f.ox) * 0.5);
      out.z = L.z - c * (0.8 + Math.abs(f.ox) * 0.5);
    }
    return out;
  }

  /** move a companion towards their place in the group; returns their speed, for the walk cycle */
  private follow(f: Ped, L: Ped, dt: number) {
    const t = this.slot(f, L, { x: 0, z: 0 });
    f.edge = L.edge; f.side = L.side; f.s = L.s;
    const ox = f.x, oz = f.z;
    const d = Math.hypot(t.x - f.x, t.z - f.z);
    if (d > 8) { f.x = t.x; f.z = t.z; }
    else {
      const k = 1 - Math.exp(-5 * dt);
      f.x += (t.x - f.x) * k; f.z += (t.z - f.z) * k;
    }
    const mx = f.x - ox, mz = f.z - oz, v = Math.hypot(mx, mz) / Math.max(dt, 1e-3);
    let want = v > 0.3 ? Math.atan2(mx, mz) : L.heading;
    let dh = want - f.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    f.heading += dh * Math.min(1, 6 * dt);
    return v > 0.25 ? Math.min(v, 2.5) : 0;
  }

  /**
   * Put someone at (x,z), e.g. a driver the player pulled out of their vehicle, running away from
   * (fromX,fromZ). Reuses the person furthest from there. They join the nearest pavement afterwards.
   */
  dropAt(x: number, z: number, fromX: number, fromZ: number) {
    let best: Ped | null = null, bd = -1;
    for (const p of this.peds) {
      if (p.edge < 0 || p.downT > 0 || p.gid >= 0) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d > bd) { bd = d; best = p; }
    }
    if (!best) return;
    const p = best;
    p.x = x; p.z = z;
    p.heading = Math.atan2(x - fromX, z - fromZ);
    p.fleeT = 0; p.idleT = 0; p.downT = 0; p.fall = 0; p.bend = 0; p.reach = 0;
    if (!this.reattach(p, fromX, fromZ)) { p.edge = -1; return; }
    p.runT = 7;
  }

  /**
   * Join the nearest pavement from wherever the person is now, heading away from (fromX,fromZ).
   * Used after being knocked down, dodging or fleeing, so they carry on from where they are
   * instead of being pulled back to the spot on the pavement they had before.
   */
  private reattach(p: Ped, fromX: number, fromZ: number): boolean {
    const g = this.graph;
    let edge = -1, es = 0, ed = 1e9;
    for (const id of g.edgesNear(p.x, p.z, 45)) {
      const e = g.edges[id], n = g.nodes[e.a];
      const s = THREE.MathUtils.clamp((p.x - n.x) * e.dx + (p.z - n.z) * e.dz, 0, e.len);
      const d = Math.hypot(n.x + e.dx * s - p.x, n.z + e.dz * s - p.z);
      if (d < ed - 0.01) { ed = d; edge = id; es = s; }
    }
    if (edge < 0) return false;
    let e = g.edges[edge];
    // face away from the threat: take the same street the other way if this one leads towards it
    if (e.dx * (p.x - fromX) + e.dz * (p.z - fromZ) < 0) {
      const back = g.nodes[e.b].out.find((id) => g.edges[id].b === e.a);
      if (back !== undefined) { edge = back; es = g.edges[back].len - es; e = g.edges[back]; }
    }
    const n = g.nodes[e.a];
    p.edge = edge; p.s = es; p.lat = 0;
    p.side = ((p.x - n.x) * e.dz - (p.z - n.z) * e.dx) >= 0 ? 1 : -1;
    return true;
  }

  // ---------------------------------------------------------------- taxi fares

  /**
   * Pick someone walking on their own 50-170 m from (x, z), preferably ahead along `heading`, on a
   * pavement beside a real road, to stand at the kerb and wave down the player's tuk-tuk.
   * Returns their index, or -1 if nobody suitable is around.
   */
  hail(x: number, z: number, heading: number): number {
    const hx = Math.sin(heading), hz = Math.cos(heading);
    let best = -1, bestScore = -Infinity;
    this.peds.forEach((p, i) => {
      if (p.edge < 0 || p.mesh !== 0 || p.gid >= 0 || p.downT > 0 || p.runT > 0 || p.fleeT > 0 || p.fare) return;
      const cls = this.graph.edges[p.edge].cls;
      if (cls === FOOTWAY || cls === SERVICE) return;
      const dx = p.x - x, dz = p.z - z, d = Math.hypot(dx, dz);
      if (d < 50 || d > 170) return;
      const score = (dx * hx + dz * hz) / d + rand() * 0.6;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best >= 0) {
      const p = this.peds[best];
      p.fare = 1; p.idleT = 0; p.amp = 0;
    }
    return best;
  }

  /** where a fare is, and whether they're still waiting (false once knocked down or gone) */
  fareAt(i: number) {
    const p = this.peds[i];
    return { x: p.x, z: p.z, waiting: p.fare === 1 && p.edge >= 0 && p.downT <= 0 };
  }

  /** the fare gets in: off the pavement, sitting in the tuk-tuk (placed by seatFare each frame) */
  boardFare(i: number) {
    const p = this.peds[i];
    p.fare = 2; p.edge = -1; p.amp = 0; p.bend = 0;
    p.reach = 20; // the shader's seated pose
  }

  /** put a riding fare's hips on a seat whose top is at (x, seatY, z), facing `heading`; tall people
   * sink into the cushion a little so their head stays under `ceiling` */
  seatFare(i: number, x: number, seatY: number, z: number, heading: number, ceiling = Infinity) {
    const p = this.peds[i];
    if (p.fare !== 2) return;
    p.x = x; p.z = z; p.heading = heading;
    // seated, the top of the head is about 0.86 above the hips (body model units)
    p.sy = Math.min(seatY + 0.04 - SEAT_HIP * p.scale, ceiling - (SEAT_HIP + 0.86) * p.scale);
  }

  /** the fare gets out at (x, z) and walks off, away from the tuk-tuk at (fromX, fromZ) */
  dropFare(i: number, x: number, z: number, fromX: number, fromZ: number) {
    const p = this.peds[i];
    p.fare = 0; p.reach = 0;
    p.x = x; p.z = z;
    p.heading = Math.atan2(x - fromX, z - fromZ);
    p.fleeT = 0; p.idleT = 0; p.downT = 0; p.runT = 0;
    if (!this.reattach(p, fromX, fromZ)) p.edge = -1;
  }

  /** the fare is called off (the player gave up): they carry on walking */
  releaseFare(i: number) {
    const p = this.peds[i];
    if (p.fare === 2) { p.fare = 0; p.edge = -1; return; }
    p.fare = 0; p.reach = 0;
  }

  /** standing at the kerb facing the road, waving */
  private waitForRide(p: Ped, dt: number) {
    const e = this.graph.edges[p.edge];
    const face = Math.atan2(-e.dz * p.side, e.dx * p.side);
    let dh = face - p.heading;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    p.heading += dh * Math.min(1, 4 * dt);
    p.amp = Math.max(0, p.amp - dt * 4);
    p.phase += dt;
    // the shader waves at 6 rad/s; wrap so the float stays small
    p.reach = 10 + ((p.phase * 6) % (Math.PI * 2)) / 6;
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
      if (p.leader >= 0) p.detached = true;
      // whoever they were with scatters too
      if (p.gid >= 0) {
        for (const q of this.peds) {
          if (q === p || q.gid !== p.gid || q.edge < 0 || q.downT > 0) continue;
          if (q.leader >= 0) q.detached = true;
          if (this.reattach(q, fromX, fromZ)) { q.runT = 5 + rand() * 3; q.idleT = 0; }
        }
      }
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
      // (companions go with their leader)
      if (p.fare === 2) return; // in the player's tuk-tuk
      if (p.fare === 1 && p.downT <= 0 && p.edge >= 0) { this.waitForRide(p, dt); return; }
      if (p.fare === 1) p.fare = 0; // knocked down or gone: the fare is off
      const wanted = ((p.leader >= 0 ? p.leader : i) * 7919) % COUNT < active;
      if (!wanted) { p.edge = -1; return; }
      let moving = 0;
      if (p.leader >= 0 && !p.detached) {
        // walking with someone: keep to their side
        const L = this.peds[p.leader];
        if (L.edge < 0) { p.edge = -1; return; }
        moving = this.follow(p, L, dt);
      } else {
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
        // lie there, sit up (hands to knees), then rise onto the feet with the body kept upright and
        // leaning forward to push off, instead of swinging up stiff from the heels
        const A = Math.PI / 2 - 0.08, SIT = 1.7, RISE = 0.85;
        const sm = (x: number) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
        if (p.downT > SIT) {
          p.fall = Math.min(1, p.fall + dt * 4);
          p.bend = 0;
          p.reach = 0.5 * p.fall;
        } else if (p.downT > RISE) {
          const k = sm((SIT - p.downT) / (SIT - RISE));
          p.fall = 1;
          p.bend = k * (A + 0.35);
          p.reach = 0.5 + 0.7 * k;
        } else {
          const k = sm(1 - p.downT / RISE);
          p.fall = 1 - k;
          const e = p.fall * p.fall * (3 - 2 * p.fall);
          p.bend = e * A + 0.35 * (1 - k) + 0.25 * Math.sin(Math.PI * k);
          p.reach = 1.2 * (1 - k);
        }
        if (p.downT <= 0) {
          p.fall = 0; p.bend = 0; p.reach = 0;
          // run off along the pavements, away from the player
          if (this.reattach(p, player.x, player.z)) p.runT = 6 + rand() * 3;
          else {
            const ax = p.x - player.x, az = p.z - player.z, d = Math.hypot(ax, az) || 1;
            p.fx = (ax / d) * 4.2; p.fz = (az / d) * 4.2; p.fleeT = 2;
          }
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

      if (p.fleeT > 0) {
        p.fleeT -= dt;
        const nx = p.x + p.fx * dt, nz = p.z + p.fz * dt;
        if (!this.collision.pointBlocked(nx, 0.5, nz)) { p.x = nx; p.z = nz; }
        let dh = Math.atan2(p.fx, p.fz) - p.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        p.heading += dh * Math.min(1, 10 * dt);
        moving = 4.2;
        // carry on from here when done, rather than being pulled back to the old spot
        if (p.fleeT <= 0) this.reattach(p, p.x - p.fx, p.z - p.fz);
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
        const running = p.runT > 0;
        if (running) p.runT -= dt;
        const sp = blocked && !running ? 0 : running ? 4.0 * Math.min(1, 0.4 + p.runT) : p.speed;
        p.s += sp * dt;
        moving = sp;
        let guard = 0;
        while (p.s > g.edges[p.edge].len && guard++ < 6) {
          p.s -= g.edges[p.edge].len;
          if (running) {
            // at a junction, take whichever way leads furthest from the player
            let bestE = -1, bestD = -1;
            for (let k = 0; k < 3; k++) {
              const c = g.next(p.edge, rand);
              if (c < 0) continue;
              const nb = g.nodes[g.edges[c].b], dd = Math.hypot(nb.x - player.x, nb.z - player.z);
              if (dd > bestD) { bestD = dd; bestE = c; }
            }
            if (bestE < 0) { p.edge = -1; break; }
            p.edge = bestE;
            continue;
          }
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

    // write instances: everyone who is out goes into the near or far layer of their body
    for (const ls of this.layers) for (const L of ls) { L.n = 0; L.dirty = false; }
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      if (p.edge < 0 && p.fare !== 2) continue;
      {
        this.q.setFromAxisAngle(this.up, p.heading);
        let y = p.fare === 2 ? p.sy : PAVE_Y;
        if (p.fall > 0) {
          // tip over backwards about the feet, eased
          const e = p.fall * p.fall * (3 - 2 * p.fall);
          this.q.multiply(this.qf.setFromAxisAngle(this.xAxis, -e * (Math.PI / 2 - 0.08)));
          y += e * 0.12;
        }
        this.m4.compose(this.v.set(p.x, y, p.z), this.q, this.sc.set(p.scale * p.girth, p.scale, p.scale * p.girth));
      }
      const near = Math.hypot(p.x - player.x, p.z - player.z) < NEAR_DETAIL;
      const L = this.layers[p.mesh][near ? 0 : 1];
      const k = L.n++;
      if (L.occ[k] !== i) {
        L.occ[k] = i;
        const a = p.attrs;
        (L.opt.array as Float32Array).set(a.subarray(0, 4), k * 4);
        (L.colA.array as Float32Array).set(a.subarray(4, 8), k * 4);
        (L.colB.array as Float32Array).set(a.subarray(8, 12), k * 4);
        (L.acc.array as Float32Array)[k] = a[12];
        L.dirty = true;
      }
      L.mesh.setMatrixAt(k, this.m4);
      L.anim.setXYZW(k, p.phase, p.amp, p.bend, p.reach);
    }
    for (const ls of this.layers) for (const L of ls) {
      L.mesh.count = L.n;
      L.mesh.instanceMatrix.needsUpdate = true;
      L.anim.needsUpdate = true;
      if (L.dirty) { L.opt.needsUpdate = true; L.colA.needsUpdate = true; L.colB.needsUpdate = true; L.acc.needsUpdate = true; }
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
