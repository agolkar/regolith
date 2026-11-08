// Web Audio manager: decoded sound files (voice lines, music, ambience) and
// procedural sound effects. Browsers start audio only after a user gesture;
// the engine calls unlock() on the first key press or click.
export function createAudio({ qa = false } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  let master, musicBus, sfxBus, voiceBus;
  const buffers = new Map();
  let muted = false;
  let musicNode = null;
  let musicId = null;
  let noiseBuf = null;
  const warned = new Set();
  let volume = 0.8;

  function ensure() {
    if (ctx || !Ctx) return ctx;
    try {
      ctx = new Ctx();
    } catch {
      return null;
    }
    master = ctx.createGain(); master.gain.value = muted ? 0 : volume; master.connect(ctx.destination);
    musicBus = ctx.createGain(); musicBus.gain.value = 0.55; musicBus.connect(master);
    sfxBus = ctx.createGain(); sfxBus.gain.value = 0.9; sfxBus.connect(master);
    voiceBus = ctx.createGain(); voiceBus.gain.value = 1.0; voiceBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function warnOnce(id) {
    if (warned.has(id)) return;
    warned.add(id);
    console.warn(`[audio] sound "${id}" is not loaded; skipped`);
  }

  async function decode(id, arrayBuffer) {
    const c = ensure();
    if (!c) return;
    try {
      const buf = await c.decodeAudioData(arrayBuffer);
      buffers.set(id, buf);
    } catch (e) {
      console.warn(`[audio] cannot decode "${id}": ${e && e.message}`);
    }
  }

  function busFor(kind) {
    return kind === 'music' ? musicBus : kind === 'voice' ? voiceBus : sfxBus;
  }

  function play(id, { volume: vol = 1, rate = 1, loop = false, pan = 0, kind = 'sfx', offset = 0 } = {}) {
    const c = ensure();
    const buf = buffers.get(id);
    if (!c || !buf) { if (!buf) warnOnce(id); return { stop() {}, playing: false }; }
    const src = c.createBufferSource();
    src.buffer = buf; src.loop = loop; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = vol;
    let node = g;
    if (pan && c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p); node = p;
    }
    node.connect(busFor(kind));
    src.connect(g);
    src.start(0, offset);
    if (kind === 'voice') duckMusic(buf.duration / rate);
    return {
      playing: true,
      stop(fade = 0.05) {
        try {
          g.gain.setTargetAtTime(0, c.currentTime, Math.max(0.01, fade / 3));
          src.stop(c.currentTime + fade + 0.05);
        } catch { /* already stopped */ }
      },
      setVolume(v) { g.gain.setTargetAtTime(v, c.currentTime, 0.05); },
      setRate(r) { src.playbackRate.setTargetAtTime(r, c.currentTime, 0.05); },
    };
  }

  function duckMusic(seconds) {
    if (!ctx || !musicBus) return;
    const t = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setTargetAtTime(0.2, t, 0.08);
    musicBus.gain.setTargetAtTime(0.55, t + seconds, 0.3);
  }

  function music(id, { volume: vol = 0.6, fade = 1.5 } = {}) {
    if (musicId === id && musicNode) return;
    stopMusic(fade);
    const c = ensure();
    if (!c || !buffers.has(id)) { warnOnce(id); return; }
    musicId = id;
    musicNode = play(id, { volume: 0.0001, loop: true, kind: 'music' });
    musicNode.setVolume(vol);
  }

  function stopMusic(fade = 1) {
    if (musicNode) { musicNode.stop(fade); musicNode = null; musicId = null; }
  }

  // ---- procedural sound effects -------------------------------------------
  function tone({ freq = 440, type = 'sine', dur = 0.15, vol = 0.3, slide = 0, attack = 0.005, delay = 0 } = {}) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise({ dur = 0.3, vol = 0.3, filter = 1200, type = 'lowpass', sweep = 0, delay = 0, q = 1 } = {}) {
    const c = ensure();
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(filter, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(30, filter + sweep), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(sfxBus);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  const presets = {
    click: () => tone({ freq: 900, type: 'square', dur: 0.05, vol: 0.12 }),
    pickup: () => { tone({ freq: 660, type: 'triangle', dur: 0.09, vol: 0.25 }); tone({ freq: 990, type: 'triangle', dur: 0.14, vol: 0.22, delay: 0.07 }); },
    coin: () => { tone({ freq: 1320, type: 'square', dur: 0.06, vol: 0.12 }); tone({ freq: 1760, type: 'square', dur: 0.18, vol: 0.12, delay: 0.06 }); },
    powerup: () => { for (let i = 0; i < 5; i++) tone({ freq: 400 + i * 160, type: 'triangle', dur: 0.1, vol: 0.18, delay: i * 0.06 }); },
    jump: () => tone({ freq: 320, type: 'square', dur: 0.18, vol: 0.14, slide: 380 }),
    shoot: () => { tone({ freq: 880, type: 'sawtooth', dur: 0.12, vol: 0.12, slide: -700 }); noise({ dur: 0.08, vol: 0.12, filter: 4000, type: 'highpass' }); },
    laser: () => tone({ freq: 1400, type: 'sawtooth', dur: 0.2, vol: 0.12, slide: -1200 }),
    hit: () => { noise({ dur: 0.18, vol: 0.4, filter: 900 }); tone({ freq: 140, type: 'square', dur: 0.12, vol: 0.2, slide: -80 }); },
    hurt: () => { tone({ freq: 300, type: 'sawtooth', dur: 0.25, vol: 0.2, slide: -220 }); noise({ dur: 0.2, vol: 0.2, filter: 600 }); },
    explosion: () => { noise({ dur: 1.1, vol: 0.6, filter: 1400, sweep: -1300 }); tone({ freq: 70, type: 'sine', dur: 0.8, vol: 0.5, slide: -40 }); },
    whoosh: () => noise({ dur: 0.45, vol: 0.25, filter: 300, type: 'bandpass', sweep: 2500, q: 2 }),
    thud: () => { tone({ freq: 90, type: 'sine', dur: 0.25, vol: 0.4, slide: -50 }); noise({ dur: 0.1, vol: 0.2, filter: 400 }); },
    alarm: () => { for (let i = 0; i < 3; i++) tone({ freq: i % 2 ? 660 : 880, type: 'square', dur: 0.16, vol: 0.12, delay: i * 0.18 }); },
    success: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', dur: 0.22, vol: 0.2, delay: i * 0.1 })); },
    fail: () => { [392, 330, 262].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.3, vol: 0.15, delay: i * 0.16 })); },
    tick: () => tone({ freq: 1800, type: 'square', dur: 0.03, vol: 0.08 }),
    engine: () => noise({ dur: 0.3, vol: 0.15, filter: 220 }),
    splash: () => noise({ dur: 0.6, vol: 0.35, filter: 2500, type: 'bandpass', sweep: -2000, q: 0.7 }),
  };

  // Continuous procedural loop (engine hum, wind) whose volume and pitch you drive each frame.
  function loopNoise({ filter = 300, vol = 0.2, type = 'lowpass' } = {}) {
    const c = ensure();
    if (!c) return { set() {}, stop() {} };
    const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = filter;
    const g = c.createGain(); g.gain.value = 0;
    s.connect(f); f.connect(g); g.connect(sfxBus); s.start();
    g.gain.setTargetAtTime(vol, c.currentTime, 0.1);
    return {
      set({ volume: v, filter: fq } = {}) {
        if (v != null) g.gain.setTargetAtTime(Math.max(0, v), c.currentTime, 0.05);
        if (fq != null) f.frequency.setTargetAtTime(Math.max(30, fq), c.currentTime, 0.05);
      },
      stop() { try { g.gain.setTargetAtTime(0, c.currentTime, 0.05); s.stop(c.currentTime + 0.3); } catch { /* ignore */ } },
    };
  }

  return {
    get ctx() { return ctx; },
    get unlocked() { return !!ctx && ctx.state === 'running'; },
    get muted() { return muted; },
    has: (id) => buffers.has(id),
    decode,
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    },
    play,
    voice: (id, opts = {}) => play(id, { ...opts, kind: 'voice' }),
    music,
    stopMusic,
    tone,
    noise,
    loopNoise,
    sfx(name) {
      const p = presets[name];
      if (p) p(); else warnOnce('sfx:' + name);
    },
    presets: Object.keys(presets),
    setVolume(v) { volume = v; if (master && !muted) master.gain.value = v; },
    setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : volume; },
    toggleMute() { this.setMuted(!muted); return muted; },
    suspend() { if (ctx && ctx.state === 'running' && !qa) ctx.suspend().catch(() => {}); },
    resume() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); },
  };
}
