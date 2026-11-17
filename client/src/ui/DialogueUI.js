// client/src/ui/DialogueUI.js
// Conversation box with branching options.
//
// Options are supplied as { label, hint, run }. Selecting one runs it and then
// re-renders the option list, so an option can change the world (buy food, hand
// out work) and the dialogue stays coherent afterwards.

import { claimEscape } from './escape.js';

export class DialogueUI {
  constructor() {
    this.isOpen = false;
    this._build();
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'dialogue hidden';
    el.innerHTML = `
      <div class="dialogue-panel" role="dialog" aria-live="polite">
        <header class="dialogue-head">
          <div>
            <div class="dialogue-title"></div>
            <div class="dialogue-subtitle"></div>
          </div>
          <button class="dialogue-close" type="button" aria-label="Close">×</button>
        </header>
        <p class="dialogue-greeting"></p>
        <div class="dialogue-options"></div>
      </div>
    `;
    document.body.appendChild(el);

    this.el = el;
    this.titleEl = el.querySelector('.dialogue-title');
    this.subtitleEl = el.querySelector('.dialogue-subtitle');
    this.greetingEl = el.querySelector('.dialogue-greeting');
    this.optionsEl = el.querySelector('.dialogue-options');

    el.querySelector('.dialogue-close').addEventListener('click', () => this.close());

    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.code === 'Escape') {
        e.stopPropagation();
        claimEscape(e);
        this.close();
      }
      // 1–9 pick an option
      const n = Number(e.key);
      if (n >= 1 && n <= 9) {
        const btn = this.optionsEl.querySelectorAll('.dialogue-option')[n - 1];
        if (btn) btn.click();
      }
    }, true);
  }

  /**
   * @param {object} o
   * @param {string} o.title
   * @param {string} [o.subtitle]
   * @param {string} o.greeting
   * @param {Array<{label:string, hint?:string, run:function}>} o.options
   * @param {function} [o.onClose]
   */
  open({ title, subtitle = '', greeting, options = [], onClose }) {
    this.isOpen = true;
    this.onClose = onClose;
    this.titleEl.textContent = title;
    this.subtitleEl.textContent = subtitle;
    this.greetingEl.textContent = greeting;
    this._renderOptions(options);
    this.el.classList.remove('hidden');
    this.optionsEl.querySelector('.dialogue-option')?.focus();
  }

  _renderOptions(options) {
    this.optionsEl.innerHTML = '';
    options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dialogue-option';
      btn.innerHTML = `
        <span class="dialogue-num">${i + 1}</span>
        <span class="dialogue-label">${opt.label}</span>
        ${opt.hint ? `<span class="dialogue-hint">${opt.hint}</span>` : ''}
      `;
      btn.addEventListener('click', async () => {
        btn.classList.add('picked');
        try {
          if (opt.close !== false) this.close();
          await opt.run?.();
        } catch (err) {
          console.error('Dialogue option failed:', err);
          this.close();
        }
      });
      this.optionsEl.appendChild(btn);
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.el.classList.add('hidden');
    this.onClose?.();
  }
}
