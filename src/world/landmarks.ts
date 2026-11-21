import * as THREE from 'three';
import type { CityData } from '../types';
import type { Collision } from './collision';
import { ROAD_TYPES } from '../types';

/** Hand-built models for landmarks whose OSM footprint isn't enough. Currently: Lotus Tower. */
export function buildLandmarks(city: CityData, collision: Collision) {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const lotus = city.landmarks.find((l) => l.id === 'lotus');
  let budMat: THREE.MeshStandardMaterial | null = null;
  let shaftMat: THREE.MeshStandardMaterial | null = null;

  if (lotus) {
    const t = new THREE.Group();
    t.position.set(lotus.x, 0, lotus.z);
    const seg = 48;

    // the podium stops short of the nearest real road (the OSM outline overlaps D. R. Wijewardene
    // Mawatha, which put the old podium in the middle of the road)
    let roadGap = 41;
    for (const r of city.roads) {
      const cls = ROAD_TYPES[r.t];
      if (cls === 'service' || cls === 'footway') continue;
      for (let i = 0; i < r.p.length / 2 - 1; i++) {
        const ax = r.p[i * 2] - lotus.x, az = r.p[i * 2 + 1] - lotus.z, bx = r.p[i * 2 + 2] - lotus.x, bz = r.p[i * 2 + 3] - lotus.z;
        const dx = bx - ax, dz = bz - az;
        const k = Math.max(0, Math.min(1, -(ax * dx + az * dz) / (dx * dx + dz * dz || 1)));
        roadGap = Math.min(roadGap, Math.hypot(ax + dx * k, az + dz * k) - r.w / 2 - 2.5);
      }
    }
    const R = Math.max(18, roadGap);

    // podium: a stepped, lotus-leaf base
    const podium = new THREE.LatheGeometry(
      [[0, 0], [R, 0], [R + 0.8, 1.2], [R, 3], [R - 1, 9], [R * 0.82, 10], [R * 0.78, 14], [R * 0.6, 15.5], [0, 15.5]]
        .map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const podMat = new THREE.MeshStandardMaterial({ color: 0xd8ccd2, roughness: 0.55 });
    t.add(new THREE.Mesh(podium, podMat));
    // band of dark glazing around the podium
    const glaze = new THREE.CylinderGeometry(R - 0.6, R - 0.4, 5, seg, 1, true).translate(0, 5.5, 0);
    t.add(new THREE.Mesh(glaze, new THREE.MeshStandardMaterial({ color: 0x2b3440, roughness: 0.15, metalness: 0.6 })));

    // shaft: green, tapering, with vertical ribs
    shaftMat = new THREE.MeshStandardMaterial({ color: 0x6f9e63, roughness: 0.45, metalness: 0.1 });
    const shaft = new THREE.LatheGeometry(
      [[0, 15], [12, 15], [10, 40], [8.2, 100], [7, 170], [6.6, 212], [0, 212]].map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const sp = shaft.getAttribute('position');
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), z = sp.getZ(i), a = Math.atan2(z, x);
      const k = 1 + 0.035 * Math.pow(Math.abs(Math.cos(a * 6)), 4);
      sp.setX(i, x * k); sp.setZ(i, z * k);
    }
    shaft.computeVertexNormals();
    t.add(new THREE.Mesh(shaft, shaftMat));

    // lotus bud: two layers of eight petals, the inner layer turned half a petal and standing taller
    budMat = new THREE.MeshStandardMaterial({ color: 0xb46fa6, roughness: 0.4, metalness: 0.15 });
    const innerMat = new THREE.MeshStandardMaterial({ color: 0x8e4f8a, roughness: 0.4, metalness: 0.15 });
    const petals = (profile: number[][], turn: number, depth: number) => {
      const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 64);
      const p = g.getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i), y = p.getY(i), a = Math.atan2(z, x) + turn;
        // pointed petal tips: the lobes deepen towards the top of the bud
        const h = THREE.MathUtils.clamp((y - profile[0][1]) / (profile[profile.length - 1][1] - profile[0][1]), 0, 1);
        const lobe = Math.pow(Math.abs(Math.cos(a * 4)), 0.6);
        const k = 1 - depth * (1 - lobe) * (0.25 + h * 0.9);
        p.setX(i, x * k); p.setZ(i, z * k);
      }
      g.computeVertexNormals();
      return g;
    };
    t.add(new THREE.Mesh(petals([[0, 204], [8, 206], [17, 215], [24, 232], [26.5, 248], [23, 266], [14, 280], [5, 288], [0, 290]], 0, 0.32), budMat));
    t.add(new THREE.Mesh(petals([[0, 210], [10, 214], [19, 232], [21.5, 252], [18, 272], [10, 288], [3, 296], [0, 298]], Math.PI / 8, 0.28), innerMat));
    // observation deck: a ring of glass where the bud meets the shaft
    const deck = new THREE.CylinderGeometry(15, 13, 5, seg, 1, true).translate(0, 209, 0);
    t.add(new THREE.Mesh(deck, new THREE.MeshStandardMaterial({ color: 0x1f2a33, roughness: 0.1, metalness: 0.7 })));

    // spire
    const spire = new THREE.CylinderGeometry(0.4, 2.6, 58, 12);
    spire.translate(0, 298 + 29, 0);
    t.add(new THREE.Mesh(spire, new THREE.MeshStandardMaterial({ color: 0xd8c27c, roughness: 0.3, metalness: 0.7 })));

    t.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(t);

    const circle = (r: number) => {
      const p: number[] = [];
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        p.push(lotus.x + Math.cos(a) * r, lotus.z - Math.sin(a) * r);
      }
      return p;
    };
    collision.addPolygon(circle(R + 0.5), undefined, 15.5);
    collision.addPolygon(circle(12), undefined, 356);
  }

  const hsl = new THREE.Color();
  return {
    group,
    update(time: number, night: number) {
      if (!budMat || !shaftMat) return;
      // the real tower runs colour light shows at night
      hsl.setHSL((time * 0.02) % 1, 0.8, 0.5);
      budMat.emissive.copy(hsl).multiplyScalar(night * 0.9);
      hsl.setHSL((time * 0.02 + 0.33) % 1, 0.7, 0.45);
      shaftMat.emissive.copy(hsl).multiplyScalar(night * 0.5);
    },
  };
}
