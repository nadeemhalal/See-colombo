import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CityData } from '../types';
import type { Collision } from './collision';

const CHUNK = 800;

function palmCrown(): THREE.BufferGeometry {
  const fronds: THREE.BufferGeometry[] = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const len = 3.6, segs = 4;
    const g = new THREE.PlaneGeometry(0.9, len, 1, segs);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k) + len / 2; // 0..len along the frond
      const x = pos.getX(k);
      // lay it out horizontally, droop toward the tip, narrow the tip
      const t = y / len;
      pos.setXYZ(k, x * (1 - t * 0.7), -0.9 * t * t * len * 0.45, y);
    }
    g.computeVertexNormals();
    g.rotateX(-0.35);
    g.rotateY((i / count) * Math.PI * 2 + (i % 2) * 0.3);
    fronds.push(g);
  }
  const m = mergeGeometries(fronds)!;
  m.translate(0.6, 9, 0); // matches the trunk lean
  return m;
}

function palmTrunk(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.13, 0.2, 9, 6, 3);
  g.translate(0, 4.5, 0);
  // slight lean
  const pos = g.getAttribute('position');
  for (let k = 0; k < pos.count; k++) pos.setX(k, pos.getX(k) + (pos.getY(k) / 9) ** 2 * 0.6);
  g.computeVertexNormals();
  return g;
}

function broadTrunk(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.22, 0.35, 4, 6);
  g.translate(0, 2, 0);
  return g;
}

function broadCrown(): THREE.BufferGeometry {
  const parts = [
    new THREE.IcosahedronGeometry(2.8, 0).translate(0, 5.4, 0),
    new THREE.IcosahedronGeometry(2.2, 0).translate(1.7, 4.8, 0.6),
    new THREE.IcosahedronGeometry(2.1, 0).translate(-1.5, 4.9, -0.8),
    new THREE.IcosahedronGeometry(1.9, 0).translate(0.3, 4.6, 1.8),
  ];
  const m = mergeGeometries(parts)!;
  m.scale(1.15, 0.85, 1.15);
  m.computeVertexNormals();
  return m;
}

export function buildTrees(city: CityData, collision: Collision): THREE.Group {
  const group = new THREE.Group();
  group.name = 'trees';
  const geos = { palmTrunk: palmTrunk(), palmCrown: palmCrown(), broadTrunk: broadTrunk(), broadCrown: broadCrown() };
  const mats = {
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b5641, roughness: 1 }),
    palmTrunk: new THREE.MeshStandardMaterial({ color: 0x8a7a63, roughness: 1 }),
    frond: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }),
    leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }),
  };

  const byChunk = new Map<string, number[]>();
  const t = city.trees;
  for (let i = 0; i < t.length; i += 4) {
    const k = `${Math.floor(t[i] / CHUNK)},${Math.floor(t[i + 1] / CHUNK)}`;
    let a = byChunk.get(k);
    if (!a) byChunk.set(k, (a = []));
    a.push(i);
    const s = t[i + 3];
    collision.addCircle(t[i], t[i + 1], (t[i + 2] === 0 ? 0.22 : 0.4) * s, 99);
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const col = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);
  for (const idxs of byChunk.values()) {
    const palms = idxs.filter((i) => t[i + 2] === 0);
    const broads = idxs.filter((i) => t[i + 2] !== 0);
    const make = (list: number[], trunkGeo: THREE.BufferGeometry, crownGeo: THREE.BufferGeometry, trunkMat: THREE.Material, crownMat: THREE.Material, palm: boolean) => {
      if (!list.length) return;
      const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
      const crown = new THREE.InstancedMesh(crownGeo, crownMat, list.length);
      list.forEach((i, n) => {
        const s = t[i + 3];
        const rot = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * Math.PI * 2;
        q.setFromAxisAngle(up, rot);
        const sy = palm ? s * (0.85 + ((i * 7) % 5) * 0.08) : s;
        m4.compose(new THREE.Vector3(t[i], 0, t[i + 1]), q, new THREE.Vector3(s, sy, s));
        trunk.setMatrixAt(n, m4);
        crown.setMatrixAt(n, m4);
        const v = ((i * 31) % 17) / 17;
        if (palm) col.setRGB(0.36 + v * 0.08, 0.5 + v * 0.08, 0.2);
        else col.setRGB(0.24 + v * 0.1, 0.42 + v * 0.1, 0.17 + v * 0.04);
        crown.setColorAt(n, col);
      });
      for (const m of [trunk, crown]) {
        m.castShadow = true;
        m.receiveShadow = true;
        m.computeBoundingSphere();
        group.add(m);
      }
    };
    make(palms, geos.palmTrunk, geos.palmCrown, mats.palmTrunk, mats.frond, true);
    make(broads, geos.broadTrunk, geos.broadCrown, mats.trunk, mats.leaf, false);
  }
  return group;
}
