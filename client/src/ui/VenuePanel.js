// client/src/ui/VenuePanel.js
// The panel that opens when you press E at a station inside a building.
//
// Three kinds of action live here, and all three are real:
//
//   activity    → POST /api/activities/perform. The server owns the duration,
//                 the effects and whether you are allowed to do it here at all.
//   shop        → POST /api/interactions/venue/buy. Prices and stock come from
//                 the server; the client only ever sends ids.
//   appearance  → the same appearance endpoint the character creator uses, so
//                 "change clothes at the wardrobe" really changes your avatar.
//   enter       → walk into another interior (the airport gate → the apron).
//   staff       → GET /api/venue/staff, then POST /api/world/service. The
//                 attendant is a real person on the server with a name, a line
//                 of patter and a fixed list of things they will do — and the
//                 service endpoint refuses anything they do not offer here.
//   bank        → POST /api/interactions/bank/{deposit,withdraw}. The teller
//                 counter and the ATM inside the bank building really move
//                 money; before this they were counters you could only chat at.
//
// Nothing in this file invents a number. If the server says no, the panel says
// why, in the server's own words.

import { icon } from './icons.js';
import {
  performActivity, getVenues, buyVenueItem, bankDeposit, bankWithdraw,
  getVenueStaff, npcService, reportCrime,
} from '../auth/api.js';

function naira(amount) {
  return '₦' + Math.round(amount).toLocaleString('en-NG');
}

export class VenuePanel {
  /**
   * @param {object} o
   * @param {function} o.getToken          - () => string|null
   * @param {function} o.onToast           - (message, type) => void
   * @param {function} o.onActivityStarted - (activity) => void
   * @param {function} o.onEnterInterior   - (interiorId) => boolean
   * @param {function} o.onOpenAppearance  - () => void
   * @param {function} o.onNeedsChanged    - () => void
   */
  constructor({
    getToken, onToast, onActivityStarted, onEnterInterior, onOpenAppearance, onNeedsChanged,
    onOpenInventory, onOpenUtilities, onWantedChanged,
  } = {}) {
    this.getToken = getToken || (() => null);
    this.onWantedChanged = onWantedChanged || (() => {});
    this.onToast = onToast || (() => {});
    this.onActivityStarted = onActivityStarted || (() => {});
    this.onEnterInterior = onEnterInterior || (() => false);
    this.onOpenAppearance = onOpenAppearance || (() => {});
    this.onNeedsChanged = onNeedsChanged || (() => {});
    this.onOpenInventory = onOpenInventory || (() => {});
    this.onOpenUtilities = onOpenUtilities || (() => {});

    this.station = null;
    this.venueId = null;
    this.stock = [];
    this.cash = 0;
    this.bankBalance = 0;
    this.staff = null;
    this.staffLine = 0;
    this.staff = null;
    this.staffLine = 0;
    this.busy = false;
    this.open = false;

    this._build();
    this._bindKeys();
  }

  _build() {
    this.root = document.createElement('div');
    this.root.className = 'venue-panel hidden';
    document.body.appendChild(this.root);

    this.root.addEventListener('click', (e) => {
      const cmd = e.target.closest('[data-venue-act]');
      if (cmd) {
        this._run(cmd.dataset.venueAct, cmd.dataset);
        return;
      }
      const lift = e.target.closest('[data-lift-item]');
      if (lift) {
        this._lift(lift.dataset.liftItem);
        return;
      }
      const buy = e.target.closest('[data-buy-item]');
      if (buy) {
        this._buy(buy.dataset.buyItem);
        return;
      }
      const bankBtn = e.target.closest('[data-bank]');
      if (bankBtn) {
        const amount = this.root.querySelector('[data-bank-amount]')?.value;
        this._bank(bankBtn.dataset.bank, amount);
        return;
      }
      const svcBtn = e.target.closest('[data-service]');
      if (svcBtn) {
        this._service(svcBtn.dataset.service);
        return;
      }
      if (e.target.closest('[data-venue-close]') || e.target.classList.contains('venue-backdrop')) {
        this.hide();
      }
    });
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.open) return;
      // Enter in the amount box deposits, the way a real counter would.
      if (e.key === 'Enter' && e.target?.matches?.('[data-bank-amount]')) {
        e.stopPropagation();
        e.preventDefault();
        this._bank('deposit', e.target.value);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.hide();
      }
    }, true);
  }

  // ── Open / close ───────────────────────────────────────────

  /**
   * Open the panel for a station.
   * @param {object} station
   * @param {string} venueId interior id, used for the shop actions
   */
  async show(station, venueId) {
    if (!station) return false;
    this.station = station;
    this.venueId = venueId || null;
    this.open = true;
    this.busy = false;
    this.stock = [];
    this.cash = 0;

    // Stock is per-venue and comes from the server, so fetch it up front when
    // this station can sell anything.
    const needsMoney = station.actions.some((a) => a.kind === 'shop' || a.kind === 'bank');
    if (needsMoney) {
      await this._loadStock();
    }
    if (station.actions.some((a) => a.kind === 'staff')) {
      await this._loadStaff();
    }
    this._render();
    this.root.classList.remove('hidden');
    return true;
  }

  hide() {
    this.open = false;
    this.root.classList.add('hidden');
  }

  async _loadStock() {
    const token = this.getToken();
    if (!token) return;
    const result = await getVenues(token);
    if (result.error) return;
    this.stock = result.stock || [];
    this.cash = result.cash || 0;
    this.bankBalance = result.bankBalance || 0;
  }

  // ── Render ─────────────────────────────────────────────────

  _render() {
    const st = this.station;
    if (!st) return;

    const actions = st.actions.map((a, i) => {
      const hint = a.hint ? `<span class="venue-act-hint">${a.hint}</span>` : '';
      return `
        <button class="venue-act" data-venue-act="${i}">
          <span class="venue-act-label">${a.label}</span>
          ${hint}
        </button>`;
    }).join('');

    const shop = st.actions.some((a) => a.kind === 'shop') ? this._shopHtml() : '';
    const bank = st.actions.some((a) => a.kind === 'bank') ? this._bankHtml() : '';
    const staff = st.actions.some((a) => a.kind === 'staff') ? this._staffHtml() : '';

    this.root.innerHTML = `
      <div class="venue-backdrop"></div>
      <div class="venue-card" role="dialog" aria-label="${st.label}">
        <div class="venue-head">
          <h2>${st.icon} ${st.label}</h2>
          <button class="venue-close" data-venue-close aria-label="Close">${icon('close', 18)}</button>
        </div>
        <div class="venue-actions">${actions}</div>
        ${shop}
        ${bank}
        ${staff}
        <div class="venue-error" style="display:none"></div>
      </div>
    `;
  }

  _shopHtml() {
    if (!this.stock.length) {
      return `<div class="venue-shop-empty">Nothing in stock here right now.</div>`;
    }
    const cards = this.stock.map((item) => {
      const effects = Object.entries(item.effects || {})
        .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`)
        .join(' · ');
      const affordable = this.cash >= item.price;
      return `
        <div class="venue-item${affordable ? '' : ' venue-item-poor'}">
          <div class="venue-item-icon">${item.icon}</div>
          <div class="venue-item-body">
            <div class="venue-item-name">${item.name}</div>
            <div class="venue-item-desc">${item.description || ''}</div>
            <div class="venue-item-effects">${effects}</div>
          </div>
          <div class="venue-item-actions">
            <button class="venue-buy" data-buy-item="${item.id}" ${affordable ? '' : 'disabled'}>
              ${naira(item.price)}
            </button>
            <!-- Paying is not the only way to leave a shop with something. This
                 is a real theft: the server hands over a real item from this
                 shop's shelf, and puts a star on you for it — if the attendant
                 does not see you first. -->
            <button class="venue-lift" data-lift-item="${item.id}"
              title="Take it without paying. Costs wanted stars, and the attendant may notice.">
              ${icon('warning', 12)} Lift
            </button>
          </div>
        </div>`;
    }).join('');
    return `
      <div class="venue-shop">
        <div class="venue-wallet">Cash ${naira(this.cash)}</div>
        <div class="venue-items">${cards}</div>
      </div>`;
  }

  /** Ask the server who is behind the counter of the room we are standing in. */
  async _loadStaff() {
    const token = this.getToken();
    if (!token) return;
    const result = await getVenueStaff(token);
    if (result?.error) return;
    this.staff = result.staff || null;
  }

  /**
   * The attendant: their name, one line of patter, and the services they
   * actually perform. The buttons come from the server's list, so what you can
   * press is what the service endpoint will accept.
   */
  _staffHtml() {
    if (!this.staff) {
      return `<div class="venue-staff"><div class="venue-staff-empty">There is nobody behind this counter right now.</div></div>`;
    }
    const line = this.staff.lines?.[this.staffLine % Math.max(1, this.staff.lines.length)] || '';
    const services = (this.staff.services || []).map((svc) => {
      const cost = svc.cost ? ` · ${naira(svc.cost)}` : '';
      return `<button class="venue-service" data-service="${svc.id}">${svc.name}${cost}</button>`;
    }).join('');
    return `
      <div class="venue-staff">
        <div class="venue-staff-head">
          <span class="venue-staff-avatar" aria-hidden="true">${icon('user', 18)}</span>
          <span class="venue-staff-name">${this.staff.name}</span>
          <span class="venue-staff-role">${this.staff.role}</span>
        </div>
        <div class="venue-staff-line">${line}</div>
        <div class="venue-staff-services">${services}</div>
      </div>`;
  }

  async _service(serviceId) {
    const token = this.getToken();
    if (!token || this.busy) return;
    this._setBusy(true);
    let result;
    try {
      result = await npcService(token, serviceId);
    } finally {
      this._setBusy(false);
    }
    if (result?.error) {
      this._showError(result.error);
      return;
    }
    this.onToast(result.text || 'Done', 'success');
    this.onNeedsChanged();
    // Cycle to the next line, so talking twice does not repeat verbatim.
    this.staffLine = (this.staffLine + 1) % Math.max(1, this.staff?.lines?.length || 1);
    this._render();
  }

  /**
   * The counter/ATM block: an amount box and two buttons.
   *
   * Both buttons hit the same server endpoints the street-side bank points
   * use, so the rules (minimum amount, atomic transfer, no overdraft) are the
   * server's, not this panel's. Nothing here knows a balance is valid.
   */
  _bankHtml() {
    return `
      <div class="venue-bank">
        <div class="venue-wallet">
          Cash ${naira(this.cash)} · Bank ${naira(this.bankBalance)}
        </div>
        <div class="venue-bank-row">
          <input class="venue-bank-input" type="number" min="100" step="100"
                 placeholder="Amount" data-bank-amount aria-label="Amount in naira" />
          <button class="venue-bank-btn" data-bank="deposit">Deposit</button>
          <button class="venue-bank-btn venue-bank-btn-alt" data-bank="withdraw">Withdraw</button>
        </div>
        <div class="venue-bank-hint">Minimum ₦100. The bank keeps the same rules indoors as on the street.</div>
      </div>`;
  }

  async _bank(kind, amount) {
    const token = this.getToken();
    if (!token || this.busy) return;
    const value = Math.floor(Number(amount));
    if (!Number.isFinite(value) || value <= 0) {
      this._showError('Enter an amount first');
      return;
    }
    this._setBusy(true);
    let result;
    try {
      // No point_id: the server checks the reported venue instead, which is
      // how the indoor branch is recognised.
      result = kind === 'deposit'
        ? await bankDeposit(token, null, value)
        : await bankWithdraw(token, null, value);
    } finally {
      this._setBusy(false);
    }
    if (result?.error) {
      this._showError(result.error);
      return;
    }
    this.cash = result.cash ?? this.cash;
    this.bankBalance = result.bankBalance ?? this.bankBalance;
    this.onToast(
      kind === 'deposit'
        ? `Deposited ${naira(value)} — bank ${naira(this.bankBalance)}`
        : `Withdrew ${naira(value)} — cash ${naira(this.cash)}`,
      'success',
    );
    this._render();
  }

  /**
   * While a request is in flight the panel says so, instead of looking frozen.
   * @param {boolean} on
   */
  _setBusy(on) {
    this.busy = !!on;
    this.root?.classList.toggle('venue-busy', !!on);
    for (const btn of this.root?.querySelectorAll('button') || []) btn.disabled = !!on;
  }

  _showError(msg) {
    const el = this.root.querySelector('.venue-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  // ── Actions ────────────────────────────────────────────────

  async _run(index) {
    const action = this.station?.actions?.[Number(index)];
    if (!action || this.busy) return;

    if (action.kind === 'activity') {
      const token = this.getToken();
      if (!token) return this._showError('Sign in first');
      this._setBusy(true);
      let result;
      try {
        result = await performActivity(token, action.id);
      } finally {
        // Never leave the panel stuck behind a request that never came back.
        this._setBusy(false);
      }
      if (result?.error) {
        this._showError(result.error);
        return;
      }
      this.onActivityStarted(result.activity || { name: action.label });
      this.onToast(`▶ ${result.activity?.name || action.label} — ${Math.round((result.activity?.duration || 0) / 1000)}s`, 'info');
      this.hide();
      return;
    }

    if (action.kind === 'appearance') {
      this.hide();
      this.onOpenAppearance();
      return;
    }

    if (action.kind === 'utilities') {
      // The meter cupboard: readings and top-ups, all server-side.
      this.hide();
      this.onOpenUtilities();
      return;
    }

    if (action.kind === 'inventory') {
      // The inventory is server-backed; this just opens it.
      this.hide();
      this.onOpenInventory();
      return;
    }

    if (action.kind === 'enter') {
      this.hide();
      const ok = this.onEnterInterior(action.interiorId);
      if (!ok) this.onToast('That way is closed right now', 'warning');
      return;
    }

    if (action.kind === 'shop') {
      // Scroll the shop into view; the stock is already rendered underneath.
      this.root.querySelector('.venue-shop')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    if (action.kind === 'staff') {
      this.root.querySelector('.venue-staff')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }

    if (action.kind === 'bank') {
      const input = this.root.querySelector('[data-bank-amount]');
      input?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      input?.focus();
      return;
    }
  }

  /**
   * Shoplift. The client sends only the intent; the server decides which item
   * comes off the shelf, whether you got away, and how many stars it costs.
   */
  async _lift(itemId) {
    const token = this.getToken();
    if (!token || this.busy) return;
    this.busy = true;
    let result;
    try {
      result = await reportCrime(token, 'shoplift', { itemId });
    } catch (err) {
      result = { error: err.message };
    } finally {
      this.busy = false;
    }

    if (result?.error) {
      this._showError(result.error);
      return;
    }

    if (result.arrested) {
      this.hide();
      this.onToast(`🚨 Caught red-handed — fined ${naira(result.fine)} and taken to the station`, 'error');
    } else if (result.caught) {
      this.onToast('👀 The attendant saw you — you left empty-handed and they know your face', 'warning');
    } else if (result.loot) {
      this.onToast(`${result.loot.icon} Lifted ${result.loot.name} — ★${result.wanted?.maxStars ?? ''} on you now`, 'success');
    }
    this.onWantedChanged?.(result.wanted);
    this._render();
  }

  async _buy(itemId) {
    const token = this.getToken();
    if (!token || this.busy) return;
    this._setBusy(true);
    const shopAction = this.station?.actions?.find((a) => a.kind === 'shop');
    const venueId = shopAction?.venue || this.venueId;
    let result;
    try {
      result = await buyVenueItem(token, venueId, itemId);
    } finally {
      this._setBusy(false);
    }

    if (result?.error) {
      this._showError(result.error);
      return;
    }
    this.cash = result.cash ?? this.cash;
    this.onToast(`${result.item.icon} Bought ${result.item.name}`, 'success');
    this.onNeedsChanged();
    this._render();
  }
}
