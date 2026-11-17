// client/src/missions/ObjectiveTracker.js
// The always-on HUD objective chip: the mission you are closest to finishing,
// and its next unfinished step.
//
// It renders from the same mission list the journal gets from the server, so it
// cannot show an objective that is not real or already done.

export class ObjectiveTracker {
  constructor() {
    const el = document.createElement('div');
    el.className = 'objective-tracker hidden';
    el.innerHTML = `
      <div class="objective-title">Objective</div>
      <div class="objective-name"></div>
      <div class="objective-step"></div>
    `;
    document.body.appendChild(el);

    this.el = el;
    this.nameEl = el.querySelector('.objective-name');
    this.stepEl = el.querySelector('.objective-step');
    this._signature = '';
  }

  /** @param {Array} missions — the list from GET /api/missions */
  update(missions) {
    if (!Array.isArray(missions) || missions.length === 0) {
      this.el.classList.add('hidden');
      return;
    }

    // Prefer a mission that is ready to claim, then one in progress.
    const ready = missions.find((m) => m.status === 'complete');
    const active = missions.find((m) => m.status === 'active');
    const target = ready || active;

    if (!target) {
      this.el.classList.add('hidden');
      return;
    }

    const nextStep = target.steps.find((s) => !s.done);
    const signature = `${target.id}:${target.status}:${nextStep ? nextStep.id : 'done'}`;
    if (signature === this._signature) return;
    this._signature = signature;

    this.nameEl.textContent = target.name;
    if (ready) {
      this.stepEl.textContent = `Ready to claim — open the journal (J)`;
      this.stepEl.className = 'objective-step done';
    } else if (nextStep) {
      this.stepEl.textContent = nextStep.text;
      this.stepEl.className = 'objective-step';
    } else {
      this.stepEl.textContent = 'All objectives complete';
      this.stepEl.className = 'objective-step done';
    }
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }
}
