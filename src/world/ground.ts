import * as THREE from 'three';
import type { CityData } from '../types';
import { MeshBuilder, ribbon, dashes, flatPolygon } from './geom';
import type { LandMask } from './landmask';
import { ROAD_TYPES, AREA_KINDS } from '../types';

/** Land plane cut out by the land mask (sea and lakes show the water plane underneath). */
export function buildGround(city: CityData, mask: LandMask): THREE.Mesh {
  const { minX, minZ } = mask;
  const W = mask.w * mask.res, H = mask.h * mask.res;
  const margin = 6000;
  const geo = new THREE.PlaneGeometry(W + margin * 2, H + margin * 2, 1, 1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(minX + W / 2, 0, minZ + H / 2);
  // uv maps the mask rectangle to [0,1]; outside it the texture clamps to its edge
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - minX) / W, (pos.getZ(i) - minZ) / H);

  const data = new Uint8Array(mask.w * mask.h * 4);
  for (let i = 0; i < mask.data.length; i++) {
    const v = mask.data[i];
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, mask.w, mask.h, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8375, roughness: 1, alphaMap: tex, alphaTest: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  void city;
  return mesh;
}

const AREA_COLORS: Record<string, number> = {
  grass: 0x6f8f45, park: 0x5d8a3a, wood: 0x48702f, sand: 0xd9c99b, paved: 0xa39d90, pitch: 0x5f9c48, cemetery: 0x77875a,
};

/** Parks, grass, sand, plazas, roads, pavements, lane markings, rail lines, canals, piers. */
export function buildSurfaces(city: CityData): THREE.Group {
  const g = new THREE.Group();
  g.name = 'surfaces';

  // areas (vertex coloured)
  const areaMb = new MeshBuilder(true);
  const col = new THREE.Color();
  for (const a of city.areas) {
    const kind = AREA_KINDS[a.k];
    col.setHex(AREA_COLORS[kind] ?? 0x888888);
    flatPolygon(areaMb, a.p, a.holes, kind === 'paved' ? 0.03 : 0.02, col);
  }

  const pave = new MeshBuilder();
  const asphalt = new MeshBuilder();
  const foot = new MeshBuilder();
  const marks = new MeshBuilder();
  for (const r of city.roads) {
    const cls = ROAD_TYPES[r.t];
    if (cls === 'footway') { ribbon(foot, r.p, r.w, 0.045); continue; }
    if (cls !== 'service' && cls !== 'motorway') ribbon(pave, r.p, r.w + 3.6, 0.04);
    ribbon(asphalt, r.p, r.w, 0.07);
    if (cls === 'trunk' || cls === 'primary' || cls === 'secondary') dashes(marks, r.p, 0.15, 0.085, 3, 5);
  }

  const ballast = new MeshBuilder();
  const steel = new MeshBuilder();
  for (const rl of [...city.rails, ...(city.trains?.routes ?? [])]) {
    ribbon(ballast, rl, 3.2, 0.06);
    ribbon(steel, rl, 0.09, 0.2, false, 0.72);
    ribbon(steel, rl, 0.09, 0.2, false, -0.72);
  }

  const canals = new MeshBuilder();
  for (const w of city.waterways) ribbon(canals, w.p, w.w, 0.035);
  const piers = new MeshBuilder();
  for (const pr of city.piers) ribbon(piers, pr.p, pr.w, 0.05);

  const add = (mb: MeshBuilder, mat: THREE.Material, name: string) => {
    if (!mb.count) return;
    const m = new THREE.Mesh(mb.build(), mat);
    m.receiveShadow = true;
    m.name = name;
    g.add(m);
  };
  add(areaMb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }), 'areas');
  add(pave, new THREE.MeshStandardMaterial({ color: 0x9f998d, roughness: 0.95 }), 'pavements');
  add(foot, new THREE.MeshStandardMaterial({ color: 0xb0a690, roughness: 1 }), 'footways');
  add(asphalt, new THREE.MeshStandardMaterial({ color: 0x3b3b3e, roughness: 0.9 }), 'roads');
  add(marks, new THREE.MeshStandardMaterial({ color: 0xe6e4da, roughness: 0.7 }), 'markings');
  add(ballast, new THREE.MeshStandardMaterial({ color: 0x6d655b, roughness: 1 }), 'ballast');
  add(steel, new THREE.MeshStandardMaterial({ color: 0x8c9198, roughness: 0.35, metalness: 0.7 }), 'rails');
  add(canals, new THREE.MeshStandardMaterial({ color: 0x35584f, roughness: 0.15 }), 'canals');
  add(piers, new THREE.MeshStandardMaterial({ color: 0xa6a298, roughness: 0.95 }), 'piers');
  return g;
}
