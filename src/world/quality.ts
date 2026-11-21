import * as THREE from 'three';
import type { Post } from './post';

export type Quality = 'high' | 'low';
const KEY = 'seeColombo.quality';

/** Integrated and mobile GPUs start on low quality; anything else on high. A saved choice wins. */
export function detectQuality(renderer: THREE.WebGLRenderer): Quality {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'high' || saved === 'low') return saved;
  } catch { /* storage blocked */ }
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  return /Intel|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Basic Render/i.test(name) ? 'low' : 'high';
}

export function saveQuality(q: Quality) {
  try { localStorage.setItem(KEY, q); } catch { /* storage blocked */ }
}

/**
 * high: up to 1.5x pixel ratio, 4x multisampling, 2048 shadow map.
 * low: 1x pixel ratio, FXAA instead of multisampling, 1024 shadow map.
 */
export function applyQuality(q: Quality, renderer: THREE.WebGLRenderer, post: Post, sun: THREE.DirectionalLight) {
  const low = q === 'low';
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.5));
  const size = renderer.getSize(new THREE.Vector2());
  renderer.setSize(size.x, size.y, false);
  post.setSamples(low ? 0 : 4);
  post.setSize(size.x, size.y);
  const res = low ? 1024 : 2048;
  if (sun.shadow.mapSize.x !== res) {
    sun.shadow.mapSize.set(res, res);
    sun.shadow.map?.dispose();
    sun.shadow.map = null;
  }
}
