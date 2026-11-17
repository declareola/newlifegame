// server/config/multiplayerConfig.js
// Tunables for Step 9 (multiplayer presence, movement sync and chat).
// All values are server-side so a client cannot change its own rate limits.

export const multiplayerConfig = {
  // How often the server pushes the position snapshot to every client.
  // 100 ms = 10 updates/second, smooth enough for walking avatars without
  // flooding the socket with a 60 fps feed.
  broadcastInterval: 100,

  // Positions are clamped to the rendered map's own bounds (WORLD_BOUNDS, from
  // the generated geometry), not to a hand-typed half-extent: this used to be
  // mapBound: 95, a leftover from the old 200 m city, which pinned every player
  // at x = -95 and made most of Eko Basin unreachable.
  // `mapBound` is kept only for any caller that still wants a square limit.
  mapBound: 399,

  // Movement packets: a well-behaved client sends ~15/s. Allow 50/s before
  // we start dropping, which blocks flooding while tolerating lag spikes.
  maxMovePacketsPerSecond: 50,

  // Chat
  chatMaxLength: 200,
  chatCooldownMs: 1500,
  chatHistoryForNewJoiners: 20,

  // A player who has not sent a movement packet for this long is treated as
  // standing still (they may simply have tabbed away).
  idleAfterMs: 1200,

  // ── Movement validation ──────────────────────────────────────
  // The client reports its own position, so the server must sanity-check it.
  // RUN_SPEED in the client is 14 units/s; we allow a little headroom for
  // latency, frame hitches and rounding, but nothing close to teleporting.
  maxSpeed: 18,

  // Vehicles are genuinely faster than a running avatar. A packet that names a
  // vehicle the sender actually owns is allowed this higher cap instead of
  // maxSpeed; ownership is checked server-side and cached per session, so a
  // player cannot claim a speed boost they have not paid for.
  maxVehicleSpeed: 34,

  // Trust at most this much elapsed time between packets when working out
  // how far a player could legitimately have travelled. A client that goes
  // quiet for a minute cannot bank 60 seconds of movement credit.
  maxCatchUpMs: 2000,

  // Extra slack added to the allowed distance, in world units.
  movementTolerance: 1.5,

  // ── Connection limits ────────────────────────────────────────
  // One account, one session: a second login kicks the first, which also
  // removes any chance of duplicate income streams from multiple tabs.
  maxSessionsPerUser: 1,

  // Guards against a single host opening thousands of sockets.
  maxConnectionsPerIp: 8,
};
