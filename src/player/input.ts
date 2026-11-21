/** Keyboard + mouse state. Movement keys use KeyboardEvent.code so they work on any layout. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  locked = false;
  /**
   * Playing without pointer lock: the mouse still turns the camera while it is over the window.
   * Browsers will not re-lock the pointer from the Esc key, so after Esc-to-resume we play like
   * this until the next ordinary key press re-locks it.
   */
  free = false;
  /** re-request pointer lock on the next key press (a key press counts as a user gesture) */
  wantLock = false;
  /**
   * Auto-run (Z): keep moving forward without holding W. Laptop touchpads switch off while a key
   * is held ("disable while typing"), so this frees the touchpad for looking around while you move.
   * S cancels it.
   */
  autoRun = false;

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.down.has(e.code)) {
        this.pressed.add(e.code);
        if (e.code === 'KeyZ') this.autoRun = !this.autoRun;
        if (e.code === 'KeyS') this.autoRun = false;
      }
      this.down.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (this.wantLock && !this.locked && e.code !== 'Escape') this.lock();
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked && !this.free) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  lock() {
    try { this.el.requestPointerLock()?.catch?.(() => {}); } catch { /* ignore */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

  isDown(code: string) { return this.down.has(code); }
  wasPressed(code: string) { return this.pressed.has(code); }

  /** WASD: move (or throttle and steer when driving) */
  axis() {
    const f = (this.isDown('KeyW') || this.autoRun ? 1 : 0) - (this.isDown('KeyS') ? 1 : 0);
    const r = (this.isDown('KeyD') ? 1 : 0) - (this.isDown('KeyA') ? 1 : 0);
    return { f, r };
  }

  /** arrow keys: turn the camera, so you can look around while moving (touchpads switch off while typing) */
  lookAxis() {
    const yaw = (this.isDown('ArrowRight') ? 1 : 0) - (this.isDown('ArrowLeft') ? 1 : 0);
    const pitch = (this.isDown('ArrowDown') ? 1 : 0) - (this.isDown('ArrowUp') ? 1 : 0);
    return { yaw, pitch };
  }

  /** drop this frame's key presses and mouse movement (used while paused) */
  clearFrame() {
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }

  /** call at the end of every frame */
  endFrame() { this.clearFrame(); }
}
