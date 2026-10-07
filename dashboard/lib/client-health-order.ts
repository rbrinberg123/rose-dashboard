/**
 * PURE "Firm order" for Client Health — no I/O, unit-tested by
 * client-health-order.test.ts.
 *
 * The firm-standard view is a two-level sort everyone shares:
 *   1. a FIXED category order by EFFECTIVE rating (override else AI) — not
 *      user-sortable;
 *   2. manual_rank within the category (one firm-wide order a super-user sets by
 *      dragging), unranked (NULL) last, then client name.
 *
 * Category = the effective rating value itself. The values mirror
 * HEALTH_RATINGS in client-health-prompt.ts (whose RATING_SEVERITY uses this
 * same order — the test checks they agree).
 */

/** High risk → Monitor → Management / IR Change → Healthy. */
export const FIRM_CATEGORY_ORDER = ["3", "2", "Management / IR Change", "1"] as const
export type FirmCategory = (typeof FIRM_CATEGORY_ORDER)[number]

/** Section heading for each category. */
export const FIRM_CATEGORY_LABEL: Record<FirmCategory, string> = {
  "3": "High risk",
  "2": "Monitor",
  "Management / IR Change": "Management / IR Change",
  "1": "Healthy",
}

export function isFirmCategory(v: unknown): v is FirmCategory {
  return typeof v === "string" && (FIRM_CATEGORY_ORDER as readonly string[]).includes(v)
}

/** The category an effective rating falls in; null = not rated (own bottom section, never ranked). */
export function categoryOf(effectiveRating: string | null | undefined): FirmCategory | null {
  return isFirmCategory(effectiveRating) ? effectiveRating : null
}

/** 0-based position of a category; unrated sorts after every category. */
export function categoryIndex(effectiveRating: string | null | undefined): number {
  const c = categoryOf(effectiveRating)
  return c === null ? FIRM_CATEGORY_ORDER.length : FIRM_CATEGORY_ORDER.indexOf(c)
}

export type FirmOrderRow = { effectiveRating: string | null; manualRank: number | null; clientName: string }

/** ORDER BY category, manual_rank ASC NULLS LAST, client_name ASC. */
export function compareFirmOrder(a: FirmOrderRow, b: FirmOrderRow): number {
  const c = categoryIndex(a.effectiveRating) - categoryIndex(b.effectiveRating)
  if (c !== 0) return c
  if (a.manualRank !== b.manualRank) {
    if (a.manualRank === null) return 1
    if (b.manualRank === null) return -1
    return a.manualRank - b.manualRank
  }
  return a.clientName.localeCompare(b.clientName)
}

/**
 * Should a change of effective rating clear manual_rank? Yes when the client
 * lands in a different category (incl. to / from "not rated") — it drops to
 * the bottom of its new category, visibly awaiting placement.
 */
export function categoryChanged(before: string | null | undefined, after: string | null | undefined): boolean {
  return categoryOf(before) !== categoryOf(after)
}

/** Move `id` to `toIndex` within `ids` (a category's current order). */
export function moveWithin(ids: readonly string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id)
  if (from === -1) return [...ids]
  const next = ids.filter((x) => x !== id)
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, id)
  return next
}
