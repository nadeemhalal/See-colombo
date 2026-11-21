import * as THREE from 'three';
import { addLampLight } from '../world/lamplight';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Pedestrians: one merged, indexed geometry per body type (adult, child), drawn with InstancedMesh.
// Every outfit, hairstyle, hat and accessory is built into the geometry; each person shows only
// their own (the vertex shader collapses the rest to a point), so the whole crowd is two draw calls.
//
// Per vertex, aPart = (colour slot, limb, joint, option):
//   slot:   0 fixed colour (vertex colour), 1 skin, 2 top, 3 lower, 4 hair, 5 accent, 6 shoes
//   limb:   0 body, 1 left leg, 2 right leg, 3 left arm, 4 right arm
//   joint:  0 upper segment (thigh, upper arm), 1 lower segment (shin and foot, forearm and hand)
//   option: group * 256 + mask. Group 0 is always shown. For the style groups (lower, top, hair,
//           head) the part shows when bit <style> of mask is set; for accessories mask is the bit.
// Per instance: aOpt = styles (lower, top, hair, head), aAcc = accessory bits, aColA / aColB =
// palette indices (skin, top, lower, hair / accent, shoes) plus figure and stoop, aAnim = pose.
// Local forward is +Z, the person's left is +X, feet at y = 0, top of the head about 1.73 m.

export const LOWER = { trousers: 0, shorts: 1, sarong: 2, longSkirt: 3, kneeDress: 4 } as const;
export const TOP = { tshirt: 0, shirt: 1, hoodie: 2, saree: 3, vest: 4 } as const;
export const HAIR = { none: 0, short: 1, long: 2, bun: 3, ponytail: 4, curly: 5, bob: 6, buzz: 7 } as const;
export const HEAD = { none: 0, cap: 1, sunhat: 2, hijab: 3 } as const;
export const ACC = { backpack: 1, shoulderBag: 2, camera: 4, phone: 8, umbrella: 16, sunglasses: 32, shoppingBag: 64 } as const;

const G_LOWER = 1, G_TOP = 2, G_HAIR = 3, G_HEAD = 4, G_ACC = 5;
const S_FIXED = 0, S_SKIN = 1, S_TOP = 2, S_LOWER = 3, S_HAIR = 4, S_ACCENT = 5, S_SHOE = 6;

const HIP_Y = 0.9, KNEE_Y = 0.48, SHOULDER_Y = 1.4, ELBOW_Y = 1.125;

type Part = THREE.BufferGeometry;
const bits = (...b: number[]) => b.reduce((m, v) => m | (1 << v), 0);

interface PartOpts { slot: number; limb?: number; joint?: number; group?: number; mask?: number; hex?: number }
function part(g: Part, o: PartOpts): Part {
  g.deleteAttribute('uv');
  if (!g.index) g = mergeVertices(g);
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(o.hex ?? 0xffffff);
  const col = new Float32Array(n * 3);
  const info = new Float32Array(n * 4);
  const opt = (o.group ?? 0) * 256 + (o.mask ?? 0);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    info[i * 4] = o.slot; info[i * 4 + 1] = o.limb ?? 0; info[i * 4 + 2] = o.joint ?? 0; info[i * 4 + 3] = opt;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(info, 4));
  return g;
}

/** vertical capsule spanning y0..y1 */
const seg = (r: number, y0: number, y1: number, x: number, z = 0, radial = 7) =>
  new THREE.CapsuleGeometry(r, Math.max(0.002, y1 - y0 - 2 * r), 2, radial).translate(x, (y0 + y1) / 2, z);
const ball = (r: number, x: number, y: number, z: number, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h).translate(x, y, z);
const ellipsoid = (sx: number, sy: number, sz: number, x: number, y: number, z: number, w = 10, h = 7) =>
  new THREE.SphereGeometry(1, w, h).scale(sx, sy, sz).translate(x, y, z);
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
/** open, slightly flattened tube from y0 to y1 (skirts) */
const tube = (rTop: number, rBot: number, y0: number, y1: number) =>
  new THREE.CylinderGeometry(rTop, rBot, y1 - y0, 14, 1, true).translate(0, (y0 + y1) / 2, 0).scale(1, 1, 0.8);

function build(kid: boolean): THREE.BufferGeometry {
  const parts: Part[] = [];
  const add = (g: Part, o: PartOpts) => parts.push(part(g, o));
  // children: a bigger head for the body (the instance scale makes them small)
  const headScale = kid ? 1.3 : 1;
  const head = (g: Part, o: PartOpts) => add(g.translate(0, -1.5, 0).scale(headScale, headScale, headScale).translate(0, 1.5, 0), o);

  // ---- legs: thigh swings from the hip, shin and foot bend at the knee
  for (const [s, limb] of [[1, 1], [-1, 2]] as const) {
    const x = 0.095 * s;
    add(seg(0.07, 0.46, 0.93, x), { slot: S_SKIN, limb, joint: 0 });
    add(seg(0.054, 0.07, 0.5, x), { slot: S_SKIN, limb, joint: 1 });
    add(new THREE.CapsuleGeometry(0.046, 0.15, 2, 7).rotateX(Math.PI / 2).scale(1.05, 0.8, 1).translate(x, 0.045, 0.045), { slot: S_SHOE, limb, joint: 1 });
    // long trousers or jeans over the leg, shorts to above the knee
    add(seg(0.083, 0.45, 0.95, x), { slot: S_LOWER, limb, joint: 0, group: G_LOWER, mask: bits(LOWER.trousers) });
    add(seg(0.066, 0.1, 0.51, x), { slot: S_LOWER, limb, joint: 1, group: G_LOWER, mask: bits(LOWER.trousers) });
    add(seg(0.09, 0.6, 0.95, x), { slot: S_LOWER, limb, joint: 0, group: G_LOWER, mask: bits(LOWER.shorts) });
  }
  // hips, and the skirts that hang from them
  add(ellipsoid(0.17, 0.13, 0.112, 0, 0.93, 0), { slot: S_LOWER });
  add(tube(0.185, 0.205, 0.14, 0.99), { slot: S_LOWER, group: G_LOWER, mask: bits(LOWER.sarong) });
  add(tube(0.185, 0.27, 0.05, 0.99), { slot: S_LOWER, group: G_LOWER, mask: bits(LOWER.longSkirt) });
  add(tube(0.185, 0.25, 0.47, 0.99), { slot: S_LOWER, group: G_LOWER, mask: bits(LOWER.kneeDress) });

  // ---- torso: shaped (hips, waist, chest, shoulders), flattened front to back
  const prof = [[0.1, 0.94], [0.15, 0.97], [0.158, 1.01], [0.155, 1.06], [0.15, 1.12], [0.164, 1.23], [0.172, 1.31], [0.162, 1.38], [0.12, 1.435], [0.05, 1.47]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(prof, 12).scale(1, 1, 0.62), { slot: S_TOP });
  // shirt collar, hoodie hood, saree drape (osariya) across the body and the pallu down the back
  add(box(0.13, 0.03, 0.07, 0, 1.455, 0.055), { slot: S_TOP, group: G_TOP, mask: bits(TOP.shirt) });
  add(new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.13, 0.08, 0.11).translate(0, 1.43, -0.085), { slot: S_TOP, group: G_TOP, mask: bits(TOP.hoodie) });
  add(new THREE.BoxGeometry(0.12, 0.62, 0.236).rotateZ(-0.6).translate(0, 1.2, 0), { slot: S_LOWER, group: G_TOP, mask: bits(TOP.saree) });
  add(box(0.17, 0.5, 0.02, 0.085, 1.17, -0.118), { slot: S_LOWER, group: G_TOP, mask: bits(TOP.saree) });
  add(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 8).translate(0, 1.5, 0), { slot: S_SKIN });

  // ---- head and face
  head(ellipsoid(0.093, 0.113, 0.103, 0, 1.615, 0.005, 12, 9), { slot: S_SKIN });
  head(box(0.022, 0.036, 0.03, 0, 1.6, 0.105), { slot: S_SKIN }); // nose
  for (const s of [1, -1]) {
    head(new THREE.SphereGeometry(0.022, 6, 5).scale(0.5, 1, 0.8).translate(0.093 * s, 1.61, 0), { slot: S_SKIN }); // ears
    head(ball(0.012, 0.034 * s, 1.632, 0.094, 6, 4), { slot: S_FIXED, hex: 0x1a1210 }); // eyes
    head(box(0.032, 0.008, 0.01, 0.034 * s, 1.656, 0.099), { slot: S_HAIR }); // brows
  }
  head(box(0.036, 0.007, 0.01, 0, 1.571, 0.099), { slot: S_FIXED, hex: 0x5a2e2a }); // mouth

  // ---- hair
  const capped = bits(HAIR.short, HAIR.long, HAIR.bun, HAIR.ponytail, HAIR.bob);
  head(new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.1, 0.125, 0.112).rotateX(-0.3).translate(0, 1.625, -0.005),
    { slot: S_HAIR, group: G_HAIR, mask: capped });
  head(new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.096, 0.117, 0.106).rotateX(-0.3).translate(0, 1.622, 0),
    { slot: S_HAIR, group: G_HAIR, mask: bits(HAIR.buzz) });
  head(box(0.19, 0.3, 0.05, 0, 1.5, -0.088), { slot: S_HAIR, group: G_HAIR, mask: bits(HAIR.long) });
  head(new THREE.CylinderGeometry(0.112, 0.118, 0.15, 12, 1, true, Math.PI * 0.3, Math.PI * 1.4).translate(0, 1.565, -0.005),
    { slot: S_HAIR, group: G_HAIR, mask: bits(HAIR.bob) });
  head(ball(0.056, 0, 1.665, -0.105), { slot: S_HAIR, group: G_HAIR, mask: bits(HAIR.bun) });
  head(seg(0.035, 1.4, 1.62, 0, -0.12), { slot: S_HAIR, group: G_HAIR, mask: bits(HAIR.ponytail) });
  head(new THREE.IcosahedronGeometry(1, 1).scale(0.118, 0.108, 0.122).translate(0, 1.66, -0.015), { slot: S_HAIR, group: G_HAIR, mask: bits(HAIR.curly) });

  // ---- headwear
  head(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.106, 0.085, 0.113).translate(0, 1.66, 0), { slot: S_ACCENT, group: G_HEAD, mask: bits(HEAD.cap) });
  head(new THREE.BoxGeometry(0.15, 0.012, 0.1).rotateX(0.12).translate(0, 1.665, 0.125), { slot: S_ACCENT, group: G_HEAD, mask: bits(HEAD.cap) });
  head(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.11, 0.095, 0.115).translate(0, 1.665, 0), { slot: S_ACCENT, group: G_HEAD, mask: bits(HEAD.sunhat) });
  head(new THREE.CylinderGeometry(0.24, 0.24, 0.012, 16).translate(0, 1.672, 0), { slot: S_ACCENT, group: G_HEAD, mask: bits(HEAD.sunhat) });
  head(new THREE.SphereGeometry(1, 14, 9, Math.PI / 2 + 0.7, Math.PI * 2 - 1.4).scale(0.108, 0.128, 0.118).translate(0, 1.615, -0.004), { slot: S_ACCENT, group: G_HEAD, mask: bits(HEAD.hijab) });
  head(new THREE.CylinderGeometry(0.1, 0.235, 0.21, 14, 1, true).scale(1, 1, 0.85).translate(0, 1.44, 0), { slot: S_ACCENT, group: G_HEAD, mask: bits(HEAD.hijab) });
  head(box(0.155, 0.03, 0.025, 0, 1.633, 0.1), { slot: S_FIXED, hex: 0x111214, group: G_ACC, mask: ACC.sunglasses });

  // ---- arms: upper arm swings from the shoulder, forearm and hand bend at the elbow
  for (const [s, limb] of [[1, 3], [-1, 4]] as const) {
    const x = 0.215 * s;
    add(ball(0.054, 0.195 * s, 1.395, 0), { slot: S_TOP, limb, group: G_TOP, mask: bits(TOP.tshirt, TOP.shirt, TOP.hoodie, TOP.saree) });
    add(ball(0.05, 0.195 * s, 1.395, 0), { slot: S_SKIN, limb, group: G_TOP, mask: bits(TOP.vest) });
    add(seg(0.046, 1.115, 1.42, x), { slot: S_SKIN, limb, joint: 0 });
    add(seg(0.04, 0.87, 1.135, x), { slot: S_SKIN, limb, joint: 1 });
    add(new THREE.SphereGeometry(0.044, 7, 5).scale(0.75, 1.15, 0.95).translate(x, 0.83, 0.005), { slot: S_SKIN, limb, joint: 1 });
    add(seg(0.058, 1.24, 1.44, x), { slot: S_TOP, limb, joint: 0, group: G_TOP, mask: bits(TOP.tshirt, TOP.saree) });
    add(seg(0.056, 1.1, 1.44, x), { slot: S_TOP, limb, joint: 0, group: G_TOP, mask: bits(TOP.shirt, TOP.hoodie) });
    add(seg(0.049, 0.9, 1.14, x), { slot: S_TOP, limb, joint: 1, group: G_TOP, mask: bits(TOP.shirt, TOP.hoodie) });
  }

  // ---- accessories
  add(box(0.27, 0.33, 0.12, 0, 1.2, -0.158), { slot: S_ACCENT, group: G_ACC, mask: ACC.backpack });
  for (const s of [1, -1]) add(box(0.035, 0.3, 0.012, 0.09 * s, 1.27, 0.112), { slot: S_ACCENT, group: G_ACC, mask: ACC.backpack });
  add(box(0.2, 0.17, 0.07, 0.17, 0.97, -0.085), { slot: S_ACCENT, group: G_ACC, mask: ACC.shoulderBag });
  add(new THREE.BoxGeometry(0.03, 0.66, 0.006).rotateZ(0.6).translate(0.01, 1.2, 0.112), { slot: S_ACCENT, group: G_ACC, mask: ACC.shoulderBag });
  add(box(0.11, 0.075, 0.05, 0, 1.2, 0.135), { slot: S_FIXED, hex: 0x18181a, group: G_ACC, mask: ACC.camera });
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.04, 8).rotateX(Math.PI / 2).translate(0, 1.2, 0.175), { slot: S_FIXED, hex: 0x2a2a2e, group: G_ACC, mask: ACC.camera });
  // held in the right hand (the shader raises that forearm when these are carried)
  add(box(0.036, 0.072, 0.009, -0.215, 0.81, 0.03), { slot: S_FIXED, hex: 0x101014, limb: 4, joint: 1, group: G_ACC, mask: ACC.phone });
  // umbrella: built pointing down from the hand; the raised forearm turns it upright
  add(new THREE.CylinderGeometry(0.008, 0.008, 0.8, 4).translate(-0.215, 0.43, 0.01), { slot: S_FIXED, hex: 0x222222, limb: 4, joint: 1, group: G_ACC, mask: ACC.umbrella });
  add(new THREE.ConeGeometry(0.5, 0.2, 12).rotateX(Math.PI).translate(-0.215, 0.13, 0.01), { slot: S_ACCENT, limb: 4, joint: 1, group: G_ACC, mask: ACC.umbrella });
  add(box(0.17, 0.22, 0.08, 0.215, 0.69, 0), { slot: S_FIXED, hex: 0xf1ece0, limb: 3, joint: 1, group: G_ACC, mask: ACC.shoppingBag });

  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  return g;
}

const INJECT_DECL = /* glsl */ `
attribute vec4 aPart;
attribute vec4 aAnim; // phase, swing amplitude, upper-body bend, arm reach
attribute vec4 aOpt;  // styles: lower, top, hair, head
attribute vec4 aColA; // palette: skin, top, lower, hair
attribute vec4 aColB; // palette: accent, shoes; figure (0 male .. 1 female); stoop
attribute float aAcc; // accessory bits
float pBit(float v, float b) { return mod(floor(v / exp2(b)), 2.0); }
vec3 pRot(vec3 p, float py, float a) { float c = cos(a), s = sin(a); float y = p.y - py; return vec3(p.x, py + y * c - p.z * s, y * s + p.z * c); }
vec3 nRot(vec3 n, float a) { float c = cos(a), s = sin(a); return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c); }
void pose(inout vec3 p, inout vec3 n) {
  float grp = floor(aPart.w / 256.0), msk = mod(aPart.w, 256.0);
  float show = 1.0;
  if (grp > 0.5) {
    if (grp < 4.5) show = pBit(msk, grp < 1.5 ? aOpt.x : grp < 2.5 ? aOpt.y : grp < 3.5 ? aOpt.z : aOpt.w);
    else show = mod(floor(aAcc / msk), 2.0);
  }
  if (show < 0.5) { p = vec3(0.0); return; }
  float limb = aPart.y, joint = aPart.z;
  // figure: fuller hips and a narrower waist and shoulders for women
  if (limb < 0.5 && aColB.z > 0.0) {
    float y = p.y;
    p.x *= 1.0 + aColB.z * (0.11 * exp(-pow((y - 0.95) / 0.07, 2.0)) - 0.08 * exp(-pow((y - 1.11) / 0.06, 2.0)) - 0.06 * smoothstep(1.3, 1.42, y));
  }
  float ph = aAnim.x, amp = aAnim.y;
  float sw = sin(ph) * amp;
  if (limb > 0.5 && limb < 2.5) {
    float dir = limb < 1.5 ? 1.0 : -1.0;
    // shorter steps in a sarong or long skirt
    float skirt = (aOpt.x > 1.5 && aOpt.x < 3.5) ? 0.65 : 1.0;
    if (joint > 0.5) {
      // the knee bends most while the leg swings forward
      float knee = amp * (0.1 + 0.95 * max(0.0, -cos(ph) * dir)) * skirt;
      p = pRot(p, ${KNEE_Y.toFixed(3)}, knee); n = nRot(n, knee);
    }
    float a = sw * dir * skirt;
    p = pRot(p, ${HIP_Y.toFixed(3)}, a); n = nRot(n, a);
  } else if (limb > 2.5) {
    float dir = limb > 3.5 ? 1.0 : -1.0;
    float sh = sw * dir * 0.8 - aAnim.w;
    float el = -(0.2 + 0.45 * amp);
    if (limb > 3.5) {
      // right hand holds an umbrella up, or a phone in front
      if (mod(floor(aAcc / 16.0), 2.0) > 0.5) { sh = -0.55; el = -2.45; }
      else if (mod(floor(aAcc / 8.0), 2.0) > 0.5) { sh = -0.12 + sw * 0.05; el = -1.45; }
    }
    if (joint > 0.5) { p = pRot(p, ${ELBOW_Y.toFixed(3)}, el); n = nRot(n, el); }
    p = pRot(p, ${SHOULDER_Y.toFixed(3)}, sh); n = nRot(n, sh);
  }
  // bend the upper body about the hips: getting up, and older people's stoop (skirts stay put)
  float bend = aAnim.z + aColB.w;
  if (bend != 0.0 && grp != 1.0 && (limb > 2.5 || (limb < 0.5 && p.y > ${(HIP_Y - 0.05).toFixed(3)}))) {
    p = pRot(p, ${HIP_Y.toFixed(3)}, bend); n = nRot(n, bend);
  }
  p.y += abs(cos(ph)) * 0.035 * min(amp, 1.0);
}
`;

function inject(shader: THREE.WebGLProgramParametersWithUniforms, colours: boolean, palette?: { value: THREE.Texture }) {
  shader.vertexShader = INJECT_DECL + shader.vertexShader;
  if (colours) {
    shader.uniforms.uPal = palette!;
    shader.vertexShader = 'uniform sampler2D uPal;\n' + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 posed = position;
        pose(posed, objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = posed;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        {
          float sl = aPart.x;
          if (sl > 0.5) {
            float idx = sl < 1.5 ? aColA.x : sl < 2.5 ? aColA.y : sl < 3.5 ? aColA.z : sl < 4.5 ? aColA.w : sl < 5.5 ? aColB.x : aColB.y;
            vColor.rgb = texelFetch(uPal, ivec2(int(idx + 0.5), 0), 0).rgb;
          }
        }`);
  } else {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 nDummy = vec3(0.0, 1.0, 0.0); pose(transformed, nDummy); }`);
  }
}

/** palette: colours in a 256 x 1 float texture, looked up by the per-instance indices */
export function personMaterial(palette: THREE.DataTexture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
  const pal = { value: palette as THREE.Texture };
  m.onBeforeCompile = (s) => inject(s, true, pal);
  m.customProgramCacheKey = () => 'pedestrian-v2';
  addLampLight(m);
  return m;
}

export function personDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (s) => inject(s, false);
  m.customProgramCacheKey = () => 'pedestrian-depth-v2';
  return m;
}

const cache = new Map<boolean, THREE.BufferGeometry>();
/** a fresh copy per mesh (each mesh adds its own instance attributes) */
export function personGeometry(kid: boolean) {
  let g = cache.get(kid);
  if (!g) cache.set(kid, (g = build(kid)));
  return g.clone();
}
