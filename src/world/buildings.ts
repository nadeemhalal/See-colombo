import * as THREE from 'three';
import type { Building, CityData, Flat } from '../types';
import { BUILDING_STYLES } from '../types';
import { MeshBuilder } from './geom';

const CHUNK = 400;

const PALETTES: Record<string, number[]> = {
  plain: [0xe8e2d4, 0xd9d2c2, 0xcfc8b8, 0xf0ead8, 0xe2d6bc, 0xc9c8c3, 0xdcd6c8, 0xe9dcc5, 0xbdb7aa, 0xd5cfc3],
  pastel: [0xe6d3a3, 0xc9dccf, 0xe2c3b5, 0xbcd0e0, 0xe8e0a8, 0xd8c4dc, 0xf0c9a0],
  glass: [0x8fa3b3, 0x6f8494, 0xa9b6bf, 0x5d6f7c, 0x7f97a6, 0xb4bcc2],
  colonial: [0xe9e0c9, 0xd8c39a, 0xcaa97e, 0xf1ead6, 0xb05a40, 0xe3d3a8],
  house: [0xf2efe6, 0xe8dcc0, 0xd7e3d0, 0xe9d6c4, 0xf0e2a8, 0xdfe7ea, 0xe8cfc0],
};

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export interface BuildingMeshes {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  /** 0 = day, 1 = night (window lights) */
  setNight(v: number): void;
}

export function buildBuildings(city: CityData): BuildingMeshes {
  const chunks = new Map<string, MeshBuilder>();
  const getMb = (x: number, z: number) => {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let mb = chunks.get(k);
    if (!mb) chunks.set(k, (mb = new MeshBuilder(true, { aWall: 3, aSeed: 2 })));
    return mb;
  };

  const wallCol = new THREE.Color();
  const roofCol = new THREE.Color();
  city.buildings.forEach((b, i) => addBuilding(b, i));

  function addBuilding(b: Building, i: number) {
    const style = BUILDING_STYLES[b.s];
    const r0 = hash(i + 0.13), r1 = hash(i + 7.7), r2 = hash(i + 3.3);
    const pal = style === 'plain' && r0 < 0.25 ? PALETTES.pastel : PALETTES[style];
    wallCol.setHex(pal[Math.floor(r1 * pal.length)]);
    wallCol.offsetHSL(0, 0, (r2 - 0.5) * 0.06);
    if (style === 'house' && r2 < 0.6) roofCol.setHex(0xa4553a).offsetHSL(0, 0, (r0 - 0.5) * 0.08);
    else roofCol.setHex(0x8f8b83).offsetHSL(0, 0, (r1 - 0.5) * 0.1);

    let cx = 0, cz = 0;
    const n = b.p.length / 2;
    for (let k = 0; k < n; k++) { cx += b.p[k * 2]; cz += b.p[k * 2 + 1]; }
    cx /= n; cz /= n;
    const mb = getMb(cx, cz);
    const seed = [hash(i * 1.37), b.s];
    for (const ring of [b.p, ...(b.holes ?? [])]) walls(mb, ring, b.h, wallCol, seed);
    roof(mb, b.p, b.holes, b.h, roofCol, seed);
  }

  function walls(mb: MeshBuilder, ring: Flat, h: number, c: THREE.Color, seed: number[]) {
    const n = ring.length / 2;
    let u = 0;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      // outward normal for a positive-area ring is (dz, -dx); holes are stored negative, so the same formula points into the courtyard
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const y0 = -0.3;
      const a0 = mb.vert(ax, y0, az, nx, 0, nz, c, { aWall: [u, y0, 1], aSeed: seed });
      const b0 = mb.vert(bx, y0, bz, nx, 0, nz, c, { aWall: [u + L, y0, 1], aSeed: seed });
      const b1 = mb.vert(bx, h, bz, nx, 0, nz, c, { aWall: [u + L, h, 1], aSeed: seed });
      const a1 = mb.vert(ax, h, az, nx, 0, nz, c, { aWall: [u, h, 1], aSeed: seed });
      mb.triFacing(a0, b0, b1, nx, 0, nz);
      mb.triFacing(a0, b1, a1, nx, 0, nz);
      u += L;
    }
  }

  function roof(mb: MeshBuilder, outer: Flat, holes: Flat[] | undefined, h: number, c: THREE.Color, seed: number[]) {
    const toV = (f: Flat) => {
      const v: THREE.Vector2[] = [];
      for (let k = 0; k < f.length; k += 2) v.push(new THREE.Vector2(f[k], f[k + 1]));
      return v;
    };
    const contour = toV(outer);
    const hs = (holes ?? []).map(toV);
    let tris: number[][];
    try { tris = THREE.ShapeUtils.triangulateShape(contour, hs); } catch { return; }
    const base = mb.count;
    for (const v of [contour, ...hs].flat()) mb.vert(v.x, h, v.y, 0, 1, 0, c, { aWall: [v.x, v.y, 0], aSeed: seed });
    for (const t of tris) mb.triFacing(base + t[0], base + t[1], base + t[2], 0, 1, 0);
  }

  const uNight = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aWall; attribute vec2 aSeed;
        varying vec3 vWall; varying vec2 vSeed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWall = aWall; vSeed = aSeed;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vWall; varying vec2 vSeed;
        float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec3 hsv(float h, float s, float v) {
          vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return v * mix(vec3(1.0), k, s);
        }
        float gWin; float gLit; float gGlass;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        gWin = 0.0; gLit = 0.0; gGlass = 0.0;
        if (vWall.z > 0.5) {
          float style = vSeed.y; // 0 plain, 1 glass, 2 colonial, 3 house
          float floorH = style > 0.5 && style < 1.5 ? 3.6 : 3.4;
          float bayW = style > 1.5 && style < 2.5 ? 3.2 : style > 2.5 ? 4.2 : 2.9;
          vec2 cell = vec2(vWall.x / bayW, vWall.y / floorH);
          vec2 f = fract(cell);
          float upper = step(1.0, cell.y);
          float r = h21(floor(cell) + vSeed.x * 91.0);
          if (style > 0.5 && style < 1.5) {
            // glass curtain wall: thin mullions and slab edges
            gWin = step(0.06, f.x) * step(f.x, 0.94) * step(0.14, f.y) * step(f.y, 0.96);
            gGlass = 1.0;
          } else if (style > 1.5 && style < 2.5) {
            // colonial: tall narrow windows with arched-looking tops
            float arch = step(length(vec2((f.x - 0.5) * 2.4, max(f.y - 0.7, 0.0) * 3.4)), 0.42);
            gWin = step(0.3, f.x) * step(f.x, 0.7) * step(0.18, f.y) * step(f.y, 0.7) + arch * step(0.7, f.y);
            gWin = min(gWin, 1.0) * step(0.5, cell.y);
          } else if (style > 2.5) {
            gWin = step(0.3, f.x) * step(f.x, 0.62) * step(0.32, f.y) * step(f.y, 0.75) * step(0.35, r + 0.3);
          } else {
            gWin = step(0.16, f.x) * step(f.x, 0.84) * step(0.3, f.y) * step(f.y, 0.82) * upper;
            // ground floor: shopfront + coloured signboard
            if (vWall.y < 3.4 && vWall.y > -0.2) {
              float bay = floor(vWall.x / 5.5);
              float sr = h21(vec2(bay, vSeed.x * 37.0));
              float sign = step(2.55, vWall.y) * step(vWall.y, 3.3);
              vec3 signCol = hsv(sr, 0.65, 0.85);
              if (sr < 0.15) signCol = vec3(0.92);
              float shutter = 0.55 + 0.1 * step(0.5, fract(vWall.y * 6.0));
              vec3 shop = mix(diffuseColor.rgb * 0.45, vec3(0.32, 0.33, 0.35) * shutter, step(0.45, sr));
              diffuseColor.rgb = mix(shop, signCol, sign);
              gLit = sign * 0.6 * uNight;
            }
          }
          vec3 glassCol = mix(vec3(0.10, 0.14, 0.18), vec3(0.32, 0.42, 0.5), r * 0.6);
          if (gGlass > 0.5) glassCol = mix(vec3(0.18, 0.28, 0.34), vec3(0.42, 0.55, 0.62), r * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, gWin);
          gLit = max(gLit, gWin * step(0.58, r) * uNight);
          // slight grime toward the ground and AO at the base
          diffuseColor.rgb *= mix(0.78, 1.0, smoothstep(-0.3, 2.0, vWall.y));
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, gWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.3, gWin * gGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gLit * vec3(1.0, 0.72, 0.42) * 0.75;`);
  };

  const group = new THREE.Group();
  group.name = 'buildings';
  for (const mb of chunks.values()) {
    const m = new THREE.Mesh(mb.build(), material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return { group, material, setNight: (v) => (uNight.value = v) };
}
