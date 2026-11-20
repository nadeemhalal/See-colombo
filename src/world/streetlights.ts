import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData } from '../types';
import { ROAD_TYPES } from '../types';
import type { Collision } from './collision';
import { chunkedInstances } from './geom';
import { isLand, type LandMask } from './landmask';

// Colombo's main roads are lit by tall concrete-grey poles with orange sodium lamps. Each lamp is
// an instance (pole + arm, glowing head) plus an additive pool of light on the ground. A handful of
// real point lights follow the player so nearby people and vehicles are lit too.

const SPACING: Record<string, number> = { trunk: 30, primary: 32, secondary: 36, tertiary: 40, residential: 48 };
const POLE_H = 7.2;
const ARM = 1.7;
const SODIUM = new THREE.Color(1.0, 0.6, 0.28);
const REAL_LIGHTS = 6;

interface Lamp { x: number; z: number; hx: number; hz: number } // base and head positions

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class StreetLights {
  group = new THREE.Group();
  lamps: Lamp[] = [];
  private headMat: THREE.MeshStandardMaterial;
  private poolMat: THREE.MeshBasicMaterial;
  private lights: THREE.PointLight[] = [];
  private pickT = 0;
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

    // pools of light on the road and pavement
    this.poolMat = new THREE.MeshBasicMaterial({
      map: poolTexture(), color: SODIUM, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const poolGeo = new THREE.PlaneGeometry(17, 17).rotateX(-Math.PI / 2);
    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    const atBase = (l: Lamp, m4: THREE.Matrix4) =>
      m4.compose(v.set(l.x, 0, l.z), q.setFromAxisAngle(up, Math.atan2(l.hx - l.x, l.hz - l.z)), one);
    const atPool = (l: Lamp, m4: THREE.Matrix4) =>
      m4.compose(v.set(l.hx, 0.1, l.hz), q.setFromAxisAngle(up, Math.atan2(l.hx - l.x, l.hz - l.z)), one);
    for (const m of chunkedInstances(this.lamps, poleGeo, poleMat, 400, atBase)) { m.castShadow = true; m.receiveShadow = true; this.group.add(m); }
    for (const m of chunkedInstances(this.lamps, head, this.headMat, 400, atBase)) this.group.add(m);
    for (const m of chunkedInstances(this.lamps, poolGeo, this.poolMat, 400, atPool)) { m.renderOrder = 1; this.group.add(m); }

    for (let i = 0; i < REAL_LIGHTS; i++) {
      const pl = new THREE.PointLight(SODIUM, 0, 22, 1.6);
      this.lights.push(pl);
      this.group.add(pl);
    }
  }

  /** night: 0 day .. 1 night */
  update(dt: number, night: number, focus: THREE.Vector3) {
    const on = THREE.MathUtils.smoothstep(night, 0.35, 0.75);
    this.headMat.emissiveIntensity = on * 4;
    this.poolMat.opacity = on * 0.42;
    this.pickT -= dt;
    if (this.pickT <= 0) {
      this.pickT = 0.25;
      // nearest lamps to the player get real lights
      const best: { d: number; l: Lamp }[] = [];
      const cx = Math.floor(focus.x / 20), cz = Math.floor(focus.z / 20);
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++)
        for (const id of this.grid.get((cx + i + 5000) * 10000 + cz + j + 5000) ?? []) {
          const l = this.lamps[id];
          best.push({ d: Math.hypot(l.hx - focus.x, l.hz - focus.z), l });
        }
      best.sort((a, b) => a.d - b.d);
      this.lights.forEach((pl, i) => {
        const b = best[i];
        // keep every light in the scene (changing the count recompiles shaders); park unused ones far away
        if (!b) { pl.position.set(0, -1000, 0); return; }
        pl.position.set(b.l.hx, POLE_H - 0.4, b.l.hz);
      });
    }
    for (const pl of this.lights) pl.intensity = on * 55;
  }
}
