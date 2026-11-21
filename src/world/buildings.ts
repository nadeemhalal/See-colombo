import * as THREE from 'three';
import { addLampLight } from './lamplight';
import type { Building, CityData, Flat } from '../types';
import { BUILDING_STYLES } from '../types';
import { MeshBuilder, chunkedInstances } from './geom';

const CHUNK = 400;

// Colombo street colours: whitewash and cream, sun-faded pastels, ochre, terracotta, mint and
// sky blue; colonial buildings in buff, cream and red brick.
const PALETTES: Record<string, number[]> = {
  plain: [0xeeeae0, 0xe9dfc4, 0xd8c7a0, 0xdcd6c8, 0xcfc9bd, 0xe6e0d2, 0xbfbcb4, 0xe4d6b6],
  pastel: [0xd9a95b, 0xc4734f, 0xe2a58f, 0xb9d8c2, 0x9fcfcf, 0xa9c6dd, 0xeedc8e, 0xc8b7d6, 0xe8b9a0, 0x9cc7a4],
  glass: [0x8fa3b3, 0x6f8494, 0xa9b6bf, 0x5d6f7c, 0x7f97a6, 0xb4bcc2],
  colonial: [0xefe6cf, 0xe3cf9f, 0xd2b07a, 0xf3eddc, 0xb8613f, 0xe8d8a8, 0xc9d6c4],
  house: [0xf2efe6, 0xe8dcc0, 0xd7e3d0, 0xe9d6c4, 0xf0e2a8, 0xdfe7ea, 0xe8cfc0, 0xb9d8c2, 0xe2a58f, 0xa9c6dd],
};
const TILE = [0xb5583b, 0xa64d33, 0xc0663f, 0x9c4a35];

// aWall.z tags what a vertex belongs to, for the shader:
// 0 flat roof / ledge, 1 facade, 2 parapet, 3 clay tile roof
const ROOF = 0, FACADE = 1, PARAPET = 2, TILES = 3;

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function area(p: Flat) {
  let a = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return Math.abs(a) / 2;
}
function inside(x: number, z: number, p: Flat) {
  let c = false;
  for (let i = 0, n = p.length / 2, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
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
  const ledgeCol = new THREE.Color();
  const tanks: { x: number; y: number; z: number; blue: boolean; s: number }[] = [];
  city.buildings.forEach((b, i) => addBuilding(b, i));

  function addBuilding(b: Building, i: number) {
    const style = BUILDING_STYLES[b.s];
    const r0 = hash(i + 0.13), r1 = hash(i + 7.7), r2 = hash(i + 3.3), r3 = hash(i + 5.1);
    const pastel = (style === 'plain' && r0 < 0.42) || (style === 'house' && r0 < 0.3);
    const pal = pastel ? PALETTES.pastel : PALETTES[style];
    wallCol.setHex(pal[Math.floor(r1 * pal.length)]);
    wallCol.offsetHSL(0, -0.03 * r2, (r2 - 0.5) * 0.07);
    roofCol.setHex(0x9a958c).offsetHSL(0, 0, (r1 - 0.5) * 0.12);
    ledgeCol.copy(wallCol).lerp(new THREE.Color(0xd8d4cc), 0.35);

    const n = b.p.length / 2;
    let cx = 0, cz = 0;
    for (let k = 0; k < n; k++) { cx += b.p[k * 2]; cz += b.p[k * 2 + 1]; }
    cx /= n; cz /= n;
    const mb = getMb(cx, cz);
    const seed = [hash(i * 1.37), b.s];
    const A = area(b.p);

    // small houses (and some low colonial buildings) get red clay tile hip roofs
    const hip = !b.holes?.length && n <= 12 && A < 360 && b.h < 11 &&
      (style === 'house' || (style === 'colonial' && r3 < 0.5) || (style === 'plain' && b.h < 7 && r3 < 0.35));
    for (const ring of [b.p, ...(b.holes ?? [])]) walls(mb, ring, b.h, wallCol, seed, !hip);
    if (hip) {
      roofCol.setHex(TILE[Math.floor(r2 * TILE.length)]).offsetHSL(0, 0, (r3 - 0.5) * 0.06);
      hipRoof(mb, b.p, b.h, cx, cz, A, roofCol, seed);
    } else {
      roof(mb, b.p, b.holes, b.h, roofCol, seed);
      // a water tank on the roof of most low and mid-rise buildings
      if (b.h < 32 && style !== 'glass' && r3 < 0.62) {
        for (let k = 0; k < n; k++) {
          const tx = cx + (b.p[k * 2] - cx) * 0.45, tz = cz + (b.p[k * 2 + 1] - cz) * 0.45;
          if (inside(tx, tz, b.p)) { tanks.push({ x: tx, y: b.h, z: tz, blue: r1 < 0.45, s: 0.8 + r2 * 0.5 }); break; }
        }
      }
    }
    // concrete sunshade ledges over each floor's windows, typical of Sri Lankan buildings
    if ((style === 'plain' || style === 'house') && b.h < 26 && b.h > 3.2) ledges(mb, b.p, b.h, ledgeCol, seed);
  }

  function walls(mb: MeshBuilder, ring: Flat, h: number, c: THREE.Color, seed: number[], parapet: boolean) {
    const n = ring.length / 2;
    let u = 0;
    const top = parapet ? h + 0.85 : h;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      // outward normal for a positive-area ring is (dz, -dx); holes are stored negative, so the same formula points into the courtyard
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      const quad = (y0: number, y1: number, tag: number, sx: number, sz: number) => {
        const a0 = mb.vert(ax, y0, az, sx, 0, sz, c, { aWall: [u, y0, tag], aSeed: seed });
        const b0 = mb.vert(bx, y0, bz, sx, 0, sz, c, { aWall: [u + L, y0, tag], aSeed: seed });
        const b1 = mb.vert(bx, y1, bz, sx, 0, sz, c, { aWall: [u + L, y1, tag], aSeed: seed });
        const a1 = mb.vert(ax, y1, az, sx, 0, sz, c, { aWall: [u, y1, tag], aSeed: seed });
        mb.triFacing(a0, b0, b1, sx, 0, sz);
        mb.triFacing(a0, b1, a1, sx, 0, sz);
      };
      quad(-0.3, h, FACADE, nx, nz);
      if (parapet) {
        quad(h, top, PARAPET, nx, nz); // outside
        quad(h, top, PARAPET, -nx, -nz); // inside face, seen from the roof
      }
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
    for (const v of [contour, ...hs].flat()) mb.vert(v.x, h, v.y, 0, 1, 0, c, { aWall: [v.x, v.y, ROOF], aSeed: seed });
    for (const t of tris) mb.triFacing(base + t[0], base + t[1], base + t[2], 0, 1, 0);
  }

  /** A hip roof: eaves overhanging the walls, sloping up to a small flat ridge area. */
  function hipRoof(mb: MeshBuilder, ring: Flat, h: number, cx: number, cz: number, A: number, c: THREE.Color, seed: number[]) {
    const n = ring.length / 2;
    const rise = THREE.MathUtils.clamp(Math.sqrt(A) * 0.17, 1.1, 2.5);
    const eave: number[] = [], top: number[] = [];
    for (let k = 0; k < n; k++) {
      const px = ring[k * 2], pz = ring[k * 2 + 1];
      const d = Math.hypot(px - cx, pz - cz) || 1;
      const s = 1 + 0.5 / d;
      eave.push(cx + (px - cx) * s, cz + (pz - cz) * s);
      top.push(cx + (px - cx) * 0.22, cz + (pz - cz) * 0.22);
    }
    const e = new THREE.Vector3(), f = new THREE.Vector3(), nrm = new THREE.Vector3();
    const yE = h - 0.15, yT = h + rise;
    for (let k = 0; k < n; k++) {
      const j = (k + 1) % n;
      const p0 = [eave[k * 2], yE, eave[k * 2 + 1]], p1 = [eave[j * 2], yE, eave[j * 2 + 1]];
      const p2 = [top[j * 2], yT, top[j * 2 + 1]], p3 = [top[k * 2], yT, top[k * 2 + 1]];
      e.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      f.set(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      nrm.crossVectors(e, f).normalize();
      if (nrm.y < 0) nrm.negate();
      if (!Number.isFinite(nrm.x)) continue;
      const v = (p: number[]) => mb.vert(p[0], p[1], p[2], nrm.x, nrm.y, nrm.z, c, { aWall: [p[0] + p[2], p[1], TILES], aSeed: seed });
      const a = v(p0), b = v(p1), cc = v(p2), d = v(p3);
      mb.triFacing(a, b, cc, nrm.x, nrm.y, nrm.z);
      mb.triFacing(a, cc, d, nrm.x, nrm.y, nrm.z);
      // underside of the eave, so the overhang isn't see-through from below
      const u0 = mb.vert(p0[0], yE, p0[2], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      const u1 = mb.vert(p1[0], yE, p1[2], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      const u2 = mb.vert(ring[j * 2], yE, ring[j * 2 + 1], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      const u3 = mb.vert(ring[k * 2], yE, ring[k * 2 + 1], 0, -1, 0, c, { aWall: [0, 0, ROOF], aSeed: seed });
      mb.triFacing(u0, u1, u2, 0, -1, 0);
      mb.triFacing(u0, u2, u3, 0, -1, 0);
    }
    const base = mb.count;
    for (let k = 0; k < n; k++) mb.vert(top[k * 2], yT, top[k * 2 + 1], 0, 1, 0, c, { aWall: [top[k * 2] + top[k * 2 + 1], yT, TILES], aSeed: seed });
    for (let k = 1; k < n - 1; k++) mb.triFacing(base, base + k, base + k + 1, 0, 1, 0);
  }

  function ledges(mb: MeshBuilder, ring: Flat, h: number, c: THREE.Color, seed: number[]) {
    const n = ring.length / 2;
    const D = 0.38, T = 0.1;
    for (let y = 3.0; y < h - 0.6; y += 3.4) {
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        const ax = ring[k * 2], az = ring[k * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 2.2) continue;
        const nx = (bz - az) / L, nz = -(bx - ax) / L;
        const ox = nx * D, oz = nz * D;
        const tag = { aWall: [0, 0, ROOF], aSeed: seed };
        // top
        let a = mb.vert(ax, y, az, 0, 1, 0, c, tag), b = mb.vert(bx, y, bz, 0, 1, 0, c, tag);
        let cc = mb.vert(bx + ox, y, bz + oz, 0, 1, 0, c, tag), d = mb.vert(ax + ox, y, az + oz, 0, 1, 0, c, tag);
        mb.triFacing(a, b, cc, 0, 1, 0); mb.triFacing(a, cc, d, 0, 1, 0);
        // front edge
        a = mb.vert(ax + ox, y - T, az + oz, nx, 0, nz, c, tag); b = mb.vert(bx + ox, y - T, bz + oz, nx, 0, nz, c, tag);
        cc = mb.vert(bx + ox, y, bz + oz, nx, 0, nz, c, tag); d = mb.vert(ax + ox, y, az + oz, nx, 0, nz, c, tag);
        mb.triFacing(a, b, cc, nx, 0, nz); mb.triFacing(a, cc, d, nx, 0, nz);
      }
    }
  }

  const uNight = { value: 0 };
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.0 });
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
        float vnoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
        }
        vec3 hsv(float h, float s, float v) {
          vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
          return v * mix(vec3(1.0), k, s);
        }
        float gWin; float gGlass; vec3 gLit;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        gWin = 0.0; gGlass = 0.0; gLit = vec3(0.0);
        float tag = vWall.z;
        // weathered plaster: broad blotches and fine grain
        float blotch = vnoise(vWall.xy * vec2(0.35, 0.5) + vSeed.x * 50.0);
        float grain = vnoise(vWall.xy * 6.0);
        if (tag > 2.5) {
          // clay tiles: rows of courses with staggered joints
          float row = vWall.y * 3.4;
          float course = smoothstep(0.0, 0.18, fract(row));
          float joint = step(0.07, fract(vWall.x * 4.0 + floor(row) * 0.5));
          diffuseColor.rgb *= (0.74 + 0.26 * course) * (0.9 + 0.1 * joint);
          diffuseColor.rgb *= 0.82 + 0.3 * blotch;
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.28, 0.27, 0.24), smoothstep(0.62, 0.9, vnoise(vWall.xy * 1.3 + 7.0)) * 0.35);
        } else if (tag < 0.5) {
          // concrete roofs and ledges: rain-stained
          diffuseColor.rgb *= 0.8 + 0.25 * blotch + 0.06 * grain;
        } else {
          diffuseColor.rgb *= 0.9 + 0.14 * blotch + 0.05 * grain;
        }
        if (tag > 0.5 && tag < 1.5) {
          float style = vSeed.y; // 0 plain, 1 glass, 2 colonial, 3 house
          float floorH = style > 0.5 && style < 1.5 ? 3.6 : 3.4;
          float bayW = style > 1.5 && style < 2.5 ? 3.2 : style > 2.5 ? 4.2 : 2.9;
          vec2 cell = vec2(vWall.x / bayW, vWall.y / floorH);
          vec2 f = fract(cell);
          float upper = step(1.0, cell.y);
          float r = h21(floor(cell) + vSeed.x * 91.0);
          float bldg = h21(vSeed.xx * 13.0);
          float frame = 0.0;
          vec3 frameCol = vec3(0.86, 0.85, 0.82);
          if (style > 0.5 && style < 1.5) {
            // glass curtain wall: thin mullions and slab edges
            gWin = step(0.06, f.x) * step(f.x, 0.94) * step(0.14, f.y) * step(f.y, 0.96);
            gGlass = 1.0;
          } else if (style > 1.5 && style < 2.5) {
            // colonial: tall windows with arched tops and green timber shutters
            float arch = step(length(vec2((f.x - 0.5) * 2.4, max(f.y - 0.7, 0.0) * 3.4)), 0.42);
            float win = min(step(0.3, f.x) * step(f.x, 0.7) * step(0.18, f.y) * step(f.y, 0.7) + arch * step(0.7, f.y), 1.0);
            float shutter = (step(0.17, f.x) * step(f.x, 0.29) + step(0.71, f.x) * step(f.x, 0.83)) * step(0.18, f.y) * step(f.y, 0.78);
            gWin = win * step(0.5, cell.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.36, 0.25) * (0.85 + 0.3 * step(0.5, fract(f.y * 14.0))), shutter * step(0.5, cell.y) * step(0.35, bldg));
            // cornice line at each floor
            diffuseColor.rgb *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, 0.05, f.y)) * step(0.5, cell.y);
          } else {
            float x0 = style > 2.5 ? 0.3 : 0.16, x1 = style > 2.5 ? 0.62 : 0.84, y0 = style > 2.5 ? 0.32 : 0.3, y1 = style > 2.5 ? 0.75 : 0.82;
            float inner = step(x0, f.x) * step(f.x, x1) * step(y0, f.y) * step(f.y, y1);
            float outer = step(x0 - 0.035, f.x) * step(f.x, x1 + 0.035) * step(y0 - 0.05, f.y) * step(f.y, y1 + 0.03);
            float on = style > 2.5 ? step(0.35, r + 0.3) : upper;
            gWin = inner * on;
            frame = (outer - inner) * on;
            // rust and mould streaks running down from the sills
            float streak = step(x0 + 0.05, f.x) * step(f.x, x1 - 0.05) * (1.0 - smoothstep(y0 - 0.4, y0, f.y)) * step(f.y, y0) * step(0.55, h21(floor(cell) + 3.0)) * on;
            diffuseColor.rgb *= 1.0 - 0.22 * streak * (0.5 + 0.5 * vnoise(vec2(vWall.x * 9.0, 0.0)));
            // window grilles on many Colombo buildings
            float grille = step(0.88, fract(f.x * 9.0)) * step(0.5, bldg);
            gWin *= 1.0 - grille * 0.8;
            frame = max(frame, inner * grille * on);
            if (style < 0.5 && vWall.y < 3.4 && vWall.y > -0.2) {
              // ground floor: open shopfronts or roller shutters under a painted signboard
              float bay = floor(vWall.x / 5.5);
              float bx = fract(vWall.x / 5.5);
              float sr = h21(vec2(bay, vSeed.x * 37.0));
              float sign = step(2.5, vWall.y) * step(vWall.y, 3.3);
              vec3 signCol = hsv(sr * 1.3, 0.7, 0.85);
              if (sr < 0.15) signCol = vec3(0.93);
              // painted lettering: blocky glyphs in a central band
              vec2 g = vec2(vWall.x * 4.5, (vWall.y - 2.5) * 7.0);
              float glyph = step(0.42, h21(floor(g) + bay * 7.0)) * step(0.18, fract(g.x)) * step(0.2, fract(g.y))
                * step(1.0, g.y) * step(g.y, 4.6) * step(0.12, bx) * step(bx, 0.88);
              vec3 ink = dot(signCol, vec3(0.33)) > 0.55 ? vec3(0.12, 0.1, 0.1) : vec3(0.97, 0.95, 0.88);
              signCol = mix(signCol, ink, glyph);
              float shut = 0.55 + 0.1 * step(0.5, fract(vWall.y * 6.0));
              vec3 shop = mix(diffuseColor.rgb * 0.35, vec3(0.34, 0.35, 0.37) * shut, step(0.5, sr));
              diffuseColor.rgb = mix(shop, signCol, sign);
              // lit signboards and bright shop interiors after dark
              gLit += sign * mix(signCol, vec3(1.0), 0.3) * 0.9 * uNight;
              gLit += (1.0 - sign) * step(sr, 0.5) * step(0.3, vWall.y) * vec3(1.0, 0.8, 0.55) * 0.35 * uNight;
            }
          }
          diffuseColor.rgb = mix(diffuseColor.rgb, frameCol * (0.85 + 0.15 * bldg), frame);
          vec3 glassCol = mix(vec3(0.1, 0.13, 0.16), vec3(0.3, 0.38, 0.44), r * 0.6);
          if (gGlass > 0.5) glassCol = mix(vec3(0.18, 0.28, 0.34), vec3(0.42, 0.55, 0.62), r * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, gWin);
          // night: some windows lit, warm bulbs or cool tube lights, at different brightness
          float lit = step(0.66, r);
          vec3 lamp = mix(vec3(1.0, 0.7, 0.4), vec3(0.85, 0.93, 1.0), step(0.62, h21(floor(cell) + 7.7)));
          gLit += gWin * lit * lamp * (0.3 + 0.7 * h21(floor(cell) + 3.1)) * 0.75 * uNight;
          // grime toward the ground
          diffuseColor.rgb *= mix(0.74, 1.0, smoothstep(-0.3, 2.2, vWall.y));
        } else if (tag > 1.5 && tag < 2.5) {
          // parapet: a lighter coping on top, stains below it
          diffuseColor.rgb *= 0.92;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.12, gWin);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, 0.3, gWin * gGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gLit;`);
  };
  addLampLight(material);

  const group = new THREE.Group();
  group.name = 'buildings';
  for (const mb of chunks.values()) {
    const m = new THREE.Mesh(mb.build(), material);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }

  // rooftop water tanks: black or blue plastic on a little stand
  if (tanks.length) {
    const tankGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.15, 8).translate(0, 1.0, 0);
    const standGeo = new THREE.BoxGeometry(1.4, 0.42, 1.4).translate(0, 0.21, 0);
    const tankMat = new THREE.MeshStandardMaterial({ roughness: 0.55 });
    const standMat = new THREE.MeshStandardMaterial({ color: 0x8c8880, roughness: 0.9 });
    const place = (t: (typeof tanks)[number], m4: THREE.Matrix4) => m4.makeScale(t.s, t.s, t.s).setPosition(t.x, t.y, t.z);
    const meshes = [
      ...chunkedInstances(tanks, tankGeo, tankMat, CHUNK, place, (t, c) => c.setHex(t.blue ? 0x2f6fb0 : 0x1d1f22)),
      ...chunkedInstances(tanks, standGeo, standMat, CHUNK, place),
    ];
    for (const m of meshes) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  }
  return { group, material, setNight: (v) => (uNight.value = v) };
}
