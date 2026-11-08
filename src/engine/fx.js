// Visual effects: GPU particle bursts and emitters, flash lights, floating text.
import * as THREE from 'three';

const VERT = `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  gl_FragColor = vec4(vColor, a);
}`;

function createPool(scene, max, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  const size = new Float32Array(max);
  const alpha = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: window.innerHeight / 2 } },
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max);
  const maxLife = new Float32Array(max);
  const grav = new Float32Array(max);
  const drag = new Float32Array(max);
  const size0 = new Float32Array(max);
  const grow = new Float32Array(max);
  let cursor = 0;
  return {
    points, mat,
    spawn(p, v, c, s, l, g, dr, gr) {
      const i = cursor; cursor = (cursor + 1) % max;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = s; size0[i] = s; life[i] = l; maxLife[i] = l; grav[i] = g; drag[i] = dr; grow[i] = gr;
      alpha[i] = 1;
    },
    update(dt) {
      for (let i = 0; i < max; i++) {
        if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; } continue; }
        life[i] -= dt;
        const k = Math.max(0, life[i] / maxLife[i]);
        const d = Math.exp(-drag[i] * dt);
        vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d + grav[i] * dt; vel[i * 3 + 2] *= d;
        pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        alpha[i] = k < 0.3 ? k / 0.3 : 1;
        size[i] = size0[i] * (1 + grow[i] * (1 - k));
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.aAlpha.needsUpdate = true;
      geo.attributes.aSize.needsUpdate = true;
      geo.attributes.aColor.needsUpdate = true;
    },
    clear() { life.fill(0); alpha.fill(0); },
  };
}

export function createFX({ scene, getCamera, uiRoot }) {
  const glow = createPool(scene, 3000, true);
  const soft = createPool(scene, 2000, false);
  const tmpV = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const tmpP = new THREE.Vector3();
  const emitters = new Set();
  const lights = [];
  const texts = [];
  for (let i = 0; i < 4; i++) {
    const l = new THREE.PointLight(0xffaa55, 0, 12, 2);
    l.userData.t = 0; l.userData.dur = 0; l.userData.peak = 0;
    scene.add(l); lights.push(l);
  }

  function rand() { return Math.random() * 2 - 1; }

  // burst(position, options): one-shot explosion of particles.
  function burst(position, { count = 30, color = 0xffaa33, color2 = null, speed = 6, spread = 1, up = 0.3,
    life = 0.8, size = 0.35, gravity = -6, drag = 1.5, additive = true, grow = 0.5 } = {}) {
    const pool = additive ? glow : soft;
    const c1 = new THREE.Color(color), c2 = color2 != null ? new THREE.Color(color2) : c1;
    for (let i = 0; i < count; i++) {
      tmpV.set(rand(), rand() * spread + up, rand()).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.6));
      tmpC.copy(c1).lerp(c2, Math.random());
      pool.spawn(position, tmpV, tmpC, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity, drag, grow);
    }
  }

  // emitter(options): continuous stream; call setPosition each frame, stop() when done.
  function emitter({ rate = 40, color = 0xffffff, color2 = null, speed = 2, direction = [0, 1, 0], spread = 0.4,
    life = 0.7, size = 0.25, gravity = 0, drag = 1, additive = true, grow = 1 } = {}) {
    const e = { rate, acc: 0, pos: new THREE.Vector3(), dir: new THREE.Vector3(...direction).normalize(), active: true,
      c1: new THREE.Color(color), c2: color2 != null ? new THREE.Color(color2) : new THREE.Color(color),
      setPosition(p) { this.pos.copy(p); return this; },
      setDirection(d) { this.dir.copy(d).normalize(); return this; },
      setRate(r) { this.rate = r; return this; },
      stop() { this.active = false; emitters.delete(this); } };
    e.spawn = (dt) => {
      e.acc += e.rate * dt;
      const pool = additive ? glow : soft;
      while (e.acc >= 1) {
        e.acc -= 1;
        tmpV.copy(e.dir).add(tmpP.set(rand() * spread, rand() * spread, rand() * spread)).normalize()
          .multiplyScalar(speed * (0.6 + Math.random() * 0.4));
        tmpC.copy(e.c1).lerp(e.c2, Math.random());
        pool.spawn(e.pos, tmpV, tmpC, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), gravity, drag, grow);
      }
    };
    emitters.add(e);
    return e;
  }

  function flashLight(position, { color = 0xffaa55, intensity = 60, distance = 14, duration = 0.35 } = {}) {
    const l = lights.reduce((a, b) => (a.userData.t <= b.userData.t ? a : b));
    l.position.copy(position); l.color.set(color); l.distance = distance;
    l.userData.t = duration; l.userData.dur = duration; l.userData.peak = intensity;
    l.intensity = intensity;
  }

  // Floating text that rises from a 3D point (score popups, damage numbers).
  function floatText(position, text, { color = '#ffffff', size = 22, duration = 1.0, rise = 60 } = {}) {
    if (!uiRoot) return;
    const el = document.createElement('div');
    el.className = 'fx-float';
    el.textContent = text;
    el.style.color = color;
    el.style.fontSize = size + 'px';
    uiRoot.appendChild(el);
    texts.push({ el, pos: position.clone(), t: 0, duration, rise });
  }

  function update(dt) {
    for (const e of emitters) if (e.active) e.spawn(dt);
    glow.update(dt); soft.update(dt);
    glow.mat.uniforms.uScale.value = soft.mat.uniforms.uScale.value = window.innerHeight / 2;
    for (const l of lights) {
      if (l.userData.t > 0) {
        l.userData.t -= dt;
        l.intensity = l.userData.peak * Math.max(0, l.userData.t / l.userData.dur);
      } else if (l.intensity !== 0) l.intensity = 0;
    }
    const cam = getCamera();
    for (let i = texts.length - 1; i >= 0; i--) {
      const f = texts[i];
      f.t += dt;
      const k = f.t / f.duration;
      if (k >= 1) { f.el.remove(); texts.splice(i, 1); continue; }
      tmpV.copy(f.pos).project(cam);
      const x = (tmpV.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-tmpV.y * 0.5 + 0.5) * window.innerHeight - f.rise * k;
      f.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      f.el.style.opacity = String(k < 0.7 ? 1 : (1 - k) / 0.3);
      f.el.style.display = tmpV.z > 1 ? 'none' : 'block';
    }
  }

  function clear() {
    glow.clear(); soft.clear();
    for (const e of [...emitters]) e.stop();
    for (const f of texts) f.el.remove();
    texts.length = 0;
    for (const l of lights) { l.userData.t = 0; l.intensity = 0; }
  }

  return { burst, emitter, flashLight, floatText, update, clear };
}
