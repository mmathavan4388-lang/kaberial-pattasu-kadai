/** Keyboard + mouse (pointer lock) input with per-frame "pressed" edges. */
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.mouseDown = false;
    this.enabled = true;
    this.sensitivity = 1;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'Tab', 'F5'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      this.mouseDown = true;
      if (this.enabled && document.pointerLockElement !== canvas && e.button === 0) {
        canvas.requestPointerLock?.();
      }
    });
    window.addEventListener('mouseup', () => (this.mouseDown = false));
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas || this.mouseDown) {
        this.mouseDX += e.movementX || 0;
        this.mouseDY += e.movementY || 0;
      }
    });
    canvas.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }
  key(code) {
    return this.enabled && this.down.has(code);
  }
  hit(code) {
    return this.enabled && this.pressed.has(code);
  }
  axis(neg, pos) {
    return (this.key(pos) ? 1 : 0) - (this.key(neg) ? 1 : 0);
  }
  endFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
  releasePointer() {
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
