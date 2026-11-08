// Procedural rocky terrain, tuned for the lunar surface: gentle hills, impact craters
// of every size with raised rims and bright fresh ejecta, a ring of distant rim
// mountains that hides the edge of the world, flattened areas, and instanced
// boulders with collision queries. heightAt() matches the rendered triangles exactly.
import * as THREE from 'three';
import { mulberry32 } from './util.js';

function createNoise2D(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const g = (h, dx, dy) => GX[h & 7] * dx + GY[h & 7] * dy;
  return function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = g(aa, xf, yf) + u * (g(ba, xf - 1, yf) - g(aa, xf, yf));
    const x2 = g(ab, xf, yf - 1) + u * (g(bb, xf - 1, yf - 1) - g(ab, xf, yf - 1));
    return (x1 + v * (x2 - x1)) * 0.75;
  };
}

function fbm(noise, x, y, octaves = 4, gain = 0.5) {
  let a = 1, f = 1, s = 0, n = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * noise(x * f, y * f);
    n += a; a *= gain; f *= 2.03;
  }
  return s / n;
}

function makeRockGeometry(noise, detail, k) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const d = 1 + 0.32 * noise(v.x * 1.6 + k * 7.1, v.y * 1.6 + v.z * 1.3) + 0.12 * noise(v.x * 4.1 + k, v.z * 4.3 - v.y);
    v.multiplyScalar(d);
    v.y *= 0.62;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function createTerrainFactory({ scene, assets }) {
  return {
    // Returns { group, mesh, rocks, heightAt, normalAt, slopeAt, rockAt, randomPoint, addCrater, half, playRadius, size }
    create(opts = {}) {
      const {
        size = 1200, segments = 448, seed = 7,
        textureId = 'tex_regolith', repeat = null, color = null,
        hills = 6, hillScale = 240, detail = 0.5, detailScale = 16,
        craters = 110, craterMin = 3, craterMax = 70, freshFraction = 0.25,
        rim = { height: 48, start: 0.8 }, flat = [{ x: 0, z: 0, radius: 22 }],
        rocks = { count: 1400, min: 0.12, max: 2.4, textureId: 'tex_rock' },
        albedoVariation = 0.09,
      } = opts;
      const rnd = mulberry32(seed);
      const noise = createNoise2D(seed);
      const noiseB = createNoise2D(seed + 101);
      const half = size / 2;
      const n = segments + 1;
      const cell = size / segments;
      const H = new Float32Array(n * n);
      const C = new Float32Array(n * n).fill(1);
      const playRadius = rim ? half * rim.start * 0.95 : half * 0.95;

      // Base relief: rolling hills and small bumps.
      for (let iz = 0; iz < n; iz++) {
        for (let ix = 0; ix < n; ix++) {
          const x = -half + ix * cell, z = -half + iz * cell;
          let h = hills * fbm(noise, x / hillScale, z / hillScale, 4, 0.5);
          h += detail * fbm(noiseB, x / detailScale, z / detailScale, 3, 0.55);
          if (rim) {
            const r = Math.sqrt(x * x + z * z) / half;
            const t = Math.min(1.25, Math.max(0, (r - rim.start) / (1 - rim.start)));
            const m = t * t * (3 - 2 * t);
            const ang = Math.atan2(z, x);
            const ridge = 0.5 + 0.5 * fbm(noise, Math.cos(ang) * 2.2 + 31, Math.sin(ang) * 2.2 - 7, 4, 0.6);
            h += rim.height * m * (0.25 + 1.1 * ridge * ridge) * (0.8 + 0.2 * fbm(noise, x / 60 + 17, z / 60 - 4, 3, 0.55));
          }
          H[iz * n + ix] = h;
          C[iz * n + ix] = 1 + albedoVariation * fbm(noiseB, x / 260 + 40, z / 260 - 9, 3, 0.5);
        }
      }

      function stampCrater(cx, cz, R, depthRatio, fresh) {
        const depth = R * depthRatio;
        const rimH = R * (fresh ? 0.09 : 0.045);
        const reach = R * 3;
        const i0 = Math.max(0, Math.floor((cx - reach + half) / cell)), i1 = Math.min(n - 1, Math.ceil((cx + reach + half) / cell));
        const j0 = Math.max(0, Math.floor((cz - reach + half) / cell)), j1 = Math.min(n - 1, Math.ceil((cz + reach + half) / cell));
        for (let iz = j0; iz <= j1; iz++) {
          for (let ix = i0; ix <= i1; ix++) {
            const x = -half + ix * cell, z = -half + iz * cell;
            const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2) / R;
            if (d >= 3) continue;
            let h;
            if (d < 1) h = rimH - (depth + rimH) * (1 - d * d);
            else h = rimH * Math.exp(-(d - 1) * 3.2);
            const k = iz * n + ix;
            H[k] += h;
            if (fresh) C[k] += 0.28 * (d < 1 ? 0.35 + 0.65 * d * d : Math.exp(-(d - 1) * 1.6));
            else if (d < 1) C[k] -= 0.05 * (1 - d);
          }
        }
      }

      const list = Array.isArray(craters) ? craters : [];
      const nRand = Array.isArray(craters) ? 0 : craters;
      for (let i = 0; i < nRand; i++) {
        const u = rnd();
        const R = craterMin * Math.pow(craterMax / craterMin, Math.pow(u, 2.6));
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * (playRadius * 1.15);
        list.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, radius: R, depth: 0.14 + rnd() * 0.16, fresh: rnd() < freshFraction });
      }
      list.sort((a, b) => b.radius - a.radius);
      for (const c of list) stampCrater(c.x, c.z, c.radius, c.depth ?? 0.2, !!c.fresh);

      // Flattened areas (start zone, landing pads, bases).
      for (const f of flat || []) {
        let sum = 0, cnt = 0;
        for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
          const x = -half + ix * cell, z = -half + iz * cell;
          if ((x - f.x) ** 2 + (z - f.z) ** 2 < f.radius * f.radius) { sum += H[iz * n + ix]; cnt++; }
        }
        const target = f.height ?? (cnt ? sum / cnt : 0);
        const outer = f.radius * 1.8;
        for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) {
          const x = -half + ix * cell, z = -half + iz * cell;
          const d = Math.sqrt((x - f.x) ** 2 + (z - f.z) ** 2);
          if (d >= outer) continue;
          const t = d <= f.radius ? 1 : 1 - (d - f.radius) / (outer - f.radius);
          const w = t * t * (3 - 2 * t);
          H[iz * n + ix] += (target - H[iz * n + ix]) * w;
        }
      }

      // Mesh
      const geo = new THREE.PlaneGeometry(size, size, segments, segments);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, H[i]);
        const c = Math.min(1.45, Math.max(0.55, C[i]));
        colors[i * 3] = c; colors[i * 3 + 1] = c * 0.995; colors[i * 3 + 2] = c * 0.985;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const tex = textureId && assets.has(textureId);
      const rep = repeat ?? size / 4;
      const mat = tex
        ? assets.material(textureId, { repeat: [rep, rep], roughness: 1, metalness: 0, normalScale: 1.2 })
        : new THREE.MeshStandardMaterial({ color: 0x8f8a84, roughness: 1, metalness: 0 });
      if (color != null) mat.color = new THREE.Color(color);
      // Regolith is extremely rough and dull: no glossy highlights, little environment reflection.
      mat.roughnessMap = null;
      mat.roughness = 1;
      mat.metalness = 0;
      mat.envMapIntensity = 0.25;
      mat.vertexColors = true;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.name = 'terrain';
      const group = new THREE.Group();
      group.add(mesh);
      scene.add(group);

      function heightAt(x, z) {
        let fx = (x + half) / cell, fz = (z + half) / cell;
        fx = Math.min(segments - 1e-6, Math.max(0, fx));
        fz = Math.min(segments - 1e-6, Math.max(0, fz));
        const ix = Math.floor(fx), iz = Math.floor(fz);
        const u = fx - ix, v = fz - iz;
        const ha = H[iz * n + ix], hd = H[iz * n + ix + 1];
        const hb = H[(iz + 1) * n + ix], hc = H[(iz + 1) * n + ix + 1];
        if (u + v <= 1) return ha + (hd - ha) * u + (hb - ha) * v;
        return hc + (hb - hc) * (1 - u) + (hd - hc) * (1 - v);
      }
      function normalAt(x, z, target = new THREE.Vector3()) {
        const e = cell;
        return target.set(heightAt(x - e, z) - heightAt(x + e, z), 2 * e, heightAt(x, z - e) - heightAt(x, z + e)).normalize();
      }
      function slopeAt(x, z) {
        const nrm = normalAt(x, z);
        return THREE.MathUtils.radToDeg(Math.acos(Math.min(1, nrm.y)));
      }

      // Boulders
      const rockList = [];
      const hash = new Map();
      const HC = 10;
      const hkey = (x, z) => `${Math.floor(x / HC)},${Math.floor(z / HC)}`;
      const rockGroup = new THREE.Group();
      group.add(rockGroup);
      if (rocks && rocks.count > 0) {
        const rmat = rocks.textureId && assets.has(rocks.textureId)
          ? assets.material(rocks.textureId, { repeat: [1, 1], roughness: 0.95 })
          : (tex ? assets.material(textureId, { repeat: [2, 2], roughness: 0.95 }) : new THREE.MeshStandardMaterial({ color: 0x77736e, roughness: 0.95 }));
        if (rocks.color != null) rmat.color = new THREE.Color(rocks.color);
        rmat.roughnessMap = null;
        rmat.roughness = 1;
        rmat.envMapIntensity = 0.3;
        const kinds = [
          { geo: makeRockGeometry(noise, 1, 1), share: 0.7, big: false },
          { geo: makeRockGeometry(noise, 3, 2), share: 0.3, big: true },
        ];
        const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
        for (const kd of kinds) {
          const count = Math.round(rocks.count * kd.share);
          const im = new THREE.InstancedMesh(kd.geo, rmat, count);
          im.castShadow = true; im.receiveShadow = true;
          let placed = 0, guard = 0;
          while (placed < count && guard++ < count * 6) {
            const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * playRadius * 1.1;
            const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
            if ((flat || []).some((f) => (x - f.x) ** 2 + (z - f.z) ** 2 < (f.radius * 1.3) ** 2)) continue;
            const u = rnd();
            let s = rocks.min + (rocks.max - rocks.min) * Math.pow(u, kd.big ? 1.6 : 3.2);
            if (!kd.big) s = Math.min(s, rocks.max * 0.35);
            const y = heightAt(x, z) - s * 0.62 * 0.35;
            e3.set((rnd() - 0.5) * 0.5, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.5);
            q.setFromEuler(e3);
            sc.set(s * (0.8 + rnd() * 0.5), s, s * (0.8 + rnd() * 0.5));
            m4.compose(p3.set(x, y, z), q, sc);
            im.setMatrixAt(placed, m4);
            placed++;
            if (s > 0.45) {
              const rk = { x, y: y + s * 0.4, z, r: s * 0.95 };
              rockList.push(rk);
              const key = hkey(x, z);
              if (!hash.has(key)) hash.set(key, []);
              hash.get(key).push(rk);
            }
          }
          im.count = placed;
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          rockGroup.add(im);
        }
      }

      // First boulder whose footprint overlaps a circle at (x, z) with the given radius, or null.
      function rockAt(x, z, radius = 0.5) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          const arr = hash.get(`${Math.floor(x / HC) + dx},${Math.floor(z / HC) + dz}`);
          if (!arr) continue;
          for (const r of arr) {
            const rr = r.r + radius;
            if ((r.x - x) ** 2 + (r.z - z) ** 2 < rr * rr) return r;
          }
        }
        return null;
      }

      function randomPoint({ minDist = 0, maxDist = playRadius * 0.9, clearance = 2 } = {}) {
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * Math.PI * 2;
          const d = minDist + Math.sqrt(Math.random()) * Math.max(0, maxDist - minDist);
          const x = Math.cos(a) * d, z = Math.sin(a) * d;
          if (!rockAt(x, z, clearance)) return new THREE.Vector3(x, heightAt(x, z), z);
        }
        return new THREE.Vector3(0, heightAt(0, 0), 0);
      }

      // Adds a crater at runtime (impacts, explosions); updates the mesh.
      function addCrater({ x, z, radius = 4, depth = 0.25, fresh = true }) {
        stampCrater(x, z, radius, depth, fresh);
        for (let i = 0; i < pos.count; i++) pos.setY(i, H[i]);
        for (let i = 0; i < pos.count; i++) {
          const c = Math.min(1.45, Math.max(0.55, C[i]));
          colors[i * 3] = c; colors[i * 3 + 1] = c * 0.995; colors[i * 3 + 2] = c * 0.985;
        }
        pos.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        geo.computeVertexNormals();
      }

      return { group, mesh, rocks: rockList, heightAt, normalAt, slopeAt, rockAt, randomPoint, addCrater,
        half, playRadius, size, craters: list };
    },
  };
}
