import * as THREE from 'three';

/**
 * The protagonist: a procedural, jointed figure (no external assets) with a hand-tuned gait.
 * Local forward is +Z, feet on y = 0, about 1.72 m tall.
 *
 * Joint conventions (rotation.x): hips/shoulders negative = forward, knees positive = bend,
 * elbows negative = bend, ankles positive = toes down.
 */

export interface Outfit {
  name: string;
  shirt: number;
  /** trousers colour, or a sarong colour when `sarong` is set */
  lower: number;
  sarong?: boolean;
  /** t-shirt (no collar or buttons) instead of a collared shirt */
  tee?: boolean;
  slipper: number;
}

export const OUTFITS: Outfit[] = [
  { name: 'Office shirt and trousers', shirt: 0x9cc3e4, lower: 0x2f3542, slipper: 0x23324d },
  { name: 'Sarong and white shirt', shirt: 0xf1eee6, lower: 0x2c4a7a, sarong: true, slipper: 0x6b4a2e },
  { name: 'T-shirt and jeans', shirt: 0xc0392b, lower: 0x3b5373, tee: true, slipper: 0x1f1f1f },
  { name: 'Batik shirt', shirt: 0xd9822b, lower: 0x4a4038, slipper: 0x3a2a1d },
];

const SKIN = 0x8a5a3c;
const HAIR = 0x15110e;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const damp = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

interface Leg { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }
interface Arm { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group }

export class Character {
  root = new THREE.Group();
  /** driving pose: sitting with hands on the handlebar */
  seated = false;
  outfit = 0;

  private body = new THREE.Group(); // vertical bob, landing squash
  private pelvis = new THREE.Group(); // hip yaw / roll
  private spine = new THREE.Group(); // lean, counter-rotation
  private chest = new THREE.Group(); // breathing
  private neck = new THREE.Group();
  private head = new THREE.Group();
  private legs: [Leg, Leg];
  private arms: [Arm, Arm];

  private mat: Record<'skin' | 'shirt' | 'lower' | 'leg' | 'slipper' | 'sole' | 'hair' | 'eye' | 'iris' | 'lip' | 'belt' | 'button', THREE.MeshStandardMaterial>;
  private trouserParts: THREE.Object3D[] = [];
  private sarongParts: THREE.Object3D[] = [];
  private collarParts: THREE.Object3D[] = [];
  private sarong: THREE.Mesh;

  // animation state
  private phase = 0;
  private amp = 0;
  private run = 0;
  private lastYaw = 0;
  private bank = 0;
  private landT = 0;
  private wasGround = true;
  private fallV = 0;
  private time = 0;
  private lookT = 2;
  private look = 0;
  private lookTarget = 0;

  constructor() {
    const std = (color: number, roughness = 0.8) => new THREE.MeshStandardMaterial({ color, roughness });
    this.mat = {
      skin: std(SKIN, 0.65), shirt: std(0x9cc3e4, 0.85), lower: std(0x2f3542, 0.9), leg: std(0x2f3542, 0.9),
      slipper: std(0x23324d, 0.7), sole: std(0xe8e4dc, 0.9), hair: std(HAIR, 0.75), eye: std(0xf2efe8, 0.4),
      iris: std(0x1c120c, 0.3), lip: std(0x5e3426, 0.6), belt: std(0x2a1f18, 0.5), button: std(0xf4f2ec, 0.4),
    };
    const m = this.mat;
    const mesh = (g: THREE.BufferGeometry, mt: THREE.Material, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, mt);
      o.position.set(x, y, z);
      return o;
    };
    const lathe = (profile: [number, number][], segs = 20) =>
      new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);

    this.root.add(this.body);
    this.body.add(this.pelvis);
    this.pelvis.position.y = 0.93;

    // ---- pelvis: trousers seat, belt, sarong
    const seat = mesh(new THREE.SphereGeometry(0.16, 18, 12), m.lower, 0, 0.0, -0.005);
    seat.scale.set(1.12, 0.8, 0.82);
    this.pelvis.add(seat);
    this.trouserParts.push(seat);
    const belt = mesh(new THREE.CylinderGeometry(0.162, 0.165, 0.045, 20), m.belt, 0, 0.085, 0);
    belt.scale.set(1.1, 1, 0.8);
    this.pelvis.add(belt);
    this.trouserParts.push(belt);
    // profile runs bottom to top so the lathe faces point outwards; the shirt hides the waist
    this.sarong = mesh(lathe([[0.0, -0.8], [0.22, -0.8], [0.215, -0.6], [0.2, -0.25], [0.18, 0.05], [0.168, 0.12]]), m.lower);
    this.sarong.scale.set(1.08, 1, 0.84);
    this.pelvis.add(this.sarong);
    this.sarongParts.push(this.sarong);

    // ---- spine and chest: a lathed torso with an untucked shirt hem
    this.pelvis.add(this.spine);
    this.spine.position.y = 0.06;
    this.spine.add(this.chest);
    const torso = mesh(lathe([
      // the shirt hangs untucked, past the belt
      [0.0, -0.13], [0.192, -0.13], [0.19, -0.04], [0.176, 0.06], [0.168, 0.15], [0.175, 0.27], [0.19, 0.38],
      [0.188, 0.45], [0.15, 0.5], [0.08, 0.53], [0.0, 0.53],
    ], 22), m.shirt);
    torso.scale.set(1.12, 1, 0.76);
    this.chest.add(torso);
    // collar and buttons (hidden for the t-shirt)
    const collar = mesh(new THREE.TorusGeometry(0.068, 0.017, 6, 16, Math.PI * 1.5), m.shirt, 0, 0.53, 0.005);
    collar.rotation.set(Math.PI / 2, 0, Math.PI * 0.75);
    this.chest.add(collar);
    this.collarParts.push(collar);
    for (let i = 0; i < 4; i++) {
      const b = mesh(new THREE.SphereGeometry(0.009, 6, 4), m.button, 0, 0.44 - i * 0.11, 0.129 - i * 0.002);
      this.chest.add(b);
      this.collarParts.push(b);
    }
    const placket = mesh(new THREE.BoxGeometry(0.03, 0.46, 0.006), m.shirt, 0, 0.24, 0.124);
    this.chest.add(placket);
    this.collarParts.push(placket);

    // ---- neck and head
    this.neck.position.y = 0.5;
    this.chest.add(this.neck);
    this.neck.add(mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.11, 12), m.skin, 0, 0.04, 0));
    this.head.position.y = 0.075;
    this.neck.add(this.head);
    const skull = mesh(new THREE.SphereGeometry(0.105, 22, 16), m.skin, 0, 0.1, -0.005);
    skull.scale.set(0.86, 1.04, 0.98);
    this.head.add(skull);
    const jaw = mesh(new THREE.SphereGeometry(0.075, 16, 10), m.skin, 0, 0.045, 0.022);
    jaw.scale.set(1.05, 0.85, 1);
    this.head.add(jaw);
    for (const s of [1, -1]) {
      const ear = mesh(new THREE.SphereGeometry(0.024, 8, 6), m.skin, 0.088 * s, 0.1, -0.005);
      ear.scale.set(0.45, 1, 0.8);
      this.head.add(ear);
      this.head.add(mesh(new THREE.SphereGeometry(0.0145, 10, 8), m.eye, 0.033 * s, 0.115, 0.083));
      this.head.add(mesh(new THREE.SphereGeometry(0.0085, 8, 6), m.iris, 0.033 * s, 0.115, 0.095));
      const brow = mesh(new THREE.BoxGeometry(0.032, 0.008, 0.01), m.hair, 0.034 * s, 0.137, 0.088);
      brow.rotation.z = -0.12 * s;
      this.head.add(brow);
    }
    const nose = mesh(new THREE.ConeGeometry(0.016, 0.042, 8), m.skin, 0, 0.09, 0.1);
    nose.rotation.x = Math.PI / 2 - 0.35;
    this.head.add(nose);
    this.head.add(mesh(new THREE.BoxGeometry(0.036, 0.007, 0.01), m.lip, 0, 0.048, 0.091));
    const tache = mesh(new THREE.BoxGeometry(0.05, 0.011, 0.012), m.hair, 0, 0.064, 0.094); // moustache
    this.head.add(tache);
    const hair = mesh(new THREE.SphereGeometry(0.112, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m.hair, 0, 0.115, -0.012);
    hair.scale.set(0.9, 0.95, 1.02);
    this.head.add(hair);
    const back = mesh(new THREE.SphereGeometry(0.1, 16, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.35), m.hair, 0, 0.1, -0.022);
    back.scale.set(0.9, 1, 0.95);
    back.rotation.x = -0.5;
    this.head.add(back);

    // ---- arms
    const makeArm = (side: number): Arm => {
      const shoulder = new THREE.Group();
      shoulder.position.set(0.205 * side, 0.43, -0.005);
      this.chest.add(shoulder);
      const sleeve = mesh(new THREE.CylinderGeometry(0.068, 0.06, 0.2, 14), m.shirt, 0, -0.08, 0);
      shoulder.add(sleeve);
      shoulder.add(mesh(new THREE.SphereGeometry(0.068, 14, 10), m.shirt, 0, 0, 0));
      shoulder.add(mesh(new THREE.CylinderGeometry(0.044, 0.038, 0.2, 12), m.skin, 0, -0.2, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -0.29;
      shoulder.add(elbow);
      elbow.add(mesh(new THREE.SphereGeometry(0.038, 10, 8), m.skin));
      elbow.add(mesh(new THREE.CylinderGeometry(0.037, 0.03, 0.24, 12), m.skin, 0, -0.12, 0));
      const wrist = new THREE.Group();
      wrist.position.y = -0.245;
      elbow.add(wrist);
      const palm = mesh(new THREE.BoxGeometry(0.035, 0.085, 0.07), m.skin, 0, -0.045, 0.004);
      wrist.add(palm);
      const fingers = mesh(new THREE.CapsuleGeometry(0.022, 0.04, 3, 8), m.skin, 0, -0.1, 0.01);
      fingers.scale.set(0.8, 1, 1.4);
      wrist.add(fingers);
      const thumb = mesh(new THREE.CapsuleGeometry(0.011, 0.03, 3, 6), m.skin, -0.012 * side, -0.05, 0.04);
      thumb.rotation.x = 0.6;
      wrist.add(thumb);
      return { shoulder, elbow, wrist };
    };
    this.arms = [makeArm(1), makeArm(-1)];

    // ---- legs, with rubber slippers
    const makeLeg = (side: number): Leg => {
      const hip = new THREE.Group();
      hip.position.set(0.092 * side, -0.02, 0);
      this.pelvis.add(hip);
      const thigh = mesh(new THREE.CylinderGeometry(0.083, 0.063, 0.44, 14), m.leg, 0, -0.22, 0);
      hip.add(thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      knee.add(mesh(new THREE.SphereGeometry(0.062, 12, 8), m.leg));
      const shin = mesh(new THREE.CylinderGeometry(0.06, 0.047, 0.4, 14), m.leg, 0, -0.2, 0);
      knee.add(shin);
      const ankle = new THREE.Group();
      ankle.position.y = -0.4;
      knee.add(ankle);
      ankle.add(mesh(new THREE.SphereGeometry(0.042, 10, 8), m.skin));
      const foot = mesh(new THREE.CapsuleGeometry(0.04, 0.13, 4, 10), m.skin, 0, -0.035, 0.055);
      foot.rotation.x = Math.PI / 2;
      foot.scale.set(1.15, 1, 0.65);
      ankle.add(foot);
      const sole = mesh(new THREE.BoxGeometry(0.1, 0.018, 0.27), m.sole, 0, -0.064, 0.05);
      ankle.add(sole);
      const strapTop = mesh(new THREE.BoxGeometry(0.1, 0.012, 0.02), m.slipper, 0, -0.053, 0.05);
      ankle.add(strapTop);
      for (const s of [1, -1]) {
        const strap = mesh(new THREE.BoxGeometry(0.012, 0.012, 0.09), m.slipper, 0.025 * s, -0.04, 0.1);
        strap.rotation.y = -0.4 * s;
        ankle.add(strap);
      }
      return { hip, knee, ankle };
    };
    this.legs = [makeLeg(1), makeLeg(-1)];

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    this.setOutfit(0);
  }

  setOutfit(i: number) {
    this.outfit = ((i % OUTFITS.length) + OUTFITS.length) % OUTFITS.length;
    const o = OUTFITS[this.outfit];
    this.mat.shirt.color.setHex(o.shirt);
    this.mat.lower.color.setHex(o.lower);
    // under a sarong the legs are bare
    this.mat.leg.color.setHex(o.sarong ? SKIN : o.lower);
    this.mat.slipper.color.setHex(o.slipper);
    for (const p of this.trouserParts) p.visible = !o.sarong;
    for (const p of this.sarongParts) p.visible = !!o.sarong;
    for (const p of this.collarParts) p.visible = !o.tee;
    return o;
  }

  /** speed in m/s, airborne state, vertical velocity */
  animate(dt: number, speed: number, onGround: boolean, velY: number, sprint: boolean) {
    this.time += dt;
    const [L, R] = this.legs;
    const [AL, AR] = this.arms;

    // turning lean, from how fast the root is being turned
    let dYaw = this.root.rotation.y - this.lastYaw;
    dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
    this.lastYaw = this.root.rotation.y;
    const yawRate = dt > 0 ? dYaw / dt : 0;

    if (this.seated) {
      this.pose(-1.45, 1.35, 0.15, -0.95, -0.45, 0.25);
      this.spine.rotation.set(0.05, 0, 0);
      this.pelvis.rotation.set(0, 0, 0);
      this.body.position.y = 0;
      this.body.rotation.z = 0;
      this.head.rotation.set(0, 0, 0);
      return;
    }

    // landing squash
    if (onGround && !this.wasGround && this.fallV < -3.5) this.landT = Math.min(0.32, -this.fallV * 0.035);
    this.wasGround = onGround;
    if (!onGround) this.fallV = velY;
    this.landT = Math.max(0, this.landT - dt);
    const land = this.landT > 0 ? Math.sin((this.landT / 0.32) * Math.PI) : 0;

    if (!onGround) {
      // airborne: tuck on the way up, reach down for the ground on the way down
      const up = THREE.MathUtils.clamp(velY / 6, -1, 1);
      const tuck = 0.5 + up * 0.4;
      L.hip.rotation.x = damp(L.hip.rotation.x, -0.75 * tuck - 0.1, 14, dt);
      L.knee.rotation.x = damp(L.knee.rotation.x, 1.2 * tuck + 0.2, 14, dt);
      R.hip.rotation.x = damp(R.hip.rotation.x, 0.15, 14, dt);
      R.knee.rotation.x = damp(R.knee.rotation.x, 0.7 * tuck + 0.25, 14, dt);
      L.ankle.rotation.x = damp(L.ankle.rotation.x, 0.25, 10, dt);
      R.ankle.rotation.x = damp(R.ankle.rotation.x, 0.4, 10, dt);
      for (const [a, s] of [[AL, 1], [AR, -1]] as const) {
        a.shoulder.rotation.x = damp(a.shoulder.rotation.x, -0.5 - up * 0.6, 10, dt);
        a.shoulder.rotation.z = damp(a.shoulder.rotation.z, 0.35 * s, 10, dt);
        a.elbow.rotation.x = damp(a.elbow.rotation.x, -0.6, 10, dt);
      }
      this.spine.rotation.x = damp(this.spine.rotation.x, 0.12, 8, dt);
      this.body.position.y = 0;
      return;
    }

    // ---- gait
    const moving = speed > 0.15;
    this.run = damp(this.run, smooth(2.4, 4.6, speed), 6, dt);
    const targetAmp = moving ? Math.min(1, 0.35 + speed * 0.16) + (sprint ? 0.12 : 0) : 0;
    this.amp = damp(this.amp, targetAmp, 7, dt);
    const freq = 0.55 + 0.17 * Math.min(speed, 7); // stride cycles per second
    if (moving) this.phase += dt * Math.PI * 2 * freq;
    const a = this.amp, run = this.run;

    const leg = (l: Leg, p: number) => {
      const fwd = Math.sin(p); // +1 leg fully forward
      const swing = Math.cos(p) > 0; // moving forward through the air
      const hipFlex = fwd * a * (0.45 + run * 0.35) + run * 0.12 * a;
      const kneeSwing = Math.pow(Math.max(0, Math.cos(p)), 1.4) * a * (0.65 + run * 1.05);
      const kneeStance = Math.max(0, -Math.cos(p)) * a * (0.06 + run * 0.25);
      const knee = (swing ? kneeSwing : kneeStance) + 0.03 + land * 0.9;
      const hipRot = -hipFlex - land * 0.55;
      // heel strike toes up, push-off toes down, otherwise keep the foot level
      const behind = Math.max(0, -fwd);
      const footPitch = a * (-0.22 * Math.max(0, fwd) * (swing ? 0.3 : 1) + 0.75 * behind * behind * (swing ? 1 : 0.35));
      l.hip.rotation.x = hipRot;
      l.knee.rotation.x = knee;
      l.ankle.rotation.x = footPitch - (hipRot + knee) * (moving ? 1 : 0.6);
      l.hip.rotation.z = 0;
    };
    leg(L, this.phase);
    leg(R, this.phase + Math.PI);

    // arms swing against the legs; elbows bend more when running
    const armSwing = a * (0.38 + run * 0.4);
    for (const [arm, p, s] of [[AL, this.phase, 1], [AR, this.phase + Math.PI, -1]] as const) {
      const sw = Math.sin(p);
      arm.shoulder.rotation.x = sw * armSwing - run * 0.15;
      arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, (0.07 + run * 0.06) * s, 8, dt);
      arm.elbow.rotation.x = -(0.22 + run * 1.25 + Math.max(0, -sw) * a * (0.25 + run * 0.4));
      arm.wrist.rotation.x = -0.1;
    }

    // hips and torso
    const bob = a * (0.022 + run * 0.035);
    const idleBreath = Math.sin(this.time * 1.7);
    this.body.position.y = (moving ? Math.cos(this.phase * 2) * bob - bob * 0.6 : idleBreath * 0.003) - land * 0.14;
    this.pelvis.rotation.y = Math.sin(this.phase) * a * 0.14;
    this.pelvis.rotation.z = moving ? Math.cos(this.phase) * a * 0.045 : Math.sin(this.time * 0.4) * 0.02;
    this.spine.rotation.y = -Math.sin(this.phase) * a * (0.16 + run * 0.1);
    const lean = (moving ? 0.03 + run * 0.17 + (sprint ? 0.06 : 0) : 0) + land * 0.25;
    this.spine.rotation.x = damp(this.spine.rotation.x, lean, 6, dt);
    this.chest.scale.set(1, 1 + idleBreath * 0.006, 1 + idleBreath * 0.01);

    // lean into turns
    const bankT = THREE.MathUtils.clamp(-yawRate * speed * 0.035, -0.22, 0.22);
    this.bank = damp(this.bank, bankT, 6, dt);
    this.body.rotation.z = this.bank;

    // head: steady while moving, looks around now and then while standing
    this.lookT -= dt;
    if (this.lookT <= 0) {
      this.lookT = 2.5 + Math.random() * 4;
      this.lookTarget = moving ? 0 : (Math.random() - 0.5) * 1.3;
    }
    if (moving) this.lookTarget = 0;
    this.look = damp(this.look, this.lookTarget, 2.5, dt);
    this.head.rotation.y = this.look - this.spine.rotation.y - this.pelvis.rotation.y;
    this.head.rotation.x = -lean * 0.6;
    this.head.rotation.z = -this.bank * 0.5;
  }

  /** static pose helper for sitting */
  private pose(hip: number, knee: number, ankle: number, shoulder: number, elbow: number, spread: number) {
    for (const l of this.legs) { l.hip.rotation.set(hip, 0, 0); l.knee.rotation.x = knee; l.ankle.rotation.x = ankle; }
    this.arms[0].shoulder.rotation.set(shoulder, 0, spread);
    this.arms[1].shoulder.rotation.set(shoulder, 0, -spread);
    for (const a of this.arms) a.elbow.rotation.x = elbow;
  }
}
