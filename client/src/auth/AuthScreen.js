// client/src/auth/AuthScreen.js
// The way into the game: account, character, starting tier.
//
// This used to be one long form with two colour swatches. It is now a three-step
// wizard with a live 3D preview of the character you are about to play, because
// the first thing a new player does should be to see who they are.
//
// Steps
//   1  Account   — username, password (sign up or log in)
//   2  Character — skin, hair, build, outfit, with a turning 3D preview
//   3  Start     — the tier you begin with, then the button
//
// Everything the creator shows is real: the preview is the same Avatar class the
// game uses, and the choices are the same look object main.js applies to the
// player. Nothing here is a fake swatch.

import * as THREE from 'three';
import { signup, login, setToken } from './api.js';
import { Avatar } from '../player/Avatar.js';
import {
  SKIN_TONES, HAIR_STYLES, HAIR_COLOURS, BODY_TYPES, OUTFITS,
  normaliseLook, hexToInt, intToHex, withOutfit,
} from '../player/outfits.js';

const TIERS = [
  { id: 'nepo',   name: 'Nepo',   desc: '₦5,000,000', debt: '₦0 debt',       colour: '#9b59b6',
    note: 'Family money. A soft landing and a fast car.' },
  { id: 'middle', name: 'Middle', desc: '₦500,000',   debt: '₦0 debt',       colour: '#3498db',
    note: 'Enough to start something. Not enough to be safe.' },
  { id: 'lapo',   name: 'Lapo',   desc: '₦50,000',    debt: '₦300,000 debt', colour: '#e74c3c',
    note: 'A loan, a hustle and a city that does not wait.' },
];

const STEPS = ['Account', 'Character', 'Start'];

export class AuthScreen {
  /**
   * @param {function} onAuthSuccess - (token, user, look) => void
   */
  constructor(onAuthSuccess) {
    this.onAuthSuccess = onAuthSuccess;
    this.mode = 'signup';
    this.step = 0;
    this.tier = 'middle';
    this.look = normaliseLook({ outfit: 'casual' });
    this.busy = false;
    // Step 1's inputs are destroyed when step 2 renders, so their values are
    // held here. The password is wiped as soon as it has been used.
    this._savedUsername = '';
    this._savedPassword = '';

    this._build();
    this._renderStep();
  }

  // ── DOM ────────────────────────────────────────────────────

  _build() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'auth-overlay';
    this.overlay.innerHTML = `
      <div class="auth-panel">
        <header class="auth-head">
          <div class="auth-brand">
            <h1>NewLife</h1>
            <p class="auth-subtitle">Lagos. Make of it what you can.</p>
          </div>
          <ol class="auth-steps" id="auth-steps"></ol>
        </header>

        <div class="auth-body" id="auth-body"></div>

        <footer class="auth-foot">
          <button class="auth-back" type="button" data-act="back">Back</button>
          <div class="auth-foot-right">
            <span class="auth-error" id="auth-error" role="alert"></span>
            <button class="auth-next" type="button" data-act="next">Continue</button>
          </div>
        </footer>
      </div>
    `;
    document.body.appendChild(this.overlay);

    this.stepsEl = this.overlay.querySelector('#auth-steps');
    this.bodyEl = this.overlay.querySelector('#auth-body');
    this.errorEl = this.overlay.querySelector('#auth-error');
    this.backBtn = this.overlay.querySelector('[data-act="back"]');
    this.nextBtn = this.overlay.querySelector('[data-act="next"]');

    this.backBtn.addEventListener('click', () => this._back());
    this.nextBtn.addEventListener('click', () => this._next());

    this.overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target && e.target.tagName === 'TEXTAREA') return;
      e.preventDefault();
      this._next();
    });
  }

  _error(msg) {
    this.errorEl.textContent = msg || '';
    this.errorEl.classList.toggle('shown', Boolean(msg));
  }

  _renderStep() {
    // Step dots
    this.stepsEl.innerHTML = STEPS.map((label, i) => `
      <li class="${i === this.step ? 'current' : i < this.step ? 'done' : ''}">
        <b>${i < this.step ? '✓' : i + 1}</b><span>${label}</span>
      </li>
    `).join('');

    this.backBtn.disabled = this.step === 0;
    this.nextBtn.textContent = this.step === STEPS.length - 1
      ? (this.mode === 'signup' ? 'Start life' : 'Enter Lagos')
      : 'Continue';
    this._error('');

    if (this.step === 0) this._renderAccount();
    else if (this.step === 1) this._renderCharacter();
    else this._renderStart();
  }

  // ── Step 1: account ────────────────────────────────────────

  _renderAccount() {
    this._disposePreview();
    this.bodyEl.innerHTML = `
      <div class="auth-tabs">
        <button class="auth-tab ${this.mode === 'signup' ? 'active' : ''}" data-mode="signup" type="button">Sign up</button>
        <button class="auth-tab ${this.mode === 'login' ? 'active' : ''}" data-mode="login" type="button">Log in</button>
      </div>
      <form class="auth-form" id="auth-form" autocomplete="on">
        <label class="auth-field">
          <span>Username</span>
          <input type="text" id="auth-username" placeholder="3–16 letters or numbers"
                 autocomplete="username" maxlength="16" spellcheck="false" />
          <em class="auth-hint" id="auth-username-hint">This is the name other players see.</em>
        </label>
        <label class="auth-field">
          <span>Password</span>
          <input type="password" id="auth-password" placeholder="At least 8 characters"
                 autocomplete="current-password" />
          <em class="auth-hint" id="auth-password-hint">Never reused from another site.</em>
        </label>
      </form>
      <p class="auth-note">
        ${this.mode === 'signup'
          ? 'Next you design your character, then pick how you start.'
          : 'Your saved character and progress load when you sign in.'}
      </p>
    `;

    this.bodyEl.querySelectorAll('.auth-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        this.mode = tab.dataset.mode;
        this._renderStep();
        this.overlay.querySelector('#auth-username')?.focus();
      });
    });

    const user = this.overlay.querySelector('#auth-username');
    const pass = this.overlay.querySelector('#auth-password');
    if (this._savedUsername) user.value = this._savedUsername;
    if (this._savedPassword) pass.value = this._savedPassword;
    user.addEventListener('input', () => { this._savedUsername = user.value; this._error(''); });
    // The password field is destroyed when step 1 is replaced by step 2, so it
    // has to be remembered as it is typed. Without this the final POST /signup
    // carried an empty password.
    pass.addEventListener('input', () => { this._savedPassword = pass.value; this._error(''); });
    setTimeout(() => (this._savedUsername ? pass : user).focus(), 30);
  }

  /** The username typed in step 1 (the field is gone by step 3). */
  _accountUsername() {
    const live = this.overlay.querySelector('#auth-username')?.value.trim();
    return live || this._savedUsername || '';
  }

  /** The password typed in step 1, from the cache once step 1 is gone. */
  _accountPassword() {
    const live = this.overlay.querySelector('#auth-password')?.value;
    return live !== undefined && live !== '' ? live : (this._savedPassword || '');
  }

  /** Check the account fields. Returns an error string, or null. */
  _validateAccount() {
    const username = this._accountUsername();
    const password = this._accountPassword();

    if (!/^[a-zA-Z0-9]{3,16}$/.test(username)) {
      return 'Username must be 3–16 letters or numbers.';
    }
    if (this.mode === 'signup' && password.length < 8) {
      return 'Password must be at least 8 characters.';
    }
    if (this.mode === 'login' && password.length === 0) {
      return 'Enter your password.';
    }
    return null;
  }

  // ── Step 2: character ─────────────────────────────────────

  _renderCharacter() {
    this.bodyEl.innerHTML = `
      <div class="creator">
        <div class="creator-preview">
          <canvas class="creator-canvas" width="260" height="340"></canvas>
          <button class="creator-shuffle" type="button" data-act="shuffle">Surprise me</button>
          <p class="creator-caption">This is exactly how you will look in the street.</p>
        </div>
        <div class="creator-controls">
          <section class="creator-group">
            <h3>Skin</h3>
            <div class="swatch-row" id="creator-skin"></div>
          </section>
          <section class="creator-group">
            <h3>Hair</h3>
            <div class="chip-row" id="creator-hair"></div>
            <div class="swatch-row small" id="creator-hair-colour"></div>
          </section>
          <section class="creator-group">
            <h3>Build</h3>
            <div class="chip-row" id="creator-build"></div>
          </section>
          <section class="creator-group">
            <h3>Outfit</h3>
            <div class="outfit-grid" id="creator-outfit"></div>
          </section>
        </div>
      </div>
    `;

    const skinRow = this.overlay.querySelector('#creator-skin');
    skinRow.innerHTML = SKIN_TONES.map((t) => `
      <button type="button" class="swatch ${this.look.skin === t.hex ? 'active' : ''}"
              data-skin="${t.hex}" style="background:${intToHex(t.hex)}" title="${t.label}">
        <span>${t.label}</span>
      </button>
    `).join('');
    skinRow.querySelectorAll('[data-skin]').forEach((b) => {
      b.addEventListener('click', () => this._setLook({ skin: Number(b.dataset.skin) }, true));
    });

    const hairRow = this.overlay.querySelector('#creator-hair');
    hairRow.innerHTML = HAIR_STYLES.map((h) => `
      <button type="button" class="chip ${this.look.hair === h.id ? 'active' : ''}" data-hair="${h.id}">${h.label}</button>
    `).join('');
    hairRow.querySelectorAll('[data-hair]').forEach((b) => {
      b.addEventListener('click', () => this._setLook({ hair: b.dataset.hair }, true));
    });

    const hairColourRow = this.overlay.querySelector('#creator-hair-colour');
    hairColourRow.innerHTML = HAIR_COLOURS.map((c) => `
      <button type="button" class="swatch tiny ${this.look.hairColour === c.hex ? 'active' : ''}"
              data-hair-colour="${c.hex}" style="background:${intToHex(c.hex)}" title="${c.label}"></button>
    `).join('');
    hairColourRow.querySelectorAll('[data-hair-colour]').forEach((b) => {
      b.addEventListener('click', () => this._setLook({ hairColour: Number(b.dataset.hairColour) }, true));
    });

    const buildRow = this.overlay.querySelector('#creator-build');
    buildRow.innerHTML = BODY_TYPES.map((b) => `
      <button type="button" class="chip ${this.look.body === b.id ? 'active' : ''}" data-build="${b.id}">${b.label}</button>
    `).join('');
    buildRow.querySelectorAll('[data-build]').forEach((b) => {
      b.addEventListener('click', () => this._setLook({ body: b.dataset.build }, true));
    });

    const outfitGrid = this.overlay.querySelector('#creator-outfit');
    outfitGrid.innerHTML = OUTFITS.map((o) => `
      <button type="button" class="outfit-card ${this.look.outfit === o.id ? 'active' : ''}" data-outfit="${o.id}">
        <span class="outfit-garment outfit-${o.garment}"></span>
        <b>${o.label}</b>
      </button>
    `).join('');
    outfitGrid.querySelectorAll('[data-outfit]').forEach((b) => {
      b.addEventListener('click', () => {
        // Choosing an outfit replaces the whole outfit, so drop the colour and
        // piece overrides that belonged to the previous one.
        this.look = withOutfit(this.look, b.dataset.outfit);
        this._renderCharacter();
      });
    });

    this.overlay.querySelector('[data-act="shuffle"]').addEventListener('click', () => {
      const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
      const skin = pick(SKIN_TONES);
      const hair = pick(HAIR_STYLES);
      const hairColour = pick(HAIR_COLOURS);
      const body = pick(BODY_TYPES);
      const outfit = pick(OUTFITS);
      this.look = normaliseLook({
        skin: skin.hex, hair: hair.id, hairColour: hairColour.hex, body: body.id, outfit: outfit.id,
      });
      this._renderCharacter();
      this._ensurePreview();
    });

    this._ensurePreview();
  }

  _setLook(patch, rerender = false) {
    const input = { ...this.look, ...patch };
    for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
    this.look = normaliseLook(input);
    this._error('');
    if (rerender) {
      this._renderCharacter();
      return;
    }
    this._previewAvatar?.setLook(this.look);
  }

  // ── Step 3: start ─────────────────────────────────────────

  _renderStart() {
    this._disposePreview();
    const outfit = OUTFITS.find((o) => o.id === this.look.outfit);
    this.bodyEl.innerHTML = `
      <div class="start-grid">
        ${TIERS.map((t) => `
          <button type="button" class="tier-card ${this.tier === t.id ? 'active' : ''}" data-tier="${t.id}">
            <span class="tier-name" style="--tier-colour:${t.colour}">${t.name}</span>
            <b>${t.desc}</b>
            <em>${t.debt}</em>
            <p>${t.note}</p>
          </button>
        `).join('')}
      </div>
      <div class="start-summary">
        <div class="start-swatch" style="background:${intToHex(this.look.top)}"></div>
        <p>
          <b>${this._savedUsername || 'Your character'}</b> ·
          ${outfit ? outfit.label : 'Casual'} · ${this.look.hair} hair ·
          ${SKIN_TONES.find((s) => s.hex === this.look.skin)?.label || 'custom'} skin
        </p>
        <p class="start-hint">You can change all of this later with the character panel (I).</p>
      </div>
    `;
    this.bodyEl.querySelectorAll('[data-tier]').forEach((b) => {
      b.addEventListener('click', () => {
        this.tier = b.dataset.tier;
        this._renderStart();
      });
    });
  }

  // ── Live 3D preview ───────────────────────────────────────

  _ensurePreview() {
    const canvas = this.bodyEl.querySelector('.creator-canvas');
    if (!canvas) return;

    if (!this._previewRenderer) {
      try {
        this._previewRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        this._previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this._previewRenderer.setSize(canvas.width, canvas.height, false);
        this._previewRenderer.shadowMap.enabled = false;
        this._previewRenderer.outputColorSpace = THREE.SRGBColorSpace;

        this._previewScene = new THREE.Scene();
        this._previewCamera = new THREE.PerspectiveCamera(32, canvas.width / canvas.height, 0.1, 20);
        this._previewCamera.position.set(0, 1.35, 3.6);
        this._previewCamera.lookAt(0, 1.0, 0);

        const key = new THREE.DirectionalLight(0xfff3e0, 2.6);
        key.position.set(2.4, 4.2, 2.6);
        const fill = new THREE.DirectionalLight(0xbcd8ff, 0.9);
        fill.position.set(-3, 2, -2.4);
        this._previewScene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.55));

        // A disc to stand on, so the character is not floating in nothing.
        const disc = new THREE.Mesh(
          new THREE.CylinderGeometry(0.62, 0.62, 0.03, 28),
          new THREE.MeshStandardMaterial({ color: 0x1b2733, roughness: 0.9 }),
        );
        disc.position.y = -0.015;
        this._previewScene.add(disc);

        this._previewAvatar = new Avatar({ look: this.look });
        this._previewScene.add(this._previewAvatar);

        const spin = () => {
          if (!this._previewRenderer || !this._previewAvatar) return;
          this._previewAvatar.rotation.y += 0.006;
          this._previewAvatar.update(1 / 60);
          this._previewRenderer.render(this._previewScene, this._previewCamera);
          this._previewFrame = requestAnimationFrame(spin);
        };
        spin();
      } catch (err) {
        // No WebGL (very old browser, or a blocked context): the creator still
        // works, the preview just says so instead of going black.
        this._previewRenderer = null;
        const wrap = this.bodyEl.querySelector('.creator-preview');
        if (wrap) {
          wrap.insertAdjacentHTML('beforeend',
            '<p class="creator-nogl">Your browser cannot preview 3D here, but the character will still load in the game.</p>');
        }
      }
      return;
    }

    // Renderer exists: move it onto the new canvas.
    this._previewRenderer.setSize(canvas.width, canvas.height, false);
    if (this._previewAvatar) this._previewAvatar.setLook(this.look);
  }

  _disposePreview() {
    if (this._previewFrame) cancelAnimationFrame(this._previewFrame);
    this._previewFrame = null;
    if (this._previewRenderer) {
      this._previewRenderer.dispose();
      this._previewRenderer = null;
    }
    if (this._previewAvatar && this._previewAvatar.parent) {
      this._previewAvatar.parent.remove(this._previewAvatar);
    }
    this._previewAvatar = null;
    this._previewScene = null;
  }

  // ── Navigation ────────────────────────────────────────────

  _back() {
    if (this.step === 0) return;
    this.step -= 1;
    this._renderStep();
  }

  async _next() {
    if (this.busy) return;

    // Logging in skips the creator: the look is already saved on the account.
    if (this.mode === 'login' && this.step === 0) {
      await this._submit('login');
      return;
    }

    if (this.step < STEPS.length - 1) {
      if (this.step === 0) {
        const problem = this._validateAccount();
        if (problem) { this._error(problem); return; }
      }
      this.step += 1;
      this._renderStep();
      return;
    }

    await this._submit(this.mode);
  }

  async _submit(kind) {
    const username = this._accountUsername();
    const password = this._accountPassword();

    if (kind === 'login') {
      const problem = this._validateAccount();
      if (problem) { this._error(problem); return; }
    }

    this.busy = true;
    this.nextBtn.disabled = true;
    this.nextBtn.textContent = 'One moment…';
    this._error('');

    let result;
    if (kind === 'login') {
      result = await login(username, password);
    } else {
      result = await signup(username, password, this.tier, this.look.skin, this.look.top, {
        hair_style: this.look.hair,
        hair_color: this.look.hairColour,
        body_type: this.look.body,
        outfit_id: this.look.outfit,
        bottom_color: this.look.bottom,
      });
    }

    this.busy = false;
    this.nextBtn.disabled = false;
    this.nextBtn.textContent = kind === 'login' ? 'Enter Lagos' : 'Start life';

    if (!result || result.error) {
      this._error(result?.error || 'Something went wrong. Try again.');
      return;
    }

    setToken(result.token);
    // Never keep a password in memory after it has been spent.
    this._savedPassword = '';
    this._disposePreview();
    this.overlay.remove();
    this.onAuthSuccess(result.token, result.user, this.look);
  }

  /**
   * The screen is built and rendered by the constructor, so showing it is just
   * making sure it is attached and visible. `main.js` calls show()/destroy()
   * like every other panel, and before this existed that call threw on every
   * page load.
   */
  show() {
    if (!this.overlay.isConnected) document.body.appendChild(this.overlay);
    this.overlay.classList.remove('hidden');
    return this;
  }

  hide() {
    this.overlay.classList.add('hidden');
    return this;
  }

  destroy() {
    this._disposePreview();
    this.overlay.remove();
  }
}

export { TIERS, hexToInt };
