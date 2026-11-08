// Regolith — guidance: current objective, 3D beacon (beam + chevron + ground ring),
// HUD "Next:" line, off-screen edge arrow, tutorial toasts and the G toggle.

import * as THREE from 'three';

// XZ distance between two points given as four numbers.
function distXZ(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

const BEAM_HEIGHT = 40;
const BEAM_RADIUS = 0.5;
const CHEVRON_HEIGHT = 1.2;
const CHEVRON_RADIUS = 0.7;
const CHEVRON_BOB = 5;
const PRINT_FEEDSTOCK = 300;

const OBJ_DEPOSIT = 'deposit';
const OBJ_PLANT = 'plant';
const OBJ_GANTRY = 'gantry';

const OBJ_TEXT = {
  deposit: 'scoop regolith',
  plant: 'sinter feedstock',
  gantry: 'print module (Enter)',
};

const OBJ_COLOR = {
  deposit: 0x00e5ff,
  plant: 0xffb347,
  gantry: 0x33ff66,
};

const OBJ_CSS = {
  deposit: '#00e5ff',
  plant: '#ffb347',
  gantry: '#33ff66',
};

const OBJ_RING_RADIUS = {
  deposit: 4.6,
  plant: 4,
  gantry: 4,
};

const TUTORIAL_TEXT = {
  0: 'Drive up to the mound under the cyan beam and hold Space to scoop',
  1: 'Hopper full: drive to the amber beacon, the sintering plant',
  2: 'Feedstock ready: drive to the green beacon and press Enter to print',
};

function finite(v, fallback) {
  return Number.isFinite(v) ? v : fallback;
}

export function createGuidance(engine, CONFIG, world, deposits, base, rover) {
  const { scene, ui, input, camera, time } = engine;

  const group = new THREE.Group();
  group.name = 'guidance';

  // ---------------------------------------------------------------- state
  let objective = '';
  let objectiveDistance = 0;
  let target = null;
  let beamsEnabled = true;
  let tutorialStep = 0;
  let tutorialDone = false;
  let beamsAutoOff = false;
  let lastToastStep = -1;
  let arrowEl = null;
  let nextEl = null;

  // temporaries reused every update
  const projected = new THREE.Vector3();
  const targetVec = new THREE.Vector3();

  // ---------------------------------------------------------------- kits
  // One beam, one chevron and one ring, permanently in the scene; only their
  // visibility and colour change per objective.
  let beam = null;
  let beamMat = null;
  let chevron = null;
  let chevronMat = null;
  let ring = null;
  let ringMat = null;

  function buildBeacon() {
    beamMat = new THREE.MeshBasicMaterial({
      color: OBJ_COLOR.deposit,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamGeo = new THREE.CylinderGeometry(BEAM_RADIUS, BEAM_RADIUS, BEAM_HEIGHT, 12, 1, true);
    beamGeo.translate(0, BEAM_HEIGHT * 0.5, 0);
    beam = new THREE.Mesh(beamGeo, beamMat);
    beam.name = 'guidance_beam';
    beam.frustumCulled = false;
    beam.renderOrder = 10;
    beam.castShadow = false;
    beam.receiveShadow = false;
    beam.visible = false;
    group.add(beam);

    chevronMat = new THREE.MeshBasicMaterial({
      color: OBJ_COLOR.deposit,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    chevron = new THREE.Mesh(new THREE.ConeGeometry(CHEVRON_RADIUS, CHEVRON_HEIGHT, 8), chevronMat);
    chevron.name = 'guidance_chevron';
    chevron.rotation.x = Math.PI;
    chevron.frustumCulled = false;
    chevron.renderOrder = 11;
    chevron.castShadow = false;
    chevron.receiveShadow = false;
    chevron.visible = false;
    group.add(chevron);

    ringMat = new THREE.MeshBasicMaterial({
      color: OBJ_COLOR.deposit,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 48), ringMat);
    ring.name = 'guidance_ring';
    ring.rotation.x = -Math.PI / 2;
    ring.frustumCulled = false;
    ring.renderOrder = 9;
    ring.castShadow = false;
    ring.receiveShadow = true;
    ring.visible = false;
    group.add(ring);
  }

  // ---------------------------------------------------------------- helpers
  function heightAt(x, z) {
    if (world && world.terrain && typeof world.terrain.heightAt === 'function') {
      return finite(world.terrain.heightAt(x, z), 0);
    }
    if (world && world.ground && typeof world.ground.heightAt === 'function') {
      return finite(world.ground.heightAt(x, z), 0);
    }
    if (world && typeof world.heightAt === 'function') {
      return finite(world.heightAt(x, z), 0);
    }
    return 0;
  }

  function isSunlit(x, z) {
    if (world && typeof world.isInShadow === 'function') {
      try {
        return world.isInShadow(targetVec.set(x, heightAt(x, z), z)) === false;
      } catch (e) {
        return true;
      }
    }
    return true;
  }

  function roverPosition() {
    if (rover && rover.group && rover.group.position) return rover.group.position;
    if (rover && rover.position) return rover.position;
    return null;
  }

  function roverHopper() {
    if (rover) {
      if (Number.isFinite(rover.hopper)) return rover.hopper;
      if (rover.state && Number.isFinite(rover.state.hopper)) return rover.state.hopper;
    }
    return 0;
  }

  function baseFeedstock() {
    if (base) {
      if (Number.isFinite(base.feedstock)) return base.feedstock;
      if (base.state && Number.isFinite(base.state.feedstock)) return base.state.feedstock;
      if (base.plant && Number.isFinite(base.plant.feedstock)) return base.plant.feedstock;
    }
    return 0;
  }

  function printerIdle() {
    if (base) {
      if (base.printerIdle === true) return true;
      if (base.printerIdle === false) return false;
      if (base.state && typeof base.state.printing === 'boolean') return base.state.printing === false;
      if (base.printer && base.printer.printing) {
        if (typeof base.printer.printing === 'boolean') return !base.printer.printing;
        if (typeof base.printer.printing.active === 'boolean') return !base.printer.printing.active;
      }
    }
    return false;
  }

  function modulesPrintedCount() {
    if (!base) return 0;
    if (Number.isFinite(base.modulesPrinted)) return base.modulesPrinted;
    if (Number.isFinite(base.independence) && base.independence > 0) return 1;
    if (Array.isArray(base.modules)) {
      let n = 0;
      for (let i = 0; i < base.modules.length; i++) {
        const m = base.modules[i];
        if (m && m.complete) n++;
      }
      return n;
    }
    return 0;
  }

  function targetXZ(t) {
    if (!t) return null;
    if (t.position && Number.isFinite(t.position.x) && Number.isFinite(t.position.z)) {
      return { x: t.position.x, z: t.position.z };
    }
    if (Number.isFinite(t.x) && Number.isFinite(t.z)) {
      return { x: t.x, z: t.z };
    }
    return null;
  }

  function nearestDepositFallback(rx, rz) {
    const list = deposits && Array.isArray(deposits.list) ? deposits.list : [];
    let best = null;
    let bestDist = Infinity;
    let bestSunlit = null;
    let bestSunlitDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (!d) continue;
      const p = targetXZ(d);
      if (!p) continue;
      if (Number.isFinite(d.remaining) && d.remaining <= 0) continue;
      const dd = distXZ(rx, rz, p.x, p.z);
      if (dd < bestDist) {
        bestDist = dd;
        best = d;
      }
      if (isSunlit(p.x, p.z) && dd < bestSunlitDist) {
        bestSunlitDist = dd;
        bestSunlit = d;
      }
    }
    return bestSunlit || best;
  }

  function resolveDepositTarget(rp) {
    if (deposits && typeof deposits.nearest === 'function') {
      try {
        const d = deposits.nearest(rp, Infinity);
        if (d) return d;
      } catch (e) {
        // fall through to manual scan
      }
    }
    const rx = finite(rp ? rp.x : 0, 0);
    const rz = finite(rp ? rp.z : 0, 0);
    const d = nearestDepositFallback(rx, rz);
    if (d) return d;
    if (deposits && typeof deposits.nearestAny === 'function') {
      try {
        return deposits.nearestAny(rp) || null;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  function resolveTarget(kind, rp) {
    if (kind === OBJ_DEPOSIT) return resolveDepositTarget(rp);
    if (kind === OBJ_PLANT) {
      if (base && base.plantPosition) return base.plantPosition;
      if (base && base.plant && base.plant.position) return base.plant.position;
      return null;
    }
    if (kind === OBJ_GANTRY) {
      if (base && base.gantryPosition) return base.gantryPosition;
      if (base && base.printer && base.printer.position) return base.printer.position;
      return null;
    }
    return null;
  }

  function computeObjective() {
    const rp = roverPosition();
    const hopper = roverHopper();
    const feed = baseFeedstock();
    const idle = printerIdle();

    let kind;
    if (hopper > 0) {
      kind = OBJ_PLANT;
    } else if (feed >= PRINT_FEEDSTOCK && idle) {
      kind = OBJ_GANTRY;
    } else {
      kind = OBJ_DEPOSIT;
    }

    const resolved = resolveTarget(kind, rp);
    const p = targetXZ(resolved);
    if (!resolved || !p) {
      target = null;
      objective = '';
      objectiveDistance = 0;
      return;
    }

    target = resolved;
    objective = kind;
    if (rp) {
      // Distance still to cover before the action works: deposits count from the
      // edge of the scoop reach, the plant from its unload radius.
      let d = distXZ(finite(rp.x, 0), finite(rp.z, 0), p.x, p.z);
      if (kind === OBJ_DEPOSIT) {
        const fp = Number.isFinite(resolved.footprint) ? resolved.footprint : 3.2;
        d -= fp + finite(CONFIG.scoop && CONFIG.scoop.range, 3);
      } else if (kind === OBJ_PLANT) {
        d -= finite(CONFIG.plant && CONFIG.plant.range, 4);
      }
      objectiveDistance = Math.max(0, Math.round(d));
    } else {
      objectiveDistance = 0;
    }
    if (!Number.isFinite(objectiveDistance)) objectiveDistance = 0;
  }

  // ---------------------------------------------------------------- beacon
  function placeBeacon(dt) {
    const hasTarget = !!target && !!objective;
    const show = hasTarget && beamsEnabled;
    if (beam) beam.visible = show;
    if (chevron) chevron.visible = show;
    if (ring) ring.visible = hasTarget;
    if (!hasTarget) return;

    const p = targetXZ(target);
    if (!p) return;

    const h = heightAt(p.x, p.z);
    const t = finite(time && time.elapsed, 0);
    const color = OBJ_COLOR[objective] || OBJ_COLOR.deposit;

    if (beam) {
      beam.position.set(p.x, h, p.z);
      beamMat.color.setHex(color);
      beamMat.opacity = 0.25 + 0.15 * Math.sin(t * 3);
    }
    if (chevron) {
      chevron.position.set(p.x, h + CHEVRON_BOB + Math.sin(t * 2) * 0.6, p.z);
      chevron.rotation.y += dt * 0.8;
      chevronMat.color.setHex(color);
    }
    if (ring) {
      ring.position.set(p.x, h + 0.05, p.z);
      const r = OBJ_RING_RADIUS[objective] || OBJ_RING_RADIUS.deposit;
      ring.scale.set(r, r, r);
      ringMat.color.setHex(color);
    }
  }

  // ---------------------------------------------------------------- DOM
  function domRoot() {
    if (ui && ui.root) return ui.root;
    if (typeof document !== 'undefined') return document.body;
    return null;
  }

  function ensureDom() {
    if (typeof document === 'undefined') return;
    const root = domRoot();
    if (!root) return;

    if (!arrowEl) {
      try {
        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.width = '0';
        el.style.height = '0';
        el.style.borderLeft = '10px solid transparent';
        el.style.borderRight = '10px solid transparent';
        el.style.borderBottom = '18px solid ' + OBJ_CSS.deposit;
        el.style.transformOrigin = 'center';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '50';
        el.style.display = 'none';
        root.appendChild(el);
        arrowEl = el;
      } catch (e) {
        arrowEl = null;
      }
    }

    if (!nextEl) {
      try {
        const el = document.createElement('div');
        el.style.position = 'absolute';
        el.style.top = '104px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.font = '600 16px/1.2 monospace';
        el.style.color = '#ffffff';
        el.style.textShadow = '0 1px 3px #000';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '40';
        el.style.whiteSpace = 'nowrap';
        el.style.display = 'none';
        root.appendChild(el);
        nextEl = el;
      } catch (e) {
        nextEl = null;
      }
    }
  }

  function updateHudLine() {
    if (!nextEl) return;
    if (!objective) {
      nextEl.textContent = '';
      nextEl.style.display = 'none';
      return;
    }
    const action = OBJ_TEXT[objective] || OBJ_TEXT.deposit;
    const dist = Number.isFinite(objectiveDistance) ? Math.round(objectiveDistance) : 0;
    if (dist <= 0 && objective === OBJ_DEPOSIT) {
      nextEl.textContent = 'In range: hold Space to scoop';
    } else if (dist <= 0 && objective === OBJ_PLANT) {
      nextEl.textContent = 'In range: unloading at the plant';
    } else {
      nextEl.textContent = 'Next: ' + action + ' (' + dist + ' m)';
    }
    nextEl.style.display = 'block';
  }

  function hideHudLine() {
    if (!nextEl) return;
    nextEl.textContent = '';
    nextEl.style.display = 'none';
  }

  function updateArrow() {
    if (!arrowEl) return;
    if (!target) {
      arrowEl.style.display = 'none';
      return;
    }
    const p = targetXZ(target);
    if (!p) {
      arrowEl.style.display = 'none';
      return;
    }

    const ty = heightAt(p.x, p.z);
    projected.set(p.x, ty + 2, p.z).project(camera);

    const onScreen = projected.z < 1 &&
      Math.abs(projected.x) < 0.95 &&
      Math.abs(projected.y) < 0.95;

    if (onScreen) {
      arrowEl.style.display = 'none';
      return;
    }

    let w = 1280;
    let hgt = 720;
    if (engine.renderer && engine.renderer.domElement) {
      w = engine.renderer.domElement.clientWidth || w;
      hgt = engine.renderer.domElement.clientHeight || hgt;
    } else if (typeof window !== 'undefined') {
      w = window.innerWidth || w;
      hgt = window.innerHeight || hgt;
    }

    const dx = projected.x;
    const dy = -projected.y;
    const angle = Math.atan2(dy, dx);
    const radius = Math.min(w, hgt) * 0.5 * 0.85;

    const left = w / 2 + Math.cos(angle) * radius - 10;
    const top = hgt / 2 + Math.sin(angle) * radius - 9;

    arrowEl.style.left = left + 'px';
    arrowEl.style.top = top + 'px';
    arrowEl.style.transform = 'rotate(' + (angle - Math.PI / 2) + 'rad)';
    arrowEl.style.color = OBJ_CSS[objective] || OBJ_CSS.deposit;
    arrowEl.style.borderBottom = '18px solid currentColor';
    arrowEl.style.display = 'block';
  }

  // ---------------------------------------------------------------- tutorial
  function checkTutorial() {
    if (tutorialDone || !beamsEnabled) return;
    if (!objective) return;

    let step = -1;
    if (objective === OBJ_DEPOSIT) step = 0;
    else if (objective === OBJ_PLANT) step = 1;
    else if (objective === OBJ_GANTRY) step = 2;

    if (step < 0) return;
    if (step <= lastToastStep) return;

    const text = TUTORIAL_TEXT[step];
    if (text) {
      const color = OBJ_CSS[step === 0 ? OBJ_DEPOSIT : step === 1 ? OBJ_PLANT : OBJ_GANTRY];
      ui.toast(text, { ms: 4000, color });
    }
    lastToastStep = step;
    if (step > tutorialStep) tutorialStep = step;
  }

  // ---------------------------------------------------------------- public
  function init() {
    if (!beam) buildBeacon();
    if (!group.parent) scene.add(group);
    ensureDom();
  }

  function start() {
    objective = '';
    objectiveDistance = 0;
    target = null;
    beamsEnabled = true;
    tutorialStep = 0;
    tutorialDone = false;
    beamsAutoOff = false;
    lastToastStep = -1;

    if (beam) beam.visible = false;
    if (chevron) chevron.visible = false;
    if (ring) ring.visible = false;
    if (arrowEl) arrowEl.style.display = 'none';
    hideHudLine();

    if (ui && ui.hud && typeof ui.hud.remove === 'function') {
      try { ui.hud.remove('objective'); } catch (e) { /* ignore */ }
    }
  }

  function reset() {
    start();
  }

  function setBeamsEnabled(v) {
    beamsEnabled = !!v;
    const show = beamsEnabled && !!target;
    if (beam) beam.visible = show;
    if (chevron) chevron.visible = show;
  }

  function update(dt) {
    computeObjective();

    // first module printed -> beams off automatically, once per run
    if (!beamsAutoOff && modulesPrintedCount() >= 1) {
      beamsAutoOff = true;
      tutorialDone = true;
      beamsEnabled = false;
    }

    // G toggle
    if (input.pressed('KeyG')) {
      beamsEnabled = !beamsEnabled;
    }

    placeBeacon(dt);
    updateHudLine();
    updateArrow();
    checkTutorial();
  }

  function getState() {
    return {
      objective,
      objectiveDistance: Number.isFinite(objectiveDistance) ? objectiveDistance : 0,
      tutorialStep,
      beamsEnabled,
    };
  }

  return {
    group,
    init,
    start,
    update,
    getState,
    reset,
    setBeamsEnabled,
    get beamsEnabled() { return beamsEnabled; },
    set beamsEnabled(v) { setBeamsEnabled(v); },
    get objective() { return objective; },
    get objectiveDistance() { return Number.isFinite(objectiveDistance) ? objectiveDistance : 0; },
    get tutorialStep() { return tutorialStep; },
  };
}
