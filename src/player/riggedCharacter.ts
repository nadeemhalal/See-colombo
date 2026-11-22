import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { addLampLight } from '../world/lamplight';
import { OUTFITS, palmFabric, type Outfit } from './character';
import { SPEED } from './controller';

/**
 * The protagonist as a rigged, skinned glTF model (public/models/player.glb) played with real
 * animation clips. Same outside interface as the procedural Character, so main.ts can use either.
 * Local forward is +Z, feet on y = 0.
 *
 * Swapping in another model: any .glb with a humanoid skeleton works as long as it carries clips
 * whose names match CLIP_NAMES below (case-insensitive). Missing optional clips fall back sensibly.
 */

export interface PlayerFigure {
  root: THREE.Object3D;
  seated: boolean;
  outfit: number;
  setOutfit(i: number): Outfit;
  punch(): boolean;
  animate(dt: number, speed: number, onGround: boolean, velY: number, sprint: boolean): void;
}

const HEIGHT = 1.74;
const PUNCH_SPEED = 1.7;
/** multiplied into the textures: near-black hair, and skin nudged toward the player's portrait */
const HAIR_TINT = 0x2a211b;
const SKIN_TINT = 0xe2cbbb;

/** name patterns per animation slot, first match wins */
const CLIP_NAMES: Record<string, RegExp[]> = {
  idle: [/^idle_loop$/i, /^idle$/i, /idle/i],
  walk: [/^walk_loop$/i, /^walk_fwd/i, /^walk/i],
  jog: [/^jog_fwd_loop$/i, /^jog/i, /^run$/i, /run_loop/i],
  sprint: [/^sprint_loop$/i, /sprint/i, /run_fast/i],
  jumpUp: [/^jump_start$/i, /jump_up/i, /^jump$/i],
  air: [/^jump_loop$/i, /fall/i, /jump_idle/i],
  punchL: [/punch_jab/i, /punch_left/i, /^punch/i],
  punchR: [/punch_cross/i, /punch_right/i, /^punch/i],
  sit: [/driving/i, /sitting_idle/i, /sit.*loop/i, /^sit/i],
};

/** natural ground speed of each locomotion clip, for matching foot speed to the controller */
const LOCO = [
  { key: 'walk', speed: SPEED.walk },
  { key: 'jog', speed: SPEED.jog },
  { key: 'sprint', speed: SPEED.sprint },
] as const;

/** bones the punch overrides (the legs keep walking underneath) */
const UPPER = /spine|chest|neck|head|clavicle|shoulder|upperarm|lowerarm|forearm|arm|hand|finger|thumb|index|middle|ring|pinky/i;

/** bones whose skin is covered by each piece of clothing (Rigify "DEF-" names, other rigs mostly match) */
const SHIRT = /spine|chest|shoulder|clavicle|upper_?arm/i;
const LOWER = /hips|pelvis|thigh|shin|calf|upper_?leg|lower_?leg/i;
const SHOE = /foot|toe|ball/i;
/** meshes that are never dressed */
const NOT_CLOTHED = /hair|eye|brow|lash|teeth|tongue|beard/i;

const damp =(cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class RiggedCharacter implements PlayerFigure {
  root = new THREE.Group();
  seated = false;
  outfit = 0;

  private mixer: THREE.AnimationMixer;
  private model: THREE.Object3D;
  private baseY = 0;
  private hips: THREE.Object3D | null = null;
  private standHipY = 0;
  private tmp = new THREE.Vector3();
  private actions: Record<string, THREE.AnimationAction | undefined> = {};
  private w: Record<string, number> = {};
  private phase = 0;
  private punchT = 0;
  private punchSide = 0;
  /** clothing colours, shared by every dressed mesh */
  private cloth = {
    uShirt: { value: new THREE.Color() },
    uLower: { value: new THREE.Color() },
    uShoe: { value: new THREE.Color() },
    uFabric: { value: null as THREE.Texture | null },
    uUseFabric: { value: 0 },
    uFabricScale: { value: 1 },
  };

  /**
   * Paint clothes onto a bare base body: each vertex is shirt, trousers or shoe according to the
   * bones it follows (torso and upper arms = short-sleeved shirt, hips and legs = trousers,
   * feet = shoes). Works on any body rigged to the same skeleton, and recolours instantly.
   */
  private dress(mesh: THREE.SkinnedMesh) {
    const g = mesh.geometry;
    const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
    if (!si || !sw) return;
    const region = mesh.skeleton.bones.map((b) => (SHIRT.test(b.name) ? 0 : LOWER.test(b.name) ? 1 : SHOE.test(b.name) ? 2 : -1));
    const cloth = new Float32Array(si.count * 3);
    for (let v = 0; v < si.count; v++) {
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(v, k);
        const r = region[si.getComponent(v, k)];
        if (w > 0 && r >= 0) cloth[v * 3 + r] += w;
      }
    }
    g.setAttribute('aCloth', new THREE.BufferAttribute(cloth, 3));
    // fabric pattern repeats per metre of the body, whatever units the model was built in
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const hGeom = Math.max(bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    this.cloth.uFabricScale.value = (HEIGHT / Math.max(hGeom, 1e-4)) * 2.4;

    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.cloth);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 aCloth;
          varying vec3 vCloth;
          varying vec3 vClothP;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vCloth = aCloth;
          vClothP = position;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCloth;
          varying vec3 vClothP;
          uniform vec3 uShirt;
          uniform vec3 uLower;
          uniform vec3 uShoe;
          uniform sampler2D uFabric;
          uniform float uUseFabric;
          uniform float uFabricScale;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 cw = smoothstep(0.38, 0.62, vCloth);
            vec3 shirtC = uShirt;
            if (uUseFabric > 0.5) shirtC = texture2D(uFabric, vec2(vClothP.x + vClothP.z, vClothP.y) * uFabricScale).rgb;
            diffuseColor.rgb = mix(diffuseColor.rgb, shirtC, cw.x);
            diffuseColor.rgb = mix(diffuseColor.rgb, uLower, cw.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, uShoe, cw.z);
          }`);
    };
    mat.customProgramCacheKey = () => 'player-cloth';
    mesh.material = mat;
  }

  /** Loads the model; resolves to null if the file is missing or broken, so the caller can fall back. */
  static async load(url: string): Promise<RiggedCharacter | null> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      if (!gltf.animations.length) { console.warn('player.glb has no animations, using the built-in character'); return null; }
      return new RiggedCharacter(gltf.scene, gltf.animations);
    } catch (e) {
      console.warn('Could not load the rigged player model, using the built-in character', e);
      return null;
    }
  }

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    // scale to a fixed height with the feet on y = 0
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const s = HEIGHT / Math.max(0.01, box.max.y - box.min.y);
    model.scale.multiplyScalar(s);
    model.position.y -= box.min.y * s;
    this.root.add(model);
    this.model = model;
    this.baseY = model.position.y;
    // the game seats the figure by its standing hip height (as the old figure did), so remember it
    model.traverse((o) => { if (!this.hips && /hips|pelvis/i.test(o.name) && (o as THREE.Bone).isBone) this.hips = o; });
    if (this.hips) {
      this.root.updateMatrixWorld(true);
      this.standHipY = this.hips.getWorldPosition(new THREE.Vector3()).y - this.root.position.y;
    }

    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.castShadow = true;
      m.receiveShadow = true;
      // skinned bounds don't follow the animation; the figure is always near the camera anyway
      m.frustumCulled = false;
      const sk = m as THREE.SkinnedMesh;
      const dressed = sk.isSkinnedMesh && !NOT_CLOTHED.test(`${m.name} ${(m.material as THREE.Material).name}`);
      if (dressed) this.dress(sk);
      const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshStandardMaterial[];
      for (const mt of mats) {
        if (!mt.isMeshStandardMaterial) continue;
        // the hairstyle textures are neutral grey, meant to be tinted
        if (/hair|brow|beard/i.test(`${m.name} ${mt.name}`)) mt.color.setHex(HAIR_TINT);
        // skin: the pack's roughness map reads glossy and washed out under the tropical sun
        if (dressed) { mt.roughnessMap = null; mt.metalnessMap = null; mt.roughness = 0.66; mt.metalness = 0; mt.color.setHex(SKIN_TINT); }
        addLampLight(mt);
      }
    });

    this.mixer = new THREE.AnimationMixer(model);
    const find = (key: string) => {
      for (const re of CLIP_NAMES[key]) {
        const c = clips.find((cl) => re.test(cl.name));
        if (c) return c;
      }
      return undefined;
    };
    for (const key of Object.keys(CLIP_NAMES)) {
      let clip = find(key);
      if (!clip) continue;
      if (key === 'punchL' || key === 'punchR') {
        // upper body only, so a punch thrown while walking keeps the legs walking
        clip = clip.clone();
        clip.tracks = clip.tracks.filter((t) => UPPER.test(t.name.split('.')[0]));
      }
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      if (key === 'jumpUp' || key.startsWith('punch')) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      // the library's punches start from a guard stance and run about a second; play them snappier
      if (key.startsWith('punch')) a.timeScale = PUNCH_SPEED;
      a.play();
      this.actions[key] = a;
      this.w[key] = 0;
    }
    // locomotion clips are driven by hand (shared phase), not by the mixer clock
    for (const l of LOCO) if (this.actions[l.key]) this.actions[l.key]!.timeScale = 0;
    if (this.actions.idle) this.w.idle = 1;
    this.setOutfit(0);
  }

  setOutfit(i: number) {
    this.outfit = ((i % OUTFITS.length) + OUTFITS.length) % OUTFITS.length;
    const o = OUTFITS[this.outfit];
    this.cloth.uShirt.value.setHex(o.shirt);
    this.cloth.uUseFabric.value = o.print === 'palm' ? 1 : 0;
    if (o.print === 'palm') this.cloth.uFabric.value = palmFabric();
    this.cloth.uLower.value.setHex(o.lower);
    this.cloth.uShoe.value.setHex(o.sneakers ? 0xf0f0ec : o.slipper);
    return o;
  }

  punch(): boolean {
    if (this.punchT > 0 || !(this.actions.punchL || this.actions.punchR)) return false;
    this.punchT = 1e-4;
    this.punchSide = 1 - this.punchSide;
    const a = this.punchSide === 0 ? this.actions.punchL : this.actions.punchR ?? this.actions.punchL;
    a?.reset().play();
    return true;
  }

  animate(dt: number, speed: number, onGround: boolean, velY: number, sprint: boolean) {
    const target: Record<string, number> = {};
    for (const k of Object.keys(this.w)) target[k] = 0;

    if (this.seated) {
      if (this.actions.sit) target.sit = 1; else target.idle = 1;
    } else if (!onGround) {
      if (velY > 0.5 && this.actions.jumpUp) target.jumpUp = 1;
      else if (this.actions.air) target.air = 1;
      else target.jumpUp = 1;
    } else {
      // blend idle → walk → jog → sprint by speed
      const v = sprint ? Math.max(speed, SPEED.jog + 0.01) : speed;
      if (v < 0.15) target.idle = 1;
      else if (v <= SPEED.walk) { const t = v / SPEED.walk; target.idle = 1 - t; target.walk = t; }
      else if (v <= SPEED.jog) { const t = (v - SPEED.walk) / (SPEED.jog - SPEED.walk); target.walk = 1 - t; target.jog = t; }
      else { const t = Math.min(1, (v - SPEED.jog) / (SPEED.sprint - SPEED.jog)); target.jog = 1 - t; target.sprint = t; }
      // missing clips hand their weight to the nearest one that exists
      if (!this.actions.sprint) { target.jog = (target.jog ?? 0) + (target.sprint ?? 0); target.sprint = 0; }
      if (!this.actions.jog) { target.walk = (target.walk ?? 0) + (target.jog ?? 0); target.jog = 0; }
      // shared stride phase: advance at the rate the blended clips would, scaled to the real speed
      let rate = 0, wsum = 0;
      for (const l of LOCO) {
        const a = this.actions[l.key], wt = target[l.key] ?? 0;
        if (!a || wt <= 0) continue;
        rate += wt * (Math.max(speed, 0.4) / l.speed) / a.getClip().duration;
        wsum += wt;
      }
      if (wsum > 0) this.phase = (this.phase + dt * rate / wsum) % 1;
    }
    if (!this.seated && onGround && this.w.jumpUp > 0.01 && this.actions.jumpUp) this.actions.jumpUp.reset();

    // fade weights (fast in the air so the jump reads immediately)
    const rate = !onGround ? 14 : 9;
    for (const k of Object.keys(this.w)) {
      if (k.startsWith('punch')) continue;
      this.w[k] = damp(this.w[k], target[k] ?? 0, rate, dt);
      this.actions[k]?.setEffectiveWeight(this.w[k]);
    }
    for (const l of LOCO) {
      const a = this.actions[l.key];
      if (a) a.time = this.phase * a.getClip().duration;
    }

    // punch: a heavy weight on the upper body overrides the walk/idle underneath
    if (this.punchT > 0) {
      const a = this.punchSide === 0 ? this.actions.punchL : this.actions.punchR ?? this.actions.punchL;
      const D = a ? a.getClip().duration / PUNCH_SPEED : 0.5;
      this.punchT += dt;
      const t = this.punchT / D;
      const e = t < 0.15 ? t / 0.15 : t > 0.8 ? Math.max(0, (1 - t) / 0.2) : 1;
      a?.setEffectiveWeight(e * 20);
      if (t >= 1) { this.punchT = 0; a?.setEffectiveWeight(0); }
    }
    this.mixer.update(dt);

    // seated clips put the hips at chair height above the feet; lift the body so the hips sit
    // where the vehicle seat expects them (the standing hip height above the seat point)
    const sitW = this.w.sit ?? 0;
    this.model.position.y = this.baseY;
    if (this.hips && sitW > 0.001) {
      this.root.updateMatrixWorld(true);
      const hipY = this.hips.getWorldPosition(this.tmp).y - this.root.getWorldPosition(new THREE.Vector3()).y;
      this.model.position.y = this.baseY + (this.standHipY - hipY) * sitW;
    }
  }
}
