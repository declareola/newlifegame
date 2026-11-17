// server/config/jobConfig.js
// Job types available in NewLife. Each job has an hourly rate paid by the
// server-authoritative game loop. The client never calculates earnings.

export const jobConfig = {
  // Tick interval (ms) — used to calculate per-tick income
  // Income per tick = hourlyRate * (tickInterval_ms / 1000 / 3600)
  tickInterval: 5000,

  jobs: [
    {
      id: 'tech',
      name: 'Tech Hub Developer',
      description: 'Build apps at the Tech Hub in Yaba. High pay, brain required.',
      district: 'yaba',
      districtName: 'Yaba',
      hourlyRate: 5000,
      icon: '💻',
    },
    {
      id: 'trader',
      name: 'Market Trader',
      description: 'Trade goods at Mushin Market. Moderate pay, steady work.',
      district: 'mushin',
      districtName: 'Mushin',
      hourlyRate: 3000,
      icon: '📦',
    },
    {
      id: 'driver',
      name: 'Bus Driver',
      description: 'Drive buses from Mushin Bus Park. Good pay, always on your feet.',
      district: 'mushin',
      districtName: 'Mushin',
      hourlyRate: 2500,
      icon: '🚌',
    },
    {
      id: 'construction',
      name: 'Construction Worker',
      description: 'Build mansions in Lekki. Honest pay, hard labour.',
      district: 'lekki',
      districtName: 'Lekki',
      hourlyRate: 2000,
      icon: '🔨',
    },
    {
      id: 'water',
      name: 'Pure Water Vendor',
      description: 'Sell sachet water from a Mushin kiosk. Low pay, easy work.',
      district: 'mushin',
      districtName: 'Mushin',
      hourlyRate: 1000,
      icon: '💧',
    },
  ],
};

/**
 * Calculate income earned in a single tick.
 * @param {number} hourlyRate — naira per hour
 * @returns {number} naira earned per tick
 */
export function incomePerTick(hourlyRate) {
  return hourlyRate * (jobConfig.tickInterval / 1000 / 3600);
}
