// THE Event Summary derivation for Live Outreach, shared by the page
// (live-outreach-view.tsx) and the email (email-html.ts) so the two can never
// disagree about which events appear, in what order, or with what numbers.
//
// This is data only — no markup. The email renders it as Outlook-safe nested
// tables; the page renders it with normal components. Both consume the same
// array, in the same order, so a change here lands in both at once.
//
// Ordering is NOT decided here: `rows` arrives already sorted by the tiered
// order in app/live-outreach/load.ts, and `index` is simply each event's
// 1-based position in that array — which is what makes the summary line numbers
// match the numbered detail cards below them.
import type { LiveOutreachRow } from "@/lib/types"
import { priorityFlagKind, type PriorityFlagKind } from "./priority-flag"

/** Show only the base ticker, dropping an exchange/country qualifier such as
 *  "NVCR US", "SGO:FP", or "STVL-LN". Share-class dots (e.g. "BRK.B") are kept.
 *  Same logic as the Feedback email's baseTicker(). */
export function baseTicker(t: string): string {
  return t.trim().split(/[\s:]/)[0].replace(/-[A-Za-z]{1,4}$/, "")
}

/** Trim free-text dates to a single line, ellipsizing what doesn't fit. The hard
 *  guard for Outlook, which ignores CSS text-overflow; the page passes a longer
 *  budget because it has the width. */
export function truncateDates(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s
}

/** Below this many remaining slots, Open renders as an alert (red + bold in the
 *  email, red on the page). Overbooked events clamp to 0 and so are covered. */
const TIGHT_SLOTS = 2

export type LiveOutreachSummaryRow = {
  /** 1-based position in the sorted rows — matches the numbered detail cards. */
  index: number
  eventId: string
  /** Base ticker, or null when the event has none. */
  ticker: string | null
  /** Client name, for the page (the email's narrow columns show ticker only). */
  name: string | null
  flag: PriorityFlagKind
  confirmed: number
  /** Remaining slots, clamped at 0; null when unknown. */
  open: number | null
  /** True when `open` is at or below the alert threshold. */
  openTight: boolean
  /** Raw free-text dates; each renderer truncates to its own width. */
  dates: string | null
}

/** One summary line per event, in the order given. */
export function buildLiveOutreachSummary(
  rows: LiveOutreachRow[],
): LiveOutreachSummaryRow[] {
  return rows.map((row, i) => {
    const remaining = row.slots_remaining
    return {
      index: i + 1,
      eventId: row.event_id,
      ticker: row.ticker ? baseTicker(row.ticker) : null,
      name: row.client_account_name ?? row.event_name ?? null,
      flag: priorityFlagKind(row),
      confirmed: row.confirmed_meeting_count ?? 0,
      open: remaining == null ? null : Math.max(0, remaining),
      openTight: remaining != null && remaining <= TIGHT_SLOTS,
      dates: row.event_dates ?? null,
    }
  })
}

/** The roll-up the page subtitle and the email header both print. */
export function liveOutreachTotals(rows: LiveOutreachRow[]): {
  events: number
  meetings: number
} {
  return {
    events: rows.length,
    meetings: rows.reduce((s, r) => s + (r.confirmed_meeting_count ?? 0), 0),
  }
}
