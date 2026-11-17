/**
 * On-screen buttons for touch devices.
 *
 * Movement already uses the existing virtual joystick in PlayerController;
 * this adds the actions that otherwise need a keyboard:
 *   RUN  — hold to sprint
 *   E    — use the nearby bank/shop
 *   💬   — open chat
 *   A    — activities
 *   J    — jobs
 *   H    — housing
 *
 * Buttons synthesise the same key events the keyboard path uses, so there
 * is only one code path for each action.
 */
/** True on any device with a touch screen. One module owns this test. */
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  try {
    return ('ontouchstart' in window)
      || (navigator?.maxTouchPoints || 0) > 0
      || window.matchMedia?.('(pointer: coarse)')?.matches === true;
  } catch {
    return false;
  }
}

export class TouchControls {
  /**
   * @param {object} opts
   * @param {object} opts.controller - PlayerController instance (for the run key)
   * @param {function} opts.onChat - opens the chat input
   */
  constructor({ controller, onChat } = {}) {
    this.controller = controller;
    this.onChat = onChat || (() => {});

    this.isTouch = (
      'ontouchstart' in window ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches
    );

    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    if (!this.isTouch) this.root.classList.add('hidden');
    document.body.appendChild(this.root);

    this._render();
  }

  _render() {
    this.root.innerHTML = `
      <button class="touch-btn touch-btn-run" data-touch="run">RUN</button>
      <button class="touch-btn touch-btn-interact" data-touch="interact">E</button>
      <div class="touch-row">
        <button class="touch-btn touch-btn-small" data-touch="chat">💬</button>
        <button class="touch-btn touch-btn-small" data-touch="activities">✨</button>
        <button class="touch-btn touch-btn-small" data-touch="jobs">💼</button>
        <button class="touch-btn touch-btn-small" data-touch="home">🏠</button>
      </div>
    `;

    this._wire();
  }

  _wire() {
    // Run: press and hold
    const runBtn = this.root.querySelector('[data-touch="run"]');
    const setRun = (on) => {
      if (this.controller) this.controller.keys['ShiftLeft'] = on;
      runBtn.classList.toggle('touch-btn-active', on);
    };
    runBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); setRun(true); });
    runBtn.addEventListener('pointerup', (e) => { e.preventDefault(); setRun(false); });
    runBtn.addEventListener('pointercancel', () => setRun(false));
    runBtn.addEventListener('pointerleave', () => setRun(false));

    // Interact: same as pressing E
    this.root.querySelector('[data-touch="interact"]').addEventListener('click', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true }));
    });

    // Panels
    this.root.querySelector('[data-touch="activities"]').addEventListener('click', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    this.root.querySelector('[data-touch="jobs"]').addEventListener('click', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    });
    this.root.querySelector('[data-touch="home"]').addEventListener('click', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', bubbles: true }));
    });

    this.root.querySelector('[data-touch="chat"]').addEventListener('click', () => {
      this.onChat();
    });
  }
}
