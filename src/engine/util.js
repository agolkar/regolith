// Small math and helper functions shared by the engine and the game.
import * as THREE from 'three';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const smoothstep = (a, b, v) => {
  const t = clamp(invLerp(a, b, v), 0, 1);
  return t * t * (3 - 2 * t);
};
// Frame-rate independent exponential smoothing: damp(current, target, lambda, dt).
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

// Seeded pseudo random generator (mulberry32). Returns a function giving [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed = 12345) {
  const next = mulberry32(seed);
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
  };
}

export const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

export function distXZ(a, b) {
  const dx = a.x - b.x, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function spheresOverlap(p1, r1, p2, r2) {
  const dx = p1.x - p2.x, dy = p1.y - p2.y, dz = p1.z - p2.z;
  const r = r1 + r2;
  return dx * dx + dy * dy + dz * dz <= r * r;
}

export function boxesOverlap(a, b) {
  // a, b: {min: {x,y,z}, max: {x,y,z}}
  return a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z;
}

// Object pool: pool(() => new Thing()).get() / .release(obj)
export function pool(factory) {
  const free = [];
  return {
    get() { return free.length ? free.pop() : factory(); },
    release(o) { free.push(o); },
    get size() { return free.length; },
  };
}

// Dispose every geometry, material and texture under an object, then detach it.
export function disposeObject(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
  if (obj.parent) obj.parent.remove(obj);
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
