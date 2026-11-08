// Regolith — terrain, lighting, sun descent, shadow query, crater scars, boulder colliders.
// Owns the lunar ground, the low Sun, the Earth sprite, the distant mountain ring and the tether icon.

import * as THREE from 'three';
import { clamp, lerp, damp } from '../engine/util.js';
import { CONFIG } from './config.js';

const DEG = Math.PI / 180;

// Reusable temporaries (never allocate inside update loops).
const _sunDir = new THREE.Vector3();
const _sample = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _camFwd = new THREE.Vector3();
const _camPos = new THREE.Vector3();
const _toEarth = new THREE.Vector3();
const _earthDir = new THREE.Vector3();

// Direction from the basin centre toward a point on the sky (unit vector, y up).
function skyDirection(azimuthDeg, elevationDeg, out) {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const cosEl = Math.cos(el);
  out.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl);
  return out;
}

export function createWorld(engine, CONFIG) {
  const { scene, env, assets, terrain, cam, fx } = engine;
  const W = CONFIG.world;

  const group = new THREE.Group();
  group.name = 'world';

  // ---------------------------------------------------------------- sky
  // Called once in init(), before any material is created.
  const sky = env.space({
    sun: { azimuth: W.sunAzimuth, elevation: W.sunElevationStart, intensity: W.sunIntensity },
    earth: { texture: CONFIG.assets.env.earthSprite, azimuth: W.earthAzimuth, elevation: W.earthElevation, size: W.earthSize },
    stars: W.stars,
    earthshine: W.earthshine,
    exposure: W.exposure,
  });

  // ---------------------------------------------------------------- terrain
  const ground = terrain.create({
    size: W.size,
    segments: W.segments,
    seed: W.seed,
    textureId: CONFIG.assets.textures.regolith,
    repeat: 64,
    hills: W.hills,
    craters: W.craters,
    craterMin: W.craterMin,
    craterMax: W.craterMax,
    freshFraction: W.freshFraction,
    rim: { height: W.rimHeight, start: W.rimStart },
    flat: [
      { x: CONFIG.plant.position.x, z: CONFIG.plant.position.z, radius: W.flatRadius },
      { x: CONFIG.printer.position.x, z: CONFIG.printer.position.z, radius: W.flatRadius },
      { x: CONFIG.rover.startX, z: CONFIG.rover.startZ, radius: W.flatRadius },
    ],
    rocks: { count: W.rocksCount, min: W.rockMin, max: W.rockMax, textureId: CONFIG.assets.textures.rock },
  });
  group.add(ground.group);

  // ---------------------------------------------------------------- distant mountain ring
  // A low-poly ring of crater-rim silhouettes at ~400 m so the horizon shows
  // mountains instead of a smooth curve. Built once, never updated.
  const mountainRing = buildMountainRing();
  if (mountainRing) group.add(mountainRing);

  function buildMountainRing() {
    const radius = Number.isFinite(W.mountainRingRadius) ? W.mountainRingRadius : 400;
    const height = Number.isFinite(W.mountainRingHeight) ? W.mountainRingHeight : 55;
    const segs = Math.max(24, Math.round(Number.isFinite(W.mountainRingSegments) ? W.mountainRingSegments : 96));
    const baseY = ground.heightAt(0, 0);
    const rng = engine.rng;
    const positions = [];
    const indices = [];
    const innerR = radius * 0.92;
    const outerR = radius * 1.08;
    // Two rings of vertices: inner foot and outer crest, with jagged heights.
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const sa = Math.sin(a);
      const ca = Math.cos(a);
      const jag = 0.55 + 0.45 * Math.abs(Math.sin(a * 7.0 + 1.3)) + 0.25 * Math.abs(Math.sin(a * 13.0 + 0.4));
      const crest = height * (0.65 + 0.35 * jag) + rng.range(-height * 0.08, height * 0.08);
      // inner foot (below the visible rim, hidden by the terrain)
      positions.push(sa * innerR, baseY - 6, ca * innerR);
      // outer crest
      positions.push(sa * outerR, baseY + crest, ca * outerR);
    }
    for (let i = 0; i < segs; i++) {
      const a0 = i * 2;
      const a1 = a0 + 1;
      const b0 = a0 + 2;
      const b1 = a0 + 3;
      indices.push(a0, b0, a1);
      indices.push(a1, b0, b1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: CONFIG.colors.regolith,
      roughness: 1.0,
      metalness: 0.0,
      emissive: CONFIG.colors.shadow,
      emissiveIntensity: 0.15,
      fog: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'mountainRing';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  // ---------------------------------------------------------------- boulders
  // Static colliders exported for rover collision tests.
  const boulders = [];
  const rockList = ground.rocks || [];
  for (let i = 0; i < rockList.length; i++) {
    const r = rockList[i];
    if (!r) continue;
    const radius = Math.max(0.12, r.r * 0.85);
    boulders.push({
      position: new THREE.Vector3(r.x, r.y, r.z),
      radius,
    });
  }

  // ---------------------------------------------------------------- sun state
  let sunElevation = W.sunElevationStart;
  let sunElevationTarget = W.sunElevationStart;
  let sunManual = false;
  let elapsed = 0;

  // Direction from a point toward the Sun (unit vector, y up).
  function sunDirection(out) {
    return skyDirection(W.sunAzimuth, sunElevation, out);
  }
  sunDirection(_sunDir);

  function applySun() {
    env.setSun({
      direction: [_sunDir.x, _sunDir.y, _sunDir.z],
      color: CONFIG.colors.sun,
      intensity: W.sunIntensity,
      shadowRadius: W.shadowRadius,
    });
    if (env.sun) {
      env.sun.shadow.bias = W.shadowBias;
      env.sun.shadow.radius = W.shadowRadius;
    }
    sky.setSun(W.sunAzimuth, sunElevation);
  }

  env.setHemisphere({ sky: CONFIG.colors.regolith, ground: CONFIG.colors.shadow, intensity: W.ambientIntensity });
  env.setBloom({ strength: W.bloomStrength, radius: W.bloomRadius, threshold: W.bloomThreshold });
  env.setExposure(W.exposure);
  applySun();

  // ---------------------------------------------------------------- Sun disc
  // Warm-white sprite at the configured elevation, placed far away so it reads
  // as a disc on the black sky. Bloom threshold 0.85 makes it glow.
  const sunDisc = buildSunDisc();
  if (sunDisc) group.add(sunDisc);

  function buildSunDisc() {
    const sizeDeg = Number.isFinite(W.sunDiscSize) ? W.sunDiscSize : 2.2;
    const dist = 900;
    const worldSize = 2 * Math.tan((sizeDeg * DEG) * 0.5) * dist;
    const geo = new THREE.SphereGeometry(worldSize * 0.5, 20, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: CONFIG.colors.sun,
      emissive: CONFIG.colors.sun,
      emissiveIntensity: 6.0,
      roughness: 0.4,
      metalness: 0.0,
      fog: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sunDisc';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.frustumCulled = false;
    return mesh;
  }

  function layoutSunDisc() {
    if (!sunDisc) return;
    const dir = skyDirection(W.sunAzimuth, sunElevation, _sample);
    sunDisc.position.set(dir.x * 900, dir.y * 900, dir.z * 900);
  }
  layoutSunDisc();

  // ---------------------------------------------------------------- Earth placement
  // The engine places the Earth sprite from the space() config; we re-assert a
  // fixed azimuth/elevation and nudge it into the chase-camera frustum so the
  // signature image is always visible in gameplay frames.
  const earth = sky.earth || null;
  let earthBaseScale = 1;
  if (earth && earth.scale) earthBaseScale = earth.scale.x || 1;
  let earthDim = 1;
  let tetherShort = 1;

  function placeEarth() {
    if (!earth) return;
    skyDirection(W.earthAzimuth, W.earthElevation, _earthDir);
    // The sprite lives in the sky rig; if it has a position we can set it,
    // otherwise we leave the engine's placement alone.
    if (earth.position && earth.position.isVector3) {
      const dist = earth.position.length();
      const d = Number.isFinite(dist) && dist > 1 ? dist : 900;
      earth.position.set(_earthDir.x * d, _earthDir.y * d, _earthDir.z * d);
    }
    // Verify the Earth projects into the chase camera frustum. If the dot
    // product with the camera forward is negative (behind the camera), nudge
    // the azimuth toward the camera's view direction.
    const camera = engine.camera;
    if (!camera) return;
    camera.getWorldPosition(_camPos);
    camera.getWorldDirection(_camFwd);
    _toEarth.copy(_earthDir);
    const dot = _toEarth.dot(_camFwd);
    if (dot < 0.05) {
      // Rotate the Earth direction toward the camera forward by a small step
      // until it sits just inside the frustum edge.
      const horizFwd = Math.hypot(_camFwd.x, _camFwd.z);
      if (horizFwd > 1e-4) {
        const fwdAz = Math.atan2(_camFwd.x, _camFwd.z) / DEG;
        const el = W.earthElevation;
        const nudgedAz = fwdAz + 35;
        skyDirection(nudgedAz, el, _earthDir);
        if (earth.position && earth.position.isVector3) {
          const d = earth.position.length();
          const dist = Number.isFinite(d) && d > 1 ? d : 900;
          earth.position.set(_earthDir.x * dist, _earthDir.y * dist, _earthDir.z * dist);
        }
      }
    }
  }
  placeEarth();

  // Tether icon: a thin emissive line from the base toward the Earth, shortening
  // as independence rises. Built once, reused.
  const tetherMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.earth,
    emissive: CONFIG.colors.earth,
    emissiveIntensity: 1.4,
    roughness: 0.4,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
  });
  const tetherGeo = new THREE.CylinderGeometry(0.08, 0.08, 1, 6, 1, true);
  const tether = new THREE.Mesh(tetherGeo, tetherMat);
  tether.name = 'tether';
  tether.castShadow = false;
  tether.receiveShadow = false;
  tether.visible = false;
  group.add(tether);

  const tetherBase = new THREE.Vector3(CONFIG.plant.position.x, 0, CONFIG.plant.position.z);
  tetherBase.y = ground.heightAt(tetherBase.x, tetherBase.z) + 1.5;
  const tetherTop = new THREE.Vector3();
  const tetherDir = new THREE.Vector3();

  function layoutTether() {
    // Point the tether toward the Earth's azimuth/elevation, length scaled by tetherShort.
    skyDirection(W.earthAzimuth, W.earthElevation, tetherDir);
    const fullLen = 40;
    const len = Math.max(0.5, fullLen * tetherShort);
    tetherTop.copy(tetherBase).addScaledVector(tetherDir, len);
    tether.position.copy(tetherBase).addScaledVector(tetherDir, len * 0.5);
    tether.quaternion.setFromUnitVectors(_up, tetherDir);
    tether.scale.set(1, len, 1);
  }
  layoutTether();

  function dimEarth(pct) {
    // pct 0..100 independence; Earth dims slightly as the cord is cut.
    const t = clamp(pct / 100, 0, 1);
    earthDim = lerp(1, W.earthDimAfterModule, t);
    if (earth && earth.scale) {
      earth.scale.setScalar(earthBaseScale * earthDim);
    }
    if (earth && earth.material) {
      const m = earth.material;
      if ('opacity' in m) {
        m.transparent = true;
        m.opacity = lerp(1, 0.72, t);
      }
    }
  }

  function shortenTether(pct) {
    const t = clamp(pct / 100, 0, 1);
    tetherShort = lerp(1, 0.12, t);
    tether.visible = t > 0.02;
    layoutTether();
  }

  // ---------------------------------------------------------------- sun descent
  function setSunElevation(deg) {
    if (!Number.isFinite(deg)) return;
    sunElevation = clamp(deg, 1, 60);
    sunElevationTarget = sunElevation;
    sunManual = true;
    sunDirection(_sunDir);
    applySun();
    layoutSunDisc();
  }

  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    elapsed += dt;
    if (!sunManual) {
      // Linear descent from start to end elevation over the run length.
      const t = clamp(elapsed / CONFIG.runLength, 0, 1);
      sunElevationTarget = lerp(W.sunElevationStart, W.sunElevationEnd, t);
      sunElevation = damp(sunElevation, sunElevationTarget, 4, dt);
      sunDirection(_sunDir);
      applySun();
      layoutSunDisc();
    }
    // Keep the shadow area centred on the rover when it exists.
    if (engine.cam && engine.cam.follow && engine._shadowTarget) {
      env.followShadow(engine._shadowTarget);
    }
    // Tether gently pulses.
    if (tether.visible) {
      tetherMat.emissiveIntensity = 1.2 + 0.3 * Math.sin(elapsed * 3);
    }
  }

  // ---------------------------------------------------------------- reset
  function reset() {
    elapsed = 0;
    sunManual = false;
    sunElevation = W.sunElevationStart;
    sunElevationTarget = W.sunElevationStart;
    sunDirection(_sunDir);
    applySun();
    layoutSunDisc();
    scarCount = 0;
    earthDim = 1;
    tetherShort = 1;
    if (earth && earth.scale) earth.scale.setScalar(earthBaseScale);
    if (earth && earth.material && 'opacity' in earth.material) {
      earth.material.opacity = 1;
    }
    tether.visible = false;
    layoutTether();
    placeEarth();
  }

  // ---------------------------------------------------------------- shadow query
  // Ray-march the terrain height function from P toward the Sun for up to 60 m
  // in 2 m steps; true if any sample is above the ray. Uses the same height
  // function as the rendered surface so gameplay stays consistent.
  function isInShadow(position) {
    if (!position) return false;
    const px = position.x;
    const pz = position.z;
    const py = position.y !== undefined ? position.y : ground.heightAt(px, pz);
    const dir = sunDirection(_sunDir);
    const step = W.shadowRayStep;
    const maxLen = W.shadowRayLength;
    // Horizontal component of the sun direction; guard against vertical sun.
    const horiz = Math.hypot(dir.x, dir.z);
    if (horiz < 1e-4) return false;
    const dx = dir.x / horiz;
    const dz = dir.z / horiz;
    const risePerM = dir.y / horiz; // how fast the ray climbs per horizontal metre
    for (let d = step; d <= maxLen; d += step) {
      const sx = px + dx * d;
      const sz = pz + dz * d;
      const rayY = py + risePerM * d;
      const h = ground.heightAt(sx, sz);
      if (h > rayY + 0.05) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- crater scars
  let scarCount = 0;
  const maxScars = W.maxCraters;
  const scarRadius = W.craterScarRadius;

  function addCrater(x, z, radius) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    const r = Number.isFinite(radius) ? Math.max(1, radius) : scarRadius;
    if (scarCount >= maxScars) return;
    scarCount++;
    try {
      ground.addCrater({ x, z, radius: r, depth: Math.min(2.5, r * 0.35) });
    } catch (e) {
      // addCrater is expensive; never let a failure break the run.
    }
  }

  // ---------------------------------------------------------------- terrain helper
  const terrainApi = {
    addCrater(x, z, radius) {
      addCrater(x, z, radius);
    },
    heightAt(x, z) {
      return ground.heightAt(x, z);
    },
    normalAt(x, z, target) {
      return ground.normalAt(x, z, target || _normal);
    },
    slopeAt(x, z) {
      return ground.slopeAt(x, z);
    },
    rockAt(x, z, radius) {
      return ground.rockAt(x, z, radius);
    },
    randomPoint(opts) {
      return ground.randomPoint(opts);
    },
    get playRadius() {
      return ground.playRadius;
    },
    get half() {
      return ground.half;
    },
    get size() {
      return ground.size;
    },
  };

  return {
    group,
    terrain: terrainApi,
    boulders,
    isInShadow,
    setSunElevation,
    update,
    reset,
    dimEarth,
    shortenTether,
    get sunElevation() {
      return sunElevation;
    },
    get ground() {
      return ground;
    },
  };
}
