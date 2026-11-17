// client/src/ui/icons.js
// Inline SVG icon set.
//
// No icon font, no sprite sheet, no download — every icon is a small path
// string drawn with currentColor so it inherits the button's colour and can be
// recoloured by CSS state (:hover, .active, .danger).
//
// Usage:  el.innerHTML = icon('briefcase', 18)

const PATHS = {
  // ── Status bar ──
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.3 0-6 1.8-6 4v2h12v-2c0-2.2-2.7-4-6-4Z',
  cash: 'M3 7h18v10H3V7Zm9 2.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM6 10a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm12 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  bank: 'M12 3 2 8v2h20V8L12 3ZM4 11v7h3v-7H4Zm6 0v7h4v-7h-4Zm7 0v7h3v-7h-3ZM2 19h20v2H2v-2Z',
  briefcase: 'M9 4h6a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3V6a2 2 0 0 1 2-2Zm0 3h6V6H9v1Zm-2 5h10v2H7v-2Z',
  home: 'M12 3 2 11h3v9h6v-6h2v6h6v-9h3L12 3Z',
  users: 'M8 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 8 11Zm8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-8 1.6c-2.9 0-5.3 1.6-5.3 3.6V19h10.6v-2.8c0-2-2.4-3.6-5.3-3.6Zm8 .4c-.6 0-1.2.06-1.7.2 1 .8 1.6 1.9 1.6 3v2.8H21v-2.4c0-1.9-2.2-3.4-5-3.6Z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 5h-2v6l5 3 1-1.7-4-2.3V7Z',

  // ── Needs ──
  hunger: 'M7 2v9a3 3 0 0 0 2 2.8V22h2V13.8A3 3 0 0 0 13 11V2h-2v7h-1V2H8v7H7.5V2H7Zm9 0c-1.7 0-3 2-3 5s1 4.6 2.5 5V22h2V2H16Z',
  energy: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  hygiene: 'M12 2c-2 3.5-5 6.2-5 10a5 5 0 0 0 10 0c0-3.8-3-6.5-5-10Zm0 16a6 6 0 0 0-4-1.3c.4 2.7 2 4.3 4 5.3 2-1 3.6-2.6 4-5.3A6 6 0 0 0 12 18Z',
  bladder: 'M12 2s6 7 6 12a6 6 0 0 1-12 0C6 9 12 2 12 2Z',
  fun: 'M6 8h12a4 4 0 0 1 3.9 4.9l-1.2 5A4 4 0 0 1 16.8 21H7.2a4 4 0 0 1-3.9-3.1l-1.2-5A4 4 0 0 1 6 8Zm2.5 3.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3ZM9 16h6v1.4H9V16Z',
  social: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4 0-7.3 2.2-7.3 4.9V21h14.6v-2.1C19.3 16.2 16 14 12 14Z',

  // ── Actions ──
  jobs: 'M9 4h6a2 2 0 0 1 2 2v1h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h3V6a2 2 0 0 1 2-2Zm0 3h6V6H9v1Zm-2 5h10v2H7v-2Z',
  activities: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3.2 1.9 4.3 4.7.4-3.5 3.1 1 4.6L12 15.2l-4.1 2.4 1-4.6-3.5-3.1 4.7-.4L12 5.2Z',
  property: 'M12 3 2 11h3v9h6v-6h2v6h6v-9h3L12 3Z',
  trophy: 'M7 3h10v2h3v4a4 4 0 0 1-4 4h-.6A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.6 13H8a4 4 0 0 1-4-4V5h3V3Zm0 4H5v2a2 2 0 0 0 2 2V7Zm10 0v4a2 2 0 0 0 2-2V7h-2Z',
  camera: 'M9 4h6l1.5 2H21a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5L9 4Zm3 5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
  graphics: 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-6v2h3v2H7v-2h3v-2H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 6 3 4 2.5-3L14 15h5l-2-3-2 2.5L11 9l-2.5 2L7 10Z',
  door: 'M5 2h11a1 1 0 0 1 1 1v18H5V2Zm3 9a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM18 4h2v18h-2V4Z',
  chart: 'M4 20h16v2H2V2h2v18Zm3-3H5V9h2v8Zm4 0H9V5h2v12Zm4 0h-2v-6h2v6Zm4 0h-2V7h2v10Z',
  settings: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm9 3.5-.1 1.6 1.6 1.2-1.6 2.8-1.9-.7-1.4.9-.3 2h-3.2l-.4-2-1.4-.8-1.9.7-1.6-2.8L8.1 13.7 8 12l.1-1.6L6.5 9.2 8.1 6.4l1.9.7 1.4-.9.3-2h3.2l.4 2 1.4.8 1.9-.7 1.6 2.8-1.6 1.2.1 1.6Z',
  close: 'M18.3 5.7 12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7l1.4-1.4L10.6 10.6l6.3-6.3 1.4 1.4Z',
  chevron: 'M8.6 4.6 16 12l-7.4 7.4-1.4-1.4L13.2 12 7.2 6l1.4-1.4Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 20.6 7.4 19.2 6 9 16.2Z',
  warning: 'M12 2 1.5 21h21L12 2Zm1 14h-2v2h2v-2Zm0-7h-2v5h2V9Z',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z',
  pulse: 'M2 12h4l2.5-6 4 13 2.5-7H22v2h-5.2l-3.3 9-4-13L8 14H2v-2Z',
  hand: 'M9 2h2v7h1V3h2v6h1V4h2v6h1V6h2v9a6 6 0 0 1-6 6H9.6a5 5 0 0 1-3.6-1.5L2.4 15.9l1.4-1.5 3.2 3V6h2v6h1V2Z',
  needs: 'M12 2 3 6v6c0 5 3.8 9.3 9 10 5.2-.7 9-5 9-10V6l-9-4Zm0 4.2 4.5 2.1v3.9c0 3.2-1.9 6.1-4.5 6.9-2.6-.8-4.5-3.7-4.5-6.9V8.3l4.5-2.1Z',
  walk: 'M13.5 5.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6ZM10 22l1.6-5.5-2.4-2.3.9-4.6 3.1 1.9 2.3.5-.4 2-3-1-1 4.3 2.6 2.4L15.5 22h-2.1l-1-4.2-1 4.2H10Z',
};

/**
 * @param {string} name - key from PATHS
 * @param {number} [size=18]
 * @returns {string} an inline <svg> element as a string
 */
export function icon(name, size = 18) {
  const d = PATHS[name];
  if (!d) return '';
  return (
    `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="currentColor" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`
  );
}

/** Convenience for building an <button> with an icon + label. */
export function iconButton(name, label, { size = 18, className = '' } = {}) {
  return (
    `<button class="icon-btn ${className}" type="button" data-icon="${name}">` +
    `${icon(name, size)}<span class="icon-btn-label">${label}</span></button>`
  );
}

export const ICON_NAMES = Object.keys(PATHS);
