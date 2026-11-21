import * as THREE from 'three';
import { addLampLight } from './lamplight';
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

  const mat = surfaceMaterial('dirt', { color: 0x8f8574, roughness: 1, alphaMap: tex, alphaTest: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  void city;
  return mesh;
}

// World-space surface detail in the shader, so large flat areas don't look like flat plastic.
type Surface = 'asphalt' | 'pavement' | 'grass' | 'dirt' | 'footway';
export function surfaceMaterial(kind: Surface, params: THREE.MeshStandardMaterialParameters) {
  const m = new THREE.MeshStandardMaterial(params);
  const KIND = { asphalt: 0, pavement: 1, grass: 2, dirt: 3, footway: 4 }[kind];
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldP;
        float sh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sn(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sh21(i), sh21(i + vec2(1, 0)), f.x), mix(sh21(i + vec2(0, 1)), sh21(i + vec2(1, 1)), f.x), f.y);
        }
        float fbm(vec2 p) { return sn(p) * 0.55 + sn(p * 2.1 + 3.7) * 0.28 + sn(p * 4.3 + 9.1) * 0.17; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 w = vWorldP.xz;
          float big = fbm(w * 0.045);
          float mid = fbm(w * 0.35);
          float fine = sn(w * 7.0);
          ${KIND === 0 ? `
          // asphalt: patched and faded, with darker oil and tar seams
          diffuseColor.rgb *= 0.82 + 0.3 * big + 0.08 * fine;
          float patchy = smoothstep(0.62, 0.66, sn(w * 0.09 + 4.0));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, patchy * 0.6);
          float seam = 1.0 - smoothstep(0.0, 0.04, abs(sn(w * 0.05) - 0.5));
          diffuseColor.rgb *= 1.0 - 0.18 * seam;` : ''}
          ${KIND === 1 ? `
          // pavement: concrete slabs with grimy joints
          vec2 slab = fract(w / 0.9);
          float joint = 1.0 - step(0.04, slab.x) * step(0.04, slab.y);
          diffuseColor.rgb *= (0.88 + 0.18 * big + 0.06 * fine) * (1.0 - 0.25 * joint);
          diffuseColor.rgb *= 0.92 + 0.12 * sh21(floor(w / 0.9));` : ''}
          ${KIND === 2 ? `
          // grass: patchy greens with dry, sunburnt areas
          vec3 dry = vec3(0.62, 0.58, 0.36) * dot(diffuseColor.rgb, vec3(0.6));
          float isGreen = step(diffuseColor.r * 1.05, diffuseColor.g);
          diffuseColor.rgb = mix(diffuseColor.rgb, dry * 1.4, smoothstep(0.55, 0.85, big) * 0.6 * isGreen);
          diffuseColor.rgb *= 0.78 + 0.3 * mid + 0.12 * fine;` : ''}
          ${KIND === 3 ? `
          // bare ground: reddish laterite soil and dust
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.42, 0.3), smoothstep(0.5, 0.8, big) * 0.35);
          diffuseColor.rgb *= 0.82 + 0.25 * mid + 0.1 * fine;` : ''}
          ${KIND === 4 ? `
          diffuseColor.rgb *= 0.85 + 0.2 * mid + 0.1 * fine;` : ''}
        }`);
  };
  m.customProgramCacheKey = () => `surface-${kind}`;
  return m;
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
  const kerbs = new MeshBuilder();
  for (const r of city.roads) {
    const cls = ROAD_TYPES[r.t];
    if (cls === 'footway') { ribbon(foot, r.p, r.w, 0.045); continue; }
    if (cls !== 'service' && cls !== 'motorway') ribbon(pave, r.p, r.w + 3.6, 0.04);
    ribbon(asphalt, r.p, r.w, 0.07);
    if (cls === 'trunk' || cls === 'primary' || cls === 'secondary') dashes(marks, r.p, 0.15, 0.085, 3, 5);
    // solid white edge lines on the main roads, and a raised kerb along every road with a pavement
    if ((cls === 'trunk' || cls === 'primary') && r.w >= 7) {
      ribbon(marks, r.p, 0.14, 0.085, false, r.w / 2 - 0.45);
      ribbon(marks, r.p, 0.14, 0.085, false, -(r.w / 2 - 0.45));
    }
    if (cls !== 'service' && cls !== 'motorway') {
      ribbon(kerbs, r.p, 0.22, 0.13, false, r.w / 2 + 0.11);
      ribbon(kerbs, r.p, 0.22, 0.13, false, -(r.w / 2 + 0.11));
    }
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
    // lamp light on everything you walk or drive on
    if (mat instanceof THREE.MeshStandardMaterial && name !== 'canals' && name !== 'rails') addLampLight(mat);
    const m = new THREE.Mesh(mb.build(), mat);
    m.receiveShadow = true;
    m.name = name;
    g.add(m);
  };
  add(areaMb, surfaceMaterial('grass', { vertexColors: true, roughness: 1 }), 'areas');
  add(pave, surfaceMaterial('pavement', { color: 0xa7a194, roughness: 0.95 }), 'pavements');
  add(foot, surfaceMaterial('footway', { color: 0xb3a88f, roughness: 1 }), 'footways');
  add(asphalt, surfaceMaterial('asphalt', { color: 0x3d3d40, roughness: 0.88 }), 'roads');
  add(kerbs, new THREE.MeshStandardMaterial({ color: 0xc9c5bb, roughness: 0.9 }), 'kerbs');
  add(marks, new THREE.MeshStandardMaterial({ color: 0xe6e4da, roughness: 0.7 }), 'markings');
  add(ballast, new THREE.MeshStandardMaterial({ color: 0x6d655b, roughness: 1 }), 'ballast');
  add(steel, new THREE.MeshStandardMaterial({ color: 0x8c9198, roughness: 0.35, metalness: 0.7 }), 'rails');
  add(canals, new THREE.MeshStandardMaterial({ color: 0x35584f, roughness: 0.15 }), 'canals');
  add(piers, new THREE.MeshStandardMaterial({ color: 0xa6a298, roughness: 0.95 }), 'piers');
  return g;
}
