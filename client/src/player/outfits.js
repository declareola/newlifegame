// client/src/player/outfits.js
// What a character can look like.
//
// The character used to be a skin swatch and an outfit colour. This is the
// vocabulary the new character creator and the character panel both work from:
// skin tones, hair, builds and a set of whole outfits that change silhouette,
// not just hue — a trader in a dashiki with a gele does not look like the same
// man in a shirt and cap.

/** Skin tones, warm to deep. Values are the hex the server stores. */
export const SKIN_TONES = [
  { id: 'tone-1', label: 'Honey',    hex: 0xf1c27d },
  { id: 'tone-2', label: 'Caramel',  hex: 0xd9a066 },
  { id: 'tone-3', label: 'Chestnut', hex: 0xb5793f },
  { id: 'tone-4', label: 'Mahogany', hex: 0x8d5524 },
  { id: 'tone-5', label: 'Ebony',    hex: 0x5c3a21 },
  { id: 'tone-6', label: 'Onyx',     hex: 0x3b2416 },
];

/** Hair styles, including the ones that read as Nigerian street fashion. */
export const HAIR_STYLES = [
  { id: 'short',  label: 'Low cut' },
  { id: 'afro',   label: 'Afro' },
  { id: 'braids', label: 'Braids' },
  { id: 'bald',   label: 'Clean shave' },
  { id: 'fade',   label: 'Fade' },
];

export const HAIR_COLOURS = [
  { id: 'black', label: 'Black', hex: 0x181310 },
  { id: 'brown', label: 'Brown', hex: 0x3b2a1d },
  { id: 'auburn', label: 'Auburn', hex: 0x5a3120 },
  { id: 'grey',  label: 'Grey',  hex: 0x8a8580 },
];

export const BODY_TYPES = [
  { id: 'slim',    label: 'Slim' },
  { id: 'average', label: 'Average' },
  { id: 'broad',   label: 'Broad' },
];

/**
 * Whole outfits.
 *
 *   top      shirt colour
 *   bottom   trouser / skirt colour
 *   sleeve   'long' | 'short'
 *   garment  'none' | 'dashiki' | 'kaba' | 'waistcoat' | 'blazer'
 *   shoes    'sneakers' | 'loafers' | 'sandals'
 *   head     'none' | 'cap' | 'gele' | 'kufi' | 'hijab'
 *   extra    'none' | 'watch' | 'backpack' | 'satchel' | 'glasses'
 */
export const OUTFITS = [
  {
    id: 'casual', label: 'Casual',
    top: 0x2196f3, bottom: 0x2c3e50, sleeve: 'short',
    garment: 'none', shoes: 'sneakers', head: 'none', extra: 'watch',
  },
  {
    id: 'trader', label: 'Market trader',
    top: 0xd9a441, bottom: 0x6d4c2f, sleeve: 'short',
    garment: 'dashiki', shoes: 'sandals', head: 'gele', extra: 'satchel',
  },
  {
    id: 'office', label: 'Office',
    top: 0xf2f4f6, bottom: 0x1c2833, sleeve: 'long',
    garment: 'blazer', shoes: 'loafers', head: 'none', extra: 'glasses',
  },
  {
    id: 'student', label: 'Student',
    top: 0x27ae60, bottom: 0x34495e, sleeve: 'short',
    garment: 'none', shoes: 'sneakers', head: 'cap', extra: 'backpack',
  },
  {
    id: 'owambe', label: 'Owambe',
    top: 0x8e44ad, bottom: 0x4a235a, sleeve: 'long',
    garment: 'kaba', shoes: 'sandals', head: 'gele', extra: 'none',
  },
  {
    id: 'kaftan', label: 'Kaftan',
    top: 0xf4f1e8, bottom: 0x2f3640, sleeve: 'long',
    garment: 'dashiki', shoes: 'loafers', head: 'kufi', extra: 'none',
  },
  {
    id: 'modest', label: 'Modest wear',
    top: 0x1f6f5c, bottom: 0x164d40, sleeve: 'long',
    garment: 'kaba', shoes: 'sandals', head: 'hijab', extra: 'none',
  },
  {
    id: 'worker', label: 'Site worker',
    top: 0xe67e22, bottom: 0x2f3640, sleeve: 'long',
    garment: 'waistcoat', shoes: 'sneakers', head: 'cap', extra: 'none',
  },
];

export const DEFAULT_LOOK = {
  skin: 0xf1c27d,
  hair: 'short',
  hairColour: 0x181310,
  body: 'average',
  outfit: 'casual',
  top: 0x2196f3,
  bottom: 0x2c3e50,
};

export function outfitById(id) {
  return OUTFITS.find((o) => o.id === id) || OUTFITS[0];
}

/**
 * Turn a saved/partial look into a complete one.
 * Anything missing falls back to the default so a corrupt save still renders.
 */
export function normaliseLook(look = {}) {
  const outfit = outfitById(look.outfit || DEFAULT_LOOK.outfit);
  const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    skin: num(look.skin, DEFAULT_LOOK.skin),
    hair: HAIR_STYLES.some((h) => h.id === look.hair) ? look.hair : DEFAULT_LOOK.hair,
    hairColour: num(look.hairColour, DEFAULT_LOOK.hairColour),
    body: BODY_TYPES.some((b) => b.id === look.body) ? look.body : DEFAULT_LOOK.body,
    outfit: outfit.id,
    top: num(look.top, outfit.top),
    bottom: num(look.bottom, outfit.bottom),
    // An outfit supplies the defaults; a specific look may override any piece,
    // which is how a police officer wears the work outfit with a police cap and
    // no kufi.
    sleeve: look.sleeve || outfit.sleeve,
    garment: look.garment || outfit.garment,
    shoes: look.shoes || outfit.shoes,
    head: look.head || outfit.head,
    extra: look.extra || outfit.extra,
  };
}

/**
 * Swap in a different outfit, dropping every piece that belonged to the old one
 * so the new outfit's garment, headwear, sleeves and shoes take over.
 */
export function withOutfit(look, outfitId) {
  const next = { ...look, outfit: outfitId };
  for (const key of ['top', 'bottom', 'garment', 'head', 'extra', 'sleeve', 'shoes']) {
    delete next[key];
  }
  return normaliseLook(next);
}

/** Hex string → number, for colour inputs and the server's stored colours. */
export function hexToInt(hex, fallback = 0xffffff) {
  if (typeof hex === 'number') return hex;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  return m ? parseInt(m[1], 16) : fallback;
}

export function intToHex(n) {
  return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}
