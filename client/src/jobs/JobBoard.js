import { getJobs, takeJob, quitJob } from '../auth/api.js';

/**
 * Job Board overlay panel.
 * Toggled with the 'J' key. Shows available jobs and lets the player
 * take or quit a job. All earning logic is server-side; the client
 * only sends requests and displays results.
 *
 * @param {object} opts
 * @param {function} opts.onJobChange — called after taking/quitting a job
 */
export class JobBoard {
  constructor({ onJobChange }) {
    this.onJobChange = onJobChange || (() => {});
    this.token = null;
    this.jobs = [];
    this.currentJob = null; // { id, name, hourlyRate } or null

    this.root = document.createElement('div');
    this.root.className = 'job-board hidden';
    document.body.appendChild(this.root);

    this._render();
  }

  setToken(token) {
    this.token = token;
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
    this._loadJobs();
  }

  hide() {
    this.root.classList.add('hidden');
  }

  setCurrentJob(job) {
    this.currentJob = job;
    if (!this.root.classList.contains('hidden')) {
      this._render();
    }
  }

  async _loadJobs() {
    if (!this.token) return;
    const result = await getJobs(this.token);
    if (!result.error) {
      this.jobs = result.jobs || [];
      this.currentJob = result.currentJob || null;
    }
    this._render();
  }

  _render() {
    const currentJobHtml = this.currentJob
      ? `
      <div class="job-current">
        <div class="job-current-info">
          <span class="job-current-icon">${this.currentJob.icon || '💼'}</span>
          <div>
            <div class="job-current-name">${this.currentJob.name}</div>
            <div class="job-current-rate">₦${this.currentJob.hourlyRate.toLocaleString('en-NG')}/hr</div>
          </div>
        </div>
        <button class="job-btn job-quit" data-action="quit">Quit Job</button>
      </div>
      `
      : `<div class="job-none">No job currently</div>`;

    const availableJobsHtml = this.jobs
      .map(job => {
        const isActive = this.currentJob && this.currentJob.id === job.id;
        return `
        <div class="job-card">
          <div class="job-card-info">
            <span class="job-card-icon">${job.icon}</span>
            <div>
              <div class="job-card-name">${job.name}</div>
              <div class="job-card-desc">${job.description}</div>
              <div class="job-card-meta">
                <span class="job-card-district">📍 ${job.districtName}</span>
                <span class="job-card-rate">₦${job.hourlyRate.toLocaleString('en-NG')}/hr</span>
              </div>
            </div>
          </div>
          <button class="job-btn ${isActive ? 'job-active' : 'job-take'}" data-job="${job.id}" ${isActive ? 'disabled' : ''}>
            ${isActive ? 'Active' : 'Take Job'}
          </button>
        </div>
        `;
      })
      .join('');

    this.root.innerHTML = `
      <div class="job-header">
        <h2>💼 Job Board</h2>
        <button class="job-close" data-action="close">✕</button>
      </div>
      <div class="job-current-section">
        <h3>Current Job</h3>
        ${currentJobHtml}
      </div>
      <div class="job-available-section">
        <h3>Available Jobs</h3>
        ${availableJobsHtml}
      </div>
    `;

    // Wire up buttons
    this.root.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'close') this.hide();
        if (action === 'quit') this._handleQuit();
      });
    });

    this.root.querySelectorAll('[data-job]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._handleTake(btn.dataset.job);
      });
    });
  }

  async _handleTake(jobId) {
    if (!this.token) return;
    const result = await takeJob(this.token, jobId);
    if (result.error) {
      this._showError(result.error);
      return;
    }
    this.currentJob = result.job;
    this._render();
    this.onJobChange(result.job);
  }

  async _handleQuit() {
    if (!this.token) return;
    const result = await quitJob(this.token);
    if (result.error) {
      this._showError(result.error);
      return;
    }
    this.currentJob = null;
    this._render();
    this.onJobChange(null);
  }

  _showError(msg) {
    const errEl = this.root.querySelector('.job-error');
    if (errEl) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
  }
}
