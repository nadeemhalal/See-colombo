import * as THREE from 'three';
import type { Input } from './input';
import type { Collision } from '../world/collision';
import { isLand, type LandMask } from '../world/landmask';
import type { Circle } from '../traffic/traffic';

export const SPEED = { walk: 1.5, jog: 3.6, sprint: 6.5 };
const GRAVITY = 20;
const JUMP_V = 6.4; // ~1 m jump
const RADIUS = 0.32;
const MANTLE_MAX = 1.8; // ledges up to this height above the feet can be climbed

export class PlayerController {
  pos = new THREE.Vector3();
  vel = new THREE.Vector2(); // horizontal velocity (x, z)
  velY = 0;
  onGround = true;
  facing = 0; // radians, 0 = +z
  sprinting = false;
  private jumpBuffer = 0;
  private coyote = 0;

  constructor(private collision: Collision, private mask: LandMask) {}

  teleport(x: number, z: number, y = 0) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0);
    this.velY = 0;
  }

  /** obstacles: moving things (vehicles) to keep out of, as circles */
  update(dt: number, input: Input, camYaw: number, obstacles: Circle[] = []) {
    const { f, r } = input.axis();
    // camera forward on the ground plane and its right vector
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let wx = fx * f + rx * r, wz = fz * f + rz * r;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    const walk = input.isDown('KeyC') || input.isDown('ControlLeft');
    this.sprinting = wl > 0 && (input.isDown('ShiftLeft') || input.isDown('ShiftRight')) && !walk;
    const target = wl === 0 ? 0 : walk ? SPEED.walk : this.sprinting ? SPEED.sprint : SPEED.jog;

    const accel = this.onGround ? 12 : 2.5;
    const k = 1 - Math.exp(-accel * dt);
    this.vel.x += (wx * target - this.vel.x) * k;
    this.vel.y += (wz * target - this.vel.y) * k;

    const speed = this.vel.length();
    if (speed > 0.3) {
      const want = Math.atan2(this.vel.x, this.vel.y);
      let d = want - this.facing;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.facing += d * (1 - Math.exp(-14 * dt));
    }

    // jump with a small input buffer and coyote time
    if (input.wasPressed('Space')) this.jumpBuffer = 0.15;
    this.jumpBuffer -= dt;
    this.coyote = this.onGround ? 0.1 : this.coyote - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0) {
      this.velY = JUMP_V;
      this.onGround = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
    }

    // horizontal move in sub-steps
    const dist = speed * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    let blockedBy = Infinity;
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + (this.vel.x * dt) / steps;
      const nz = this.pos.z + (this.vel.y * dt) / steps;
      // can't walk into the sea or the lake: slide along the shore
      if (isLand(this.mask, nx, nz)) { this.pos.x = nx; this.pos.z = nz; }
      else if (isLand(this.mask, nx, this.pos.z)) { this.pos.x = nx; this.vel.y = 0; }
      else if (isLand(this.mask, this.pos.x, nz)) { this.pos.z = nz; this.vel.x = 0; }
      else { this.vel.set(0, 0); }
      const res = this.collision.resolve(this.pos, RADIUS, this.pos.y);
      blockedBy = Math.min(blockedBy, res.blockedBy);
      if (this.pos.y < 1.6) {
        for (const o of obstacles) {
          const dx = this.pos.x - o.x, dz = this.pos.z - o.z, d = Math.hypot(dx, dz), min = RADIUS + o.r;
          if (d < min && d > 1e-4) { this.pos.x = o.x + (dx / d) * min; this.pos.z = o.z + (dz / d) * min; }
        }
      }
    }

    // ledge climb: pushing into a low ledge while jumping/airborne pulls you up onto it
    const ledge = blockedBy - this.pos.y;
    if (wl > 0 && ledge > 0.3 && ledge <= MANTLE_MAX && (!this.onGround || input.isDown('Space'))) {
      this.pos.y = blockedBy;
      this.velY = 0;
      this.onGround = true;
      this.pos.x += wx * (RADIUS + 0.1);
      this.pos.z += wz * (RADIUS + 0.1);
    }

    // vertical
    this.velY -= GRAVITY * dt;
    this.pos.y += this.velY * dt;
    const ground = this.collision.groundAt(this.pos.x, this.pos.z, Math.max(this.pos.y, 0));
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.velY = 0;
      this.onGround = true;
    } else if (this.pos.y - ground > 0.05) {
      this.onGround = false;
    }
    if (this.pos.y < -50) this.pos.y = 0;
  }
}
