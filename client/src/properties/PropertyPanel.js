import {
  getProperties, buyProperty, rentProperty, moveIn,
  listProperty, unlistProperty, buyListing, rentListing,
} from '../auth/api.js';

function naira(amount) {
  return '₦' + Math.round(amount).toLocaleString('en-NG');
}

function formatCountdown(ms) {
  if (!ms || ms <= 0) return 'due now';
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

/**
 * Housing market panel.
 * Toggled with the 'H' key. Lists every property with its price, rent, and
 * the player's status (owned / rented / home). The client only sends buy,
 * rent, and move-in requests — the server decides whether they succeed.
 *
 * @param {object} opts
 * @param {function} opts.onHomeChange — called with the new home property (or null)
 * @param {function} opts.onError       — called with an error message string
 */
export class PropertyPanel {
  constructor({ onHomeChange, onError } = {}) {
    this.onHomeChange = onHomeChange || (() => {});
    this.onError = onError || (() => {});

    this.token = null;
    this.properties = [];
    this.home = null;
    this.tenure = null;
    this.rentDueIn = 0;
    this.rentPeriodMs = 0;
    this.cash = 0;
    this.bankBalance = 0;
    this.busy = false;
    this.countdownTimer = null;
    this._dueAt = 0;

    this.root = document.createElement('div');
    this.root.className = 'property-panel hidden';
    document.body.appendChild(this.root);

    this._render();
  }

  setToken(token) {
    this.token = token;
  }

  toggle() {
    if (this.root.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  show() {
    this.root.classList.remove('hidden');
    this._load();
    this._startCountdown();
  }

  hide() {
    this.root.classList.add('hidden');
    this._stopCountdown();
  }

  /** Keeps the rent countdown ticking without re-fetching the list. */
  _startCountdown() {
    this._stopCountdown();
    this.countdownTimer = setInterval(() => {
      if (!this._dueAt) return;
      this.rentDueIn = Math.max(0, this._dueAt - Date.now());
      const el = this.root.querySelector('.prop-rent-countdown');
      if (el) el.textContent = formatCountdown(this.rentDueIn);
    }, 1000);
  }

  _stopCountdown() {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  /**
   * Refresh from the server and return the current home (or null).
   * Used by the Go Home button, which must never act on a stale cache.
   * @returns {Promise<object|null>}
   */
  async fetchHome() {
    if (!this.token) return null;
    const result = await getProperties(this.token);
    if (result.error) {
      this.onError(result.error);
      return this.home;
    }
    this._apply(result);
    this._render();
    return this.home;
  }

  /**
   * Does the player live at this listing?
   * @param {string} propertyId
   */
  isHome(propertyId) {
    return !!(this.home && this.home.id === propertyId);
  }

  async _load() {
    if (!this.token) return;
    const result = await getProperties(this.token);
    if (!result.error) {
      this._apply(result);
    } else {
      this.onError(result.error);
    }
    this._render();
  }

  _apply(result) {
    this.properties   = result.properties || [];
    this.home         = result.home || null;
    this.tenure       = result.tenure || null;
    this.rentDueIn    = result.rentDueIn || 0;
    this.rentPeriodMs = result.rentPeriodMs || 0;
    this.cash         = result.cash || 0;
    this.bankBalance  = result.bankBalance || 0;
    this._dueAt = this.rentDueIn > 0 ? Date.now() + this.rentDueIn : 0;
  }

  // ── Rendering ──────────────────────────────────────────────

  _render() {
    const totalMoney = this.cash + this.bankBalance;
    const renting = this.properties.find(p => p.rented) || null;

    const homeHtml = this.home
      ? `
        <div class="prop-home">
          <div class="prop-home-main">
            <span class="prop-home-icon">${this.home.icon}</span>
            <div>
              <div class="prop-home-name">${this.home.name}</div>
              <div class="prop-home-meta">
                📍 ${this.home.districtName} ·
                ${this.tenure === 'rented' ? 'Rented' : 'Owned'}
              </div>
            </div>
          </div>
          ${this.tenure === 'rented' ? `
            <div class="prop-rent">
              <span>Rent ${naira(this.home.rentPerPeriod)} in</span>
              <span class="prop-rent-countdown">${formatCountdown(this.rentDueIn)}</span>
            </div>
          ` : `<div class="prop-rent prop-rent-owned">No rent — you own this</div>`}
          <div class="prop-home-bonus">
            🛏️ Sleep +${Math.round(this.home.sleepBonus * 100)}% ·
            ⚡ Energy drain −${Math.round(this.home.comfortBonus * 100)}%
          </div>
        </div>
      `
      : `
        <div class="prop-homeless">
          🚫 <strong>Homeless.</strong> Sleeping and showering give no bonus
          and energy drains at full rate.
        </div>
      `;

    // ── What the player already holds ────────────────────────
    // Owning more than one property is allowed, so this is a list, and each one
    // offers the three things an owner can do: live in it, sell it, let it out.
    const owned = (this.properties || []).filter((p) => p.owned || p.rented);
    const ownedHtml = owned.length
      ? owned.map((p) => {
        const listing = p.myListing;
        const listingText = listing
          ? (listing.mode === 'sale'
            ? `On the market at ${naira(listing.price)}`
            : `Letting at ${naira(listing.price)}/period${listing.deposit ? ` · ${naira(listing.deposit)} deposit` : ''}`)
          : null;
        return `
          <div class="prop-owned ${p.isHome ? 'prop-owned-home' : ''}">
            <div class="prop-owned-head">
              <span class="prop-owned-icon">${p.icon}</span>
              <div>
                <div class="prop-owned-name">${p.name}
                  ${p.isHome ? '<span class="prop-badge prop-badge-home">🏠 Home</span>' : ''}
                  <span class="prop-badge ${p.owned ? 'prop-badge-owned' : 'prop-badge-rented'}">
                    ${p.owned ? '✓ Owned' : '🔑 Rented'}
                  </span>
                </div>
                <div class="prop-owned-meta">📍 ${p.districtName}${
                  p.rented && p.landlord ? ` · landlord ${p.landlord}` : ''}</div>
              </div>
            </div>
            ${listingText ? `<div class="prop-owned-listing">${listingText}</div>` : ''}
            <div class="prop-owned-actions">
              ${p.isHome ? '' : `<button class="prop-btn prop-btn-move" data-move="${p.id}">Live here</button>`}
              ${p.owned && !listing ? `
                <button class="prop-btn prop-btn-sell" data-list="${p.id}" data-mode="sale">
                  Sell · from ${naira(Math.round(p.price * 0.1))}
                </button>
                <button class="prop-btn prop-btn-let" data-list="${p.id}" data-mode="rent">
                  Let out · from ${naira(Math.round(p.rentPerPeriod * 0.1))}/period
                </button>` : ''}
              ${listing ? `<button class="prop-btn prop-btn-unlist" data-unlist="${p.id}">Take it off the market</button>` : ''}
            </div>
          </div>`;
      }).join('')
      : `<div class="prop-homeless">You do not own anything yet. Buy below — the
          cheapest title is the hostel bed, and you can hold as many as you can afford.</div>`;

    const cardsHtml = this.properties.map((p) => {
      // Rent is only offered when the player has no tenancy running
      const canRent = !p.owned && !p.rented && !renting;
      const canMoveIn = (p.owned || p.rented) && !p.isHome;
      const affordBuy = totalMoney >= p.price;
      const upfront = p.deposit + p.rentPerPeriod;
      const affordRent = totalMoney >= upfront;

      let statusBadge = '';
      if (p.isHome) {
        statusBadge = `<span class="prop-badge prop-badge-home">🏠 Home</span>`;
      } else if (p.owned) {
        statusBadge = `<span class="prop-badge prop-badge-owned">✓ Owned</span>`;
      } else if (p.rented) {
        statusBadge = `<span class="prop-badge prop-badge-rented">🔑 Rented</span>`;
      }

      // Actions
      let actionsHtml = '';
      if (canMoveIn) {
        actionsHtml += `<button class="prop-btn prop-btn-move" data-move="${p.id}">Move In</button>`;
      }
      if (!p.owned && !p.rented) {
        actionsHtml += `
          <button class="prop-btn prop-btn-buy ${affordBuy ? '' : 'prop-btn-disabled'}"
                  data-buy="${p.id}" ${affordBuy ? '' : 'disabled'}
                  title="${affordBuy ? 'Buy outright' : 'Not enough money'}">
            Buy · ${naira(p.price)}
          </button>
        `;
        if (canRent) {
          actionsHtml += `
            <button class="prop-btn prop-btn-rent ${affordRent ? '' : 'prop-btn-disabled'}"
                    data-rent="${p.id}" ${affordRent ? '' : 'disabled'}
                    title="Deposit ${naira(p.deposit)} + first rent ${naira(p.rentPerPeriod)}">
              Rent · ${naira(p.rentPerPeriod)}/period
            </button>
          `;
        }
      }

      // Other players' titles for this building.
      const listingsHtml = (p.listings || []).length
        ? `<div class="prop-market">
             <div class="prop-market-title">On the market from other players</div>
             ${p.listings.map((l) => `
               <div class="prop-market-row">
                 <span class="prop-market-owner">${l.ownerUsername}</span>
                 <span class="prop-market-price">${
                   l.mode === 'sale'
                     ? `${naira(l.price)} to buy`
                     : `${naira(l.price)}/period${l.deposit ? ` + ${naira(l.deposit)} deposit` : ''}`
                 }</span>
                 <button class="prop-btn ${l.mode === 'sale' ? 'prop-btn-buy' : 'prop-btn-rent'}"
                         data-buy-listing="${l.id}" data-listing-property="${p.id}"
                         data-listing-mode="${l.mode}">
                   ${l.mode === 'sale' ? 'Buy it' : 'Rent it'}
                 </button>
               </div>`).join('')}
           </div>`
        : '';

      return `
        <div class="prop-card ${p.isHome ? 'prop-card-home' : ''}">
          <div class="prop-card-head">
            <span class="prop-card-icon">${p.icon}</span>
            <div class="prop-card-title">
              <div class="prop-card-name">${p.name} ${statusBadge}</div>
              <div class="prop-card-district">📍 ${p.districtName}</div>
            </div>
          </div>
          <div class="prop-card-desc">${p.description}</div>
          <div class="prop-card-stats">
            <span>🛏️ +${Math.round(p.sleepBonus * 100)}% sleep</span>
            <span>⚡ −${Math.round(p.comfortBonus * 100)}% drain</span>
          </div>
          <div class="prop-card-costs">
            <span class="prop-cost-buy">${naira(p.price)} to buy</span>
            <span class="prop-cost-rent">
              or ${naira(p.deposit)} deposit + ${naira(p.rentPerPeriod)} / 30 min
            </span>
          </div>
          ${listingsHtml}
          <div class="prop-card-actions">${actionsHtml}</div>
        </div>
      `;
    }).join('');

    this.root.innerHTML = `
      <div class="prop-header">
        <h2>🏠 Housing</h2>
        <button class="prop-close" data-action="close">✕</button>
      </div>
      <div class="prop-wallet">
        Cash ${naira(this.cash)} · Bank ${naira(this.bankBalance)}
      </div>
      <div class="prop-current-section">
        <h3>Your Home</h3>
        ${homeHtml}
      </div>
      <div class="prop-owned-section">
        <h3>Your properties <span class="prop-count">${owned.length}</span></h3>
        ${ownedHtml}
      </div>
      <div class="prop-list-section">
        <h3>Properties for sale in Eko Basin</h3>
        ${cardsHtml}
      </div>
      <div class="prop-error" style="display:none"></div>
    `;

    this._wire();
  }

  _wire() {
    this.root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.action === 'close') this.hide();
      });
    });

    this.root.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleBuy(btn.dataset.buy));
    });

    this.root.querySelectorAll('[data-rent]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleRent(btn.dataset.rent));
    });

    this.root.querySelectorAll('[data-move]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleMoveIn(btn.dataset.move));
    });

    this.root.querySelectorAll('[data-list]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleList(btn.dataset.list, btn.dataset.mode));
    });

    this.root.querySelectorAll('[data-unlist]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleUnlist(btn.dataset.unlist));
    });

    this.root.querySelectorAll('[data-buy-listing]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleTakeListing(
        btn.dataset.listingProperty, Number(btn.dataset.buyListing), btn.dataset.listingMode,
      ));
    });
  }

  // ── Actions ────────────────────────────────────────────────

  async _handleBuy(propertyId) {
    if (!this.token || this.busy) return;
    this.busy = true;
    const result = await buyProperty(this.token, propertyId);
    this.busy = false;

    if (result.error) {
      this._showError(result.error);
      return;
    }
    this._apply(result);
    this._render();
    this.onHomeChange(this.home);
  }

  async _handleRent(propertyId) {
    if (!this.token || this.busy) return;
    this.busy = true;
    const result = await rentProperty(this.token, propertyId);
    this.busy = false;

    if (result.error) {
      this._showError(result.error);
      return;
    }
    this._apply(result);
    this._render();
    this.onHomeChange(this.home);
  }

  async _handleMoveIn(propertyId) {
    if (!this.token || this.busy) return;
    this.busy = true;
    const result = await moveIn(this.token, propertyId);
    this.busy = false;

    if (result.error) {
      this._showError(result.error);
      return;
    }
    this._apply(result);
    this._render();
    this.onHomeChange(this.home);
  }

  /**
   * Put a property on the market. Asks for a price with a prompt — the only
   * number the player supplies; the server checks it is sane.
   */
  async _handleList(propertyId, mode) {
    if (!this.token || this.busy) return;
    const property = this.properties.find((p) => p.id === propertyId);
    if (!property) return;

    const suggested = mode === 'sale'
      ? property.price
      : property.rentPerPeriod;
    const label = mode === 'sale' ? 'selling price' : 'rent per period';
    const answer = window.prompt(
      `${label} for ${property.name}?\n\n`
      + `The market value is ${naira(suggested)}. `
      + (mode === 'sale'
        ? `You can ask between ${naira(Math.round(suggested * 0.1))} and ${naira(suggested * 20)}.`
        : `You can ask between ${naira(Math.round(suggested * 0.1))} and ${naira(suggested * 20)} per period.`),
      String(suggested),
    );
    if (answer === null) return;
    const price = Math.round(Number(String(answer).replace(/[^0-9.]/g, '')));
    if (!Number.isFinite(price) || price <= 0) {
      this._showError('That is not a price');
      return;
    }

    this.busy = true;
    const result = await listProperty(this.token, propertyId, { mode, price, deposit: 0 });
    this.busy = false;
    if (result.error) { this._showError(result.error); return; }

    this._apply(result);
    this._render();
    this.onListed?.({ property, mode, price });
  }

  async _handleUnlist(propertyId) {
    if (!this.token || this.busy) return;
    this.busy = true;
    const result = await unlistProperty(this.token, propertyId);
    this.busy = false;
    if (result.error) { this._showError(result.error); return; }
    this._apply(result);
    this._render();
    this.onListed?.({ property: null, mode: 'unlisted', price: 0 });
  }

  /** Buy or rent another player's title. */
  async _handleTakeListing(propertyId, listingId, mode) {
    if (!this.token || this.busy) return;
    this.busy = true;
    const result = mode === 'sale'
      ? await buyListing(this.token, propertyId, listingId)
      : await rentListing(this.token, propertyId, listingId);
    this.busy = false;
    if (result.error) { this._showError(result.error); return; }

    this._apply(result);
    this._render();
    this.onHomeChange(this.home);
  }

  _showError(msg) {
    const errEl = this.root.querySelector('.prop-error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
      clearTimeout(this._errTimer);
      this._errTimer = setTimeout(() => {
        errEl.style.display = 'none';
      }, 4000);
    }
    this.onError(msg);
  }
}
