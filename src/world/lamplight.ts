import * as THREE from 'three';

// Street-lamp light in the world instead of on the screen. Every lamp's pool of light is painted once
// into a city-wide texture (a light map, about 2.5 m per texel). Materials that opt in sample it at
// their world position and add sodium-orange light to their diffuse lighting, so the road, pavement,
// walls, cars and people under a lamp are lit, with no extra lights and no screen-space glow.

const M_PER_PX = 2.5;
const POOL_R = 15; // metres
const SODIUM = new THREE.Color(1.0, 0.62, 0.3);

export const lampUniforms = {
  uLampMap: { value: null as THREE.Texture | null },
  uLampBounds: { value: new THREE.Vector4(0, 0, 1, 1) }, // minX, minZ, sizeX, sizeZ
  uLampOn: { value: 0 },
  uLampColor: { value: SODIUM.clone() },
};

/** Paint the light map from lamp head positions. */
export function buildLampMap(bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, heads: { x: number; z: number }[]) {
  const sx = bounds.maxX - bounds.minX, sz = bounds.maxZ - bounds.minZ;
  const w = Math.min(4096, Math.ceil(sx / M_PER_PX)), h = Math.min(4096, Math.ceil(sz / M_PER_PX));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'lighter';
  // one soft pool sprite, stamped at every lamp
  const r = Math.ceil(POOL_R / (sx / w));
  const spr = document.createElement('canvas');
  spr.width = spr.height = r * 2;
  const sg = spr.getContext('2d')!;
  const grd = sg.createRadialGradient(r, r, 0, r, r, r);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.3, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.65, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  sg.fillStyle = grd;
  sg.fillRect(0, 0, r * 2, r * 2);
  for (const l of heads) {
    const px = ((l.x - bounds.minX) / sx) * w, pz = ((l.z - bounds.minZ) / sz) * h;
    g.drawImage(spr, px - r, pz - r);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  lampUniforms.uLampMap.value = tex;
  lampUniforms.uLampBounds.value.set(bounds.minX, bounds.minZ, sx, sz);
}

const baseKey = THREE.Material.prototype.customProgramCacheKey;

/**
 * Make a standard material pick up lamp light. Keeps any onBeforeCompile the material already has.
 * strength scales the effect (e.g. lower for tree leaves).
 */
export function addLampLight<T extends THREE.MeshStandardMaterial>(mat: T, strength = 1): T {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey !== baseKey ? mat.customProgramCacheKey.bind(mat) : null;
  const prevSrc = prev.toString();
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    Object.assign(sh.uniforms, lampUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLampW;`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 lw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
          lw = instanceMatrix * lw;
          #endif
          vLampW = (modelMatrix * lw).xyz;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLampW;
        uniform sampler2D uLampMap;
        uniform vec4 uLampBounds;
        uniform float uLampOn;
        uniform vec3 uLampColor;`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        if (uLampOn > 0.0) {
          vec2 luv = (vLampW.xz - uLampBounds.xy) / uLampBounds.zw;
          float lamp = texture2D(uLampMap, luv).r;
          // light comes from heads about 7 m up: strongest on the ground, fading up the walls
          lamp *= 1.0 - smoothstep(3.0, 11.0, vLampW.y);
          lamp *= 0.55 + 0.45 * max(dot(normal, (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz), 0.0);
          // dark asphalt needs the full boost to read; pale walls and white vehicles get less so they don't glare
          float albedo = dot(material.diffuseColor, vec3(0.2126, 0.7152, 0.0722));
          reflectedLight.directDiffuse += material.diffuseColor * uLampColor * lamp * uLampOn * ${(5.0 * strength).toFixed(2)} * (1.0 - 0.65 * smoothstep(0.08, 0.7, albedo));
        }`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey() : prevSrc) + '|lamp';
  mat.needsUpdate = true;
  return mat;
}
