import { getLeaderboard } from '../auth/api.js';

function naira(amount) {
  return '₦' + Math.round(amount).toLocaleString('en-NG');
}

const TIER_LABEL = {
  nepo: '🤑 Nepo Baby',
  middle: '🙂 Middle Class',
  lapo: '😤 From the Bottom',
};

/**
 * Top-players panel, toggled with the L key.
 * Data comes from GET /api/leaderboard; the client only renders it.
 */
export class Leaderboard {
  constructor({ onError } = {}) {
    this.onError = onError || (() => {});
    this.token = null;
    this.entries = [];
    this.you = null;
    this.loading = false;

    this.root = document.createElement('div');
    this.root.className = 'leaderboard hidden';
    document.body.appendChild(this.root);
    this._render();
  }

  setToken(token) {
    this.token = token;
  }

  toggle() {
    if (this.root.classList.contains('hidden')) this.show();
    else this.hide();
  }

  show() {
    this.root.classList.remove('hidden');
    this._load();
  }

  hide() {
    this.root.classList.add('hidden');
  }

  async _load() {
    if (!this.token || this.loading) return;
    this.loading = true;
    const result = await getLeaderboard(this.token);
    this.loading = false;

    if (result.error) {
      this.onError(result.error);
      return;
    }
    this.entries = result.entries || [];
    this.you = result.you || null;
    this._render();
  }

  _render() {
    const medal = (rank) => {
      if (rank === 1) return '🥇';
      if (rank === 2) return '🥈';
      if (rank === 3) return '🥉';
      return `<span class="lb-rank">${rank}</span>`;
    };

    const rows = this.entries.length
      ? this.entries.map((e) => `
        <div class="lb-row ${e.isYou ? 'lb-you' : ''}">
          <span class="lb-medal">${medal(e.rank)}</span>
          <div class="lb-info">
            <div class="lb-name">${e.username}${e.isYou ? ' <span class="lb-you-tag">you</span>' : ''}</div>
            <div class="lb-tier">${TIER_LABEL[e.tier] || e.tier}</div>
          </div>
          <span class="lb-worth">${naira(e.netWorth)}</span>
        </div>
      `).join('')
      : '<div class="lb-empty">No players yet</div>';

    const youHtml = this.you && !this.entries.some((e) => e.isYou)
      ? `
        <div class="lb-yours">
          <span class="lb-yours-label">Your rank</span>
          <span class="lb-yours-rank">#${this.you.rank}</span>
          <span class="lb-yours-worth">${naira(this.you.netWorth)}</span>
        </div>
      `
      : '';

    this.root.innerHTML = `
      <div class="lb-header">
        <h2>🏆 Leaderboard</h2>
        <button class="lb-close" data-action="close">✕</button>
      </div>
      <div class="lb-subtitle">Ranked by net worth (cash + bank)</div>
      <div class="lb-list">${rows}</div>
      ${youHtml}
    `;

    this.root.querySelectorAll('[data-action="close"]').forEach((btn) => {
      btn.addEventListener('click', () => this.hide());
    });
  }
}
