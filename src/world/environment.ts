import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

const LAT = 6.93, LON = 79.85, TZ_MERIDIAN = 82.5; // Sri Lanka is UTC+5:30

/** Sun direction for Colombo at a given local clock time (minutes since midnight) and day of year. */
export function sunDirection(minutes: number, dayOfYear: number, out = new THREE.Vector3()) {
  const rad = Math.PI / 180;
  const decl = 23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365) * rad;
  const B = (2 * Math.PI * (dayOfYear - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const solar = minutes + 4 * (LON - TZ_MERIDIAN) + eot;
  const H = (solar / 60 - 12) * 15 * rad;
  const phi = LAT * rad;
  const sinEl = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(sinEl);
  // azimuth measured from south, positive toward west
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi));
  // world: +x east, +z south
  return out.set(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
}

export class Environment {
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xffffff, 3);
  hemi = new THREE.HemisphereLight(0xbfd6ee, 0x6b5f4a, 0.8);
  fog = new THREE.FogExp2(0xcdd6dc, 0.00028);
  sunDir = new THREE.Vector3(0, 1, 0);
  /** 0 day .. 1 night */
  night = 0;
  sunColor = new THREE.Color();
  horizon = new THREE.Color();

  private pmrem: THREE.PMREMGenerator;
  private skyScene = new THREE.Scene();
  private skyForEnv = new Sky();
  private envRT: THREE.WebGLRenderTarget | null = null;
  private lastEnvMinute = -1e9;

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(450000);
    for (const s of [this.sky, this.skyForEnv]) {
      const u = s.material.uniforms;
      u.turbidity.value = 7; // humid tropical haze
      u.rayleigh.value = 2.2;
      u.mieCoefficient.value = 0.006;
      u.mieDirectionalG.value = 0.8;
    }
    this.skyForEnv.scale.setScalar(1000);
    this.skyScene.add(this.skyForEnv);
    scene.add(this.sky);
    scene.fog = this.fog;

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -140; c.right = 140; c.top = 140; c.bottom = -140; c.near = 1; c.far = 1500;
    c.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);
    this.pmrem = new THREE.PMREMGenerator(renderer);
  }

  /** minutes: local time of day. focus: point to centre the shadow camera on. */
  update(minutes: number, dayOfYear: number, focus: THREE.Vector3) {
    sunDirection(minutes, dayOfYear, this.sunDir);
    const el = this.sunDir.y;
    const day = THREE.MathUtils.smoothstep(el, -0.14, 0.1);
    this.night = 1 - day;
    const low = 1 - THREE.MathUtils.smoothstep(el, 0.0, 0.45);

    for (const s of [this.sky, this.skyForEnv]) s.material.uniforms.sunPosition.value.copy(this.sunDir);

    // the directional light is the sun by day and a faint moon by night
    const lightDir = el > -0.05 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, 0.6, -this.sunDir.z).normalize();
    this.sunColor.setRGB(1, 0.95 - low * 0.35, 0.88 - low * 0.55);
    if (el <= -0.05) this.sunColor.setRGB(0.55, 0.65, 0.9);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = el > -0.05 ? 1.9 * day : 0.35;

    // snap the shadow camera to texels to avoid shimmering
    const texel = 280 / 2048;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + lightDir.x * 600, lightDir.y * 600, fz + lightDir.z * 600);
    this.sun.target.updateMatrixWorld();

    this.hemi.intensity = 0.22 + 0.28 * day;
    this.hemi.color.setRGB(0.75 - this.night * 0.55, 0.84 - this.night * 0.6, 0.93 - this.night * 0.55);

    this.horizon.setRGB(0.8, 0.84, 0.86).lerp(new THREE.Color(0.95, 0.68, 0.48), low * day * 0.8).lerp(new THREE.Color(0.04, 0.06, 0.1), this.night);
    this.fog.color.copy(this.horizon);
    this.renderer.toneMappingExposure = 0.6 + 0.15 * day;

    if (Math.abs(minutes - this.lastEnvMinute) > 20) {
      this.lastEnvMinute = minutes;
      this.envRT?.dispose();
      this.envRT = this.pmrem.fromScene(this.skyScene);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.08 + 0.22 * day;
    }
  }
}
