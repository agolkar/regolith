// Regolith — music, ambience, voice lines and named sfx helpers.
// Owns: music_main loop, vacuum-safe ambience (habitat hum, servo whir, radio static),
// voice ids vo_start..vo_fail plus vo_module_complete, and the sfx mapping.

import { CONFIG } from './config.js';

const SFX_NAMES = Object.freeze({
  engine: 'engine',
  thud: 'thud',
  powerup: 'powerup',
  laser: 'laser',
  tick: 'tick',
  explosion: 'explosion',
  alarm: 'alarm',
  success: 'success',
  coin: 'coin',
  whoosh: 'whoosh',
});

const VOICE_IDS = Object.freeze({
  vo_start: 'vo_start',
  vo_scoop: 'vo_scoop',
  vo_feedstock: 'vo_feedstock',
  vo_print: 'vo_print',
  vo_meteor: 'vo_meteor',
  vo_flare: 'vo_flare',
  vo_resupply: 'vo_resupply',
  vo_lowpower: 'vo_lowpower',
  vo_win: 'vo_win',
  vo_fail: 'vo_fail',
  vo_module_complete: 'vo_module_complete',
});

// Valid BiquadFilterType values for the Web Audio API. 'brown'/'white' are
// noise *colour* names, not filter types, and must never reach loopNoise.
const FILTER_TYPES = Object.freeze(['lowpass', 'highpass', 'bandpass', 'lowshelf', 'highshelf', 'peaking', 'notch', 'allpass']);

function safeFilterType(type, fallback) {
  return FILTER_TYPES.indexOf(type) >= 0 ? type : fallback;
}

function safeNumber(value, fallback, min, max) {
  let v = Number.isFinite(value) ? value : fallback;
  if (!Number.isFinite(v)) v = fallback;
  if (Number.isFinite(min) && v < min) v = min;
  if (Number.isFinite(max) && v > max) v = max;
  return v;
}

export function createAudio(engine, CONFIG) {
  const audio = engine.audio;
  const assets = engine.assets;

  let musicOn = false;
  let hum = null;          // habitat hum loop (low-pass noise)
  let servo = null;        // intermittent servo whir loop
  let staticLoop = null;   // faint radio static loop
  let servoTimer = 0;
  let servoPulse = 0;

  function startMusic() {
    if (musicOn) return;
    musicOn = true;
    const id = CONFIG && CONFIG.assets && CONFIG.assets.audio ? CONFIG.assets.audio.music_main : null;
    if (!id) return;
    audio.music(id, { volume: 0.35, fade: 1.5 });
  }

  function stopMusic() {
    if (!musicOn) return;
    musicOn = false;
    audio.stopMusic(1.2);
  }

  function startAmbience() {
    if (hum) return;
    // Low habitat hum: filtered noise, very quiet, no wind (vacuum).
    hum = audio.loopNoise({ filter: safeFilterType('lowpass', 'lowpass'), vol: 0.05, type: 'brown' });
    if (hum && hum.set) hum.set({ volume: 0.05, filter: 180 });
    // Faint radio static.
    staticLoop = audio.loopNoise({ filter: safeFilterType('bandpass', 'bandpass'), vol: 0.015, type: 'white' });
    if (staticLoop && staticLoop.set) staticLoop.set({ volume: 0.015, filter: 2400 });
    servoTimer = 0;
    servoPulse = 0;
  }

  function stopAmbience() {
    if (hum) { hum.stop(); hum = null; }
    if (staticLoop) { staticLoop.stop(); staticLoop = null; }
    if (servo) { servo.stop(); servo = null; }
    servoTimer = 0;
    servoPulse = 0;
  }

  function voice(id) {
    const mapped = VOICE_IDS[id] || id;
    if (!mapped) return;
    audio.voice(mapped);
  }

  function sfx(name) {
    const mapped = SFX_NAMES[name] || name;
    if (!mapped) return;
    audio.sfx(mapped);
  }

  function engineLoop() {
    let handle = null;
    let stopped = false;
    let volume = 0;
    let filter = 400;
    let started = false;

    function ensure() {
      if (started || stopped) return;
      started = true;
      handle = audio.loopNoise({ filter: safeFilterType('lowpass', 'lowpass'), vol: 0.0, type: 'brown' });
      if (handle && handle.set) handle.set({ volume: 0.0, filter: 400 });
    }

    return {
      set(vol, filt) {
        if (stopped) return;
        ensure();
        volume = safeNumber(vol, 0, 0, 1);
        filter = safeNumber(filt, 400, 80, 4000);
        if (handle && handle.set) handle.set({ volume: volume * 0.35, filter });
      },
      stop() {
        if (stopped) return;
        stopped = true;
        if (handle) { handle.stop(); handle = null; }
      },
    };
  }

  function printLoop() {
    let handle = null;
    let stopped = false;
    let started = false;
    let volume = 0;

    function ensure() {
      if (started || stopped) return;
      started = true;
      handle = audio.loopNoise({ filter: safeFilterType('bandpass', 'bandpass'), vol: 0.0, type: 'white' });
      if (handle && handle.set) handle.set({ volume: 0.0, filter: 1800 });
    }

    return {
      set(vol) {
        if (stopped) return;
        ensure();
        volume = safeNumber(vol, 0, 0, 1);
        if (handle && handle.set) handle.set({ volume: volume * 0.25, filter: 1800 });
      },
      stop() {
        if (stopped) return;
        stopped = true;
        if (handle) { handle.stop(); handle = null; }
      },
    };
  }

  function tick() {
    audio.sfx(SFX_NAMES.tick);
  }

  // Called once per update by game.js to keep the ambience alive (servo whir pulses).
  function updateAmbience(dt) {
    if (!hum) return;
    const step = Number.isFinite(dt) && dt > 0 ? dt : 0;
    servoTimer -= step;
    if (servoPulse > 0) {
      servoPulse -= step;
      if (servoPulse <= 0 && servo) { servo.stop(); servo = null; }
    }
    if (servoTimer <= 0) {
      servoTimer = 3 + Math.random() * 5;
      if (!servo) {
        servo = audio.loopNoise({ filter: safeFilterType('bandpass', 'bandpass'), vol: 0.02, type: 'white' });
        if (servo && servo.set) servo.set({ volume: 0.02, filter: 1200 });
        servoPulse = 0.6;
      }
    }
  }

  function reset() {
    stopAmbience();
    startAmbience();
  }

  return {
    startMusic,
    stopMusic,
    voice,
    sfx,
    engineLoop,
    printLoop,
    tick,
    reset,
    // internal helper used by game.js each update; harmless extra field
    updateAmbience,
  };
}
