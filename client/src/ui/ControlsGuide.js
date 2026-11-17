// client/src/ui/ControlsGuide.js
// The controls guide: shown once on first successful login, and reopenable at
// any time from the pause menu (Esc) or the action bar.
//
// Every row here is a binding that actually exists in the code:
//   W A S D / arrows move · Shift sprint · Space jump (on foot) or brake (driving)
//   C crouch · V camera · E interact · F vehicle · Tab bag · M map · J missions
//   K jobs · G activities · H housing · L ranks · I character · Esc pause
//   Mouse drag look · , . turn · PgUp/PgDn tilt · wheel zoom
//   1-9 action bar / dialogue options

import { icon } from './icons.js';
import { claimEscape } from './escape.js';

const GROUPS = [
  {
    title: 'On foot',
    rows: [
      ['W A S D', 'Walk'],
      ['Shift', 'Sprint'],
      ['Space', 'Jump'],
      ['C', 'Crouch'],
      ['V', 'Camera: third person → first person → top-down'],
      ['Mouse drag', 'Look around — or click to capture the mouse'],
      [', .', 'Turn the camera left / right'],
      ['PgUp PgDn', 'Tilt the camera up / down'],
      ['Wheel', 'Zoom (third person only)'],
    ],
  },
  {
    title: 'The world',
    rows: [
      ['E', 'Interact — doors, ATMs, shops, people'],
      ['F', 'Enter or leave a vehicle'],
      ['M', 'World map: pick a destination, get a route'],
    ],
  },
  {
    title: 'Panels',
    rows: [
      ['Tab', 'Inventory — use and drop items'],
      ['J', 'Mission journal'],
      ['K', 'Job board'],
      ['G', 'Activities'],
      ['H', 'Property and housing'],
      ['L', 'Leaderboard'],
      ['I', 'Character sheet'],
      ['Esc', 'Pause menu, save and logging out'],
      ['F2', 'Visual tuning panel — exposure, fog, shadows, AO'],
      ['1 – 9', 'Action bar shortcuts'],
    ],
  },
  {
    title: 'Driving',
    rows: [
      ['W / S', 'Throttle and reverse'],
      ['A / D', 'Steer'],
      ['Space', 'Brake'],
      ['E', 'Refuel when stopped at a pump'],
      ['F', 'Step out'],
    ],
  },
];

export class ControlsGuide {
  /**
   * @param {object} o
   * @param {function} o.onDismiss - called when the player closes the guide
   */
  constructor({ onDismiss } = {}) {
    this.onDismiss = onDismiss || (() => {});
    this.isOpen = false;
    this._build();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F1') {
        e.preventDefault();
        this.toggle();
      }
      if (e.code === 'Escape' && this.isOpen) {
        claimEscape(e);
        this.hide();
      }
    });
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'controls-overlay hidden';
    el.innerHTML = `
      <div class="controls-panel" role="dialog" aria-label="Controls">
        <header class="controls-head">
          <h2>${icon('settings', 20)} How to play</h2>
          <button class="controls-close" type="button" aria-label="Close">${icon('close', 18)}</button>
        </header>
        <div class="controls-body">
          ${GROUPS.map((g) => `
            <section class="controls-group">
              <h3>${g.title}</h3>
              ${g.rows.map(([key, text]) => `
                <div class="controls-row">
                  <kbd>${key}</kbd>
                  <span>${text}</span>
                </div>
              `).join('')}
            </section>
          `).join('')}
        </div>
        <footer class="controls-foot">
          <span>You can reopen this any time with <kbd>F1</kbd> or from the pause menu.</span>
          <button class="controls-start" type="button">Start playing</button>
        </footer>
      </div>
    `;
    document.body.appendChild(el);
    this.el = el;
    el.querySelector('.controls-close').addEventListener('click', () => this.hide());
    el.querySelector('.controls-start').addEventListener('click', () => this.hide());
    // Clicking the dimmed backdrop dismisses the guide, like Escape.
    el.addEventListener('click', (e) => {
      if (e.target === el) this.hide();
    });
  }

  /** Show only the first time for a given username. */
  showOnce(username) {
    const key = `newlife_controls_seen_${username || 'guest'}`;
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, '1');
    this.show();
    return true;
  }

  show() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    document.body.classList.add('panel-open');
  }

  hide() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('panel-open');
    this.onDismiss();
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }
}
