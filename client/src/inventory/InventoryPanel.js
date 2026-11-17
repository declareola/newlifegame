// client/src/inventory/InventoryPanel.js
// Inventory (Tab) — items you own, with real actions.
//
// Every button calls the server and then re-renders from the server's answer,
// so the panel can never show an item you do not have or a balance you do not
// hold.

import { getInventory, useItem, discardItem, buyItem } from '../auth/api.js';
import { icon } from '../ui/icons.js';
import { claimEscape } from '../ui/escape.js';

const CATEGORY_ICON = {
  food: 'hunger',
  drink: 'bladder',
  hygiene: 'hygiene',
  durable: 'settings',
  vehicle: 'energy',
};

export class InventoryPanel {
  /**
   * @param {object} o
   * @param {function} o.onToast  - (msg, type) => void
   * @param {function} o.onNeeds  - (needs) => void, after using an item
   */
  constructor({ onToast, onNeeds } = {}) {
    this.token = null;
    this.items = [];
    this.cash = 0;
    this.onToast = onToast || (() => {});
    this.onNeeds = onNeeds || (() => {});

    this._build();
    this._bindKeys();
  }

  setToken(token) {
    this.token = token;
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'panel inventory-panel hidden';
    el.innerHTML = `
      <header class="panel-head">
        <h2>${icon('briefcase', 18)} Inventory</h2>
        <div class="panel-head-right">
          <span class="inventory-cash"></span>
          <button class="panel-close" type="button" aria-label="Close">${icon('close', 16)}</button>
        </div>
      </header>
      <div class="inventory-body"></div>
      <footer class="inventory-foot">
        Buy food and supplies at any shop — suya stands, the market, the food court.
      </footer>
    `;
    document.body.appendChild(el);

    this.el = el;
    this.bodyEl = el.querySelector('.inventory-body');
    this.cashEl = el.querySelector('.inventory-cash');
    el.querySelector('.panel-close').addEventListener('click', () => this.hide());
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') {
        e.preventDefault();
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
    const res = await getInventory(this.token);
    if (res.error) {
      this.bodyEl.innerHTML = `<p class="panel-empty">${res.error}</p>`;
      return;
    }
    this.items = res.items || [];
    this.cash = res.cash || 0;
    this._render();
  }

  _render() {
    this.cashEl.textContent = `₦${Math.round(this.cash).toLocaleString('en-NG')}`;

    if (this.items.length === 0) {
      this.bodyEl.innerHTML = `
        <p class="panel-empty">Your bag is empty. Visit a shop to buy something.</p>
      `;
      return;
    }

    this.bodyEl.innerHTML = this.items.map((item, i) => `
      <div class="inv-row" data-index="${i}">
        <span class="inv-icon">${icon(CATEGORY_ICON[item.category] || 'briefcase', 18)}</span>
        <div class="inv-info">
          <div class="inv-name">${item.name} <span class="inv-qty">×${item.quantity}</span></div>
          <div class="inv-desc">${item.description}</div>
        </div>
        <div class="inv-actions">
          <button class="inv-use" data-act="use">Use</button>
          <button class="inv-drop" data-act="drop" title="Discard one">${icon('close', 13)}</button>
        </div>
      </div>
    `).join('');

    this.bodyEl.querySelectorAll('.inv-row').forEach((row) => {
      const item = this.items[Number(row.dataset.index)];
      row.querySelector('[data-act="use"]').addEventListener('click', () => this._use(item));
      row.querySelector('[data-act="drop"]').addEventListener('click', () => this._discard(item));
    });
  }

  async _use(item) {
    const res = await useItem(this.token, item.id);
    if (res.error) {
      this.onToast(res.error, 'warning');
      return;
    }
    this.onToast(res.text || `Used ${item.name}`, 'success');
    if (res.needs) this.onNeeds(res.needs);
    await this.refresh();
  }

  async _discard(item) {
    const res = await discardItem(this.token, item.id);
    if (res.error) {
      this.onToast(res.error, 'warning');
      return;
    }
    this.onToast(`Discarded ${item.name}`, 'info');
    await this.refresh();
  }

  /** Buy from the inventory panel (used by shop dialogues). */
  async buy(itemId, quantity = 1) {
    const res = await buyItem(this.token, itemId, quantity);
    if (res.error) {
      this.onToast(res.error, 'warning');
      return false;
    }
    this.onToast(`Bought ${res.item?.name || itemId}`, 'success');
    await this.refresh();
    return true;
  }
}
