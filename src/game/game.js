// Regolith — state machine, wiring, rules, scoring, events, getState.
// Owns: scene state, Enter routing, run timer and sun descent, combo rule,
// integrity, battery emergency reserve, win/lose, score formula, best save,
// events, HUD updates, camera follow and pull-back, cutscene triggers,
// and the objective banner that walks the player through the first cycle.
// Guidance (beacons, HUD 'Next:' line, edge arrow, tutorial toasts) is owned
// by guidance.js and wired here into the run lifecycle and getState().

import * as THREE from 'three';
import { clamp, lerp, damp } from '../engine/util.js';
import { CONFIG } from './config.js';
import { createWorld } from './world.js';
import { createDeposits } from './deposits.js';
import { createRover } from './rover.js';
import { createEffects } from './effects.js';
import { createBase } from './base.js';
import { createHazards } from './hazards.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createScreens } from './screens.js';
import { createGuidance } from './guidance.js';

// Reusable temporaries (never allocate inside update loops).
const _tmp = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _camOffset = new THREE.Vector3();

// Objective steps for the first scoop-to-print cycle. Each step is gated on
// actual state, never on a timer.
const OBJECTIVE_STEPS = [
  { key: 'scoop', text: 'HOLD SPACE TO SCOOP' },
  { key: 'plant', text: 'DRIVE TO THE PLANT' },
  { key: 'print', text: 'PRESS ENTER TO PRINT A DOME' },
];

export function createGame(engine) {
  const { scene, input, ui, audio, fx, cam, assets, env, events, save, time } = engine;

  // ---------------------------------------------------------------- modules
  let world = null;
  let deposits = null;
  let rover = null;
  let effects = null;
  let base = null;
  let hazards = null;
  let hud = null;
  let sfx = null;
  let screens = null;
  let guidance = null;

  // ---------------------------------------------------------------- run state
  const s = {
    scene: 'title',
    score: 0,
    level: CONFIG.level,
    lives: 1,
    independence: 0,
    timeLeft: CONFIG.runLength,
    elapsed: 0,
    power: CONFIG.battery.max,
    integrity: CONFIG.integrity.max,
    hopper: 0,
    feedstock: 0,
    combo: 1,
    comboWindow: 0,
    modules: 0,
    printing: false,
    flare: false,
    meteors: 0,
    best: 0,
    cause: '',
    emergencyTimer: -1,      // -1 = inactive; >= 0 counts down
    lowPowerWarned: false,
    lowPowerTickTimer: 0,
    tutorialIndex: 0,
    introPlayed: false,
    introPending: false,
    endShown: false,
    victoryPending: false,
    gameOverPending: false,
    resupplyTaken: false,
    resupplySpawned: false,
    firstScoop: false,
    firstFeedstock: false,
    firstPrint: false,
    firstMeteor: false,
    firstFlare: false,
    firstResupply: false,
    firstLowPower: false,
    selectedModule: 'dome',
    printPullBack: 0,
    shakeTimer: 0,
    scoreIndependence: 0,
    scoreTime: 0,
    // objective banner state
    objectiveStep: 0,
    objectiveDone: false,
    objectiveShown: false,
    objectiveText: '',
    // first-cycle reward flags
    firstScoopTick: false,
    firstFeedstockFx: false,
  };

  // ---------------------------------------------------------------- helpers
  function safeNum(v, fallback) {
    return Number.isFinite(v) ? v : fallback;
  }

  function emit(name, data) {
    try { events.emit(name, data); } catch (e) { /* events are best-effort */ }
  }

  function voice(id) {
    if (!id) return;
    try { audio.voice(id); } catch (e) { /* audio is best-effort */ }
  }

  function sfxName(name) {
    if (!name) return;
    try { audio.sfx(name); } catch (e) { /* audio is best-effort */ }
  }

  function banner(text, ms) {
    try { hud.banner(text, ms); } catch (e) { /* hud is best-effort */ }
  }

  function toast(text, opts) {
    try { hud.toast(text, opts); } catch (e) { /* hud is best-effort */ }
  }

  function computeScore() {
    const ind = clamp(s.independence, 0, 100);
    s.scoreIndependence = Math.round(ind * CONFIG.scoreIndependenceWeight);
    // Score = Independence% × 1000 + max(0, 240 − t) × 15, where t is elapsed time.
    s.scoreTime = Math.round(Math.max(0, CONFIG.runLength - s.elapsed) * CONFIG.scoreTimeWeight);
    s.score = Math.max(0, Math.round(s.scoreIndependence + s.scoreTime));
    return s.score;
  }

  function saveBest() {
    if (s.score > s.best) {
      s.best = s.score;
      try { save.set(CONFIG.saveKeyBest, s.best); } catch (e) { /* ignore */ }
    }
  }

  function loadBest() {
    let best = 0;
    try { best = save.get(CONFIG.saveKeyBest, 0); } catch (e) { best = 0; }
    s.best = Number.isFinite(best) ? Math.max(0, Math.round(best)) : 0;
  }

  function introSeen() {
    try { return !!save.get(CONFIG.saveKeyIntroSeen, false); } catch (e) { return false; }
  }

  function markIntroSeen() {
    try { save.set(CONFIG.saveKeyIntroSeen, true); } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- objective banner
  function objectiveText(step) {
    if (step >= OBJECTIVE_STEPS.length) return '';
    return OBJECTIVE_STEPS[step].text;
  }

  function setObjective(step) {
    if (step < 0) step = 0;
    if (step > OBJECTIVE_STEPS.length) step = OBJECTIVE_STEPS.length;
    s.objectiveStep = step;
    s.objectiveDone = step >= OBJECTIVE_STEPS.length;
    s.objectiveText = objectiveText(step);
    if (hud) {
      try {
        if (s.objectiveDone) hud.setObjective(null);
        else hud.setObjective(s.objectiveText, step + 1, OBJECTIVE_STEPS.length);
      } catch (e) { /* hud is best-effort */ }
    }
    s.objectiveShown = !s.objectiveDone;
  }

  // Advance the objective only when the state proves the step is done.
  function updateObjective() {
    if (s.objectiveDone) return;
    let step = s.objectiveStep;
    // Step 0: scoop — hopper must hold regolith.
    if (step === 0 && s.hopper > 0) step = 1;
    // Step 1: plant — feedstock must reach the print cost.
    if (step === 1 && s.feedstock >= CONFIG.printer.feedstockCost) step = 2;
    // Step 2: print — a module must exist.
    if (step === 2 && s.modules > 0) step = OBJECTIVE_STEPS.length;
    if (step !== s.objectiveStep) {
      setObjective(step);
      if (step === 1) {
        banner('FEEDSTOCK READY', 1600);
        sfxName(CONFIG.assets.audio.sfx.feedstock);
      } else if (step === 2) {
        banner('PRINTER ARMED', 1600);
        sfxName(CONFIG.assets.audio.sfx.click);
      } else if (s.objectiveDone) {
        banner('FIRST MODULE PRINTED', 1800);
        sfxName(CONFIG.assets.audio.sfx.complete);
      }
    }
  }

  // ---------------------------------------------------------------- camera
  function setupCamera() {
    if (!rover) return;
    try {
      cam.follow(rover.group, {
        offset: CONFIG.camera.offset,
        lookAt: CONFIG.camera.lookAt,
        stiffness: CONFIG.camera.stiffness,
        rotate: true,
        lookAhead: CONFIG.camera.lookAhead || 0,
      });
    } catch (e) { /* camera is best-effort */ }
    try { env.followShadow(rover.group); } catch (e) { /* ignore */ }
    engine._shadowTarget = rover.group;
  }

  function updateCamera(dt) {
    if (!rover) return;
    // Pull-back while the printer is active: extra metres behind the rover.
    const printing = base && base.printer && base.printer.printing && base.printer.printing.active;
    const targetPull = printing ? CONFIG.camera.printPullBack : 0;
    s.printPullBack = damp(s.printPullBack, targetPull, CONFIG.camera.printPullBackStiffness, dt);
    _camOffset.set(
      CONFIG.camera.offset[0],
      CONFIG.camera.offset[1],
      CONFIG.camera.offset[2] + Math.sign(CONFIG.camera.offset[2] || 1) * s.printPullBack,
    );
    try {
      cam.follow(rover.group, {
        offset: [_camOffset.x, _camOffset.y, _camOffset.z],
        lookAt: CONFIG.camera.lookAt,
        stiffness: CONFIG.camera.stiffness,
        rotate: true,
        lookAhead: CONFIG.camera.lookAhead || 0,
      });
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- spawn helpers
  function spawnInitialDeposits() {
    if (!deposits) return;
    const rng = engine.rng;
    const rr = (a, b) => (rng && typeof rng.range === 'function' ? rng.range(a, b) : a + Math.random() * (b - a));
    // First normal deposit ahead of the rover start, at a random bearing within
    // the camera's view (rover forward is world -Z at yaw 0), so it moves every run.
    const startX = CONFIG.rover.startX;
    const startZ = CONFIG.rover.startZ;
    const a0 = rr(-0.55, 0.55);
    const d0 = rr(CONFIG.deposits.firstDepositDist, CONFIG.deposits.firstDepositDist + 7);
    deposits.spawnNormal(startX + Math.sin(a0) * d0, startZ - Math.cos(a0) * d0);
    // Remaining normal deposits around the plant, with a random rotation and jitter.
    const px = CONFIG.plant.position.x;
    const pz = CONFIG.plant.position.z;
    const playR = (world && world.terrain && Number.isFinite(world.terrain.playRadius))
      ? world.terrain.playRadius : 125;
    const spin = rr(0, Math.PI * 2);
    for (let i = 1; i < CONFIG.deposits.normalCount; i++) {
      const a = (i / CONFIG.deposits.normalCount) * Math.PI * 2 + spin + rr(-0.25, 0.25);
      const d = rr(CONFIG.deposits.normalMinDist, CONFIG.deposits.normalMaxDist);
      let x = px + Math.sin(a) * d;
      let z = pz + Math.cos(a) * d;
      const r = Math.hypot(x, z);
      const maxR = playR - CONFIG.deposits.moundRadius - 6;
      if (r > maxR) { x *= maxR / r; z *= maxR / r; }
      deposits.spawnNormal(x, z);
    }
    // Rich deposits in shadow near the crater rim.
    for (let i = 0; i < CONFIG.deposits.richCount; i++) {
      deposits.spawnRich(NaN, NaN);
    }
  }

  // ---------------------------------------------------------------- start
  function resetRun() {
    s.score = 0;
    s.lives = 1;
    s.independence = 0;
    s.timeLeft = CONFIG.runLength;
    s.elapsed = 0;
    s.power = CONFIG.battery.max;
    s.integrity = CONFIG.integrity.max;
    s.hopper = 0;
    s.feedstock = 0;
    s.combo = 1;
    s.comboWindow = 0;
    s.modules = 0;
    s.printing = false;
    s.flare = false;
    s.meteors = 0;
    s.cause = '';
    s.emergencyTimer = -1;
    s.lowPowerWarned = false;
    s.lowPowerTickTimer = 0;
    s.tutorialIndex = 0;
    s.endShown = false;
    s.victoryPending = false;
    s.gameOverPending = false;
    s.resupplyTaken = false;
    s.resupplySpawned = false;
    s.firstScoop = false;
    s.firstFeedstock = false;
    s.firstPrint = false;
    s.firstMeteor = false;
    s.firstFlare = false;
    s.firstResupply = false;
    s.firstLowPower = false;
    s.selectedModule = 'dome';
    s.printPullBack = 0;
    s.shakeTimer = 0;
    s.scoreIndependence = 0;
    s.scoreTime = 0;
    s.objectiveStep = 0;
    s.objectiveDone = false;
    s.objectiveShown = false;
    s.objectiveText = '';
    s.firstScoopTick = false;
    s.firstFeedstockFx = false;

    // Every module reset is guarded: a failure in one (e.g. audio) must never
    // abort the start path or leave the scene stuck on the title screen.
    try { fx.clear(); } catch (e) { /* ignore */ }
    if (effects) { try { effects.reset(); } catch (e) { /* ignore */ } }
    if (world) { try { world.reset(); } catch (e) { /* ignore */ } }
    if (deposits) { try { deposits.reset(); } catch (e) { /* ignore */ } }
    if (rover) { try { rover.reset(); } catch (e) { /* ignore */ } }
    if (base) { try { base.reset(); } catch (e) { /* ignore */ } }
    if (hazards) { try { hazards.reset(); } catch (e) { /* ignore */ } }
    if (hud) { try { hud.reset(); } catch (e) { /* ignore */ } }
    if (sfx) { try { sfx.reset(); } catch (e) { /* audio is best-effort */ } }
    try { spawnInitialDeposits(); } catch (e) { /* ignore */ }
    try { setupCamera(); } catch (e) { /* ignore */ }
    if (hud) { try { hud.show(); } catch (e) { /* ignore */ } }
    try { ui.hideAll(); } catch (e) { /* ignore */ }
    // Objective banner starts on the scoop step.
    setObjective(0);
    // Guidance resets after the world, deposits, base and rover are fresh, so a
    // new run starts with the tutorial again and the beacons re-targeted.
    if (guidance) { try { guidance.start(); } catch (e) { /* ignore */ } }
  }

  function beginRun() {
    // Set the scene first so the transition succeeds even if a later step throws.
    s.scene = 'playing';
    try { resetRun(); } catch (e) { /* reset is best-effort */ }
    emit('start', { level: CONFIG.level });
    if (sfx) { try { sfx.startMusic(); } catch (e) { /* audio is best-effort */ } }
    voice(CONFIG.assets.audio.voice.vo_start);
    banner(CONFIG.title, 1600);
  }

  // Local start helper — defined before updateIdle uses it. Works from any
  // scene and when called directly by the harness.
  function startRun() {
    const firstRun = !s.introPlayed && !introSeen();
    if (firstRun) {
      s.introPlayed = true;
      // Fire-and-forget the intro; it resolves at once in tests.
      try { playIntroIfNeeded().catch(() => { /* ignore */ }); } catch (e) { /* ignore */ }
    }
    beginRun();
  }

  // ---------------------------------------------------------------- end
  function endRun(win, cause) {
    if (s.scene !== 'playing') return;
    s.cause = cause || '';
    computeScore();
    saveBest();
    if (win) {
      s.scene = 'victory';
      s.lives = 1;
      emit('victory', { score: s.score, independence: s.independence });
      voice(CONFIG.assets.audio.voice.vo_win);
    } else {
      s.scene = 'gameover';
      s.lives = 0;
      emit('gameover', { score: s.score, cause: s.cause });
      emit('kill', { cause: s.cause });
      voice(CONFIG.assets.audio.voice.vo_fail);
    }
    if (hud) { try { hud.hide(); } catch (e) { /* ignore */ } }
    if (sfx) { try { sfx.stopMusic(); } catch (e) { /* ignore */ } }
    showEndScreen(win);
  }

  function showEndScreen(win) {
    if (s.endShown) return;
    s.endShown = true;
    const stats = [
      [CONFIG.label.independence, Math.round(s.independence) + '%'],
      [CONFIG.label.modulesBuilt, s.modules + ' / ' + CONFIG.modulesToWin],
      [CONFIG.label.timeLeft, Math.max(0, Math.round(s.timeLeft)) + ' s'],
      [CONFIG.label.score, s.score],
      [CONFIG.label.best, s.best],
    ];
    if (!win) {
      const causeText = s.cause === 'power' ? CONFIG.endCause.power : CONFIG.endCause.integrity;
      stats.unshift([CONFIG.label.cause, causeText]);
    }
    try {
      screens.showEnd({
        win,
        cause: s.cause,
        stats,
        best: s.best,
      });
    } catch (e) {
      // Fallback to the engine's own end screen.
      try {
        ui.endScreen({
          title: win ? 'INDEPENDENCE ACHIEVED' : 'MISSION FAILURE',
          subtitle: win ? CONFIG.logline : (s.cause === 'power' ? CONFIG.endCause.power : CONFIG.endCause.integrity),
          stats,
          prompt: 'Press R to run again',
        });
      } catch (e2) { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------- cutscenes
  async function playIntroIfNeeded() {
    if (s.introPlayed || introSeen()) return;
    s.introPlayed = true;
    try {
      if (screens && screens.playIntro) {
        await screens.playIntro();
      } else if (assets.has(CONFIG.assets.videos.intro)) {
        await ui.playVideo(CONFIG.assets.videos.intro, { skippable: true });
      }
    } catch (e) { /* cutscene is best-effort */ }
    markIntroSeen();
  }

  async function playVictoryCutscene() {
    try {
      if (screens && screens.playVictory) {
        await screens.playVictory();
      } else if (assets.has(CONFIG.assets.videos.victory)) {
        await ui.playVideo(CONFIG.assets.videos.victory, { skippable: true });
      }
    } catch (e) { /* ignore */ }
  }

  async function playGameOverCutscene() {
    try {
      if (screens && screens.playGameOver) {
        await screens.playGameOver();
      } else if (assets.has(CONFIG.assets.videos.game_over)) {
        await ui.playVideo(CONFIG.assets.videos.game_over, { skippable: true });
      }
    } catch (e) { /* ignore */ }
  }

  // ---------------------------------------------------------------- combo
  function resetCombo() {
    s.combo = 1;
    s.comboWindow = 0;
  }

  function bumpCombo() {
    s.combo = clamp(s.combo + 1, 1, CONFIG.combo.max);
    s.comboWindow = CONFIG.combo.window;
  }

  function comboMultiplier() {
    return clamp(1 + CONFIG.combo.feedstockBonusPerStep * (s.combo - 1), 1, CONFIG.combo.max);
  }

  // ---------------------------------------------------------------- tutorial
  function updateTutorial() {
    const stages = CONFIG.tutorialStages;
    while (s.tutorialIndex < stages.length && s.elapsed >= stages[s.tutorialIndex].time) {
      const st = stages[s.tutorialIndex];
      s.tutorialIndex++;
      if (s.elapsed < 30) {
        toast(st.text, { ms: 3000 });
      }
    }
  }

  // ---------------------------------------------------------------- module selection
  function selectModule(index) {
    const types = CONFIG.printer.moduleTypes;
    if (index >= 0 && index < types.length) {
      s.selectedModule = types[index];
      sfxName(CONFIG.assets.audio.sfx.click);
      toast(CONFIG.printer.moduleLabels[s.selectedModule] + ' selected', { ms: 1200 });
    }
  }

  function tryStartPrint() {
    if (!base || !base.printer) return;
    const type = s.selectedModule;
    const ok = base.printer.startPrint(type);
    if (ok) {
      s.printing = true;
      if (!s.firstPrint) {
        s.firstPrint = true;
        voice(CONFIG.assets.audio.voice.vo_print);
      }
      const label = CONFIG.printer.moduleLabels[type] || 'MODULE';
      const bannerText = type === 'dome' ? CONFIG.banner.printingDome
        : type === 'solar' ? CONFIG.banner.printingSolar
          : CONFIG.banner.printingLife;
      banner(bannerText, 2200);
      toast(CONFIG.toast.print, { ms: 2400 });
      emit('print_start', { type });
      if (effects) effects.printIgnite(base.printer.position);
      if (sfx) sfx.sfx(CONFIG.assets.audio.sfx.print);
    } else {
      // Explain why the print did not start. The feedstock hint is owned by the
      // guidance tutorial during the first cycle, so it is not repeated here.
      const printing = base.printer.printing && base.printer.printing.active;
      const pads = base.printer.pads || [];
      let occupied = 0;
      for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].module) occupied++;
      if (printing) toast(CONFIG.toast.printBusy, { ms: 2000 });
      else if (occupied >= pads.length) toast(CONFIG.toast.noPads, { ms: 2000 });
      sfxName(CONFIG.assets.audio.sfx.click);
    }
  }

  // ---------------------------------------------------------------- update: playing
  function updatePlaying(dt) {
    // ---- timer
    s.elapsed += dt;
    s.timeLeft = clamp(CONFIG.runLength - s.elapsed, 0, CONFIG.runLength);

    // ---- sun descent (world.update is the sole driver)
    if (world) world.update(dt);

    // ---- input routing
    if (input.pressed('Digit1')) selectModule(0);
    if (input.pressed('Digit2')) selectModule(1);
    if (input.pressed('Digit3')) selectModule(2);
    if (input.pressed('Enter')) tryStartPrint();

    // ---- rover
    if (rover) rover.update(dt, input, deposits);

    // ---- Space pressed out of scoop reach: say how far the nearest mound is.
    if (rover && deposits && input.pressed('Space') && !rover.scoopInRange
        && s.hopper < CONFIG.scoop.hopperCapacity) {
      try {
        const d = deposits.nearest(rover.position, Infinity);
        if (d && typeof deposits.edgeDistance === 'function') {
          const m = Math.max(1, Math.round(deposits.edgeDistance(d, rover.position) - CONFIG.scoop.range));
          toast('Too far from regolith: drive ' + m + ' m closer to the mound', { ms: 1800 });
        }
      } catch (e) { /* hint is best-effort */ }
    }

    // ---- deposits
    if (deposits) deposits.update(dt);

    // ---- combo window decay
    if (s.comboWindow > 0) {
      s.comboWindow = Math.max(0, s.comboWindow - dt);
      if (s.comboWindow <= 0) resetCombo();
    }

    // ---- boulder hit
    if (rover && rover.consumeBoulderHit()) {
      resetCombo();
      s.integrity = clamp(s.integrity - CONFIG.integrity.boulderHit, 0, CONFIG.integrity.max);
      if (effects) effects.boulderHit(rover.position);
      toast(CONFIG.toast.boulder, { ms: 1800, color: CONFIG.colors.warning });
      emit('hit', { source: 'boulder' });
    }

    // ---- clean scoop cycle
    if (rover && rover.consumeCleanCycle()) {
      bumpCombo();
      if (!s.firstScoop) {
        s.firstScoop = true;
        voice(CONFIG.assets.audio.voice.vo_scoop);
        toast(CONFIG.toast.scoop, { ms: 2400 });
      }
    }

    // ---- scoop feedback (dust + floating kg) while actively scooping
    if (rover && rover.isScooping()) {
      if (effects) effects.scoopDust(rover.position);
      if (!s.firstScoopTick) {
        // First scoop tick: bigger plume, a '+70 kg' float and the scoop voice.
        s.firstScoopTick = true;
        if (effects) {
          try { effects.scoopDust(rover.position); } catch (e) { /* ignore */ }
          try { effects.floatKg(rover.position, CONFIG.scoop.rate); } catch (e) { /* ignore */ }
        }
        try { cam.shake(0.25, 0.2); } catch (e) { /* ignore */ }
        sfxName(CONFIG.assets.audio.sfx.scoop);
        voice(CONFIG.assets.audio.voice.vo_scoop);
        emit('scoop', { kg: CONFIG.scoop.rate });
      }
      if (!s.firstScoop) {
        s.firstScoop = true;
        voice(CONFIG.assets.audio.voice.vo_scoop);
        toast(CONFIG.toast.scoop, { ms: 2400 });
      }
    }

    // ---- boost feedback
    if (rover && rover.isBoosting()) {
      _dir.set(-Math.sin(rover.group.rotation.y), 0, -Math.cos(rover.group.rotation.y));
      if (effects) effects.boostTrail(rover.position, _dir);
    }

    // ---- base (dump, print, resupply)
    let baseResult = { completedModule: null, resupply: null };
    if (base) {
      baseResult = base.update(dt, rover) || baseResult;
    }

    // ---- dump feedback
    if (base && base.plant && base.plant.dumping) {
      if (effects) effects.dumpGlow(base.plant.position);
    }

    // ---- feedstock produced
    if (baseResult && baseResult.feedstockProduced > 0) {
      if (effects) effects.floatFeedstock(base.plant.position, baseResult.feedstockProduced);
      emit('feedstock', { kg: baseResult.feedstockProduced });
      if (!s.firstFeedstock) {
        s.firstFeedstock = true;
        voice(CONFIG.assets.audio.voice.vo_feedstock);
        toast(CONFIG.toast.plant, { ms: 2400 });
      }
      if (!s.firstFeedstockFx) {
        // First feedstock: amber kiln flash so the reward reads instantly.
        s.firstFeedstockFx = true;
        if (effects) {
          try { effects.printIgnite(base.plant.position); } catch (e) { /* ignore */ }
        }
        try { fx.flashLight(base.plant.position, { color: 0xd97a2b, intensity: 60, distance: 14, duration: 0.5 }); } catch (e) { /* ignore */ }
        try { ui.flash('#d97a2b', 220, 0.35); } catch (e) { /* ignore */ }
        voice(CONFIG.assets.audio.voice.vo_feedstock);
        emit('feedstock', { kg: baseResult.feedstockProduced, first: true });
      }
      sfxName(CONFIG.assets.audio.sfx.feedstock);
    }

    // ---- module complete
    if (baseResult && baseResult.completedModule) {
      s.modules = base.modules ? base.modules.length : s.modules + 1;
      s.independence = base.getIndependence ? base.getIndependence() : s.independence;
      if (effects) effects.moduleCompleteFlash(base.printer.position);
      if (effects) effects.floatIndependence(base.printer.position, CONFIG.independencePerModule);
      if (world) {
        world.dimEarth(s.independence);
        world.shortenTether(s.independence);
      }
      banner(CONFIG.banner.moduleComplete, 2200);
      voice(CONFIG.assets.audio.voice.vo_module_complete);
      emit('module_complete', { type: baseResult.completedModule, independence: s.independence });
      emit('levelup', { independence: s.independence, modules: s.modules });
      if (baseResult.completedModule === 'dome' && rover) {
        rover.heal(CONFIG.integrity.domeBonus);
      }
      s.printing = false;
    }

    // ---- resupply spawn
    if (base && base.resupplyCrate && !s.resupplySpawned) {
      s.resupplySpawned = true;
      banner(CONFIG.banner.resupply, 2200);
      if (!s.firstResupply) {
        s.firstResupply = true;
        voice(CONFIG.assets.audio.voice.vo_resupply);
      }
      emit('resupply', { spawned: true });
      if (effects) effects.landerWhoosh(base.resupplyCrate.position);
      sfxName(CONFIG.assets.audio.sfx.lander);
    }

    // ---- resupply pickup
    if (baseResult && baseResult.resupply) {
      s.resupplyTaken = true;
      s.power = clamp(s.power + baseResult.resupply.power, 0, CONFIG.battery.max);
      if (rover) rover.recharge(baseResult.resupply.power);
      s.independence = clamp(s.independence - baseResult.resupply.independenceCost, 0, 100);
      if (base && base.subIndependence) base.subIndependence(baseResult.resupply.independenceCost);
      if (world) {
        world.dimEarth(s.independence);
        world.shortenTether(s.independence);
      }
      toast(CONFIG.toast.resupply, { ms: 2600, color: CONFIG.colors.warning });
      sfxName(CONFIG.assets.audio.sfx.resupply);
      emit('pickup', { source: 'resupply', power: baseResult.resupply.power, feedstock: baseResult.resupply.feedstock });
    }

    // ---- hazards
    let hazardResult = null;
    if (hazards) {
      hazardResult = hazards.update(dt, rover ? rover.position : _tmp, s.elapsed);
    }

    // ---- meteor shower start
    if (hazardResult && hazardResult.showerStarted) {
      banner(CONFIG.banner.meteor, 1800);
      if (!s.firstMeteor) {
        s.firstMeteor = true;
        voice(CONFIG.assets.audio.voice.vo_meteor);
      }
      emit('meteor', { shower: true });
      sfxName(CONFIG.assets.audio.sfx.alarm);
    }

    // ---- meteor impacts
    if (hazardResult && hazardResult.impacts && hazardResult.impacts.length > 0) {
      for (let i = 0; i < hazardResult.impacts.length; i++) {
        const imp = hazardResult.impacts[i];
        if (!imp) continue;
        _tmp.set(imp.x, world ? world.terrain.heightAt(imp.x, imp.z) : 0, imp.z);
        if (effects) effects.meteorImpact(_tmp);
        if (world) world.terrain.addCrater(imp.x, imp.z, CONFIG.world.craterScarRadius);
      }
    }

    // ---- meteor damage
    if (hazardResult && hazardResult.meteorDamage > 0) {
      s.integrity = clamp(s.integrity - hazardResult.meteorDamage, 0, CONFIG.integrity.max);
      if (rover) rover.registerDamage();
      resetCombo();
      toast(CONFIG.toast.meteor, { ms: 1800, color: CONFIG.colors.warning });
      emit('hit', { source: 'meteor', amount: hazardResult.meteorDamage });
    }

    // ---- flare start
    if (hazardResult && hazardResult.flareStarted) {
      s.flare = true;
      banner(CONFIG.banner.flare, 2600);
      voice(CONFIG.assets.audio.voice.vo_flare);
      emit('flare', { active: true });
      if (effects) effects.flareFlash();
      sfxName(CONFIG.assets.audio.sfx.alarm);
      if (!s.firstFlare) s.firstFlare = true;
    }

    // ---- flare exposure
    s.flare = !!(hazards && hazards.flare && hazards.flare.active);
    if (s.flare && rover) {
      const sheltered = base && base.domeShelter ? base.domeShelter(rover.position) : false;
      let factor = 1;
      if (sheltered) {
        factor = 0;
      } else {
        const shadowed = world ? world.isInShadow(rover.position) : false;
        if (shadowed) factor = CONFIG.hazards.flareShadowFactor;
      }
      if (factor > 0) {
        const powerDrain = CONFIG.hazards.flarePowerDrain * factor * dt;
        const integrityDrain = CONFIG.hazards.flareIntegrityDrain * factor * dt;
        rover.drain(powerDrain);
        s.integrity = clamp(s.integrity - integrityDrain, 0, CONFIG.integrity.max);
        if (integrityDrain > 0) rover.registerDamage();
      }
    }

    // ---- battery / recharge
    if (rover) {
      s.power = rover.battery;
      const shadowed = world ? world.isInShadow(rover.position) : false;
      const solar = base && base.solarCount ? base.solarCount() : 0;
      let recharge = 0;
      if (!shadowed) recharge += CONFIG.battery.rechargeSun;
      recharge += solar * CONFIG.battery.rechargeSolarModule;
      if (recharge > 0) rover.recharge(recharge * dt);
      s.power = rover.battery;
      s.integrity = rover.integrity;
      s.hopper = rover.hopper;
    }
    if (base && base.plant) s.feedstock = base.plant.feedstock;
    if (base) s.independence = base.getIndependence ? base.getIndependence() : s.independence;
    s.printing = !!(base && base.printer && base.printer.printing && base.printer.printing.active);
    s.meteors = hazards && hazards.meteors ? hazards.meteors.length : 0;

    // ---- objective banner (state-gated, not timer-gated)
    updateObjective();

    // ---- guidance (after rover/base updates so hopper/feedstock/module state is current)
    if (guidance) { try { guidance.update(dt); } catch (e) { /* guidance is best-effort */ } }

    // ---- emergency reserve
    if (s.power <= 0) {
      if (s.emergencyTimer < 0) s.emergencyTimer = CONFIG.battery.emergencyReserve;
      else s.emergencyTimer = Math.max(0, s.emergencyTimer - dt);
    } else {
      s.emergencyTimer = -1;
    }

    // ---- low power warning
    if (s.power < CONFIG.battery.lowPowerThreshold) {
      if (!s.lowPowerWarned) {
        s.lowPowerWarned = true;
        voice(CONFIG.assets.audio.voice.vo_lowpower);
        banner(CONFIG.banner.lowPower, 1800);
        toast(CONFIG.toast.lowPower, { ms: 2200, color: CONFIG.colors.warning });
      }
      s.lowPowerTickTimer -= dt;
      if (s.lowPowerTickTimer <= 0) {
        s.lowPowerTickTimer = CONFIG.battery.lowPowerTickInterval;
        if (sfx) sfx.tick();
      }
    } else {
      s.lowPowerWarned = false;
      s.lowPowerTickTimer = 0;
    }

    // ---- timer tick below 30 s
    if (s.timeLeft < 30 && s.timeLeft > 0) {
      s.lowPowerTickTimer -= dt;
      if (s.lowPowerTickTimer <= 0) {
        s.lowPowerTickTimer = 1.0;
        if (sfx) sfx.tick();
      }
    }

    // ---- tutorial
    updateTutorial();

    // ---- camera
    updateCamera(dt);

    // ---- effects tick (flare overlay fade, boost emitter stop)
    if (effects && effects.update) effects.update(dt);

    // ---- HUD
    if (hud) {
      hud.update({
        independence: s.independence,
        timeLeft: s.timeLeft,
        power: s.power,
        integrity: s.integrity,
        hopper: s.hopper,
        feedstock: s.feedstock,
        scoopInRange: !!(rover && rover.scoopInRange),
        combo: s.combo,
        selectedModule: s.selectedModule,
        printing: s.printing,
        flare: s.flare,
        score: s.score,
      });
    }

    // ---- win / lose
    if (s.independence >= 100) {
      endRun(true, 'independence');
      return;
    }
    if (s.integrity <= 0) {
      endRun(false, 'integrity');
      return;
    }
    if (s.emergencyTimer === 0) {
      endRun(false, 'power');
      return;
    }
    if (s.timeLeft <= 0) {
      endRun(false, 'integrity');
      return;
    }
  }

  // ---------------------------------------------------------------- update: not playing
  function updateIdle(dt) {
    // Keep the world alive on the title screen: sun descent and deposits sparkle.
    if (world) world.update(dt);
    if (deposits) deposits.update(dt);
    if (effects && effects.update) effects.update(dt);
    if (s.scene === 'title' || s.scene === 'gameover' || s.scene === 'victory') {
      if (input.pressed('Enter')) {
        startRun();
      } else if (input.pressed('KeyR')) {
        startRun();
      }
    }
  }

  // ---------------------------------------------------------------- public API
  return {
    async init() {
      // Sky first, before any material is created.
      world = createWorld(engine, CONFIG);
      scene.add(world.group);

      deposits = createDeposits(engine, world, CONFIG);
      scene.add(deposits.group);

      rover = createRover(engine, world, CONFIG);
      effects = createEffects(engine, CONFIG);

      base = createBase(engine, world, CONFIG);
      scene.add(base.group);

      hazards = createHazards(engine, world, CONFIG);
      scene.add(hazards.group);

      hud = createHud(engine, CONFIG);
      sfx = createAudio(engine, CONFIG);
      screens = createScreens(engine, CONFIG);

      // Guidance needs the world, deposits, base and rover to exist first.
      guidance = createGuidance(engine, CONFIG, world, deposits, base, rover);
      try { guidance.init(); } catch (e) { /* guidance is best-effort */ }
      // guidance.init adds its group to the scene; make sure it is present.
      if (guidance && guidance.group) {
        try {
          if (!guidance.group.parent) scene.add(guidance.group);
        } catch (e) { /* ignore */ }
      }

      loadBest();
      spawnInitialDeposits();
      setupCamera();

      // Title screen.
      try {
        if (screens && screens.showTitle) {
          screens.showTitle(s.best);
        } else {
          ui.titleScreen({
            title: CONFIG.title,
            subtitle: CONFIG.logline,
            image: CONFIG.assets.screens.keyArt,
            prompt: 'Press Enter to take the conn',
            controls: true,
          });
        }
      } catch (e) {
        try {
          ui.titleScreen({ image: CONFIG.assets.screens.keyArt });
        } catch (e2) { /* ignore */ }
      }
      if (hud) { try { hud.hide(); } catch (e) { /* ignore */ } }
      if (sfx) { try { sfx.startMusic(); } catch (e) { /* audio is best-effort */ } }
      s.scene = 'title';
    },

    start() {
      // Works from any scene and when called directly.
      startRun();
    },

    update(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      // Engine pause freezes simulation but keeps scene 'playing'.
      if (engine.paused) return;

      if (s.scene === 'playing') {
        updatePlaying(dt);
      } else {
        updateIdle(dt);
      }
    },

    render(dt) {
      // Purely visual smoothing: keep the camera following the rover.
      if (s.scene === 'playing' && rover) {
        updateCamera(Number.isFinite(dt) && dt > 0 ? dt : 1 / 60);
      }
    },

    getState() {
      const p = rover ? rover.position : _tmp.set(0, 0, 0);
      const state = {
        scene: s.scene,
        score: Math.max(0, Math.round(safeNum(s.score, 0))),
        level: CONFIG.level,
        lives: s.scene === 'playing' ? 1 : 0,
        player: {
          x: safeNum(p.x, 0),
          y: safeNum(p.y, 0),
          z: safeNum(p.z, 0),
        },
        independence: clamp(safeNum(s.independence, 0), 0, 100),
        timeLeft: clamp(safeNum(s.timeLeft, CONFIG.runLength), 0, CONFIG.runLength),
        power: clamp(safeNum(s.power, CONFIG.battery.max), 0, CONFIG.battery.max),
        integrity: clamp(safeNum(s.integrity, CONFIG.integrity.max), 0, CONFIG.integrity.max),
        hopper: clamp(safeNum(s.hopper, 0), 0, CONFIG.scoop.hopperCapacity),
        feedstock: clamp(safeNum(s.feedstock, 0), 0, CONFIG.plant.capacity),
        combo: clamp(safeNum(s.combo, 1), 1, CONFIG.combo.max),
        modules: clamp(Math.round(safeNum(s.modules, 0)), 0, CONFIG.modulesToWin),
        printing: !!s.printing,
        flare: !!s.flare,
        meteors: Math.max(0, Math.round(safeNum(s.meteors, 0))),
        best: Math.max(0, Math.round(safeNum(s.best, 0))),
        objectiveStep: clamp(Math.round(safeNum(s.objectiveStep, 0)), 0, OBJECTIVE_STEPS.length),
        objectiveText: s.objectiveText || '',
        objective: '',
        objectiveDistance: 0,
      };
      // Merge guidance state (objective string, objectiveDistance metres).
      if (guidance) {
        try {
          const g = guidance.getState();
          if (g && typeof g === 'object') {
            if (typeof g.objective === 'string') state.objective = g.objective;
            state.objectiveDistance = Number.isFinite(g.objectiveDistance)
              ? Math.max(0, g.objectiveDistance)
              : 0;
          }
        } catch (e) { /* guidance is best-effort */ }
      }
      return state;
    },
  };
}
