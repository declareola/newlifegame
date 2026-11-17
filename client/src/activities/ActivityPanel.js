import { getActivities, performActivity, cancelActivity } from '../auth/api.js';

// Need/stat display names for effect labels
const EFFECT_NAMES = {
  hunger: 'Hunger', energy: 'Energy', hygiene: 'Hygiene',
  bladder: 'Bladder', fun: 'Fun', social: 'Social',
  fitness: 'Fitness', smarts: 'Smarts', charisma: 'Charisma',
};

function formatEffects(effects) {
  return Object.entries(effects)
    .map(([key, amount]) => {
      const sign = amount > 0 ? '+' : '';
      return `${sign}${amount} ${EFFECT_NAMES[key] || key}`;
    })
    .join('  ');
}

/**
 * Activity panel overlay (toggle with 'A' key).
 * Shows 6 activities that refill needs and stats. Each activity
 * takes a set duration; the server applies effects when complete.
 * The client never calculates need changes — only sends requests.
 *
 * @param {object} opts
 * @param {function} opts.onActivityChange — called after performing/cancelling
 */
export class ActivityPanel {
  constructor({ onActivityChange }) {
    this.onActivityChange = onActivityChange || (() => {});
    this.token = null;
    this.activities = [];
    this.currentActivity = null; // { ...activity, endsAt } or null
    this.needs = {}; // for highlighting low needs
    this.progressInterval = null;

    this.root = document.createElement('div');
    this.root.className = 'activity-panel hidden';
    document.body.appendChild(this.root);

    this._render();
  }

  setToken(token) {
    this.token = token;
  }

  setNeeds(needs) {
    this.needs = needs || {};
    if (!this.root.classList.contains('hidden')) {
      this._render();
    }
  }

  setActivity(activityId, endsAt) {
    if (activityId && this.activities.length > 0) {
      const activity = this.activities.find(a => a.id === activityId);
      if (activity) {
        this.currentActivity = { ...activity, endsAt };
        this._startProgress();
      }
    } else {
      this.currentActivity = null;
      this._stopProgress();
    }
    this._render();
  }

  toggle() {
    if (this.root.classList.contains('hidden')) {
      this.show();
    } else {
      this.hide();
    }
  }

  show() {
    this.root.classList.remove('hidden');
    this._loadActivities();
  }

  hide() {
    this.root.classList.add('hidden');
    this._stopProgress();
  }

  async _loadActivities() {
    if (!this.token) return;
    const result = await getActivities(this.token);
    if (!result.error) {
      this.activities = result.activities || [];
      if (result.currentActivity) {
        this.currentActivity = result.currentActivity;
        this._startProgress();
      }
    }
    this._render();
  }

  _render() {
    const currentHtml = this.currentActivity
      ? `
      <div class="activity-current">
        <div class="activity-current-info">
          <span class="activity-current-icon">${this.currentActivity.icon}</span>
          <div>
            <div class="activity-current-name">${this.currentActivity.name}</div>
            <div class="activity-progress-label">
              ${this._progressText()}
            </div>
          </div>
        </div>
        <div class="activity-progress-bar">
          <div class="activity-progress-fill" style="width:${this._progressPct()}%"></div>
        </div>
        <button class="activity-btn activity-cancel" data-action="cancel">Cancel</button>
      </div>
      `
      : `<div class="activity-none">Not performing any activity</div>`;

    const activitiesHtml = this.activities
      .map(activity => {
        const isActive = this.currentActivity && this.currentActivity.id === activity.id;
        const isRecommended = this._isRecommended(activity);
        return `
        <div class="activity-card ${isRecommended ? 'recommended' : ''}">
          <div class="activity-card-info">
            <span class="activity-card-icon">${activity.icon}</span>
            <div>
              <div class="activity-card-name">${activity.name}</div>
              <div class="activity-card-desc">${activity.description}</div>
              <div class="activity-card-effects">${formatEffects(activity.effects)}</div>
              <div class="activity-card-duration">⏱ ${Math.round(activity.duration / 1000)}s</div>
            </div>
          </div>
          <button class="activity-btn ${isActive ? 'activity-active' : 'activity-perform'}"
                  data-activity="${activity.id}" ${isActive ? 'disabled' : ''}>
            ${isActive ? 'Active' : 'Perform'}
          </button>
        </div>
        `;
      })
      .join('');

    this.root.innerHTML = `
      <div class="activity-header">
        <h2>🎯 Activities</h2>
        <button class="activity-close" data-action="close">✕</button>
      </div>
      <div class="activity-current-section">
        <h3>Current Activity</h3>
        ${currentHtml}
      </div>
      <div class="activity-available-section">
        <h3>Available Activities</h3>
        ${activitiesHtml}
      </div>
    `;

    // Wire up buttons
    this.root.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'close') this.hide();
        if (action === 'cancel') this._handleCancel();
      });
    });

    this.root.querySelectorAll('[data-activity]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._handlePerform(btn.dataset.activity);
      });
    });
  }

  _isRecommended(activity) {
    for (const [key, amount] of Object.entries(activity.effects)) {
      if (amount > 0 && this.needs[key] !== undefined && this.needs[key] < 50) {
        return true;
      }
    }
    return false;
  }

  _progressPct() {
    if (!this.currentActivity) return 0;
    const total = this.currentActivity.duration;
    const remaining = Math.max(0, this.currentActivity.endsAt - Date.now());
    return ((total - remaining) / total) * 100;
  }

  _progressText() {
    if (!this.currentActivity) return '';
    const remaining = Math.max(0, this.currentActivity.endsAt - Date.now());
    return `${Math.ceil(remaining / 1000)}s remaining`;
  }

  _startProgress() {
    this._stopProgress();
    this.progressInterval = setInterval(() => {
      if (!this.currentActivity) return;
      const pct = this._progressPct();
      const fill = this.root.querySelector('.activity-progress-fill');
      const label = this.root.querySelector('.activity-progress-label');
      if (fill) fill.style.width = `${pct}%`;
      if (label) label.textContent = this._progressText();
      if (pct >= 100) {
        this._stopProgress();
        this.currentActivity = null;
        this._render();
      }
    }, 500);
  }

  _stopProgress() {
    if (this.progressInterval) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  async _handlePerform(activityId) {
    if (!this.token) return;
    const result = await performActivity(this.token, activityId);
    if (result.error) return;
    const activity = this.activities.find(a => a.id === activityId);
    if (activity) {
      this.currentActivity = { ...activity, endsAt: Date.now() + activity.duration };
      this._startProgress();
      this._render();
      this.onActivityChange(activity);
    }
  }

  async _handleCancel() {
    if (!this.token) return;
    const result = await cancelActivity(this.token);
    if (result.error) return;
    this.currentActivity = null;
    this._stopProgress();
    this._render();
    this.onActivityChange(null);
  }
}
