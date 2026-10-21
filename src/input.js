// Keyboard + mouse state. Game reads it; nothing here knows about the game.
export const input = {
  keys: new Set(),
  pressed: new Set(), // codes pressed since the last frame, so sub-frame taps are not lost
  mouse: { dx: 0, dy: 0, left: false, right: false },
  locked: false,
  sensitivity: Number(localStorage.getItem('pw.sens') || 1),
  consumeLook() {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy };
    this.mouse.dx = this.mouse.dy = 0;
    return d;
  },
  down(code) { return this.keys.has(code); },
};

addEventListener('keydown', e => {
  if (e.target instanceof HTMLInputElement) return;
  input.keys.add(e.code);
  if (!e.repeat) input.pressed.add(e.code);
  if (input.locked && ['Space', 'Tab'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => input.keys.delete(e.code));
addEventListener('blur', () => { input.keys.clear(); input.mouse.left = input.mouse.right = false; });
addEventListener('mousemove', e => {
  if (!input.locked) return;
  input.mouse.dx += e.movementX;
  input.mouse.dy += e.movementY;
});
addEventListener('mousedown', e => {
  if (!input.locked) return;
  if (e.button === 0) { input.mouse.left = true; input.pressed.add('Mouse0'); }
  if (e.button === 2) { input.mouse.right = true; input.pressed.add('Mouse2'); }
});
addEventListener('mouseup', e => {
  if (e.button === 0) input.mouse.left = false;
  if (e.button === 2) input.mouse.right = false;
});
addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('pointerlockchange', () => {
  input.locked = !!document.pointerLockElement;
  if (!input.locked) input.mouse.left = input.mouse.right = false;
});
