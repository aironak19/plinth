/**
 * Post-processing: ground-truth ambient occlusion for contact shadows in
 * corners and under eaves, a restrained bloom so sun glints and night lamps
 * glow, then filmic tone mapping. Quality presets trade these for frame rate.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type Quality = 'fast' | 'balanced' | 'high';
export const QUALITIES: { id: Quality; label: string; hint: string }[] = [
  { id: 'fast', label: 'Fast', hint: 'For large models and older laptops' },
  { id: 'balanced', label: 'Balanced', hint: 'Ambient occlusion and soft shadows' },
  { id: 'high', label: 'High', hint: 'Full-resolution occlusion, bloom, sharper shadows' },
];

export interface Post {
  render(dt: number): void;
  setSize(w: number, h: number, pixelRatio: number): void;
  configure(o: { quality: Quality; ao: boolean; night: number; hideInAO: THREE.Object3D[] }): void;
  dispose(): void;
}

export function createPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): Post {
  const target = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const gtao = new GTAOPass(scene, camera, 4, 4);
  gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.15, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
  gtao.blendIntensity = 0.9;
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.12, 0.5, 1.05);
  const output = new OutputPass();
  composer.addPass(renderPass); composer.addPass(gtao); composer.addPass(bloom); composer.addPass(output);

  let enabled = true;
  let hidden: THREE.Object3D[] = [];
  // Leaf cards are alpha-tested; in the occlusion pre-pass they would read as solid quads and
  // throw dark rectangles around every tree. Leave them out of the AO passes only.
  const aoRender = gtao.render.bind(gtao);
  gtao.render = (...args: Parameters<typeof aoRender>) => {
    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    aoRender(...args);
    hidden.forEach((o, i) => { o.visible = was[i]; });
  };

  return {
    render(dt) { if (enabled) composer.render(dt); else renderer.render(scene, camera); },
    setSize(w, h, pr) { composer.setPixelRatio(pr); composer.setSize(w, h); },
    configure({ quality, ao, night, hideInAO }) {
      enabled = quality !== 'fast' && ao;
      hidden = hideInAO;
      gtao.enabled = ao;
      gtao.updateGtaoMaterial({ samples: quality === 'high' ? 16 : 10 });
      bloom.enabled = quality === 'high' || night > 0.2;
      bloom.strength = 0.1 + night * 0.16;
      bloom.threshold = 1.05 - night * 0.2;
      bloom.radius = 0.45 + night * 0.15;
    },
    dispose() { composer.dispose(); target.dispose(); },
  };
}
