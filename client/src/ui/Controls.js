// client/src/ui/Controls.js
// Single authoritative keymap + the controls guide + the pause menu.
//
// Every binding lives in KEYMAP and is dispatched through one listener. That is
// what stops two systems from fighting over a key — previously 'C' toggled the
// camera *and* crouched, and 'A' both strafed left and opened the activities
// panel. Anything shown in the guide is dispatched here, so the guide cannot
// drift out of sync with reality.

import { icon } from './icons.js';

export const KEYMAP = {
  // Movement
  KeyW: { group: 'Movement', label: 'Walk forward' },
  KeyS: { group: 'Movement', label: 'Walk back' },
  KeyA: { group: 'Movement', label: 'Strafe left' },
  KeyD: { group: 'Movement', label: 'Strafe right' },
  ShiftLeft: { group: 'Movement', label: 'Sprint' },
  Space: { group: 'Movement', label: 'Jump' },
  KeyC: { group: 'Movement', label: 'Crouch (toggle)' },

  // Camera
  KeyV: { group: 'Camera', label: 'Camera mode: follow → isometric → first person' },
  Wheel: { group: 'Camera', label: 'Zoom in / out' },
  MouseDrag: { group: 'Camera', label: 'Look around' },

  // World interaction
  KeyE: { group: 'Interaction', label: 'Interact / enter building / talk' },
  KeyF: { group: 'Interaction', label: 'Enter or exit a vehicle' },
  KeyM: { group: 'Interaction', label: 'World map' },

  // Panels
  Tab: { group: 'Panels', label: 'Inventory' },
  KeyI: { group: 'Panels', label: 'Character sheet' },
  KeyJ: { group: 'Panels', label: 'Mission journal' },
  KeyK: { group: 'Panels', label: 'Job board' },
  KeyH: { group: 'Panels', label: 'Housing' },
  KeyG: { group: 'Panels', label: 'Activities' },
  KeyL: { group: 'Panels', label: 'Leaderboard' },
  KeyQ: { group: 'Panels', label: 'Graphics quality' },
  Escape: { group: 'Panels', label: 'Pause menu / close panel' },
  Enter: { group: 'Panels', label: 'Chat' },

  // Number keys mirror the action bar
  Digit1: { group: 'Action bar', label: 'Jobs' },
  Digit2: { group: 'Action bar', label: 'Activities' },
  Digit3: { group: 'Action bar', label: 'Property' },
  Digit4: { group: 'Action bar', label: 'Places / map' },
  Digit5: { group: 'Action bar', label: 'Ranks' },
  Digit6: { group: 'Action bar', label: 'Camera' },
  Digit7: { group: 'Action bar', label: 'Graphics' },
};

const TOUCH_HINT = [
  ['Left thumb pad', 'Walk / run'],
  ['Drag the screen', 'Look around'],
  ['Buttons', 'Jump · Interact · Chat · Menu'],
];

export class Controls {
  /**
   * @param {object} o
   * @param {function} o.dispatch - (action) => void, action is a KEYMAP key or a semantic id
   * @param {function} o.onPause  - (paused:boolean) => void
   * @param {object} o.state      - live getters for the pause/status panel
   */
  constructor({ dispatch, onPause, getStatus, touch = false } = {}) {
    this.dispatch = dispatch || (() => {});
    this.onPause = onPause || (() => {});
    this.getStatus = getStatus || (() => ({}));
    this.touch = touch;
    this.paused = false;
    this.helpOpen = false;
    this.pauseOpen = false;

    this._buildHelp();
    this._buildPause();
    this._bind();
  }

  // ── Controls guide ────────────────────────────────────────

  _buildHelp() {
    const el = document.createElement('div');
    el.className = 'controls-overlay hidden';

    const groups = {};
    for (const [key, meta] of Object.entries(KEYMAP)) {
      if (!groups[meta.group]) groups[meta.group] = [];
      groups[meta.group].push({ key, label: meta.label });
    }

    const keyLabel = (k) => {
      if (k === 'Wheel') return 'Scroll';
      if (k === 'MouseDrag') return 'Drag';
      if (k.startsWith('Key')) return k.slice(3);
      if (k === 'ShiftLeft') return 'Shift';
      if (k === 'Space') return 'Space';
      if (k === 'Escape') return 'Esc';
      if (k.startsWith('Digit')) return k.slice(5);
      return k;
    };

    el.innerHTML = `
      <div class="controls-panel" role="dialog" aria-label="Controls">
        <header>
          <h2>${icon('info', 18)} How to play</h2>
          <button class="controls-close" type="button" aria-label="Close">${icon('close', 16)}</button>
        </header>
        <div class="controls-body">
          ${Object.entries(groups).map(([group, items]) => `
            <section class="controls-group">
              <h3>${group}</h3>
              ${items.map(({ key, label }) => `
                <div class="controls-row">
                  <kbd>${keyLabel(key)}</kbd>
                  <span>${label}</span>
                </div>
              `).join('')}
            </section>
          `).join('')}
          ${this.touch ? `
            <section class="controls-group">
              <h3>Touch</h3>
              ${TOUCH_HINT.map(([k, v]) => `
                <div class="controls-row"><kbd>${k}</kbd><span>${v}</span></div>
              `).join('')}
            </section>
          ` : ''}
        </div>
        <footer class="controls-foot">
          Walk up to a glowing ring and press <kbd>E</kbd> to go inside. Press <kbd>M</kbd> for the map.
          <button class="controls-start" type="button">Got it</button>
        </footer>
      </div>
    `;
    document.body.appendChild(el);

    this.helpEl = el;
    el.querySelector('.controls-close').addEventListener('click', () => this.closeHelp());
    el.querySelector('.controls-start').addEventListener('click', () => this.closeHelp());
    el.addEventListener('click', (e) => {
      if (e.target === el) this.closeHelp();
    });
  }

  openHelp() {
    if (this.pauseOpen) this.closePause();
    this.helpOpen = true;
    this.helpEl.classList.remove('hidden');
    this.onPause(true);
  }

  closeHelp() {
    this.helpOpen = false;
    this.helpEl.classList.add('hidden');
    if (!this.pauseOpen) this.onPause(false);
  }

  // ── Pause menu ────────────────────────────────────────────

  _buildPause() {
    const el = document.createElement('div');
    el.className = 'pause-overlay hidden';
    el.innerHTML = `
      <div class="pause-panel" role="dialog" aria-label="Paused">
        <h2>${icon('settings', 20)} Paused</h2>
        <div class="pause-status"></div>
        <div class="pause-actions">
          <button data-act="resume" class="pause-primary">Resume</button>
          <button data-act="help">Controls</button>
          <button data-act="save">Save progress</button>
          <button data-act="logout" class="pause-danger">Log out</button>
        </div>
        <p class="pause-note">Your progress is stored on the server as you play — cash, needs,
        position, property and missions are all saved automatically.</p>
      </div>
    `;
    document.body.appendChild(el);
    this.pauseEl = el;
    this.pauseStatusEl = el.querySelector('.pause-status');

    el.querySelector('[data-act="resume"]').addEventListener('click', () => this.closePause());
    el.querySelector('[data-act="help"]').addEventListener('click', () => this.openHelp());
    el.querySelector('[data-act="save"]').addEventListener('click', () => {
      this.dispatch('save');
    });
    el.querySelector('[data-act="logout"]').addEventListener('click', () => {
      this.dispatch('logout');
    });
  }

  openPause() {
    this.pauseOpen = true;
    this.pauseEl.classList.remove('hidden');
    this._renderStatus();
    this.onPause(true);
  }

  closePause() {
    this.pauseOpen = false;
    this.pauseEl.classList.add('hidden');
    if (!this.helpOpen) this.onPause(false);
  }

  togglePause() {
    if (this.pauseOpen) this.closePause();
    else this.openPause();
  }

  _renderStatus() {
    const s = this.getStatus() || {};
    const rows = [
      ['Location', s.location || '—'],
      ['Cash', s.cash || '—'],
      ['Bank', s.bank || '—'],
      ['Job', s.job || 'Unemployed'],
      ['Home', s.home || 'Homeless'],
      ['Objective', s.objective || 'None'],
    ];
    this.pauseStatusEl.innerHTML = rows.map(([k, v]) => `
      <div class="pause-row"><span>${k}</span><strong>${v}</strong></div>
    `).join('');
  }

  // ── Dispatch ──────────────────────────────────────────────

  _bind() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      const typing = tag === 'INPUT' || tag === 'TEXTAREA';

      // Escape always works: it closes whatever is open, else opens pause
      if (e.code === 'Escape') {
        if (this.helpOpen) { this.closeHelp(); return; }
        if (this.pauseOpen) { this.closePause(); return; }
        this.openPause();
        return;
      }

      if (typing) return;

      // Tab is the inventory key — stop the browser moving focus
      if (e.code === 'Tab') {
        e.preventDefault();
        this.dispatch('Tab');
        return;
      }

      if (e.code === 'KeyP') return;

      if (KEYMAP[e.code] && !this.paused) {
        // Movement keys are handled continuously by PlayerController; only
        // "press once" actions are dispatched here.
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyC'].includes(e.code)) return;
        if (e.repeat) return;
        this.dispatch(e.code);
      }
    });
  }
}
