// Regolith — HELIOS-1 rover: kinematic terrain-following drive, scoop resolution,
// boosting, hopper, battery, boulder hits and clean-scoop-cycle detection.

import * as THREE from 'three';
import { clamp, damp } from '../engine/util.js';
import { CONFIG } from './config.js';
import { createWorld } from './world.js';

const DEG = Math.PI / 180;

// Reusable temporaries (never allocate inside update loops).
const _forward = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _tmp = new THREE.Vector3();
const _dustPos = new THREE.Vector3();
const _yawQuat = new THREE.Quaternion();

// Asset keys for the photographic metal maps (fall back to the plain metal texture).
const ROVER_METAL_NORMAL = 'tex_metal_normal';
const ROVER_METAL_ROUGH = 'tex_metal_rough';

export function createRover(engine, world, CONFIG) {
  const { scene, input, cam, audio, fx, assets, env } = engine;
  const R = CONFIG.rover;
  const B = CONFIG.battery;
  const S = CONFIG.scoop;
  const I = CONFIG.integrity;

  const group = new THREE.Group();
  group.name = 'helios1';

  // ---------------------------------------------------------------- materials
  // Created once and reused for every part of the rover.
  const metalMat = assets.material(CONFIG.assets.materials.rover, {
    repeat: [2, 2],
    roughness: 0.55,
    metalness: 0.65,
    color: 0xd8d4cc,
  });
  // Attach the photographic normal / roughness maps when the asset exists.
  if (assets.has(ROVER_METAL_NORMAL)) {
    const nrm = assets.texture(ROVER_METAL_NORMAL, { repeat: [2, 2] });
    if (nrm) {
      metalMat.normalMap = nrm;
      metalMat.normalScale = new THREE.Vector2(0.8, 0.8);
    }
  }
  if (assets.has(ROVER_METAL_ROUGH)) {
    const rgh = assets.texture(ROVER_METAL_ROUGH, { repeat: [2, 2] });
    if (rgh) {
      metalMat.roughnessMap = rgh;
      metalMat.roughness = 0.75;
    }
  }
  metalMat.needsUpdate = true;

  const darkMat = new THREE.MeshStandardMaterial({
    color: 0x2a2c30,
    roughness: 0.7,
    metalness: 0.4,
  });
  const treadMat = new THREE.MeshStandardMaterial({
    color: 0x1a1b1e,
    roughness: 0.85,
    metalness: 0.15,
  });
  const hazardMat = new THREE.MeshStandardMaterial({
    color: 0xd97a2b,
    roughness: 0.6,
    metalness: 0.2,
    emissive: 0xd97a2b,
    emissiveIntensity: 0.25,
  });
  const panelMat = new THREE.MeshStandardMaterial({
    color: 0x1b2a3d,
    roughness: 0.35,
    metalness: 0.55,
    emissive: 0x0a1420,
    emissiveIntensity: 0.4,
  });
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xffb347,
    emissiveIntensity: 1.6,
    roughness: 0.4,
    metalness: 0.3,
  });
  const scoopMat = new THREE.MeshStandardMaterial({
    color: 0xa9a49a,
    roughness: 0.5,
    metalness: 0.75,
  });
  // Hopper fill strip: emissive amber, scaled by hopper kg.
  const fillMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xffb347,
    emissiveIntensity: 1.4,
    roughness: 0.35,
    metalness: 0.2,
  });

  // ---------------------------------------------------------------- geometries
  // Beveled chassis: a few boxes stacked to read as a real platform.
  const chassisGeo = new THREE.BoxGeometry(1.8, 0.9, 1.2);
  const deckGeo = new THREE.BoxGeometry(1.6, 0.16, 1.05);
  const bellyGeo = new THREE.BoxGeometry(1.5, 0.28, 1.0);
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 20);
  const treadGeo = new THREE.TorusGeometry(0.42, 0.05, 8, 24);
  const hubGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.34, 12);
  const hopperGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 24);
  const hopperCapGeo = new THREE.CylinderGeometry(0.58, 0.58, 0.08, 24);
  const fillGeo = new THREE.BoxGeometry(0.08, 1.0, 0.08);
  const scoopGeo = new THREE.BoxGeometry(1.6, 0.28, 0.7);
  const scoopPlateGeo = new THREE.BoxGeometry(1.6, 0.5, 0.12);
  const mastGeo = new THREE.CylinderGeometry(0.06, 0.08, 1.4, 12);
  const ringGeo = new THREE.TorusGeometry(0.22, 0.035, 8, 24);
  const panelGeo = new THREE.BoxGeometry(1.4, 0.04, 0.9);
  const stripeGeo = new THREE.BoxGeometry(1.82, 0.12, 0.06);
  const stripeDecalGeo = new THREE.BoxGeometry(0.9, 0.1, 0.02);
  const statusGeo = new THREE.SphereGeometry(0.09, 12, 8);

  // ---------------------------------------------------------------- build
  // Main chassis box (beveled silhouette via stacked boxes).
  const chassis = new THREE.Mesh(chassisGeo, metalMat);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  chassis.position.y = 0;
  group.add(chassis);

  // Deck plate on top of the chassis.
  const deck = new THREE.Mesh(deckGeo, metalMat);
  deck.castShadow = true;
  deck.receiveShadow = true;
  deck.position.set(0, 0.52, 0);
  group.add(deck);

  // Belly plate under the chassis.
  const belly = new THREE.Mesh(bellyGeo, darkMat);
  belly.castShadow = true;
  belly.receiveShadow = true;
  belly.position.set(0, -0.52, 0);
  group.add(belly);

  // Hazard stripes on both sides of the chassis.
  const stripeL = new THREE.Mesh(stripeGeo, hazardMat);
  stripeL.castShadow = true;
  stripeL.receiveShadow = true;
  stripeL.position.set(0, 0.12, 0.62);
  group.add(stripeL);
  const stripeR = new THREE.Mesh(stripeGeo, hazardMat);
  stripeR.castShadow = true;
  stripeR.receiveShadow = true;
  stripeR.position.set(0, 0.12, -0.62);
  group.add(stripeR);

  // Orange hazard stripe decals on the chassis sides (thin plates, both sides).
  for (let side = 0; side < 2; side++) {
    const z = side === 0 ? 0.615 : -0.615;
    for (let i = 0; i < 2; i++) {
      const decal = new THREE.Mesh(stripeDecalGeo, hazardMat);
      decal.castShadow = false;
      decal.receiveShadow = true;
      decal.position.set(i === 0 ? -0.42 : 0.42, 0.28, z);
      decal.rotation.z = 0.35;
      group.add(decal);
    }
  }

  // Six wheels: three per side, each with a tread ring.
  const wheels = [];
  const wheelX = [-0.62, 0, 0.62];
  for (let side = 0; side < 2; side++) {
    const z = side === 0 ? 0.72 : -0.72;
    for (let i = 0; i < wheelX.length; i++) {
      const wheel = new THREE.Mesh(wheelGeo, darkMat);
      wheel.castShadow = true;
      wheel.receiveShadow = true;
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wheelX[i], -0.48, z);
      group.add(wheel);
      // Tread ring around the wheel rim.
      const tread = new THREE.Mesh(treadGeo, treadMat);
      tread.castShadow = true;
      tread.receiveShadow = true;
      tread.rotation.y = Math.PI / 2;
      tread.position.set(wheelX[i], -0.48, z);
      group.add(tread);
      const hub = new THREE.Mesh(hubGeo, metalMat);
      hub.castShadow = true;
      hub.receiveShadow = true;
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wheelX[i], -0.48, z);
      group.add(hub);
      wheels.push(wheel);
    }
  }

  // Front scoop (forward is local -Z).
  const scoop = new THREE.Mesh(scoopGeo, scoopMat);
  scoop.castShadow = true;
  scoop.receiveShadow = true;
  scoop.position.set(0, -0.38, -0.85);
  group.add(scoop);
  const scoopPlate = new THREE.Mesh(scoopPlateGeo, scoopMat);
  scoopPlate.castShadow = true;
  scoopPlate.receiveShadow = true;
  scoopPlate.position.set(0, -0.18, -1.18);
  scoopPlate.rotation.x = -0.35;
  group.add(scoopPlate);

  // Hopper cylinder on the rear deck.
  const hopperMesh = new THREE.Mesh(hopperGeo, metalMat);
  hopperMesh.castShadow = true;
  hopperMesh.receiveShadow = true;
  hopperMesh.position.set(0, 0.75, 0.2);
  group.add(hopperMesh);
  const hopperCap = new THREE.Mesh(hopperCapGeo, darkMat);
  hopperCap.castShadow = true;
  hopperCap.receiveShadow = true;
  hopperCap.position.set(0, 1.32, 0.2);
  group.add(hopperCap);

  // Visible fill-level emissive strip on the hopper (scaled by hopper kg).
  const fillStrip = new THREE.Mesh(fillGeo, fillMat);
  fillStrip.castShadow = false;
  fillStrip.receiveShadow = false;
  fillStrip.position.set(0.56, 0.75, 0.2);
  group.add(fillStrip);

  // Deployable dark solar panel on the deck.
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.castShadow = true;
  panel.receiveShadow = true;
  panel.position.set(0, 0.62, 0.75);
  panel.rotation.x = 0.12;
  group.add(panel);

  // Camera mast with emissive status ring.
  const mast = new THREE.Mesh(mastGeo, metalMat);
  mast.castShadow = true;
  mast.receiveShadow = true;
  mast.position.set(0.62, 1.05, -0.35);
  group.add(mast);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.castShadow = false;
  ring.receiveShadow = false;
  ring.position.set(0.62, 1.78, -0.35);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Status light: small emissive sphere on the mast.
  const statusMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xffb347,
    emissiveIntensity: 2.0,
    roughness: 0.3,
    metalness: 0.1,
  });
  const status = new THREE.Mesh(statusGeo, statusMat);
  status.position.set(0.62, 1.9, -0.35);
  group.add(status);

  scene.add(group);

  // ---------------------------------------------------------------- state
  const position = new THREE.Vector3(R.startX, 0, R.startZ);
  position.y = world.terrain.heightAt(position.x, position.z) + R.bodyHalfHeight;

  let heading = 0;              // yaw, radians; forward is local -Z
  let speed = 0;                // signed m/s along heading
  let battery = B.max;
  let hopper = 0;
  let integrity = I.max;

  let boosting = false;
  let scooping = false;
  let hitTimer = 0;             // seconds of forced slow after a boulder hit
  let hitPending = false;       // one-shot flag for game to consume
  let slopeShakeTimer = 0;
  let scoopTickTimer = 0;
  let scoopDeposit = null;      // deposit currently being scooped
  let loadDamaged = false;      // damage during the current load
  let loadActive = false;       // a load is in progress
  let cleanCycle = false;       // one-shot flag for game to consume
  let dustTimer = 0;
  let elapsed = 0;

  // Engine loop for driving sound.
  let engineLoop = null;
  try {
    engineLoop = audio.loopNoise({ filter: 400, vol: 0.0, type: 'lowpass' });
  } catch (e) {
    engineLoop = null;
  }

  // ---------------------------------------------------------------- helpers
  function groundY(x, z) {
    return world.terrain.heightAt(x, z) + R.bodyHalfHeight;
  }

  function slopeFactor(dx, dz) {
    // Sample terrain height ±1 m along the movement direction.
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return 1;
    const nx = dx / len;
    const nz = dz / len;
    const hA = world.terrain.heightAt(position.x + nx, position.z + nz);
    const hB = world.terrain.heightAt(position.x - nx, position.z - nz);
    const rise = Math.abs(hA - hB);
    const run = 2;
    const slopeDeg = Math.atan2(rise, run) / DEG;
    if (slopeDeg > R.slopeLimitDeg) return R.slopeSpeedFactor;
    return 1;
  }

  function boulderHitCheck() {
    const list = world.boulders;
    if (!list || list.length === 0) return false;
    const r = R.collisionRadius;
    const r2 = r * r;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (!b || !b.position) continue;
      const dx = position.x - b.position.x;
      const dz = position.z - b.position.z;
      const rr = r + (b.radius || 0);
      if (dx * dx + dz * dz < rr * rr) return true;
    }
    return false;
  }

  function registerDamage() {
    loadDamaged = true;
  }

  function finishLoad(reason) {
    // A load completes when the hopper is full or the deposit is emptied.
    if (!loadActive) return;
    loadActive = false;
    if (!loadDamaged) {
      cleanCycle = true;
    }
    loadDamaged = false;
    scoopDeposit = null;
    scoopTickTimer = 0;
  }

  function scoopTick(deposits) {
    if (!deposits || !scoopDeposit) return;
    const room = S.hopperCapacity - hopper;
    if (room <= 0) {
      finishLoad('full');
      return;
    }
    const want = Math.min(S.tickKg, room);
    const got = deposits.take(scoopDeposit, want);
    if (got > 0) {
      hopper = clamp(hopper + got, 0, S.hopperCapacity);
      // Dust plume and floating text for the tick.
      _dustPos.copy(position);
      _dustPos.y += 0.2;
      fx.burst(_dustPos, {
        count: 6,
        color: 0x9a948c,
        additive: false,
        gravity: -CONFIG.gravity,
        drag: 0,
        speed: 2.4,
        up: 0.9,
        life: 1.6,
        size: 0.18,
        grow: 0,
      });
      fx.floatText(_dustPos, '+' + Math.round(got) + ' kg', { color: 0xffb347, size: 0.5, duration: 1.0 });
      audio.sfx(CONFIG.assets.audio.sfx.scoop);
      if (engine.events) engine.events.emit('scoop', { kg: got });
    }
    // Deposit emptied?
    if (scoopDeposit && scoopDeposit.remaining <= 0) {
      finishLoad('empty');
      return;
    }
    // Hopper full?
    if (hopper >= S.hopperCapacity) {
      finishLoad('full');
    }
  }

  // ---------------------------------------------------------------- update
  function update(dt, input, deposits) {
    if (!Number.isFinite(dt) || dt <= 0) return;
    elapsed += dt;

    // ---- input axes
    const driveAxis = input.axis(['KeyS', 'ArrowDown'], ['KeyW', 'ArrowUp']);
    const turnAxis = input.axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    const wantBoost = input.down(['ShiftLeft', 'ShiftRight']);
    const wantScoop = input.down('Space');

    // ---- battery gates
    const canBoost = wantBoost && battery > R.boostMinBattery;
    boosting = canBoost && driveAxis !== 0;

    // ---- target speed
    let targetSpeed = driveAxis * (boosting ? R.boostSpeed : R.cruiseSpeed);
    if (hitTimer > 0) {
      hitTimer = Math.max(0, hitTimer - dt);
      targetSpeed = clamp(targetSpeed, -R.hitSpeed, R.hitSpeed);
    }

    // ---- slope rule
    _forward.set(-Math.sin(heading), 0, -Math.cos(heading));
    const slope = slopeFactor(_forward.x, _forward.z);
    if (slope < 1) {
      targetSpeed *= slope;
      slopeShakeTimer -= dt;
      if (slopeShakeTimer <= 0) {
        slopeShakeTimer = R.slopeShakeInterval;
        cam.shake(R.slopeShakeIntensity, R.slopeShakeDuration);
      }
    } else {
      slopeShakeTimer = 0;
    }

    // ---- integrate speed and heading
    speed = damp(speed, targetSpeed, R.accel, dt);
    if (Math.abs(speed) < 0.02) speed = 0;
    heading -= turnAxis * R.turnRate * dt;

    // ---- integrate position (kinematic, terrain-following)
    const vx = -Math.sin(heading) * speed;
    const vz = -Math.cos(heading) * speed;
    position.x += vx * dt;
    position.z += vz * dt;

    // Keep inside the playable area.
    const playR = world.terrain.playRadius || CONFIG.world.playRadius;
    const dist = Math.hypot(position.x, position.z);
    if (dist > playR) {
      const k = playR / dist;
      position.x *= k;
      position.z *= k;
      speed *= 0.5;
    }

    // ---- terrain follow + tilt
    position.y = groundY(position.x, position.z);
    world.terrain.normalAt(position.x, position.z, _normal);
    if (_normal.lengthSq() > 1e-6) {
      _normal.normalize();
      _quat.setFromUnitVectors(_up, _normal);
      group.quaternion.copy(_quat);
      // Apply heading as yaw around the terrain normal.
      _yawQuat.setFromAxisAngle(_up, heading);
      group.quaternion.multiply(_yawQuat);
    } else {
      group.rotation.set(0, heading, 0);
    }
    group.position.copy(position);

    // ---- boulder collision
    if (boulderHitCheck()) {
      if (hitTimer <= 0) {
        hitTimer = R.hitSlowTime;
        hitPending = true;
        speed = Math.min(speed, R.hitSpeed);
        registerDamage();
        cam.shake(R.hitShakeIntensity, R.hitShakeDuration);
        audio.sfx(CONFIG.assets.audio.sfx.boulder);
        _dustPos.copy(position);
        _dustPos.y += 0.3;
        fx.burst(_dustPos, {
          count: 14,
          color: 0x9a948c,
          additive: false,
          gravity: -CONFIG.gravity,
          drag: 0,
          speed: 3.5,
          up: 1.0,
          life: 1.8,
          size: 0.22,
          grow: 0,
        });
      }
    }

    // ---- scooping
    scooping = false;
    if (wantScoop && Math.abs(speed) < S.maxSpeed) {
      if (!scoopDeposit && deposits) {
        const near = deposits.nearest(position, S.range);
        if (near) {
          scoopDeposit = near;
          loadActive = true;
          loadDamaged = false;
          scoopTickTimer = 0;
        }
      }
      if (scoopDeposit) {
        // Deposit may have been removed; verify it still exists.
        const stillThere = deposits && deposits.list && deposits.list.indexOf(scoopDeposit) >= 0;
        if (!stillThere) {
          finishLoad('empty');
        } else {
          scooping = true;
          scoopTickTimer += dt;
          while (scoopTickTimer >= S.tickInterval) {
            scoopTickTimer -= S.tickInterval;
            scoopTick(deposits);
            if (!scoopDeposit) break;
          }
        }
      }
    } else {
      // Driving away mid-load ends the load without a clean cycle.
      if (loadActive) {
        finishLoad('abort');
      }
      scoopDeposit = null;
      scoopTickTimer = 0;
    }

    // ---- battery drain
    let drain = 0;
    if (Math.abs(speed) > 0.1) drain += B.drainDrive;
    if (boosting) drain += B.drainBoost;
    if (scooping) drain += B.drainScoop;
    battery = clamp(battery - drain * dt, 0, B.max);

    // ---- status light colour: amber normally, red when low, blue when boosting
    if (battery < B.lowPowerThreshold) {
      statusMat.color.setHex(0xff3b30);
      statusMat.emissive.setHex(0xff3b30);
    } else if (boosting) {
      statusMat.color.setHex(0x4a86c8);
      statusMat.emissive.setHex(0x4a86c8);
    } else {
      statusMat.color.setHex(0xffb347);
      statusMat.emissive.setHex(0xffb347);
    }
    ringMat.emissiveIntensity = 1.2 + 0.4 * Math.sin(elapsed * 4);

    // ---- mast ring colour shifts amber -> red with battery level
    const battT = clamp(battery / B.max, 0, 1);
    // amber (0xffb347) -> red (0xff3b30) as battery drops
    const amberR = 1.0, amberG = 0.702, amberB = 0.278;
    const redR = 1.0, redG = 0.231, redB = 0.188;
    const rr = amberR + (redR - amberR) * (1 - battT);
    const rg = amberG + (redG - amberG) * (1 - battT);
    const rb = amberB + (redB - amberB) * (1 - battT);
    ringMat.color.setRGB(rr, rg, rb);
    ringMat.emissive.setRGB(rr, rg, rb);

    // ---- hopper fill strip: scale with hopper kg (visible fill level)
    const fillT = clamp(hopper / S.hopperCapacity, 0, 1);
    fillStrip.scale.y = Math.max(0.02, fillT);
    fillStrip.position.y = 0.75 - 0.5 + 0.5 * fillStrip.scale.y;
    fillMat.emissiveIntensity = 0.8 + 0.6 * fillT;

    // ---- engine loop volume
    if (engineLoop) {
      const vol = clamp(Math.abs(speed) / R.boostSpeed, 0, 1) * 0.35;
      const filter = 300 + Math.abs(speed) * 40;
      try {
        engineLoop.set({ volume: vol, filter });
      } catch (e) {
        // ignore audio failures
      }
    }

    // ---- dust trail while moving fast
    if (Math.abs(speed) > 3) {
      dustTimer -= dt;
      if (dustTimer <= 0) {
        dustTimer = 0.12;
        _dustPos.copy(position);
        _dustPos.y -= R.bodyHalfHeight * 0.5;
        fx.burst(_dustPos, {
          count: 2,
          color: 0x9a948c,
          additive: false,
          gravity: -CONFIG.gravity,
          drag: 0,
          speed: 1.6,
          up: 0.7,
          life: 1.4,
          size: 0.16,
          grow: 0,
        });
      }
    }
  }

  // ---------------------------------------------------------------- queries
  function isScooping() {
    return scooping;
  }

  function isBoosting() {
    return boosting;
  }

  function consumeBoulderHit() {
    if (hitPending) {
      hitPending = false;
      return true;
    }
    return false;
  }

  function consumeCleanCycle() {
    if (cleanCycle) {
      cleanCycle = false;
      return true;
    }
    return false;
  }

  // Called by game when meteoroid damage lands during a load.
  function registerDamageExternal() {
    registerDamage();
  }

  // Recharge from sunlight / solar modules, called by game each update.
  function recharge(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    battery = clamp(battery + amount, 0, B.max);
  }

  // Drain from flare exposure, called by game each update.
  function drain(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    battery = clamp(battery - amount, 0, B.max);
  }

  // Integrity adjustments, called by game.
  function damage(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    integrity = clamp(integrity - amount, 0, I.max);
    registerDamage();
  }

  function heal(amount) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    integrity = clamp(integrity + amount, 0, I.max);
  }

  // ---------------------------------------------------------------- reset
  function reset() {
    position.set(R.startX, 0, R.startZ);
    position.y = groundY(position.x, position.z);
    heading = 0;
    speed = 0;
    battery = B.max;
    hopper = 0;
    integrity = I.max;
    boosting = false;
    scooping = false;
    hitTimer = 0;
    hitPending = false;
    slopeShakeTimer = 0;
    scoopTickTimer = 0;
    scoopDeposit = null;
    loadDamaged = false;
    loadActive = false;
    cleanCycle = false;
    dustTimer = 0;
    elapsed = 0;
    group.position.copy(position);
    group.rotation.set(0, 0, 0);
    // Reset visual accents to their start values.
    fillStrip.scale.y = 0.02;
    fillStrip.position.y = 0.75 - 0.5 + 0.5 * fillStrip.scale.y;
    fillMat.emissiveIntensity = 0.8;
    ringMat.color.setHex(0xffb347);
    ringMat.emissive.setHex(0xffb347);
    ringMat.emissiveIntensity = 1.6;
    statusMat.color.setHex(0xffb347);
    statusMat.emissive.setHex(0xffb347);
    if (engineLoop) {
      try {
        engineLoop.set({ volume: 0, filter: 400 });
      } catch (e) {
        // ignore
      }
    }
  }

  reset();

  return {
    group,
    position,
    get battery() {
      return battery;
    },
    get hopper() {
      return hopper;
    },
    get integrity() {
      return integrity;
    },
    update,
    isScooping,
    isBoosting,
    consumeBoulderHit,
    consumeCleanCycle,
    registerDamage: registerDamageExternal,
    recharge,
    drain,
    damage,
    heal,
    reset,
  };
}
