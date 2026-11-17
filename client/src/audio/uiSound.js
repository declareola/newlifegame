// client/src/audio/uiSound.js
// Bind the interface to the audio engine with one call.
//
// Three rules, applied once here rather than sprinkled through 20 panels:
//   · a click on any button, row, chip, swatch or action sounds like a click
//   · opening or closing something speaks in its own voice
//   · hovering is nearly silent (and only on a fine pointer, never on touch)
//
// It listens on the document in the capture phase, so panels that are created
// later — the job board, the character sheet, the pause menu — are covered
// without knowing that audio exists.

const UI_SELECTOR = [
  'button',
  '.pause-row',
  '.action-slot',
  '.tab',
  '.chip',
  '.swatch',
  '.outfit-card',
  '[data-act]',
  '[data-tier]',
  '[role="button"]',
].join(',');

const CLOSE_SELECTOR = ['.panel-close', '[data-act="close"]', '.modal-close'].join(',');
// `Element.matches()` takes a selector, not a regular expression — passing a
// RegExp threw on every click and killed the handler. These are the actions
// that open something rather than toggle it.
const OPENS = new Set([
  'open', 'menu', 'inventory', 'map', 'jobs', 'missions', 'activities',
  'property', 'chat', 'leaderboard', 'character', 'controls', 'tutorial', 'save',
]);

/**
 * @param {import('./AudioEngine.js').AudioEngine} audio
 * @param {Document} [doc]
 * @returns {function} detach
 */
export function bindUISounds(audio, doc = document) {
  if (!audio || !doc?.addEventListener) return () => {};
  let last = 0;

  const target = (el) => (el?.closest ? el.closest(UI_SELECTOR) : null);

  const onClick = (e) => {
    const el = target(e.target);
    if (!el) return;
    const now = Date.now();
    if (now - last < 40) return; // one sound per press, not per bubbled node
    last = now;
    const act = el.dataset?.act || '';
    if (el.matches(CLOSE_SELECTOR)) audio.play('close');
    else if (OPENS.has(act)) audio.play('open');
    else audio.play('click');
  };

  const onOver = (e) => {
    if (e.pointerType === 'touch') return;
    const el = target(e.target);
    if (!el) return;
    audio.play('hover', { gain: 0.5 });
  };

  doc.addEventListener('pointerdown', onClick, true);
  doc.addEventListener('pointerover', onOver, true);
  return () => {
    doc.removeEventListener('pointerdown', onClick, true);
    doc.removeEventListener('pointerover', onOver, true);
  };
}

/** Map a toast type to a sound. */
export function toastSound(type) {
  if (type === 'error') return 'error';
  if (type === 'success') return 'success';
  if (type === 'money') return 'cash';
  return 'click';
}
