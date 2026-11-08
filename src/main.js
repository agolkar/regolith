// Boot: load metadata and assets, create the game, start the loop, and expose
// window.__GAME__ for the automated tests. Written by the pipeline; the game
// itself lives in src/game/.
import { createEngine, safeState } from './engine/engine.js';
import { createGame } from './game/game.js';

const params = new URLSearchParams(location.search);
const qa = params.has('qa');
const loading = document.getElementById('loading');
const fill = loading && loading.querySelector('.ld-fill');

const hook = (window.__GAME__ = {
  ready: false,
  qa,
  errors: [],
  events: [],
  counts: {},
  getState: () => null,
  start: () => {},
});

function showError(msg) {
  hook.errors.push(msg);
  let el = document.getElementById('error-panel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'error-panel';
    document.body.appendChild(el);
  }
  if (el.childElementCount < 4) {
    const line = document.createElement('div');
    line.textContent = msg;
    el.appendChild(line);
  }
}
window.addEventListener('error', (e) => showError(`${e.message} (${(e.filename || '').split('/').slice(-2).join('/')}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => showError(`Unhandled promise rejection: ${e.reason && (e.reason.message || e.reason)}`));
window.addEventListener('game-error', (e) => showError(`${e.detail.where}: ${e.detail.message}`));

async function boot() {
  let meta = {};
  try {
    const r = await fetch('meta.json', { cache: 'no-store' });
    if (r.ok) meta = await r.json();
  } catch { /* optional */ }
  if (meta.title) {
    document.title = meta.title;
    const t = loading && loading.querySelector('.ld-title');
    if (t) t.textContent = meta.title;
  }

  const engine = await createEngine({
    container: document.getElementById('app'),
    qa,
    meta,
    onProgress: (p) => { if (fill) fill.style.width = Math.round(p * 100) + '%'; },
  });

  const game = createGame(engine);
  if (!game || typeof game.update !== 'function') throw new Error('createGame(engine) must return an object with update(dt)');
  if (typeof game.init === 'function') await game.init();

  hook.engine = engine;
  hook.getState = () => {
    const s = safeState(engine) || {};
    return { ...s, fps: engine.fps, paused: engine.paused, time: Math.round(engine.time.elapsed * 100) / 100, quality: engine.quality.level };
  };
  hook.start = () => { engine.audio.unlock(); if (typeof game.start === 'function') game.start(); };
  hook.events = engine.events.log;
  hook.counts = engine.events.counts;
  hook.engineErrors = engine.errors;

  engine.run(game);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (loading) loading.classList.add('done');
    hook.ready = true;
  }));
}

boot().catch((e) => {
  console.error('[boot] failed:', e);
  showError('Boot failed: ' + (e && e.message ? e.message : e));
  if (loading) loading.querySelector('.ld-text').textContent = 'Error: ' + (e && e.message ? e.message : e);
});
