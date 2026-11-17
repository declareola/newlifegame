// client/src/ui/ActionBar.js
// The bottom action bar: a single, thumb-reachable row of icon buttons that
// replaces hunting for hotkeys. Works with mouse, touch and keyboard (1-7).
//
// It also owns the "Places" sheet — a directory of every enterable building
// with a straight-line distance and a bearing from the player.

import { icon } from './icons.js';

const ACTIONS = [
  // Home first: it is the one button that takes the character somewhere.
  { id: 'home',        icon: 'home',       label: 'Home',      key: 'h' },
  { id: 'jobs',        icon: 'briefcase',  label: 'Jobs',      key: '1' },
  { id: 'missions',    icon: 'activities', label: 'Missions',  key: '2' },
  { id: 'activities',  icon: 'fun',        label: 'Activities', key: '3' },
  { id: 'property',    icon: 'property',   label: 'Property',  key: '4' },
  { id: 'places',      icon: 'door',       label: 'Map',       key: '5' },
  { id: 'garage',      icon: 'energy',     label: 'Garage',    key: '6' },
  { id: 'bag',         icon: 'briefcase',  label: 'Bag',       key: '7' },
  { id: 'character',   icon: 'user',       label: 'You',       key: '8' },
  { id: 'leaderboard', icon: 'trophy',     label: 'Ranks',     key: '9' },
  { id: 'menu',        icon: 'settings',   label: 'Menu',      key: '0' },
];

export class ActionBar {
  /**
   * @param {object} o
   * @param {function} o.onAction - (id) => void, called for every button
   * @param {function} o.getPlaces - () => [{name, x, z}] for the Places sheet
   * @param {function} o.getPlayerPosition - () => ({x, z})
   */
  constructor({ onAction, getPlaces, getPlayerPosition } = {}) {
    this.onAction = onAction || (() => {});
    this.getPlaces = getPlaces || (() => []);
    this.getPlayerPosition = getPlayerPosition || (() => ({ x: 0, z: 0 }));
    this.sheetOpen = false;

    this._buildBar();
    this._buildSheet();
    this._bindKeys();
  }

  _buildBar() {
    const bar = document.createElement('div');
    bar.className = 'action-bar hidden';

    bar.innerHTML = ACTIONS.map((a) => `
      <button class="action-btn" type="button" data-action="${a.id}" title="${a.label} (${a.key})">
        ${icon(a.icon, 20)}
        <span class="action-label">${a.label}</span>
      </button>
    `).join('');

    document.body.appendChild(bar);
    this.bar = bar;

    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.action;
      this._flash(btn);
      // Every button does something real. 'places' opens the world map, which
      // is the navigable destination picker (the old sheet is still available
      // from the map panel itself).
      this.onAction(id);
    });
  }

  _buildSheet() {
    const sheet = document.createElement('div');
    sheet.className = 'sheet hidden';
    sheet.innerHTML = `
      <div class="sheet-backdrop"></div>
      <div class="sheet-panel" role="dialog" aria-label="Places">
        <div class="sheet-header">
          <h2>${icon('door', 20)} Places you can enter</h2>
          <button class="sheet-close" type="button" aria-label="Close">${icon('close', 18)}</button>
        </div>
        <div class="sheet-body"></div>
        <div class="sheet-footer">Walk onto the glowing ring and press <kbd>E</kbd></div>
      </div>
    `;
    document.body.appendChild(sheet);

    this.sheet = sheet;
    this.sheetBody = sheet.querySelector('.sheet-body');

    sheet.querySelector('.sheet-backdrop').addEventListener('click', () => this.closeSheet());
    sheet.querySelector('.sheet-close').addEventListener('click', () => this.closeSheet());
  }

  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.code === 'Escape' && this.sheetOpen) {
        this.closeSheet();
        return;
      }
      // A dialogue owns 1-9 while it is open, and no shortcut should fire on
      // top of an open panel.
      if (document.querySelector('.dialogue:not(.hidden)')) return;
      if (document.querySelector('.panel:not(.hidden)')) return;
      if (document.body.classList.contains('panel-open')) return;
      const hit = ACTIONS.find((a) => a.key === e.key);
      if (!hit) return;
      this.onAction(hit.id);
    });
  }

  /**
   * Reflect the player's housing situation on the Home button.
   *
   * A disabled button that explains itself is honest; a button that looks live
   * and does nothing is not. Called whenever housing state arrives.
   * @param {object|null} home the property the player lives in, or null
   */
  setHomeState(home) {
    const btn = this.bar?.querySelector('[data-action="home"]');
    if (!btn) return;
    const name = home && home.name ? home.name : null;
    this.home = home || null;
    btn.classList.toggle('disabled', !name);
    btn.setAttribute('aria-disabled', name ? 'false' : 'true');
    btn.title = name
      ? `Go home to ${name} (H)`
      : 'No home yet — rent or buy one from Property (4)';
    const label = btn.querySelector('.action-label');
    if (label) label.textContent = 'Home';
  }

  _flash(btn) {
    btn.classList.add('pressed');
    setTimeout(() => btn.classList.remove('pressed'), 160);
  }

  // ── Places sheet ─────────────────────────────────────────

  toggleSheet() {
    if (this.sheetOpen) this.closeSheet();
    else this.openSheet();
  }

  openSheet() {
    this._renderPlaces();
    this.sheet.classList.remove('hidden');
    this.sheetOpen = true;
    // Let the layout settle before animating in
    requestAnimationFrame(() => this.sheet.classList.add('open'));
  }

  closeSheet() {
    this.sheet.classList.remove('open');
    this.sheetOpen = false;
    setTimeout(() => {
      if (!this.sheetOpen) this.sheet.classList.add('hidden');
    }, 220);
  }

  _renderPlaces() {
    const { x, z } = this.getPlayerPosition();
    const places = this.getPlaces()
      .map((p) => ({
        ...p,
        distance: Math.hypot(p.x - x, p.z - z),
        bearing: Math.atan2(p.x - x, p.z - z),
      }))
      .sort((a, b) => a.distance - b.distance);

    if (places.length === 0) {
      this.sheetBody.innerHTML = '<p class="sheet-empty">No enterable buildings nearby.</p>';
      return;
    }

    this.sheetBody.innerHTML = places.map((p) => {
      const deg = ((p.bearing * 180) / Math.PI + 360) % 360;
      const arrow = { r: 0 };
      void arrow;
      return `
        <div class="place-row">
          <span class="place-arrow" style="transform: rotate(${deg}deg)">${icon('chevron', 14)}</span>
          <span class="place-name">${p.name}</span>
          <span class="place-distance">${Math.round(p.distance)} m</span>
        </div>
      `;
    }).join('');
  }

  show() {
    this.bar.classList.remove('hidden');
  }

  hide() {
    this.bar.classList.add('hidden');
    if (this.sheetOpen) this.closeSheet();
  }
}
