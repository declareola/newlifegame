/**
 * City chat overlay.
 *
 * Press Enter or T to start typing, Enter to send, Escape to close.
 * Messages are rendered with textContent (never innerHTML) so a player
 * cannot inject markup into anyone else's screen.
 */
export class Chat {
  /**
   * @param {object} opts
   * @param {function} opts.onSend - called with the message text
   * @param {function} opts.onFocusChange - called with true/false when the input gains/loses focus
   */
  constructor({ onSend, onFocusChange } = {}) {
    this.onSend = onSend || (() => {});
    this.onFocusChange = onFocusChange || (() => {});
    this.maxMessages = 60;
    this.isOpen = false;
    this.unread = 0;

    this.root = document.createElement('div');
    // Hidden until the player is signed in: "Press Enter to chat" over the
    // sign-up screen is a promise the game cannot keep yet.
    this.root.className = 'chat-root hidden';
    this.root.innerHTML = `
      <div class="chat-log" aria-live="polite"></div>
      <div class="chat-hint">Press <kbd>Enter</kbd> to chat</div>
      <input
        class="chat-input hidden"
        type="text"
        maxlength="200"
        autocomplete="off"
        spellcheck="false"
        placeholder="Say something…"
      />
    `;
    document.body.appendChild(this.root);

    this.logEl = this.root.querySelector('.chat-log');
    this.inputEl = this.root.querySelector('.chat-input');
    this.hintEl = this.root.querySelector('.chat-hint');

    this._bind();
  }

  _bind() {
    // Enter / T opens chat, but only when the player isn't typing somewhere
    // else (auth screen, etc.).
    window.addEventListener('keydown', (e) => {
      if (this.isOpen) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Enter' || e.key === 't' || e.key === 'T') {
        // Don't hijack the key if no token yet (auth screen is open)
        if (!document.body.classList.contains('in-game')) return;
        e.preventDefault();
        this.open();
      }
    });

    this.inputEl.addEventListener('keydown', (e) => {
      // Keep the game from receiving movement keys while typing.
      e.stopPropagation();

      if (e.key === 'Enter') {
        e.preventDefault();
        const text = this.inputEl.value.trim();
        if (text) this.onSend(text);
        this.inputEl.value = '';
        this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.inputEl.value = '';
        this.close();
      }
    });

    // Also stop keyup so PlayerController never sees a held key.
    this.inputEl.addEventListener('keyup', (e) => e.stopPropagation());

    this.inputEl.addEventListener('blur', () => {
      if (this.isOpen) this.close();
    });
  }

  open() {
    this.isOpen = true;
    this.inputEl.classList.remove('hidden');
    this.hintEl.classList.add('hidden');
    this.root.classList.add('chat-active');
    this.unread = 0;
    this._renderUnread();
    this.inputEl.focus();
    this.onFocusChange(true);
  }

  close() {
    this.isOpen = false;
    this.inputEl.classList.add('hidden');
    this.hintEl.classList.remove('hidden');
    this.root.classList.remove('chat-active');
    this.inputEl.blur();
    this.onFocusChange(false);
  }

  /**
   * Add a message to the log.
   * @param {{ username: string, text: string, system?: boolean }} msg
   */
  /**
   * @param {{username,text,type,at}} msg
   * @param {object} [o]
   * @param {boolean} [o.history] true when loading the backlog on join, in
   *   which case stale presence noise ("X left the city") is skipped — a new
   *   player used to be greeted by fifteen minutes of other people's comings
   *   and goings before a single word of conversation.
   */
  addMessage(msg, { history = false } = {}) {
    if (!msg || typeof msg.text !== 'string') return;

    // On the backlog, presence noise older than a minute and a half is dropped:
    // what a new player should see first is conversation, not a list of people
    // who left before they arrived.
    if (history && msg.system && Number.isFinite(msg.at) && Date.now() - msg.at > 90_000) return;

    const row = document.createElement('div');
    row.className = msg.system ? 'chat-line chat-system' : 'chat-line';

    if (!msg.system) {
      const name = document.createElement('span');
      name.className = 'chat-name';
      // textContent — never innerHTML — so usernames/messages can't inject HTML
      name.textContent = `${msg.username}: `;
      row.appendChild(name);

      const body = document.createElement('span');
      body.className = 'chat-text';
      body.textContent = msg.text;
      row.appendChild(body);
    } else {
      const body = document.createElement('span');
      body.className = 'chat-text';
      body.textContent = msg.text;
      row.appendChild(body);
    }

    this.logEl.appendChild(row);

    while (this.logEl.children.length > this.maxMessages) {
      this.logEl.removeChild(this.logEl.firstChild);
    }

    this.logEl.scrollTop = this.logEl.scrollHeight;

    // Fade older messages out after a while so the screen stays clear
    this._scheduleFade(row);

    if (!this.isOpen && !msg.system) {
      this.unread += 1;
      this._renderUnread();
    }
  }

  _scheduleFade(row) {
    setTimeout(() => {
      row.classList.add('chat-faded');
    }, 25000);
  }

  _renderUnread() {
    if (this.unread > 0) {
      this.hintEl.textContent = '';
      const kbd = document.createElement('kbd');
      kbd.textContent = 'Enter';
      this.hintEl.append(
        document.createTextNode(`💬 ${this.unread} new · Press `),
        kbd,
        document.createTextNode(' to chat')
      );
    } else {
      this.hintEl.textContent = '';
      const kbd = document.createElement('kbd');
      kbd.textContent = 'Enter';
      this.hintEl.append(
        document.createTextNode('Press '),
        kbd,
        document.createTextNode(' to chat')
      );
    }
  }

  /** Show a local-only system line (e.g. a send error). */
  addLocalNotice(text) {
    this.addMessage({ username: 'City', text, system: true });
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }
}
