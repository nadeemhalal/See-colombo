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

/** Night sky: deep blue overhead, a warm humid city glow at the horizon, and stars. Fades in at dusk. */
function nightSkyDome() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 } },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uNight;
      varying vec3 vDir;
      float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        #include <logdepthbuf_fragment>
        float y = clamp(vDir.y, -0.2, 1.0);
        vec3 zenith = vec3(0.025, 0.04, 0.11);
        vec3 mid = vec3(0.07, 0.08, 0.2);
        vec3 glow = vec3(0.42, 0.24, 0.2); // sodium-lit haze over the city
        vec3 col = mix(mid, zenith, smoothstep(0.05, 0.6, y));
        col = mix(glow, col, smoothstep(-0.02, 0.22, y));
        // stars, fewer near the hazy horizon
        vec3 cell = floor(vDir * 420.0);
        float st = step(0.9975, h(cell)) * smoothstep(0.12, 0.45, y);
        col += st * (0.6 + 0.4 * h(cell + 1.0)) * vec3(0.9, 0.93, 1.0);
        gl_FragColor = vec4(col, uNight);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(7000, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.name = 'night-sky';
  return mesh;
}

export class Environment {
  nightSky = nightSkyDome();
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
    // The raw scattering sky is so bright that tone mapping bleaches it to white; scale it down
    // and push the saturation so the visible sky reads as a clear tropical blue.
    const sm = this.sky.material;
    sm.uniforms.uSkyGain = { value: 0.55 };
    sm.uniforms.uSkySat = { value: 1.5 };
    sm.fragmentShader = sm.fragmentShader
      .replace('void main()', `uniform float uSkyGain, uSkySat;
        void main()`)
      .replace('gl_FragColor = vec4( texColor, 1.0 );', `texColor *= uSkyGain;
        float skyL = dot(texColor, vec3(0.2126, 0.7152, 0.0722));
        texColor = max(mix(vec3(skyL), texColor, uSkySat), 0.0);
        gl_FragColor = vec4( texColor, 1.0 );`);
    this.skyForEnv.scale.setScalar(1000);
    this.skyScene.add(this.skyForEnv);
    scene.add(this.sky, this.nightSky);
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
  update(minutes: number, dayOfYear: number, focus: THREE.Vector3, camPos?: THREE.Vector3) {
    sunDirection(minutes, dayOfYear, this.sunDir);
    const el = this.sunDir.y;
    const day = THREE.MathUtils.smoothstep(el, -0.14, 0.1);
    this.night = 1 - day;
    const low = 1 - THREE.MathUtils.smoothstep(el, 0.0, 0.45);

    for (const s of [this.sky, this.skyForEnv]) s.material.uniforms.sunPosition.value.copy(this.sunDir);
    // keep sunsets rich: less dimming when the sun is low
    this.sky.material.uniforms.uSkyGain.value = 0.55 + 0.35 * low;

    // the directional light is the sun by day and a faint moon by night
    const lightDir = el > -0.05 ? this.sunDir : new THREE.Vector3(-this.sunDir.x, 0.6, -this.sunDir.z).normalize();
    this.sunColor.setRGB(1, 0.93 - low * 0.33, 0.84 - low * 0.52);
    if (el <= -0.05) this.sunColor.setRGB(0.58, 0.68, 1.0);
    this.sun.color.copy(this.sunColor);
    // moonlight is bright enough to read the street by
    this.sun.intensity = el > -0.05 ? 2.55 * day : 0.8;

    // snap the shadow camera to texels to avoid shimmering
    const texel = 280 / 2048;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + lightDir.x * 600, lightDir.y * 600, fz + lightDir.z * 600);
    this.sun.target.updateMatrixWorld();

    // at night: blue-violet sky light from above, warm street-lamp bounce from below
    // twilight: the sun is down but the lamps and night sky light are not yet up, so lift the fill
    const twilight = 4 * day * this.night;
    this.hemi.intensity = 0.16 + 0.16 * day + 0.64 * this.night + 0.5 * twilight;
    this.hemi.color.setRGB(0.78, 0.86, 0.95).lerp(new THREE.Color(0.38, 0.45, 0.78), this.night);
    this.hemi.groundColor.setRGB(0.42, 0.37, 0.29).lerp(new THREE.Color(0.4, 0.27, 0.18), this.night);

    this.horizon.setRGB(0.74, 0.81, 0.86).lerp(new THREE.Color(0.98, 0.66, 0.46), low * day * 0.85).lerp(new THREE.Color(0.17, 0.14, 0.22), this.night);
    this.fog.color.copy(this.horizon);
    this.fog.density = 0.00028 + 0.00012 * this.night;
    this.renderer.toneMappingExposure = 0.58 + 0.06 * day + 0.42 * this.night + 0.2 * twilight;
    (this.nightSky.material as THREE.ShaderMaterial).uniforms.uNight.value = THREE.MathUtils.smoothstep(this.night, 0.15, 0.85);
    if (camPos) this.nightSky.position.copy(camPos);

    if (Math.abs(minutes - this.lastEnvMinute) > 20) {
      this.lastEnvMinute = minutes;
      this.envRT?.dispose();
      this.envRT = this.pmrem.fromScene(this.skyScene);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.08 + 0.06 * day + 0.1 * this.night;
    }
  }
}
