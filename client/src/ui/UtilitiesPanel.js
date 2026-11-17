// client/src/ui/UtilitiesPanel.js
// The meter cupboard: electricity, water, gas, and the solar array.
//
// Everything on this panel is a reading from the server. The bars are the
// server's numbers, the prices are the server's prices, and the buttons post to
// the server and then re-render from its answer. There is no local guesswork
// here, because a meter you can lie to is not a meter.
//
// What the readings mean:
//   · power drains with the game clock at "today's load" — the sum of the
//     appliances you have switched on, off the roof if you have solar
//   · water drains as the house is lived in
//   · gas is for cooking; with an empty bottle the hob refuses to light
//   · switching everything off stops the meter — but then the TV will not come
//     on either, and the server says so in its own words

import { getUtilities, topUpUtility, toggleAppliance, buySolarPanels } from '../auth/api.js';
import { icon } from './icons.js';
import { claimEscape } from './escape.js';

function naira(n) {
  return '₦' + Math.round(n || 0).toLocaleString('en-NG');
}

export class UtilitiesPanel {
  /**
   * @param {object} o
   * @param {function} o.getToken - () => string|null
   * @param {function} o.onToast  - (msg, type) => void
   */
  constructor({ getToken, onToast } = {}) {
    this.getToken = getToken || (() => null);
    this.onToast = onToast || (() => {});
    this.open = false;
    this.busy = false;
    this.data = null;
    this.cash = 0;
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
    root.className = 'venue-panel utilities-panel hidden';
    root.innerHTML = `
      <div class="venue-backdrop" data-util-close></div>
      <div class="venue-card" role="dialog" aria-label="Home utilities">
        <div class="venue-head">
          <h2>${icon('energy', 18)} Meter cupboard</h2>
          <button class="venue-close" data-util-close aria-label="Close">${icon('close', 18)}</button>
        </div>
        <div class="util-body"></div>
        <div class="venue-error" style="display:none"></div>
      </div>`;
    document.body.appendChild(root);
    this.root = root;
    this.bodyEl = root.querySelector('.util-body');

    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-util-close]')) return this.hide();
      const toggle = e.target.closest('[data-util-appliance]');
      if (toggle) return this._toggle(toggle.dataset.utilAppliance);
      const top = e.target.closest('[data-util-topup]');
      if (top) return this._topUp(top.dataset.utilKind, top.dataset.utilTopup);
      if (e.target.closest('[data-util-solar]')) return this._solar();
    });
  }

  async show() {
    this.open = true;
    this.root.classList.remove('hidden');
    await this.refresh();
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
  }

  async refresh() {
    const token = this.getToken();
    if (!token) return;
    const res = await getUtilities(token);
    if (res.error) return this._error(res.error);
    this.data = res.utilities;
    this.catalogue = res.catalogue;
    this.cash = res.cash || 0;
    this._render();
  }

  // ── Render ─────────────────────────────────────────────────
  _render() {
    const u = this.data;
    const c = this.catalogue || {};
    if (!u) return;

    if (!u.hasHome) {
      this.bodyEl.innerHTML = `
        <p class="util-note">You do not have a home, so there is nothing on the meter.
        Rent or buy a place first — the Property panel has the listings.</p>`;
      return;
    }

    const meter = (label, value, max, unit, tone) => {
      const pct = Math.max(0, Math.min(100, (value / max) * 100));
      return `
        <div class="util-meter util-${tone}">
          <div class="util-meter-head">
            <span>${label}</span>
            <b>${value.toLocaleString('en-NG')} ${unit}</b>
          </div>
          <div class="util-bar"><i style="width:${pct.toFixed(1)}%"></i></div>
        </div>`;
    };

    const appliances = (c.appliances || []).map((a) => {
      const on = !!u.appliances?.[a.id];
      return `
        <button class="util-switch${on ? ' on' : ''}" data-util-appliance="${a.id}"
                aria-pressed="${on ? 'true' : 'false'}">
          <span class="util-switch-icon">${a.icon}</span>
          <span class="util-switch-label">${a.label}</span>
          <span class="util-switch-state">${on ? 'ON' : 'off'}</span>
        </button>`;
    }).join('');

    const bundleButtons = (kind, list) => (list || []).map((b) => `
      <button class="venue-buy util-buy" data-util-kind="${kind}" data-util-topup="${b.id}"
              ${this.cash >= b.price ? '' : 'disabled'}>
        ${b.label} · ${naira(b.price)}
      </button>`).join('');

    this.bodyEl.innerHTML = `
      <div class="util-grid">
        ${meter('Electricity', u.powerKwh, 150, 'kWh', 'power')}
        ${meter('Water', u.waterLitres, c.tankLitres || 1000, 'L', 'water')}
        ${meter('Cooking gas', u.gasKg, 12.5, 'kg', 'gas')}
      </div>
      <p class="util-note">
        Today's load: <b>${u.dailyKwh} kWh</b> and <b>${u.dailyLitres} L</b>.
        ${u.powerDaysLeft === null ? '' : `That is about <b>${u.powerDaysLeft} game day(s)</b> of power left.`}
        ${u.solar ? '<b class="util-good">Solar covered — 60% off the meter.</b>' : ''}
      </p>

      <h3 class="util-h">What is switched on</h3>
      <div class="util-switches">${appliances}</div>

      <h3 class="util-h">Top up</h3>
      <div class="util-topups">
        <div class="util-topup-row"><span>Electricity</span><div>${bundleButtons('power', c.powerBundles)}</div></div>
        <div class="util-topup-row"><span>Water</span><div>${bundleButtons('water', c.waterBundles)}</div></div>
        <div class="util-topup-row"><span>Gas</span><div>${bundleButtons('gas', c.gasBundles)}</div></div>
      </div>

      <div class="util-solar">
        <div>
          <b>${(c.solar || {}).name || 'Rooftop solar'}</b>
          <div class="util-note">${(c.solar || {}).hint || ''}</div>
        </div>
        ${u.solar
          ? '<span class="util-good">Installed</span>'
          : `<button class="venue-buy util-buy" data-util-solar
                ${this.cash >= (c.solar?.price || 0) ? '' : 'disabled'}>
              ${naira(c.solar?.price)}</button>`}
      </div>
    `;
  }

  _setBusy(on) {
    this.busy = !!on;
    this.root.classList.toggle('venue-busy', !!on);
  }

  // ── Actions ────────────────────────────────────────────────
  async _topUp(kind, bundle) {
    if (this.busy) return;
    const token = this.getToken();
    if (!token) return this._error('Sign in first');
    this._setBusy(true);
    const res = await topUpUtility(token, kind, bundle).finally(() => this._setBusy(false));
    if (res.error) return this._error(res.error);
    this.data = res.utilities;
    this.cash = res.cash ?? this.cash;
    this.onToast(`Meter topped up — ${res.bundle?.label || bundle}`, 'success');
    this._render();
  }

  async _toggle(applianceId) {
    if (this.busy) return;
    const token = this.getToken();
    if (!token) return;
    this._setBusy(true);
    const res = await toggleAppliance(token, applianceId).finally(() => this._setBusy(false));
    if (res.error) return this._error(res.error);
    this.data = res.utilities;
    this._render();
  }

  async _solar() {
    if (this.busy) return;
    const token = this.getToken();
    if (!token) return;
    this._setBusy(true);
    const res = await buySolarPanels(token).finally(() => this._setBusy(false));
    if (res.error) return this._error(res.error);
    this.data = res.utilities;
    this.cash = res.cash ?? this.cash;
    this.onToast('Rooftop solar installed — the meter will read 60% less', 'success');
    this._render();
  }

  _error(msg) {
    const el = this.root.querySelector('.venue-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}
