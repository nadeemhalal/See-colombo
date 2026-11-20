import * as THREE from 'three';

/**
 * Placeholder protagonist built from primitives with procedural animation.
 * Local forward is +Z. To be replaced by a rigged glTF character later (PRD 5.1).
 */
export class Character {
  root = new THREE.Group();
  private body = new THREE.Group();
  private torso: THREE.Group;
  private hipL = new THREE.Group(); private hipR = new THREE.Group();
  private kneeL = new THREE.Group(); private kneeR = new THREE.Group();
  private shL = new THREE.Group(); private shR = new THREE.Group();
  private elL = new THREE.Group(); private elR = new THREE.Group();
  private phase = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.7 });
    const shirt = new THREE.MeshStandardMaterial({ color: 0x9cc3e4, roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x2f3542, roughness: 0.9 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x2a201a, roughness: 0.8 });
    const hair = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.9 });
    const cap = (r: number, l: number, m: THREE.Material) => new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 10), m);

    this.root.add(this.body);

    // torso pivots at the hips so it can lean
    this.torso = new THREE.Group();
    this.torso.position.y = 0.95;
    this.body.add(this.torso);
    const chest = cap(0.17, 0.36, shirt);
    chest.scale.set(1.25, 1, 0.75);
    chest.position.y = 0.33;
    this.torso.add(chest);
    const pelvis = cap(0.15, 0.08, pants);
    pelvis.scale.set(1.2, 1, 0.8);
    pelvis.position.y = 0.02;
    this.torso.add(pelvis);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 8), skin);
    neck.position.y = 0.62;
    this.torso.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
    head.scale.set(0.9, 1.05, 1);
    head.position.y = 0.76;
    this.torso.add(head);
    const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.122, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
    hairM.position.set(0, 0.785, -0.012);
    hairM.scale.set(0.92, 1, 1.02);
    this.torso.add(hairM);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 6), skin);
    nose.position.set(0, 0.75, 0.11);
    this.torso.add(nose);

    // arms
    for (const [sh, el, side] of [[this.shL, this.elL, 1], [this.shR, this.elR, -1]] as const) {
      sh.position.set(0.25 * side, 0.52, 0);
      this.torso.add(sh);
      const sleeve = cap(0.062, 0.14, shirt);
      sleeve.position.y = -0.1;
      sh.add(sleeve);
      const upper = cap(0.048, 0.14, skin);
      upper.position.y = -0.2;
      sh.add(upper);
      el.position.y = -0.29;
      sh.add(el);
      const fore = cap(0.043, 0.2, skin);
      fore.position.y = -0.13;
      el.add(fore);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), skin);
      hand.position.y = -0.28;
      el.add(hand);
    }

    // legs
    for (const [hip, knee, side] of [[this.hipL, this.kneeL, 1], [this.hipR, this.kneeR, -1]] as const) {
      hip.position.set(0.1 * side, 0.93, 0);
      this.body.add(hip);
      const thigh = cap(0.078, 0.32, pants);
      thigh.position.y = -0.22;
      hip.add(thigh);
      knee.position.y = -0.45;
      hip.add(knee);
      const shin = cap(0.066, 0.32, pants);
      shin.position.y = -0.2;
      knee.add(shin);
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.25), shoe);
      foot.position.set(0, -0.44, 0.05);
      knee.add(foot);
    }

    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  }

  /** driving pose: sitting with hands on the handlebar */
  seated = false;

  /** speed in m/s, airborne state, vertical velocity */
  animate(dt: number, speed: number, onGround: boolean, velY: number, sprint: boolean) {
    if (this.seated) {
      this.hipL.rotation.x = this.hipR.rotation.x = -1.45;
      this.kneeL.rotation.x = this.kneeR.rotation.x = 1.35;
      this.shL.rotation.x = this.shR.rotation.x = -0.95;
      this.elL.rotation.x = this.elR.rotation.x = -0.45;
      this.shL.rotation.z = 0.25;
      this.shR.rotation.z = -0.25;
      this.torso.rotation.x = 0.05;
      this.body.position.y = 0;
      return;
    }
    const moving = speed > 0.2;
    const amp = Math.min(speed / 6.5, 1) * (sprint ? 1.0 : 0.85);
    this.phase += dt * (moving ? 2.2 + speed * 1.25 : 0);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const swing = moving ? s * (0.35 + amp * 0.6) : 0;

    if (onGround) {
      this.hipL.rotation.x = -swing;
      this.hipR.rotation.x = swing;
      this.kneeL.rotation.x = moving ? Math.max(0, c) * (0.4 + amp * 1.1) : 0.02;
      this.kneeR.rotation.x = moving ? Math.max(0, -c) * (0.4 + amp * 1.1) : 0.02;
      this.shL.rotation.x = swing * 0.9;
      this.shR.rotation.x = -swing * 0.9;
      this.elL.rotation.x = -0.25 - amp * 0.9;
      this.elR.rotation.x = -0.25 - amp * 0.9;
      this.body.position.y = moving ? Math.abs(c) * 0.05 * (0.5 + amp) : Math.sin(performance.now() * 0.002) * 0.005;
      this.torso.rotation.x = moving ? 0.05 + amp * 0.22 : 0;
    } else {
      // airborne pose
      const k = THREE.MathUtils.clamp(velY / 6, -1, 1);
      this.hipL.rotation.x = -0.6; this.hipR.rotation.x = 0.1;
      this.kneeL.rotation.x = 0.9; this.kneeR.rotation.x = 0.5;
      this.shL.rotation.x = -0.6 - k * 0.6; this.shR.rotation.x = -0.6 - k * 0.6;
      this.elL.rotation.x = -0.5; this.elR.rotation.x = -0.5;
      this.torso.rotation.x = 0.12;
      this.body.position.y = 0;
    }
    this.shL.rotation.z = 0.08;
    this.shR.rotation.z = -0.08;
  }
}
