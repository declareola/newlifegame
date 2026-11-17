// client/src/ui/DriveHUD.js
// Speed + fuel readout shown only while driving.
//
// The numbers come from the vehicle row itself: speed is the real velocity the
// simulation is applying this frame, and fuel is the value the server will be
// told when you park — not a decorative gauge.

export class DriveHUD {
  constructor() {
    const el = document.createElement('div');
    el.className = 'drive-hud hidden';
    el.innerHTML = `
      <div class="drive-speed">0<small>km/h</small></div>
      <div class="drive-fuel">
        <span class="drive-fuel-label">Fuel</span>
        <span class="drive-fuel-bar"><i style="width:100%"></i></span>
      </div>
      <div class="drive-vehicle"></div>
    `;
    document.body.appendChild(el);

    this.el = el;
    this.speedEl = el.querySelector('.drive-speed');
    this.fuelFillEl = el.querySelector('.drive-fuel-bar i');
    this.fuelBarEl = el.querySelector('.drive-fuel-bar');
    this.vehicleEl = el.querySelector('.drive-vehicle');
    this._lastSpeed = null;
  }

  /** @param {number|null} kph  null hides the HUD */
  show(kph, vehicle) {
    if (kph === null || kph === undefined) {
      this.el.classList.add('hidden');
      this._lastSpeed = null;
      return;
    }
    this.el.classList.remove('hidden');
    const rounded = Math.round(kph);
    if (rounded !== this._lastSpeed) {
      this.speedEl.innerHTML = `${rounded}<small>km/h</small>`;
      this._lastSpeed = rounded;
    }
    if (vehicle) {
      this.vehicleEl.textContent = vehicle.def?.name || 'Vehicle';
    }
  }

  setFuel(litres, tank) {
    const total = tank || 45;
    const pct = Math.max(0, Math.min(100, (litres / total) * 100));
    this.fuelFillEl.style.width = `${pct.toFixed(1)}%`;
    this.fuelBarEl.classList.toggle('low', pct < 20);
  }
}
