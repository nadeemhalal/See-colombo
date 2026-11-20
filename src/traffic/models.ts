import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Vehicles are single merged geometries with vertex colours. Parts coloured WHITE take the
// body colour (instance colour / material colour); everything else keeps its own colour.
// Local forward is +Z, origin on the ground at the centre.

const WHITE = 0xffffff;
const GLASS = 0x1d2a33;
const TYRE = 0x161616;
const DARK = 0x262626;
const CANVAS = 0x141414;
const SEAT = 0x3b2a20;
const HEAD = 0xfff3c4;
const TAIL = 0xb01212;
const CHROME = 0x9a9ea3;

type Part = THREE.BufferGeometry;

function col(g: Part, hex: number): Part {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  // 1 = headlight, 2 = tail light: these glow at night
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(hex === HEAD ? 1 : hex === TAIL ? 2 : 0), 1));
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}
const box = (w: number, h: number, l: number, x: number, y: number, z: number, hex: number, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, l);
  if (rx) g.rotateX(rx);
  return col(g.translate(x, y, z), hex);
};
const wheel = (r: number, w: number, x: number, z: number) => {
  const g = new THREE.CylinderGeometry(r, r, w, 12);
  g.rotateZ(Math.PI / 2);
  return col(g.translate(x, r, z), TYRE);
};
const disc = (r: number, x: number, y: number, z: number, hex: number, back = false) => {
  const g = new THREE.CylinderGeometry(r, r, 0.05, 10);
  g.rotateX(Math.PI / 2);
  return col(g.translate(x, y, back ? z - 0.02 : z + 0.02), hex);
};
function merge(parts: Part[]) {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Bajaj-style three-wheeler. Seat top for the driver is at y = 0.86, z = 0.32. */
export function tukTuk(): Part {
  const parts: Part[] = [
    box(1.18, 0.22, 2.35, 0, 0.42, -0.05, WHITE), // floor pan
    box(1.26, 0.5, 1.55, 0, 0.78, -0.45, WHITE), // rear body
    box(0.72, 0.8, 0.34, 0, 0.82, 1.08, WHITE), // front cowl
    box(0.5, 0.16, 0.5, 0, 0.6, 1.12, WHITE), // front mudguard
    box(1.14, 0.62, 0.05, 0, 1.4, 0.95, GLASS, -0.18), // windscreen
    box(1.32, 0.07, 2.0, 0, 1.88, 0.0, CANVAS), // canopy roof
    box(1.32, 0.95, 0.06, 0, 1.4, -1.0, CANVAS), // rear canvas
    box(0.04, 0.5, 1.25, 0.64, 1.6, -0.35, CANVAS), // side canvas
    box(0.04, 0.5, 1.25, -0.64, 1.6, -0.35, CANVAS),
    box(0.05, 1.0, 0.05, 0.6, 1.38, 0.92, DARK), // pillars
    box(0.05, 1.0, 0.05, -0.6, 1.38, 0.92, DARK),
    box(0.05, 0.9, 0.05, 0.6, 1.42, -0.98, DARK),
    box(0.05, 0.9, 0.05, -0.6, 1.42, -0.98, DARK),
    box(1.1, 0.3, 0.5, 0, 1.0, -0.62, SEAT), // passenger bench
    box(1.1, 0.5, 0.12, 0, 1.25, -0.88, SEAT), // bench back
    box(0.46, 0.12, 0.42, 0, 0.8, 0.32, SEAT), // driver seat
    box(0.7, 0.04, 0.04, 0, 1.12, 0.78, CHROME), // handlebar
    disc(0.09, 0, 1.05, 1.25, HEAD),
    disc(0.06, 0.5, 0.75, -1.24, TAIL, true),
    disc(0.06, -0.5, 0.75, -1.24, TAIL, true),
    wheel(0.24, 0.14, 0, 1.08),
    wheel(0.24, 0.14, 0.6, -0.72),
    wheel(0.24, 0.14, -0.6, -0.72),
  ];
  return merge(parts);
}

export function car(): Part {
  return merge([
    box(1.76, 0.62, 4.3, 0, 0.6, 0, WHITE),
    box(1.6, 0.58, 2.2, 0, 1.18, -0.25, WHITE),
    box(1.64, 0.36, 2.05, 0, 1.2, -0.25, GLASS),
    box(1.5, 0.4, 0.06, 0, 1.18, 0.88, GLASS, -0.6),
    disc(0.1, 0.62, 0.72, 2.15, HEAD), disc(0.1, -0.62, 0.72, 2.15, HEAD),
    disc(0.08, 0.66, 0.75, -2.15, TAIL, true), disc(0.08, -0.66, 0.75, -2.15, TAIL, true),
    wheel(0.32, 0.22, 0.8, 1.35), wheel(0.32, 0.22, -0.8, 1.35),
    wheel(0.32, 0.22, 0.8, -1.35), wheel(0.32, 0.22, -0.8, -1.35),
  ]);
}

/** Toyota HiAce-style van, the standard Colombo school/office van. */
export function van(): Part {
  return merge([
    box(1.76, 1.62, 4.7, 0, 1.08, 0, WHITE),
    box(1.78, 0.48, 3.5, 0, 1.48, -0.45, GLASS),
    box(1.6, 0.62, 0.05, 0, 1.45, 2.36, GLASS),
    box(1.74, 0.22, 0.1, 0, 0.42, 2.38, DARK),
    disc(0.11, 0.6, 0.72, 2.36, HEAD), disc(0.11, -0.6, 0.72, 2.36, HEAD),
    disc(0.09, 0.7, 0.8, -2.36, TAIL, true), disc(0.09, -0.7, 0.8, -2.36, TAIL, true),
    wheel(0.33, 0.22, 0.78, 1.55), wheel(0.33, 0.22, -0.78, 1.55),
    wheel(0.33, 0.22, 0.78, -1.5), wheel(0.33, 0.22, -0.78, -1.5),
  ]);
}

export function bus(): Part {
  return merge([
    box(2.5, 2.65, 11, 0, 1.72, 0, WHITE),
    box(2.52, 0.95, 9.4, 0, 2.3, -0.4, GLASS),
    box(2.3, 1.25, 0.05, 0, 2.2, 5.51, GLASS),
    box(2.52, 0.14, 11.02, 0, 1.38, 0, 0xf2f2f2), // side stripe
    box(1.8, 0.28, 0.06, 0, 2.95, 5.52, 0x111111), // destination board
    box(2.45, 0.3, 0.1, 0, 0.5, 5.52, DARK),
    disc(0.13, 0.95, 0.8, 5.52, HEAD), disc(0.13, -0.95, 0.8, 5.52, HEAD),
    disc(0.11, 1.0, 0.9, -5.52, TAIL, true), disc(0.11, -1.0, 0.9, -5.52, TAIL, true),
    wheel(0.5, 0.3, 1.1, 3.6), wheel(0.5, 0.3, -1.1, 3.6),
    wheel(0.5, 0.3, 1.1, -3.4), wheel(0.5, 0.3, -1.1, -3.4),
  ]);
}

/** Motorbike with a helmeted rider. */
export function moto(): Part {
  return merge([
    box(0.28, 0.35, 1.3, 0, 0.6, 0, WHITE),
    box(0.3, 0.12, 0.6, 0, 0.84, -0.2, SEAT),
    box(0.6, 0.04, 0.04, 0, 1.05, 0.55, CHROME),
    disc(0.07, 0, 0.85, 0.72, HEAD),
    wheel(0.3, 0.1, 0, 0.65), wheel(0.3, 0.1, 0, -0.65),
    box(0.4, 0.55, 0.26, 0, 1.25, -0.12, 0x4a5568, 0.2), // rider torso
    box(0.26, 0.26, 0.28, 0, 1.68, -0.05, 0x202020), // helmet
    box(0.32, 0.18, 0.5, 0, 0.9, 0.05, 0x2f3542), // thighs
  ]);
}

export interface VehicleType {
  name: string;
  geo: () => Part;
  len: number;
  width: number;
  maxSpeed: number;
  weight: number;
  colors: number[];
  majorOnly?: boolean;
}

export const VEHICLE_TYPES: VehicleType[] = [
  { name: 'tuktuk', geo: tukTuk, len: 2.6, width: 1.32, maxSpeed: 11, weight: 0.4,
    colors: [0xb3201e, 0x1f7a3a, 0x1b4f9c, 0xe0b400, 0x5a1a1a, 0x1c1c1c, 0x3c8fd6, 0x7a1f6b] },
  { name: 'car', geo: car, len: 4.3, width: 1.78, maxSpeed: 13, weight: 0.2,
    colors: [0xf2f2f2, 0xb8bcc0, 0x1a1a1a, 0x5d6166, 0x8c1c1c, 0x1f3f75, 0xe8e2d0] },
  { name: 'van', geo: van, len: 4.7, width: 1.78, maxSpeed: 12, weight: 0.13,
    colors: [0xf5f5f2, 0xf5f5f2, 0xf5f5f2, 0xc0c3c6, 0xe7e0c8] },
  { name: 'bus', geo: bus, len: 11, width: 2.5, maxSpeed: 10, weight: 0.07, majorOnly: true,
    colors: [0xb3201e, 0xb3201e, 0x2b6cb0, 0xe58e1a, 0x6b2fa0, 0x1f7a5c] },
  { name: 'moto', geo: moto, len: 2.0, width: 0.8, maxSpeed: 13, weight: 0.2,
    colors: [0x9c1c1c, 0x1a1a1a, 0x1f4f9c, 0xb8bcc0, 0xd8d8d8] },
];

const uVehicleNight = { value: 0 };
/** 0 day .. 1 night: head and tail lights glow */
export const setVehicleNight = (v: number) => (uVehicleNight.value = v);
export const vehicleMaterial = () => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = uVehicleNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aGlow; varying float vGlow;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = aGlow;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying float vGlow;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vGlow > 0.5 && vGlow < 1.5) totalEmissiveRadiance += vec3(1.0, 0.92, 0.75) * (0.15 + 3.5 * uNight);
        else if (vGlow > 1.5) totalEmissiveRadiance += vec3(1.0, 0.06, 0.03) * (0.05 + 2.2 * uNight);`);
  };
  m.customProgramCacheKey = () => 'vehicle-glow';
  return m;
};

const LIVERY = 0x8c2629; // Sri Lanka Railways maroon
const CREAM = 0xe9dcb0;
const ROOF = 0x8a8d90;
const YELLOW = 0xe8b81e;
export const TRAIN_CAR_LEN = 18;
export const TRAIN_CAR_W = 2.9;
/** door centres along the car (local z), on both sides */
export const TRAIN_DOORS = [-5.2, 5.2];

/** One diesel multiple unit carriage. `cab` adds a driving cab at the +Z end. Floor at y = 1.05. */
export function trainCar(cab: boolean): Part {
  const L = TRAIN_CAR_LEN, W = TRAIN_CAR_W;
  const parts: Part[] = [
    box(2.5, 0.55, L - 1, 0, 0.75, 0, DARK), // underframe
    box(2.3, 0.5, 2.6, 0, 0.4, L / 2 - 3, DARK), // bogies
    box(2.3, 0.5, 2.6, 0, 0.4, -(L / 2 - 3), DARK),
    box(W, 2.55, L, 0, 2.3, 0, LIVERY), // body
    box(W - 0.2, 0.25, L - 0.2, 0, 3.7, 0, ROOF),
    box(W + 0.08, 0.22, L - 0.2, 0, 1.62, 0, CREAM), // waist stripe
  ];
  for (const side of [1, -1]) {
    const x = side * (W / 2 + 0.01);
    for (const z of [-7.6, -2.6, 0, 2.6, 7.6]) parts.push(box(0.04, 0.8, z === 0 ? 2.4 : 1.6, x, 2.7, z, GLASS)); // windows
    for (const z of TRAIN_DOORS) parts.push(box(0.05, 2.15, 1.2, x, 2.15, z, CANVAS)); // open doorways
  }
  for (const z of [L / 2 - 3, -(L / 2 - 3)]) {
    for (const x of [-0.75, 0.75]) for (const dz of [-0.9, 0.9]) parts.push(wheel(0.45, 0.12, x, z + dz).translate(0, 0.05, 0));
  }
  if (cab) {
    parts.push(box(W - 0.05, 1.25, 0.06, 0, 1.65, L / 2 + 0.01, YELLOW)); // warning-yellow nose
    parts.push(box(2.2, 0.8, 0.06, 0, 2.85, L / 2 + 0.02, GLASS)); // cab windows
    parts.push(disc(0.13, -0.85, 1.45, L / 2 + 0.03, HEAD), disc(0.13, 0.85, 1.45, L / 2 + 0.03, HEAD));
  }
  return merge(parts);
}
