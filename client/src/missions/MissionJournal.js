// client/src/missions/MissionJournal.js
// Mission journal (J).
//
// The list, the per-step progress and the "can I claim this yet?" answer all
// come from the server. Accepting and claiming are server calls; when a claim
// is refused the panel shows the server's own reason and the failing steps
// rather than guessing.

import { getMissions, acceptMission, claimMission } from '../auth/api.js';
import { icon } from '../ui/icons.js';
import { claimEscape } from '../ui/escape.js';

const CATEGORY_LABEL = {
  main: 'Main',
  side: 'Side',
  challenge: 'Challenge',
  exploration: 'Exploration',
};

const STATUS_LABEL = {
  available: 'Available',
  active: 'In progress',
  complete: 'Ready to claim',
  claimed: 'Claimed',
};

export class MissionJournal {
  /**
   * @param {object} o
   * @param {function} o.onToast   - (msg, type) => void
   * @param {function} o.onTracker - (missions) => void, push the HUD tracker
   * @param {function} o.onNavigate - (poi) => void, route to a mission giver
   */
  constructor({ onToast, onTracker, onNavigate } = {}) {
    this.token = null;
    this.missions = [];
    this.onToast = onToast || (() => {});
    this.onTracker = onTracker || (() => {});
    this.onNavigate = onNavigate || (() => {});

    this._build();
    this._bindKeys();
  }

  setToken(token) {
    this.token = token;
    this.refresh();
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'panel missions-panel hidden';
    el.innerHTML = `
      <header class="panel-head">
        <h2>${icon('activities', 18)} Mission Journal</h2>
        <button class="panel-close" type="button" aria-label="Close">${icon('close', 16)}</button>
      </header>
      <div class="missions-body"></div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this.bodyEl = el.querySelector('.missions-body');
    el.querySelector('.panel-close').addEventListener('click', () => this.hide());
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyJ' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        if (this.token) this.toggle();
      }
      if (e.code === 'Escape' && this.isOpen) {
        claimEscape(e);
        this.hide();
      }
    });
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  async show() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    document.body.classList.add('panel-open');
    await this.refresh();
  }

  hide() {
    this.isOpen = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('panel-open');
  }

  async refresh() {
    if (!this.token) return;
    const res = await getMissions(this.token);
    if (res.error) {
      this.bodyEl.innerHTML = `<p class="panel-empty">${res.error}</p>`;
      return;
    }
    this.missions = res.missions || [];
    this._render();
    this.onTracker(this.missions);
  }

  _render() {
    const order = { complete: 0, active: 1, available: 2, claimed: 3 };
    const list = this.missions.slice().sort(
      (a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
    );

    this.bodyEl.innerHTML = list.map((m, i) => {
      const status = STATUS_LABEL[m.status] || m.status;
      const cls = `mission-card status-${m.status}`;
      const steps = m.steps.map((s) => `
        <li class="mission-step ${s.done ? 'done' : ''}">
          <span class="mission-check">${s.done ? icon('check', 12) : ''}</span>
          <span>${s.text}</span>
        </li>
      `).join('');

      let action = '';
      if (m.status === 'available') {
        action = `<button class="mission-btn" data-act="accept" data-i="${i}">Accept</button>`;
      } else if (m.status === 'complete') {
        action = `<button class="mission-btn mission-claim" data-act="claim" data-i="${i}">Claim ₦${(m.reward?.cash || 0).toLocaleString('en-NG')}</button>`;
      } else if (m.status === 'claimed') {
        action = `<span class="mission-done">${icon('check', 13)} Completed</span>`;
      }

      return `
        <article class="${cls}">
          <header>
            <div>
              <span class="mission-cat">${CATEGORY_LABEL[m.category] || m.category}</span>
              <h3>${m.name}</h3>
            </div>
            <span class="mission-status">${status}</span>
          </header>
          <p class="mission-desc">${m.description}</p>
          <ul class="mission-steps">${steps}</ul>
          <div class="mission-foot">
            <span class="mission-reward">
              ${icon('cash', 13)} ₦${(m.reward?.cash || 0).toLocaleString('en-NG')}
              <span class="mission-xp">+${m.reward?.xp || 0} XP</span>
            </span>
            ${action}
          </div>
        </article>
      `;
    }).join('');

    this.bodyEl.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const mission = list[Number(btn.dataset.i)];
        if (!mission) return;
        if (btn.dataset.act === 'accept') await this._accept(mission);
        else await this._claim(mission);
      });
    });
  }

  async _accept(mission) {
    const res = await acceptMission(this.token, mission.id);
    if (res.error) {
      this.onToast(res.error, 'warning');
      return;
    }
    this.onToast(`Accepted: ${mission.name}`, 'success');
    await this.refresh();
  }

  async _claim(mission) {
    const res = await claimMission(this.token, mission.id);
    if (res.error) {
      // Show the server's reason plus which steps are still open
      const open = (res.steps || []).filter((s) => !s.done).map((s) => s.text);
      this.onToast(
        open.length ? `${res.error}: ${open.join(', ')}` : res.error,
        'warning'
      );
      return;
    }
    this.onToast(`Mission complete — ₦${(res.reward?.cash || 0).toLocaleString('en-NG')} paid`, 'success');
    await this.refresh();
  }
}
