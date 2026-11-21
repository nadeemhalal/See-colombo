import * as THREE from 'three';
import type { Input } from './input';
import type { Collision } from '../world/collision';
import { isLand, type LandMask } from '../world/landmask';
import { VEHICLE_TYPES, vehicleMaterial, type VehicleType } from '../traffic/models';
import type { Circle } from '../traffic/traffic';

const ROAD_Y = 0.07;

/** How each kind of vehicle drives, and where the player sits on it. */
interface Handling {
  wheelbase: number;
  maxFwd: number; // m/s
  maxRev: number;
  accel: number;
  brake: number;
  /** collision circles: centres from -half to +half along the heading, radius r */
  half: number;
  r: number;
  /** character root in vehicle space when seated (x right-hand drive is negative) */
  seat: [number, number, number];
  /** stand instead of sit (e-scooter) */
  stand?: boolean;
  /** engine noise (not on a bicycle) */
  engine: boolean;
  /** leans into corners like a two-wheeler instead of rolling out */
  leans?: boolean;
}

const HANDLING: Record<string, Handling> = {
  tuktuk: { wheelbase: 1.8, maxFwd: 16, maxRev: 3.5, accel: 3.6, brake: 9, half: 0.75, r: 0.66, seat: [0, -0.06, 0.3], engine: true },
  car: { wheelbase: 2.6, maxFwd: 30, maxRev: 6, accel: 4.8, brake: 11, half: 1.3, r: 0.9, seat: [-0.38, -0.42, 0.05], engine: true },
  hatch: { wheelbase: 2.35, maxFwd: 27, maxRev: 6, accel: 4.6, brake: 11, half: 1.05, r: 0.78, seat: [-0.32, -0.36, 0.0], engine: true },
  suv: { wheelbase: 2.85, maxFwd: 30, maxRev: 6, accel: 4.4, brake: 10.5, half: 1.5, r: 0.96, seat: [-0.4, -0.18, 0.1], engine: true },
  metrobus: { wheelbase: 6.1, maxFwd: 20, maxRev: 3, accel: 2.0, brake: 7, half: 4.8, r: 1.28, seat: [-0.8, 0.05, 5.1], engine: true },
  van: { wheelbase: 2.9, maxFwd: 26, maxRev: 5, accel: 3.6, brake: 10, half: 1.45, r: 0.9, seat: [-0.42, -0.12, 1.25], engine: true },
  bus: { wheelbase: 6.2, maxFwd: 20, maxRev: 3, accel: 1.9, brake: 7, half: 4.25, r: 1.26, seat: [-0.75, 0.42, 4.55], engine: true },
  moto: { wheelbase: 1.3, maxFwd: 26, maxRev: 1.5, accel: 6.5, brake: 10, half: 0.55, r: 0.42, seat: [0, -0.04, -0.12], engine: true, leans: true },
  bicycle: { wheelbase: 1.05, maxFwd: 8.5, maxRev: 1, accel: 2.6, brake: 6, half: 0.45, r: 0.36, seat: [0, 0.0, -0.22], engine: false, leans: true },
  escooter: { wheelbase: 0.84, maxFwd: 7, maxRev: 1, accel: 2.8, brake: 6, half: 0.36, r: 0.34, seat: [0, 0.18, -0.12], stand: true, engine: true, leans: true },
};

const geoCache = new Map<number, THREE.BufferGeometry>();

/** A vehicle the player can get into. Parked ones sit still; the one being driven uses arcade physics. */
export class Vehicle {
  group = new THREE.Group();
  body: THREE.Mesh;
  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  steer = 0;
  readonly type: VehicleType;
  readonly h: Handling;
  /** taken from traffic (rather than one of the hand-placed tuk-tuks) */
  taken = false;
  private roll = 0;
  private pitch = 0;

  constructor(public typeIndex: number, color: number) {
    this.type = VEHICLE_TYPES[typeIndex];
    this.h = HANDLING[this.type.name];
    let geo = geoCache.get(typeIndex);
    if (!geo) { geo = (this.type.bare ?? this.type.geo)(); geoCache.set(typeIndex, geo); }
    const mat = vehicleMaterial();
    mat.color.setHex(color);
    this.body = new THREE.Mesh(geo, mat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.group.add(this.body);
  }

  get mass() { return this.type.mass; }
  /** rough radius for "is the player next to it" and for the crowd */
  get reach() { return this.h.half + this.h.r; }

  place(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.roll = this.pitch = 0;
    this.sync();
  }

  /** world position of the driver's seat (where the character's root goes) */
  seat(out = new THREE.Vector3()) {
    const [x, y, z] = this.h.seat;
    return out.set(x, y, z).applyEuler(this.body.rotation).applyEuler(this.group.rotation).add(this.group.position);
  }

  /** distance from a point to the vehicle's outline (0 inside) */
  distanceTo(x: number, z: number) {
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const along = THREE.MathUtils.clamp((x - this.pos.x) * hx + (z - this.pos.z) * hz, -this.h.half, this.h.half);
    return Math.max(0, Math.hypot(x - this.pos.x - hx * along, z - this.pos.z - hz * along) - this.h.r);
  }

  circles(out: Circle[] = []): Circle[] {
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading), { half, r } = this.h;
    // enough circles to cover the length without gaps (three for a bus)
    const n = Math.max(2, Math.ceil((half * 2) / (r * 1.6)) + 1);
    for (let i = 0; i < n; i++) {
      const t = -half + (2 * half * i) / (n - 1);
      out.push({ x: this.pos.x + hx * t, z: this.pos.z + hz * t, r });
    }
    return out;
  }

  /** returns impact strength (0 = none) for sound/feedback */
  drive(dt: number, input: Input, collision: Collision, mask: LandMask, obstacles: Circle[]): number {
    const { wheelbase, maxFwd, maxRev, accel, brake, half: HALF, r: R } = this.h;
    const { f, r } = input.axis();
    const brakeKey = input.isDown('Space');

    // throttle / brake / reverse
    if (f > 0) {
      this.speed += (this.speed < 0 ? brake : accel * (1 - Math.max(0, this.speed) / maxFwd)) * dt;
    } else if (f < 0) {
      if (this.speed > 0.3) this.speed -= brake * dt;
      else this.speed = Math.max(-maxRev, this.speed - accel * 0.6 * dt);
    } else {
      // engine braking and rolling resistance
      const drag = 0.9 + Math.abs(this.speed) * 0.05;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    }
    if (brakeKey) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), brake * 1.3 * dt);

    // steering gets tighter at low speed; long vehicles turn wider
    const maxSteer = 0.62 / (1 + Math.abs(this.speed) * 0.09);
    const target = -r * maxSteer;
    this.steer += (target - this.steer) * (1 - Math.exp(-8 * dt));
    const yawRate = (this.speed * Math.tan(this.steer)) / wheelbase;
    this.heading += yawRate * dt;

    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    const nx = this.pos.x + hx * this.speed * dt;
    const nz = this.pos.z + hz * this.speed * dt;
    const lead = Math.sign(this.speed || 1) * (HALF + R);
    let impact = 0;
    if (!isLand(mask, nx + hx * lead, nz + hz * lead)) {
      impact = Math.abs(this.speed);
      this.speed = 0;
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }

    // buildings, trees, traffic: resolve front, middle and rear circles, then rebuild centre and heading
    const front = { x: this.pos.x + hx * HALF, z: this.pos.z + hz * HALF };
    const rear = { x: this.pos.x - hx * HALF, z: this.pos.z - hz * HALF };
    const f0x = front.x, f0z = front.z, r0x = rear.x, r0z = rear.z;
    collision.resolve(front, R, 0.2);
    collision.resolve(rear, R, 0.2);
    for (const c of [front, rear]) {
      for (const o of obstacles) {
        const dx = c.x - o.x, dz = c.z - o.z, d = Math.hypot(dx, dz), min = R + o.r;
        if (d < min && d > 1e-4) { c.x = o.x + (dx / d) * min; c.z = o.z + (dz / d) * min; }
      }
    }
    if (HALF > 2) {
      // long vehicles: a wall hitting the middle pushes the whole body
      const mid = { x: (front.x + rear.x) / 2, z: (front.z + rear.z) / 2 };
      const m0x = mid.x, m0z = mid.z;
      collision.resolve(mid, R, 0.2);
      front.x += mid.x - m0x; front.z += mid.z - m0z;
      rear.x += mid.x - m0x; rear.z += mid.z - m0z;
    }
    const moved = Math.hypot(front.x - f0x, front.z - f0z) + Math.hypot(rear.x - r0x, rear.z - r0z);
    if (moved > 0.01) {
      // only the head-on part of a hit costs speed, so you can scrape along a wall
      const px = (front.x - f0x + rear.x - r0x) / 2, pz = (front.z - f0z + rear.z - r0z) / 2;
      const pl = Math.hypot(px, pz) || 1;
      const headOn = Math.max(0, -((px * hx + pz * hz) / pl) * Math.sign(this.speed || 1));
      impact = Math.max(impact, Math.abs(this.speed) * headOn);
      this.speed *= 1 - 0.7 * headOn;
      this.pos.x = (front.x + rear.x) / 2;
      this.pos.z = (front.z + rear.z) / 2;
      this.heading = Math.atan2(front.x - rear.x, front.z - rear.z);
    }

    // body roll in corners (two-wheelers lean in), pitch under braking, for feel
    const lateral = yawRate * this.speed;
    const rollT = this.h.leans
      ? THREE.MathUtils.clamp(lateral * 0.07, -0.55, 0.55)
      : THREE.MathUtils.clamp(-lateral * 0.025 * (HALF > 2 ? 0.5 : 1), -0.12, 0.12);
    this.roll += (rollT - this.roll) * (1 - Math.exp(-6 * dt));
    const pitchT = this.h.leans ? 0 : f > 0 && this.speed < maxFwd * 0.6 ? -0.025 : (f < 0 || brakeKey) && this.speed > 1 ? 0.04 : 0;
    this.pitch += (pitchT - this.pitch) * (1 - Math.exp(-5 * dt));
    this.sync();
    return impact;
  }

  sync() {
    this.group.position.set(this.pos.x, ROAD_Y, this.pos.z);
    this.group.rotation.set(0, this.heading, 0);
    this.body.rotation.set(this.pitch, 0, this.roll);
  }
}

/** The tuk-tuks parked around the map. */
export class TukTuk extends Vehicle {
  constructor(color: number) { super(0, color); }
}
