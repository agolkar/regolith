// Regolith — title screen, end screens and cutscene playback with key-art fallbacks.
// Owns: title card (key art, logline, controls, best score, prompt), win/lose end
// screens with score breakdown, intro/victory/game-over cutscenes, theme accent.

import { CONFIG } from './config.js';

const TITLE_IMAGE = CONFIG.assets.screens.keyArt;
const VIDEO_INTRO = CONFIG.assets.videos.intro;
const VIDEO_VICTORY = CONFIG.assets.videos.victory;
const VIDEO_GAME_OVER = CONFIG.assets.videos.game_over;
const VO_START = CONFIG.assets.audio.voice.vo_start;
const VO_WIN = CONFIG.assets.audio.voice.vo_win;
const VO_FAIL = CONFIG.assets.audio.voice.vo_fail;

const FALLBACK_MS = 5000;          // how long a key-art still stands in for a video
const PROMPT_START = 'Press Enter to take the conn';
const PROMPT_RESTART = 'Press R to run again';
const PROMPT_END = 'Press Enter to run again';

// Controls card, six lines, matching meta.json order.
const CONTROL_LINES = [
  ['Drive', 'W A S D / arrows'],
  ['Boost', 'Shift'],
  ['Scoop', 'Space'],
  ['Print module', 'Enter'],
  ['Select module', '1 dome / 2 solar / 3 life support'],
  ['Restart', 'R'],
];

function formatBest(best) {
  const n = Number(best);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return String(Math.round(n));
}

function formatNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return String(Math.round(v));
}

function controlsBody() {
  const lines = CONTROL_LINES.map(([action, keys]) => `${action}: ${keys}`);
  return lines.join('\n');
}

export function createScreens(engine, CONFIG) {
  const { ui, audio, assets } = engine;

  // Theme: warm amber accent on the black lunar sky.
  ui.setTheme({ accent: CONFIG.colors.accent, font: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' });

  let fallbackTimer = 0;            // ms remaining for a key-art fallback screen
  let fallbackActive = false;
  let fallbackName = null;          // which screen the fallback is showing
  let pendingResolve = null;        // resolver for the cutscene promise
  let pendingVoice = null;          // voice id to play when the fallback appears

  function clearFallback() {
    fallbackActive = false;
    fallbackTimer = 0;
    fallbackName = null;
    pendingVoice = null;
    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve();
    }
  }

  // Show a key-art still as a stand-in for a missing video, with its voice line.
  function showFallback(name, title, subtitle, voiceId) {
    fallbackActive = true;
    fallbackName = name;
    fallbackTimer = FALLBACK_MS;
    pendingVoice = voiceId;
    ui.screen(name, {
      title,
      subtitle,
      image: TITLE_IMAGE,
      body: '',
      prompt: '',
    });
    if (voiceId) {
      try { audio.voice(voiceId); } catch (e) { /* voice optional */ }
    }
  }

  // Generic cutscene runner: try the video, fall back to the key-art still.
  function playCutscene(videoId, fallbackName, title, subtitle, voiceId) {
    // In tests videos resolve at once; still guard against a missing id.
    const hasVideo = assets.has(videoId);
    if (!hasVideo) {
      showFallback(fallbackName, title, subtitle, voiceId);
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      ui.hide(fallbackName);
      if (pendingResolve) {
        const resolve = pendingResolve;
        pendingResolve = null;
        resolve();
      }
    };
    return ui.playVideo(videoId, { skippable: true }).then(finish, () => {
      // Video failed to play: fall back to the still.
      settled = true;
      showFallback(fallbackName, title, subtitle, voiceId);
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    });
  }

  return {
    // ------------------------------------------------------------ title
    showTitle(best) {
      clearFallback();
      ui.hideAll();
      ui.titleScreen({
        title: CONFIG.title,
        subtitle: CONFIG.logline,
        image: TITLE_IMAGE,
        prompt: PROMPT_START,
        controls: true,
      });
      // Best score line under the prompt.
      ui.hud.clear();
      ui.hud.show(false);
      ui.toast(`${CONFIG.label.best}: ${formatBest(best)}`, { ms: 6000, color: CONFIG.colors.accent });
    },

    // ------------------------------------------------------------ end
    showEnd({ win, cause, stats, best }) {
      clearFallback();
      ui.hideAll();
      ui.hud.show(false);
      const title = win ? 'INDEPENDENCE ACHIEVED' : 'MISSION FAILURE';
      const causeText = win ? '' : (cause || CONFIG.endCause.integrity);
      const subtitle = win
        ? 'The Moon is home. The cord to Earth is cut.'
        : causeText;
      const rows = Array.isArray(stats) ? stats : [];
      const table = rows.map(([label, value]) => [String(label), formatNumber(value)]);
      table.push([CONFIG.label.best, formatBest(best)]);
      ui.endScreen({
        title,
        subtitle,
        stats: table,
        prompt: PROMPT_RESTART,
      });
      // Enter also restarts from the end screen.
      ui.toast(PROMPT_END, { ms: 5000, color: CONFIG.colors.accent });
    },

    // ------------------------------------------------------------ cutscenes
    playIntro() {
      return playCutscene(
        VIDEO_INTRO,
        'intro',
        CONFIG.title,
        'Mission control, you have the conn. Build us a home.',
        VO_START,
      );
    },

    playVictory() {
      return playCutscene(
        VIDEO_VICTORY,
        'victory',
        'INDEPENDENCE ACHIEVED',
        'The Moon is home.',
        VO_WIN,
      );
    },

    playGameOver() {
      return playCutscene(
        VIDEO_GAME_OVER,
        'game_over',
        'MISSION FAILURE',
        CONFIG.endCause.power,
        VO_FAIL,
      );
    },

    hideAll() {
      clearFallback();
      ui.hideAll();
    },

    // Called by game.js each update so a key-art fallback can time out.
    update(dt) {
      if (!fallbackActive) return;
      fallbackTimer -= dt * 1000;
      if (fallbackTimer <= 0) {
        const name = fallbackName;
        fallbackActive = false;
        fallbackTimer = 0;
        fallbackName = null;
        pendingVoice = null;
        if (name) ui.hide(name);
        if (pendingResolve) {
          const resolve = pendingResolve;
          pendingResolve = null;
          resolve();
        }
      }
    },
  };
}
