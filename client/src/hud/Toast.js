/**
 * Lightweight toast notification system.
 * Toasts appear at the top-centre and auto-dismiss after 4 seconds.
 * Usage: toast.show('Message', 'warning' | 'critical' | 'info')
 */
export class Toast {
  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    document.body.appendChild(this.container);
  }

  show(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    this.container.appendChild(toast);

    // Animate in on next frame
    requestAnimationFrame(() => toast.classList.add('show'));

    // Animate out and remove after 4 seconds
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}
