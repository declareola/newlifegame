// client/src/ui/CharacterPanel.js
// Character sheet (I).
//
// Everything shown here is read back from GET /api/character, which returns the
// same user row the HUD and the economy use — so cash, bank, needs and progress
// can never drift between screens.

import { getCharacter } from '../auth/api.js';
import { icon } from '../ui/icons.js';
import { claimEscape } from './escape.js';

const TIER = {
  nepo: { label: 'Nepo baby', note: 'Started with ₦5,000,000' },
  middle: { label: 'Middle class', note: 'Started with ₦500,000' },
  lapo: { label: 'Lágòs pó', note: 'Started with ₦50,000 and a debt' },
};

const NEED_LABEL = {
  hunger: 'Hunger',
  energy: 'Energy',
  hygiene: 'Hygiene',
  bladder: 'Bladder',
  fun: 'Fun',
  social: 'Social',
};

const SKILLS = [
  ['smarts', 'Smarts'],
  ['charisma', 'Charisma'],
  ['fitness', 'Fitness'],
];

export class CharacterPanel {
  /**
   * @param {object} o
   * @param {function} o.onToast   - (msg, type) => void
   * @param {function} o.getNeeds  - () => live needs from the socket, or null
   * @param {function} o.getLook   - () => the player's current look
   * @param {function} o.applyLook - (patch) => void, changes the live avatar
   * @param {function} o.saveLook  - (look) => Promise<{user?|error?}>, persists it
   */
  constructor({ onToast, getNeeds, getLook, applyLook, saveLook } = {}) {
    this.token = null;
    this.onToast = onToast || (() => {});
    this.getNeeds = getNeeds || (() => null);
    this.getLook = getLook || (() => null);
    this.applyLook = applyLook || (() => null);
    this.saveLook = saveLook || (async () => ({ error: 'Not available' }));
    this._build();
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'KeyI' && this.token) this.toggle();
      if (e.code === 'Escape' && this.isOpen) {
        claimEscape(e);
        this.hide();
      }
    });
  }

  setToken(token) {
    this.token = token;
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'panel character-panel hidden';
    el.innerHTML = `
      <header class="panel-head">
        <h2>${icon('user', 18)} Character</h2>
        <button class="panel-close" type="button" aria-label="Close">${icon('close', 16)}</button>
      </header>
      <div class="character-body"><p class="panel-empty">Loading…</p></div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this.bodyEl = el.querySelector('.character-body');
    el.querySelector('.panel-close').addEventListener('click', () => this.hide());
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
    const res = await getCharacter(this.token);
    if (res.error) {
      this.bodyEl.innerHTML = `<p class="panel-empty">${res.error}</p>`;
      return;
    }
    this._render(res.user, res.stats);
  }

  _render(user, stats) {
    const tier = TIER[user.tier] || { label: user.tier, note: '' };
    const live = this.getNeeds();
    const needs = live || {
      hunger: user.hunger, energy: user.energy, hygiene: user.hygiene,
      bladder: user.bladder, fun: user.fun, social: user.social,
    };

    const needRows = Object.keys(NEED_LABEL).map((k) => {
      const v = Math.max(0, Math.min(100, Number(needs[k]) || 0));
      return `
        <div class="char-need">
          <span class="char-need-label">${NEED_LABEL[k]}</span>
          <span class="char-need-bar"><i style="width:${v}%"></i></span>
          <span class="char-need-value">${Math.round(v)}</span>
        </div>
      `;
    }).join('');

    const skillRows = SKILLS.map(([key, label]) => {
      const v = Number(user[key]) || 0;
      return `
        <div class="char-skill">
          <span>${label}</span>
          <span class="char-skill-value">${v.toFixed(1)}</span>
        </div>
      `;
    }).join('');

    this.bodyEl.innerHTML = `
      <div class="char-head">
        <div class="char-name">${user.username}</div>
        <div class="char-tier">${tier.label}<span class="char-tier-note">${tier.note}</span></div>
      </div>

      <div class="char-grid">
        <div class="char-stat"><span>Cash</span><b>₦${Math.round(user.cash || 0).toLocaleString('en-NG')}</b></div>
        <div class="char-stat"><span>Bank</span><b>₦${Math.round(user.bank_balance || 0).toLocaleString('en-NG')}</b></div>
        <div class="char-stat"><span>Debt</span><b class="${user.debt > 0 ? 'is-bad' : ''}">₦${Math.round(user.debt || 0).toLocaleString('en-NG')}</b></div>
        <div class="char-stat"><span>Earned total</span><b>₦${Math.round(stats.totalEarned || 0).toLocaleString('en-NG')}</b></div>
      </div>

      <h3 class="char-section">Needs</h3>
      <div class="char-needs">${needRows}</div>

      <h3 class="char-section">Skills</h3>
      <div class="char-skills">${skillRows}</div>

      <h3 class="char-section">Progress</h3>
      <ul class="char-list">
        <li><span>Job</span><b>${user.job_type ? user.job_type.replace(/_/g, ' ') : 'unemployed'}</b></li>
        <li><span>Home</span><b>${stats.home || 'none'}</b></li>
        <li><span>Items in bag</span><b>${stats.itemCount}</b></li>
        <li><span>Items used</span><b>${stats.itemsUsed}</b></li>
        <li><span>Vehicles owned</span><b>${stats.vehicleCount}</b></li>
        <li><span>Missions claimed</span><b>${stats.missionsClaimed}</b></li>
        <li><span>Missions active</span><b>${stats.missionsActive}</b></li>
        <li><span>Districts visited</span><b>${stats.districts.length ? stats.districts.join(', ') : 'none yet'}</b></li>
      </ul>

      <h3 class="char-section">Appearance</h3>
      <div class="char-look" id="char-look"></div>
      <p class="char-look-note">Changes apply immediately and are saved to your account.</p>
    `;

    this._renderLook();
  }

  // ── Appearance editor ─────────────────────────────────────
  //
  // The panel edits the live avatar, so what you see on the panel is what you
  // are wearing when it closes. Every change is sent to the server; a failed
  // save is reported instead of silently pretending it stuck.
  _renderLook() {
    const host = this.el.querySelector('#char-look');
    const look = this.getLook();
    if (!host || !look) return;

    host.innerHTML = `
      <div class="look-row">
        <span class="look-label">Skin</span>
        <div class="look-swatches">
          ${SKIN_TONES.map((t) => `
            <button type="button" class="look-swatch ${look.skin === t.hex ? 'active' : ''}"
                    data-skin="${t.hex}" style="background:${intToHex(t.hex)}" title="${t.label}"></button>
          `).join('')}
        </div>
      </div>
      <div class="look-row">
        <span class="look-label">Hair</span>
        <div class="look-chips">
          ${HAIR_STYLES.map((h) => `
            <button type="button" class="look-chip ${look.hair === h.id ? 'active' : ''}" data-hair="${h.id}">${h.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="look-row">
        <span class="look-label">Build</span>
        <div class="look-chips">
          ${BODY_TYPES.map((b) => `
            <button type="button" class="look-chip ${look.body === b.id ? 'active' : ''}" data-body="${b.id}">${b.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="look-row">
        <span class="look-label">Outfit</span>
        <div class="look-chips">
          ${OUTFITS.map((o) => `
            <button type="button" class="look-chip ${look.outfit === o.id ? 'active' : ''}" data-outfit="${o.id}">${o.label}</button>
          `).join('')}
        </div>
      </div>
    `;

    const commit = async (patch) => {
      const next = this.applyLook(patch);
      this._renderLook();
      if (!next) return;
      const res = await this.saveLook(next);
      if (res && res.error) this.onToast(res.error, 'warning');
    };

    host.querySelectorAll('[data-skin]').forEach((b) => {
      b.addEventListener('click', () => commit({ skin: Number(b.dataset.skin) }));
    });
    host.querySelectorAll('[data-hair]').forEach((b) => {
      b.addEventListener('click', () => commit({ hair: b.dataset.hair }));
    });
    host.querySelectorAll('[data-body]').forEach((b) => {
      b.addEventListener('click', () => commit({ body: b.dataset.body }));
    });
    host.querySelectorAll('[data-outfit]').forEach((b) => {
      b.addEventListener('click', () => commit(withOutfit(look, b.dataset.outfit)));
    });
  }
}
