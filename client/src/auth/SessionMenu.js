import { logout, changePassword } from '../auth/api.js';

/**
 * Small account menu, opened from the HUD username (or the Escape key).
 * Offers a real logout (which revokes the token server-side) and a password
 * change that keeps you signed in.
 */
export class SessionMenu {
  /**
   * @param {object} opts
   * @param {function} opts.onLoggedOut  - called after a successful logout
   * @param {function} opts.onNewToken   - (token, user) after a password change
   * @param {function} opts.onToast      - (message, type)
   */
  constructor({ onLoggedOut, onNewToken, onToast } = {}) {
    this.onLoggedOut = onLoggedOut || (() => {});
    this.onNewToken = onNewToken || (() => {});
    this.onToast = onToast || (() => {});

    this.token = null;
    this.mode = 'menu'; // 'menu' | 'password'
    this.busy = false;

    this.root = document.createElement('div');
    this.root.className = 'session-menu hidden';
    document.body.appendChild(this.root);

    this._render();
  }

  setToken(token) {
    this.token = token;
  }

  toggle() {
    if (this.root.classList.contains('hidden')) this.open();
    else this.close();
  }

  open() {
    this.mode = 'menu';
    this._render();
    this.root.classList.remove('hidden');
  }

  close() {
    this.root.classList.add('hidden');
    this.mode = 'menu';
  }

  get isOpen() {
    return !this.root.classList.contains('hidden');
  }

  _render() {
    const body = this.mode === 'password' ? this._passwordHtml() : this._menuHtml();
    this.root.innerHTML = `
      <div class="session-header">
        <h2>⚙️ Account</h2>
        <button class="session-close" data-action="close">✕</button>
      </div>
      ${body}
      <div class="session-error" style="display:none"></div>
    `;
    this._wire();
  }

  _menuHtml() {
    return `
      <button class="session-item" data-action="password">
        <span class="session-item-icon">🔑</span>
        <span>
          <span class="session-item-title">Change password</span>
          <span class="session-item-desc">Signs out your other devices</span>
        </span>
      </button>
      <button class="session-item session-item-danger" data-action="logout">
        <span class="session-item-icon">🚪</span>
        <span>
          <span class="session-item-title">Log out</span>
          <span class="session-item-desc">Ends this session everywhere</span>
        </span>
      </button>
    `;
  }

  _passwordHtml() {
    return `
      <div class="session-field">
        <label>Current password</label>
        <input type="password" data-input="current" autocomplete="current-password" />
      </div>
      <div class="session-field">
        <label>New password</label>
        <input type="password" data-input="new" autocomplete="new-password" />
      </div>
      <div class="session-field">
        <label>Confirm new password</label>
        <input type="password" data-input="confirm" autocomplete="new-password" />
      </div>
      <div class="session-actions">
        <button class="session-btn session-btn-ghost" data-action="back">Back</button>
        <button class="session-btn session-btn-primary" data-action="save">Save</button>
      </div>
    `;
  }

  _wire() {
    this.root.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'close') this.close();
        if (action === 'password') { this.mode = 'password'; this._render(); }
        if (action === 'back') { this.mode = 'menu'; this._render(); }
        if (action === 'logout') this._handleLogout();
        if (action === 'save') this._handlePassword();
      });
    });

    // Escape closes, and Enter submits the password form.
    this.root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') this.close();
      if (e.key === 'Enter' && this.mode === 'password') this._handlePassword();
    });
  }

  async _handleLogout() {
    if (this.busy) return;
    this.busy = true;
    if (this.token) await logout(this.token);
    this.busy = false;
    this.close();
    this.onLoggedOut();
  }

  async _handlePassword() {
    if (this.busy) return;

    const current = this.root.querySelector('[data-input="current"]')?.value || '';
    const next = this.root.querySelector('[data-input="new"]')?.value || '';
    const confirm = this.root.querySelector('[data-input="confirm"]')?.value || '';

    if (!current || !next) return this._showError('Fill in every field');
    if (next !== confirm) return this._showError('New passwords do not match');
    if (next.length < 8) return this._showError('New password must be at least 8 characters');

    this.busy = true;
    const result = await changePassword(this.token, current, next);
    this.busy = false;

    if (result.error) return this._showError(result.error);

    this.close();
    this.onNewToken(result.token, result.user);
    this.onToast('🔑 Password changed — other devices signed out', 'info');
  }

  _showError(msg) {
    const el = this.root.querySelector('.session-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }
}
