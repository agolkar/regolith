// Engine assembly and the main loop. The game receives this object in createGame(engine).
import * as THREE from 'three';
import { createRenderer } from './renderer.js';
import { createInput } from './input.js';
import { createAssets } from './assets.js';
import { createAudio } from './audio.js';
import { createUI } from './ui.js';
import { createFX } from './fx.js';
import { createEvents, createSave } from './events.js';
import { createRng } from './util.js';
import { createTerrainFactory } from './terrain.js';
import { createSpaceSky } from './space.js';

export const FIXED_DT = 1 / 60;

export async function createEngine({ container, qa = false, meta = {}, onProgress } = {}) {
  let elapsed = 0;
  const events = createEvents(() => elapsed);
  const r = createRenderer(container, { qa });
  const input = createInput(r.renderer.domElement);
  const audio = createAudio({ qa });
  const assets = createAssets({ renderer: r.renderer, audio });
  const ui = createUI({ assets, qa, meta });
  const fx = createFX({ scene: r.scene, getCamera: () => r.camera, uiRoot: ui.root });
  const save = createSave((meta.slug || 'game').replace(/[^a-z0-9_-]/gi, ''));

  const manifest = await assets.loadManifest();
  await assets.loadAll(onProgress);
  r.env.space = createSpaceSky({ scene: r.scene, renderer: r.renderer, env: r.env, getCamera: () => r.camera, assets,
    addUpdater: r.addUpdater });
  const terrain = createTerrainFactory({ scene: r.scene, assets });

  const engine = {
    THREE,
    qa,
    meta,
    manifest,
    renderer: r.renderer,
    scene: r.scene,
    get camera() { return r.camera; },
    setCamera: r.setCamera,
    env: r.env,
    cam: r.cam,
    quality: r.quality,
    input, audio, assets, ui, fx, events, save, terrain,
    G_MOON: 1.62,
    rng: createRng(Date.now() & 0xffff),
    time: { elapsed: 0, dt: FIXED_DT, scale: 1, frame: 0 },
    paused: false,
    fps: 60,
    errors: [],
    pauseKeys: ['KeyP', 'Escape'],
    muteKey: 'KeyM',
    autoPauseOnBlur: !qa,
    game: null,
    setPaused(p) {
      if (engine.paused === p) return;
      engine.paused = p;
      if (p) {
        audio.suspend();
        ui.screen('pause', { title: 'Paused', prompt: 'Press P to resume', controls: true });
      } else {
        audio.resume();
        ui.hide('pause');
      }
      events.emit(p ? 'pause' : 'resume');
    },
    run(game) { engine.game = game; startLoop(engine, r, game, (t) => { elapsed = t; }); },
  };

  // First gesture unlocks audio. Engine-level keys: M mutes, P or Escape pauses during play.
  input.onAnyKey((code) => {
    audio.unlock();
    if (code === engine.muteKey) {
      const m = audio.toggleMute();
      ui.toast(m ? 'Sound off' : 'Sound on', { ms: 900 });
    }
    if (engine.pauseKeys.includes(code)) {
      const s = safeState(engine);
      if (engine.paused) engine.setPaused(false);
      else if (s && s.scene === 'playing') engine.setPaused(true);
    }
  });
  if (qa) audio.unlock();
  window.addEventListener('blur', () => {
    if (!engine.autoPauseOnBlur) return;
    const s = safeState(engine);
    if (s && s.scene === 'playing') engine.setPaused(true);
  });
  return engine;
}

export function safeState(engine) {
  if (!engine.game || typeof engine.game.getState !== 'function') return null;
  try { return engine.game.getState(); } catch (e) { return { scene: 'error', error: String(e) }; }
}

function startLoop(engine, r, game, setElapsed) {
  let last = performance.now();
  let acc = 0;
  let fpsAcc = 0, fpsFrames = 0, slowSeconds = 0;
  const errorCounts = new Map();
  // In test mode the simulation catches up with wall-clock time even when a
  // software renderer draws only a few frames per second.
  const maxSteps = engine.qa ? 20 : 5;

  function report(where, e) {
    const key = where + ':' + (e && e.message);
    const n = (errorCounts.get(key) || 0) + 1;
    errorCounts.set(key, n);
    if (n <= 3) {
      console.error(`[engine] ${where} threw:`, e);
      engine.errors.push({ where, message: String(e && e.message || e), stack: String(e && e.stack || '') });
      window.dispatchEvent(new CustomEvent('game-error', { detail: { where, message: String(e && e.message || e) } }));
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25;
    fpsAcc += dt; fpsFrames++;
    if (fpsAcc >= 1) {
      engine.fps = Math.round(fpsFrames / fpsAcc);
      if (engine.fps < 28 && !engine.paused) slowSeconds++; else slowSeconds = 0;
      if (slowSeconds >= 3 && engine.quality.level > 1) {
        engine.quality.set(engine.quality.level - 1);
        slowSeconds = 0;
      }
      fpsAcc = 0; fpsFrames = 0;
    }
    if (!engine.paused) {
      acc += dt * engine.time.scale;
      let steps = 0;
      while (acc >= FIXED_DT && steps < maxSteps) {
        try { game.update(FIXED_DT); } catch (e) { report('game.update', e); }
        engine.input.endStep();
        engine.time.elapsed += FIXED_DT;
        setElapsed(engine.time.elapsed);
        acc -= FIXED_DT;
        steps++;
      }
      if (steps === maxSteps) acc = 0;
    }
    engine.time.frame++;
    try { engine.fx.update(engine.paused ? 0 : dt * engine.time.scale); } catch (e) { report('fx.update', e); }
    try { r.update(dt); } catch (e) { report('camera.update', e); }
    if (typeof game.render === 'function') {
      try { game.render(dt); } catch (e) { report('game.render', e); }
    }
    try { r.render(); } catch (e) { report('render', e); }
  }
  requestAnimationFrame(frame);
}
