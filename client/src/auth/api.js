/**
 * Where the API lives.
 *
 * The game has always been served by its own Node server, so every call could be
 * relative — `/api/...` hits the same origin that served the page. That stops
 * being true the moment the client is hosted anywhere else (Vercel, Netlify, a CDN)
 * and the Express + Socket.IO server stays on a host with a disk: a relative
 * `/api` would then hit Vercel, which has no such route, and every login would be
 * a 404.
 *
 * So the origin is configurable at build time. With no `VITE_API_ORIGIN` set the
 * value is empty and everything is exactly as relative as it has always been —
 * the single-host deployment is untouched. Set it to the server's origin (for
 * example `https://newlife-api.onrender.com`) and the same build talks to that
 * server instead.
 */
export const API_ORIGIN = (import.meta.env?.VITE_API_ORIGIN || '').replace(/\/$/, '');

const API_BASE = `${API_ORIGIN}/api`;

/**
 * The origin the Socket.IO client connects to, or `undefined` for same-origin.
 * Multiplayer has the same problem as the REST calls: a socket to a static host
 * connects to nothing.
 */
export const SOCKET_ORIGIN = API_ORIGIN || undefined;

// ── One request path for the whole client ────────────────────
//
// Every authenticated call in this file goes through apiFetch(). It exists
// because of a real, reported failure: the game runs behind a preview proxy
// that does not always forward the `Authorization` header, so the server saw a
// request with no token at all and answered "No token provided" — the player
// could not buy anything while sitting on millions of naira.
//
// So each request now carries the token three ways, and the transports are
// tried in order until one is accepted:
//
//   1. `Authorization: Bearer <token>` (normal) plus `X-Auth-Token` (a second
//      header, in case an allowlist passes one and not the other);
//   2. the `nl_token` cookie, which the browser attaches itself — this is what
//      survives a proxy that strips unknown headers, and it is the reason
//      sign-in now sets a cookie;
//   3. `?token=<token>` on a retry, as a last resort.
//
// A retry only happens for the precise failure being defended against — a 401
// whose body says "No token provided". Anything else is returned untouched, so
// real authorisation errors still surface as themselves.

/** Build the auth headers for a request. */
function authHeaders(token, json = false) {
  const h = {};
  if (json) h['Content-Type'] = 'application/json';
  if (token) {
    h.Authorization = `Bearer ${token}`;
    h['X-Auth-Token'] = token;
  }
  return h;
}

/** Append the token as a query parameter, keeping any existing query. */
function withTokenQuery(url, token) {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * fetch() with the session token attached, and one token-in-the-query retry if
 * the request comes back "No token provided".
 *
 * @param {string} url
 * @param {object} [init] standard fetch init; `token` is read from init.token
 * @param {string|null} [token]
 */
async function apiFetch(url, init = {}) {
  // The token is already in the headers every caller built with authHeaders().
  // Read it back from there rather than asking 25 call sites to pass it twice.
  const token = init.headers?.['X-Auth-Token'] || null;
  const res = await fetch(url, {
    ...init,
    // Send cookies same-origin. Without this a cross-origin-styled deployment
    // would drop the cookie transport and we would be back to header-only.
    credentials: 'same-origin',
  });

  if (res.status !== 401) return res;

  // Look at the body to decide whether this is the stripped-header failure.
  let body = null;
  try {
    body = await res.clone().json();
  } catch {
    return res;
  }
  if (!body || String(body.error || '') !== 'No token provided') return res;

  // Retry once with the token in the query string.
  const retry = await fetch(withTokenQuery(url, token), {
    ...init,
    credentials: 'same-origin',
  });
  return retry;
}



/**
 * POST /api/signup
 * @returns {{ token: string, user: object }} or { error: string }
 */
export async function signup(username, password, tier, skinColor, outfitColor, appearance = null) {
  try {
    const body = {
      username,
      password,
      tier,
      skin_color: skinColor,
      outfit_color: outfitColor,
    };
    // The character creator sends the rest of the look too; the server has
    // columns for it and validates every value against its own whitelist.
    if (appearance && typeof appearance === 'object') {
      Object.assign(body, {
        hair_style: appearance.hair_style,
        hair_color: appearance.hair_color,
        body_type: appearance.body_type,
        outfit_id: appearance.outfit_id,
        bottom_color: appearance.bottom_color,
      });
    }
    const res = await apiFetch(`${API_BASE}/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/appearance — save a change made in the character panel.
 * @returns {{ ok: true, user: object } | { error: string }}
 */
export async function saveAppearance(token, patch) {
  if (!token) return { error: 'Not signed in' };
  try {
    const res = await apiFetch(`${API_BASE}/appearance`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify(patch),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/login
 * @returns {{ token: string, user: object }} or { error: string }
 */
export async function login(username, password) {
  try {
    const res = await apiFetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * GET /api/me (requires JWT)
 * @returns {{ user: object }} or { error: string }
 */
export async function getMe(token) {
  try {
    const res = await apiFetch(`${API_BASE}/me`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

// ── Job API ───────────────────────────────────────────────────

/**
 * GET /api/jobs (requires JWT)
 * @returns {{ jobs: array, currentJob: object|null }} or { error: string }
 */
export async function getJobs(token) {
  try {
    const res = await apiFetch(`${API_BASE}/jobs`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/jobs/take (requires JWT)
 * @param {string} jobType — job id from the jobs list
 * @returns {{ job: object, user: object }} or { error: string }
 */
export async function takeJob(token, jobType) {
  try {
    const res = await apiFetch(`${API_BASE}/jobs/take`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ job_type: jobType }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/jobs/quit (requires JWT)
 * @returns {{ user: object }} or { error: string }
 */
export async function quitJob(token) {
  try {
    const res = await apiFetch(`${API_BASE}/jobs/quit`, {
      method: 'POST',
      headers: authHeaders(token, true),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

// ── Activity API ───────────────────────────────────────────────

/**
 * GET /api/activities (requires JWT)
 * @returns {{ activities: array, currentActivity: object|null }} or { error: string }
 */
export async function getActivities(token) {
  try {
    const res = await apiFetch(`${API_BASE}/activities`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/activities/perform (requires JWT)
 * @param {string} activityId — activity id from the activities list
 * @returns {{ activity: object, user: object }} or { error: string }
 */
export async function performActivity(token, activityId) {
  try {
    const res = await apiFetch(`${API_BASE}/activities/perform`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ activity_id: activityId }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/activities/cancel (requires JWT)
 * @returns {{ user: object }} or { error: string }
 */
export async function cancelActivity(token) {
  try {
    const res = await apiFetch(`${API_BASE}/activities/cancel`, {
      method: 'POST',
      headers: authHeaders(token, true),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

// ── Property / housing API ─────────────────────────────────────

/**
 * GET /api/properties (requires JWT)
 * @returns {{ properties: array, home: object|null, tenure: string|null,
 *             rentDueIn: number, rentPeriodMs: number, cash: number,
 *             bankBalance: number }} or { error: string }
 */
export async function getProperties(token) {
  try {
    const res = await apiFetch(`${API_BASE}/properties`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/properties/buy (requires JWT)
 * @param {string} propertyId
 */
export async function buyProperty(token, propertyId) {
  try {
    const res = await apiFetch(`${API_BASE}/properties/buy`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ property_id: propertyId }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/properties/rent (requires JWT)
 * @param {string} propertyId
 */
export async function rentProperty(token, propertyId) {
  try {
    const res = await apiFetch(`${API_BASE}/properties/rent`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ property_id: propertyId }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/properties/move-in (requires JWT)
 * @param {string} propertyId
 */
export async function moveIn(token, propertyId) {
  try {
    const res = await apiFetch(`${API_BASE}/properties/move-in`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ property_id: propertyId }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

// ── World interaction API (Step 10) ───────────────────────────

/**
 * GET /api/interactions (requires JWT)
 * @returns {{ points: array, shopItems: array, minBankAmount: number,
 *             cash: number, bankBalance: number }} or { error: string }
 */
export async function getInteractions(token) {
  try {
    const res = await apiFetch(`${API_BASE}/interactions`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/** POST /api/interactions/bank/deposit (requires JWT) */
export async function bankDeposit(token, pointId, amount) {
  try {
    const res = await apiFetch(`${API_BASE}/interactions/bank/deposit`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ point_id: pointId, amount }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/** POST /api/interactions/bank/withdraw (requires JWT) */
export async function bankWithdraw(token, pointId, amount) {
  try {
    const res = await apiFetch(`${API_BASE}/interactions/bank/withdraw`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ point_id: pointId, amount }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/** POST /api/interactions/shop/buy (requires JWT) */
export async function buyShopItem(token, pointId, itemId) {
  try {
    const res = await apiFetch(`${API_BASE}/interactions/shop/buy`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ point_id: pointId, item_id: itemId }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

// ── Session management ────────────────────────────────────────

/**
 * POST /api/logout (requires JWT) — revokes every token for this account.
 */
export async function logout(token) {
  try {
    const res = await apiFetch(`${API_BASE}/logout`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/**
 * POST /api/password (requires JWT) — changes password and returns a new token.
 */
export async function changePassword(token, currentPassword, newPassword) {
  try {
    const res = await apiFetch(`${API_BASE}/password`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({
        current_password: currentPassword,
        new_password: newPassword,
      }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

// ── Leaderboard API (Step 11) ─────────────────────────────────

/**
 * GET /api/leaderboard (requires JWT)
 * @returns {{ entries: array, you: object|null, total: number }} or { error: string }
 */
export async function getLeaderboard(token) {
  try {
    const res = await apiFetch(`${API_BASE}/leaderboard`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

// ── Token persistence ──────────────────────────────────────────
/**
 * GET /api/venues (requires JWT)
 * Returns the catalogue for whichever venue the server thinks you are in, plus
 * the list of every venue that sells anything.
 */
export async function getVenues(token) {
  try {
    const res = await apiFetch(`${API_BASE}/venues`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

/** POST /api/interactions/venue/buy (requires JWT) */
export async function buyVenueItem(token, venueId, itemId) {
  try {
    const res = await apiFetch(`${API_BASE}/interactions/venue/buy`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify({ venue_id: venueId, item_id: itemId }),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

export function getToken() {
  return localStorage.getItem('newlife_token');
}

export function setToken(token) {
  localStorage.setItem('newlife_token', token);
}

export function clearToken() {
  localStorage.removeItem('newlife_token');
}

// ── Open-world API: inventory, missions, vehicles ─────────────

async function postJSON(path, token, body) {
  try {
    const res = await apiFetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify(body || {}),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

async function getJSON(path, token) {
  try {
    const res = await apiFetch(`${API_BASE}${path}`, {
      headers: authHeaders(token),
    });
    return await res.json();
  } catch (err) {
    // Never swallow the reason: "cannot reach server" for a bug in this file
    // wasted an hour once. The console keeps the real error; the UI keeps the
    // friendly one.
    console.warn('[api] request failed:', err && err.message ? err.message : err);
    return { error: 'Cannot reach server — is it running?' };
  }
}

export const getInventory = (token) => getJSON('/inventory', token);
export const buyItem = (token, itemId, quantity = 1) =>
  postJSON('/inventory/buy', token, { itemId, quantity });
export const useItem = (token, itemId) => postJSON('/inventory/use', token, { itemId });
export const discardItem = (token, itemId) => postJSON('/inventory/discard', token, { itemId });

export const getMissions = (token) => getJSON('/missions', token);
export const acceptMission = (token, missionId) =>
  postJSON('/missions/accept', token, { missionId });
export const claimMission = (token, missionId) =>
  postJSON('/missions/claim', token, { missionId });

export const getVehicles = (token) => getJSON('/vehicles', token);
export const buyVehicle = (token, vehicleId, colour) =>
  postJSON('/vehicles/buy', token, { vehicleId, colour });
export const parkVehicle = (token, id, x, z, fuel) =>
  postJSON('/vehicles/park', token, { id, x, z, fuel });
export const refuelVehicle = (token, id, litres) =>
  postJSON('/vehicles/fuel', token, { id, litres });

export const markDistrictVisit = (token) => postJSON('/world/visit', token, {});
export const saveProgress = (token) => postJSON('/save', token, {});

export const getCharacter = (token) => getJSON('/character', token);

export const npcService = (token, serviceId) => postJSON('/world/service', token, { serviceId });

// ── Who is behind the counter ────────────────────────────────
/** GET /api/venue/staff — the attendant in the room the server thinks we are in. */
export const getVenueStaff = (token) => getJSON('/venue/staff', token);

// ── Home utilities: the meter, the tank, the gas, the roof ────
export const getUtilities = (token) => getJSON('/home/utilities', token);
export const topUpUtility = (token, kind, bundle) =>
  postJSON('/home/utilities/topup', token, { kind, bundle });
export const toggleAppliance = (token, appliance) =>
  postJSON('/home/utilities/toggle', token, { appliance });
export const buySolarPanels = (token) => postJSON('/home/utilities/solar', token, {});

// ── The wanted matrix: three factions, four tiers ────────────
/** GET /api/wanted — the whole matrix, plus where the player is standing. */
export const getWanted = (token) => getJSON('/wanted', token);
/** POST /api/crime — report a crime. The server decides the district and the stars. */
export const reportCrime = (token, crime, extra = {}) =>
  postJSON('/crime', token, { crime, ...extra });
/** POST /api/wanted/bribe — pay a faction to forget you. Price is the server's. */
export const payBribe = (token, factionId) => postJSON('/wanted/bribe', token, { factionId });

// ── Player property market ───────────────────────────────────
/** POST /api/properties/list — put one of your titles up for sale or for rent. */
export const listProperty = (token, propertyId, { mode, price, deposit }) =>
  apiFetch(`${API_BASE}/properties/list`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ property_id: propertyId, mode, price, deposit }),
  }).then((r) => r.json()).catch(() => ({ error: 'Cannot reach server — is it running?' }));

/** POST /api/properties/unlist — take your listing down. */
export const unlistProperty = (token, propertyId) =>
  apiFetch(`${API_BASE}/properties/unlist`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ property_id: propertyId }),
  }).then((r) => r.json()).catch(() => ({ error: 'Cannot reach server — is it running?' }));

/** POST /api/properties/buy-listing — buy another player's title. */
export const buyListing = (token, propertyId, listingId) =>
  apiFetch(`${API_BASE}/properties/buy-listing`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ property_id: propertyId, listing_id: listingId }),
  }).then((r) => r.json()).catch(() => ({ error: 'Cannot reach server — is it running?' }));

/** POST /api/properties/rent-listing — take another player's letting. */
export const rentListing = (token, propertyId, listingId) =>
  apiFetch(`${API_BASE}/properties/rent-listing`, {
    method: 'POST',
    headers: authHeaders(token, true),
    body: JSON.stringify({ property_id: propertyId, listing_id: listingId }),
  }).then((r) => r.json()).catch(() => ({ error: 'Cannot reach server — is it running?' }));
