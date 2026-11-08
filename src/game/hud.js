// Regolith — HUD layout and updates.
// Owns every HUD key, label, banner and toast. Uses only engine.ui.
// The top-centre objective line ("Next: ...") is owned by guidance.js, not here.

import { CONFIG } from './config.js';

const MODULE_LABELS = {
  dome: '1 DOME',
  solar: '2 SOLAR',
  'life-support': '3 LIFE SUPPORT',
  life: '3 LIFE SUPPORT',
};

const BAR_COLORS = {
  power: CONFIG.colors.accent,
  integrity: CONFIG.colors.earth,
  hopper: CONFIG.colors.amber,
  feedstock: CONFIG.colors.accent,
  independence: CONFIG.colors.accent,
};

// Objective steps, in order. Each step is gated on real game state by game.js;
// the HUD only renders the text and the step counter.
const OBJECTIVE_STEPS = [
  'HOLD SPACE TO SCOOP',
  'HAUL TO THE SINTERING PLANT',
  'PRESS ENTER TO PRINT A DOME',
  'SHELTER IN THE DOME',
];

// Text shown when the rover is right on top of the first deposit.
const SCOOP_ASSIST_TEXT = 'STOP AND HOLD SPACE TO SCOOP';
const SCOOP_ASSIST_RADIUS = 6;          // m from the first deposit centre
const SCOOP_ASSIST_PULSE_HZ = 2.2;      // banner pulse rate

const TOAST_MAX_SIMULTANEOUS = 2;
const TOAST_DEFAULT_MS = 3000;
const TOAST_MIN_MS = 600;
const TOAST_QUEUE_MAX = 2;
const MODULE_TOAST_MS = 2000;          // transient module-selection line

function finite(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function clamp01(v) {
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function distXZ(ax, az, bx, bz) {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function createHud(engine, CONFIG) {
  const ui = engine.ui;
  const hud = ui.hud;

  const state = {
    shown: false,
    lowPower: false,
    lowPowerTimer: 0,
    lastCombo: 1,
    lastIndependence: 0,
    lastHopper: 0,
    lastFeedstock: 0,
    lastTimer: -1,
    lastPower: -1,
    lastIntegrity: -1,
    lastModule: '',
    lastComboText: '',
    lastIndependenceText: '',
    lastTimerText: '',
    lastHopperText: '',
    lastFeedstockText: '',
    lastPowerText: '',
    lastIntegrityText: '',
    // objective banner (left/right side strip; never top-centre)
    objectiveIndex: -1,
    objectiveText: '',
    objectiveDone: false,
    objectivePulse: 0,
    objectivePulseOn: false,
    // toast queue
    activeToasts: [],
    toastQueue: [],
  };

  // ---------------------------------------------------------------- layout
  function layout() {
    hud.set('independence', '0%', { label: CONFIG.label.independence, side: 'left' });
    hud.set('timer', 'T−240', { label: '', side: 'center' });
    hud.set('combo', '×1', { label: CONFIG.label.combo, side: 'right' });
    hud.set('module', '1 DOME', { label: CONFIG.label.module, side: 'right' });

    hud.bar('power', 1, { label: CONFIG.label.power, color: BAR_COLORS.power, side: 'left' });
    hud.bar('integrity', 1, { label: CONFIG.label.integrity, color: BAR_COLORS.integrity, side: 'left' });
    hud.bar('hopper', 0, { label: CONFIG.label.hopper, color: BAR_COLORS.hopper, side: 'center' });
    hud.bar('feedstock', 0, { label: CONFIG.label.feedstock, color: BAR_COLORS.feedstock, side: 'center' });

    // Objective strip: created lazily by setObjectiveText when an objective is active.
    state.objectiveIndex = -1;
    state.objectiveText = '';
    state.objectiveDone = false;
    state.objectivePulse = 0;
    state.objectivePulseOn = false;
  }

  // ---------------------------------------------------------------- show / hide
  function show() {
    if (!state.shown) {
      layout();
      state.shown = true;
    }
    hud.show(true);
  }

  function hide() {
    hud.show(false);
  }

  // ---------------------------------------------------------------- objective
  // Single source of truth: objectiveText is computed each frame from state.
  // step: 0-based index into OBJECTIVE_STEPS, or -1 to hide the strip.
  // Rendered on the left side so it never overlaps the top-centre guidance line.
  function setObjectiveText(step, text, done, pulse) {
    const idx = Number.isFinite(step) ? Math.floor(step) : -1;
    if (idx < 0 || typeof text !== 'string' || text.length === 0) {
      if (state.objectiveIndex !== -1 || state.objectiveText !== '') {
        hud.remove('objective');
        state.objectiveIndex = -1;
        state.objectiveText = '';
        state.objectiveDone = false;
        state.objectivePulse = 0;
        state.objectivePulseOn = false;
      }
      return;
    }
    const clamped = Math.max(0, Math.min(OBJECTIVE_STEPS.length - 1, idx));
    const counter = 'STEP ' + (clamped + 1) + '/' + OBJECTIVE_STEPS.length;
    const full = counter + '  ·  ' + text + (done ? '  ✓' : '');
    if (full !== state.objectiveText) {
      hud.set('objective', full, { label: 'OBJECTIVE', side: 'left' });
      state.objectiveText = full;
      state.objectiveIndex = clamped;
    }
    state.objectiveDone = !!done;
    state.objectivePulse = pulse ? Math.max(0, finite(pulse, 0)) : 0;
  }

  // step: 0-based index into OBJECTIVE_STEPS, or -1 to hide the strip.
  function setObjective(step) {
    const idx = Number.isFinite(step) ? Math.floor(step) : -1;
    if (idx < 0) {
      setObjectiveText(-1, '', false, 0);
      return;
    }
    const clamped = Math.max(0, Math.min(OBJECTIVE_STEPS.length - 1, idx));
    setObjectiveText(clamped, OBJECTIVE_STEPS[clamped], state.objectiveDone, 0);
  }

  function objectiveComplete() {
    state.objectiveDone = true;
    if (state.objectiveIndex >= 0) {
      const clamped = Math.max(0, Math.min(OBJECTIVE_STEPS.length - 1, state.objectiveIndex));
      setObjectiveText(clamped, OBJECTIVE_STEPS[clamped], true, 0);
    }
  }

  // Pulse the objective banner when the rover is close to the first deposit.
  function updateObjectivePulse(dt) {
    if (state.objectivePulse <= 0) {
      if (state.objectivePulseOn) {
        state.objectivePulseOn = false;
        if (state.objectiveText !== '') {
          hud.set('objective', state.objectiveText, { label: 'OBJECTIVE', side: 'left' });
        }
      }
      return;
    }
    state.objectivePulse -= dt;
    const phase = Math.sin(state.objectivePulse * Math.PI * 2 * SCOOP_ASSIST_PULSE_HZ) > 0;
    if (phase !== state.objectivePulseOn) {
      state.objectivePulseOn = phase;
      if (state.objectiveText !== '') {
        hud.set('objective', phase ? '▶ ' + state.objectiveText + ' ◀' : state.objectiveText, {
          label: 'OBJECTIVE',
          side: 'left',
        });
      }
    }
  }

  // ---------------------------------------------------------------- update
  function update(s) {
    if (!s || typeof s !== 'object') return;
    if (!state.shown) show();

    const dt = engine.time && Number.isFinite(engine.time.dt) ? engine.time.dt : 1 / 60;

    const independence = Math.max(0, Math.min(100, finite(s.independence, 0)));
    const timeLeft = Math.max(0, finite(s.timeLeft, CONFIG.runLength));
    const power = Math.max(0, Math.min(100, finite(s.power, 100)));
    const integrity = Math.max(0, Math.min(100, finite(s.integrity, 100)));
    const hopperCap = Math.max(1, finite(s.hopperCapacity, CONFIG.scoop.hopperCapacity));
    const hopper = Math.max(0, Math.min(hopperCap, finite(s.hopper, 0)));
    const feedstock = Math.max(0, Math.min(CONFIG.plant.capacity, finite(s.feedstock, 0)));
    const combo = Math.max(1, Math.min(CONFIG.combo.max, Math.round(finite(s.combo, 1))));
    const selected = typeof s.selectedModule === 'string' ? s.selectedModule : 'dome';
    const lowPower = !!s.lowPower || power < CONFIG.battery.lowPowerThreshold;

    // Objective strip: game.js supplies the gated step index; the HUD derives
    // the text from it and from live state (scoop → haul → print → shelter).
    let objectiveStep = typeof s.objectiveStep === 'number' && Number.isFinite(s.objectiveStep)
      ? Math.floor(s.objectiveStep)
      : s.objectiveStep === null ? -1 : state.objectiveIndex;
    let objectiveText = '';
    let pulse = 0;
    if (objectiveStep >= 0) {
      const clamped = Math.max(0, Math.min(OBJECTIVE_STEPS.length - 1, objectiveStep));
      objectiveText = OBJECTIVE_STEPS[clamped];
      // First scoop: swap to the assist line when the rover is on the deposit.
      if (clamped === 0) {
        const px = s.player && Number.isFinite(s.player.x) ? s.player.x : NaN;
        const pz = s.player && Number.isFinite(s.player.z) ? s.player.z : NaN;
        const dx = s.firstDeposit && Number.isFinite(s.firstDeposit.x) ? s.firstDeposit.x : NaN;
        const dz = s.firstDeposit && Number.isFinite(s.firstDeposit.z) ? s.firstDeposit.z : NaN;
        if (Number.isFinite(px) && Number.isFinite(pz) && Number.isFinite(dx) && Number.isFinite(dz)) {
          if (distXZ(px, pz, dx, dz) <= SCOOP_ASSIST_RADIUS) {
            objectiveText = SCOOP_ASSIST_TEXT;
            pulse = 1;
          }
        }
        // Hopper filled: advance to the haul step immediately.
        if (hopper > 0) {
          objectiveStep = 1;
          objectiveText = OBJECTIVE_STEPS[1];
          pulse = 0;
        }
      }
    }
    const done = s.objectiveDone === true;
    setObjectiveText(objectiveStep, objectiveText, done, pulse);
    updateObjectivePulse(dt);

    // Independence (top-left)
    const indepText = Math.round(independence) + '%';
    if (indepText !== state.lastIndependenceText) {
      hud.set('independence', indepText, { label: CONFIG.label.independence, side: 'left' });
      state.lastIndependenceText = indepText;
    }
    if (independence > state.lastIndependence) {
      // brief accent flash on the independence readout
      hud.set('independence', indepText, { label: CONFIG.label.independence, side: 'left' });
    }
    state.lastIndependence = independence;

    // Timer (top-centre)
    const timerText = CONFIG.label.timer + Math.ceil(timeLeft);
    if (timerText !== state.lastTimerText) {
      hud.set('timer', timerText, { label: '', side: 'center' });
      state.lastTimerText = timerText;
    }
    state.lastTimer = timeLeft;

    // Combo (top-right)
    const comboText = '×' + combo;
    if (comboText !== state.lastComboText) {
      hud.set('combo', comboText, { label: CONFIG.label.combo, side: 'right' });
      state.lastComboText = comboText;
    }
    state.lastCombo = combo;

    // Selected module (bottom-right): transient line, not a permanent label.
    const moduleText = MODULE_LABELS[selected] || MODULE_LABELS.dome;
    if (moduleText !== state.lastModule) {
      hud.set('module', moduleText, { label: CONFIG.label.module, side: 'right' });
      state.lastModule = moduleText;
      toast('MODULE ' + moduleText, { ms: MODULE_TOAST_MS, color: CONFIG.colors.accent });
    }

    // Power / integrity bars (bottom-left)
    const powerText = Math.round(power) + '';
    if (powerText !== state.lastPowerText) {
      hud.bar('power', clamp01(power / 100), {
        label: CONFIG.label.power,
        color: lowPower ? CONFIG.colors.warning : BAR_COLORS.power,
        side: 'left',
      });
      state.lastPowerText = powerText;
    }
    state.lastPower = power;

    const integrityText = Math.round(integrity) + '';
    if (integrityText !== state.lastIntegrityText) {
      hud.bar('integrity', clamp01(integrity / 100), {
        label: CONFIG.label.integrity,
        color: integrity < 30 ? CONFIG.colors.warning : BAR_COLORS.integrity,
        side: 'left',
      });
      state.lastIntegrityText = integrityText;
    }
    state.lastIntegrity = integrity;

    // Hopper (bottom-centre)
    const hopperText = Math.round(hopper) + '/' + Math.round(hopperCap) + ' kg';
    if (hopperText !== state.lastHopperText) {
      hud.bar('hopper', clamp01(hopper / hopperCap), {
        label: CONFIG.label.hopper + ' ' + hopperText,
        color: BAR_COLORS.hopper,
        side: 'center',
      });
      state.lastHopperText = hopperText;
    }
    state.lastHopper = hopper;

    // Feedstock (bottom-centre)
    const feedstockText = Math.round(feedstock) + ' kg';
    if (feedstockText !== state.lastFeedstockText) {
      hud.bar('feedstock', clamp01(feedstock / CONFIG.plant.capacity), {
        label: CONFIG.label.feedstock + ' ' + feedstockText,
        color: feedstock >= CONFIG.printer.feedstockCost ? BAR_COLORS.feedstock : CONFIG.colors.dust,
        side: 'center',
      });
      state.lastFeedstockText = feedstockText;
    }
    state.lastFeedstock = feedstock;

    // Low-power pulse: tick sound and red warning at a fixed cadence.
    if (lowPower) {
      state.lowPowerTimer += dt;
      if (state.lowPowerTimer >= CONFIG.battery.lowPowerTickInterval) {
        state.lowPowerTimer = 0;
        engine.audio.sfx(CONFIG.assets.audio.sfx.tick);
        hud.set('power', powerText, { label: CONFIG.label.power, side: 'left' });
      }
    } else {
      state.lowPowerTimer = 0;
    }
    state.lowPower = lowPower;

    // Toast queue: at most two simultaneous, each auto-dismissed after its ms.
    updateToasts(dt);
  }

  // ---------------------------------------------------------------- banner / toast
  function banner(text, ms) {
    if (typeof text !== 'string' || text.length === 0) return;
    const duration = Number.isFinite(ms) ? Math.max(400, ms) : 2200;
    ui.banner(text, duration);
  }

  function updateToasts(dt) {
    const step = Number.isFinite(dt) ? dt : 1 / 60;
    // age active toasts
    for (let i = state.activeToasts.length - 1; i >= 0; i--) {
      const t = state.activeToasts[i];
      t.left -= step;
      if (t.left <= 0) {
        state.activeToasts.splice(i, 1);
      }
    }
    // promote queued toasts into free slots
    while (state.activeToasts.length < TOAST_MAX_SIMULTANEOUS && state.toastQueue.length > 0) {
      const next = state.toastQueue.shift();
      state.activeToasts.push(next);
      ui.toast(next.text, { ms: next.ms, color: next.color });
    }
  }

  function toast(text, opts) {
    if (typeof text !== 'string' || text.length === 0) return;
    const o = opts && typeof opts === 'object' ? opts : {};
    const ms = Number.isFinite(o.ms) ? Math.max(TOAST_MIN_MS, o.ms) : TOAST_DEFAULT_MS;
    const color = typeof o.color === 'string' ? o.color : CONFIG.colors.accent;
    const entry = { text, ms, color, left: ms / 1000 };
    if (state.activeToasts.length < TOAST_MAX_SIMULTANEOUS) {
      state.activeToasts.push(entry);
      ui.toast(text, { ms, color });
      return;
    }
    // FIFO replacement: drop the oldest visible entry so nothing stacks up.
    if (state.activeToasts.length > 0) {
      state.activeToasts.shift();
    }
    state.activeToasts.push(entry);
    ui.toast(text, { ms, color });
    // keep the queue bounded
    while (state.toastQueue.length > TOAST_QUEUE_MAX) {
      state.toastQueue.shift();
    }
  }

  // ---------------------------------------------------------------- reset
  function reset() {
    state.lowPower = false;
    state.lowPowerTimer = 0;
    state.lastCombo = 1;
    state.lastIndependence = 0;
    state.lastHopper = 0;
    state.lastFeedstock = 0;
    state.lastTimer = -1;
    state.lastPower = -1;
    state.lastIntegrity = -1;
    state.lastModule = '';
    state.lastComboText = '';
    state.lastIndependenceText = '';
    state.lastTimerText = '';
    state.lastHopperText = '';
    state.lastFeedstockText = '';
    state.lastPowerText = '';
    state.lastIntegrityText = '';
    state.objectiveIndex = -1;
    state.objectiveText = '';
    state.objectiveDone = false;
    state.objectivePulse = 0;
    state.objectivePulseOn = false;
    state.activeToasts.length = 0;
    state.toastQueue.length = 0;
    // The top-centre slot belongs to the timer; guidance.js owns the 'Next:' line.
    hud.remove('objective');
    hud.clear();
    state.shown = false;
  }

  return { show, hide, update, banner, toast, reset, setObjective, objectiveComplete };
}
