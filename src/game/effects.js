// Regolith — particle bursts, floating text, flashes and audio cues.
// All dust is ballistic in vacuum: gravity -1.62 m/s^2, no drag.

import * as THREE from 'three';
import { CONFIG } from './config.js';

const G = -CONFIG.gravity;                 // -1.62
const DUST = 0x9a948c;
const AMBER = 0xd97a2b;
const ACCENT = 0xffb347;
const WHITE = 0xfff2d8;
const RED = 0xff3b30;
const EARTH = 0x4a86c8;

// Shared overlay for the flare screen flash (one element, reused).
let flashEl = null;
let flashTimer = 0;
let flashDuration = 0;
let flashOpacity = 0;

function ensureFlashEl() {
  if (flashEl) return flashEl;
  if (typeof document === 'undefined') return null;
  flashEl = document.createElement('div');
  flashEl.style.position = 'fixed';
  flashEl.style.left = '0';
  flashEl.style.top = '0';
  flashEl.style.width = '100%';
  flashEl.style.height = '100%';
  flashEl.style.pointerEvents = 'none';
  flashEl.style.zIndex = '40';
  flashEl.style.opacity = '0';
  flashEl.style.background = 'radial-gradient(circle at 50% 40%, rgba(255,242,216,0.95) 0%, rgba(255,179,71,0.55) 35%, rgba(255,59,48,0.25) 70%, rgba(0,0,0,0) 100%)';
  flashEl.style.transition = 'none';
  document.body.appendChild(flashEl);
  return flashEl;
}

function setFlash(opacity) {
  const el = ensureFlashEl();
  if (!el) return;
  el.style.opacity = String(Math.max(0, Math.min(1, opacity)));
}

export function createEffects(engine, CONFIG) {
  const { fx, audio, cam } = engine;

  // Reused temporaries (never allocate inside update loops).
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpDir = new THREE.Vector3();

  // Boost emitter is created once and reused; rate is driven by boostTrail.
  let boostEmitter = null;
  let boostCooldown = 0;

  function v3(position) {
    if (position && typeof position.x === 'number') {
      tmpA.set(position.x, position.y, position.z);
    } else {
      tmpA.set(0, 0, 0);
    }
    return tmpA;
  }

  function safeSfx(name) {
    try { audio.sfx(name); } catch (e) { /* audio is best-effort */ }
  }

  // ---------------------------------------------------------------- dust
  function scoopDust(position) {
    const p = v3(position);
    // Ballistic plume thrown up and forward from the scoop.
    fx.burst(p, {
      count: 10,
      color: DUST,
      color2: 0xa9a49a,
      speed: 3.2,
      spread: 0.7,
      up: 1.1,
      life: 2.2,
      size: 0.22,
      gravity: G,
      drag: 0,
      additive: false,
      grow: 0,
    });
    // A few brighter grains catch the low Sun.
    fx.burst(p, {
      count: 3,
      color: 0xfff2d8,
      speed: 2.4,
      spread: 0.5,
      up: 1.4,
      life: 1.4,
      size: 0.08,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0,
    });
    safeSfx(CONFIG.assets.audio.sfx.scoop);
  }

  // ---------------------------------------------------------------- plant
  function dumpGlow(position) {
    const p = v3(position);
    // Amber kiln sparks rising from the sinter window.
    fx.burst(p, {
      count: 14,
      color: AMBER,
      color2: ACCENT,
      speed: 2.6,
      spread: 0.6,
      up: 1.6,
      life: 1.8,
      size: 0.12,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0.4,
    });
    // Grey dust skirt kicked out at the base.
    fx.burst(p, {
      count: 8,
      color: DUST,
      speed: 2.0,
      spread: 0.9,
      up: 0.4,
      life: 2.0,
      size: 0.3,
      gravity: G,
      drag: 0,
      additive: false,
      grow: 0,
    });
    fx.flashLight(p, { color: AMBER, intensity: 40, distance: 12, duration: 0.6 });
    safeSfx(CONFIG.assets.audio.sfx.dump);
  }

  // ---------------------------------------------------------------- printer
  function printIgnite(position) {
    const p = v3(position);
    // Nozzle ignition: tight amber jet plus a white core flash.
    fx.burst(p, {
      count: 18,
      color: AMBER,
      color2: ACCENT,
      speed: 1.8,
      spread: 0.35,
      up: 2.2,
      life: 1.2,
      size: 0.1,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0.6,
    });
    fx.burst(p, {
      count: 6,
      color: WHITE,
      speed: 0.9,
      spread: 0.3,
      up: 1.6,
      life: 0.7,
      size: 0.16,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0.8,
    });
    fx.flashLight(p, { color: AMBER, intensity: 70, distance: 16, duration: 0.8 });
    safeSfx(CONFIG.assets.audio.sfx.print);
  }

  function moduleCompleteFlash(position) {
    const p = v3(position);
    // White flash of the finished module.
    fx.burst(p, {
      count: 26,
      color: WHITE,
      color2: ACCENT,
      speed: 4.0,
      spread: 1.0,
      up: 1.2,
      life: 1.6,
      size: 0.18,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0.5,
    });
    // Ceramic dust settling around the base of the module.
    fx.burst(p, {
      count: 12,
      color: DUST,
      speed: 2.4,
      spread: 1.0,
      up: 0.6,
      life: 2.4,
      size: 0.28,
      gravity: G,
      drag: 0,
      additive: false,
      grow: 0,
    });
    fx.flashLight(p, { color: WHITE, intensity: 90, distance: 20, duration: 1.0 });
    cam.shake(0.25, 0.25);
    safeSfx(CONFIG.assets.audio.sfx.complete);
  }

  // ---------------------------------------------------------------- hits
  function boulderHit(position) {
    const p = v3(position);
    fx.burst(p, {
      count: 16,
      color: DUST,
      color2: 0x5d5c58,
      speed: 4.5,
      spread: 0.9,
      up: 0.9,
      life: 2.4,
      size: 0.26,
      gravity: G,
      drag: 0,
      additive: false,
      grow: 0,
    });
    fx.burst(p, {
      count: 6,
      color: ACCENT,
      speed: 5.0,
      spread: 0.8,
      up: 1.0,
      life: 0.9,
      size: 0.07,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0,
    });
    cam.shake(CONFIG.rover.hitShakeIntensity, CONFIG.rover.hitShakeDuration);
    // Red vignette: brief screen-edge flash.
    engine.ui.flash(RED, 260, 0.35);
    safeSfx(CONFIG.assets.audio.sfx.boulder);
    safeSfx(CONFIG.assets.audio.sfx.hurt);
  }

  function meteorImpact(position) {
    const p = v3(position);
    // White-hot impact flash.
    fx.burst(p, {
      count: 22,
      color: WHITE,
      color2: ACCENT,
      speed: 6.0,
      spread: 1.0,
      up: 1.4,
      life: 1.4,
      size: 0.2,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0.6,
    });
    // Ejecta curtain: clean ballistic arcs, no billowing in vacuum.
    fx.burst(p, {
      count: 28,
      color: DUST,
      color2: 0x8b8a84,
      speed: 7.5,
      spread: 1.0,
      up: 1.2,
      life: 3.0,
      size: 0.3,
      gravity: G,
      drag: 0,
      additive: false,
      grow: 0,
    });
    fx.flashLight(p, { color: WHITE, intensity: 120, distance: 26, duration: 0.7 });
    cam.shake(CONFIG.hazards.impactShake, CONFIG.hazards.impactShakeDuration);
    engine.ui.flash(WHITE, 180, 0.5);
    safeSfx(CONFIG.assets.audio.sfx.impact);
  }

  // ---------------------------------------------------------------- flare
  function flareFlash() {
    // Bloom spike on the Sun disc.
    try {
      fx.bloomPulse(CONFIG.hazards.flareBloom, 0.9);
    } catch (e) {
      // Older engine builds may not expose bloomPulse; fall back to setBloom.
      try {
        engine.env.setBloom({
          strength: CONFIG.world.bloomStrength + CONFIG.hazards.flareBloom,
          radius: CONFIG.world.bloomRadius,
          threshold: CONFIG.world.bloomThreshold,
          enabled: true,
        });
      } catch (e2) { /* ignore */ }
    }
    // Screen flash overlay (drawn here, faded in update()).
    flashDuration = CONFIG.hazards.flareFlashMs / 1000;
    flashTimer = flashDuration;
    flashOpacity = 0.85;
    setFlash(flashOpacity);
    // Harsh light burst at the rover's position.
    fx.flashLight(tmpB.set(0, 2, 0), { color: WHITE, intensity: 200, distance: 60, duration: 0.8 });
    safeSfx(CONFIG.assets.audio.sfx.alarm);
  }

  // ---------------------------------------------------------------- boost
  function boostTrail(position, direction) {
    const p = v3(position);
    if (direction && typeof direction.x === 'number') {
      tmpDir.set(direction.x, direction.y, direction.z);
    } else {
      tmpDir.set(0, 0, 1);
    }
    if (tmpDir.lengthSq() < 1e-6) tmpDir.set(0, 0, 1);
    tmpDir.normalize();

    if (!boostEmitter) {
      boostEmitter = fx.emitter({
        rate: 22,
        color: DUST,
        color2: 0xa9a49a,
        speed: 3.5,
        direction: [tmpDir.x, 0.35, tmpDir.z],
        spread: 0.5,
        life: 1.8,
        size: 0.22,
        gravity: G,
        drag: 0,
        additive: false,
        grow: 0,
      });
    }
    boostEmitter.setPosition(p);
    boostEmitter.setDirection(tmpDir);
    boostEmitter.setRate(22);

    // Throttle discrete puffs so the trail reads even at low frame rates.
    boostCooldown -= engine.time.dt;
    if (boostCooldown <= 0) {
      boostCooldown = 0.08;
      fx.burst(p, {
        count: 3,
        color: DUST,
        speed: 2.6,
        spread: 0.5,
        up: 0.5,
        life: 1.6,
        size: 0.2,
        gravity: G,
        drag: 0,
        additive: false,
        grow: 0,
      });
    }
  }

  // ---------------------------------------------------------------- text
  function floatKg(position, kg) {
    const p = v3(position);
    const n = Math.max(0, Math.round(kg));
    fx.floatText(p, '+' + n + ' kg', { color: ACCENT, size: 0.9, duration: 1.4 });
  }

  function floatFeedstock(position, kg) {
    const p = v3(position);
    const n = Math.max(0, Math.round(kg));
    fx.floatText(p, '+' + n + ' kg feedstock', { color: AMBER, size: 0.9, duration: 1.6 });
    safeSfx(CONFIG.assets.audio.sfx.feedstock);
  }

  function floatIndependence(position, pct) {
    const p = v3(position);
    const n = Math.max(0, Math.round(pct));
    fx.floatText(p, '+' + n + '%', { color: WHITE, size: 1.2, duration: 1.8 });
  }

  // ---------------------------------------------------------------- lander
  function landerWhoosh(position) {
    const p = v3(position);
    // Retro-propulsion dust thrown radially outward, ballistic.
    fx.burst(p, {
      count: 20,
      color: DUST,
      color2: 0xa9a49a,
      speed: 5.0,
      spread: 1.0,
      up: 0.3,
      life: 2.6,
      size: 0.32,
      gravity: G,
      drag: 0,
      additive: false,
      grow: 0,
    });
    fx.burst(p, {
      count: 8,
      color: EARTH,
      speed: 2.0,
      spread: 0.6,
      up: 1.4,
      life: 1.4,
      size: 0.1,
      gravity: G,
      drag: 0,
      additive: true,
      grow: 0.3,
    });
    fx.flashLight(p, { color: EARTH, intensity: 50, distance: 18, duration: 0.8 });
    safeSfx(CONFIG.assets.audio.sfx.lander);
  }

  // ---------------------------------------------------------------- reset
  function reset() {
    fx.clear();
    if (boostEmitter) {
      try { boostEmitter.stop(); } catch (e) { /* ignore */ }
      boostEmitter = null;
    }
    boostCooldown = 0;
    flashTimer = 0;
    flashDuration = 0;
    flashOpacity = 0;
    setFlash(0);
    try {
      engine.env.setBloom({
        strength: CONFIG.world.bloomStrength,
        radius: CONFIG.world.bloomRadius,
        threshold: CONFIG.world.bloomThreshold,
        enabled: true,
      });
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- tick
  // Called by game.js each update to fade the flare overlay and stop the
  // boost emitter when it is no longer requested.
  function update(dt) {
    if (flashTimer > 0) {
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flashTimer = 0;
        flashOpacity = 0;
        setFlash(0);
      } else {
        const k = flashDuration > 0 ? flashTimer / flashDuration : 0;
        setFlash(flashOpacity * k);
      }
    }
    if (boostEmitter) {
      boostEmitter.setRate(0);
    }
  }

  return {
    scoopDust,
    dumpGlow,
    printIgnite,
    moduleCompleteFlash,
    boulderHit,
    meteorImpact,
    flareFlash,
    boostTrail,
    floatKg,
    floatFeedstock,
    floatIndependence,
    landerWhoosh,
    reset,
    update,
  };
}
