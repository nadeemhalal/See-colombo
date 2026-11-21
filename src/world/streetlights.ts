import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData } from '../types';
import { ROAD_TYPES } from '../types';
import type { Collision } from './collision';
import { chunkedInstances } from './geom';
import { isLand, type LandMask } from './landmask';
import { buildLampMap, lampUniforms } from './lamplight';

// Colombo's main roads are lit by tall concrete-grey poles with orange sodium lamps. Each lamp is
// an instance (pole + arm, glowing head). Their light reaches the world through the lamp light map
// (see lamplight.ts): roads, walls, cars and people under a lamp are lit, with no extra lights.

const SPACING: Record<string, number> = { trunk: 30, primary: 32, secondary: 36, tertiary: 40, residential: 48 };
const POLE_H = 7.2;
const ARM = 1.7;
const SODIUM = new THREE.Color(1.0, 0.6, 0.28);

interface Lamp { x: number; z: number; hx: number; hz: number } // base and head positions

export class StreetLights {
  group = new THREE.Group();
  lamps: Lamp[] = [];
  private headMat: THREE.MeshStandardMaterial;
  private grid = new Map<number, number[]>();

  constructor(city: CityData, mask: LandMask, collision: Collision) {
    this.group.name = 'streetlights';
    const near = (x: number, z: number, r: number) => {
      const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
        for (const id of this.grid.get((cx + i + 5000) * 10000 + cz + j + 5000) ?? []) {
          const l = this.lamps[id];
          if (Math.hypot(l.x - x, l.z - z) < r) return true;
        }
      return false;
    };
    const add = (l: Lamp) => {
      const id = this.lamps.push(l) - 1;
      const k = (Math.floor(l.x / 20) + 5000) * 10000 + Math.floor(l.z / 20) + 5000;
      let c = this.grid.get(k);
      if (!c) this.grid.set(k, (c = []));
      c.push(id);
    };

    for (const r of city.roads) {
      const cls = ROAD_TYPES[r.t];
      const spacing = SPACING[cls];
      if (!spacing) continue;
      const p = r.p;
      let carry = spacing * 0.5;
      let side = 1;
      for (let i = 0; i < p.length / 2 - 1; i++) {
        const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 0.01) continue;
        const dx = (bx - ax) / len, dz = (bz - az) / len;
        for (let s = carry; s < len; s += spacing) {
          // wide roads get lamps on both sides, alternating; narrow ones on one side
          if (r.w >= 7) side = -side;
          const off = r.w / 2 + 0.55;
          const x = ax + dx * s + dz * off * side, z = az + dz * s - dx * off * side;
          if (!isLand(mask, x, z) || collision.pointBlocked(x, 0.5, z) || near(x, z, 14)) continue;
          // the arm reaches out over the road
          add({ x, z, hx: x - dz * ARM * side, hz: z + dx * ARM * side });
          collision.addCircle(x, z, 0.14, POLE_H);
        }
        carry = (carry - len) % spacing;
        if (carry < 0) carry += spacing;
      }
    }

    // pole and arm, concrete grey
    const pole = new THREE.CylinderGeometry(0.07, 0.11, POLE_H, 6, 1, true).translate(0, POLE_H / 2, 0);
    const arm = new THREE.BoxGeometry(0.07, 0.07, ARM).translate(0, POLE_H - 0.1, ARM / 2);
    const poleGeo = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()])!;
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d8f8a, roughness: 0.8 });
    // lamp head: a shallow box, glowing underneath at night
    const head = new THREE.BoxGeometry(0.28, 0.12, 0.6).translate(0, POLE_H - 0.12, ARM);
    this.headMat = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.5, emissive: SODIUM, emissiveIntensity: 0 });

    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const atBase = (l: Lamp, m4: THREE.Matrix4) =>
      m4.compose(v.set(l.x, 0, l.z), q.setFromAxisAngle(up, Math.atan2(l.hx - l.x, l.hz - l.z)), one);
    for (const m of chunkedInstances(this.lamps, poleGeo, poleMat, 400, atBase)) { m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    for (const m of chunkedInstances(this.lamps, head, this.headMat, 400, atBase)) this.group.add(m);

    buildLampMap(city.bounds, this.lamps.map((l) => ({ x: l.hx, z: l.hz })));
  }

  /** night: 0 day .. 1 night */
  update(_dt: number, night: number, _focus?: THREE.Vector3) {
    const on = THREE.MathUtils.smoothstep(night, 0.35, 0.75);
    this.headMat.emissiveIntensity = on * 2.2;
    lampUniforms.uLampOn.value = on;
  }
}
