// client/src/ui/WantedPanel.js
// The faction matrix: three factions, four tiers, and what each tier costs you.
//
// This panel exists because heat with no visible consequence is a lie. Every
// number here is the server's answer to GET /api/wanted:
//   · which faction owns the ground you are standing on
//   · how many stars you carry with each of the three
//   · what that tier does to you (watched at 1, refused service at 3,
//     arrested on sight at 4)
//   · what each faction would charge to forget you — and the bribe button
//     charges exactly that, on the server, or it does not charge at all.
//
// Nothing here guesses. If the server has not answered, the panel says so
// rather than showing a plausible zero.

import { getWanted, payBribe } from '../auth/api.js';
import { icon } from './icons.js';
import { claimEscape } from './escape.js';

function naira(n) {
  return '₦' + Math.round(n || 0).toLocaleString('en-NG');
}

const TIER_STYLE = ['clean', 'noticed', 'flagged', 'hunted', 'marked'];

export class WantedPanel {
  /**
   * @param {object} o
   * @param {function} o.getToken - () => string|null
   * @param {function} o.onToast  - (msg, type) => void
   * @param {function} [o.onChanged] - called with the fresh matrix after a bribe
   */
  constructor({ getToken, onToast, onChanged } = {}) {
    this.getToken = getToken || (() => null);
    this.onToast = onToast || (() => {});
    this.onChanged = onChanged || (() => {});
    this.open = false;
    this.busy = false;
    this.data = null;
    this._build();

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.open) {
        claimEscape(e);
        this.hide();
      }
    });
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'venue-panel wanted-panel hidden';
    root.innerHTML = `
      <div class="venue-backdrop" data-wanted-close></div>
      <div class="venue-card wanted-card" role="dialog" aria-label="Wanted">
        <div class="venue-head">
          <h2>${icon('warning', 18)} Wanted</h2>
          <button class="venue-close" data-wanted-close aria-label="Close">${icon('close', 18)}</button>
        </div>
        <div class="wanted-body">
          <p class="wanted-lede">Three factions run this city. Heat is kept per faction —
            robbing the docks does not make the Island angry.</p>
          <div class="wanted-where"></div>
          <div class="wanted-grid"></div>
          <div class="wanted-most"></div>
        </div>
        <div class="venue-error" style="display:none"></div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.whereEl = root.querySelector('.wanted-where');
    this.gridEl = root.querySelector('.wanted-grid');
    this.mostEl = root.querySelector('.wanted-most');
    this.errorEl = root.querySelector('.venue-error');

    root.querySelectorAll('[data-wanted-close]').forEach((el) =>
      el.addEventListener('click', () => this.hide()));

    // Bribes are delegated: the body re-renders on every answer.
    this.gridEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bribe]');
      if (btn) this._bribe(btn.dataset.bribe, btn);
    });
  }

  async show() {
    this.open = true;
    this.root.classList.remove('hidden');
    document.body.classList.add('panel-open');
    await this.refresh();
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
    document.body.classList.remove('panel-open');
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  async refresh() {
    const token = this.getToken();
    if (!token) return;
    try {
      this.data = await getWanted(token);
      this._error(null);
    } catch (err) {
      this._error(err.message || 'Could not read your record');
    }
    this.render();
  }

  _error(msg) {
    if (!this.errorEl) return;
    this.errorEl.textContent = msg || '';
    this.errorEl.style.display = msg ? '' : 'none';
  }

  render() {
    const d = this.data;
    if (!d || !d.wanted) {
      this.whereEl.textContent = '';
      this.gridEl.innerHTML = '<p class="wanted-empty">The police records are not answering.</p>';
      this.mostEl.innerHTML = '';
      return;
    }

    const here = d.here;
    const owner = here?.faction
      ? d.wanted.factions.find((f) => f.id === here.faction)
      : null;
    this.whereEl.innerHTML = here
      ? `<span class="wanted-here">You are in <b>${here.name}</b>${owner
          ? ` — ${owner.short} ground (${owner.stars}★)`
          : here.faction ? ' — nobody\'s ground' : ' — neutral ground'}</span>`
      : '<span class="wanted-here">You are not in the city.</span>';

    this.gridEl.innerHTML = d.wanted.factions.map((f) => {
      const tier = TIER_STYLE[Math.min(4, f.stars)];
      const pips = Array.from({ length: 4 }, (_, i) =>
        `<span class="wanted-pip ${i < f.stars ? 'on' : ''}"></span>`).join('');
      const canBribe = f.stars > 0;
      const afford = (d.cash ?? Infinity) >= f.bribePrice;
      return `
        <div class="wanted-faction ${tier}">
          <div class="wanted-fhead">
            <span class="wanted-fname">${f.name}</span>
            <span class="wanted-fshort">${f.short}</span>
          </div>
          <div class="wanted-pips">${pips}</div>
          <div class="wanted-ftier">${f.stars}★ · ${f.label}</div>
          <div class="wanted-fresponse">${f.response || ''}</div>
          <div class="wanted-fhome">Turf: ${(f.islands || []).join(', ') || '—'}</div>
          <div class="wanted-fpolice">${f.police || ''}</div>
          <button class="wanted-bribe" data-bribe="${f.id}"
            ${canBribe && afford ? '' : 'disabled'}
            ${canBribe && !afford ? 'data-poor="1"' : ''}>
            ${!canBribe ? 'Not interested in you'
              : afford ? `Bribe ${naira(f.bribePrice)}`
              : `Needs ${naira(f.bribePrice)}`}
          </button>
        </div>`;
    }).join('');

    const most = d.wanted.mostWanted || [];
    this.mostEl.innerHTML = most.length
      ? `<h3>Most wanted in Eko Basin</h3>
         <ol class="wanted-list">${most.map((m) => `
           <li><span class="wanted-lname">${m.username}${m.you ? ' (you)' : ''}</span>
               <span class="wanted-lstars">${'★'.repeat(m.stars)}${'☆'.repeat(4 - m.stars)}</span>
               <span class="wanted-lf">${m.short}</span></li>`).join('')}</ol>`
      : '<p class="wanted-empty">Nobody is hot right now.</p>';
  }

  async _bribe(factionId, btn) {
    if (this.busy) return;
    const token = this.getToken();
    if (!token) return;
    const faction = this.data?.wanted?.factions?.find((f) => f.id === factionId);
    this.busy = true;
    btn.disabled = true;
    btn.textContent = 'Paying…';
    try {
      const res = await payBribe(token, factionId);
      this.onToast(`${faction?.short || 'Faction'} paid off — ${naira(res.paid)}. You are clean.`, 'success');
      await this.refresh();
      this.onChanged(this.data?.wanted);
    } catch (err) {
      this._error(err.message || 'The bribe was refused');
      this.onToast(err.message || 'The bribe was refused', 'error');
      await this.refresh();
    } finally {
      this.busy = false;
    }
  }
}
