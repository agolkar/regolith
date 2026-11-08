// DOM overlay: screens (title, pause, game over), HUD, banners, toasts,
// flashes, fades and full-screen video cutscenes.
export function createUI({ assets, qa = false, meta = {} }) {
  const root = document.createElement('div');
  root.id = 'ui';
  document.body.appendChild(root);
  const hudEl = document.createElement('div');
  hudEl.className = 'hud';
  hudEl.innerHTML = '<div class="hud-left"></div><div class="hud-center"></div><div class="hud-right"></div>';
  root.appendChild(hudEl);
  const hudItems = new Map();
  const screens = new Map();
  const flashEl = div('ui-flash', root);
  const fadeEl = div('ui-fade', root);
  const bannerEl = div('ui-banner', root);
  const toastWrap = div('ui-toasts', root);
  let bannerTimer = 0;

  function div(cls, parent) {
    const d = document.createElement('div');
    d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function controlsHtml(controls) {
    if (!controls || !controls.length) return '';
    const rows = controls.map((c) => `<div class="ctl"><span class="keys">${esc(c.label || (c.keys || []).join(' / '))}</span><span>${esc(c.action)}</span></div>`);
    return `<div class="controls">${rows.join('')}</div>`;
  }

  // Generic screen. options: title, subtitle, body (HTML string), stats [[label, value]],
  // prompt (blinking line), controls (bool or list), image (asset id used as background),
  // buttons [{label, onClick}].
  function screen(name, opts = {}) {
    let el = screens.get(name);
    if (!el) {
      el = div('ui-screen', root);
      el.dataset.name = name;
      screens.set(name, el);
    }
    const bg = opts.image && assets.url(opts.image);
    el.style.backgroundImage = bg ? `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.65)), url("${bg}")` : '';
    el.classList.toggle('with-image', !!bg);
    const stats = (opts.stats || []).map(([k, v]) => `<div class="stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    const ctl = opts.controls === true ? controlsHtml(meta.controls) : Array.isArray(opts.controls) ? controlsHtml(opts.controls) : '';
    el.innerHTML = `
      <div class="panel ${opts.className || ''}">
        ${opts.title ? `<h1>${esc(opts.title)}</h1>` : ''}
        ${opts.subtitle ? `<p class="subtitle">${esc(opts.subtitle)}</p>` : ''}
        ${opts.body || ''}
        ${stats ? `<div class="stats">${stats}</div>` : ''}
        ${ctl}
        ${opts.prompt ? `<p class="prompt">${esc(opts.prompt)}</p>` : ''}
        <div class="buttons"></div>
      </div>`;
    const bw = el.querySelector('.buttons');
    for (const b of opts.buttons || []) {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.addEventListener('click', (e) => { e.stopPropagation(); b.onClick && b.onClick(); });
      bw.appendChild(btn);
    }
    if (opts.show !== false) show(name);
    return el;
  }

  function show(name) { const el = screens.get(name); if (el) el.classList.add('visible'); }
  function hide(name) { const el = screens.get(name); if (el) el.classList.remove('visible'); }
  function hideAll() { for (const el of screens.values()) el.classList.remove('visible'); }
  function isVisible(name) { const el = screens.get(name); return !!el && el.classList.contains('visible'); }

  const hud = {
    // set('score', 1200, {label: 'Score', side: 'left'})
    set(key, value, { label, side = 'left' } = {}) {
      let it = hudItems.get(key);
      if (!it) {
        it = div('hud-item', hudEl.querySelector('.hud-' + side));
        it.innerHTML = '<span class="l"></span><b class="v"></b>';
        hudItems.set(key, it);
      }
      it.querySelector('.l').textContent = label ?? key;
      const v = it.querySelector('.v');
      const s = String(value);
      if (v.textContent !== s) {
        v.textContent = s;
        it.classList.remove('bump'); void it.offsetWidth; it.classList.add('bump');
      }
    },
    // bar('health', 0.75, {label: 'Hull', color: '#4ade80'})
    bar(key, fraction, { label, color = '#4ade80', side = 'left' } = {}) {
      let it = hudItems.get(key);
      if (!it) {
        it = div('hud-item hud-bar', hudEl.querySelector('.hud-' + side));
        it.innerHTML = '<span class="l"></span><div class="track"><div class="fill"></div></div>';
        hudItems.set(key, it);
      }
      it.querySelector('.l').textContent = label ?? key;
      const f = it.querySelector('.fill');
      f.style.width = Math.round(Math.max(0, Math.min(1, fraction)) * 100) + '%';
      f.style.background = color;
    },
    remove(key) { const it = hudItems.get(key); if (it) { it.remove(); hudItems.delete(key); } },
    clear() { for (const it of hudItems.values()) it.remove(); hudItems.clear(); },
    show(v = true) { hudEl.style.display = v ? '' : 'none'; },
  };

  function banner(text, ms = 1600, { color } = {}) {
    bannerEl.textContent = text;
    bannerEl.style.color = color || '';
    bannerEl.classList.remove('visible'); void bannerEl.offsetWidth; bannerEl.classList.add('visible');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => bannerEl.classList.remove('visible'), ms);
  }

  function toast(text, { ms = 1800, color } = {}) {
    const t = div('ui-toast', toastWrap);
    t.textContent = text;
    if (color) t.style.borderColor = color;
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  function flash(color = '#ffffff', ms = 120, opacity = 0.6) {
    flashEl.style.transition = 'none';
    flashEl.style.background = color;
    flashEl.style.opacity = String(opacity);
    void flashEl.offsetWidth;
    flashEl.style.transition = `opacity ${ms}ms ease-out`;
    flashEl.style.opacity = '0';
  }

  function fade(toBlack = true, ms = 500) {
    fadeEl.style.transition = `opacity ${ms}ms ease`;
    fadeEl.style.opacity = toBlack ? '1' : '0';
    return new Promise((r) => setTimeout(r, qa ? 0 : ms));
  }

  // Full-screen video cutscene. Resolves when it ends, is skipped (any key or click) or fails.
  function playVideo(id, { skippable = true, volume = 1 } = {}) {
    const src = assets.url(id);
    if (!src || qa) return Promise.resolve(false);
    return new Promise((resolve) => {
      const wrap = div('ui-video', root);
      const v = document.createElement('video');
      v.src = src; v.playsInline = true; v.volume = volume; v.preload = 'auto';
      wrap.appendChild(v);
      const hint = div('ui-video-hint', wrap);
      hint.textContent = skippable ? 'Press any key to skip' : '';
      let done = false;
      const finish = (played) => {
        if (done) return;
        done = true;
        window.removeEventListener('keydown', onKey, true);
        wrap.removeEventListener('click', onClick);
        v.pause(); wrap.remove();
        resolve(played);
      };
      const onKey = (e) => { if (skippable) { e.stopPropagation(); finish(true); } };
      const onClick = () => { if (skippable) finish(true); };
      window.addEventListener('keydown', onKey, true);
      wrap.addEventListener('click', onClick);
      v.addEventListener('ended', () => finish(true));
      v.addEventListener('error', () => finish(false));
      const p = v.play();
      if (p && p.catch) p.catch(() => { v.muted = true; v.play().catch(() => finish(false)); });
      setTimeout(() => finish(true), 30000);
    });
  }

  // Ready-made screens built on screen().
  function titleScreen({ title = meta.title, subtitle = meta.logline, image, prompt = 'Press Enter to start', controls = true, body } = {}) {
    return screen('title', { title, subtitle, image, prompt, controls, body, className: 'title' });
  }
  function endScreen({ title = 'Game Over', subtitle, stats, prompt = 'Press Enter to play again', image, body } = {}) {
    return screen('end', { title, subtitle, stats, prompt, image, body, className: 'end' });
  }

  return {
    root, screen, show, hide, hideAll, isVisible, hud, banner, toast, flash, fade, playVideo,
    titleScreen, endScreen, esc,
    setTheme({ accent, font } = {}) {
      if (accent) document.documentElement.style.setProperty('--accent', accent);
      if (font) document.documentElement.style.setProperty('--font', font);
    },
  };
}
