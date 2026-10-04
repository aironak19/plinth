/**
 * Real-time 3D viewport — a second view of the same model, never a copy.
 * Rebuilds only when the building, site or style changes; selection is shared
 * with the plan; sun position comes from the project's real location and date.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Camera, Footprints, Layers, Scissors, Sun as SunIcon, Bookmark, Orbit, ChevronDown, Download } from 'lucide-react';
import { useStore } from '../../state/store';
import { useDoc, useRules, useBuilding, useLevels } from '../../state/derived';
import { buildScene, disposeGroup, toThree, fromThree, type SceneResult } from './sceneBuilder';
import { sunPosition, sunVector } from '../../core/derive/sun';
import { bbox } from '../../core/geometry/polygon';
import type { RenderStyle, Scene } from '../../core/model/types';
import { Popover } from '../components';
import { uid } from '../../core/model/ids';
import { loadRenders, saveRenders } from '../../state/persist';

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
  const ctx = useRef<{
    renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; walk: PointerLockControls;
    sunLight: THREE.DirectionalLight; hemi: THREE.HemisphereLight; content: SceneResult | null; raf: number; keys: Set<string>; clip: THREE.Plane; dirty: boolean;
  } | null>(null);
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
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.38;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.screenSpacePanning = true;
    const walk = new PointerLockControls(camera, renderer.domElement);
    const hemi = new THREE.HemisphereLight('#dfe9f5', '#b9ad96', 0.55);
    scene.add(hemi);
    const sunLight = new THREE.DirectionalLight('#fff5e6', 2.6);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(4096, 4096);
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.03;
    scene.add(sunLight, sunLight.target);
    const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1000);
    const keys = new Set<string>();
    const state = { renderer, scene, camera, controls, walk, sunLight, hemi, content: null as SceneResult | null, raf: 0, keys, clip, dirty: true };
    ctx.current = state;
    const resize = () => {
      const w = el.clientWidth || 800, h = el.clientHeight || 600;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    const clock = new THREE.Clock();
    const loop = () => {
      const dt = Math.min(0.05, clock.getDelta());
      if (walk.isLocked) {
        const sp = (keys.has('ShiftLeft') ? 6 : 2.6) * dt;
        if (keys.has('KeyW') || keys.has('ArrowUp')) walk.moveForward(sp);
        if (keys.has('KeyS') || keys.has('ArrowDown')) walk.moveForward(-sp);
        if (keys.has('KeyA') || keys.has('ArrowLeft')) walk.moveRight(-sp);
        if (keys.has('KeyD') || keys.has('ArrowRight')) walk.moveRight(sp);
      } else controls.update();
      renderer.render(scene, camera);
      state.raf = requestAnimationFrame(loop);
    };
    loop();
    // picking
    let down = { x: 0, y: 0 };
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (walk.isLocked || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || !state.content) return;
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
    c.content = buildScene(doc, b, rules, style, hidden, new Set());
    c.scene.add(c.content.group);
    highlight(c.content, selectedIdsRef.current);
    const bg = style === 'realistic' ? skyTexture() : null;
    c.scene.background = bg ?? new THREE.Color(style === 'sketch' ? '#fbfaf7' : style === 'wireframe' ? '#fbfaf7' : style === 'architectural' ? '#f1f0ec' : style === 'xray' ? '#f5f6f8' : style === 'clay' ? '#e9e7e2' : '#eef1f4');
    c.scene.fog = style === 'realistic' ? new THREE.Fog('#dfe7ee', 120, 420) : null;
    c.renderer.shadowMap.enabled = style !== 'sketch' && style !== 'wireframe' && style !== 'draft' && style !== 'xray';
    if (import.meta.env.DEV) console.debug(`[plinth] 3D rebuild ${Math.round(performance.now() - t0)} ms`);
  }, [doc.site, b, rules, style, hidden]);

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

  // ---- sun
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const { lat, lon } = doc.meta.location;
    const pos = sunPosition(lat, lon, sun.month, sun.day, sun.hour);
    const v = sunVector(pos, doc.site.northAngle);
    const bb = bbox(doc.site.boundary);
    const center = toThree({ x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, z: 0 });
    const span = Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / 1000;
    const dir = new THREE.Vector3(v.x, v.z, -v.y).normalize();
    c.sunLight.position.copy(center.clone().add(dir.multiplyScalar(span * 2.2 + 40)));
    c.sunLight.target.position.copy(center);
    const cam = c.sunLight.shadow.camera;
    const r = span * 0.95 + 8;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = span * 6 + 120;
    cam.updateProjectionMatrix();
    const day = Math.max(0, Math.min(1, pos.altitude / 25));
    c.sunLight.intensity = pos.altitude > 0 ? 1.2 + 3.6 * day : 0;
    c.sunLight.color.setHSL(0.09, 0.6 * (1 - day) + 0.15, 0.82 + 0.12 * day);
    c.hemi.intensity = 0.35 + 0.45 * day;
  }, [sun, doc.meta.location, doc.site]);

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
    c.renderer.render(c.scene, c.camera);
    const thumb = downscale(c.renderer.domElement, 240);
    useStore.getState().dispatch([{ type: 'scene.save', params: { scene: { name, camera: { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], fov: c.camera.fov, projection: 'perspective' }, renderStyle: style, sun, hiddenLevels: [...hidden], thumbnail: thumb } } }]);
  }

  async function render() {
    const c = ctx.current;
    if (!c) return;
    const old = c.renderer.getPixelRatio();
    c.renderer.setPixelRatio(Math.min(3, old * 1.6));
    c.renderer.render(c.scene, c.camera);
    const url = c.renderer.domElement.toDataURL('image/png');
    c.renderer.setPixelRatio(old);
    const list = await loadRenders(doc.id);
    const name = `${doc.meta.name} — ${STYLES.find((x) => x.id === style)?.label} ${new Date().toLocaleString()}`;
    await saveRenders(doc.id, [{ id: uid('rn'), projectId: doc.id, name, dataUrl: downscale(c.renderer.domElement, 1600), createdAt: Date.now(), style }, ...list].slice(0, 24));
    const a = document.createElement('a');
    a.href = url; a.download = `${doc.meta.name.replace(/\W+/g, '-')}-render.png`; a.click();
    useStore.getState().toast('Render ready — saved to project renders and downloaded');
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

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} aria-label="3D model viewport" role="img" />
      {!present && (
        <>
          <div className="floating ctxbar" style={{ top: 12, left: 12, transform: 'none', animation: 'none' }}>
            <Popover anchor={<button><Orbit size={14} /> {STYLES.find((x) => x.id === style)?.label} <ChevronDown size={12} /></button>}>
              {(close) => <div style={{ width: 180 }}>{STYLES.map((x) => <button key={x.id} onClick={() => { close(); set('renderStyle', x.id); }}>{x.label}</button>)}</div>}
            </Popover>
            <span className="sep" />
            <button aria-pressed={cutaway} style={cutaway ? { color: 'var(--accent)' } : undefined} onClick={() => setCutaway(!cutaway)} title="Cut the model above the active level"><Scissors size={14} />{!compact && ' Section'}</button>
            <button style={!showUpper ? { color: 'var(--accent)' } : undefined} onClick={() => setShowUpper(!showUpper)} title="Hide levels above the active level"><Layers size={14} />{!compact && ' Upper levels'}</button>
            <button onClick={startWalk} title="Walk through (WASD, mouse to look, Esc to exit)"><Footprints size={14} />{!compact && ' Walk'}</button>
            <span className="sep" />
            <Popover anchor={<button title="Saved scenes"><Bookmark size={14} />{!compact && ` Scenes (${doc.scenes.length})`}</button>}>
              {(close) => (
                <div style={{ width: 260 }}>
                  {doc.scenes.map((sc) => <button key={sc.id} onClick={() => { close(); applyScene(sc); }}>{sc.thumbnail ? <img src={sc.thumbnail} alt="" style={{ width: 44, height: 28, objectFit: 'cover', borderRadius: 4 }} /> : <Camera size={14} />}<span className="grow">{sc.name}</span></button>)}
                  {doc.scenes.length > 0 && <div className="sep" />}
                  <button onClick={() => { close(); saveScene(); }}><Bookmark size={14} /> Save current view as scene</button>
                </div>
              )}
            </Popover>
            <button onClick={() => void render()} title="Render a high-resolution image"><Camera size={14} />{!compact && ' Render'}</button>
            <Popover anchor={<button title="Export 3D"><Download size={14} /></button>}>
              {(close) => <div style={{ width: 200 }}><button onClick={() => { close(); void exportModel('gltf'); }}>glTF binary (.glb)</button><button onClick={() => { close(); void exportModel('obj'); }}>Wavefront (.obj)</button></div>}
            </Popover>
          </div>
          {!compact && <SunControl />}
          {walking && <div className="hint">Walking · <span className="kbd">W</span><span className="kbd">A</span><span className="kbd">S</span><span className="kbd">D</span> to move · <span className="kbd">Shift</span> faster · <span className="kbd">Esc</span> to exit</div>}
        </>
      )}
    </div>
  );
}

function SunControl() {
  const sun = useStore((s) => s.sun);
  const set = useStore((s) => s.set);
  const doc = useDoc();
  const pos = sunPosition(doc.meta.location.lat, doc.meta.location.lon, sun.month, sun.day, sun.hour);
  const hh = Math.floor(sun.hour), mm = Math.round((sun.hour - hh) * 60);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return (
    <div className="floating" style={{ bottom: 16, left: 14, padding: '8px 12px', width: 300 }}>
      <div className="row small" style={{ marginBottom: 4 }}>
        <SunIcon size={14} style={{ color: pos.altitude > 0 ? 'var(--warn)' : 'var(--ink-4)' }} />
        <b style={{ fontWeight: 600 }}>{sun.day} {months[sun.month - 1]} · {String(hh).padStart(2, '0')}:{String(mm).padStart(2, '0')}</b>
        <span className="spacer" />
        <span className="tiny muted">{doc.meta.location.city} · alt {Math.round(pos.altitude)}° az {Math.round(pos.azimuth)}°</span>
      </div>
      <input type="range" min={5} max={19.5} step={0.25} value={sun.hour} onChange={(e) => set('sun', { ...sun, hour: Number(e.target.value) })} aria-label="Time of day" />
      <input type="range" min={1} max={12} step={1} value={sun.month} onChange={(e) => set('sun', { ...sun, month: Number(e.target.value) })} aria-label="Month" />
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

let skyTex: THREE.Texture | null = null;
function skyTexture() {
  if (skyTex) return skyTex;
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#9fbedb'); grd.addColorStop(0.55, '#d8e4ee'); grd.addColorStop(1, '#eef0ec');
  g.fillStyle = grd; g.fillRect(0, 0, 2, 256);
  skyTex = new THREE.CanvasTexture(c);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  return skyTex;
}

function downscale(canvas: HTMLCanvasElement, w: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = Math.round((canvas.height / canvas.width) * w);
  c.getContext('2d')!.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export default Viewport3D;
