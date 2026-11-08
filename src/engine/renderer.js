// Renderer, scene, camera, lighting rig, environment and post-processing.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { damp } from './util.js';

export function createRenderer(container, { qa = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a9c9);
  let camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
  camera.position.set(0, 6, 12);
  camera.lookAt(0, 0, 0);

  // Lighting rig: sky/ground fill plus a shadow-casting sun. Values are in the
  // physical units three.js r160 uses (directional 2-4, hemisphere 0.5-1.5).
  const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x4a4036, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
  sun.position.set(30, 50, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 200;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  setShadowRadius(40);
  scene.add(sun);
  scene.add(sun.target);
  let shadowFollow = null;
  const sunOffset = sun.position.clone();

  function setShadowRadius(r) {
    const c = sun.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.updateProjectionMatrix();
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  let envRT = null;
  function useRoomEnvironment(intensity = 1) {
    if (envRT) envRT.dispose();
    envRT = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
    scene.environment = envRT.texture;
    setEnvIntensity(intensity);
  }
  function setEnvIntensity(v) {
    scene.traverse((o) => {
      if (o.material && 'envMapIntensity' in o.material) o.material.envMapIntensity = v;
    });
  }
  useRoomEnvironment();

  // Post-processing: render, subtle bloom, output (tone mapping and sRGB).
  let composer = null, bloom = null, bloomEnabled = true;
  function buildComposer() {
    // HDR render target with 4x multisampling: post-processing keeps the antialiasing.
    const pr = renderer.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(window.innerWidth * pr, window.innerHeight * pr,
      { type: THREE.HalfFloatType, samples: 4 });
    composer = new EffectComposer(renderer, rt);
    composer.setPixelRatio(pr);
    composer.setSize(window.innerWidth, window.innerHeight);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 1.0);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  }
  buildComposer();

  // Per-frame hooks (sky that follows the camera, and similar).
  const updaters = [];
  function addUpdater(fn) { updaters.push(fn); }

  // Camera effects: follow controller and shake.
  let follow = null;
  let shakeT = 0, shakeDur = 0, shakeAmp = 0;
  const shakeOffset = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function setCamera(cam) {
    camera = cam;
    composer.passes[0].camera = cam;
    resize();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    if (camera.isPerspectiveCamera) {
      camera.aspect = w / h;
    } else if (camera.isOrthographicCamera && camera.userData.viewHeight) {
      const vh = camera.userData.viewHeight;
      camera.left = (-vh * w / h) / 2; camera.right = (vh * w / h) / 2;
      camera.top = vh / 2; camera.bottom = -vh / 2;
    }
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  const env = {
    sun,
    hemi,
    // Equirectangular panorama as background and reflections.
    setPanorama(tex, { background = true, environment = true, intensity = 1, blur = 0 } = {}) {
      if (!tex || !tex.image || tex.userData.placeholder) return;
      tex.mapping = THREE.EquirectangularReflectionMapping;
      if (background) {
        scene.background = tex;
        scene.backgroundBlurriness = blur;
        scene.backgroundIntensity = intensity;
      }
      if (environment) {
        if (envRT) envRT.dispose();
        envRT = pmrem.fromEquirectangular(tex);
        scene.environment = envRT.texture;
      }
    },
    useRoomEnvironment,
    setEnvIntensity,
    setBackground(color) { scene.background = new THREE.Color(color); },
    setFog(color, near = 30, far = 300) { scene.fog = new THREE.Fog(color, near, far); },
    setFogExp(color, density = 0.01) { scene.fog = new THREE.FogExp2(color, density); },
    clearFog() { scene.fog = null; },
    setSun({ direction, color, intensity, shadowRadius } = {}) {
      if (direction) { sunOffset.set(direction[0], direction[1], direction[2]).normalize().multiplyScalar(60); }
      if (color != null) sun.color = new THREE.Color(color);
      if (intensity != null) sun.intensity = intensity;
      if (shadowRadius) setShadowRadius(shadowRadius);
    },
    setHemisphere({ sky, ground, intensity } = {}) {
      if (sky != null) hemi.color = new THREE.Color(sky);
      if (ground != null) hemi.groundColor = new THREE.Color(ground);
      if (intensity != null) hemi.intensity = intensity;
    },
    // Keeps the shadow map centred on a moving object (the player).
    followShadow(obj) { shadowFollow = obj; },
    setExposure(v) { renderer.toneMappingExposure = v; },
    setBloom({ strength, radius, threshold, enabled } = {}) {
      if (strength != null) bloom.strength = strength;
      if (radius != null) bloom.radius = radius;
      if (threshold != null) bloom.threshold = threshold;
      if (enabled != null) bloomEnabled = enabled;
    },
  };

  const cam = {
    // Smooth third-person follow. offset is in the target's local frame when
    // rotate is true (behind a vehicle), otherwise in world space (top-down).
    follow(target, { offset = [0, 5, -10], lookAt = [0, 1, 0], stiffness = 6, rotate = true, lookAhead = 0 } = {}) {
      follow = { target, offset: new THREE.Vector3(...offset), look: new THREE.Vector3(...lookAt), stiffness, rotate, lookAhead, init: false, vel: new THREE.Vector3(), last: new THREE.Vector3() };
      return follow;
    },
    stopFollow() { follow = null; },
    shake(intensity = 0.3, duration = 0.3) {
      shakeAmp = Math.max(shakeAmp * (shakeT > 0 ? 1 : 0), intensity);
      shakeDur = duration; shakeT = duration;
    },
    perspective(fov = 60, near = 0.1, far = 3000) {
      const c = new THREE.PerspectiveCamera(fov, window.innerWidth / window.innerHeight, near, far);
      setCamera(c); return c;
    },
    orthographic(viewHeight = 20, near = 0.1, far = 1000) {
      const a = window.innerWidth / window.innerHeight;
      const c = new THREE.OrthographicCamera((-viewHeight * a) / 2, (viewHeight * a) / 2, viewHeight / 2, -viewHeight / 2, near, far);
      c.userData.viewHeight = viewHeight;
      setCamera(c); return c;
    },
  };

  function update(dt) {
    if (follow && follow.target) {
      const t = follow.target;
      t.updateMatrixWorld();
      tmp.copy(follow.offset);
      if (follow.rotate) tmp.applyQuaternion(t.getWorldQuaternion(new THREE.Quaternion()));
      const tp = t.getWorldPosition(tmp2);
      if (follow.lookAhead) {
        follow.vel.copy(tp).sub(follow.last).divideScalar(Math.max(dt, 1e-4));
        follow.last.copy(tp);
      }
      const desired = tp.clone().add(tmp);
      if (!follow.init) { camera.position.copy(desired); follow.init = true; follow.last.copy(tp); }
      const k = 1 - Math.exp(-follow.stiffness * dt);
      camera.position.lerp(desired, k);
      const look = tp.clone().add(follow.look);
      if (follow.lookAhead) look.addScaledVector(follow.vel, follow.lookAhead);
      camera.lookAt(look);
    }
    if (shakeT > 0) {
      shakeT -= dt;
      const a = shakeAmp * Math.max(0, shakeT / Math.max(shakeDur, 1e-4));
      shakeOffset.set((Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a, (Math.random() - 0.5) * 2 * a);
    } else {
      shakeOffset.set(0, 0, 0);
      shakeAmp = 0;
    }
    for (const fn of updaters) fn(dt);
    if (shadowFollow) {
      const p = shadowFollow.getWorldPosition(tmp);
      sun.target.position.copy(p);
      sun.position.copy(p).add(sunOffset);
    } else {
      sun.position.copy(sun.target.position).add(sunOffset);
    }
  }

  function render() {
    camera.position.add(shakeOffset);
    if (bloomEnabled && quality.level >= 2) composer.render();
    else renderer.render(scene, camera);
    camera.position.sub(shakeOffset);
  }

  // Automatic quality: 3 = full, 2 = no shadows softening, 1 = no bloom and lower resolution.
  const quality = {
    level: 3,
    set(level) {
      quality.level = level;
      if (level <= 1) {
        renderer.setPixelRatio(1);
        sun.shadow.mapSize.set(1024, 1024);
      }
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      resize();
    },
  };

  return {
    renderer,
    scene,
    get camera() { return camera; },
    setCamera,
    env,
    cam,
    quality,
    update,
    render,
    resize,
    addUpdater,
    get composer() { return composer; },
    dampValue: damp,
  };
}
