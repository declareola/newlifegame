import { icon } from '../ui/icons.js';

function formatNaira(amount) {
  return '₦' + Math.round(amount).toLocaleString('en-NG');
}

// Job display info — matches server jobConfig.js job ids
const JOB_INFO = {
  tech:        { name: 'Tech Dev',     icon: '💻' },
  trader:      { name: 'Trader',       icon: '📦' },
  driver:      { name: 'Bus Driver',   icon: '🚌' },
  construction: { name: 'Construction', icon: '🔨' },
  water:       { name: 'Water Vendor', icon: '💧' },
};

// Activity display info — matches server activityConfig.js activity ids
const ACTIVITY_INFO = {
  eat:       { name: 'Eating',     icon: '🍔' },
  sleep:     { name: 'Sleeping',   icon: '🛏️' },
  shower:    { name: 'Showering',  icon: '🚿' },
  toilet:    { name: 'Toilet',     icon: '🚻' },
  social:    { name: 'Socialising', icon: '👥' },
  exercise:  { name: 'Exercising', icon: '🏃' },
};

/**
 * In-game HUD overlay.
 * Shows cash, bank balance, username, clock, and six needs bars.
 * Need bars turn yellow below 50% and red below 25%.
 */
export class HUD {
  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud hidden';
    this.root.innerHTML = `
      <div class="hud-top">
        <div class="hud-chip hud-username" title="Account settings">${icon('user', 15)}<span class="hud-text">Player</span></div>
        <div class="hud-chip hud-cash">${icon('cash', 15)}<span class="hud-text">₦0</span></div>
        <div class="hud-chip hud-bank">${icon('bank', 15)}<span class="hud-text">Bank: ₦0</span></div>
        <div class="hud-chip hud-job">${icon('briefcase', 15)}<span class="hud-text">Unemployed</span></div>
        <div class="hud-chip hud-activity hidden">${icon('pulse', 15)}<span class="hud-text"></span></div>
        <div class="hud-chip hud-home">${icon('home', 15)}<span class="hud-text">Homeless</span></div>
        <div class="hud-chip hud-wanted hidden" title="Wanted level — click for the faction matrix"><span class="hud-stars"></span><span class="hud-text">Clean</span></div>
        <div class="hud-chip hud-online">${icon('users', 15)}<span class="hud-text">1 online</span></div>
        <div class="hud-chip hud-weather hidden" title="Weather"><span class="hud-text">☀️</span></div>
        <div class="hud-chip hud-clock">${icon('clock', 15)}<span class="hud-text">00:00</span></div>
      </div>
      <div class="hud-needs">
        <div class="need-bar" data-need="hunger">
          <span class="need-icon">${icon('hunger', 15)}</span>
          <span class="need-label">Hunger</span>
          <div class="need-track"><div class="need-fill need-ok" style="width:100%"></div></div>
          <span class="need-value">100%</span>
        </div>
        <div class="need-bar" data-need="energy">
          <span class="need-icon">${icon('energy', 15)}</span>
          <span class="need-label">Energy</span>
          <div class="need-track"><div class="need-fill need-ok" style="width:100%"></div></div>
          <span class="need-value">100%</span>
        </div>
        <div class="need-bar" data-need="hygiene">
          <span class="need-icon">${icon('hygiene', 15)}</span>
          <span class="need-label">Hygiene</span>
          <div class="need-track"><div class="need-fill need-ok" style="width:100%"></div></div>
          <span class="need-value">100%</span>
        </div>
        <div class="need-bar" data-need="bladder">
          <span class="need-icon">${icon('bladder', 15)}</span>
          <span class="need-label">Bladder</span>
          <div class="need-track"><div class="need-fill need-ok" style="width:100%"></div></div>
          <span class="need-value">100%</span>
        </div>
        <div class="need-bar" data-need="fun">
          <span class="need-icon">${icon('fun', 15)}</span>
          <span class="need-label">Fun</span>
          <div class="need-track"><div class="need-fill need-ok" style="width:100%"></div></div>
          <span class="need-value">100%</span>
        </div>
        <div class="need-bar" data-need="social">
          <span class="need-icon">${icon('social', 15)}</span>
          <span class="need-label">Social</span>
          <div class="need-track"><div class="need-fill need-ok" style="width:100%"></div></div>
          <span class="need-value">100%</span>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);

    // The wrapper is what users click; text goes into the inner span so the
    // SVG icon is never overwritten.
    this.usernameEl = this.root.querySelector('.hud-username');
    this.cashEl     = this.root.querySelector('.hud-cash .hud-text');
    this.bankEl     = this.root.querySelector('.hud-bank .hud-text');
    this.jobEl      = this.root.querySelector('.hud-job .hud-text');
    this.activityEl = this.root.querySelector('.hud-activity');
    this.activityTextEl = this.root.querySelector('.hud-activity .hud-text');
    this.homeEl     = this.root.querySelector('.hud-home .hud-text');
    this.onlineEl   = this.root.querySelector('.hud-online .hud-text');
    this.clockEl    = this.root.querySelector('.hud-clock .hud-text');
    this.wantedEl   = this.root.querySelector('.hud-wanted');
    this.wantedStarsEl = this.root.querySelector('.hud-wanted .hud-stars');
    this.wantedTextEl  = this.root.querySelector('.hud-wanted .hud-text');
    this.weatherEl  = this.root.querySelector('.hud-weather');
    this.weatherTextEl = this.root.querySelector('.hud-weather .hud-text');
    this.clockInterval = null;
    this.clockProvider = null;
  }

  /**
   * Wanted badge: the worst heat the player is carrying, and from whom.
   *
   * Server-driven — `wanted` is the payload of GET /api/wanted. The badge is
   * hidden entirely when nobody is interested, because a permanent "0★" is
   * noise, and it is clickable so the matrix has a way in.
   *
   * @param {{maxStars:number, maxFaction:string|null, factions:Array}} wanted
   */
  setWanted(wanted) {
    if (!this.wantedEl) return;
    const stars = wanted?.maxStars || 0;
    if (!stars) {
      this.wantedEl.classList.add('hidden');
      this.wantedEl.dataset.stars = '0';
      return;
    }
    this.wantedEl.classList.remove('hidden');
    this.wantedEl.dataset.stars = String(stars);
    const faction = wanted.factions?.find((f) => f.id === wanted.maxFaction);
    this.wantedStarsEl.textContent = '★'.repeat(stars) + '☆'.repeat(Math.max(0, 4 - stars));
    this.wantedTextEl.textContent = faction ? faction.short : 'Wanted';
    this.wantedEl.title = faction
      ? `${faction.label} with the ${faction.short} — ${faction.response}`
      : 'Wanted';
  }

  /**
   * Weather indicator. Shows the icon and a one-word state; `night` changes the
   * icon so a clear night is not a false sun.
   * @param {{raining:boolean, intensity:number}} weather
   * @param {boolean} night
   */
  setWeather(weather = {}, night = false) {
    if (!this.weatherEl) return;
    const raining = Boolean(weather.raining);
    const intensity = Number(weather.intensity) || 0;
    const icon = raining ? (intensity > 0.6 ? '🌧️' : '🌦️') : (night ? '🌙' : '☀️');
    const label = raining ? (intensity > 0.6 ? 'Heavy rain' : 'Light rain') : (night ? 'Clear night' : 'Clear');
    this.weatherTextEl.textContent = icon;
    this.weatherEl.classList.remove('hidden');
    this.weatherEl.classList.toggle('hud-weather-rain', raining);
    this.weatherEl.title = label;
    this.weatherEl.setAttribute('aria-label', label);
  }

  show() {
    this.root.classList.remove('hidden');
    this._startClock();
  }

  hide() {
    this.root.classList.add('hidden');
    if (this.clockInterval) clearInterval(this.clockInterval);
  }

  /** Make the username in the top bar clickable (opens the account menu). */
  onUsernameClick(handler) {
    if (!this.usernameEl) return;
    this.usernameEl.classList.add('hud-clickable');
    this.usernameEl.title = 'Account settings';
    this.usernameEl.addEventListener('click', handler);
  }

  /**
   * Supply the in-game day/night clock (Step 11).
   * @param {function} fn - returns { label: string, night: boolean }
   */
  setClockProvider(fn) {
    this.clockProvider = fn;
  }

  _startClock() {
    if (this.clockInterval) clearInterval(this.clockInterval);
    this.clockInterval = setInterval(() => {
      if (this.clockProvider) {
        const { label, night } = this.clockProvider();
        this.clockEl.textContent = label;
        this.clockEl.classList.toggle('night', !!night);
        return;
      }
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const s = String(now.getSeconds()).padStart(2, '0');
      this.clockEl.textContent = `${h}:${m}:${s}`;
    }, 1000);
  }

  /**
   * Update HUD from a player state object (from socket or auth response).
   * @param {object} state - { username, cash, bank_balance, hunger, ... }
   */
  update(state) {
    this.usernameEl.querySelector('.hud-text').textContent = state.username || 'Player';
    this.cashEl.textContent     = formatNaira(state.cash || 0);
    this.bankEl.textContent     = `Bank: ${formatNaira(state.bank_balance || 0)}`;

    if (state.job_status === 'working' && state.job_type) {
      const job = JOB_INFO[state.job_type] || { name: state.job_type };
      this.jobEl.textContent = job.name;
      this.jobEl.classList.add('hud-working');
    } else {
      this.jobEl.textContent = 'Unemployed';
      this.jobEl.classList.remove('hud-working');
    }

    if (state.activity) {
      const activity = ACTIVITY_INFO[state.activity];
      if (activity) {
        this.activityTextEl.textContent = activity.name;
        this.activityEl.classList.remove('hidden');
      }
    } else {
      this.activityEl.classList.add('hidden');
    }

    // Housing indicator (Step 8)
    const homeChip = this.homeEl.closest('.hud-home');
    if (state.home) {
      this.homeEl.textContent = state.homeName || 'Home';
      homeChip.classList.remove('hud-home-rented', 'hud-homeless');
      if (state.isRentingHome) homeChip.classList.add('hud-home-rented');
    } else {
      this.homeEl.textContent = 'Homeless';
      homeChip.classList.remove('hud-home-rented');
      homeChip.classList.add('hud-homeless');
    }

    this._updateNeed('hunger',  state.hunger  ?? 100);
    this._updateNeed('energy',  state.energy  ?? 100);
    this._updateNeed('hygiene', state.hygiene ?? 100);
    this._updateNeed('bladder', state.bladder ?? 100);
    this._updateNeed('fun',     state.fun     ?? 100);
    this._updateNeed('social',  state.social  ?? 100);
  }

  /** Number of players connected right now (Step 9). */
  setOnlineCount(count) {
    if (!this.onlineEl) return;
    const n = Math.max(1, Math.round(count) || 1);
    this.onlineEl.textContent = `${n} online`;
  }

  _updateNeed(need, value) {
    const bar = this.root.querySelector(`[data-need="${need}"]`);
    if (!bar) return;
    const fill    = bar.querySelector('.need-fill');
    const valueEl = bar.querySelector('.need-value');
    const pct = Math.round(value);
    fill.style.width = `${pct}%`;
    valueEl.textContent = `${pct}%`;

    if (value < 25) {
      fill.className = 'need-fill need-critical';
    } else if (value < 50) {
      fill.className = 'need-fill need-warning';
    } else {
      fill.className = 'need-fill need-ok';
    }

    // Severity lives on the bar as an attribute, so the stylesheet owns what
    // "severe" looks like and the HUD only reports the fact.
    const severe = value < 25;
    bar.dataset.severe = severe ? 'true' : 'false';
    bar.title = severe ? `${need} is critical — sort it out` : `${need}: ${pct}%`;
  }

  /**
   * Names of the needs that are critically low right now.
   * main.js turns a newly-critical need into one toast and one sound, and never
   * repeats it until the need actually recovers.
   */
  criticalNeeds() {
    return [...this.root.querySelectorAll('.need-bar')]
      .filter((bar) => bar.dataset.severe === 'true')
      .map((bar) => bar.dataset.need);
  }
}
