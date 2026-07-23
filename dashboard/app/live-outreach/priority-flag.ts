// Shared "priority flag" decision for Live Outreach, used by BOTH the page cards
// (live-outreach-view.tsx) and the email (email-html.ts — cards + summary table)
// so the flag can never drift between them. Exactly one flag per event, chosen by
// this precedence (confirmed with the team):
//
//   1. urgency === 'High'                  -> "High Priority" (alert red)
//   2. else is_new_client                  -> "New Client"    (rose-crimson —
//                                             wins over At Risk, so a new + at-risk
//                                             client stays "New Client")
//   3. else client_status_label === 'At Risk' -> "High Priority" (same alert red as #1)
//   4. else                                -> no flag
//
// The tiered SORT order (see app/live-outreach/load.ts) is deliberately similar
// but NOT identical: there, At Risk (tier 2) outranks New Client (tier 3). Only
// the FLAG lets New Client win.
import type { LiveOutreachRow } from "@/lib/types"

export type PriorityFlagKind = "high" | "new" | null

/** Pill colors + label per flag kind. The "New Client" rose-crimson is a distinct
 *  shade from the alert red so the two flags read differently at a glance. */
export const PRIORITY_FLAG_STYLE: Record<
  "high" | "new",
  { bg: string; text: string; label: string }
> = {
  high: { bg: "#FDE7E7", text: "#A32D2D", label: "High Priority" },
  new: { bg: "#FBE9EE", text: "#A83254", label: "New Client" },
}

export function priorityFlagKind(
  row: Pick<LiveOutreachRow, "urgency" | "is_new_client" | "client_status_label">,
): PriorityFlagKind {
  if (row.urgency === "High") return "high"
  if (row.is_new_client) return "new"
  if (row.client_status_label === "At Risk") return "high"
  return null
}
