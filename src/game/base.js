// Regolith — sintering plant, printer gantry, habitat modules, independence,
// resupply lander and crate. All meshes are built once and reused.

import * as THREE from 'three';
import { clamp, lerp, damp } from '../engine/util.js';
import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createEffects } from './effects.js';

const DEG = Math.PI / 180;

// Reusable temporaries (never allocate inside update loops).
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

// Shared geometry cache: every geometry is created once and reused by all
// instances of the same module type.
function makeGeometries() {
  return {
    // plant
    kiln: new THREE.CylinderGeometry(1.6, 1.9, 3.2, 20, 1, false),
    kilnCone: new THREE.ConeGeometry(1.9, 1.2, 20, 1, false),
    hopperCone: new THREE.ConeGeometry(1.5, 1.6, 18, 1, true),
    pipe: new THREE.TorusGeometry(0.55, 0.18, 8, 16, Math.PI * 0.75),
    window: new THREE.BoxGeometry(1.4, 0.5, 0.12),
    skirt: new THREE.CylinderGeometry(2.4, 2.7, 0.35, 20, 1, true),
    // printer
    post: new THREE.BoxGeometry(0.5, 6.4, 0.5),
    rail: new THREE.BoxGeometry(1, 0.28, 1),
    carriage: new THREE.BoxGeometry(1.1, 0.7, 1.1),
    head: new THREE.CylinderGeometry(0.42, 0.42, 1.1, 14, 1, false),
    nozzle: new THREE.ConeGeometry(0.3, 0.7, 12, 1, false),
    pad: new THREE.CylinderGeometry(3.4, 3.6, 0.3, 24, 1, false),
    padRing: new THREE.TorusGeometry(3.4, 0.08, 6, 32),
    // dome
    dome: new THREE.SphereGeometry(3.0, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5),
    domeRim: new THREE.TorusGeometry(3.0, 0.16, 8, 32),
    domeWindow: new THREE.BoxGeometry(1.6, 0.28, 0.12),
    domeDoor: new THREE.BoxGeometry(1.1, 2.0, 0.16),
    // solar
    solarFrame: new THREE.BoxGeometry(3.6, 0.12, 0.12),
    solarPanel: new THREE.BoxGeometry(3.4, 0.06, 1.7),
    solarLeg: new THREE.CylinderGeometry(0.08, 0.08, 1.6, 8, 1, false),
    // life support
    tank: new THREE.CylinderGeometry(0.85, 0.85, 2.6, 16, 1, false),
    tankCone: new THREE.ConeGeometry(0.85, 0.9, 16, 1, false),
    tankPipe: new THREE.TorusGeometry(0.5, 0.09, 6, 12, Math.PI),
    beacon: new THREE.SphereGeometry(0.16, 10, 8),
    // resupply
    landerBody: new THREE.CylinderGeometry(1.0, 1.2, 2.4, 16, 1, false),
    landerCone: new THREE.ConeGeometry(1.2, 1.0, 16, 1, false),
    landerLeg: new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6, 1, false),
    crate: new THREE.BoxGeometry(1.4, 1.0, 1.4),
    crateStripe: new THREE.BoxGeometry(1.44, 0.18, 1.44),
    beaconSmall: new THREE.SphereGeometry(0.12, 8, 6),
  };
}

export function createBase(engine, world, CONFIG) {
  const { scene, assets, fx, audio, cam, ui, events } = engine;
  const effects = createEffects(engine, CONFIG);

  const group = new THREE.Group();
  group.name = 'base';

  const geo = makeGeometries();

  // ---------------------------------------------------------------- materials
  const metalMat = assets.material(CONFIG.assets.materials.printer, {
    repeat: [2, 2],
    roughness: 0.42,
    metalness: 0.72,
    color: 0xd8d6cf,
  });
  const ceramicMat = assets.material(CONFIG.assets.materials.ceramic, {
    repeat: [2, 2],
    roughness: 0.55,
    metalness: 0.15,
    color: 0xcfc9bd,
  });
  const rockMat = assets.material(CONFIG.assets.materials.rock, {
    repeat: [1, 1],
    roughness: 0.9,
    metalness: 0.05,
  });
  const regolithMat = assets.material(CONFIG.assets.materials.regolith, {
    repeat: [2, 2],
    roughness: 0.95,
    metalness: 0.02,
  });

  const amberEmissive = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.amber,
    emissive: CONFIG.colors.amber,
    emissiveIntensity: 2.4,
    roughness: 0.35,
    metalness: 0.2,
  });
  const whiteEmissive = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.sun,
    emissive: CONFIG.colors.sun,
    emissiveIntensity: 1.6,
    roughness: 0.3,
    metalness: 0.1,
  });
  const earthEmissive = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.earth,
    emissive: CONFIG.colors.earth,
    emissiveIntensity: 1.8,
    roughness: 0.35,
    metalness: 0.2,
  });
  const hazardMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.amber,
    emissive: CONFIG.colors.amber,
    emissiveIntensity: 0.6,
    roughness: 0.6,
    metalness: 0.3,
  });
  const solarPanelMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.deep,
    emissive: CONFIG.colors.deep,
    emissiveIntensity: 0.25,
    roughness: 0.28,
    metalness: 0.55,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: CONFIG.colors.warning,
    emissive: CONFIG.colors.warning,
    emissiveIntensity: 2.0,
    roughness: 0.3,
    metalness: 0.1,
  });

  // ---------------------------------------------------------------- helpers
  function groundY(x, z) {
    return world.terrain.heightAt(x, z);
  }

  function addMesh(parent, geometry, material, x, y, z) {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  }

  // ================================================================ PLANT
  const plantPos = new THREE.Vector3(CONFIG.plant.position.x, 0, CONFIG.plant.position.z);
  plantPos.y = groundY(plantPos.x, plantPos.z);

  const plantGroup = new THREE.Group();
  plantGroup.name = 'plant';
  plantGroup.position.copy(plantPos);
  group.add(plantGroup);

  // Kiln body.
  addMesh(plantGroup, geo.kiln, metalMat, 0, 1.6, 0);
  addMesh(plantGroup, geo.kilnCone, metalMat, 0, 3.6, 0);
  // Cone hopper on top.
  addMesh(plantGroup, geo.hopperCone, metalMat, 0, 4.6, 0);
  // Amber sinter window on the kiln face.
  const kilnWindow = addMesh(plantGroup, geo.window, amberEmissive, 0, 1.7, 1.72);
  kilnWindow.castShadow = false;
  // Pipe elbows.
  const pipeA = addMesh(plantGroup, geo.pipe, metalMat, 1.4, 2.6, 0.4);
  pipeA.rotation.set(0, 0.6, 0);
  const pipeB = addMesh(plantGroup, geo.pipe, metalMat, -1.4, 2.2, -0.4);
  pipeB.rotation.set(0, -0.6, Math.PI);
  // Dust skirt at the base.
  const skirt = addMesh(plantGroup, geo.skirt, regolithMat, 0, 0.18, 0);
  skirt.castShadow = false;
  // Hazard stripes on the kiln.
  const stripeA = addMesh(plantGroup, new THREE.BoxGeometry(0.3, 0.5, 0.12), hazardMat, 1.2, 1.0, 1.6);
  stripeA.castShadow = false;
  const stripeB = addMesh(plantGroup, new THREE.BoxGeometry(0.3, 0.5, 0.12), hazardMat, -1.2, 1.0, 1.6);
  stripeB.castShadow = false;

  // Amber status light on top of the hopper.
  const plantLight = new THREE.PointLight(CONFIG.colors.amber, 40, 14, 2);
  plantLight.position.set(0, 3.0, 1.6);
  plantGroup.add(plantLight);

  // Plant state.
  const plant = {
    position: plantPos,
    feedstock: 0,
    // internal dump state
    _dumping: false,
    _dumpProgress: 0,
    _dumpKg: 0,
    _dumpCombo: 1,
    _glowTimer: 0,
    update(dt, rover, comboMultiplier) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      const range = CONFIG.plant.range;
      const roverPos = rover && rover.position ? rover.position : null;
      let inRange = false;
      if (roverPos) {
        const dx = roverPos.x - plantPos.x;
        const dz = roverPos.z - plantPos.z;
        inRange = dx * dx + dz * dz <= range * range;
      }
      const hopper = rover && Number.isFinite(rover.hopper) ? rover.hopper : 0;

      // Start a dump when in range with a non-empty hopper.
      if (!plant._dumping && inRange && hopper > 0) {
        plant._dumping = true;
        plant._dumpProgress = 0;
        plant._dumpKg = Math.min(CONFIG.plant.dumpKg, hopper);
        plant._dumpCombo = Number.isFinite(comboMultiplier) ? clamp(comboMultiplier, 1, CONFIG.combo.max) : 1;
        effects.dumpGlow(plantPos);
      }

      // Pause when the rover leaves mid-dump.
      if (plant._dumping && !inRange) {
        plant._dumping = false;
        plant._dumpProgress = 0;
        plant._dumpKg = 0;
      }

      if (plant._dumping) {
        const step = dt / CONFIG.plant.dumpTime;
        plant._dumpProgress = Math.min(1, plant._dumpProgress + step);
        // Drain the hopper smoothly over the dump.
        if (rover && Number.isFinite(rover.hopper)) {
          const drain = Math.min(rover.hopper, (plant._dumpKg / CONFIG.plant.dumpTime) * dt);
          rover.hopper = Math.max(0, rover.hopper - drain);
        }
        // Amber glow pulses while sintering.
        plant._glowTimer += dt;
        if (plant._glowTimer >= 0.5) {
          plant._glowTimer = 0;
          effects.dumpGlow(plantPos);
        }
        if (plant._dumpProgress >= 1) {
          const produced = Math.min(
            CONFIG.plant.capacity - plant.feedstock,
            plant._dumpKg * plant._dumpCombo
          );
          if (produced > 0) {
            plant.feedstock = Math.min(CONFIG.plant.capacity, plant.feedstock + produced);
            effects.floatFeedstock(plantPos, produced);
            events.emit('feedstock', { kg: produced, total: plant.feedstock });
          }
          plant._dumping = false;
          plant._dumpProgress = 0;
          plant._dumpKg = 0;
        }
      }

      // Kiln window glows brighter while dumping.
      kilnWindow.material.emissiveIntensity = plant._dumping ? 3.2 : 1.6;
      plantLight.intensity = plant._dumping ? 70 : 30;
    },
  };

  // ================================================================ PRINTER
  const printerPos = new THREE.Vector3(CONFIG.printer.position.x, 0, CONFIG.printer.position.z);
  printerPos.y = groundY(printerPos.x, printerPos.z);

  const printerGroup = new THREE.Group();
  printerGroup.name = 'printer';
  printerGroup.position.copy(printerPos);
  group.add(printerGroup);

  const railLength = CONFIG.printer.railLength;
  const padCount = CONFIG.printer.padCount;
  const padSpacing = padCount > 1 ? railLength / (padCount - 1) : 0;
  const railHalf = railLength * 0.5;

  // Gantry posts at both ends of the rail.
  const postA = addMesh(printerGroup, geo.post, metalMat, -railHalf - 0.6, 3.2, 0);
  const postB = addMesh(printerGroup, geo.post, metalMat, railHalf + 0.6, 3.2, 0);
  // Rail spans the pads along X.
  const rail = addMesh(printerGroup, geo.rail, metalMat, 0, 6.2, 0);
  rail.scale.set(railLength + 1.2, 1, 1);
  // Hazard stripes on the posts.
  const postStripeA = addMesh(printerGroup, new THREE.BoxGeometry(0.52, 0.4, 0.52), hazardMat, -railHalf - 0.6, 1.2, 0);
  postStripeA.castShadow = false;
  const postStripeB = addMesh(printerGroup, new THREE.BoxGeometry(0.52, 0.4, 0.52), hazardMat, railHalf + 0.6, 1.2, 0);
  postStripeB.castShadow = false;

  // Carriage and print head ride the rail.
  const carriage = addMesh(printerGroup, geo.carriage, metalMat, 0, 5.7, 0);
  const head = addMesh(printerGroup, geo.head, metalMat, 0, 4.9, 0);
  const nozzle = addMesh(printerGroup, geo.nozzle, amberEmissive, 0, 4.2, 0);
  nozzle.rotation.x = Math.PI;
  nozzle.castShadow = false;
  const nozzleLight = new THREE.PointLight(CONFIG.colors.amber, 0, 10, 2);
  nozzleLight.position.set(0, 4.0, 0);
  printerGroup.add(nozzleLight);

  // Foundation pads in a line along X.
  const pads = [];
  for (let i = 0; i < padCount; i++) {
    const px = -railHalf + i * padSpacing;
    const padPos = new THREE.Vector3(printerPos.x + px, 0, printerPos.z);
    padPos.y = groundY(padPos.x, padPos.z);
    const padMesh = new THREE.Mesh(geo.pad, ceramicMat);
    padMesh.position.set(px, 0.15, 0);
    padMesh.castShadow = true;
    padMesh.receiveShadow = true;
    printerGroup.add(padMesh);
    const ringMesh = new THREE.Mesh(geo.padRing, amberEmissive);
    ringMesh.position.set(px, 0.32, 0);
    ringMesh.rotation.x = Math.PI * 0.5;
    ringMesh.castShadow = false;
    printerGroup.add(ringMesh);
    pads.push({
      position: padPos,
      module: null,
      mesh: padMesh,
      ring: ringMesh,
      localX: px,
    });
  }

  // Printer state.
  const printer = {
    position: printerPos,
    pads,
    printing: null,
    startPrint(type) {
      if (printer.printing) return false;
      if (CONFIG.printer.moduleTypes.indexOf(type) < 0) return false;
      if (plant.feedstock < CONFIG.printer.feedstockCost) return false;
      let padIndex = -1;
      for (let i = 0; i < pads.length; i++) {
        if (!pads[i].module) { padIndex = i; break; }
      }
      if (padIndex < 0) return false;
      // Deduct feedstock at print start; the print always completes.
      plant.feedstock = Math.max(0, plant.feedstock - CONFIG.printer.feedstockCost);
      printer.printing = {
        active: true,
        moduleType: type,
        progress: 0,
        padIndex,
        elapsed: 0,
        consumed: 0,
      };
      // Move the head over the pad.
      const pad = pads[padIndex];
      carriage.position.x = pad.localX;
      head.position.x = pad.localX;
      nozzle.position.x = pad.localX;
      nozzleLight.position.x = pad.localX;
      nozzleLight.intensity = 80;
      effects.printIgnite(_v.set(printerPos.x + pad.localX, padPosY(pad), printerPos.z));
      events.emit('print_start', { type, padIndex });
      return true;
    },
    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      const p = printer.printing;
      if (!p || !p.active) {
        nozzleLight.intensity = 0;
        nozzle.material.emissiveIntensity = 1.2;
        return;
      }
      p.elapsed += dt;
      p.progress = clamp(p.elapsed / CONFIG.printer.printTime, 0, 1);
      // Feedstock consumed over the print (already deducted from the plant).
      p.consumed = CONFIG.printer.feedstockCost * p.progress;
      // Nozzle glow pulses; head sweeps slowly across the pad.
      nozzle.material.emissiveIntensity = 2.4 + 1.2 * Math.sin(p.elapsed * 8);
      nozzleLight.intensity = 70 + 40 * Math.sin(p.elapsed * 8);
      const pad = pads[p.padIndex];
      if (pad) {
        const sweep = Math.sin(p.elapsed * 1.6) * 1.2;
        head.position.x = pad.localX + sweep;
        nozzle.position.x = pad.localX + sweep;
        nozzleLight.position.x = pad.localX + sweep;
        // Layer-by-layer growth of the module mesh.
        if (pad.module && pad.module.mesh) {
          pad.module.mesh.scale.y = Math.max(0.02, p.progress);
        }
        // Occasional amber sparks at the nozzle.
        if (Math.random() < 0.35) {
          effects.printIgnite(_v.set(printerPos.x + pad.localX + sweep, padPosY(pad) + 0.4, printerPos.z));
        }
      }
      if (p.progress >= 1) {
        p.active = false;
        printer.printing = null;
        nozzleLight.intensity = 0;
        nozzle.material.emissiveIntensity = 1.2;
        if (pad && pad.module && pad.module.mesh) {
          pad.module.mesh.scale.y = 1;
        }
        // Completion is reported by base.update().
        printer._pendingComplete = p.moduleType;
        printer._pendingPad = p.padIndex;
      }
    },
    _pendingComplete: null,
    _pendingPad: -1,
  };

  function padPosY(pad) {
    return pad.position.y + 0.3;
  }

  // ================================================================ MODULES
  const modules = [];
  let independence = 0;
  let solarModules = 0;

  function buildModuleMesh(type, pad) {
    const holder = new THREE.Group();
    holder.name = 'module_' + type;
    holder.position.set(pad.localX, padPosY(pad) - pad.position.y, 0);
    holder.scale.y = 0.02;
    printerGroup.add(holder);

    if (type === 'dome') {
      const dome = new THREE.Mesh(geo.dome, ceramicMat);
      dome.position.y = 0;
      dome.castShadow = true;
      dome.receiveShadow = true;
      holder.add(dome);
      const rim = new THREE.Mesh(geo.domeRim, metalMat);
      rim.position.y = 0.05;
      rim.rotation.x = Math.PI * 0.5;
      rim.castShadow = true;
      rim.receiveShadow = true;
      holder.add(rim);
      // Emissive window strip on the dome.
      const win = new THREE.Mesh(geo.domeWindow, whiteEmissive);
      win.position.set(0, 1.2, 2.85);
      win.castShadow = false;
      holder.add(win);
      // Opening on one side (a dark door recess).
      const door = new THREE.Mesh(geo.domeDoor, solarPanelMat);
      door.position.set(0, 1.0, 2.95);
      door.castShadow = true;
      holder.add(door);
      const light = new THREE.PointLight(CONFIG.colors.sun, 25, 8, 2);
      light.position.set(0, 1.4, 2.6);
      holder.add(light);
    } else if (type === 'solar') {
      // Frame with thin dark panels tilted toward the Sun.
      const legA = new THREE.Mesh(geo.solarLeg, metalMat);
      legA.position.set(-1.4, 0.8, 0);
      legA.castShadow = true;
      holder.add(legA);
      const legB = new THREE.Mesh(geo.solarLeg, metalMat);
      legB.position.set(1.4, 0.8, 0);
      legB.castShadow = true;
      holder.add(legB);
      const frame = new THREE.Mesh(geo.solarFrame, metalMat);
      frame.position.set(0, 1.6, 0);
      frame.castShadow = true;
      holder.add(frame);
      const panel = new THREE.Mesh(geo.solarPanel, solarPanelMat);
      panel.position.set(0, 1.68, 0);
      panel.rotation.x = -0.35;
      panel.castShadow = true;
      panel.receiveShadow = true;
      holder.add(panel);
      const panel2 = new THREE.Mesh(geo.solarPanel, solarPanelMat);
      panel2.position.set(0, 1.68, 0.9);
      panel2.rotation.x = -0.35;
      panel2.castShadow = true;
      panel2.receiveShadow = true;
      holder.add(panel2);
      const light = new THREE.PointLight(CONFIG.colors.earth, 20, 7, 2);
      light.position.set(0, 1.7, 0);
      holder.add(light);
    } else {
      // Life support: cylinder and cone tanks with pipes and a blinking beacon.
      const tankA = new THREE.Mesh(geo.tank, ceramicMat);
      tankA.position.set(-0.9, 1.3, 0);
      tankA.castShadow = true;
      tankA.receiveShadow = true;
      holder.add(tankA);
      const coneA = new THREE.Mesh(geo.tankCone, ceramicMat);
      coneA.position.set(-0.9, 2.6, 0);
      coneA.castShadow = true;
      holder.add(coneA);
      const tankB = new THREE.Mesh(geo.tank, ceramicMat);
      tankB.position.set(0.9, 1.3, 0);
      tankB.castShadow = true;
      tankB.receiveShadow = true;
      holder.add(tankB);
      const coneB = new THREE.Mesh(geo.tankCone, ceramicMat);
      coneB.position.set(0.9, 2.6, 0);
      coneB.castShadow = true;
      holder.add(coneB);
      const pipe = new THREE.Mesh(geo.tankPipe, metalMat);
      pipe.position.set(0, 1.9, 0);
      pipe.rotation.z = Math.PI * 0.5;
      pipe.castShadow = true;
      holder.add(pipe);
      const beacon = new THREE.Mesh(geo.beacon, beaconMat);
      beacon.position.set(0, 3.1, 0);
      beacon.castShadow = false;
      holder.add(beacon);
      const light = new THREE.PointLight(CONFIG.colors.warning, 25, 8, 2);
      light.position.set(0, 3.1, 0);
      holder.add(light);
    }
    return holder;
  }

  function completeModule(type, padIndex) {
    const pad = pads[padIndex];
    if (!pad) return null;
    if (pad.module) return null;
    const mesh = buildModuleMesh(type, pad);
    mesh.scale.y = 1;
    const mod = {
      type,
      mesh,
      complete: true,
      position: pad.position.clone(),
      padIndex,
    };
    pad.module = mod;
    modules.push(mod);
    // Hide the pad ring once occupied.
    if (pad.ring) pad.ring.visible = false;

    // Effects on completion.
    effects.moduleCompleteFlash(_v.set(pad.position.x, pad.position.y + 1.5, pad.position.z));
    effects.floatIndependence(_v.set(pad.position.x, pad.position.y + 2.5, pad.position.z), CONFIG.independencePerModule);
    ui.banner(CONFIG.banner.moduleComplete, 1600);
    audio.voice(CONFIG.assets.audio.voice.vo_module_complete);
    events.emit('module_complete', { type, padIndex, independence });

    if (type === 'solar') solarModules++;
    addIndependence(CONFIG.independencePerModule);
    return type;
  }

  function addIndependence(n) {
    if (!Number.isFinite(n)) return;
    independence = clamp(independence + n, 0, 100);
    world.shortenTether(independence);
    world.dimEarth(independence);
  }

  function subIndependence(n) {
    if (!Number.isFinite(n)) return;
    independence = clamp(independence - n, 0, 100);
    world.shortenTether(independence);
    world.dimEarth(independence);
  }

  function getIndependence() {
    return independence;
  }

  function solarCount() {
    return solarModules;
  }

  function domeShelter(position) {
    if (!position) return false;
    const r = CONFIG.modules.domeShelterRadius;
    const r2 = r * r;
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      if (m.type !== 'dome' || !m.complete) continue;
      const dx = position.x - m.position.x;
      const dz = position.z - m.position.z;
      if (dx * dx + dz * dz <= r2) return true;
    }
    return false;
  }

  // ================================================================ RESUPPLY
  let resupplyCrate = null;
  let landerGroup = null;
  let landerAnim = null;
  let landerBeacon = null;

  function spawnResupply() {
    if (resupplyCrate) return resupplyCrate;
    const rx = CONFIG.plant.position.x + CONFIG.resupply.offset.x;
    const rz = CONFIG.plant.position.z + CONFIG.resupply.offset.z;
    const ry = groundY(rx, rz);

    // Lander prop: cylinder body, cone engine, legs.
    landerGroup = new THREE.Group();
    landerGroup.name = 'resupply_lander';
    landerGroup.position.set(rx, ry + 30, rz);
    group.add(landerGroup);

    const body = addMesh(landerGroup, geo.landerBody, metalMat, 0, 1.2, 0);
    body.castShadow = true;
    const cone = addMesh(landerGroup, geo.landerCone, metalMat, 0, 2.6, 0);
    cone.castShadow = true;
    const legA = addMesh(landerGroup, geo.landerLeg, metalMat, 1.0, 0.6, 0);
    legA.rotation.z = 0.35;
    const legB = addMesh(landerGroup, geo.landerLeg, metalMat, -1.0, 0.6, 0);
    legB.rotation.z = -0.35;
    const legC = addMesh(landerGroup, geo.landerLeg, metalMat, 0, 0.6, 1.0);
    legC.rotation.x = -0.35;
    const legD = addMesh(landerGroup, geo.landerLeg, metalMat, 0, 0.6, -1.0);
    legD.rotation.x = 0.35;
    // Earth-blue stripe.
    const stripe = addMesh(landerGroup, new THREE.BoxGeometry(2.02, 0.2, 2.02), earthEmissive, 0, 1.4, 0);
    stripe.castShadow = false;
    // Beacon.
    landerBeacon = addMesh(landerGroup, geo.beaconSmall, earthEmissive, 0, 3.2, 0);
    landerBeacon.castShadow = false;
    const beaconLight = new THREE.PointLight(CONFIG.colors.earth, 40, 12, 2);
    beaconLight.position.set(0, 3.2, 0);
    landerGroup.add(beaconLight);

    // Crate at the lander base.
    const crateGroup = new THREE.Group();
    crateGroup.name = 'resupply_crate';
    crateGroup.position.set(rx, ry, rz);
    group.add(crateGroup);
    const crate = addMesh(crateGroup, geo.crate, metalMat, 0, 0.5, 0);
    crate.castShadow = true;
    crate.receiveShadow = true;
    const crateStripe = addMesh(crateGroup, geo.crateStripe, earthEmissive, 0, 0.5, 0);
    crateStripe.castShadow = false;
    const crateBeacon = addMesh(crateGroup, geo.beaconSmall, earthEmissive, 0, 1.1, 0);
    crateBeacon.castShadow = false;
    const crateLight = new THREE.PointLight(CONFIG.colors.earth, 30, 10, 2);
    crateLight.position.set(0, 1.1, 0);
    crateGroup.add(crateLight);

    resupplyCrate = {
      position: new THREE.Vector3(rx, ry, rz),
      triggered: false,
      group: crateGroup,
      beacon: crateBeacon,
      light: crateLight,
    };

    // Descent animation.
    landerAnim = {
      elapsed: 0,
      duration: CONFIG.resupply.descentTime,
      startY: ry + 30,
      endY: ry,
    };
    effects.landerWhoosh(_v.set(rx, ry + 2, rz));
    audio.voice(CONFIG.assets.audio.voice.vo_resupply);
    ui.banner(CONFIG.banner.resupply, 2000);
    events.emit('resupply', { position: { x: rx, y: ry, z: rz } });
    return resupplyCrate;
  }

  // ================================================================ UPDATE
  let pendingComplete = null;

  function update(dt, rover) {
    if (!Number.isFinite(dt) || dt <= 0) return { completedModule: null, resupply: null };

    // Printer advances; completion reported once.
    printer.update(dt);
    if (printer._pendingComplete) {
      const type = printer._pendingComplete;
      const padIndex = printer._pendingPad;
      printer._pendingComplete = null;
      printer._pendingPad = -1;
      const done = completeModule(type, padIndex);
      if (done) pendingComplete = done;
    }

    // Lander descent.
    if (landerAnim && landerGroup) {
      landerAnim.elapsed = Math.min(landerAnim.duration, landerAnim.elapsed + dt);
      const k = landerAnim.duration > 0 ? landerAnim.elapsed / landerAnim.duration : 1;
      const y = lerp(landerAnim.startY, landerAnim.endY, k);
      landerGroup.position.y = y;
      if (landerBeacon) {
        landerBeacon.material.emissiveIntensity = 1.5 + 1.5 * Math.sin(landerAnim.elapsed * 6);
      }
      if (landerAnim.elapsed >= landerAnim.duration) {
        landerAnim = null;
        effects.landerWhoosh(_v.set(landerGroup.position.x, landerGroup.position.y, landerGroup.position.z));
      }
    }

    // Crate trigger: one-shot.
    let resupplyResult = null;
    if (resupplyCrate && !resupplyCrate.triggered && rover && rover.position) {
      const r = CONFIG.resupply.triggerRadius;
      const dx = rover.position.x - resupplyCrate.position.x;
      const dz = rover.position.z - resupplyCrate.position.z;
      if (dx * dx + dz * dz <= r * r) {
        resupplyCrate.triggered = true;
        resupplyResult = {
          power: CONFIG.resupply.power,
          feedstock: CONFIG.resupply.feedstock,
          independenceCost: CONFIG.resupply.independenceCost,
        };
        // Crate beacon goes dark once taken.
        if (resupplyCrate.beacon) resupplyCrate.beacon.material.emissiveIntensity = 0.2;
        if (resupplyCrate.light) resupplyCrate.light.intensity = 0;
        audio.sfx(CONFIG.assets.audio.sfx.resupply);
        ui.toast(CONFIG.toast.resupply, { ms: 2200, color: CONFIG.colors.warning });
        effects.floatFeedstock(resupplyCrate.position, CONFIG.resupply.feedstock);
      }
    }

    // Crate beacon blink.
    if (resupplyCrate && !resupplyCrate.triggered && resupplyCrate.beacon) {
      resupplyCrate.beacon.material.emissiveIntensity = 1.2 + 1.2 * Math.sin(engine.time.elapsed * 4);
    }

    const completedModule = pendingComplete;
    pendingComplete = null;
    return { completedModule, resupply: resupplyResult };
  }

  // ================================================================ RESET
  function reset() {
    // Remove module meshes and dispose nothing shared (geometries/materials reused).
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      if (m.mesh && m.mesh.parent) m.mesh.parent.remove(m.mesh);
    }
    modules.length = 0;
    independence = 0;
    solarModules = 0;
    plant.feedstock = 0;
    plant._dumping = false;
    plant._dumpProgress = 0;
    plant._dumpKg = 0;
    plant._glowTimer = 0;
    printer.printing = null;
    printer._pendingComplete = null;
    printer._pendingPad = -1;
    pendingComplete = null;
    for (let i = 0; i < pads.length; i++) {
      pads[i].module = null;
      if (pads[i].ring) pads[i].ring.visible = true;
    }
    carriage.position.x = 0;
    head.position.x = 0;
    nozzle.position.x = 0;
    nozzleLight.position.x = 0;
    nozzleLight.intensity = 0;
    nozzle.material.emissiveIntensity = 1.2;
    kilnWindow.material.emissiveIntensity = 1.6;
    plantLight.intensity = 30;

    // Resupply.
    if (landerGroup && landerGroup.parent) landerGroup.parent.remove(landerGroup);
    if (resupplyCrate && resupplyCrate.group && resupplyCrate.group.parent) {
      resupplyCrate.group.parent.remove(resupplyCrate.group);
    }
    landerGroup = null;
    landerAnim = null;
    landerBeacon = null;
    resupplyCrate = null;

    world.shortenTether(0);
    world.dimEarth(0);
  }

  // Initial tether state.
  world.shortenTether(0);
  world.dimEarth(0);

  return {
    group,
    plant,
    printer,
    modules,
    getIndependence,
    solarCount,
    domeShelter,
    addIndependence,
    subIndependence,
    spawnResupply,
    get resupplyCrate() {
      return resupplyCrate;
    },
    update,
    reset,
  };
}
