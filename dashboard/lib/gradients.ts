// Shared gradient + pill color config.
// One source of truth for the GradientHero banner, the status pills, and the
// StatCard top-edge accents so every surface draws from the same palette.

/** Hero banner base gradient. */
export const HERO_GRADIENT =
  "linear-gradient(120deg, #0A1F5C 0%, #0355A7 60%, #0E6E9E 100%)"

/** Two soft radial color blooms layered over the hero for depth. */
export const HERO_OVERLAY =
  "radial-gradient(circle at 14% 20%, rgba(120,200,255,0.38), transparent 44%), " +
  "radial-gradient(circle at 90% 90%, rgba(40,230,190,0.28), transparent 48%)"

/** Status pill color variants (tuned to sit on the dark gradient). */
export type PillVariant = "new" | "watch" | "positive" | "atRisk" | "neutral"

export const PILL_VARIANTS: Record<
  PillVariant,
  { bg: string; border: string; text: string }
> = {
  new: {
    bg: "rgba(108,95,216,0.30)",
    border: "rgba(180,170,255,0.40)",
    text: "#E4E0FF",
  },
  watch: {
    bg: "rgba(199,122,62,0.30)",
    border: "rgba(245,200,150,0.42)",
    text: "#FBE7CF",
  },
  positive: {
    bg: "rgba(29,158,117,0.30)",
    border: "rgba(150,235,200,0.42)",
    text: "#D8FBEC",
  },
  atRisk: {
    bg: "rgba(197,48,48,0.32)",
    border: "rgba(255,170,170,0.42)",
    text: "#FFE0E0",
  },
  neutral: {
    bg: "rgba(255,255,255,0.14)",
    border: "rgba(255,255,255,0.30)",
    text: "rgba(255,255,255,0.92)",
  },
}

/**
 * Stat-card top-edge gradient pairs [from, to], keyed by metric.
 * Passed into <StatCard gradient={...} /> so the accent travels with the card.
 */
export const STAT_GRADIENTS = {
  meetings: ["#0355A7", "#1E2858"],
  institutions: ["#0355A7", "#0E6E9E"],
  feedback: ["#C77A3E", "#854F0B"],
  retainer: ["#1D9E75", "#0E6E9E"],
  perMeeting: ["#1D9E75", "#0355A7"],
  renewal: ["#0355A7", "#1E2858"],
} as const satisfies Record<string, readonly [string, string]>

export type StatGradient = readonly [string, string]

/** Gradient top-edge pairs [from, to] for the Pipeline summary cards (color-matched to meaning). */
export const PIPELINE_CARD_GRADIENTS = {
  upcoming: ["#0355A7", "#13347A"],
  unassigned: ["#EF9F27", "#C77A3E"],
  virtual: ["#0355A7", "#0E6E9E"],
  inPerson: ["#159E94", "#3B6D11"],
  next7: ["#0355A7", "#13347A"],
} as const satisfies Record<string, readonly [string, string]>

/** Gradient top-edge pairs [from, to] for the Feedback summary cards (color-matched to meaning). */
export const FEEDBACK_CARD_GRADIENTS = {
  needFeedback: ["#0355A7", "#13347A"],
  noFeedback: ["#D85A30", "#A32D2D"],
  awaiting: ["#EF9F27", "#C77A3E"],
  stale30: ["#A32D2D", "#D85A30"],
  oldest: ["#0355A7", "#0E6E9E"],
} as const satisfies Record<string, readonly [string, string]>

/** Gradient top-edge pairs [from, to] for the Institution Detail KPIs. */
export const INSTITUTION_CARD_GRADIENTS = {
  meetings: ["#0355A7", "#1E2858"],
  clients: ["#0355A7", "#0E6E9E"],
  people: ["#0355A7", "#1C8C9C"],
  feedback: ["#1D9E75", "#0E6E9E"],
  lastMet: ["#0355A7", "#13347A"],
} as const satisfies Record<string, readonly [string, string]>

/** Gradient top-edge pairs [from, to] for the People (Productivity) Detail KPIs. */
export const PRODUCTIVITY_CARD_GRADIENTS = {
  scheduled: ["#0355A7", "#1E2858"],
  hosted: ["#0355A7", "#0E6E9E"],
  inPerson: ["#0355A7", "#1C8C9C"],
  feedback: ["#1C8C9C", "#4FC6BC"],
  activeClients: ["#1D9E75", "#0E6E9E"],
  salesLeadBook: ["#1D9E75", "#0355A7"],
} as const satisfies Record<string, readonly [string, string]>

/** Gradient top-edge pairs [from, to] for the Contract Management KPIs. */
export const CONTRACT_CARD_GRADIENTS = {
  total: ["#0355A7", "#13347A"],
  expiringUrgent: ["#A32D2D", "#D85A30"],
  expiringSoon: ["#EF9F27", "#C77A3E"],
  noContract: ["#D85A30", "#A32D2D"],
  autoRenew: ["#1D9E75", "#0E6E9E"],
} as const satisfies Record<string, readonly [string, string]>

// ---------------------------------------------------------------------------
// Client Statistics page
// ---------------------------------------------------------------------------

/** Gradient top-edge pairs [from, to] for the Client Statistics KPI cards. */
export const CLIENT_STATS_CARD_GRADIENTS = {
  activeAccounts: ["#0355A7", "#13347A"],
  retainerRevenue: ["#0355A7", "#13347A"],
  avgRetainer: ["#1C8C9C", "#4FC6BC"],
} as const satisfies Record<string, readonly [string, string]>

/** 3px gradient top-edge bars on the distribution cards. */
export const DISTRIBUTION_EDGES = {
  marketCap: "linear-gradient(90deg, #0355A7, #0C6090)",
  region: "linear-gradient(90deg, #0355A7, #1C8C9C)",
  sector: "linear-gradient(90deg, #1C8C9C, #4FC6BC)",
} as const

/**
 * Market-cap donut colors, keyed by bucket. Ordered largest→smallest cap so
 * bigger caps read darker; Unknown is the lightest neutral.
 */
export const MARKET_CAP_DONUT: Record<string, string> = {
  Large: "#1E2858",
  Mid: "#3D5599",
  Small: "#1C8C9C",
  Micro: "#4FC6BC",
  Unknown: "#C8DEDB",
}

/** Fallback for any market-cap bucket not in the sequence above. */
export const MARKET_CAP_DONUT_FALLBACK = "#C8DEDB"

/** Light track behind the horizontal distribution bars. */
export const BAR_TRACK = "#EEF0F4"

/** Gradient fills for the horizontal distribution bars. */
export const BAR_FILLS = {
  region: "linear-gradient(90deg, #1E2858, #3D5599)",
  sector: "linear-gradient(90deg, #1C8C9C, #4FC6BC)",
} as const
