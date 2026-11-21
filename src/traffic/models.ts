import * as THREE from 'three';
import { addLampLight } from '../world/lamplight';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Vehicles are single merged geometries with vertex colours. Parts coloured WHITE take the
// body colour (instance colour / material colour); everything else keeps its own colour.
// Local forward is +Z, right is -X (Sri Lanka drives on the left, so the kerb side is +X),
// origin on the ground at the centre.
//
// Bodies are side profiles (z, y) extruded across the width with rounded edges, wheel arches cut
// into them, and the top narrowed towards the roof, so they read as cars rather than boxes.

const WHITE = 0xffffff;
const GLASS = 0x1d2a33;
const TYRE = 0x161616;
const DARK = 0x262626;
const TRIM = 0x2e2e2e;
const CANVAS = 0x141414;
const SEAT = 0x3b2a20;
const HEAD = 0xfff3c4;
const TAIL = 0xb01212;
const CHROME = 0x9a9ea3;
const RIM = 0xb9bdc2;
const PLATE = 0xf0f0ea;
const SKIN = 0x8a5a3c;

type Part = THREE.BufferGeometry;
type P2 = [number, number];
type V3 = [number, number, number];

function col(g: Part, hex: number): Part {
  if (g.index) g = g.toNonIndexed();
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  // 1 = headlight, 2 = tail light: these glow at night
  g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(hex === HEAD ? 1 : hex === TAIL ? 2 : 0), 1));
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}
const box = (w: number, h: number, l: number, x: number, y: number, z: number, hex: number, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, l);
  if (rx) g.rotateX(rx);
  return col(g.translate(x, y, z), hex);
};
/** plain tyre (used under the train) */
const wheel = (r: number, w: number, x: number, z: number) => {
  const g = new THREE.CylinderGeometry(r, r, w, 14);
  g.rotateZ(Math.PI / 2);
  return col(g.translate(x, r, z), TYRE);
};
/** tyre with a rim and hub on the outside (both sides when centred, as on a bike) */
function wheelSet(r: number, w: number, x: number, z: number, rim = RIM): Part[] {
  const out: Part[] = [wheel(r, w, x, z)];
  const sides = x === 0 ? [1, -1] : [Math.sign(x)];
  for (const s of sides) {
    const rg = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.02, 12).rotateZ(Math.PI / 2).translate(x + s * w / 2, r, z);
    const hub = new THREE.CylinderGeometry(r * 0.18, r * 0.18, 0.03, 8).rotateZ(Math.PI / 2).translate(x + s * (w / 2 + 0.012), r, z);
    out.push(col(rg, rim), col(hub, DARK));
  }
  return out;
}
const disc = (r: number, x: number, y: number, z: number, hex: number, back = false) => {
  const g = new THREE.CylinderGeometry(r, r, 0.05, 12);
  g.rotateX(Math.PI / 2);
  return col(g.translate(x, y, back ? z - 0.02 : z + 0.02), hex);
};

function shapeOf(pts: P2[]) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  return s;
}
/** narrow the part towards its top: above y0, x shrinks by up to k at y1 */
function taper(g: Part, y0: number, y1: number, k: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.clamp((p.getY(i) - y0) / (y1 - y0), 0, 1);
    p.setX(i, p.getX(i) * (1 - k * t));
  }
}
interface SlabOpts { bevel?: number; taper?: [number, number, number]; x?: number }
function extrude(shape: P2[] | THREE.Shape, width: number, o: SlabOpts) {
  const bv = Math.min(o.bevel ?? 0, width / 2 - 0.003);
  const depth = Math.max(0.002, width - 2 * Math.max(bv, 0));
  const g = new THREE.ExtrudeGeometry(Array.isArray(shape) ? shapeOf(shape) : shape, {
    depth, bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv, bevelSegments: 2, curveSegments: 6,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** a side profile (z, y) extruded across the width, centred on x (or at o.x) */
function slab(shape: P2[] | THREE.Shape, width: number, hex: number, o: SlabOpts = {}): Part {
  const g = extrude(shape, width, o);
  g.rotateY(-Math.PI / 2); // shape x -> world z, extrusion -> world x
  if (o.taper) taper(g, ...o.taper);
  if (o.x) g.translate(o.x, 0, 0);
  return col(g, hex);
}
/** a cross-section (x, y) extruded along the length, centred on z = zc */
function section(pts: P2[], length: number, hex: number, zc = 0, bevel = 0): Part {
  const g = extrude(pts, length, { bevel });
  return col(g.translate(0, 0, zc), hex);
}
/** body profile: `top` runs from the rear bottom over the roof to the front bottom; the bottom edge
 * runs back at `sill` with an arch cut over each wheel ([z, centre y, radius]) */
function bodyShape(top: P2[], sill: number, arches: [number, number, number][]) {
  const s = new THREE.Shape();
  s.moveTo(top[0][0], top[0][1]);
  for (let i = 1; i < top.length; i++) s.lineTo(top[i][0], top[i][1]);
  for (const [z, cy, R] of [...arches].sort((a, b) => b[0] - a[0])) {
    s.lineTo(z + R, sill);
    s.absarc(z, cy, R, 0, Math.PI, false);
    s.lineTo(z - R, sill);
  }
  s.lineTo(top[0][0], sill);
  s.closePath();
  return s;
}
/** a thin panel lying just outside the edge a -> b of a profile listed clockwise (glass on a windscreen) */
function strip(a: P2, b: P2, f = 0.07, out = 0.012, th = 0.02): P2[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
  const nx = -dy / L, ny = dx / L;
  const at = (t: number, o: number): P2 => [a[0] + dx * t + nx * o, a[1] + dy * t + ny * o];
  return [at(f, out - th), at(f, out), at(1 - f, out), at(1 - f, out - th)];
}
/** a rounded rod from a to b */
function limb(a: V3, b: V3, r: number, hex: number, seg = 6): Part {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const L = Math.max(0.001, d.length());
  const g = new THREE.CapsuleGeometry(r, L, 1, seg);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((A.x + B.x) / 2, (A.y + B.y) / 2, (A.z + B.z) / 2);
  return col(g, hex);
}
/** a curved mudguard over a wheel at (z, cy) */
function guard(z: number, cy: number, r: number, from: number, to: number, width: number, hex: number, x = 0): Part {
  const s = new THREE.Shape();
  s.absarc(z, cy, r + 0.035, from, to, false);
  s.absarc(z, cy, r, to, from, true);
  s.closePath();
  return slab(s, width, hex, { x });
}
const ball = (r: number, x: number, y: number, z: number, hex: number) => col(new THREE.SphereGeometry(r, 10, 7).translate(x, y, z), hex);

interface RiderPose { hip: V3; shoulder: V3; hand: V3; knee: V3; foot: V3; shirt: number; legs: number; helmet?: number }
/** a seated or standing rider (x of hand/knee/foot is mirrored for the other side) */
function rider(p: RiderPose): Part[] {
  const out: Part[] = [];
  out.push(limb(p.hip, p.shoulder, 0.13, p.shirt, 8));
  out.push(ball(0.15, p.hip[0], p.hip[1], p.hip[2], p.legs));
  const dir = new THREE.Vector3(p.shoulder[0] - p.hip[0], p.shoulder[1] - p.hip[1], p.shoulder[2] - p.hip[2]).normalize();
  const neck: V3 = [p.shoulder[0], p.shoulder[1] + 0.12, p.shoulder[2] + dir.z * 0.06];
  const head: V3 = [neck[0], neck[1] + 0.13, neck[2] + 0.02];
  out.push(limb(p.shoulder, neck, 0.045, SKIN));
  out.push(col(new THREE.SphereGeometry(0.105, 12, 8).scale(0.9, 1.08, 1).translate(...head), SKIN));
  if (p.helmet !== undefined) {
    out.push(col(new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).translate(head[0], head[1] - 0.005, head[2] - 0.01), p.helmet));
    out.push(col(new THREE.SphereGeometry(0.142, 10, 6, -0.9, 1.8, Math.PI * 0.32, Math.PI * 0.28).translate(head[0], head[1] - 0.005, head[2] - 0.01), GLASS));
  } else {
    out.push(col(new THREE.SphereGeometry(0.11, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(-0.35).translate(head[0], head[1] + 0.01, head[2] - 0.01), 0x1a1412));
  }
  for (const s of [1, -1]) {
    const sh: V3 = [s * 0.17, p.shoulder[1] - 0.03, p.shoulder[2]];
    const hd: V3 = [s * Math.abs(p.hand[0]), p.hand[1], p.hand[2]];
    const el: V3 = [(sh[0] + hd[0]) / 2 + s * 0.04, (sh[1] + hd[1]) / 2 - 0.08, (sh[2] + hd[2]) / 2 - 0.02];
    out.push(ball(0.06, sh[0], sh[1], sh[2], p.shirt));
    out.push(limb(sh, el, 0.048, p.shirt), limb(el, hd, 0.04, SKIN));
    const hp: V3 = [s * 0.09, p.hip[1], p.hip[2]];
    const kn: V3 = [s * Math.abs(p.knee[0]), p.knee[1], p.knee[2]];
    const ft: V3 = [s * Math.abs(p.foot[0]), p.foot[1], p.foot[2]];
    out.push(limb(hp, kn, 0.07, p.legs), limb(kn, ft, 0.055, p.legs));
    out.push(box(0.09, 0.07, 0.22, ft[0], ft[1] - 0.03, ft[2] + 0.06, 0x1c1c1c));
  }
  return out;
}

function merge(parts: Part[]) {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** body, glass and lights shared by the cars */
interface CarSpec {
  top: P2[]; sill: number; width: number; r: number; wz: [number, number];
  cabin: P2[]; cabinW: number; tap: [number, number, number];
  windscreen: [P2, P2]; rear: [P2, P2]; windows: P2[][];
}
function carBody(c: CarSpec): Part[] {
  const R = c.r + 0.06;
  const parts: Part[] = [
    slab(bodyShape(c.top, c.sill, c.wz.map((z) => [z, c.r, R] as [number, number, number])), c.width, WHITE, { bevel: 0.07 }),
    slab(c.cabin, c.cabinW, WHITE, { bevel: 0.045, taper: c.tap }),
    slab(strip(...c.windscreen, 0.06, 0.012, 0.02), c.cabinW - 0.16, GLASS, { taper: c.tap }),
    slab(strip(...c.rear, 0.09, 0.012, 0.02), c.cabinW - 0.18, GLASS, { taper: c.tap }),
    ...c.windows.map((w) => slab(w, c.cabinW + 0.022, GLASS, { taper: c.tap })),
  ];
  for (const z of c.wz) {
    parts.push(box(c.width - 0.3, R * 0.9, R * 1.8, 0, c.r + R * 0.25, z, DARK)); // wheel well
    for (const s of [1, -1]) parts.push(...wheelSet(c.r, 0.22, s * (c.width / 2 - 0.13), z));
  }
  return parts;
}

/** Bajaj-style three-wheeler. Seat top for the driver is at y = 0.86, z = 0.32. */
export function tukTuk(): Part {
  const parts: Part[] = [
    slab([[-1.18, 0.32], [-1.2, 0.5], [1.0, 0.5], [1.05, 0.36], [0.95, 0.3]], 1.16, WHITE, { bevel: 0.03 }), // floor pan
    slab([[-1.25, 0.5], [-1.3, 0.72], [-1.22, 1.05], [0.25, 1.05], [0.36, 0.8], [0.3, 0.5]], 1.28, WHITE, { bevel: 0.07 }), // rear tub
    slab([[0.85, 0.42], [1.15, 0.48], [1.3, 0.75], [1.33, 1.17], [1.1, 1.17], [0.95, 0.75]], 0.86, WHITE, { bevel: 0.05, taper: [0.5, 1.17, -0.32] }), // front fascia
    guard(1.08, 0.24, 0.27, 0.35, Math.PI - 0.2, 0.2, WHITE), // front mudguard
    box(1.29, 0.03, 1.4, 0, 0.9, -0.45, CHROME), // side trim
    slab([[1.25, 1.17], [1.33, 1.17], [1.23, 1.74], [1.16, 1.74]], 1.12, GLASS), // windscreen
    slab([[-1.08, 1.8], [1.15, 1.8], [1.33, 1.73], [1.31, 1.82], [1.12, 1.93], [-0.98, 1.94], [-1.11, 1.88]], 1.34, CANVAS, { bevel: 0.04, taper: [1.8, 1.94, 0.05] }), // canopy
    slab([[-1.16, 1.02], [-1.11, 1.82], [-1.03, 1.82], [-1.08, 1.02]], 1.3, CANVAS), // rear canvas
    ...[1, -1].map((s) => slab([[-1.08, 1.05], [-0.22, 1.05], [-0.28, 1.35], [-0.5, 1.62], [-0.78, 1.81], [-1.08, 1.81]], 0.03, CANVAS, { x: s * 0.655 })),
    ...[1, -1].map((s) => limb([s * 0.5, 1.17, 1.27], [s * 0.6, 1.8, 1.17], 0.022, DARK)), // front pillars
    slab([[-0.92, 1.0], [-0.38, 1.0], [-0.36, 1.18], [-0.92, 1.18]], 1.1, SEAT, { bevel: 0.04 }), // passenger bench
    slab([[-1.02, 1.1], [-0.9, 1.1], [-0.84, 1.6], [-0.96, 1.6]], 1.1, SEAT, { bevel: 0.03 }),
    slab([[0.1, 0.74], [0.54, 0.74], [0.52, 0.86], [0.12, 0.86]], 0.46, SEAT, { bevel: 0.03 }), // driver seat
    limb([0, 0.9, 1.0], [0, 1.12, 0.82], 0.025, DARK), // steering column
    limb([-0.36, 1.13, 0.8], [0.36, 1.13, 0.8], 0.018, CHROME), // handlebar
    disc(0.09, 0, 1.0, 1.31, HEAD),
    disc(0.06, 0.5, 0.8, -1.28, TAIL, true),
    disc(0.06, -0.5, 0.8, -1.28, TAIL, true),
    box(0.36, 0.14, 0.02, 0, 0.62, -1.29, PLATE),
    ...wheelSet(0.24, 0.14, 0, 1.08),
    ...wheelSet(0.24, 0.14, 0.6, -0.72),
    ...wheelSet(0.24, 0.14, -0.6, -0.72),
  ];
  return merge(parts);
}

/** Toyota Premio / Axio-style saloon. */
export function car(): Part {
  return merge([
    ...carBody({
      top: [[-2.15, 0.3], [-2.2, 0.5], [-2.18, 0.8], [-2.05, 0.96], [-1.45, 0.99], [0.95, 0.97], [1.9, 0.86], [2.15, 0.76], [2.2, 0.55], [2.15, 0.3]],
      sill: 0.26, width: 1.76, r: 0.31, wz: [1.32, -1.32],
      cabin: [[-1.45, 0.95], [-0.8, 1.42], [0.2, 1.44], [1.0, 0.95]], cabinW: 1.56, tap: [0.95, 1.44, 0.12],
      windscreen: [[0.2, 1.44], [1.0, 0.95]], rear: [[-1.45, 0.95], [-0.8, 1.42]],
      windows: [[[0.0, 1.01], [0.0, 1.37], [0.18, 1.38], [0.85, 1.01]], [[-1.22, 1.01], [-0.78, 1.36], [-0.12, 1.37], [-0.12, 1.01]]],
    }),
    box(0.7, 0.12, 0.06, 0, 0.6, 2.18, DARK), // grille
    box(0.36, 0.1, 0.08, 0.56, 0.7, 2.14, HEAD), box(0.36, 0.1, 0.08, -0.56, 0.7, 2.14, HEAD),
    box(1.74, 0.17, 0.14, 0, 0.42, 2.16, TRIM), box(1.74, 0.17, 0.14, 0, 0.45, -2.16, TRIM), // bumpers
    box(0.46, 0.11, 0.02, 0, 0.42, 2.24, PLATE), box(0.46, 0.11, 0.02, 0, 0.64, -2.215, PLATE),
    box(0.4, 0.12, 0.06, 0.58, 0.82, -2.16, TAIL), box(0.4, 0.12, 0.06, -0.58, 0.82, -2.16, TAIL),
    box(0.12, 0.08, 0.07, 0.9, 1.02, 0.84, WHITE), box(0.12, 0.08, 0.07, -0.9, 1.02, 0.84, WHITE), // mirrors
    box(1.765, 0.45, 0.012, 0, 0.68, -0.1, DARK), box(1.765, 0.42, 0.012, 0, 0.7, 0.95, DARK), // door seams
    box(1.775, 0.025, 0.1, 0, 0.86, 0.6, CHROME), box(1.775, 0.025, 0.1, 0, 0.86, -0.55, CHROME), // handles
  ]);
}

/** Suzuki Wagon R-style tall hatchback, the most common small car in Colombo. */
export function hatch(): Part {
  return merge([
    ...carBody({
      top: [[-1.8, 0.28], [-1.83, 0.55], [-1.82, 0.95], [-1.75, 1.0], [0.75, 0.98], [1.5, 0.86], [1.78, 0.74], [1.82, 0.5], [1.77, 0.28]],
      sill: 0.25, width: 1.5, r: 0.28, wz: [1.18, -1.15],
      cabin: [[-1.8, 0.97], [-1.74, 1.6], [-1.6, 1.66], [0.35, 1.66], [1.05, 0.97]], cabinW: 1.36, tap: [0.97, 1.66, 0.08],
      windscreen: [[0.35, 1.66], [1.05, 0.97]], rear: [[-1.8, 0.97], [-1.74, 1.6]],
      windows: [[[-0.25, 1.03], [-0.25, 1.58], [0.32, 1.6], [0.9, 1.03]], [[-1.6, 1.03], [-1.6, 1.58], [-0.37, 1.6], [-0.37, 1.03]]],
    }),
    box(0.5, 0.1, 0.05, 0, 0.62, 1.81, DARK),
    box(0.3, 0.13, 0.08, 0.5, 0.7, 1.77, HEAD), box(0.3, 0.13, 0.08, -0.5, 0.7, 1.77, HEAD),
    box(1.48, 0.17, 0.13, 0, 0.4, 1.79, TRIM), box(1.48, 0.17, 0.13, 0, 0.4, -1.8, TRIM),
    box(0.42, 0.11, 0.02, 0, 0.42, 1.865, PLATE), box(0.42, 0.11, 0.02, 0, 0.66, -1.84, PLATE),
    box(0.12, 0.3, 0.06, 0.62, 0.85, -1.82, TAIL), box(0.12, 0.3, 0.06, -0.62, 0.85, -1.82, TAIL),
    box(0.1, 0.08, 0.07, 0.78, 1.04, 0.86, WHITE), box(0.1, 0.08, 0.07, -0.78, 1.04, 0.86, WHITE),
    box(1.505, 0.45, 0.012, 0, 0.66, -0.31, DARK), box(1.505, 0.42, 0.012, 0, 0.68, 0.98, DARK),
    box(1.515, 0.025, 0.09, 0, 0.86, 0.45, CHROME), box(1.515, 0.025, 0.09, 0, 0.86, -0.75, CHROME),
  ]);
}

/** Land Cruiser Prado / Montero-style SUV. */
export function suv(): Part {
  const spare = new THREE.CylinderGeometry(0.36, 0.36, 0.22, 14).rotateX(Math.PI / 2).translate(0, 0.98, -2.56);
  const cover = new THREE.CylinderGeometry(0.31, 0.31, 0.03, 14).rotateX(Math.PI / 2).translate(0, 0.98, -2.68);
  return merge([
    ...carBody({
      top: [[-2.4, 0.42], [-2.45, 0.7], [-2.43, 1.12], [-2.3, 1.17], [1.05, 1.15], [2.15, 1.06], [2.4, 0.98], [2.45, 0.6], [2.38, 0.42]],
      sill: 0.4, width: 1.88, r: 0.38, wz: [1.42, -1.42],
      cabin: [[-2.38, 1.14], [-2.3, 1.8], [-2.15, 1.86], [0.5, 1.86], [1.15, 1.14]], cabinW: 1.72, tap: [1.14, 1.86, 0.08],
      windscreen: [[0.5, 1.86], [1.15, 1.14]], rear: [[-2.38, 1.14], [-2.3, 1.8]],
      windows: [
        [[-0.3, 1.2], [-0.3, 1.78], [0.45, 1.8], [1.0, 1.2]],
        [[-1.45, 1.2], [-1.45, 1.78], [-0.42, 1.79], [-0.42, 1.2]],
        [[-2.2, 1.22], [-2.2, 1.76], [-1.57, 1.77], [-1.57, 1.22]],
      ],
    }),
    col(spare, TYRE), col(cover, WHITE),
    box(0.05, 0.05, 2.5, 0.7, 1.91, -0.85, CHROME), box(0.05, 0.05, 2.5, -0.7, 1.91, -0.85, CHROME), // roof rails
    box(1.1, 0.25, 0.06, 0, 0.82, 2.45, DARK), // grille
    box(0.32, 0.14, 0.08, 0.7, 0.86, 2.42, HEAD), box(0.32, 0.14, 0.08, -0.7, 0.86, 2.42, HEAD),
    box(1.9, 0.2, 0.16, 0, 0.55, 2.42, TRIM), box(1.9, 0.2, 0.16, 0, 0.58, -2.42, TRIM),
    box(0.8, 0.06, 0.2, 0, 0.45, 2.42, CHROME), // skid plate
    box(0.46, 0.11, 0.02, 0, 0.55, 2.505, PLATE), box(0.46, 0.11, 0.02, 0, 0.75, -2.5, PLATE),
    box(0.16, 0.3, 0.06, 0.82, 1.0, -2.44, TAIL), box(0.16, 0.3, 0.06, -0.82, 1.0, -2.44, TAIL),
    box(0.12, 0.1, 0.08, 0.98, 1.22, 1.0, WHITE), box(0.12, 0.1, 0.08, -0.98, 1.22, 1.0, WHITE),
    box(0.14, 0.04, 1.6, 1.0, 0.44, 0, DARK), box(0.14, 0.04, 1.6, -1.0, 0.44, 0, DARK), // side steps
    box(1.885, 0.55, 0.012, 0, 0.82, -0.36, DARK), box(1.885, 0.5, 0.012, 0, 0.84, 1.08, DARK),
    box(1.895, 0.025, 0.1, 0, 1.02, 0.7, CHROME), box(1.895, 0.025, 0.1, 0, 1.02, -0.6, CHROME),
  ]);
}

/** Toyota HiAce-style van, the standard Colombo school/office van. */
export function van(): Part {
  const tap: [number, number, number] = [1.2, 1.98, 0.06];
  const W = 1.76, R = 0.39;
  const parts: Part[] = [
    slab(bodyShape([[-2.35, 0.32], [-2.38, 1.9], [-2.3, 1.98], [1.95, 1.98], [2.25, 1.88], [2.36, 1.2], [2.4, 0.95], [2.4, 0.45], [2.33, 0.3]], 0.3,
      [[1.55, 0.33, R], [-1.5, 0.33, R]]), W, WHITE, { bevel: 0.08, taper: tap }),
    slab(strip([2.25, 1.88], [2.36, 1.2], 0.06), W - 0.2, GLASS, { taper: tap }),
    slab([[1.35, 1.22], [1.35, 1.8], [2.15, 1.8], [2.28, 1.22]], W + 0.02, GLASS, { taper: tap }),
    ...[[-2.15, -1.0], [-0.9, 0.15], [0.25, 1.2]].map(([a, b]) => slab([[a, 1.25], [a, 1.78], [b, 1.78], [b, 1.25]], W + 0.02, GLASS, { taper: tap })),
    slab([[-2.395, 1.25], [-2.395, 1.8], [-2.37, 1.8], [-2.37, 1.25]], 1.5, GLASS),
    box(W + 0.005, 1.25, 0.012, 0, 0.95, 0.2, DARK), box(W + 0.005, 1.25, 0.012, 0, 0.95, -0.95, DARK), // sliding door
    box(W + 0.005, 0.85, 0.012, 0, 0.75, 1.3, DARK),
    box(1.2, 0.2, 0.05, 0, 0.82, 2.41, DARK),
    box(0.32, 0.16, 0.06, 0.62, 0.88, 2.41, HEAD), box(0.32, 0.16, 0.06, -0.62, 0.88, 2.41, HEAD),
    box(1.78, 0.2, 0.14, 0, 0.45, 2.39, TRIM), box(1.78, 0.2, 0.14, 0, 0.45, -2.36, TRIM),
    box(0.46, 0.11, 0.02, 0, 0.45, 2.465, PLATE), box(0.46, 0.11, 0.02, 0, 0.75, -2.395, PLATE),
    box(0.12, 0.4, 0.05, 0.8, 0.88, -2.38, TAIL), box(0.12, 0.4, 0.05, -0.8, 0.88, -2.38, TAIL),
    box(0.06, 0.22, 0.12, 0.95, 1.52, 2.05, DARK), box(0.06, 0.22, 0.12, -0.95, 1.52, 2.05, DARK),
    box(W + 0.015, 0.025, 0.12, 0, 1.05, 0.05, CHROME), box(W + 0.015, 0.025, 0.1, 0, 1.08, 1.6, CHROME),
  ];
  for (const z of [1.55, -1.5]) {
    parts.push(box(W - 0.3, R * 0.9, R * 1.8, 0, 0.33 + R * 0.25, z, DARK));
    for (const s of [1, -1]) parts.push(...wheelSet(0.33, 0.22, s * (W / 2 - 0.13), z));
  }
  return merge(parts);
}

/** shared big-bus parts: wheels and wells */
function busWheels(parts: Part[], W: number, front: number, rear: number) {
  const r = 0.5, R = 0.58;
  for (const z of [front, rear]) parts.push(box(W - 0.4, R * 0.9, R * 1.8, 0, r + R * 0.25, z, DARK));
  for (const s of [1, -1]) {
    parts.push(...wheelSet(r, 0.3, s * (W / 2 - 0.2), front));
    parts.push(...wheelSet(r, 0.28, s * (W / 2 - 0.2), rear), ...wheelSet(r, 0.26, s * (W / 2 - 0.5), rear));
  }
}

/** Ashok Leyland-style long-distance / SLTB route bus (high floor, two doors on the kerb side). */
export function bus(): Part {
  const W = 2.5, L2 = 5.5;
  const parts: Part[] = [
    slab(bodyShape([[-L2, 0.55], [-L2 - 0.02, 2.95], [-L2 + 0.1, 3.08], [5.25, 3.08], [5.45, 2.95], [5.55, 1.7], [5.55, 0.55]], 0.55,
      [[3.55, 0.5, 0.58], [-3.3, 0.5, 0.58]]), W, WHITE, { bevel: 0.1, taper: [2.9, 3.08, 0.04] }),
    ...[0.6, -0.6].map((x) => slab(strip([5.45, 2.95], [5.55, 1.7], 0.07), 1.12, GLASS, { x })), // split windscreen
    slab([[-5.545, 2.1], [-5.545, 2.8], [-5.525, 2.8], [-5.525, 2.1]], 2.0, GLASS),
    box(W + 0.02, 0.12, 11.0, 0, 1.62, 0, 0xf2f2f2), box(W + 0.02, 0.06, 11.0, 0, 1.47, 0, 0xe8b81e), // side stripes
    box(1.7, 0.26, 0.03, 0, 2.72, 5.5, 0x111111), box(1.2, 0.09, 0.01, 0, 2.72, 5.52, 0xffa31a), // destination board
    box(1.2, 0.35, 0.04, 0, 1.2, 5.57, DARK),
    box(0.36, 0.18, 0.06, 0.9, 0.95, 5.56, HEAD), box(0.36, 0.18, 0.06, -0.9, 0.95, 5.56, HEAD),
    box(W, 0.3, 0.15, 0, 0.65, 5.56, TRIM), box(W, 0.3, 0.15, 0, 0.7, -5.54, TRIM),
    box(0.2, 0.45, 0.06, 1.05, 1.1, -5.54, TAIL), box(0.2, 0.45, 0.06, -1.05, 1.1, -5.54, TAIL),
    box(0.5, 0.13, 0.02, 0, 0.95, 5.645, PLATE), box(0.5, 0.13, 0.02, 0, 1.2, -5.585, PLATE),
    box(0.08, 0.3, 0.14, 1.32, 2.4, 5.2, DARK), box(0.08, 0.3, 0.14, -1.32, 2.4, 5.2, DARK), // mirrors
  ];
  // side windows with pillars, and the driver's window
  for (let k = 0; k < 8; k++) {
    const a = -5.1 + k * 1.15;
    parts.push(slab([[a, 1.95], [a, 2.75], [a + 1.0, 2.75], [a + 1.0, 1.95]], W + 0.02, GLASS));
  }
  parts.push(slab([[4.3, 1.95], [4.3, 2.75], [5.25, 2.75], [5.3, 1.95]], W + 0.02, GLASS));
  // doors on the kerb side (+x)
  for (const z of [4.55, 0.35]) {
    parts.push(box(0.04, 2.15, 0.9, W / 2 + 0.01, 1.62, z, 0x2a2f33), box(0.045, 0.75, 0.75, W / 2 + 0.015, 2.2, z, GLASS));
  }
  busWheels(parts, W, 3.55, -3.3);
  return merge(parts);
}

/** Lanka Metro Transit-style city bus: white body, red front and rear ends, a black window band along
 * the sides, big windscreen and curved mirrors. Colours only, no logo. */
export function metroBus(): Part {
  const W = 2.55, sill = 0.38;
  const RED = 0xc8102e, BODY = 0xf4f4f4, PILLAR = 0x0c1114;
  const ar: [number, number, number][] = [[3.45, 0.5, 0.58], [-3.0, 0.5, 0.58]];
  const parts: Part[] = [
    // three body sections: red rear end, white middle, red front end (the joins read as panel lines)
    slab(bodyShape([[-6.0, 0.4], [-6.05, 2.95], [-5.92, 3.1], [-5.15, 3.1], [-5.6, sill]], sill, []), W, RED, { bevel: 0.1 }),
    slab(bodyShape([[-5.6, sill], [-5.15, 3.1], [4.6, 3.1], [5.1, sill]], sill, ar), W, BODY, { bevel: 0.06 }),
    slab(bodyShape([[5.1, sill], [4.6, 3.1], [5.75, 3.1], [6.0, 2.92], [6.06, 1.0], [6.04, 0.4]], sill, []), W, RED, { bevel: 0.1 }),
    slab([[-5.9, 3.08], [-5.78, 3.3], [-4.3, 3.3], [-4.0, 3.08]], 2.2, RED, { bevel: 0.06 }), // roof hump at the back
    // black window band, with pillars
    slab([[-5.1, 1.4], [-5.25, 2.92], [4.75, 2.92], [4.95, 1.4]], W + 0.02, GLASS),
    slab(strip([6.0, 2.92], [6.06, 1.0], 0.04), 2.35, GLASS), // windscreen
    box(1.8, 0.22, 0.02, 0, 2.7, 6.035, 0x111111), box(1.3, 0.07, 0.01, 0, 2.7, 6.05, 0xffa31a), // destination sign
    box(0.42, 0.12, 0.05, 0.86, 0.78, 6.07, HEAD), box(0.42, 0.12, 0.05, -0.86, 0.78, 6.07, HEAD),
    box(0.12, 0.06, 0.02, 0, 0.95, 6.08, CHROME), // badge
    box(0.5, 0.13, 0.02, 0, 0.55, 6.07, PLATE),
    slab([[-6.08, 2.0], [-6.08, 2.8], [-6.055, 2.8], [-6.055, 2.0]], 2.0, GLASS), // rear window
    box(0.18, 0.45, 0.05, 1.05, 1.05, -6.06, TAIL), box(0.18, 0.45, 0.05, -1.05, 1.05, -6.06, TAIL),
    box(W - 0.05, 0.22, 0.12, 0, 0.5, -6.02, TRIM),
    box(0.5, 0.13, 0.02, 0, 0.8, -6.075, PLATE),
  ];
  for (let z = -3.8; z < 4.7; z += 1.42) parts.push(box(W + 0.03, 1.5, 0.07, 0, 2.16, z, PILLAR));
  for (const s of [1, -1]) {
    // curved mirror arms reaching forward from the roof corners
    parts.push(limb([s * 1.15, 2.85, 5.92], [s * 1.42, 2.7, 6.35], 0.025, DARK), limb([s * 1.42, 2.7, 6.35], [s * 1.42, 2.15, 6.38], 0.025, DARK));
    parts.push(box(0.07, 0.36, 0.2, s * 1.42, 2.05, 6.38, DARK));
    parts.push(box(0.03, 0.6, 0.55, s * (W / 2 + 0.01), 1.0, -4.95, 0x3a3a3a)); // engine grille
    for (const z of [1.6, -1.4]) parts.push(box(0.03, 0.05, 0.08, s * (W / 2 + 0.01), 0.72, z, 0xff8a00)); // side markers
  }
  // doors on the kerb side (+x): front, behind the windscreen, and the middle exit
  for (const [z, l] of [[4.45, 0.8], [0.1, 1.15]]) {
    parts.push(box(0.04, 2.4, l, W / 2 + 0.012, 1.65, z, GLASS), box(0.05, 2.4, 0.04, W / 2 + 0.016, 1.65, z, DARK));
  }
  busWheels(parts, W, 3.45, -3.0);
  return merge(parts);
}

/** Motorbike (Bajaj Pulsar / Honda-style commuter) with a helmeted rider. */
export function moto(rider_ = true): Part {
  const parts: Part[] = [
    box(0.24, 0.28, 0.45, 0, 0.47, 0.0, DARK), // engine
    box(0.2, 0.12, 0.3, 0, 0.3, 0.05, DARK),
    slab([[-0.05, 0.78], [0.45, 0.8], [0.52, 0.98], [0.3, 1.03], [-0.02, 0.96]], 0.32, WHITE, { bevel: 0.05, taper: [0.8, 1.03, 0.3] }), // tank
    slab([[-0.85, 0.82], [-0.3, 0.74], [-0.05, 0.78], [-0.08, 0.88], [-0.8, 0.93]], 0.24, WHITE, { bevel: 0.03 }), // tail
    slab([[-0.68, 0.88], [0.02, 0.9], [0.0, 0.99], [-0.65, 0.985]], 0.28, SEAT, { bevel: 0.03 }), // seat
    limb([0.09, 0.3, 0.65], [0.09, 1.0, 0.48], 0.022, CHROME), limb([-0.09, 0.3, 0.65], [-0.09, 1.0, 0.48], 0.022, CHROME),
    limb([0, 0.55, -0.62], [0, 0.48, 0.0], 0.03, DARK), // swing arm
    limb([-0.33, 1.08, 0.45], [0.33, 1.08, 0.45], 0.016, DARK),
    box(0.2, 0.18, 0.12, 0, 0.98, 0.56, DARK), disc(0.075, 0, 0.97, 0.6, HEAD),
    guard(0.65, 0.3, 0.31, 0.3, 2.1, 0.12, WHITE), guard(-0.65, 0.3, 0.31, 1.2, 2.9, 0.14, WHITE),
    limb([-0.16, 0.36, 0.05], [-0.16, 0.48, -0.78], 0.045, CHROME), // exhaust (right side)
    disc(0.04, 0, 0.88, -0.86, TAIL, true),
    box(0.16, 0.08, 0.02, 0, 0.78, -0.86, PLATE),
    ...wheelSet(0.3, 0.1, 0, 0.65), ...wheelSet(0.3, 0.1, 0, -0.65),
  ];
  if (rider_) parts.push(...rider({ hip: [0, 1.04, -0.3], shoulder: [0, 1.5, -0.1], hand: [0.3, 1.08, 0.42], knee: [0.17, 0.98, 0.16], foot: [0.16, 0.52, -0.02], shirt: 0x4a5568, legs: 0x2f3542, helmet: 0x202020 }));
  return merge(parts);
}

/** Pedal bicycle (Lumala-style roadster with a rear carrier) with a seated rider. The frame takes the body colour. */
export function bicycle(rider_ = true): Part {
  const r = 0.34;
  const R: V3 = [0, r, -0.52], F: V3 = [0, r, 0.52], BB: V3 = [0, 0.3, -0.05], S: V3 = [0, 0.86, -0.25], H: V3 = [0, 0.9, 0.38], Hb: V3 = [0, 0.7, 0.42];
  const tube = (a: V3, b: V3) => limb(a, b, 0.018, WHITE, 5);
  const parts: Part[] = [
    tube(S, BB), tube(BB, Hb), tube([0, 0.8, -0.23], [0, 0.86, 0.39]), tube(H, Hb),
    tube([0.05, 0.3, -0.05], [0.05, r, -0.52]), tube([-0.05, 0.3, -0.05], [-0.05, r, -0.52]),
    tube([0.04, 0.84, -0.25], [0.05, r, -0.52]), tube([-0.04, 0.84, -0.25], [-0.05, r, -0.52]),
    limb(Hb, F, 0.016, CHROME), limb(H, [0, 0.97, 0.34], 0.016, CHROME),
    limb([-0.27, 0.98, 0.31], [0.27, 0.98, 0.31], 0.014, DARK),
    slab([[-0.37, 0.88], [-0.12, 0.9], [-0.14, 0.95], [-0.36, 0.94]], 0.14, SEAT, { bevel: 0.02 }),
    limb(S, [0, 0.89, -0.26], 0.014, CHROME),
    box(0.18, 0.02, 0.36, 0, 0.78, -0.5, CHROME), limb([0.07, 0.78, -0.62], [0.06, r, -0.52], 0.008, CHROME), limb([-0.07, 0.78, -0.62], [-0.06, r, -0.52], 0.008, CHROME),
    col(new THREE.CylinderGeometry(0.09, 0.09, 0.02, 12).rotateZ(Math.PI / 2).translate(-0.06, 0.3, -0.05), DARK), // chainring
    box(0.1, 0.02, 0.06, 0.12, 0.22, 0.0, DARK), box(0.1, 0.02, 0.06, -0.12, 0.38, -0.1, DARK), // pedals
    disc(0.03, 0, 0.9, 0.43, HEAD),
  ];
  for (const w of [R, F]) {
    parts.push(col(new THREE.TorusGeometry(r, 0.025, 5, 14).rotateY(Math.PI / 2).translate(0, w[1], w[2]), TYRE));
    parts.push(col(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 8).rotateZ(Math.PI / 2).translate(0, w[1], w[2]), CHROME));
    for (let k = 0; k < 4; k++) parts.push(box(0.006, r * 1.9, 0.006, 0, w[1], w[2], RIM, (k * Math.PI) / 4));
  }
  if (rider_) parts.push(...rider({ hip: [0, 1.0, -0.25], shoulder: [0, 1.47, -0.04], hand: [0.27, 1.0, 0.3], knee: [0.12, 0.88, 0.08], foot: [0.12, 0.3, 0.0], shirt: 0xd9d4c8, legs: 0x2f3542 }));
  return merge(parts);
}

/** Electric kick scooter with a standing rider. The deck and stem take the body colour. */
export function eScooter(rider_ = true): Part {
  const parts: Part[] = [
    ...wheelSet(0.11, 0.06, 0, 0.42), ...wheelSet(0.11, 0.06, 0, -0.42),
    slab([[-0.5, 0.12], [0.38, 0.12], [0.42, 0.2], [-0.48, 0.21]], 0.16, WHITE, { bevel: 0.03 }), // deck
    box(0.13, 0.01, 0.7, 0, 0.215, -0.05, DARK), // grip tape
    limb([0, 0.2, 0.42], [0, 1.05, 0.4], 0.025, WHITE),
    limb([-0.23, 1.07, 0.4], [0.23, 1.07, 0.4], 0.016, DARK),
    guard(-0.42, 0.11, 0.12, 0.3, 2.4, 0.08, DARK),
    disc(0.03, 0, 0.95, 0.43, HEAD), disc(0.025, 0, 0.22, -0.51, TAIL, true),
  ];
  if (rider_) parts.push(...rider({ hip: [0, 1.02, -0.04], shoulder: [0, 1.52, 0.02], hand: [0.23, 1.07, 0.38], knee: [0.09, 0.62, 0.02], foot: [0.08, 0.26, -0.05], shirt: 0x3c6e9c, legs: 0x2f3542 }));
  return merge(parts);
}

export interface VehicleType {
  name: string;
  /** what the HUD calls it */
  label: string;
  /** with rider (traffic) */
  geo: () => Part;
  /** without rider, for the player to drive (defaults to geo) */
  bare?: () => Part;
  len: number;
  width: number;
  maxSpeed: number;
  weight: number;
  colors: number[];
  majorOnly?: boolean;
  /** tonnes, for crashes */
  mass: number;
  /** two-wheelers fall over when hit */
  twoWheel?: boolean;
}

export const VEHICLE_TYPES: VehicleType[] = [
  { name: 'tuktuk', label: 'tuk-tuk', geo: tukTuk, len: 2.6, width: 1.32, maxSpeed: 11, weight: 0.4, mass: 0.45,
    colors: [0xb3201e, 0x1f7a3a, 0x1b4f9c, 0xe0b400, 0x5a1a1a, 0x1c1c1c, 0x3c8fd6, 0x7a1f6b] },
  { name: 'car', label: 'car', geo: car, len: 4.4, width: 1.78, maxSpeed: 13, weight: 0.09, mass: 1.25,
    colors: [0xf2f2f2, 0xb8bcc0, 0x1a1a1a, 0x5d6166, 0x8c1c1c, 0x1f3f75, 0xe8e2d0] },
  { name: 'hatch', label: 'car', geo: hatch, len: 3.7, width: 1.5, maxSpeed: 12.5, weight: 0.07, mass: 0.85,
    colors: [0xf2f2f2, 0xb8bcc0, 0x8c1c1c, 0x2a5fa8, 0xd8c9a0, 0x1a1a1a, 0x3e7a52] },
  { name: 'suv', label: 'SUV', geo: suv, len: 4.9, width: 1.9, maxSpeed: 13, weight: 0.04, mass: 2.1,
    colors: [0xf2f2f2, 0x1a1a1a, 0x5d6166, 0xb8bcc0, 0x3a3226] },
  { name: 'van', label: 'van', geo: van, len: 4.8, width: 1.78, maxSpeed: 12, weight: 0.13, mass: 1.8,
    colors: [0xf5f5f2, 0xf5f5f2, 0xf5f5f2, 0xc0c3c6, 0xe7e0c8] },
  { name: 'bus', label: 'bus', geo: bus, len: 11.1, width: 2.5, maxSpeed: 10, weight: 0.05, majorOnly: true, mass: 11,
    colors: [0xb3201e, 0xb3201e, 0x2b6cb0, 0xe58e1a, 0x6b2fa0, 0x1f7a5c] },
  { name: 'metrobus', label: 'metro bus', geo: metroBus, len: 12.1, width: 2.55, maxSpeed: 10, weight: 0.03, majorOnly: true, mass: 12,
    colors: [0xffffff] },
  { name: 'moto', label: 'motorbike', geo: moto, bare: () => moto(false), len: 2.0, width: 0.8, maxSpeed: 13, weight: 0.17, mass: 0.22, twoWheel: true,
    colors: [0x9c1c1c, 0x1a1a1a, 0x1f4f9c, 0xb8bcc0, 0xd8d8d8] },
  { name: 'bicycle', label: 'bicycle', geo: bicycle, bare: () => bicycle(false), len: 1.75, width: 0.6, maxSpeed: 5, weight: 0.06, mass: 0.09, twoWheel: true,
    colors: [0x1a1a1a, 0x9c1c1c, 0x1f4f9c, 0x2f7a3a, 0xb8bcc0] },
  { name: 'escooter', label: 'e-scooter', geo: eScooter, bare: () => eScooter(false), len: 1.2, width: 0.55, maxSpeed: 6.5, weight: 0.04, mass: 0.09, twoWheel: true,
    colors: [0x1a1a1a, 0x2a9d8f, 0xe0b400, 0xe76f51] },
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
        attribute float aGlow; varying float vGlow; varying float vTint;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlow = aGlow;`)
      // only the white parts take the body colour; chrome, plates, stripes keep their own
      .replace('#include <color_vertex>', `#include <color_vertex>
        vTint = step(2.99, color.r + color.g + color.b);
        vColor.xyz = mix(color.xyz, vColor.xyz, vTint);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying float vGlow; varying float vTint;`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( mix(vec3(1.0), diffuse, vTint), opacity );')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (vGlow > 0.5 && vGlow < 1.5) totalEmissiveRadiance += vec3(1.0, 0.92, 0.75) * (0.1 + 1.3 * uNight);
        else if (vGlow > 1.5) totalEmissiveRadiance += vec3(1.0, 0.06, 0.03) * (0.04 + 1.1 * uNight);`);
  };
  m.customProgramCacheKey = () => 'vehicle-glow-v2';
  addLampLight(m);
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

/** One diesel multiple unit carriage. `cab` adds a sloped driving cab at the +Z end. Floor at y = 1.05. */
export function trainCar(cab: boolean): Part {
  const L = TRAIN_CAR_LEN, W = TRAIN_CAR_W, hw = W / 2;
  const nose = cab ? 1.3 : 0; // length taken by the cab nose
  const bodyL = L - nose, bodyZ = -nose / 2;
  const parts: Part[] = [
    box(2.5, 0.55, L - 1, 0, 0.75, 0, DARK), // underframe
    section([[-hw + 0.05, 1.05], [hw - 0.05, 1.05], [hw, 1.3], [hw, 3.3], [-hw, 3.3], [-hw, 1.3]], bodyL, LIVERY, bodyZ),
    section([[-hw, 3.28], [hw, 3.28], [hw - 0.15, 3.62], [0.8, 3.86], [-0.8, 3.86], [-hw + 0.15, 3.62]], bodyL, ROOF, bodyZ),
    box(W + 0.06, 0.2, bodyL - 0.1, 0, 1.62, bodyZ, CREAM), // waist stripe
    box(W + 0.06, 0.08, bodyL - 0.1, 0, 3.22, bodyZ, CREAM),
    box(2.6, 0.35, L - 3, 0, 0.98, 0, 0x3a3a3a), // skirt
  ];
  for (const z of [-L / 4, L / 4]) parts.push(box(0.8, 0.25, 0.8, 0, 3.95, z, ROOF)); // roof vents
  for (const side of [1, -1]) {
    const x = side * (hw + 0.01);
    for (const z of [-7.6, -2.6, 0, 2.6, 7.6]) {
      if (cab && z > 7) continue;
      parts.push(box(0.04, 0.85, z === 0 ? 2.4 : 1.6, x, 2.7, z, GLASS)); // windows
      parts.push(box(0.05, 0.06, z === 0 ? 2.5 : 1.7, x, 3.16, z, CREAM));
    }
    for (const z of TRAIN_DOORS) {
      parts.push(box(0.05, 2.15, 1.2, x, 2.15, z, CANVAS)); // open doorways
      parts.push(box(0.06, 0.06, 1.3, x, 1.1, z, CHROME)); // step
    }
  }
  // bogies: frame, springs and two axles each
  for (const z of [L / 2 - 3, -(L / 2 - 3)]) {
    parts.push(box(2.3, 0.3, 2.8, 0, 0.55, z, DARK));
    for (const x of [-1.2, 1.2]) parts.push(box(0.12, 0.45, 2.6, x, 0.5, z, 0x1e1e1e), box(0.18, 0.25, 0.25, x, 0.6, z, CHROME));
    for (const x of [-0.75, 0.75]) for (const dz of [-0.9, 0.9]) parts.push(wheel(0.45, 0.12, x, z + dz).translate(0, 0.05, 0));
  }
  // gangway at the plain ends
  const ends = cab ? [-1] : [1, -1];
  for (const e of ends) parts.push(box(1.1, 2.2, 0.3, 0, 2.2, e * (L / 2 + 0.1), DARK));
  if (cab) {
    const z0 = L / 2 - nose;
    const prof: P2[] = [[z0, 1.05], [L / 2 + 0.15, 1.05], [L / 2 + 0.2, 1.9], [L / 2 - 0.15, 3.3], [L / 2 - 0.7, 3.86], [z0, 3.86]];
    parts.push(slab(prof, W, LIVERY, { bevel: 0.12 }));
    parts.push(slab([[L / 2 + 0.14, 1.08], [L / 2 + 0.21, 1.08], [L / 2 + 0.26, 1.88], [L / 2 + 0.2, 1.88]], W - 0.2, YELLOW)); // warning-yellow nose
    for (const x of [0.62, -0.62]) parts.push(slab(strip([L / 2 - 0.15, 3.3], [L / 2 + 0.2, 1.9], 0.08), 1.1, GLASS, { x }));
    parts.push(disc(0.13, -0.85, 1.5, L / 2 + 0.23, HEAD), disc(0.13, 0.85, 1.5, L / 2 + 0.23, HEAD));
    parts.push(box(0.9, 0.2, 0.04, 0, 3.45, L / 2 - 0.4, 0x111111)); // route board
    for (const x of [-0.9, 0.9]) parts.push(limb([x, 1.25, L / 2 + 0.15], [x, 1.25, L / 2 + 0.45], 0.08, DARK)); // buffers
    parts.push(box(0.3, 0.25, 0.5, 0, 1.15, L / 2 + 0.3, DARK)); // coupler
  }
  return merge(parts);
}

/** shape helpers for other static props (street furniture) */
export const partKit = { box, limb, col, merge, slab, section, ball };
