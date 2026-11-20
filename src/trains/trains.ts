import * as THREE from 'three';
import type { CityData } from '../types';
import type { Circle } from '../traffic/traffic';
import { TRAIN_CAR_LEN, TRAIN_CAR_W, TRAIN_DOORS, trainCar, vehicleMaterial } from '../traffic/models';

const CARS = 4;
const GAP = 0.7;
const TRAIN_LEN = CARS * TRAIN_CAR_LEN + (CARS - 1) * GAP;
const CRUISE = 13; // ~47 km/h through the city
const ACC = 0.5;
const DEC = 0.75;
const DWELL = 25;
const TERMINUS_DWELL = 45;
const OFF_MAP = 50; // seconds a train spends "beyond the map" before coming back
const RAIL_Y = 0.2;

/** A polyline with arc-length lookup; extrapolates past both ends so trains can slide off the map. */
class RailPath {
  x: number[] = []; z: number[] = []; cum: number[] = [0];
  len = 0;
  constructor(p: number[]) {
    for (let i = 0; i < p.length; i += 2) { this.x.push(p[i]); this.z.push(p[i + 1]); }
    for (let i = 1; i < this.x.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]));
    this.len = this.cum[this.cum.length - 1];
  }
  at(s: number, out: { x: number; z: number }) {
    const n = this.x.length;
    let i: number;
    if (s <= 0) i = 1;
    else if (s >= this.len) i = n - 1;
    else { let lo = 1, hi = n - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (this.cum[m] < s) lo = m + 1; else hi = m; } i = lo; }
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const t = (s - this.cum[i - 1]) / seg;
    out.x = this.x[i - 1] + (this.x[i] - this.x[i - 1]) * t;
    out.z = this.z[i - 1] + (this.z[i] - this.z[i - 1]) * t;
    return out;
  }
  /** arc length of the closest point to (x, z) and the distance to it */
  project(x: number, z: number) {
    let best = { s: 0, d: Infinity };
    for (let i = 1; i < this.x.length; i++) {
      const ax = this.x[i - 1], az = this.z[i - 1], dx = this.x[i] - ax, dz = this.z[i] - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best.d) best = { s: this.cum[i - 1] + Math.sqrt(l2) * t, d };
    }
    return best;
  }
}

interface Stop { s: number; name: string; terminus?: boolean }
type State = 'dwell' | 'run' | 'away';

export interface Door { train: Train; car: number; z: number; side: 1 | -1 }

export class Train {
  cars: THREE.Mesh[] = [];
  route = 0;
  s = 0; // arc length of the front of the train
  speed = 0;
  state: State = 'dwell';
  timer = 0;
  next = 0; // index of the next stop
  stopName = '';
  hornT = 0;
  /** per car: centre and heading, refreshed each frame */
  pose: { x: number; z: number; h: number }[] = [];
  visible = false;
  constructor() {
    for (let i = 0; i < CARS; i++) this.pose.push({ x: 0, z: 0, h: 0 });
  }
}

/** Coastal line trains between Maradana and the south edge of the map, stopping at each station. */
export class Trains {
  group = new THREE.Group();
  trains: Train[] = [];
  paths: RailPath[] = [];
  stops: Stop[][] = [];
  /** set by main: whether the player is aboard (trains then wait at the map edge instead of leaving) */
  riding: Train | null = null;
  onHorn: (x: number, z: number, long: boolean) => void = () => {};
  private a = { x: 0, z: 0 };
  private b = { x: 0, z: 0 };

  constructor(city: CityData) {
    this.group.name = 'trains';
    const routes = city.trains?.routes ?? [];
    if (routes.length < 2) return;
    this.paths = routes.map((r) => new RailPath(r));
    this.stops = this.paths.map((p, ri) => {
      const out: Stop[] = [];
      for (const st of city.trains!.stations) {
        const pr = p.project(st.x, st.z);
        if (pr.d > 60) continue;
        if (/maradana/i.test(st.n)) {
          if (ri === 1) out.push({ s: p.len - 3, name: st.n, terminus: true });
          continue;
        }
        // stop with the middle of the train at the station
        out.push({ s: Math.min(p.len - 3, pr.s + TRAIN_LEN / 2), name: st.n });
      }
      return out.sort((x, y) => x.s - y.s);
    });

    const cab = trainCar(true), mid = trainCar(false);
    const mat = vehicleMaterial();
    for (let k = 0; k < 2; k++) {
      const t = new Train();
      for (let i = 0; i < CARS; i++) {
        const m = new THREE.Mesh(i === 0 || i === CARS - 1 ? cab : mid, mat);
        m.castShadow = true;
        m.receiveShadow = true;
        m.visible = false;
        t.cars.push(m);
        this.group.add(m);
      }
      this.trains.push(t);
    }
    // one train waiting at Maradana, the other already coming up from the south
    this.depart(this.trains[0], 0, 8);
    this.depart(this.trains[1], 1, 0);
    this.trains[1].s = this.paths[1].len * 0.35;
    this.trains[1].next = this.stops[1].findIndex((st) => st.s > this.trains[1].s);
    this.trains[1].state = 'run';
    this.trains[1].speed = CRUISE;
  }

  private depart(t: Train, route: number, wait: number) {
    t.route = route;
    t.s = route === 0 ? TRAIN_LEN + 2 : 0; // southbound starts in the Maradana platform, northbound at the map edge
    t.speed = 0;
    t.next = 0;
    t.state = wait > 0 ? 'dwell' : 'run';
    t.timer = wait;
    t.stopName = route === 0 ? 'Maradana' : '';
  }

  /** car centres and headings */
  private pose(t: Train) {
    const p = this.paths[t.route];
    for (let i = 0; i < CARS; i++) {
      const front = t.s - i * (TRAIN_CAR_LEN + GAP);
      p.at(front, this.a);
      p.at(front - TRAIN_CAR_LEN, this.b);
      const pose = t.pose[i];
      pose.x = (this.a.x + this.b.x) / 2;
      pose.z = (this.a.z + this.b.z) / 2;
      pose.h = Math.atan2(this.a.x - this.b.x, this.a.z - this.b.z);
    }
  }

  /** collision circles for everything visible */
  circles(out: Circle[] = []): Circle[] {
    const r = TRAIN_CAR_W / 2;
    for (const t of this.trains) {
      if (!t.visible) continue;
      for (const c of t.pose) {
        const hx = Math.sin(c.h), hz = Math.cos(c.h);
        for (let k = -3.5; k <= 3.5; k++) out.push({ x: c.x + hx * k * 2.45, z: c.z + hz * k * 2.45, r });
      }
    }
    return out;
  }

  /** world position (feet) of a door, standing in the doorway */
  doorPos(d: Door, out = new THREE.Vector3(), inset = 1.15) {
    const c = d.train.pose[d.car];
    const hx = Math.sin(c.h), hz = Math.cos(c.h);
    return out.set(c.x + hx * d.z + hz * inset * d.side, 1.05 + RAIL_Y, c.z + hz * d.z - hx * inset * d.side);
  }

  /** nearest doorway of a stopped train within `radius` of (x, z) */
  nearDoor(x: number, z: number, radius = 3): Door | null {
    let best: Door | null = null, bd = radius;
    const v = new THREE.Vector3();
    for (const t of this.trains) {
      if (!t.visible || Math.abs(t.speed) > 0.3) continue;
      for (let car = 0; car < CARS; car++)
        for (const dz of TRAIN_DOORS)
          for (const side of [1, -1] as const) {
            const d = { train: t, car, z: dz, side };
            this.doorPos(d, v, TRAIN_CAR_W / 2 + 0.6);
            const dist = Math.hypot(v.x - x, v.z - z);
            if (dist < bd) { bd = dist; best = d; }
          }
    }
    return best;
  }

  /** obstacles: things the train must not run into (player, cars). Train stops and sounds the horn. */
  update(dt: number, obstacles: Circle[]) {
    for (const t of this.trains) {
      if (!this.paths.length) break;
      const p = this.paths[t.route];
      const stops = this.stops[t.route];
      t.hornT -= dt;

      if (t.state === 'away') {
        t.timer -= dt;
        if (t.timer <= 0) this.depart(t, t.route === 0 ? 1 : 0, t.route === 0 ? 0 : 20);
      } else if (t.state === 'dwell') {
        t.speed = 0;
        t.timer -= dt;
        if (t.timer <= 0) {
          const term = stops[t.next - 1]?.terminus;
          if (term) {
            if (this.riding === t) { t.timer = 2; } // wait for the rider to get off at Maradana
            else this.depart(t, 0, 2);
          } else {
            t.state = 'run';
            t.stopName = '';
            this.hornAt(t, false);
          }
        }
      } else {
        let want = CRUISE;
        const stop = stops[t.next];
        // a rider keeps the train at the map edge rather than vanishing with it
        const endS = this.riding === t && t.route === 0 ? p.len - 2 : Infinity;
        const target = Math.min(stop ? stop.s : Infinity, endS);
        if (target < Infinity) want = Math.min(want, Math.sqrt(2 * DEC * Math.max(0, target - t.s)));

        // anything on the track ahead?
        const look = (t.speed * t.speed) / (2 * DEC) + 25;
        let blocked = Infinity;
        for (let k = 0; k <= look; k += 4) {
          p.at(t.s + k, this.a);
          for (const o of obstacles) {
            if (Math.abs(o.x - this.a.x) > 4 || Math.abs(o.z - this.a.z) > 4) continue;
            if (Math.hypot(o.x - this.a.x, o.z - this.a.z) < TRAIN_CAR_W / 2 + o.r + 0.2) { blocked = k; break; }
          }
          if (blocked < Infinity) break;
        }
        if (blocked < Infinity) {
          want = Math.min(want, Math.sqrt(2 * DEC * Math.max(0, blocked - 6)));
          if (t.hornT <= 0) this.hornAt(t, true);
        }

        const acc = want > t.speed ? ACC : DEC * 1.6;
        t.speed += Math.sign(want - t.speed) * Math.min(Math.abs(want - t.speed), acc * dt);
        t.s += t.speed * dt;

        if (stop && t.s >= stop.s - 0.6 && t.speed < 0.4) {
          t.speed = 0;
          t.state = 'dwell';
          t.timer = stop.terminus ? TERMINUS_DWELL : DWELL;
          t.stopName = stop.name;
          t.next++;
        } else if (endS < Infinity && t.s >= endS - 0.6 && t.speed < 0.4) {
          t.speed = 0;
          t.stopName = 'End of the map';
        }
        // off the south end of the map: gone for a while
        if (t.route === 0 && t.s - TRAIN_LEN > p.len + 5) { t.state = 'away'; t.timer = OFF_MAP; }
      }

      t.visible = t.state !== 'away';
      if (t.visible) this.pose(t);
      for (let i = 0; i < CARS; i++) {
        const m = t.cars[i], c = t.pose[i];
        m.visible = t.visible;
        if (!t.visible) continue;
        m.position.set(c.x, RAIL_Y, c.z);
        // the last car is a cab facing backwards
        m.rotation.set(0, c.h + (i === CARS - 1 ? Math.PI : 0), 0);
      }
    }
  }

  private hornAt(t: Train, long: boolean) {
    t.hornT = 4;
    const c = t.pose[0];
    this.onHorn(c.x, c.z, long);
  }

  /** for the HUD while riding */
  nextStopName(t: Train): string {
    return this.stops[t.route][t.next]?.name ?? (t.route === 0 ? 'End of the map' : 'Maradana');
  }
}
