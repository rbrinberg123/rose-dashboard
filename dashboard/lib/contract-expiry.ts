// Days-left-on-contract buckets, shared by the Client Statistics "Clients by Days
// Left" chart (deep-link out) and the Portfolio's days-left filter (deep-link in),
// so clicking a bar lands on exactly the clients that bar counted.
//
// `label` MUST equal the bucket string produced by sql/03_views.sql >
// v_client_stats_by_days_left (the chart matches its rows to a bucket by label to
// build the link). `match` re-applies the identical boundaries client-side for the
// Portfolio filter. Keep all three — SQL CASE, label, and match — in lockstep.
export type ExpiryBucket = {
  key: string
  label: string
  match: (days: number | null) => boolean
}

export const EXPIRY_BUCKETS: ExpiryBucket[] = [
  { key: "expired", label: "Expired / none", match: (d) => d == null || d <= 0 },
  { key: "lt30", label: "< 30 days", match: (d) => d != null && d > 0 && d < 30 },
  { key: "30-89", label: "30-89 days", match: (d) => d != null && d >= 30 && d < 90 },
  { key: "90-180", label: "90-180 days", match: (d) => d != null && d >= 90 && d <= 180 },
  { key: "181-365", label: "181-365 days", match: (d) => d != null && d > 180 && d <= 365 },
  { key: "365plus", label: "365+ days", match: (d) => d != null && d > 365 },
]

/** Bucket key -> definition, for the Portfolio filter (URL param -> predicate). */
export const EXPIRY_BUCKET_BY_KEY: Record<string, ExpiryBucket> = Object.fromEntries(
  EXPIRY_BUCKETS.map((b) => [b.key, b]),
)

/** Bucket label -> key, for the chart (SQL row label -> deep-link param). */
export const EXPIRY_KEY_BY_LABEL: Record<string, string> = Object.fromEntries(
  EXPIRY_BUCKETS.map((b) => [b.label, b.key]),
)
