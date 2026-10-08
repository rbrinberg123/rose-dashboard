import { STATUS_PILL_LIGHT } from "@/lib/design"

/**
 * The per-report accent colours — Report A / B / C — used wherever a report's
 * part is shown, so the parts look the same across the app: the event drawer's
 * Meetings & Reports panel and the Feedback Reports "Part A/B/C" chip.
 * The IQ status tints, in order.
 */
export const REPORT_ACCENTS = [
  STATUS_PILL_LIGHT.new.text, // A
  STATUS_PILL_LIGHT.positive.text, // B
  STATUS_PILL_LIGHT.watch.text, // C
] as const

/** The accent for report `seq` (tasks.feedback_report_seq: 1 = A, 2 = B, 3 = C). */
export function reportAccent(seq: number): string {
  return REPORT_ACCENTS[(Math.max(1, seq) - 1) % REPORT_ACCENTS.length]
}
