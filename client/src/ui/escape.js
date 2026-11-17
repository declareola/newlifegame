// client/src/ui/escape.js
// One Escape keypress, one action.
//
// Several components listen for Escape on `window`. Listeners on the same node
// run in registration order, so a panel that closes on Escape would remove its
// `.hidden` class, and then the pause menu's handler — running a moment later in
// the same dispatch — would see "nothing else is open" and open itself. The
// player presses Escape once and gets a closed panel plus an opened menu.
//
// `stopImmediatePropagation()` only works if you know the registration order,
// which changes whenever a module is added. So instead, whoever handles Escape
// marks *that event object*, and the pause menu checks the mark.
//
// The mark lives on the event, not in a timestamp: two quick, separate presses
// are two different events, and both must work.

const MARK = '__newlifeEscapeHandled';

/** Call from any handler that consumed this Escape press. */
export function claimEscape(event) {
  if (event) event[MARK] = true;
}

/** True if another component already handled this exact keypress. */
export function escapeWasClaimed(event) {
  return Boolean(event && event[MARK]);
}
