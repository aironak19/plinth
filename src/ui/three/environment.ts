/**
 * Sky, sun and atmosphere. The sun direction comes from the project's real
 * latitude, longitude, date and time; the same physical sky lights the model
 * (as an image-based environment), fills the background and drives fog and
 * exposure — so a 6 pm render looks like 6 pm, and night switches the house
 * lights on.
 */
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { setNight } from './materials3d';

export type Weather = 'clear' | 'cloudy' | 'overcast' | 'haze';
export const WEATHERS: { id: Weather; label: string }[] = [{ id: 'clear', label: 'Clear' }, { id: 'cloudy', label: 'Scattered cloud' }, { id: 'overcast', label: 'Overcast' }, { id: 'haze', label: 'Warm haze' }];

export interface Environment {
  sky: Sky;
  /** Sky helpers that must leave the scene while path tracing. */
  extras: THREE.Object3D[];
  sun: THREE.DirectionalLight;
  moon: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  stars: THREE.Points;
  /** 0 day → 1 night, for anything else that wants to follow the light. */
  night: number;
  update(o: { dir: THREE.Vector3; altitude: number; weather: Weather; realistic: boolean; center: THREE.Vector3; span: number; shadowSize: number }): void;
  tick(dt: number): void;
  dispose(): void;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene): Environment {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const studio = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const sky = new Sky();
  sky.scale.setScalar(1800);
  sky.frustumCulled = false;
  sky.userData.noPick = true;
  // A second sky, without the sun disc, is what gets baked into the lighting environment.
  const bakeScene = new THREE.Scene();
  const bakeSky = new Sky();
  bakeSky.scale.setScalar(1800);
  bakeScene.add(bakeSky);
  let envRT: THREE.WebGLRenderTarget | null = null;
  let bakeTimer = 0;
  let pendingKey = '', bakedKey = '';

  const sun = new THREE.DirectionalLight('#fff3e0', 3);
  sun.castShadow = true;
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 2.2;
  const moon = new THREE.DirectionalLight('#9db4dc', 0);
  const fill = new THREE.HemisphereLight('#dfe9f5', '#b9ad96', 0.3);

  const sg = new THREE.BufferGeometry();
  const sp: number[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 900; i++) { const a = rnd() * Math.PI * 2, e = Math.asin(0.06 + rnd() * 0.94); sp.push(Math.cos(a) * Math.cos(e) * 800, Math.sin(e) * 800, Math.sin(a) * Math.cos(e) * 800); }
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  stars.frustumCulled = false;
  stars.userData.noPick = true;
  // Night sky: the physical model goes black once the sun sets, so a deep-blue dome fades in over it.
  const dusk = new THREE.Mesh(new THREE.SphereGeometry(1700, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uNight: { value: 0 } }, side: THREE.BackSide, depthWrite: false, transparent: true, fog: false,
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform float uNight; varying vec3 vDir;
      void main() { float h = clamp(vDir.y, 0.0, 1.0); vec3 c = mix(vec3(0.05, 0.062, 0.115), vec3(0.004, 0.008, 0.028), pow(h, 0.45));
        gl_FragColor = vec4(c, uNight);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  dusk.renderOrder = -1; dusk.frustumCulled = false; dusk.userData.noPick = true;
  sky.renderOrder = -2;
  scene.add(sun, sun.target, moon, moon.target, fill);

  const env: Environment = {
    sky, extras: [stars, dusk], sun, moon, fill, stars, night: 0,
    update({ dir, altitude, weather, realistic, center, span, shadowSize }) {
      const day = smooth(-2, 24, altitude);
      const night = 1 - smooth(-7, 3, altitude);
      env.night = realistic ? night : 0;
      setNight(env.night);
      const golden = 1 - smooth(4, 28, altitude);
      const cloud = weather === 'overcast' ? 1 : weather === 'cloudy' ? 0.45 : 0;

      // ---- direct light
      const sunDir = dir.clone().normalize();
      const above = altitude > -1;
      const lightDir = above ? sunDir : new THREE.Vector3(-0.35, 0.75, 0.45).normalize();
      for (const l of [sun, moon]) { l.position.copy(center).addScaledVector(lightDir, span * 2.2 + 40); l.target.position.copy(center); }
      const cam = sun.shadow.camera, r = span * 0.95 + 8;
      cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = span * 6 + 120;
      cam.updateProjectionMatrix();
      if (sun.shadow.mapSize.x !== shadowSize) { sun.shadow.mapSize.set(shadowSize, shadowSize); sun.shadow.map?.dispose(); sun.shadow.map = null; }
      if (!realistic) {
        sun.intensity = altitude > 0 ? 1.2 + 3.6 * day : 0;
        sun.color.setHSL(0.09, 0.6 * (1 - day) + 0.15, 0.82 + 0.12 * day);
        moon.intensity = 0;
        fill.intensity = 0.35 + 0.45 * day; fill.color.set('#dfe9f5'); fill.groundColor.set('#b9ad96');
        scene.environment = studio; scene.environmentIntensity = 0.38;
        sky.visible = false; stars.visible = false; dusk.visible = false;
        return;
      }
      const direct = (1 - cloud * 0.9) * (weather === 'haze' ? 0.75 : 1);
      sun.intensity = above ? (0.8 + 9.6 * day) * direct * (1 - night) : 0.3 * night;
      sun.color.setHSL(above ? 0.075 + 0.035 * (1 - golden) : 0.6, above ? 0.28 + 0.62 * golden : 0.45, above ? 0.9 - 0.16 * golden : 0.78);
      moon.intensity = 0;
      // Warm light bounced up from the ground keeps shaded walls from going cold blue.
      fill.color.set(night > 0.5 ? '#3a4a6e' : '#f2f1ec'); fill.groundColor.set(night > 0.5 ? '#141820' : '#c9b48f');
      fill.intensity = (0.5 + 0.3 * cloud) * (0.35 + 0.65 * day) * (1 - night) + 0.14 * night;

      // ---- sky dome
      const u = sky.material.uniforms, b = bakeSky.material.uniforms;
      const turbidity = weather === 'haze' ? 12 : weather === 'overcast' ? 16 : 2.4 + golden * 3.5;
      const set = (k: string, v: number) => { u[k].value = v; b[k].value = v; };
      set('turbidity', turbidity);
      set('rayleigh', (weather === 'overcast' ? 0.6 : weather === 'haze' ? 2.2 : 1.1 + golden * 1.6) * (1 - night * 0.93));
      set('mieCoefficient', weather === 'haze' ? 0.02 : 0.005);
      set('mieDirectionalG', 0.82);
      set('cloudCoverage', weather === 'overcast' ? 0.92 : weather === 'cloudy' ? 0.5 : weather === 'haze' ? 0.18 : 0.12);
      set('cloudDensity', weather === 'overcast' ? 0.75 : 0.42);
      set('cloudElevation', 0.5);
      u.sunPosition.value.copy(sunDir); b.sunPosition.value.copy(sunDir);
      u.showSunDisc.value = 1; b.showSunDisc.value = 0;
      sky.visible = true;
      scene.background = null;
      dusk.visible = night > 0.02; (dusk.material as THREE.ShaderMaterial).uniforms.uNight.value = night;
      stars.visible = night > 0.05;
      (stars.material as THREE.PointsMaterial).opacity = night * (1 - cloud) * 0.9;
      renderer.toneMappingExposure = (0.5 + 0.22 * (1 - day) + 0.12 * cloud) * (1 + night * 1.1);
      // The physical sky is far brighter than a studio HDRI; scale it so the sun still dominates.
      scene.environmentIntensity = 0.34 + 0.3 * cloud + 0.5 * (1 - day) * (1 - night) + night * 1.2;
      const haze = new THREE.Color().setHSL(0.58 - 0.5 * golden * (1 - cloud) * (1 - night), 0.25 + 0.2 * golden, (0.82 - 0.1 * golden) * (1 - night * 0.93));
      scene.fog = new THREE.Fog(haze, span * 2.6 + 90, span * 9 + 520);

      // Re-bake the lighting environment shortly after the sky stops changing.
      pendingKey = `${sunDir.x.toFixed(3)},${sunDir.y.toFixed(3)},${sunDir.z.toFixed(3)}|${weather}`;
      if (pendingKey !== bakedKey) bakeTimer = envRT ? 0.12 : 0;
      if (!envRT) env.tick(1);
    },
    tick(dt) {
      const u = sky.material.uniforms;
      u.time.value += dt * 12;
      if (pendingKey === bakedKey) return;
      bakeTimer -= dt;
      if (bakeTimer > 0) return;
      bakeSky.material.uniforms.time.value = u.time.value;
      const next = pmrem.fromScene(bakeScene, 0, 1, 4000);
      scene.environment = next.texture;
      envRT?.dispose();
      envRT = next;
      bakedKey = pendingKey;
    },
    dispose() { envRT?.dispose(); studio.dispose(); pmrem.dispose(); sg.dispose(); },
  };
  scene.add(sky, dusk, stars);
  return env;
}
