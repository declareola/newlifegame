// server/config/needsConfig.js
// Centralised needs system configuration. All decay rates, thresholds,
// and timing constants live here so they can be tuned without touching
// game logic.

export const needsConfig = {
  // Timing
  tickInterval: 5000,      // 5 seconds per game tick
  persistInterval: 30000,  // 30 seconds between DB writes
  offlineCapHours: 8,      // max 8 hours of offline catch-up decay
  passOutDuration: 10000,  // 10 seconds controls locked when energy hits 0

  // Decay per tick (5 seconds)
  // — hunger & energy slowest, bladder fastest
  decay: {
    hunger:  0.5,
    energy:  0.3,
    hygiene: 0.8,
    bladder: 1.5,
    fun:     0.7,
    social:  0.6,
  },

  // Thresholds
  warningThreshold: 10,  // below this, player moves at half speed
  redThreshold: 25,      // below this, need bar turns red
  wakeUpEnergy: 10,      // energy restored when waking up from pass-out
};
