import * as THREE from 'three';
import { addLampLight } from '../world/lamplight';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Pedestrians are single merged geometries drawn with InstancedMesh. Each vertex carries:
//   aSlot: 0 fixed colour (vertex colour), 1 skin, 2 top, 3 lower (per-instance colours)
//   aLimb: 0 body, 1 left leg, 2 right leg, 3 left arm, 4 right arm
// The walk cycle swings limbs in the vertex shader from a per-instance (phase, amplitude),
// so hundreds of people animate in three draw calls. Local forward is +Z, feet at y = 0.

const HIP_Y = 0.9;
const SHOULDER_Y = 1.4;
const HAIR = 0x15110e;
const SHOE = 0x2a211b;

type Part = THREE.BufferGeometry;

function tag(g: Part, slot: number, limb: number, hex = 0xffffff): Part {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aSlot', new THREE.BufferAttribute(new Float32Array(n).fill(slot), 1));
  g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  return g;
}
const capsule = (r: number, len: number, x: number, y: number, z: number, sx = 1, sz = 1) =>
  new THREE.CapsuleGeometry(r, len, 3, 8).scale(sx, 1, sz).translate(x, y, z);
const sphere = (r: number, x: number, y: number, z: number) => new THREE.SphereGeometry(r, 10, 8).translate(x, y, z);

export type PersonKind = 'trousers' | 'sarong' | 'dress';

function build(kind: PersonKind): THREE.BufferGeometry {
  const parts: Part[] = [];
  const skirt = kind !== 'trousers';
  // legs (with shoes / sandals), swinging from the hip
  for (const [side, limb] of [[1, 1], [-1, 2]] as const) {
    parts.push(tag(capsule(0.068, 0.72, 0.09 * side, 0.47, 0), skirt ? 1 : 3, limb));
    parts.push(tag(new THREE.BoxGeometry(0.1, 0.06, 0.24).translate(0.09 * side, 0.03, 0.04), 0, limb, SHOE));
  }
  if (skirt) {
    // sarong or long skirt: a slightly flared tube from waist to shin
    const len = kind === 'dress' ? 0.82 : 0.72;
    const g = new THREE.CylinderGeometry(0.19, kind === 'dress' ? 0.27 : 0.23, len, 12, 1, true);
    parts.push(tag(g.translate(0, HIP_Y + 0.05 - len / 2, 0).scale(1, 1, 0.82), 3, 0));
  } else {
    parts.push(tag(capsule(0.15, 0.06, 0, HIP_Y, 0, 1.2, 0.8), 3, 0)); // hips
  }
  // torso and head
  parts.push(tag(capsule(0.16, 0.34, 0, 1.2, 0, 1.25, 0.72), 2, 0));
  parts.push(tag(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8).translate(0, 1.47, 0), 1, 0));
  parts.push(tag(sphere(0.11, 0, 1.6, 0).scale(0.92, 1.05, 1), 1, 0));
  parts.push(tag(new THREE.SphereGeometry(0.118, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55).translate(0, 1.64, -0.012), 0, 0, HAIR));
  if (kind === 'dress') {
    parts.push(tag(sphere(0.065, 0, 1.6, -0.12), 0, 0, HAIR)); // hair bun
    // the shoulder drape of a saree (osariya style), in the skirt colour
    parts.push(tag(new THREE.BoxGeometry(0.1, 0.5, 0.3).rotateZ(0.5).translate(0.06, 1.25, 0), 3, 0));
  }
  // arms, swinging from the shoulder
  for (const [side, limb] of [[1, 3], [-1, 4]] as const) {
    parts.push(tag(capsule(0.06, 0.1, 0.24 * side, 1.3, 0), 2, limb)); // sleeve
    parts.push(tag(capsule(0.045, 0.5, 0.25 * side, 1.08, 0.01), 1, limb));
  }
  const g = mergeGeometries(parts)!;
  g.computeBoundingSphere();
  return g;
}

export const PERSON_KINDS: { kind: PersonKind; weight: number; tops: number[]; lowers: number[] }[] = [
  { kind: 'trousers', weight: 0.47,
    tops: [0xf2f0ea, 0xf2f0ea, 0x9cc3e4, 0x7a1f2b, 0x2f6d4a, 0xe0b44a, 0x40506b, 0xd9d2c0, 0x1f1f22],
    lowers: [0x2f3542, 0x23262c, 0x4b4f57, 0x8a7a5c, 0x1f2a44, 0x3a4a6b] },
  { kind: 'sarong', weight: 0.15,
    tops: [0xf2f0ea, 0xe8e3d6, 0x6f8fb0, 0x7d6b55],
    lowers: [0x2c4a7a, 0x3b5e3a, 0x6b3a2a, 0x4a3b6b, 0x7a6a3a, 0x24456a] },
  { kind: 'dress', weight: 0.38,
    tops: [0xf2f0ea, 0xc8326a, 0xe0b44a, 0x2f6d4a, 0x5a7bd6, 0xe07a3a, 0x8e3a8e],
    lowers: [0xc8326a, 0x2f6d4a, 0x7a1f2b, 0x3a5ab0, 0xe0a030, 0x8e3a8e, 0x1b6b6b, 0xd65a5a] },
];

export const SKIN_TONES = [0x5c3b27, 0x6e4630, 0x7c5136, 0x8a5a3c, 0x9a6a48, 0x6a4430];

const INJECT_DECL = /* glsl */ `
attribute float aSlot;
attribute float aLimb;
attribute vec4 aAnim; // phase, swing amplitude, torso bend about the hips, arm reach
attribute vec3 aSkin;
attribute vec3 aTop;
attribute vec3 aLower;
`;
const INJECT_POSE = /* glsl */ `
#include <begin_vertex>
{
  float sw = sin(aAnim.x) * aAnim.y;
  transformed.y += abs(cos(aAnim.x)) * 0.035 * min(aAnim.y, 1.0);
  if (aLimb > 0.5) {
    bool leg = aLimb < 2.5;
    float piv = leg ? ${HIP_Y.toFixed(2)} : ${SHOULDER_Y.toFixed(2)};
    float dir = (aLimb < 1.5 || aLimb > 3.5) ? 1.0 : -1.0;
    float ang = sw * dir * (leg ? 1.0 : 0.8);
    float c = cos(ang), s = sin(ang);
    float y = transformed.y - piv, z = transformed.z;
    transformed.y = piv + y * c - z * s;
    transformed.z = y * s + z * c;
  }
  // arms reach forward (getting up: hands to the knees, pushing off the ground)
  if (aLimb > 2.5 && aAnim.w != 0.0) {
    float c = cos(-aAnim.w), s = sin(-aAnim.w);
    float y = transformed.y - ${SHOULDER_Y.toFixed(2)}, z = transformed.z;
    transformed.y = ${SHOULDER_Y.toFixed(2)} + y * c - z * s;
    transformed.z = y * s + z * c;
  }
  // bend the upper body (torso, head, arms) about the hips, for sitting up and rising
  if (aAnim.z != 0.0 && (aLimb > 2.5 || (aLimb < 0.5 && transformed.y > ${(HIP_Y - 0.05).toFixed(2)}))) {
    float c = cos(aAnim.z), s = sin(aAnim.z);
    float y = transformed.y - ${HIP_Y.toFixed(2)}, z = transformed.z;
    transformed.y = ${HIP_Y.toFixed(2)} + y * c - z * s;
    transformed.z = y * s + z * c;
  }
}
`;

function inject(shader: THREE.WebGLProgramParametersWithUniforms, colours: boolean) {
  shader.vertexShader = INJECT_DECL + shader.vertexShader.replace('#include <begin_vertex>', INJECT_POSE);
  if (colours) {
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      if (aSlot > 0.5) vColor.rgb = aSlot < 1.5 ? aSkin : (aSlot < 2.5 ? aTop : aLower);`);
  }
}

export function personMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  m.onBeforeCompile = (s) => inject(s, true);
  m.customProgramCacheKey = () => 'pedestrian';
  addLampLight(m);
  return m;
}

export function personDepthMaterial(): THREE.MeshDepthMaterial {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = (s) => inject(s, false);
  m.customProgramCacheKey = () => 'pedestrian-depth';
  return m;
}

const cache = new Map<PersonKind, THREE.BufferGeometry>();
export function personGeometry(kind: PersonKind) {
  let g = cache.get(kind);
  if (!g) cache.set(kind, (g = build(kind)));
  return g;
}
