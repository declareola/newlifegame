// client/src/ui/VehiclesPanel.js
// Garage / dealership sheet.
//
// The catalogue, the prices, the cash and the owned list all come from
// GET /api/vehicles. Buying is POST /api/vehicles/buy, which is the only place
// money actually moves — the panel just re-reads the server afterwards.

import { getVehicles } from '../auth/api.js';
import { icon } from './icons.js';
import { claimEscape } from './escape.js';

const KIND_LABEL = {
  hiace: '18-seater minibus',
  tricycle: 'Tricycle (keke)',
  motorcycle: 'Motorbike (okada)',
  taxi: 'Taxi',
  sedan: 'Saloon car',
  suv: 'SUV',
  car: 'Car',
};

export class VehiclesPanel {
  /**
   * @param {object} o
   * @param {object} o.vehicles      - VehicleSystem (owns buy + spawn)
   * @param {function} o.onToast     - (msg, type) => void
   * @param {function} o.onWalkTo    - (x, z) => void, route to a parked vehicle
   */
  constructor({ vehicles, onToast, onWalkTo } = {}) {
    this.vehicles = vehicles;
    this.onToast = onToast || (() => {});
    this.onWalkTo = onWalkTo || (() => {});
    this.token = null;
    this.cash = 0;

    this._build();
    window.addEventListener('keydown', (e) => {
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
    el.className = 'panel vehicles-panel hidden';
    el.innerHTML = `
      <header class="panel-head">
        <h2>${icon('energy', 18)} Garage</h2>
        <div class="panel-head-right">
          <span class="inventory-cash"></span>
          <button class="panel-close" type="button" aria-label="Close">${icon('close', 16)}</button>
        </div>
      </header>
      <div class="vehicles-body"></div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this.bodyEl = el.querySelector('.vehicles-body');
    this.cashEl = el.querySelector('.inventory-cash');
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
    const res = await getVehicles(this.token);
    if (res.error) {
      this.bodyEl.innerHTML = `<p class="panel-empty">${res.error}</p>`;
      return;
    }
    this.catalog = res.catalog || [];
    this.owned = res.owned || [];
    this.cash = res.cash || 0;
    this._render();
  }

  _render() {
    const money = `₦${Math.round(this.cash).toLocaleString('en-NG')}`;
    this.cashEl.textContent = money;

    const ownedRows = this.owned.length === 0
      ? `<p class="panel-empty">You do not own a vehicle yet.</p>`
      : this.owned.map((v) => `
        <div class="inv-row">
          <span class="inv-icon">${icon('energy', 18)}</span>
          <div class="inv-info">
            <div class="inv-name">${v.def?.name || v.vehicle_id}</div>
            <div class="inv-desc">
              Fuel ${Math.round(v.fuel)}/${v.def?.tankLitres || 45} L ·
              parked at ${Math.round(v.pos_x)}, ${Math.round(v.pos_z)}
            </div>
          </div>
          <div class="inv-actions">
            <button class="inv-use" data-walk="${v.pos_x},${v.pos_z}">Walk to it</button>
          </div>
        </div>
      `).join('');

    const shopRows = this.catalog.map((c) => {
      const affordable = this.cash >= c.price;
      return `
        <div class="inv-row">
          <span class="inv-icon">${icon('energy', 18)}</span>
          <div class="inv-info">
            <div class="inv-name">${c.name}</div>
            <div class="inv-desc">
              ${KIND_LABEL[c.kind] || c.kind} · ${c.maxSpeed} km/h ·
              ${c.seats} seats · ${c.tankLitres} L tank
            </div>
          </div>
          <div class="inv-actions">
            <button class="mission-btn ${affordable ? '' : 'is-locked'}"
                    data-buy="${c.id}" ${affordable ? '' : 'disabled'}>
              ₦${c.price.toLocaleString('en-NG')}
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.bodyEl.innerHTML = `
      <div class="garage-section">
        <h3 class="garage-title">Your vehicles</h3>
        ${ownedRows}
      </div>
      <div class="garage-section">
        <h3 class="garage-title">Dealership <span class="garage-note">fuel ₦${(this.vehicles.fuelPrice || 900).toLocaleString('en-NG')}/L</span></h3>
        ${shopRows}
      </div>
      <p class="panel-note">Walk up to a vehicle you own and press <kbd>F</kbd> to drive it.</p>
    `;

    this.bodyEl.querySelectorAll('[data-buy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const bought = await this.vehicles.buy(btn.dataset.buy);
        await this.refresh();
        if (bought) {
          this.onToast('Your new vehicle is parked next to you — press F to drive', 'info');
        }
      });
    });

    this.bodyEl.querySelectorAll('[data-walk]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const [x, z] = btn.dataset.walk.split(',').map(Number);
        this.hide();
        this.onWalkTo({ x, z });
      });
    });
  }
}
