// client/src/ui/CameraHud.js
// On-screen camera furniture: a crosshair in first person, and a view-mode
// badge that also works as a button (so touch players can change view without
// a keyboard).
//
// The badge is not decoration — it reads the controller's real state every
// frame, so it can never claim "First person" while the camera is behind the
// character.

export class CameraHud {
  constructor({ controller, onToast } = {}) {
    this.controller = controller;
    this.onToast = onToast || (() => {});
    this._lastLabel = null;

    // Crosshair — only visible in first person.
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair hidden';
    this.crosshair.innerHTML = '<i></i><i></i><i></i><i></i><b></b>';
    document.body.appendChild(this.crosshair);

    // View badge / button.
    this.badge = document.createElement('button');
    this.badge.className = 'camera-badge';
    this.badge.type = 'button';
    this.badge.title = 'Change camera view (V)';
    this.badge.innerHTML = '<span class="camera-badge-icon"></span><span class="camera-badge-text">Third person</span>';
    this.badge.addEventListener('click', (e) => {
      e.preventDefault();
      this.controller.cycleViewMode();
      this.update();
      this.onToast(`Camera: ${this.controller.viewLabel}`, 'info');
    });
    document.body.appendChild(this.badge);

    this.textEl = this.badge.querySelector('.camera-badge-text');
    this.update();
  }

  update() {
    const label = this.controller.viewLabel;
    const first = this.controller.firstPerson;

    this.crosshair.classList.toggle('hidden', !first);

    if (label !== this._lastLabel) {
      this.textEl.textContent = label;
      this.badge.dataset.mode = first ? 'first' : (this.controller.cameraMode || 'chase');
      this._lastLabel = label;
    }
  }

  destroy() {
    this.crosshair.remove();
    this.badge.remove();
  }
}
