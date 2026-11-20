import * as THREE from 'three';

/** Large animated water plane under the land (sea, harbour, Beira Lake). */
export function buildWater() {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uSkyColor: { value: new THREE.Color(0.6, 0.75, 0.9) },
    uDeep: { value: new THREE.Color(0x0e3a4a) },
    uFogColor: { value: new THREE.Color(0.8, 0.85, 0.9) },
    uFogDensity: { value: 0.0003 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime;
      uniform vec3 uSunDir, uSunColor, uSkyColor, uDeep, uFogColor;
      uniform float uFogDensity;
      varying vec3 vWorld;
      vec2 wave(vec2 p, vec2 d, float k, float a, float s) {
        float ph = dot(p, d) * k + uTime * s;
        return d * (a * k * cos(ph));
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec2 p = vWorld.xz;
        vec2 g = vec2(0.0);
        g += wave(p, normalize(vec2(1.0, 0.3)), 0.06, 0.35, 1.1);
        g += wave(p, normalize(vec2(0.8, -0.6)), 0.11, 0.18, 1.6);
        g += wave(p, normalize(vec2(-0.3, 1.0)), 0.23, 0.08, 2.3);
        g += wave(p, normalize(vec2(0.2, 0.9)), 0.51, 0.035, 3.1);
        g += wave(p, normalize(vec2(-0.9, -0.2)), 1.13, 0.015, 4.2);
        vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float dist = length(cameraPosition - vWorld);
        n = normalize(mix(n, vec3(0.0, 1.0, 0.0), clamp(dist / 4000.0, 0.0, 0.85)));
        float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 r = reflect(-v, n);
        float spec = pow(max(dot(r, normalize(uSunDir)), 0.0), 180.0) * step(0.0, uSunDir.y);
        vec3 col = mix(uDeep * (0.35 + 0.65 * max(uSunDir.y, 0.05)), uSkyColor, fres) + uSunColor * spec * 2.5;
        float fog = 1.0 - exp(-pow(uFogDensity * dist, 2.0));
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const geo = new THREE.PlaneGeometry(40000, 40000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = -0.4;
  mesh.name = 'water';
  return { mesh, uniforms };
}
