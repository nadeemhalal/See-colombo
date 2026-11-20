import * as THREE from 'three';
import type { CityData } from '../types';
import type { Collision } from './collision';

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
    const seg = 32;

    // podium
    const podium = new THREE.LatheGeometry(
      [[0, 0], [44, 0], [47, 5], [44, 12], [34, 17], [0, 17]].map(([r, y]) => new THREE.Vector2(r, y)), seg);
    const podMat = new THREE.MeshStandardMaterial({ color: 0xcdbfc8, roughness: 0.6 });
    t.add(new THREE.Mesh(podium, podMat));

    // shaft
    shaftMat = new THREE.MeshStandardMaterial({ color: 0x79a86e, roughness: 0.5, metalness: 0.1 });
    const shaft = new THREE.LatheGeometry(
      [[0, 16], [11, 16], [9, 60], [7.2, 150], [6.4, 212], [0, 212]].map(([r, y]) => new THREE.Vector2(r, y)), seg);
    t.add(new THREE.Mesh(shaft, shaftMat));

    // lotus bud
    budMat = new THREE.MeshStandardMaterial({ color: 0xb87aa8, roughness: 0.45, metalness: 0.1 });
    const bud = new THREE.LatheGeometry(
      [[0, 204], [7, 206], [15, 214], [22, 230], [25.5, 248], [23, 266], [16, 282], [8, 292], [3, 297], [0, 298]].map(
        ([r, y]) => new THREE.Vector2(r, y)), seg);
    // petal ridges: push vertices out in 8 lobes
    const pos = bud.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.06 * Math.abs(Math.cos(a * 4));
      pos.setX(i, x * k); pos.setZ(i, z * k);
    }
    bud.computeVertexNormals();
    t.add(new THREE.Mesh(bud, budMat));

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
    collision.addPolygon(circle(46), undefined, 17);
    collision.addPolygon(circle(11), undefined, 356);
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
