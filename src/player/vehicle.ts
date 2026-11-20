import * as THREE from 'three';
import type { Input } from './input';
import type { Collision } from '../world/collision';
import { isLand, type LandMask } from '../world/landmask';
import { tukTuk, vehicleMaterial } from '../traffic/models';
import type { Circle } from '../traffic/traffic';

const WHEELBASE = 1.8;
const MAX_FWD = 16; // ~58 km/h, about what a three-wheeler manages
const MAX_REV = 3.5;
const ACCEL = 3.6;
const BRAKE = 9;
const HALF = 0.75; // front/rear collision circles at ±HALF along the heading
const R = 0.66;
const ROAD_Y = 0.07;

let sharedGeo: THREE.BufferGeometry | null = null;

/** A tuk-tuk the player can get into. Parked ones sit still; the one being driven uses arcade physics. */
export class TukTuk {
  group = new THREE.Group();
  body: THREE.Mesh;
  pos = new THREE.Vector3();
  heading = 0;
  speed = 0;
  steer = 0;
  private roll = 0;
  private pitch = 0;

  constructor(color: number) {
    sharedGeo ??= tukTuk();
    const mat = vehicleMaterial();
    mat.color.setHex(color);
    this.body = new THREE.Mesh(sharedGeo, mat);
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.group.add(this.body);
  }

  place(x: number, z: number, heading: number) {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.speed = 0;
    this.sync();
  }

  /** world position of the driver's seat (where the character's root goes) */
  seat(out = new THREE.Vector3()) {
    return out.set(0, -0.06, 0.3).applyEuler(this.group.rotation).add(this.group.position);
  }

  circles(out: Circle[] = []): Circle[] {
    const hx = Math.sin(this.heading), hz = Math.cos(this.heading);
    out.push({ x: this.pos.x + hx * HALF, z: this.pos.z + hz * HALF, r: R }, { x: this.pos.x - hx * HALF, z: this.pos.z - hz * HALF, r: R });
    return out;
  }

  /** returns impact strength (0 = none) for sound/feedback */
  drive(dt: number, input: Input, collision: Collision, mask: LandMask, obstacles: Circle[]): number {
    const { f, r } = input.axis();
    const brakeKey = input.isDown('Space');

    // throttle / brake / reverse
    if (f > 0) {
      this.speed += (this.speed < 0 ? BRAKE : ACCEL * (1 - Math.max(0, this.speed) / MAX_FWD)) * dt;
    } else if (f < 0) {
      if (this.speed > 0.3) this.speed -= BRAKE * dt;
      else this.speed = Math.max(-MAX_REV, this.speed - ACCEL * 0.6 * dt);
    } else {
      // engine braking and rolling resistance
      const drag = 0.9 + Math.abs(this.speed) * 0.05;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    }
    if (brakeKey) this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), BRAKE * 1.3 * dt);

    // steering gets tighter at low speed
    const maxSteer = 0.62 / (1 + Math.abs(this.speed) * 0.09);
    const target = -r * maxSteer;
    this.steer += (target - this.steer) * (1 - Math.exp(-8 * dt));
    const yawRate = (this.speed * Math.tan(this.steer)) / WHEELBASE;
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

    // buildings, trees, traffic: resolve front and rear circles, then rebuild centre and heading
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

    // body lean in corners and pitch under braking, for feel
    const lateral = yawRate * this.speed;
    this.roll += (THREE.MathUtils.clamp(-lateral * 0.025, -0.12, 0.12) - this.roll) * (1 - Math.exp(-6 * dt));
    const pitchT = f > 0 && this.speed < MAX_FWD * 0.6 ? -0.025 : (f < 0 || brakeKey) && this.speed > 1 ? 0.04 : 0;
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
