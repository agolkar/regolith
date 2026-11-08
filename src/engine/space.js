// Airless sky for the Moon or any body without atmosphere: black sky, star field,
// a bright Sun disc that sets the direction of the shadow-casting light, the Earth
// (a generated sprite or a procedural disc), faint earthshine, an environment map
// for metal reflections, no fog. The sky follows the camera, so it is infinitely far.
import * as THREE from 'three';

const R = 2400;

function dirFrom(azimuthDeg, elevationDeg) {
  const a = THREE.MathUtils.degToRad(azimuthDeg), e = THREE.MathUtils.degToRad(elevationDeg);
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
}

function glowTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [o, col] of stops) grd.addColorStop(o, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function earthTexture(phase) {
  // Procedural Earth disc: oceans, continents, clouds, terminator.
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 512, 512);
  g.save();
  g.beginPath(); g.arc(256, 256, 240, 0, Math.PI * 2); g.clip();
  const ocean = g.createRadialGradient(200, 200, 30, 256, 256, 260);
  ocean.addColorStop(0, '#2f6fb3'); ocean.addColorStop(1, '#0d2c5c');
  g.fillStyle = ocean; g.fillRect(0, 0, 512, 512);
  const rnd = (() => { let s = 99; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  g.fillStyle = '#6f7d4a';
  for (let i = 0; i < 14; i++) {
    g.beginPath();
    const x = 100 + rnd() * 320, y = 90 + rnd() * 330, r = 25 + rnd() * 70;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, rr = r * (0.6 + rnd() * 0.6);
      k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
  }
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.lineCap = 'round';
  for (let i = 0; i < 40; i++) {
    g.lineWidth = 4 + rnd() * 10;
    g.beginPath();
    const x = rnd() * 512, y = rnd() * 512;
    g.moveTo(x, y);
    g.bezierCurveTo(x + 40, y - 20 + rnd() * 40, x + 80, y + rnd() * 30, x + 60 + rnd() * 80, y + rnd() * 20);
    g.stroke();
  }
  // Night side
  const shade = g.createLinearGradient(512 * phase - 60, 0, 512 * phase + 60, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,0.97)');
  g.fillStyle = shade; g.fillRect(0, 0, 512, 512);
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSpaceSky({ scene, renderer, env, getCamera, assets, addUpdater }) {
  let state = null;

  function build(opts = {}) {
    const {
      stars = 7000, starBrightness = 1,
      sun = {}, earth = {}, earthshine = 0.1, exposure = 1.0,
    } = opts;
    const sunAz = sun.azimuth ?? 115, sunEl = sun.elevation ?? 11;
    if (state) { scene.remove(state.group); }
    const group = new THREE.Group();
    group.name = 'space-sky';
    group.renderOrder = -10;
    scene.add(group);
    scene.background = new THREE.Color(0x000000);
    scene.fog = null;

    // Stars: many dim ones and a few bright ones.
    const rnd = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
    for (const layer of [{ n: Math.round(stars * 0.88), size: 1.3, b: 0.55 }, { n: Math.round(stars * 0.12), size: 2.4, b: 1.0 }]) {
      const p = new Float32Array(layer.n * 3), col = new Float32Array(layer.n * 3);
      for (let i = 0; i < layer.n; i++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        p[i * 3] = s * Math.cos(th) * R; p[i * 3 + 1] = u * R; p[i * 3 + 2] = s * Math.sin(th) * R;
        const br = layer.b * starBrightness * (0.35 + 0.65 * Math.pow(rnd(), 2.2));
        const tint = rnd();
        col[i * 3] = br * (tint < 0.15 ? 0.8 : tint > 0.9 ? 1.0 : 0.95);
        col[i * 3 + 1] = br * (tint < 0.15 ? 0.88 : tint > 0.9 ? 0.9 : 0.95);
        col[i * 3 + 2] = br * (tint < 0.15 ? 1.0 : tint > 0.9 ? 0.75 : 0.95);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const m = new THREE.PointsMaterial({ size: layer.size, sizeAttenuation: false, vertexColors: true, transparent: true,
        depthWrite: false, fog: false, toneMapped: false });
      const pts = new THREE.Points(g, m);
      pts.frustumCulled = false;
      group.add(pts);
    }

    // Sun: light direction, glare disc.
    const sunDir = dirFrom(sunAz, sunEl);
    env.setSun({ direction: [sunDir.x, sunDir.y, sunDir.z], color: sun.color ?? 0xfff8f0, intensity: sun.intensity ?? 3.6,
      shadowRadius: sun.shadowRadius ?? 70 });
    env.sun.shadow.mapSize.set(4096, 4096);
    if (env.sun.shadow.map) { env.sun.shadow.map.dispose(); env.sun.shadow.map = null; }
    const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture([[0, 'rgba(255,255,255,1)'], [0.08, 'rgba(255,253,245,1)'], [0.16, 'rgba(255,240,210,0.35)'], [0.4, 'rgba(255,230,200,0.06)'], [1, 'rgba(0,0,0,0)']]),
      color: new THREE.Color(1, 1, 1).multiplyScalar(6), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    const sunSize = 2 * R * Math.tan(THREE.MathUtils.degToRad(sun.glare ?? 9) / 2);
    sunSprite.scale.set(sunSize, sunSize, 1);
    sunSprite.position.copy(sunDir).multiplyScalar(R * 0.95);
    sunSprite.name = 'sun';
    group.add(sunSprite);

    // Earth
    let earthObj = null;
    if (earth !== false) {
      const eDir = dirFrom(earth.azimuth ?? (sunAz + 150), earth.elevation ?? 24);
      const deg = earth.size ?? 5;
      const s = 2 * R * Math.tan(THREE.MathUtils.degToRad(deg) / 2);
      let map;
      if (earth.texture && assets.has(earth.texture)) map = assets.texture(earth.texture);
      else map = earthTexture(earth.phase ?? 0.62);
      const em = new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, color: new THREE.Color(1, 1, 1).multiplyScalar(earth.brightness ?? 1.4) });
      earthObj = new THREE.Sprite(em);
      const img = map.image;
      const aspect = img && img.width && img.height ? img.width / img.height : 1;
      earthObj.scale.set(s * aspect, s, 1);
      earthObj.position.copy(eDir).multiplyScalar(R * 0.9);
      earthObj.name = 'earth';
      group.add(earthObj);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture([[0, 'rgba(120,170,255,0.0)'], [0.42, 'rgba(120,170,255,0.0)'], [0.5, 'rgba(120,170,255,0.25)'], [0.7, 'rgba(80,130,255,0.04)'], [1, 'rgba(0,0,0,0)']]),
        transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
      halo.scale.set(s * 1.25, s * 1.25, 1);
      halo.position.copy(earthObj.position).multiplyScalar(1.001);
      group.add(halo);
    }

    // Earthshine and the dark lunar ground: very little fill light.
    env.setHemisphere({ sky: 0x7088b8, ground: 0x151515, intensity: earthshine });
    renderer.toneMappingExposure = exposure;
    env.setBloom({ threshold: 2.5, strength: 0.3, radius: 0.5 });

    // Reflections: black space above, sunlit grey ground below the horizon. The Sun itself is left out,
    // so shadows stay dark; the direct light still gives metals their highlights.
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x000000);
    const ground = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4a4744, side: THREE.BackSide }));
    envScene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(envScene, 0.02);
    scene.environment = envRT.texture;
    pmrem.dispose();

    state = { group, sunDir, earth: earthObj, sunSprite };
    return state;
  }

  addUpdater(() => {
    if (state) state.group.position.copy(getCamera().position);
  });

  return function space(opts) {
    const s = build(opts);
    return {
      sunDirection: s.sunDir.clone(),
      earth: s.earth,
      group: s.group,
      setSun(azimuth, elevation) {
        const d = dirFrom(azimuth, elevation);
        s.sunDir.copy(d);
        env.setSun({ direction: [d.x, d.y, d.z] });
        s.sunSprite.position.copy(d).multiplyScalar(R * 0.95);
      },
    };
  };
}
