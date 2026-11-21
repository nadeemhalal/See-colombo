import * as THREE from 'three';
import type { Input } from './input';
import type { Collision } from '../world/collision';

/** Over-the-shoulder third-person camera that pulls in when a wall is in the way. */
export class FollowCamera {
  yaw = 0; // 0 = camera south of the player, looking north
  pitch = 0.25;
  dist = 4.6;
  /** separate zoom while driving */
  driveDist = 6.5;
  private cur = 4.6;
  sensitivity = 0.0024;
  invertY = false;
  private target = new THREE.Vector3();
  private sinceMouse = 10;

  constructor(public camera: THREE.PerspectiveCamera, private collision: Collision) {}

  /**
   * vehicle: when driving, pass the vehicle heading and speed; the camera swings
   * back behind the vehicle a moment after you stop moving the mouse.
   */
  update(dt: number, input: Input, playerPos: THREE.Vector3, vehicle?: { heading: number; speed: number }) {
    const look = input.lookAxis();
    this.yaw -= input.mouseDX * this.sensitivity + look.yaw * 2.2 * dt;
    this.pitch += (input.mouseDY * this.sensitivity + look.pitch * 1.2 * dt) * (this.invertY ? -1 : 1);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -0.5, 1.25);
    this.sinceMouse = input.mouseDX || input.mouseDY || look.yaw || look.pitch ? 0 : this.sinceMouse + dt;
    if (input.wheel) {
      if (vehicle) this.driveDist = THREE.MathUtils.clamp(this.driveDist + input.wheel * 0.8, 3, 18);
      else this.dist = THREE.MathUtils.clamp(this.dist + input.wheel * 0.8, 1.8, 16);
    }

    let shoulder = 0.35, height = 1.55, dist = this.dist;
    if (vehicle) {
      shoulder = 0;
      height = 1.7;
      dist = this.driveDist;
      if (this.sinceMouse > 1.2 && Math.abs(vehicle.speed) > 1.5) {
        const behind = vehicle.heading + (vehicle.speed < 0 ? 0 : Math.PI);
        let d = behind - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * (1 - Math.exp(-2.5 * dt));
        this.pitch += (0.22 - this.pitch) * (1 - Math.exp(-1.5 * dt));
      }
    }

    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const tgt = this.target.set(playerPos.x + rx * shoulder, playerPos.y + height, playerPos.z + rz * shoulder);
    const dx = Math.sin(this.yaw) * Math.cos(this.pitch);
    const dy = Math.sin(this.pitch);
    const dz = Math.cos(this.yaw) * Math.cos(this.pitch);

    // march out from the target until something blocks the view
    let allowed = dist;
    for (let d = 0.3; d <= dist; d += 0.25) {
      const x = tgt.x + dx * d, y = tgt.y + dy * d, z = tgt.z + dz * d;
      if (y < 0.25 || this.collision.pointBlocked(x, y, z)) { allowed = Math.max(0.6, d - 0.35); break; }
    }
    // pull in instantly, ease back out
    this.cur = allowed < this.cur ? allowed : this.cur + (allowed - this.cur) * (1 - Math.exp(-4 * dt));

    this.camera.position.set(tgt.x + dx * this.cur, Math.max(tgt.y + dy * this.cur, 0.3), tgt.z + dz * this.cur);
    this.camera.lookAt(tgt);
  }
}
