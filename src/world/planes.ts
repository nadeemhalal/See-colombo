import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Aircraft over the city: airliners crossing high up (Colombo sits under the approach and departure
// routes for Bandaranaike International) and now and then a turboprop lower down. Generic white
// liveries, no real airline. Red, green and white navigation lights blink at night.

interface Flight {
  mesh: THREE.Group;
  strobe: THREE.Mesh;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  left: number; // metres of track left before it is recycled
}

const TRACK = 9000;

function colored(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}

/** Forward is +Z. Scale: an airliner about 38 m long, a turboprop about 22 m. */
function airframe(len: number, span: number, jet: boolean) {
  const r = len * 0.055;
  const body = new THREE.CapsuleGeometry(r, len - r * 2, 6, 12).rotateX(Math.PI / 2);
  const stripe = new THREE.CylinderGeometry(r * 1.01, r * 1.01, len * 0.7, 12, 1, true).rotateX(Math.PI / 2).translate(0, -r * 0.35, 0).scale(1, 0.25, 1);
  const wing = new THREE.BoxGeometry(span, r * 0.18, len * 0.16).translate(0, -r * 0.3, len * 0.02);
  const tailplane = new THREE.BoxGeometry(span * 0.34, r * 0.12, len * 0.08).translate(0, r * 0.2, -len * 0.44);
  const fin = new THREE.BoxGeometry(r * 0.14, len * 0.15, len * 0.12).translate(0, r + len * 0.07, -len * 0.42);
  const parts = [colored(body, 0xf2f2f0), colored(stripe, 0x2a4a8a), colored(wing, 0xd8dadc), colored(tailplane, 0xd8dadc), colored(fin, 0x2a4a8a)];
  for (const s of [1, -1]) {
    const engine = jet
      ? new THREE.CylinderGeometry(r * 0.38, r * 0.34, len * 0.12, 10).rotateX(Math.PI / 2).translate(s * span * 0.2, -r * 0.8, len * 0.08)
      : new THREE.CylinderGeometry(r * 0.3, r * 0.26, len * 0.14, 10).rotateX(Math.PI / 2).translate(s * span * 0.22, -r * 0.1, len * 0.1);
    parts.push(colored(engine, 0xb9bcc0));
  }
  return mergeGeometries(parts)!;
}

export class Planes {
  group = new THREE.Group();
  private flights: Flight[] = [];
  private navMats: THREE.MeshBasicMaterial[];
  private t = 0;

  constructor() {
    this.group.name = 'planes';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.2 });
    const red = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const green = new THREE.MeshBasicMaterial({ color: 0x20ff40 });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.navMats = [red, green, white];
    const kinds = [
      { geo: airframe(38, 34, true), len: 38, span: 34, speed: 95, alt: [800, 1500] as const },
      { geo: airframe(38, 34, true), len: 38, span: 34, speed: 95, alt: [800, 1500] as const },
      { geo: airframe(22, 27, false), len: 22, span: 27, speed: 70, alt: [350, 600] as const },
    ];
    const light = new THREE.SphereGeometry(0.9, 6, 4);
    for (const k of kinds) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(k.geo, mat));
      const l = new THREE.Mesh(light, red); l.position.set(-k.span / 2, 0, 0);
      const r = new THREE.Mesh(light, green); r.position.set(k.span / 2, 0, 0);
      const strobe = new THREE.Mesh(light, white); strobe.position.set(0, -k.len * 0.06, 0);
      g.add(l, r, strobe);
      g.userData.alt = k.alt;
      this.group.add(g);
      this.flights.push({ mesh: g, strobe, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: k.speed, left: 0 });
    }
    // stagger the first appearances
    this.flights.forEach((f, i) => { f.left = -i * 40 * f.speed; });
  }

  private launch(f: Flight, focus: THREE.Vector3) {
    // a straight track passing within a couple of km of the player, mostly along the coast (N-S)
    const heading = (Math.random() < 0.7 ? (Math.random() < 0.5 ? 0 : Math.PI) : Math.random() * Math.PI * 2) + (Math.random() - 0.5) * 0.6;
    f.dir.set(Math.sin(heading), 0, Math.cos(heading));
    const side = (Math.random() - 0.5) * 3000;
    const [lo, hi] = f.mesh.userData.alt as [number, number];
    f.pos.set(focus.x - f.dir.x * TRACK / 2 + f.dir.z * side, lo + Math.random() * (hi - lo), focus.z - f.dir.z * TRACK / 2 - f.dir.x * side);
    f.left = TRACK;
    f.mesh.rotation.set(0, heading, 0);
    f.mesh.visible = true;
  }

  update(dt: number, focus: THREE.Vector3, night: number) {
    this.t += dt;
    for (const f of this.flights) {
      if (f.left <= 0) {
        f.mesh.visible = false;
        f.left += dt * f.speed; // waiting: counts back up from a negative delay
        if (f.left >= 0) this.launch(f, focus);
        continue;
      }
      const step = f.speed * dt;
      f.pos.addScaledVector(f.dir, step);
      f.left -= step;
      if (f.left <= 0) f.left = -(30 + Math.random() * 90) * f.speed; // next one in 30 to 120 s
      f.mesh.position.copy(f.pos);
      f.strobe.visible = night > 0.3 && (this.t * 1.1) % 1 < 0.08;
    }
    const navOn = night > 0.3;
    for (const m of this.navMats) m.visible = navOn;
  }
}
