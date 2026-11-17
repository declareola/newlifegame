import { getInteractions, bankDeposit, bankWithdraw, buyShopItem } from '../auth/api.js';

function naira(amount) {
  return '₦' + Math.round(amount).toLocaleString('en-NG');
}

/**
 * Walk-up world interactions (Step 10).
 *
 * Every frame this checks the player's distance to each interaction point
 * from the server config. When close enough it shows a prompt; pressing E
 * opens a panel with the bank or shop actions for that point.
 *
 * The client does all of this only for display — the server re-checks the
 * distance and owns the money.
 */
export class InteractionSystem {
  /**
   * @param {object} opts
   * @param {function} opts.getPlayerPosition - returns { x, z } for the local avatar
   * @param {function} opts.onToast - (message, type) => void
   * @param {function} opts.onNeedsChanged - called after a purchase so the HUD refreshes
   */
  constructor({ getPlayerPosition, onToast, onNeedsChanged } = {}) {
    this.getPlayerPosition = getPlayerPosition || (() => ({ x: 0, z: 0 }));
    this.onToast = onToast || (() => {});
    this.onNeedsChanged = onNeedsChanged || (() => {});

    this.token = null;
    this.points = [];
    this.shopItems = [];
    this.minBankAmount = 100;
    this.cash = 0;
    this.bankBalance = 0;

    this.nearbyPoint = null;
    this.panelOpen = false;
    this.activePoint = null;
    this.busy = false;

    this._buildPrompt();
    this._buildPanel();
    this._bindKeys();
  }

  setToken(token) {
    this.token = token;
    this._loadConfig();
  }

  async _loadConfig() {
    if (!this.token) return;
    const result = await getInteractions(this.token);
    if (result.error) return;
    this.points = result.points || [];
    this.shopItems = result.shopItems || [];
    this.minBankAmount = result.minBankAmount || 100;
    this.cash = result.cash || 0;
    this.bankBalance = result.bankBalance || 0;
  }

  // ── Proximity prompt ───────────────────────────────────────

  _buildPrompt() {
    this.promptEl = document.createElement('div');
    this.promptEl.className = 'interaction-prompt hidden';
    document.body.appendChild(this.promptEl);
  }

  _buildPanel() {
    this.panelEl = document.createElement('div');
    this.panelEl.className = 'interaction-panel hidden';
    document.body.appendChild(this.panelEl);
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (!this.token) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'e' || e.key === 'E') {
        if (this.panelOpen) {
          this.closePanel();
        } else if (this.nearbyPoint) {
          this.openPanel(this.nearbyPoint);
        }
      } else if (e.key === 'Escape' && this.panelOpen) {
        this.closePanel();
      }
    });
  }

  /**
   * Called every frame from the render loop.
   */
  /**
   * Forget everything: no nearby point, no prompt. Used when the player walks
   * into a building, where the street's ATMs and shop counters are not.
   */
  clear() {
    this.nearbyPoint = null;
    if (this.panelOpen) this.closePanel();
    this.promptEl?.classList.add('hidden');
  }

  update() {
    if (!this.promptEl) return;
    const pos = this.getPlayerPosition();

    // Find the closest point within its radius
    let closest = null;
    let closestDist = Infinity;
    for (const point of this.points) {
      const dx = pos.x - point.position.x;
      const dz = pos.z - point.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const radius = point.radius || 7;
      if (dist <= radius && dist < closestDist) {
        closest = point;
        closestDist = dist;
      }
    }

    this.nearbyPoint = closest;

    // Walking away closes the panel
    if (this.panelOpen && !closest) {
      this.closePanel();
      return;
    }
    if (this.panelOpen && closest && closest.id !== this.activePoint?.id) {
      this.closePanel();
      return;
    }

    if (closest && !this.panelOpen) {
      this.promptEl.classList.remove('hidden');
      this.promptEl.innerHTML = `
        <span class="interaction-prompt-key">E</span>
        <span class="interaction-prompt-text">${closest.icon} ${closest.name}</span>
      `;
    } else {
      this.promptEl.classList.add('hidden');
    }
  }

  // ── Panel ──────────────────────────────────────────────────

  openPanel(point) {
    if (!this.token) return;
    this.panelOpen = true;
    this.activePoint = point;
    this.promptEl.classList.add('hidden');
    this._refreshWallet();
    this._render();
    this.panelEl.classList.remove('hidden');
  }

  closePanel() {
    this.panelOpen = false;
    this.activePoint = null;
    this.panelEl.classList.add('hidden');
  }

  async _refreshWallet() {
    if (!this.token) return;
    const result = await getInteractions(this.token);
    if (result.error) return;
    this.cash = result.cash || 0;
    this.bankBalance = result.bankBalance || 0;
    if (this.panelOpen) this._render();
  }

  _render() {
    const point = this.activePoint;
    if (!point) return;

    const body = point.type === 'bank' ? this._bankHtml() : this._shopHtml();

    this.panelEl.innerHTML = `
      <div class="interaction-header">
        <h2>${point.icon} ${point.name}</h2>
        <button class="interaction-close" data-action="close">✕</button>
      </div>
      <div class="interaction-wallet">
        Cash ${naira(this.cash)} · Bank ${naira(this.bankBalance)}
      </div>
      ${body}
      <div class="interaction-error" style="display:none"></div>
    `;

    this._wire();
  }

  _bankHtml() {
    const quick = [1000, 5000, 20000];
    return `
      <div class="interaction-section">
        <h3>Deposit</h3>
        <div class="interaction-row">
          <input class="interaction-input" type="number" min="${this.minBankAmount}"
                 step="100" placeholder="Amount" data-input="amount" />
          <button class="interaction-btn interaction-btn-deposit" data-action="deposit">Deposit</button>
        </div>
        <div class="interaction-quick">
          ${quick.map((v) => `<button class="interaction-chip" data-quick="deposit" data-amount="${v}">${naira(v)}</button>`).join('')}
        </div>
      </div>
      <div class="interaction-section">
        <h3>Withdraw</h3>
        <div class="interaction-row">
          <input class="interaction-input" type="number" min="${this.minBankAmount}"
                 step="100" placeholder="Amount" data-input="amount-w" />
          <button class="interaction-btn interaction-btn-withdraw" data-action="withdraw">Withdraw</button>
        </div>
        <div class="interaction-quick">
          ${quick.map((v) => `<button class="interaction-chip" data-quick="withdraw" data-amount="${v}">${naira(v)}</button>`).join('')}
        </div>
      </div>
      <div class="interaction-hint">Minimum ${naira(this.minBankAmount)} per transaction</div>
    `;
  }

  _shopHtml() {
    const cards = this.shopItems.map((item) => {
      const effectLines = Object.entries(item.effects)
        .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`)
        .join(' · ');
      const affordable = this.cash >= item.price;
      return `
        <div class="shop-item">
          <div class="shop-item-main">
            <span class="shop-item-icon">${item.icon}</span>
            <div>
              <div class="shop-item-name">${item.name}</div>
              <div class="shop-item-desc">${item.description}</div>
              <div class="shop-item-effects">${effectLines}</div>
            </div>
          </div>
          <button class="interaction-btn shop-buy ${affordable ? '' : 'interaction-btn-disabled'}"
                  data-buy="${item.id}" ${affordable ? '' : 'disabled'}>
            ${naira(item.price)}
          </button>
        </div>
      `;
    }).join('');

    return `<div class="interaction-section"><h3>For Sale</h3>${cards}</div>`;
  }

  _wire() {
    this.panelEl.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'close') this.closePanel();
        if (action === 'deposit') this._handleBank('deposit');
        if (action === 'withdraw') this._handleBank('withdraw');
      });
    });

    this.panelEl.querySelectorAll('[data-quick]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const amount = Number(btn.dataset.amount);
        this._handleBank(btn.dataset.quick, amount);
      });
    });

    this.panelEl.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', () => this._handleBuy(btn.dataset.buy));
    });
  }

  async _handleBank(kind, presetAmount = null) {
    if (!this.token || this.busy || !this.activePoint) return;

    let amount = presetAmount;
    if (amount === null) {
      const selector = kind === 'deposit' ? '[data-input="amount"]' : '[data-input="amount-w"]';
      const input = this.panelEl.querySelector(selector);
      amount = Number(input?.value);
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      this._showError('Enter an amount');
      return;
    }

    this.busy = true;
    const fn = kind === 'deposit' ? bankDeposit : bankWithdraw;
    const result = await fn(this.token, this.activePoint.id, amount);
    this.busy = false;

    if (result.error) {
      this._showError(result.error);
      return;
    }

    this.cash = result.cash ?? this.cash;
    this.bankBalance = result.bankBalance ?? this.bankBalance;
    this._render();
    this.onToast(
      kind === 'deposit'
        ? `🏦 Deposited ${naira(amount)}`
        : `🏦 Withdrew ${naira(amount)}`,
      'info'
    );
  }

  async _handleBuy(itemId) {
    if (!this.token || this.busy || !this.activePoint) return;
    this.busy = true;
    const result = await buyShopItem(this.token, this.activePoint.id, itemId);
    this.busy = false;

    if (result.error) {
      this._showError(result.error);
      return;
    }

    this.cash = result.cash ?? this.cash;
    this._render();
    this.onToast(`${result.item.icon} Bought ${result.item.name}`, 'info');
    this.onNeedsChanged();
  }

  _showError(msg) {
    const el = this.panelEl.querySelector('.interaction-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(this._errTimer);
    this._errTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
  }
}
