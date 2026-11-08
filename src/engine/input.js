// Keyboard and mouse state. Key names are KeyboardEvent.code values:
// 'KeyW', 'ArrowLeft', 'Space', 'Enter', 'ShiftLeft', 'Digit1', ...
// pressed()/released() are true for exactly one fixed update after the event.
export function createInput(canvas) {
  const down = new Set();
  let pressedSet = new Set();
  let releasedSet = new Set();
  const mouse = {
    x: 0, y: 0,            // normalized device coordinates, -1..1 (y up)
    px: 0, py: 0,          // pixels from the top-left of the window
    dx: 0, dy: 0,          // movement since the last fixed update (pixels)
    wheel: 0,              // wheel delta since the last fixed update
    buttons: 0,            // bit mask: 1 left, 2 right, 4 middle
    clicked: false,        // left button pressed since the last fixed update
    rightClicked: false,
  };
  let anyKeyCallbacks = [];
  const BLOCK = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

  const onKeyDown = (e) => {
    if (BLOCK.has(e.code)) e.preventDefault();
    if (!e.repeat) {
      if (!down.has(e.code)) pressedSet.add(e.code);
      down.add(e.code);
      for (const cb of anyKeyCallbacks) cb(e.code);
    }
  };
  const onKeyUp = (e) => {
    if (down.has(e.code)) releasedSet.add(e.code);
    down.delete(e.code);
  };
  const onMouseMove = (e) => {
    mouse.px = e.clientX; mouse.py = e.clientY;
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    mouse.dx += e.movementX || 0;
    mouse.dy += e.movementY || 0;
  };
  const onMouseDown = (e) => {
    mouse.buttons = e.buttons;
    if (e.button === 0) { mouse.clicked = true; pressedSet.add('Mouse0'); down.add('Mouse0'); }
    if (e.button === 2) { mouse.rightClicked = true; pressedSet.add('Mouse2'); down.add('Mouse2'); }
    for (const cb of anyKeyCallbacks) cb('Mouse' + e.button);
  };
  const onMouseUp = (e) => {
    mouse.buttons = e.buttons;
    if (e.button === 0) { down.delete('Mouse0'); releasedSet.add('Mouse0'); }
    if (e.button === 2) { down.delete('Mouse2'); releasedSet.add('Mouse2'); }
  };
  const onWheel = (e) => { mouse.wheel += Math.sign(e.deltaY); };
  const onBlur = () => {
    for (const c of down) releasedSet.add(c);
    down.clear();
    mouse.buttons = 0;
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('blur', onBlur);
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  const has = (codes, set) => (Array.isArray(codes) ? codes.some((c) => set.has(c)) : set.has(codes));

  return {
    mouse,
    // isDown accepts one code or an array of codes (true if any is held).
    down: (codes) => has(codes, down),
    pressed: (codes) => has(codes, pressedSet),
    released: (codes) => has(codes, releasedSet),
    // axis(['KeyA','ArrowLeft'], ['KeyD','ArrowRight']) -> -1, 0 or 1
    axis(neg, pos) {
      return (has(pos, down) ? 1 : 0) - (has(neg, down) ? 1 : 0);
    },
    anyDown: () => down.size > 0,
    onAnyKey(cb) { anyKeyCallbacks.push(cb); return () => { anyKeyCallbacks = anyKeyCallbacks.filter((f) => f !== cb); }; },
    get pointerLocked() { return document.pointerLockElement === canvas; },
    requestPointerLock() {
      try {
        const p = canvas.requestPointerLock && canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch { /* not allowed here */ }
    },
    exitPointerLock() { try { document.exitPointerLock(); } catch { /* ignore */ } },
    // Called by the engine after each fixed update.
    endStep() {
      pressedSet = new Set();
      releasedSet = new Set();
      mouse.dx = 0; mouse.dy = 0; mouse.wheel = 0;
      mouse.clicked = false; mouse.rightClicked = false;
    },
    reset() { down.clear(); this.endStep(); },
  };
}
