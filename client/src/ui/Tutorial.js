// client/src/ui/Tutorial.js
// First-run guide.
//
// The controls guide already existed, but it opens on demand and dumps every
// binding at once. A new player needs four things in the first thirty seconds:
// how to move, how to turn the camera (including first person), how to interact,
// and where their money and needs are. Those four get their own cards, then the
// full list is one click away.
//
// Shown once per account per browser. "Show again" lives in the pause menu, so
// nobody loses it forever.

import { icon } from './icons.js';

const CARDS = [
  {
    title: 'Walk the city',
    icon: 'walk',
    rows: [
      ['W A S D', 'Move'],
      ['Shift', 'Run'],
      ['Space', 'Jump'],
      ['C', 'Crouch'],
    ],
    hint: 'Lagos is 190 metres across. Everything is walkable.',
  },
  {
    title: 'See it your way',
    icon: 'camera',
    rows: [
      ['V', 'Third person → first person → top-down'],
      ['Mouse drag', 'Look around, or click to capture the mouse'],
      [', .', 'Turn without the mouse'],
      ['Wheel', 'Zoom out and in'],
    ],
    hint: 'First person is the best way to look around inside a market or a church.',
  },
  {
    title: 'Do things',
    icon: 'hand',
    rows: [
      ['E', 'Interact — doors, ATMs, counters, people'],
      ['F', 'Enter or leave a vehicle'],
      ['L', 'Ranks and the leaderboard'],
    ],
    hint: 'Walk up to a glowing marker and press E. You can walk into the market, the bank, the church, the hospital and the airport.',
  },
  {
    title: 'Stay alive',
    icon: 'needs',
    rows: [
      ['Hunger · Energy · Hygiene', 'They fall all day'],
      ['Pause (Esc)', 'Save, settings, sign out'],
      ['F2', 'Live debug panel'],
    ],
    hint: 'Work pays, food costs. The needs bar is at the top of the screen.',
  },
];

const STORAGE_PREFIX = 'newlife.tutorial.seen.';

export class Tutorial {
  constructor({ onControls, onFinish } = {}) {
    this.onControls = onControls || (() => {});
    this.onFinish = onFinish || (() => {});
    this.index = 0;
    this.isOpen = false;
  }

  static hasSeen(username) {
    try {
      return localStorage.getItem(STORAGE_PREFIX + username) === '1';
    } catch {
      return false;
    }
  }

  static markSeen(username) {
    try {
      localStorage.setItem(STORAGE_PREFIX + username, '1');
    } catch { /* private mode: it will show again, which is harmless */ }
  }

  static reset(username) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + username);
    } catch { /* nothing to do */ }
  }

  show({ username, force = false } = {}) {
    if (!force && Tutorial.hasSeen(username)) return false;
    this.username = username;
    this.index = 0;
    this.isOpen = true;
    this._build();
    this._renderCard();
    return true;
  }

  _build() {
    this.el = document.createElement('div');
    this.el.className = 'tutorial-overlay';
    this.el.innerHTML = `
      <div class="tutorial-card" role="dialog" aria-label="Getting started">
        <header class="tutorial-head">
          <span class="tutorial-icon"></span>
          <div>
            <h2 class="tutorial-title"></h2>
            <p class="tutorial-step"></p>
          </div>
        </header>
        <div class="tutorial-rows"></div>
        <p class="tutorial-hint"></p>
        <footer class="tutorial-foot">
          <button class="tutorial-skip" type="button">Skip</button>
          <div class="tutorial-nav">
            <button class="tutorial-controls" type="button">All controls (F1)</button>
            <button class="tutorial-next" type="button">Next</button>
          </div>
        </footer>
      </div>
    `;
    document.body.appendChild(this.el);

    this.el.querySelector('.tutorial-skip').addEventListener('click', () => this.close());
    this.el.querySelector('.tutorial-next').addEventListener('click', () => this._next());
    this.el.querySelector('.tutorial-controls').addEventListener('click', () => this.onControls());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowRight') this._next();
      if (e.key === 'Escape') this.close();
    });
  }

  _renderCard() {
    const card = CARDS[this.index];
    this.el.querySelector('.tutorial-icon').innerHTML = icon(card.icon || 'walk', 26);
    this.el.querySelector('.tutorial-title').textContent = card.title;
    this.el.querySelector('.tutorial-step').textContent = `Step ${this.index + 1} of ${CARDS.length}`;
    this.el.querySelector('.tutorial-rows').innerHTML = card.rows.map(([key, label]) => `
      <div class="tutorial-row"><kbd>${key}</kbd><span>${label}</span></div>
    `).join('');
    this.el.querySelector('.tutorial-hint').textContent = card.hint;
    this.el.querySelector('.tutorial-next').textContent =
      this.index === CARDS.length - 1 ? 'Start playing' : 'Next';
    this.el.querySelector('.tutorial-next').focus();
  }

  _next() {
    if (this.index < CARDS.length - 1) {
      this.index += 1;
      this._renderCard();
      return;
    }
    this.close();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    Tutorial.markSeen(this.username);
    this.el.remove();
    this.onFinish();
  }
}

export { CARDS as TUTORIAL_CARDS };
