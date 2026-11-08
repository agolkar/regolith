// Regolith — micrometeoroid showers with telegraph rings and impacts, solar flares, terrain scars.
// Owns: shower cadence (denser late), telegraph streak + ground ring, impact damage radii,
// camera shake request, terrain scar via world.terrain.addCrater (capped), flare schedule,
// bloom spike, exposure drain base rates and alarm cues.

import * as THREE from 'three';
import { clamp, lerp, damp } from '../engine/util.js';
import { CONFIG } from './config.js';

const DEG = Math.PI / 180;

// Reusable temporaries (never allocate inside update loops).
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// Meteor streak direction: incoming from high above, slightly toward the viewer side.
const METEOR_FALL = new THREE.Vector3(0.28, -1, 0.18).normalize();

export function createHazards(engine, world, CONFIG) {
  const { scene, fx, cam, audio, env, rng } = engine;
  const H = CONFIG.hazards;
  const W = CONFIG.world;

  const group = new THREE.Group();
  group.name = 'hazards';

  // ---------------------------------------------------------------- shared geometry / materials
  // Telegraph ring: flat ring on the ground, additive emissive orange-white.
  const ringGeo = new THREE.RingGeometry(0.85, 1.0, 32, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: CONFIG.colors.accent,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Inner danger disc: faint red fill inside the heavy-damage radius.
  const discGeo = new THREE.CircleGeometry(1, 28);
  discGeo.rotateX(-Math.PI / 2);
  const discMat = new THREE.MeshBasicMaterial({
    color: CONFIG.colors.warning,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  // Streak: a thin emissive cylinder pointing along the fall direction.
  const streakGeo = new THREE.CylinderGeometry(0.06, 0.02, 1, 6, 1, true);
  const streakMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.sun,
    emissive: CONFIG.colors.accent,
    emissiveIntensity: 3.2,
    roughness: 0.3,
    metalness: 0.0,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });

  // ---------------------------------------------------------------- state
  const meteors = [];          // active pre-impact meteors only
  let flare = null;            // { active, timeLeft } mirror or null
  let flareActive = false;
  let flareTimeLeft = 0;
  let flareIndex = 0;          // next flareTimes entry to fire
  let bloomBase = W.bloomStrength;
  let bloomSpike = 0;

  let elapsedRun = 0;
  let nextShowerAt = H.firstShowerTime;
  let showerQueue = [];        // pending meteors of the current shower: { spawnAt, target }
  let showerActive = false;
  let showerStartedFlag = false;
  let flareStartedFlag = false;

  let scarCount = 0;
  const maxScars = W.maxCraters;

  // ---------------------------------------------------------------- helpers
  function finite(n, fallback) {
    return Number.isFinite(n) ? n : fallback;
  }

  function sunDirection(out) {
    const az = W.sunAzimuth * DEG;
    const el = (world.sunElevation !== undefined ? world.sunElevation : W.sunElevationStart) * DEG;
    const cosEl = Math.cos(el);
    out.set(Math.sin(az) * cosEl, Math.sin(el), Math.cos(az) * cosEl);
    return out;
  }

  // Pick a target uniformly within H.targetRadius of the rover position at spawn time.
  function pickTarget(roverPosition, out) {
    const r = H.targetRadius;
    const ang = rng.range(0, Math.PI * 2);
    const rad = Math.sqrt(rng.next()) * r; // uniform over the disc
    const px = finite(roverPosition && roverPosition.x, 0);
    const pz = finite(roverPosition && roverPosition.z, 0);
    out.set(px + Math.cos(ang) * rad, 0, pz + Math.sin(ang) * rad);
    // Keep inside the playable basin.
    const half = world.terrain.half !== undefined ? world.terrain.half : W.playRadius;
    const limit = Math.min(half, W.playRadius) - 2;
    out.x = clamp(out.x, -limit, limit);
    out.z = clamp(out.z, -limit, limit);
    out.y = world.terrain.heightAt(out.x, out.z);
    return out;
  }

  // Build one meteor object with its streak and ring meshes.
  function makeMeteor(target, telegraph) {
    const streak = new THREE.Mesh(streakGeo, streakMat);
    streak.castShadow = false;
    streak.receiveShadow = false;
    streak.visible = false;
    group.add(streak);

    const ring = new THREE.Group();
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.02;
    ring.add(ringMesh);
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.position.y = 0.015;
    ring.add(discMesh);
    ring.position.set(target.x, target.y + 0.05, target.z);
    ring.visible = false;
    group.add(ring);

    return {
      target: target.clone(),
      timer: telegraph,
      telegraph,
      streak,
      ring,
      ringMesh,
      discMesh,
      spawned: false,
    };
  }

  function disposeMeteor(m) {
    if (!m) return;
    if (m.streak) {
      group.remove(m.streak);
      m.streak = null;
    }
    if (m.ring) {
      group.remove(m.ring);
      m.ring = null;
    }
    m.ringMesh = null;
    m.discMesh = null;
  }

  // ---------------------------------------------------------------- shower scheduling
  function scheduleShower(roverPosition) {
    const dense = elapsedRun >= H.denseAfter;
    const minI = dense ? H.denseMinInterval : H.showerMinInterval;
    const maxI = dense ? H.denseMaxInterval : H.showerMaxInterval;
    nextShowerAt = elapsedRun + rng.range(minI, maxI);

    const count = rng.int(H.meteorsMin, H.meteorsMax);
    showerQueue = [];
    for (let i = 0; i < count; i++) {
      const spawnAt = elapsedRun + rng.range(0, H.showerSpread);
      const target = pickTarget(roverPosition, _v2);
      showerQueue.push({ spawnAt, target: target.clone() });
    }
    showerActive = true;
    showerStartedFlag = true;
    audio.sfx('alarm');
  }

  // ---------------------------------------------------------------- flare
  function startFlare() {
    flareActive = true;
    flareTimeLeft = H.flareDuration;
    flareStartedFlag = true;
    bloomSpike = H.flareBloom;
    audio.sfx('alarm');
    if (engine.ui && engine.ui.flash) {
      engine.ui.flash(CONFIG.colors.sun, H.flareFlashMs, 0.55);
    }
    if (fx && fx.flashLight) {
      sunDirection(_dir);
      _v.set(0, 0, 0).addScaledVector(_dir, 60);
      fx.flashLight(_v, { color: CONFIG.colors.sun, intensity: 120, distance: 120, duration: 0.6 });
    }
  }

  function endFlare() {
    flareActive = false;
    flareTimeLeft = 0;
    bloomSpike = 0;
  }

  // ---------------------------------------------------------------- impact
  function impact(m, roverPosition, impacts) {
    const tx = m.target.x;
    const tz = m.target.z;
    const ty = world.terrain.heightAt(tx, tz);

    // Damage by distance from rover centre to impact point (XZ).
    let damage = 0;
    if (roverPosition) {
      const dx = finite(roverPosition.x, 0) - tx;
      const dz = finite(roverPosition.z, 0) - tz;
      const dist = Math.hypot(dx, dz);
      if (dist < H.innerRadius) damage = CONFIG.integrity.meteorInner;
      else if (dist < H.outerRadius) damage = CONFIG.integrity.meteorOuter;
    }

    // Camera shake and audio.
    cam.shake(H.impactShake, H.impactShakeDuration);
    audio.sfx(CONFIG.assets.audio.sfx.impact);

    // Ballistic dust burst (vacuum: gravity -1.62, no drag).
    _v.set(tx, ty + 0.4, tz);
    fx.burst(_v, {
      count: 26,
      color: CONFIG.colors.dust,
      color2: CONFIG.colors.regolith,
      additive: false,
      gravity: -CONFIG.gravity,
      drag: 0,
      speed: 6,
      up: 1.2,
      life: 2.2,
      size: 0.28,
      grow: 0,
    });
    fx.burst(_v, {
      count: 10,
      color: CONFIG.colors.accent,
      additive: true,
      gravity: -CONFIG.gravity,
      drag: 0,
      speed: 9,
      up: 0.6,
      life: 0.7,
      size: 0.16,
      grow: 0,
    });
    fx.flashLight(_v, { color: CONFIG.colors.sun, intensity: 90, distance: 40, duration: 0.35 });

    // Terrain scar, capped per run.
    if (scarCount < maxScars) {
      scarCount++;
      world.terrain.addCrater(tx, tz, W.craterScarRadius);
    }

    impacts.push({ x: tx, z: tz });
  }

  // ---------------------------------------------------------------- update
  function update(dt, roverPosition, elapsed) {
    const result = {
      meteorDamage: 0,
      flareActive: false,
      flarePowerDrain: 0,
      flareIntegrityDrain: 0,
      impacts: [],
      showerStarted: false,
      flareStarted: false,
    };
    if (!Number.isFinite(dt) || dt <= 0) {
      result.flareActive = flareActive;
      if (flareActive) {
        result.flarePowerDrain = H.flarePowerDrain;
        result.flareIntegrityDrain = H.flareIntegrityDrain;
      }
      return result;
    }

    // Advance run clock from the supplied elapsed (fallback to internal).
    elapsedRun = Number.isFinite(elapsed) ? elapsed : elapsedRun + dt;

    // ---------------------------------------------------------- flares
    if (!flareActive && flareIndex < H.flareTimes.length && elapsedRun >= H.flareTimes[flareIndex]) {
      flareIndex++;
      startFlare();
      result.flareStarted = true;
    }
    if (flareActive) {
      flareTimeLeft = Math.max(0, flareTimeLeft - dt);
      if (flareTimeLeft <= 0) {
        endFlare();
      } else {
        result.flareActive = true;
        result.flarePowerDrain = H.flarePowerDrain;
        result.flareIntegrityDrain = H.flareIntegrityDrain;
      }
    }
    flare = flareActive ? { active: true, timeLeft: flareTimeLeft } : null;

    // Bloom spike decays back to base.
    if (bloomSpike > 0) {
      bloomSpike = damp(bloomSpike, 0, 3, dt);
      if (bloomSpike < 0.01) bloomSpike = 0;
      env.setBloom({
        strength: bloomBase + bloomSpike,
        radius: W.bloomRadius,
        threshold: W.bloomThreshold,
      });
    }

    // ---------------------------------------------------------- showers
    if (elapsedRun >= nextShowerAt) {
      scheduleShower(roverPosition);
      result.showerStarted = true;
    }

    // Spawn queued meteors of the current shower.
    if (showerQueue.length > 0) {
      for (let i = showerQueue.length - 1; i >= 0; i--) {
        const q = showerQueue[i];
        if (elapsedRun >= q.spawnAt) {
          const m = makeMeteor(q.target, H.telegraph);
          meteors.push(m);
          showerQueue.splice(i, 1);
        }
      }
    }
    if (showerActive && showerQueue.length === 0) showerActive = false;

    // ---------------------------------------------------------- meteors
    for (let i = meteors.length - 1; i >= 0; i--) {
      const m = meteors[i];
      m.timer -= dt;

      // Telegraph visuals: ring grows in, streak descends toward the target.
      const t = clamp(1 - m.timer / m.telegraph, 0, 1);
      const ringScale = lerp(0.4, 1.0, t);
      if (m.ring) {
        m.ring.visible = true;
        m.ringMesh.scale.setScalar(ringScale * H.outerRadius);
        m.discMesh.scale.setScalar(ringScale * H.innerRadius);
        ringMat.opacity = 0.35 + 0.5 * t;
        discMat.opacity = 0.12 + 0.22 * t;
      }
      if (m.streak) {
        m.streak.visible = true;
        // Streak travels from high above down toward the target over the telegraph.
        const height = lerp(70, 4, t);
        _v.set(m.target.x, m.target.y + height, m.target.z);
        m.streak.position.copy(_v);
        m.streak.quaternion.setFromUnitVectors(_up, METEOR_FALL);
        const len = lerp(14, 5, t);
        m.streak.scale.set(1, len, 1);
        streakMat.opacity = 0.5 + 0.45 * t;
      }

      if (m.timer <= 0) {
        impact(m, roverPosition, result.impacts);
        if (result.meteorDamage === 0) {
          // Only the closest meteor should deliver damage in a single frame;
          // accumulate the strongest hit so game.js applies one hit per frame.
        }
        // Damage is resolved per meteor; game.js sums meteorDamage across frames.
        result.meteorDamage += 0;
        disposeMeteor(m);
        meteors.splice(i, 1);
      }
    }

    // Damage from impacts this frame: recompute strongest hit against rover.
    if (result.impacts.length > 0 && roverPosition) {
      let best = 0;
      for (let i = 0; i < result.impacts.length; i++) {
        const im = result.impacts[i];
        const dx = finite(roverPosition.x, 0) - im.x;
        const dz = finite(roverPosition.z, 0) - im.z;
        const dist = Math.hypot(dx, dz);
        let d = 0;
        if (dist < H.innerRadius) d = CONFIG.integrity.meteorInner;
        else if (dist < H.outerRadius) d = CONFIG.integrity.meteorOuter;
        if (d > best) best = d;
      }
      result.meteorDamage = best;
    }

    result.showerStarted = result.showerStarted || showerStartedFlag;
    result.flareStarted = result.flareStarted || flareStartedFlag;
    showerStartedFlag = false;
    flareStartedFlag = false;

    // Keep the flare mirror current.
    flare = flareActive ? { active: true, timeLeft: flareTimeLeft } : null;

    return result;
  }

  // ---------------------------------------------------------------- reset
  function reset() {
    for (let i = 0; i < meteors.length; i++) disposeMeteor(meteors[i]);
    meteors.length = 0;
    showerQueue.length = 0;
    showerActive = false;
    flare = null;
    flareActive = false;
    flareTimeLeft = 0;
    flareIndex = 0;
    bloomSpike = 0;
    elapsedRun = 0;
    nextShowerAt = H.firstShowerTime;
    showerStartedFlag = false;
    flareStartedFlag = false;
    scarCount = 0;
    env.setBloom({ strength: bloomBase, radius: W.bloomRadius, threshold: W.bloomThreshold });
    if (fx && fx.clear) {
      // fx.clear is owned by game.js on restart; do not clear here to avoid double work.
    }
  }

  return {
    group,
    meteors,
    get flare() {
      return flare;
    },
    update,
    reset,
  };
}
