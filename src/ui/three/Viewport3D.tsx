/**
 * Real-time 3D viewport — a second view of the same model, never a copy.
 * Rebuilds only when the building, site or style changes; selection is shared
 * with the plan; sun position comes from the project's real location and date.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { Camera, Footprints, Layers, Scissors, Sun as SunIcon, Bookmark, Orbit, ChevronDown, Download, Sparkles, SlidersHorizontal, X, Globe, Video, Moon, Sunrise, Sunset, CloudSun } from 'lucide-react';
import { useStore } from '../../state/store';
import { useDoc, useRules, useBuilding, useLevels } from '../../state/derived';
import { buildScene, disposeGroup, toThree, fromThree, type SceneResult } from './sceneBuilder';
import { sunPosition, sunVector } from '../../core/derive/sun';
import { bbox } from '../../core/geometry/polygon';
import type { RenderStyle, Scene } from '../../core/model/types';
import { Popover } from '../components';
import { uid } from '../../core/model/ids';
import { loadRenders, saveRenders } from '../../state/persist';
import { createEnvironment, WEATHERS, type Environment } from './environment';
import { createPost, QUALITIES, type Post } from './post';
import { tickMaterials } from './materials3d';
import { wind } from './vegetation';

type PathTracer = import('three-gpu-pathtracer').WebGLPathTracer;
const NIGHT_LIGHTS = 14;

const STYLES: { id: RenderStyle; label: string }[] = [
  { id: 'realistic', label: 'Realistic' }, { id: 'architectural', label: 'Architectural' }, { id: 'clay', label: 'Clay' },
  { id: 'sketch', label: 'Sketch' }, { id: 'xray', label: 'X-ray' }, { id: 'wireframe', label: 'Wireframe' }, { id: 'draft', label: 'Draft' },
];

export interface Viewport3DProps { compact?: boolean; autoRotate?: boolean; present?: boolean; initialScene?: Scene | null }

export function Viewport3D({ compact, autoRotate, present, initialScene }: Viewport3DProps) {
  const doc = useDoc();
  const b = useBuilding();
  const rules = useRules();
  const levels = useLevels();
  const style = useStore((s) => s.renderStyle);
  const sun = useStore((s) => s.sun);
  const selection = useStore((s) => s.selection);
  const levelId = useStore((s) => s.levelId);
  const set = useStore((s) => s.set);
  const mountRef = useRef<HTMLDivElement>(null);
  const view3d = useStore((s) => s.view3d);
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; walk: PointerLockControls;
    env: Environment; post: Post; lamps: THREE.PointLight[]; content: SceneResult | null; raf: number; keys: Set<string>; clip: THREE.Plane;
    tracer: PathTracer | null; tracing: boolean; sky: { env: THREE.WebGLCubeRenderTarget; bg: THREE.WebGLCubeRenderTarget } | null;
  } | null>(null);
  const [photo, setPhoto] = useState<'off' | 'loading' | 'on'>('off');
  const [samples, setSamples] = useState(0);
  const [recording, setRecording] = useState(false);
  const [cutaway, setCutaway] = useState(false);
  const [walking, setWalking] = useState(false);
  const [showUpper, setShowUpper] = useState(true);

  const hidden = useMemo(() => {
    const h = new Set<string>();
    if (!showUpper && levelId) { const idx = levels.findIndex((l) => l.id === levelId); levels.forEach((l, i) => { if (i > idx) h.add(l.id); }); }
    return h;
  }, [showUpper, levelId, levels]);
  const selectedIds = useMemo(() => new Set(selection.map((r) => r.id)), [selection]);

  // ---- init renderer once
  useEffect(() => {
    const el = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 4000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = true;
    const walk = new PointerLockControls(camera, renderer.domElement);
    const env = createEnvironment(renderer, scene);
    const post = createPost(renderer, scene, camera);
    // A fixed pool of lamps for night scenes; they are switched on only after dusk.
    const lamps = Array.from({ length: NIGHT_LIGHTS }, () => { const l = new THREE.PointLight('#ffd9a0', 0, 9, 1.6); l.visible = false; scene.add(l); return l; });
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
    const keys = new Set<string>();
    const state = { renderer, scene, camera, controls, walk, env, post, lamps, content: null as SceneResult | null, raf: 0, keys, clip, tracer: null as PathTracer | null, tracing: false, sky: null as { env: THREE.WebGLCubeRenderTarget; bg: THREE.WebGLCubeRenderTarget } | null };
    ctx.current = state;
    if (import.meta.env.DEV) (window as unknown as { __plinth3d?: unknown }).__plinth3d = state;
    const resize = () => {
      const w = el.clientWidth || 800, h = el.clientHeight || 600;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      post.setSize(w, h, renderer.getPixelRatio());
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      state.tracer?.updateCamera();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const clock = new THREE.Clock();
    let lastSamples = -1;
    const loop = () => {
      const dt = Math.min(0.05, clock.getDelta());
      if (walk.isLocked) {
        const sp = (keys.has('ShiftLeft') ? 6 : 2.6) * dt;
        if (keys.has('KeyW') || keys.has('ArrowUp')) walk.moveForward(sp);
        if (keys.has('KeyS') || keys.has('ArrowDown')) walk.moveForward(-sp);
        if (keys.has('KeyA') || keys.has('ArrowLeft')) walk.moveRight(-sp);
        if (keys.has('KeyD') || keys.has('ArrowRight')) walk.moveRight(sp);
      } else controls.update();
      if (state.tracing && state.tracer) {
        softSun(state);
        state.tracer.renderSample();
        const n = Math.floor(state.tracer.samples);
        if (n !== lastSamples) { lastSamples = n; setSamples(n); }
      } else {
        wind.value += dt;
        tickMaterials(dt);
        env.tick(dt);
        post.render(dt);
      }
      state.raf = requestAnimationFrame(loop);
    };
    loop();
    controls.addEventListener('change', () => { if (state.tracing) state.tracer?.updateCamera(); });
    // picking
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (walk.isLocked || state.tracing || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !state.content) return;
      const r = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hits = ray.intersectObjects(state.content.pickables, false).filter((h) => !renderer.clippingPlanes.length || state.clip.distanceToPoint(h.point) >= 0);
      const ref = hits[0]?.object.userData.ref;
      useStore.getState().select(ref ? [ref] : [], e.shiftKey);
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    const kd = (e: KeyboardEvent) => { if (walk.isLocked) { keys.add(e.code); e.stopPropagation(); } };
    const ku = (e: KeyboardEvent) => keys.delete(e.code);
    window.addEventListener('keydown', kd, true);
    window.addEventListener('keyup', ku);
    walk.addEventListener('unlock', () => { setWalking(false); controls.enabled = true; });
    return () => {
      cancelAnimationFrame(state.raf);
      ro.disconnect();
      window.removeEventListener('keydown', kd, true);
      window.removeEventListener('keyup', ku);
      if (state.content) disposeGroup(state.content.group);
      state.tracer?.dispose();
      state.sky?.env.dispose(); state.sky?.bg.dispose();
      post.dispose();
      env.dispose();
      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctx.current = null;
    };
  }, []);

  // ---- (re)build scene content
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const t0 = performance.now();
    if (c.content) { c.scene.remove(c.content.group); disposeGroup(c.content.group); }
    c.content = buildScene(doc, b, rules, style, hidden, new Set(), { season: view3d.season, age: view3d.plantAge, context: view3d.context });
    c.scene.add(c.content.group);
    highlight(c.content, selectedIdsRef.current);
    c.renderer.shadowMap.enabled = style !== 'sketch' && style !== 'wireframe' && style !== 'draft' && style !== 'xray';
    // Lamps and lit rooms, brightest first, share the fixed pool of night lights.
    const lights = [...c.content.lights].sort((x, y) => y.power - x.power);
    c.lamps.forEach((l, i) => { const src = lights[i]; l.userData.power = src ? src.power : 0; if (src) { l.position.copy(src.position); l.color.set(src.color); l.distance = src.range; } });
    setLightingTick((n) => n + 1);
    if (c.tracing) stopPhoto();
    if (import.meta.env.DEV) console.debug(`[plinth] 3D rebuild ${Math.round(performance.now() - t0)} ms`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.site, b, rules, style, hidden, view3d.season, view3d.plantAge, view3d.context]);

  // ---- selection highlight without rebuilding geometry
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  useEffect(() => { if (ctx.current?.content) highlight(ctx.current.content, selectedIds); }, [selectedIds]);

  // ---- frame the site on first load / scene restore
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    if (initialScene) { applyScene(initialScene); return; }
    const bb = bbox(doc.site.boundary);
    const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
    const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY);
    c.controls.target.copy(toThree({ x: cx, y: cy, z: 3000 }));
    c.camera.position.copy(toThree({ x: cx + span * 0.75, y: bb.minY - span * 0.85, z: span * 0.55 }));
    c.controls.update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, initialScene]);

  useEffect(() => { if (ctx.current) { ctx.current.controls.autoRotate = !!autoRotate; ctx.current.controls.autoRotateSpeed = 0.6; } }, [autoRotate]);

  // ---- sun, sky, weather and night lighting
  const [lightingTick, setLightingTick] = useState(0);
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const { lat, lon } = doc.meta.location;
    const pos = sunPosition(lat, lon, sun.month, sun.day, sun.hour);
    const v = sunVector(pos, doc.site.northAngle);
    const bb = bbox(doc.site.boundary);
    const center = toThree({ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, z: 0 });
    const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / 1000;
    const realistic = style === 'realistic';
    // Below the horizon the astronomical vector points down; keep the sky's sun where it really is.
    const alt = (pos.altitude * Math.PI) / 180, az = Math.atan2(v.x, v.y);
    const dir = pos.altitude > 0 ? new THREE.Vector3(v.x, v.z, -v.y) : new THREE.Vector3(Math.sin(az) * Math.cos(alt), Math.sin(alt), -Math.cos(az) * Math.cos(alt));
    c.env.update({ dir, altitude: pos.altitude, weather: view3d.weather, realistic, center, span, shadowSize: view3d.quality === 'fast' ? 2048 : 4096 });
    if (!realistic) {
      c.scene.background = new THREE.Color(style === 'sketch' || style === 'wireframe' ? '#fbfaf7' : style === 'architectural' ? '#f1f0ec' : style === 'xray' ? '#f5f6f8' : style === 'clay' ? '#e9e7e2' : '#eef1f4');
      c.scene.fog = null;
      c.renderer.toneMappingExposure = 1.05;
    }
    const night = c.env.night;
    c.lamps.forEach((l) => { l.intensity = (l.userData.power as number ?? 0) * night; l.visible = night > 0.03 && l.intensity > 0; });
    c.post.configure({ quality: view3d.quality, ao: realistic || style === 'clay' || style === 'architectural', night, hideInAO: c.content?.foliage ?? [] });
    c.renderer.setPixelRatio(Math.min(view3d.quality === 'fast' ? 1.25 : 2, window.devicePixelRatio));
    const el = mountRef.current!;
    c.post.setSize(el.clientWidth || 800, el.clientHeight || 600, c.renderer.getPixelRatio());
    c.renderer.setSize(el.clientWidth || 800, el.clientHeight || 600, false);
    if (c.tracing) stopPhoto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sun, doc.meta.location, doc.site, style, view3d.weather, view3d.quality, lightingTick]);

  // ---- cutaway (section at the active level)
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const lv = levelId ? b.levels[levelId] : undefined;
    if (cutaway && lv) { c.clip.constant = (lv.elevation + 1300) / 1000; c.renderer.clippingPlanes = [c.clip]; }
    else c.renderer.clippingPlanes = [];
  }, [cutaway, levelId, b.levels]);

  // ---- external events: render, export, scenes
  useEffect(() => {
    const onRender = () => void render();
    const onExport = (e: Event) => void exportModel((e as CustomEvent).detail);
    const onScene = (e: Event) => applyScene((e as CustomEvent).detail as Scene);
    window.addEventListener('plinth:render', onRender);
    window.addEventListener('plinth:export3d', onExport);
    window.addEventListener('plinth:applyScene', onScene);
    return () => { window.removeEventListener('plinth:render', onRender); window.removeEventListener('plinth:export3d', onExport); window.removeEventListener('plinth:applyScene', onScene); };
  });

  function applyScene(sc: Scene) {
    const c = ctx.current;
    if (!c) return;
    const target = toThree({ x: sc.camera.target[0], y: sc.camera.target[1], z: sc.camera.target[2] });
    const to = toThree({ x: sc.camera.position[0], y: sc.camera.position[1], z: sc.camera.position[2] });
    const from = c.camera.position.clone(), fromT = c.controls.target.clone();
    const t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 700);
      const e = 1 - Math.pow(1 - k, 3);
      c.camera.position.lerpVectors(from, to, e);
      c.controls.target.lerpVectors(fromT, target, e);
      if (k < 1) requestAnimationFrame(step);
    };
    step();
    c.camera.fov = sc.camera.fov; c.camera.updateProjectionMatrix();
    useStore.setState({ renderStyle: sc.renderStyle, sun: sc.sun });
  }

  function saveScene() {
    const c = ctx.current;
    if (!c) return;
    const p = fromThree(c.camera.position), t = fromThree(c.controls.target);
    const name = `Scene ${String(doc.scenes.length + 1).padStart(2, '0')} — ${style === 'realistic' ? 'View' : STYLES.find((x) => x.id === style)?.label}`;
    if (!c.tracing) c.post.render(0);
    const thumb = downscale(c.renderer.domElement, 240);
    useStore.getState().dispatch([{ type: 'scene.save', params: { scene: { name, camera: { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], fov: c.camera.fov, projection: 'perspective' }, renderStyle: style, sun, hiddenLevels: [...hidden], thumbnail: thumb } } }]);
  }

  async function render() {
    const c = ctx.current;
    if (!c) return;
    const old = c.renderer.getPixelRatio();
    const el = mountRef.current!, w = el.clientWidth || 800, h = el.clientHeight || 600;
    if (!c.tracing) {
      // Supersample the frame: 2.4× the screen resolution, capped for memory.
      const pr = Math.min(3, Math.max(old * 1.6, 2.4), 4096 / w);
      c.renderer.setPixelRatio(pr); c.renderer.setSize(w, h, false); c.post.setSize(w, h, pr);
      c.post.render(0);
    }
    const url = c.renderer.domElement.toDataURL('image/png');
    if (!c.tracing) { c.renderer.setPixelRatio(old); c.renderer.setSize(w, h, false); c.post.setSize(w, h, old); }
    const list = await loadRenders(doc.id);
    const name = `${doc.meta.name} — ${c.tracing ? 'Photoreal' : STYLES.find((x) => x.id === style)?.label} ${new Date().toLocaleString()}`;
    await saveRenders(doc.id, [{ id: uid('rn'), projectId: doc.id, name, dataUrl: downscale(c.renderer.domElement, 1600), createdAt: Date.now(), style }, ...list].slice(0, 24));
    const a = document.createElement('a');
    a.href = url; a.download = `${doc.meta.name.replace(/\W+/g, '-')}-render.png`; a.click();
    useStore.getState().toast(c.tracing ? `Photoreal render saved (${Math.floor(c.tracer?.samples ?? 0)} samples)` : 'Render ready — saved to project renders and downloaded');
  }

  async function exportModel(kind: string) {
    const c = ctx.current;
    if (!c?.content) return;
    if (kind === 'gltf') {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      new GLTFExporter().parse(c.content.group, (res) => {
        const blob = new Blob([res as ArrayBuffer], { type: 'model/gltf-binary' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${doc.meta.name.replace(/\W+/g, '-')}.glb`; a.click();
        useStore.getState().toast('glTF model exported');
      }, () => useStore.getState().toast('We couldn’t export the 3D model.', { kind: 'err' }), { binary: true });
    } else if (kind === 'obj') {
      const { OBJExporter } = await import('three/examples/jsm/exporters/OBJExporter.js');
      const txt = new OBJExporter().parse(c.content.group);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = `${doc.meta.name.replace(/\W+/g, '-')}.obj`; a.click();
    }
  }

  /** Bake the current sky into cube maps: one to light the scene, one (with the sun disc) to look at. */
  function skyCubes(c: NonNullable<typeof ctx.current>) {
    c.sky?.env.dispose(); c.sky?.bg.dispose();
    const make = (disc: number) => {
      const rt = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
      const cam = new THREE.CubeCamera(1, 4000, rt);
      const s2 = new THREE.Scene();
      const u = c.env.sky.material.uniforms;
      const was = { disc: u.showSunDisc.value, mie: u.mieCoefficient.value, g: u.mieDirectionalG.value }, parent = c.env.sky.parent;
      u.showSunDisc.value = disc;
      // The sun is traced as its own light. Leaving its halo in the lighting map would make every
      // shadow sample a lottery between the halo and the rest of the sky — visible as stubborn grain.
      if (!disc) { u.mieCoefficient.value = 0.0004; u.mieDirectionalG.value = 0.4; }
      s2.add(c.env.sky);
      cam.update(c.renderer, s2);
      u.showSunDisc.value = was.disc; u.mieCoefficient.value = was.mie; u.mieDirectionalG.value = was.g;
      parent?.add(c.env.sky);
      return rt;
    };
    c.sky = { env: make(0), bg: make(1) };
    return c.sky;
  }

  /** Photoreal mode: progressive path tracing with real global illumination, in the same viewport. */
  async function startPhoto() {
    const c = ctx.current;
    if (!c || c.tracing) return;
    if (style !== 'realistic') set('renderStyle', 'realistic');
    setPhoto('loading');
    try {
      const { WebGLPathTracer, DenoiseMaterial } = await import('three-gpu-pathtracer');
      const { FullScreenQuad } = await import('three/examples/jsm/postprocessing/Pass.js');
      await new Promise((r) => setTimeout(r, 60));
      const cubes = skyCubes(c);
      const saved = { env: c.scene.environment, bg: c.scene.background, fog: c.scene.fog, intensity: c.scene.environmentIntensity };
      c.scene.userData.saved = saved;
      c.scene.remove(c.env.sky, ...c.env.extras);
      c.scene.environment = cubes.env.texture; c.scene.background = cubes.bg.texture; c.scene.fog = null;
      c.scene.backgroundIntensity = 1;
      c.renderer.clippingPlanes = [];
      if (!c.tracer) {
        c.tracer = new WebGLPathTracer(c.renderer);
        c.tracer.bounces = 5; c.tracer.transmissiveBounces = 4; c.tracer.filterGlossyFactor = 0.5;
        c.tracer.tiles.set(2, 2); c.tracer.minSamples = 2; c.tracer.renderDelay = 60; c.tracer.fadeDuration = 250;
        c.tracer.dynamicLowRes = true; c.tracer.lowResScale = 0.2; c.tracer.multipleImportanceSampling = true;
        // An edge-preserving denoise on the way to the screen: clean walls and sky after tens of samples, not thousands.
        const denoise = new FullScreenQuad(new DenoiseMaterial({ transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true }));
        const dm = denoise.material as unknown as { map: THREE.Texture | null; sigma: number; kSigma: number; threshold: number; opacity: number };
        const tracer = c.tracer;
        tracer.renderToCanvasCallback = (target, renderer, quad) => {
          dm.map = target.texture; dm.opacity = (quad.material as THREE.Material).opacity;
          // Filter hard while the image is noisy, then back off so fine texture survives.
          const k = Math.max(0, Math.min(1, 1 - tracer.samples / 400));
          dm.sigma = 1.4 + 2.8 * k; dm.kSigma = 1.2; dm.threshold = 0.05 + 0.16 * k;
          const auto = renderer.autoClear; renderer.autoClear = false; denoise.render(renderer); renderer.autoClear = auto;
        };
      }
      c.tracer.renderScale = Math.min(1, 1600 / ((mountRef.current?.clientWidth || 800) * c.renderer.getPixelRatio()));
      // Building the ray-tracing structure is quick at villa scale, so do it inline (no worker to ship).
      c.env.sun.userData.base = c.env.sun.position.clone();
      c.tracer.setScene(c.scene, c.camera);
      c.tracing = true;
      setSamples(0);
      setPhoto('on');
    } catch (err) {
      console.error(err);
      stopPhoto();
      useStore.getState().toast('Photoreal rendering needs WebGL 2 with float textures, which this browser or GPU doesn’t provide. The real-time view is unaffected.', { kind: 'err' });
    }
  }

  function stopPhoto() {
    const c = ctx.current;
    if (!c) return;
    c.tracing = false;
    if (c.env.sun.userData.base) { c.env.sun.position.copy(c.env.sun.userData.base as THREE.Vector3); c.env.sun.userData.base = undefined; }
    const saved = c.scene.userData.saved as { env: THREE.Texture | null; bg: THREE.Scene['background']; fog: THREE.Scene['fog']; intensity: number } | undefined;
    if (saved) { c.scene.environment = saved.env; c.scene.background = saved.bg; c.scene.fog = saved.fog; c.scene.environmentIntensity = saved.intensity; c.scene.userData.saved = undefined; c.scene.add(c.env.sky, ...c.env.extras); }
    setPhoto('off');
    setLightingTick((n) => n + 1);
  }

  /** 360° panorama (equirectangular) from the current eye point — drops straight into any VR or tour viewer. */
  function exportPanorama() {
    const c = ctx.current;
    if (!c) return;
    const rt = new THREE.WebGLCubeRenderTarget(2048, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(0.1, 4000, rt);
    cube.position.copy(c.camera.position);
    cube.update(c.renderer, c.scene);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { cube: { value: rt.texture } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform samplerCube cube; varying vec2 vUv;
        void main() { float lon = (vUv.x - 0.5) * 6.283185307, lat = (vUv.y - 0.5) * 3.141592653;
          vec3 d = vec3(-sin(lon) * cos(lat), sin(lat), -cos(lon) * cos(lat));
          gl_FragColor = textureCube(cube, vec3(-d.x, d.y, d.z));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      depthTest: false,
    }));
    const s2 = new THREE.Scene(); s2.add(quad);
    const el = mountRef.current!, w = el.clientWidth || 800, h = el.clientHeight || 600, pr = c.renderer.getPixelRatio();
    c.renderer.setPixelRatio(1); c.renderer.setSize(4096, 2048, false);
    c.renderer.render(s2, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    const url = c.renderer.domElement.toDataURL('image/jpeg', 0.92);
    c.renderer.setPixelRatio(pr); c.renderer.setSize(w, h, false); c.post.setSize(w, h, pr);
    rt.dispose(); quad.geometry.dispose(); (quad.material as THREE.Material).dispose();
    const a = document.createElement('a'); a.href = url; a.download = `${doc.meta.name.replace(/\W+/g, '-')}-360.jpg`; a.click();
    useStore.getState().toast('360° panorama exported (4096 × 2048, equirectangular)');
  }

  /** Record a ten-second turntable of the model as a video file. */
  function recordOrbit() {
    const c = ctx.current;
    if (!c || recording || typeof MediaRecorder === 'undefined') { useStore.getState().toast('Video recording isn’t supported in this browser.', { kind: 'err' }); return; }
    const stream = c.renderer.domElement.captureStream(30);
    const mime = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) ?? '';
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const was = { on: c.controls.autoRotate, speed: c.controls.autoRotateSpeed };
    rec.onstop = () => {
      c.controls.autoRotate = was.on; c.controls.autoRotateSpeed = was.speed;
      setRecording(false);
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType })); a.download = `${doc.meta.name.replace(/\W+/g, '-')}-turntable.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
      useStore.getState().toast('Turntable video saved');
    };
    c.controls.autoRotate = true; c.controls.autoRotateSpeed = 6;
    setRecording(true);
    rec.start();
    setTimeout(() => rec.stop(), 10_000);
  }

  function startWalk() {
    const c = ctx.current;
    if (!c) return;
    const lv = (levelId && b.levels[levelId]) || levels[0];
    const target = c.controls.target.clone();
    c.camera.position.set(target.x, (lv.elevation + 1600) / 1000, target.z + 2);
    c.camera.lookAt(target.x, (lv.elevation + 1600) / 1000, target.z);
    c.controls.enabled = false;
    c.walk.lock();
    setWalking(true);
  }

  const setView = (patch: Partial<typeof view3d>) => set('view3d', { ...view3d, ...patch });
  const tracing = photo === 'on';
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} aria-label="3D model viewport" role="img" />
      {!present && (
        <>
          <div className="floating ctxbar v3d-bar" style={{ top: 12, left: 12, transform: 'none', animation: 'none' }}>
            <Popover anchor={<button disabled={tracing}><Orbit size={14} /> {STYLES.find((x) => x.id === style)?.label} <ChevronDown size={12} /></button>}>
              {(close) => <div style={{ width: 180 }}>{STYLES.map((x) => <button key={x.id} onClick={() => { close(); set('renderStyle', x.id); }}>{x.label}</button>)}</div>}
            </Popover>
            <Popover anchor={<button title="Lighting quality, weather, season and planting age"><SlidersHorizontal size={14} />{!compact && <span className="tb-l"> Look</span>}</button>}>
              {() => (
                <div style={{ width: 268, padding: '4px 6px 8px' }} className="col">
                  <Seg label="Weather" value={view3d.weather} options={WEATHERS} onChange={(v) => setView({ weather: v })} />
                  <Seg label="Season" value={view3d.season} options={[{ id: 'spring', label: 'Spring' }, { id: 'summer', label: 'Summer' }, { id: 'autumn', label: 'Autumn' }, { id: 'winter', label: 'Winter' }]} onChange={(v) => setView({ season: v })} hint="Flowering trees bloom in spring; deciduous trees turn and drop their leaves." />
                  <Seg label="Planting age" value={String(view3d.plantAge)} options={[{ id: '0', label: 'Year 1' }, { id: '0.5', label: 'Year 5' }, { id: '1', label: 'Mature' }]} onChange={(v) => setView({ plantAge: Number(v) })} hint="See the garden on handover day or once it has grown in." />
                  <Seg label="Quality" value={view3d.quality} options={QUALITIES} onChange={(v) => setView({ quality: v })} hint={QUALITIES.find((q) => q.id === view3d.quality)?.hint} />
                  <label className="row small" style={{ gap: 8, padding: '6px 4px 0' }}><input type="checkbox" checked={view3d.context} onChange={(e) => setView({ context: e.target.checked })} /> Show neighbourhood trees</label>
                </div>
              )}
            </Popover>
            <span className="sep" />
            <button aria-pressed={cutaway} disabled={tracing} style={cutaway ? { color: 'var(--accent)' } : undefined} onClick={() => setCutaway(!cutaway)} title="Cut the model above the active level"><Scissors size={14} />{!compact && <span className="tb-l"> Section</span>}</button>
            <button style={!showUpper ? { color: 'var(--accent)' } : undefined} onClick={() => setShowUpper(!showUpper)} title="Hide levels above the active level"><Layers size={14} />{!compact && <span className="tb-l"> Upper levels</span>}</button>
            <button onClick={startWalk} disabled={tracing} title="Walk through (WASD, mouse to look, Esc to exit)"><Footprints size={14} />{!compact && <span className="tb-l"> Walk</span>}</button>
            <span className="sep" />
            <Popover anchor={<button title="Saved scenes"><Bookmark size={14} />{!compact && <span className="tb-l">{` Scenes (${doc.scenes.length})`}</span>}</button>}>
              {(close) => (
                <div style={{ width: 260 }}>
                  {doc.scenes.map((sc) => <button key={sc.id} onClick={() => { close(); applyScene(sc); }}>{sc.thumbnail ? <img src={sc.thumbnail} alt="" style={{ width: 44, height: 28, objectFit: 'cover', borderRadius: 4 }} /> : <Camera size={14} />}<span className="grow">{sc.name}</span></button>)}
                  {doc.scenes.length > 0 && <div className="sep" />}
                  <button onClick={() => { close(); saveScene(); }}><Bookmark size={14} /> Save current view as scene</button>
                </div>
              )}
            </Popover>
            <button onClick={() => void render()} title="Save a high-resolution image of this view"><Camera size={14} />{!compact && <span className="tb-l"> Render</span>}</button>
            <button aria-pressed={photo !== 'off'} style={photo !== 'off' ? { color: 'var(--accent)' } : undefined} onClick={() => (photo === 'off' ? void startPhoto() : stopPhoto())} title="Photoreal: path-traced light with real bounce lighting, soft shadows and reflections"><Sparkles size={14} />{!compact && <span className="tb-l"> Photoreal</span>}</button>
            <Popover anchor={<button title="Export"><Download size={14} /></button>}>
              {(close) => (
                <div style={{ width: 232 }}>
                  <button onClick={() => { close(); exportPanorama(); }}><Globe size={14} /> 360° panorama (.jpg)</button>
                  <button onClick={() => { close(); recordOrbit(); }}><Video size={14} /> Turntable video (10 s)</button>
                  <div className="sep" />
                  <button onClick={() => { close(); void exportModel('gltf'); }}>glTF binary (.glb)</button>
                  <button onClick={() => { close(); void exportModel('obj'); }}>Wavefront (.obj)</button>
                </div>
              )}
            </Popover>
          </div>
          {!compact && <SunControl />}
          {walking && <div className="hint">Walking · <span className="kbd">W</span><span className="kbd">A</span><span className="kbd">S</span><span className="kbd">D</span> to move · <span className="kbd">Shift</span> faster · <span className="kbd">Esc</span> to exit</div>}
          {recording && <div className="hint"><span style={{ width: 8, height: 8, borderRadius: 4, background: '#e5484d', display: 'inline-block' }} /> Recording a 10-second turntable…</div>}
          {photo !== 'off' && (
            <div className="hint" style={{ pointerEvents: 'auto' }}>
              <Sparkles size={13} />
              {photo === 'loading' ? 'Preparing the photoreal render…' : <><b className="num">{samples}</b> samples · {samples < 60 ? 'refining — drag to reframe' : samples < 400 ? 'looking good — keeps improving' : 'ready to save'}</>}
              {photo === 'on' && <button className="btn sm" style={{ height: 22, background: 'rgba(255,255,255,0.16)', color: 'inherit', border: 0 }} onClick={() => void render()}>Save image</button>}
              <button className="btn sm ghost icon" style={{ height: 22, width: 22, color: 'inherit' }} aria-label="Exit photoreal" onClick={stopPhoto}><X size={13} /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The real sun is a disc about half a degree across, which is what softens shadow edges. The
 * tracer's sun is a perfect point, so between samples we move it within that disc and refresh the
 * light data in place (without restarting the image): the accumulated result is an area-light sun.
 */
function softSun(state: { tracer: PathTracer | null; env: Environment; scene: THREE.Scene }) {
  const sun = state.env.sun;
  const base = (sun.userData.base ??= sun.position.clone()) as THREE.Vector3;
  const mat = (state.tracer as unknown as { _pathTracer?: { material?: { lights?: { updateFrom?: (l: THREE.Object3D[], ies: unknown[]) => void } } } })._pathTracer?.material;
  if (!mat?.lights?.updateFrom) return;
  const dir = base.clone().sub(sun.target.position), dist = dir.length();
  dir.normalize();
  const a = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = a.clone().cross(dir).normalize(), v = dir.clone().cross(u);
  const r = Math.sqrt(Math.random()) * dist * Math.tan((0.5 * Math.PI) / 180), t = Math.random() * Math.PI * 2;
  sun.position.copy(base).addScaledVector(u, Math.cos(t) * r).addScaledVector(v, Math.sin(t) * r);
  sun.updateMatrixWorld();
  const lights: THREE.Object3D[] = [];
  state.scene.traverseVisible((o) => { const l = o as THREE.Light & { isRectAreaLight?: boolean; isSpotLight?: boolean; isPointLight?: boolean; isDirectionalLight?: boolean }; if (l.isRectAreaLight || l.isSpotLight || l.isPointLight || l.isDirectionalLight) lights.push(o); });
  lights.sort((x, y) => (x.uuid < y.uuid ? 1 : x.uuid > y.uuid ? -1 : 0));
  mat.lights.updateFrom(lights, []);
}

function Seg<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <div style={{ padding: '6px 4px 2px' }}>
      <div className="caps" style={{ marginBottom: 5 }}>{label}</div>
      <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
        {options.map((o) => <button key={o.id} className={`btn sm ${o.id === value ? 'active' : 'ghost'}`} style={{ height: 24, padding: '0 8px', fontSize: 11.5, width: 'auto' }} onClick={() => onChange(o.id)}>{o.label}</button>)}
      </div>
      {hint && <div className="tiny muted" style={{ marginTop: 4, lineHeight: 1.35 }}>{hint}</div>}
    </div>
  );
}

function SunControl() {
  const sun = useStore((s) => s.sun);
  const set = useStore((s) => s.set);
  const doc = useDoc();
  const { lat, lon } = doc.meta.location;
  const pos = sunPosition(lat, lon, sun.month, sun.day, sun.hour);
  const hh = Math.floor(sun.hour), mm = Math.round((sun.hour - hh) * 60);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Sunrise and sunset for this place and date, so the presets land on the real golden hour.
  const { rise, setT } = useMemo(() => {
    let r = 6, s2 = 18, prev = sunPosition(lat, lon, sun.month, sun.day, 0).altitude;
    for (let h = 0.1; h <= 24; h += 0.1) { const a = sunPosition(lat, lon, sun.month, sun.day, h).altitude; if (prev <= 0 && a > 0) r = h; if (prev > 0 && a <= 0) s2 = h; prev = a; }
    return { rise: r, setT: s2 };
  }, [lat, lon, sun.month, sun.day]);
  const presets: [string, number, JSX.Element][] = [['Morning', rise + 1.6, <Sunrise key="a" size={12} />], ['Midday', (rise + setT) / 2, <SunIcon key="b" size={12} />], ['Golden hour', setT - 0.8, <CloudSun key="c" size={12} />], ['Dusk', setT + 0.22, <Sunset key="d" size={12} />], ['Night', Math.min(23.5, setT + 2.2), <Moon key="e" size={12} />]];
  return (
    <div className="floating" style={{ bottom: 16, left: 14, padding: '8px 12px', width: 330 }}>
      <div className="row small" style={{ marginBottom: 4 }}>
        {pos.altitude > 0 ? <SunIcon size={14} style={{ color: 'var(--warn)' }} /> : <Moon size={14} style={{ color: 'var(--ink-3)' }} />}
        <b style={{ fontWeight: 600 }}>{sun.day} {months[sun.month - 1]} · {String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}</b>
        <span className="spacer" />
        <span className="tiny muted">{doc.meta.location.city} · {pos.altitude > 0 ? `sun ${Math.round(pos.altitude)}° high` : 'after dark'}</span>
      </div>
      <input type="range" min={0} max={24} step={0.25} value={sun.hour} onChange={(e) => set('sun', { ...sun, hour: Number(e.target.value) })} aria-label="Time of day" />
      <input type="range" min={1} max={12} step={1} value={sun.month} onChange={(e) => set('sun', { ...sun, month: Number(e.target.value) })} aria-label="Month" />
      <div className="row" style={{ gap: 3, marginTop: 6, flexWrap: 'wrap' }}>
        {presets.map(([label, hour, icon]) => <button key={label} className={`btn sm ${Math.abs(sun.hour - hour) < 0.2 ? 'active' : 'ghost'}`} style={{ height: 22, padding: '0 6px', fontSize: 11, gap: 4 }} onClick={() => set('sun', { ...sun, hour: Math.round(hour * 4) / 4 })}>{icon}{label}</button>)}
      </div>
    </div>
  );
}

function highlight(content: SceneResult, ids: Set<string>) {
  for (const o of content.pickables) {
    const m = o as THREE.Mesh;
    const ref = m.userData.ref as { id: string } | undefined;
    if (!m.userData.baseMat) m.userData.baseMat = m.material;
    const base = m.userData.baseMat as THREE.Material;
    if (ref && ids.has(ref.id)) {
      if (!m.userData.hiMat) {
        const hi = base.clone();
        if ('emissive' in hi) { (hi as THREE.MeshStandardMaterial).emissive = new THREE.Color('#3358d4'); (hi as THREE.MeshStandardMaterial).emissiveIntensity = 0.5; }
        else (hi as THREE.MeshBasicMaterial).color = new THREE.Color('#9fb3ef');
        m.userData.hiMat = hi;
      }
      m.material = m.userData.hiMat as THREE.Material;
    } else m.material = base;
  }
}

function downscale(canvas: HTMLCanvasElement, w: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round((canvas.height / canvas.width) * w);
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export default Viewport3D;
