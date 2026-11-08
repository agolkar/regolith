// Asset registry, filled from assets/manifest.json (written by the pipeline).
// Every getter is safe: a missing id returns a neutral placeholder and logs one warning.
import * as THREE from 'three';

export function createAssets({ renderer, audio }) {
  const entries = new Map();      // id -> manifest entry
  const textures = new Map();     // id -> THREE.Texture
  const warned = new Set();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  let placeholder = null;

  function warnOnce(id, what) {
    const k = what + ':' + id;
    if (warned.has(k)) return;
    warned.add(k);
    console.warn(`[assets] missing ${what} "${id}"; using a placeholder`);
  }

  function makePlaceholder() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? '#8a8f96' : '#6f747b';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.userData.placeholder = true;
    return t;
  }

  async function loadManifest(url = 'assets/manifest.json') {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const m = await r.json();
      for (const e of m.assets || []) entries.set(e.id, e);
      return m;
    } catch (e) {
      console.warn('[assets] no manifest found; the game runs with placeholders');
      return { assets: [] };
    }
  }

  function loadTexture(e) {
    return new Promise((resolve) => {
      new THREE.TextureLoader().load(
        e.src,
        (t) => {
          const isData = e.kind === 'normal' || e.kind === 'roughness';
          t.colorSpace = isData ? THREE.NoColorSpace : THREE.SRGBColorSpace;
          if (e.kind === 'texture' || e.kind === 'normal' || e.kind === 'roughness') {
            t.wrapS = t.wrapT = THREE.RepeatWrapping;
          }
          if (e.kind === 'panorama') t.mapping = THREE.EquirectangularReflectionMapping;
          t.anisotropy = Math.min(8, maxAniso);
          t.name = e.id;
          textures.set(e.id, t);
          resolve();
        },
        undefined,
        () => { console.warn(`[assets] failed to load image ${e.src}`); resolve(); },
      );
    });
  }

  async function loadAudio(e) {
    try {
      const r = await fetch(e.src);
      if (!r.ok) throw new Error(r.status);
      await audio.decode(e.id, await r.arrayBuffer());
    } catch (err) {
      console.warn(`[assets] failed to load audio ${e.src}`);
    }
  }

  async function loadAll(onProgress) {
    const list = [...entries.values()].filter((e) => e.kind !== 'video');
    let done = 0;
    const step = () => { done++; if (onProgress) onProgress(done / Math.max(1, list.length)); };
    const jobs = list.map((e) => {
      const p = ['texture', 'panorama', 'sprite', 'image', 'keyart', 'normal', 'roughness'].includes(e.kind)
        ? loadTexture(e)
        : ['voice', 'music', 'sound', 'ambience'].includes(e.kind) ? loadAudio(e) : Promise.resolve();
      return p.then(step);
    });
    await Promise.all(jobs);
  }

  function texture(id, { repeat } = {}) {
    let t = textures.get(id);
    if (!t) {
      warnOnce(id, 'texture');
      if (!placeholder) placeholder = makePlaceholder();
      t = placeholder;
    }
    if (repeat) {
      const c = t.clone();
      c.repeat.set(repeat[0], repeat[1] ?? repeat[0]);
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.needsUpdate = true;
      return c;
    }
    return t;
  }

  // PBR material from a generated texture; uses <id>_normal and <id>_rough when present.
  function material(id, opts = {}) {
    const { repeat, color, roughness = 0.85, metalness = 0, normalScale = 1,
      emissive, emissiveIntensity = 1, transparent = false, opacity = 1, side, envMapIntensity = 1 } = opts;
    const m = new THREE.MeshStandardMaterial({ roughness, metalness, transparent, opacity, envMapIntensity });
    if (id) {
      m.map = texture(id, { repeat });
      if (textures.has(id + '_normal')) {
        m.normalMap = texture(id + '_normal', { repeat });
        m.normalScale.set(normalScale, normalScale);
      }
      if (textures.has(id + '_rough')) m.roughnessMap = texture(id + '_rough', { repeat });
    }
    if (color != null) m.color = new THREE.Color(color);
    if (emissive != null) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = emissiveIntensity; }
    if (side != null) m.side = side;
    return m;
  }

  // Camera-facing sprite from an image with transparency (kind "sprite").
  function sprite(id, { height = 1, color = 0xffffff, opacity = 1 } = {}) {
    const t = texture(id);
    const mat = new THREE.SpriteMaterial({ map: t, color, transparent: true, opacity, depthWrite: false });
    const s = new THREE.Sprite(mat);
    const img = t.image;
    const aspect = img && img.width && img.height ? img.width / img.height : 1;
    s.scale.set(height * aspect, height, 1);
    return s;
  }

  function entry(id) { return entries.get(id) || null; }

  return {
    loadManifest,
    loadAll,
    texture,
    material,
    sprite,
    entry,
    has: (id) => entries.has(id) && (textures.has(id) || audio.has(id) || entries.get(id).kind === 'video'),
    list: (kind) => [...entries.values()].filter((e) => !kind || e.kind === kind).map((e) => e.id),
    url: (id) => entries.get(id)?.src || null,
  };
}
