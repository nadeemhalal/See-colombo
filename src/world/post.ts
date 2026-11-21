import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Colour grade in linear HDR, before tone mapping: a little more saturation, warm tropical
// highlights by day, cooler shadows at night, and a soft vignette.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uSat: { value: 1.15 },
    uWarm: { value: new THREE.Vector3(1.04, 1.0, 0.93) },
    uShadowTint: { value: new THREE.Vector3(1, 1, 1) },
    uVignette: { value: 0.32 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uSat, uVignette;
    uniform vec3 uWarm, uShadowTint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec3 col = mix(vec3(l), c.rgb, uSat);
      // split tone: tint the darks, warm the lights
      float lightAmt = smoothstep(0.05, 0.6, l);
      col *= mix(uShadowTint, uWarm, lightAmt);
      float d = distance(vUv, vec2(0.5));
      col *= mix(1.0, smoothstep(0.85, 0.3, d), uVignette);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  fxaa: ShaderPass;
  private w = 1;
  private h = 1;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples = 4) {
    const size = renderer.getSize(new THREE.Vector2());
    this.w = size.x || 1; this.h = size.y || 1;
    const rt = new THREE.WebGLRenderTarget(this.w, this.h, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(this.w / 2, this.h / 2), 0.2, 0.55, 2.5);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    // cheap edge smoothing for when multisampling is off (low quality)
    this.fxaa = new ShaderPass(FXAAShader);
    this.fxaa.enabled = samples === 0;
    this.composer.addPass(this.fxaa);
    this.updateFxaa();
  }

  /** Multisampling on the scene render: 4 on high quality, 0 (FXAA instead) on low. */
  setSamples(samples: number) {
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      rt.samples = samples;
      rt.dispose();
    }
    this.fxaa.enabled = samples === 0;
  }

  setSize(w: number, h: number) {
    this.w = w; this.h = h;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.updateFxaa();
  }

  private updateFxaa() {
    const pr = this.renderer.getPixelRatio();
    (this.fxaa.uniforms.resolution.value as THREE.Vector2).set(1 / (this.w * pr), 1 / (this.h * pr));
  }

  /** night: 0 day .. 1 night */
  update(night: number) {
    // by day the bloom is barely visible, so skip the pass and save its cost
    this.bloom.enabled = night > 0.12;
    // only real light sources (lamp heads, lit signs) should glow, not lit walls or vehicles
    this.bloom.strength = 0.04 + 0.16 * night;
    this.bloom.threshold = 3.4 - 0.9 * night;
    this.bloom.radius = 0.3;
    const u = this.grade.uniforms;
    u.uSat.value = 1.14 + 0.08 * night;
    (u.uWarm.value as THREE.Vector3).set(1.05, 1.0, 0.92).lerp(new THREE.Vector3(1.08, 0.98, 0.9), night);
    (u.uShadowTint.value as THREE.Vector3).set(1.0, 1.0, 1.02).lerp(new THREE.Vector3(0.9, 0.98, 1.12), night);
    u.uVignette.value = 0.26 + 0.04 * night;
  }

  render() { this.composer.render(); }
}
