// client/src/ui/PauseMenu.js
// Esc menu: resume, controls, save, settings and sign-out.
//
// Opening this pauses movement and the camera, but nothing else: needs keep
// ticking on the server, missions keep their progress, and the player keeps
// their exact position. Closing it puts you back where you were.

import { icon } from './icons.js';
import { saveProgress } from '../auth/api.js';
import { claimEscape, escapeWasClaimed } from './escape.js';

export class PauseMenu {
  /**
   * @param {object} o
   * @param {function} o.onResume      - () => void
   * @param {function} o.onControls    - () => void, open the controls guide
   * @param {function} o.onTutorial    - () => void, replay the first-run guide
   * @param {function} o.onLogout      - () => void
   * @param {function} o.onToast       - (msg, type) => void
   * @param {function} o.getQuality    - () => 'high'|'medium'|'low'
   * @param {function} o.setQuality    - (q) => void
   * @param {function} o.cycleCamera   - () => string (cycles, returns new label)
   * @param {function} o.getLook        - () => {sensitivity, invertY, pointerLock}
   * @param {function} o.setLook        - (patch) => void
   * @param {function} o.getAudio       - () => {master, sfx, ambience, music, muted}
   * @param {function} o.setAudio       - (bus, value) => void
   * @param {function} o.toggleMute     - () => boolean (returns new mute state)
   * @param {function} o.getStatus      - () => {fps, drawCalls, players, view, quality}
   */
  constructor({
    onResume, onControls, onLogout, onToast,
    getQuality, setQuality, cycleCamera, isTouch = false,
    getLook, setLook, getCameraLabel, onTutorial,
    getAudio, setAudio, toggleMute, getStatus,
  } = {}) {
    this.onResume = onResume || (() => {});
    this.onControls = onControls || (() => {});
    this.onTutorial = onTutorial || (() => {});
    this.onLogout = onLogout || (() => {});
    this.onToast = onToast || (() => {});
    this.getQuality = getQuality || (() => 'high');
    this.setQuality = setQuality || (() => {});
    this.cycleCamera = cycleCamera || (() => 'chase');
    this.getLook = getLook || (() => ({ sensitivity: 1, invertY: false, pointerLock: false }));
    this.setLook = setLook || (() => {});
    this.getCameraLabel = getCameraLabel || (() => 'Third person');
    this.getAudio = getAudio || (() => ({ master: 0.8, sfx: 0.9, ambience: 0.55, music: 0.35, muted: false }));
    this.setAudio = setAudio || (() => {});
    this.toggleMute = toggleMute || (() => false);
    this.getStatus = getStatus || (() => ({}));
    this.tab = 'main';
    this.token = null;
    this.isOpen = false;

    this._build();
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code !== 'Escape' || !this.token) return;

      // Closing is unconditional: if this menu is on screen, Escape removes it,
      // whatever else happens to be in the DOM.
      if (this.isOpen) {
        claimEscape(e);
        this.close();
        return;
      }

      // Another component already used this keypress (a panel closed, a
      // dialogue shut). Do not also open the pause menu.
      if (escapeWasClaimed(e)) return;

      // Escape first closes whatever else is open — one press, one thing.
      if (document.querySelector('.panel:not(.hidden)')) return;
      if (document.querySelector('.controls-overlay:not(.hidden)')) return;
      // The dialogue's visibility class lives on its wrapper (.dialogue), not on
      // the inner .dialogue-panel — testing the inner node made this guard
      // permanently true, which is why Escape never reached open().
      if (document.querySelector('.dialogue:not(.hidden)')) return;
      if (document.querySelector('.sheet.open')) return;
      if (document.body.classList.contains('typing')) return;
      if (this._typingInField()) return;
      this.open();
    });
  }

  setToken(token) {
    this.token = token;
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'pause-overlay hidden';
    el.innerHTML = `
      <div class="pause-panel" role="dialog" aria-label="Paused">
        <header class="pause-head">
          <h2>Paused</h2>
          <span class="pause-sub">The city keeps running while you are here.</span>
        </header>

        <nav class="pause-tabs" role="tablist">
          <button class="pause-tab" role="tab" data-tab="main">Main</button>
          <button class="pause-tab" role="tab" data-tab="settings">Settings</button>
          <button class="pause-tab" role="tab" data-tab="status">Status</button>
        </nav>

        <section class="pause-pane" data-pane="main">
          <div class="pause-rows">
            <button class="pause-row" data-act="resume">
              ${icon('walk', 18)} <span>Resume</span> <kbd>Esc</kbd>
            </button>
            <button class="pause-row" data-act="save">
              ${icon('bank', 18)} <span>Save progress</span> <kbd>now</kbd>
            </button>
            <button class="pause-row" data-act="controls">
              ${icon('settings', 18)} <span>Controls</span> <kbd>F1</kbd>
            </button>
            <button class="pause-row" data-act="tutorial">
              ${icon('info', 18)} <span>Getting started guide</span> <kbd>again</kbd>
            </button>
            <button class="pause-row" data-act="camera">
              ${icon('camera', 18)} <span>Camera: <b class="pause-cam"></b></span> <kbd>V</kbd>
            </button>
            <button class="pause-row" data-act="quality">
              ${icon('graphics', 18)} <span>Graphics: <b class="pause-quality"></b></span> <kbd>Q</kbd>
            </button>
          </div>
          <div class="pause-actions">
            <button class="pause-danger" data-act="logout">Sign out</button>
          </div>
          <p class="pause-note">Your money, items, missions and vehicles are stored on the server.</p>
        </section>

        <section class="pause-pane hidden" data-pane="settings">
          <h3 class="pause-h3">Camera</h3>
          <div class="pause-look">
            <div class="pause-look-row">
              <label for="pause-sens">Look sensitivity</label>
              <input id="pause-sens" class="pause-sens" type="range" min="0.2" max="3" step="0.1" value="1">
              <output class="pause-sens-out">1.0×</output>
            </div>
            <div class="pause-look-row">
              <label for="pause-invert">Invert vertical look</label>
              <input id="pause-invert" class="pause-invert" type="checkbox">
              <span class="pause-look-tag">mouse / touchpad</span>
            </div>
            <div class="pause-look-row">
              <label for="pause-lock">Capture mouse on click</label>
              <input id="pause-lock" class="pause-lock" type="checkbox">
              <span class="pause-look-tag">free look without dragging</span>
            </div>
          </div>

          <h3 class="pause-h3">Sound</h3>
          <div class="pause-look">
            <div class="pause-look-row">
              <label for="pause-vol-master">Master</label>
              <input id="pause-vol-master" class="pause-vol" data-bus="master" type="range" min="0" max="1" step="0.05" value="0.8">
              <output class="pause-vol-out">80%</output>
            </div>
            <div class="pause-look-row">
              <label for="pause-vol-sfx">Effects</label>
              <input id="pause-vol-sfx" class="pause-vol" data-bus="sfx" type="range" min="0" max="1" step="0.05" value="0.9">
              <output class="pause-vol-out">90%</output>
            </div>
            <div class="pause-look-row">
              <label for="pause-vol-ambience">City ambience</label>
              <input id="pause-vol-ambience" class="pause-vol" data-bus="ambience" type="range" min="0" max="1" step="0.05" value="0.55">
              <output class="pause-vol-out">55%</output>
            </div>
            <div class="pause-look-row">
              <label for="pause-vol-music">Music</label>
              <input id="pause-vol-music" class="pause-vol" data-bus="music" type="range" min="0" max="1" step="0.05" value="0.35">
              <output class="pause-vol-out">35%</output>
            </div>
            <div class="pause-look-row">
              <label for="pause-mute">Mute everything</label>
              <input id="pause-mute" class="pause-mute" type="checkbox">
              <span class="pause-look-tag">M</span>
            </div>
          </div>
        </section>

        <section class="pause-pane hidden" data-pane="status">
          <dl class="pause-status">
            <div><dt>Frame rate</dt><dd class="st-fps">—</dd></div>
            <div><dt>Draw calls</dt><dd class="st-draws">—</dd></div>
            <div><dt>Players online</dt><dd class="st-players">—</dd></div>
            <div><dt>Camera</dt><dd class="st-view">—</dd></div>
            <div><dt>Graphics</dt><dd class="st-quality">—</dd></div>
            <div><dt>Sound</dt><dd class="st-audio">—</dd></div>
          </dl>
          <p class="pause-note">Figures come from the live renderer, not an estimate.</p>
        </section>
      </div>
    `;
    document.body.appendChild(el);
    this.el = el;
    this.camEl = el.querySelector('.pause-cam');
    this.qualityEl = el.querySelector('.pause-quality');

    // ── Tabs ──
    el.querySelectorAll('.pause-tab').forEach((btn) => {
      btn.addEventListener('click', () => this._setTab(btn.dataset.tab));
    });

    // ── Camera look controls ──
    this.sensEl = el.querySelector('.pause-sens');
    this.sensOutEl = el.querySelector('.pause-sens-out');
    this.invertEl = el.querySelector('.pause-invert');
    this.lockEl = el.querySelector('.pause-lock');

    const syncLookLabel = () => {
      this.sensOutEl.textContent = `${Number(this.sensEl.value).toFixed(1)}×`;
    };
    this.sensEl.addEventListener('input', () => {
      syncLookLabel();
      this.setLook({ sensitivity: Number(this.sensEl.value) });
    });
    this.invertEl.addEventListener('change', () => {
      this.setLook({ invertY: this.invertEl.checked });
    });
    this.lockEl.addEventListener('change', () => {
      this.setLook({ pointerLock: this.lockEl.checked });
      if (this.lockEl.checked) this.onToast('Click the world to capture the mouse · Esc releases', 'info');
    });
    this._syncLookLabel = syncLookLabel;

    // ── Sound controls ──
    this.volEls = [...el.querySelectorAll('.pause-vol')];
    for (const input of this.volEls) {
      input.addEventListener('input', () => {
        const bus = input.dataset.bus;
        const value = Number(input.value);
        this.setAudio(bus, value);
        const out = input.parentElement.querySelector('.pause-vol-out');
        if (out) out.textContent = `${Math.round(value * 100)}%`;
      });
    }
    this.muteEl = el.querySelector('.pause-mute');
    this.muteEl.addEventListener('change', () => {
      // The engine owns the truth; read it back rather than trusting the box.
      const muted = this.toggleMute();
      this.muteEl.checked = Boolean(muted);
      this.onToast(muted ? 'Sound off' : 'Sound on', 'info');
    });

    el.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-tab]');
      if (tab) return; // handled above
      const btn = e.target.closest('[data-act]');
      if (btn) {
        this._action(btn.dataset.act);
        return;
      }
      // Clicking the dimmed backdrop (anywhere outside the panel) dismisses it,
      // the same way Escape does.
      if (e.target === el) this.close();
    });
  }

  /** Switch the visible pane. Escape still closes the whole menu. */
  _setTab(tab) {
    this.tab = ['main', 'settings', 'status'].includes(tab) ? tab : 'main';
    this.el.querySelectorAll('.pause-tab').forEach((b) => {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.el.querySelectorAll('.pause-pane').forEach((p) => {
      p.classList.toggle('hidden', p.dataset.pane !== this.tab);
    });
    if (this.tab === 'status') this._paintStatus();
    return this.tab;
  }

  _paintStatus() {
    const s = this.getStatus() || {};
    const set = (sel, value) => {
      const node = this.el.querySelector(sel);
      if (node) node.textContent = value;
    };
    set('.st-fps', Number.isFinite(s.fps) ? `${Math.round(s.fps)} fps` : '—');
    set('.st-draws', Number.isFinite(s.drawCalls) ? String(s.drawCalls) : '—');
    set('.st-players', Number.isFinite(s.players) ? String(s.players) : '—');
    set('.st-view', String(s.view || this.getCameraLabel()).toLowerCase());
    set('.st-quality', String(s.quality || this.getQuality()));
    const a = this.getAudio() || {};
    set('.st-audio', a.muted ? 'muted' : `master ${Math.round((a.master ?? 0) * 100)}%`);
  }

  async _action(act) {
    switch (act) {
      case 'resume': this.close(); break;
      case 'save': await this._save(); break;
      case 'tutorial': {
        this.close();
        this.onTutorial();
        break;
      }
      case 'controls': {
        this.close();
        this.onControls();
        break;
      }
      case 'camera': {
        const mode = this.cycleCamera();
        this.camEl.textContent = String(mode).toLowerCase();
        break;
      }
      case 'quality': {
        const order = ['high', 'medium', 'low'];
        const next = order[(order.indexOf(this.getQuality()) + 1) % order.length];
        this.setQuality(next);
        this.qualityEl.textContent = next;
        break;
      }
      case 'logout': this.onLogout(); break;
      default: break;
    }
  }

  async _save() {
    if (!this.token) return;
    const btn = this.el.querySelector('[data-act="save"]');
    btn.disabled = true;
    const res = await saveProgress(this.token);
    btn.disabled = false;
    if (res.error) {
      this.onToast(res.error, 'warning');
      return;
    }
    const when = new Date(res.savedAt).toLocaleTimeString('en-NG', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    this.onToast(
      `Saved at ${when} — ₦${Number(res.user?.cash ?? 0).toLocaleString('en-NG')} cash`,
      'success'
    );
  }

  /** True when focus is in a text field — Escape there belongs to the field. */
  _typingInField() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA';
  }

  open() {
    this.isOpen = true;
    this.el.classList.remove('hidden');
    document.body.classList.add('panel-open');
    this.camEl.textContent = String(this.getCameraLabel ? this.getCameraLabel() : 'third person').toLowerCase();
    this.qualityEl.textContent = this.getQuality();
    this._setTab(this.tab || 'main');

    // Sound settings come from the engine, so the sliders can never drift.
    const audio = this.getAudio() || {};
    for (const input of this.volEls || []) {
      const v = audio[input.dataset.bus];
      if (Number.isFinite(v)) {
        input.value = String(v);
        const out = input.parentElement.querySelector('.pause-vol-out');
        if (out) out.textContent = `${Math.round(v * 100)}%`;
      }
    }
    if (this.muteEl) this.muteEl.checked = Boolean(audio.muted);

    // Read the live look settings back into the controls.
    const look = this.getLook() || {};
    this.sensEl.value = String(look.sensitivity ?? 1);
    this.invertEl.checked = Boolean(look.invertY);
    this.lockEl.checked = Boolean(look.pointerLock);
    if (this._syncLookLabel) this._syncLookLabel();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    // Another panel may still be open; only clear the shared body state if
    // nothing else is showing, otherwise the action bar stays dimmed.
    if (!document.querySelector('.panel:not(.hidden), .controls-overlay:not(.hidden), .dialogue:not(.hidden)')) {
      document.body.classList.remove('panel-open');
    }
    this.onResume();
  }
}
