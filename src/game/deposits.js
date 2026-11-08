// Regolith — regolith deposit mounds (normal and rich), depletion, nearest query, sparkle fx.
// Owns the deposit meshes, their capacities, depletion and removal, faint sparkle particles,
// and the first-deposit beacon (pulsing amber ring + vertical light shaft) that guides the
// player to the very first scoop.
//
// Every mound carries a thin permanent ring marker (cyan for normal, gold for rich) so it
// reads on the grey surface at any distance. Rich mounds get a gold tint. Each list entry
// exposes position, x, z, remaining, rich, radius, material and a sunlit flag for the
// guidance system.

import * as THREE from 'three';
import { clamp, distXZ } from '../engine/util.js';
import { CONFIG } from './config.js';

// Reusable temporaries (never allocate inside update loops).
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _scale = new THREE.Vector3();

// Scoop reach is measured from the mound's edge (its footprint), never from its
// centre: a rover touching the mound must always be able to scoop.

export function createDeposits(engine, world, CONFIG) {
  const { scene, assets, fx, rng } = engine;
  const D = CONFIG.deposits;

  const group = new THREE.Group();
  group.name = 'deposits';

  // ---------------------------------------------------------------- shared geometry / materials
  // Cone base + hemisphere cap, both built once and reused for every mound.
  const coneGeo = new THREE.ConeGeometry(D.moundRadius, D.moundHeight * 1.15, 24, 3, false);
  const domeGeo = new THREE.SphereGeometry(D.moundRadius * 0.72, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);

  // Paler, brighter regolith so mounds stand out against the grey surface.
  const normalMat = assets.material(CONFIG.assets.materials.regolith, {
    repeat: [2, 2],
    roughness: 0.95,
    metalness: 0.0,
    color: 0xd8d6cf,
    emissive: 0x9a948c,
    emissiveIntensity: 0.15,
  });
  // Rich deposits get a gold tint.
  const richMat = assets.material(CONFIG.assets.materials.regolith, {
    repeat: [2, 2],
    roughness: 0.95,
    metalness: 0.0,
    color: 0xe8d9a8,
    emissive: 0xc9a24a,
    emissiveIntensity: 0.2,
  });

  // ---------------------------------------------------------------- permanent ring markers
  // Thin flat ring around each mound, added to the mound group and removed with it on
  // depletion. Two shared materials (cyan normal, gold rich). Always visible.
  // Sits just outside the mound base (local frame, scaled with the mound).
  const markerGeo = new THREE.RingGeometry(D.moundRadius + 0.25, D.moundRadius + 0.6, 48);
  const markerNormalMat = new THREE.MeshBasicMaterial({
    color: 0x00e5ff,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const markerRichMat = new THREE.MeshBasicMaterial({
    color: 0xffd24a,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // ---------------------------------------------------------------- beacon (first scoop guide)
  // A pulsing amber emissive ring lying on the ground around the nearest un-depleted
  // deposit plus a vertical light shaft rising from it. Built once, reused, hidden
  // unless objectiveStep === 0. All geometry/materials are created here only.
  const beaconGroup = new THREE.Group();
  beaconGroup.name = 'deposit-beacon';
  beaconGroup.visible = false;
  group.add(beaconGroup);

  const beaconMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.amber,
    emissive: CONFIG.colors.amber,
    emissiveIntensity: 1.6,
    roughness: 0.5,
    metalness: 0.1,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const ringGeo = new THREE.RingGeometry(D.moundRadius * 0.95, D.moundRadius * 1.35, 48, 1);
  const ring = new THREE.Mesh(ringGeo, beaconMat);
  ring.name = 'deposit-beacon-ring';
  ring.rotation.x = -Math.PI * 0.5;
  ring.castShadow = false;
  ring.receiveShadow = false;
  ring.frustumCulled = false;
  beaconGroup.add(ring);

  // Vertical light shaft: a tall open cylinder, additive-looking via emissive.
  const shaftHeight = 12;
  const shaftGeo = new THREE.CylinderGeometry(D.moundRadius * 0.55, D.moundRadius * 0.85, shaftHeight, 20, 1, true);
  const shaftMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.amber,
    emissive: CONFIG.colors.amber,
    emissiveIntensity: 1.1,
    roughness: 0.6,
    metalness: 0.0,
    transparent: true,
    opacity: 0.28,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  shaft.name = 'deposit-beacon-shaft';
  shaft.castShadow = false;
  shaft.receiveShadow = false;
  shaft.frustumCulled = false;
  shaft.position.y = shaftHeight * 0.5;
  beaconGroup.add(shaft);

  // Beacon state.
  let beaconTarget = null;
  let beaconPulse = 0;
  let beaconActive = false;

  // ---------------------------------------------------------------- deposit list
  const list = [];
  let sparkleTimer = 0;

  function makeDeposit(x, z, rich) {
    const capacity = rich ? D.richCapacity : D.normalCapacity;
    const mesh = new THREE.Group();
    mesh.name = rich ? 'deposit-rich' : 'deposit-normal';

    const mat = rich ? richMat : normalMat;

    const cone = new THREE.Mesh(coneGeo, mat);
    cone.castShadow = true;
    cone.receiveShadow = true;
    cone.position.y = D.moundHeight * 0.575;
    mesh.add(cone);

    const cap = new THREE.Mesh(domeGeo, mat);
    cap.castShadow = true;
    cap.receiveShadow = true;
    cap.position.y = D.moundHeight * 0.55;
    mesh.add(cap);

    const y = world.terrain.heightAt(x, z);
    mesh.position.set(x, y, z);

    // Slight random yaw and scale so mounds do not look cloned.
    mesh.rotation.y = rng.range(0, Math.PI * 2);
    const s = rng.range(0.85, 1.15);
    mesh.scale.set(s, rng.range(0.85, 1.1), s);

    // Permanent thin ring marker just above the terrain, in the mound's local frame.
    const marker = new THREE.Mesh(markerGeo, rich ? markerRichMat : markerNormalMat);
    marker.name = 'deposit-marker';
    marker.rotation.x = -Math.PI * 0.5;
    marker.position.set(0, 0.05, 0);
    marker.castShadow = false;
    marker.receiveShadow = false;
    marker.frustumCulled = false;
    mesh.add(marker);

    group.add(mesh);

    // Sunlit flag: computed once at spawn from the world shadow query.
    let sunlit = true;
    try {
      sunlit = world.isInShadow(x, z) === false;
    } catch (e) {
      sunlit = true;
    }

    const deposit = {
      mesh,
      position: new THREE.Vector3(x, y, z),
      x,
      z,
      capacity,
      remaining: capacity,
      rich: !!rich,
      radius: D.moundRadius * s + CONFIG.scoop.range,
      material: mat,
      sunlit,
      baseScale: s,
      // Ground radius of the mound base; scoop reach is footprint + scoop.range.
      footprint: D.moundRadius * s,
      // Guidance helper: true when the mound sits in shadow.
      isInShadow: !sunlit,
    };
    list.push(deposit);
    return deposit;
  }

  // ---------------------------------------------------------------- spawn helpers
  function spawnNormal(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      const p = world.terrain.randomPoint({ minDist: D.normalMinDist, maxDist: D.normalMaxDist, clearance: D.moundRadius + 2 });
      x = p.x;
      z = p.z;
    }
    return makeDeposit(x, z, false);
  }

  function spawnRich(x, z) {
    // Rich deposits sit in shadow near the crater rim. If no valid shadow point
    // is supplied, retry a few random points and fall back to any free point.
    if (Number.isFinite(x) && Number.isFinite(z)) {
      return makeDeposit(x, z, true);
    }
    const probe = new THREE.Vector3();
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = world.terrain.randomPoint({ minDist: D.richMinDist, maxDist: D.richMaxDist, clearance: D.moundRadius + 2 });
      probe.set(p.x, world.terrain.heightAt(p.x, p.z), p.z);
      if (world.isInShadow(probe)) {
        return makeDeposit(p.x, p.z, true);
      }
    }
    const fallback = world.terrain.randomPoint({ minDist: D.richMinDist, maxDist: D.richMaxDist, clearance: D.moundRadius + 2 });
    return makeDeposit(fallback.x, fallback.z, true);
  }

  // ---------------------------------------------------------------- first deposit
  // Spawn the tutorial deposit directly in the rover's initial forward direction
  // (rover forward is local -Z, so world forward is -Z at start) at firstDepositDistance.
  function spawnFirst() {
    const dist = Number.isFinite(D.firstDepositDistance) ? D.firstDepositDistance : 8;
    const sx = CONFIG.rover.startX;
    const sz = CONFIG.rover.startZ;
    // Rover forward is -Z in world space at start.
    const x = sx;
    const z = sz - dist;
    // Keep the mound inside the playable basin.
    const playR = Number.isFinite(world.terrain.playRadius) ? world.terrain.playRadius : 125;
    const cx = clamp(x, -playR + D.moundRadius, playR - D.moundRadius);
    const cz = clamp(z, -playR + D.moundRadius, playR - D.moundRadius);
    return makeDeposit(cx, cz, false);
  }

  // ---------------------------------------------------------------- nearest query
  // nearest(position, radius)            — legacy: closest deposit with regolith left within radius.
  // nearest(position, { requireRemaining, preferSunlit, radius }) — options overload.
  // Depleted deposits are always skipped. The returned deposit carries .position (Vector3),
  // .sunlit and .isInShadow so guidance can prefer sunlit mounds.
  function nearest(position, optsOrRadius) {
    if (!position) return null;
    let radius = CONFIG.scoop.range;
    let requireRemaining = true;
    let preferSunlit = false;
    // radius is measured from the mound edge; Infinity means "any distance".
    const okRadius = (r) => typeof r === 'number' && !Number.isNaN(r) && r >= 0;
    if (typeof optsOrRadius === 'number') {
      if (okRadius(optsOrRadius)) radius = optsOrRadius;
    } else if (optsOrRadius && typeof optsOrRadius === 'object') {
      if (okRadius(optsOrRadius.radius)) radius = optsOrRadius.radius;
      if (optsOrRadius.requireRemaining === false) requireRemaining = false;
      if (optsOrRadius.preferSunlit === true) preferSunlit = true;
    }
    let best = null;
    let bestEdge = Infinity;
    let bestSun = null;
    let bestSunEdge = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d) continue;
      if (requireRemaining && d.remaining <= 0) continue;
      const edge = edgeDistance(d, position);
      if (edge > radius) continue;
      if (edge < bestEdge) {
        bestEdge = edge;
        best = d;
      }
      if (d.sunlit && edge < bestSunEdge) {
        bestSunEdge = edge;
        bestSun = d;
      }
    }
    if (preferSunlit && bestSun) return bestSun;
    return best;
  }

  // Distance (m, XZ) from a position to the edge of a deposit's mound; 0 when on it.
  function edgeDistance(d, position) {
    if (!d || !position) return Infinity;
    const dx = d.position.x - position.x;
    const dz = d.position.z - position.z;
    const fp = Number.isFinite(d.footprint) ? d.footprint : D.moundRadius;
    return Math.max(0, Math.sqrt(dx * dx + dz * dz) - fp);
  }

  // Nearest deposit regardless of remaining (for guidance / the beacon).
  // Optional preferSunlit flag lets guidance pick a sunlit mound first.
  function nearestAny(position, preferSunlit) {
    if (!position) return null;
    let best = null;
    let bestD2 = Infinity;
    let bestSun = null;
    let bestSunD2 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d) continue;
      const dx = d.position.x - position.x;
      const dz = d.position.z - position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = d;
      }
      if (d.sunlit && d2 < bestSunD2) {
        bestSunD2 = d2;
        bestSun = d;
      }
    }
    if (preferSunlit && bestSun) return bestSun;
    return best;
  }

  // Nearest deposit with regolith left, preferring sunlit mounds (guidance helper).
  // Returns the deposit object (with .position Vector3, .sunlit, .isInShadow) or null.
  function nearestWithRemaining(position, preferSunlit) {
    if (!position) return null;
    let best = null;
    let bestD2 = Infinity;
    let bestSun = null;
    let bestSunD2 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d) continue;
      if (d.remaining <= 0) continue;
      const dx = d.position.x - position.x;
      const dz = d.position.z - position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = d;
      }
      if (d.sunlit && d2 < bestSunD2) {
        bestSunD2 = d2;
        bestSun = d;
      }
    }
    if (preferSunlit && bestSun) return bestSun;
    return best;
  }

  // ---------------------------------------------------------------- take
  function take(deposit, kg) {
    if (!deposit || !Number.isFinite(kg) || kg <= 0) return 0;
    const amount = Math.min(kg, deposit.remaining);
    if (amount <= 0) return 0;
    deposit.remaining -= amount;

    // Shrink the mound as it is emptied.
    const frac = clamp(deposit.remaining / deposit.capacity, 0, 1);
    const s = deposit.baseScale * (0.35 + 0.65 * frac);
    deposit.mesh.scale.set(s, Math.max(0.3, 0.35 + 0.65 * frac), s);
    deposit.footprint = D.moundRadius * s;

    if (deposit.remaining <= 0) {
      removeDeposit(deposit);
    }
    return amount;
  }

  function removeDeposit(deposit) {
    const idx = list.indexOf(deposit);
    if (idx >= 0) list.splice(idx, 1);
    if (deposit.mesh) {
      group.remove(deposit.mesh);
      // Geometries and materials are shared; only clear the group reference.
      deposit.mesh.clear();
    }
    if (beaconTarget === deposit) {
      beaconTarget = null;
      beaconGroup.visible = false;
      beaconActive = false;
    }
  }

  // ---------------------------------------------------------------- sparkle fx
  function sparkle(deposit) {
    if (!deposit || !deposit.mesh) return;
    const p = _tmp.copy(deposit.position);
    p.y += D.moundHeight * 0.6;
    fx.burst(p, {
      count: D.sparkleCount,
      color: deposit.rich ? 0xfff2d8 : 0xa9a49a,
      color2: deposit.rich ? 0xffb347 : 0x8b8a84,
      speed: 0.6,
      spread: 1.2,
      up: 0.4,
      life: 0.9,
      size: 0.06,
      gravity: -CONFIG.gravity,
      drag: 0,
      additive: deposit.rich,
      grow: 0,
    });
  }

  // ---------------------------------------------------------------- beacon update
  // Show the beacon on the nearest un-depleted deposit while objectiveStep === 0.
  // The caller passes objectiveStep and the rover position each update.
  function updateBeacon(dt, objectiveStep, roverPosition) {
    const wantBeacon = objectiveStep === 0 && list.length > 0 && roverPosition;
    if (!wantBeacon) {
      if (beaconActive) {
        beaconActive = false;
        beaconGroup.visible = false;
      }
      return;
    }

    // Re-target if the current target is gone or depleted.
    if (!beaconTarget || beaconTarget.remaining <= 0) {
      beaconTarget = nearestAny(roverPosition, true);
    }
    if (!beaconTarget) {
      beaconActive = false;
      beaconGroup.visible = false;
      return;
    }

    beaconActive = true;
    beaconGroup.visible = true;
    beaconPulse += dt;

    const px = beaconTarget.position.x;
    const pz = beaconTarget.position.z;
    const py = beaconTarget.position.y;
    beaconGroup.position.set(px, py + 0.05, pz);

    // Pulse the ring scale and emissive intensity so it reads at a glance.
    const pulse = 0.5 + 0.5 * Math.sin(beaconPulse * 3.2);
    const ringScale = 1 + 0.12 * pulse;
    ring.scale.set(ringScale, ringScale, 1);
    beaconMat.emissiveIntensity = 1.1 + 1.1 * pulse;
    beaconMat.opacity = 0.55 + 0.35 * pulse;

    // Shaft breathes gently and rotates slowly for motion.
    shaft.rotation.y += dt * 0.6;
    shaftMat.emissiveIntensity = 0.7 + 0.7 * pulse;
    shaftMat.opacity = 0.18 + 0.18 * pulse;
  }

  // ---------------------------------------------------------------- update
  function update(dt, objectiveStep, roverPosition) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    updateBeacon(dt, objectiveStep, roverPosition);
    sparkleTimer += dt;
    if (sparkleTimer >= D.sparkleInterval) {
      sparkleTimer = 0;
      // Sparkle on a couple of deposits per interval, cycling through the list.
      if (list.length > 0) {
        const i = rng.int(0, list.length - 1);
        sparkle(list[i]);
      }
    }
  }

  // ---------------------------------------------------------------- reset
  function reset() {
    // Remove every mound and dispose nothing shared (geometries/materials reused).
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (d && d.mesh) {
        group.remove(d.mesh);
        d.mesh.clear();
      }
    }
    list.length = 0;
    sparkleTimer = 0;
    beaconTarget = null;
    beaconPulse = 0;
    beaconActive = false;
    beaconGroup.visible = false;
    beaconGroup.position.set(0, 0, 0);
    ring.scale.set(1, 1, 1);
    shaft.rotation.y = 0;
  }

  return {
    group,
    list,
    spawnNormal,
    spawnRich,
    spawnFirst,
    nearest,
    nearestAny,
    nearestWithRemaining,
    edgeDistance,
    take,
    update,
    reset,
    get beacon() {
      return beaconTarget;
    },
  };
}
