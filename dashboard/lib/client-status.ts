import {
  FIRM_CATEGORY_LABEL,
  FIRM_CATEGORY_ORDER,
  categoryIndex,
  categoryOf,
  type FirmCategory,
} from "@/lib/client-health-order"
import { STATUS_PILL_LIGHT } from "@/lib/design"
import type { PillVariant } from "@/lib/gradients"

/**
 * CLIENT STATUS — the ONE status a client has anywhere in the app (2026-10-15):
 * the EFFECTIVE Client Health rating, `override_rating ?? ai_rating` from
 * public.client_health_assessments — the final value the Client Health page
 * shows. The views expose it as `health_rating` (v_client_portfolio,
 * v_live_outreach; patch sql/patches/2026-10-15_client_status_from_health.sql).
 *
 * Replaces the retired notes-driven status (latest client_notes.status_text:
 * At Risk / Lost / New Client / Stable / Strong).
 *
 * Built FROM the Client Health constants (lib/client-health-order.ts): the codes
 * and severity order are FIRM_CATEGORY_ORDER, the labels FIRM_CATEGORY_LABEL.
 * Only the colours live here (moved from the Client Health page's RATING_STYLE),
 * so every surface — Client Health included — draws the same pill.
 *
 * Browser-safe: it deliberately does NOT import lib/client-health-prompt.ts,
 * which carries the full AI framework text.
 *
 * Only the CATEGORY is shared with non-super-users; the AI / override notes
 * (the reasoning) stay on the super-user-only Client Health page.
 */

/** Rating codes, most severe first: High Risk → Monitor → Management / IR Change → Healthy. */
export const CLIENT_STATUS_ORDER = FIRM_CATEGORY_ORDER
export type ClientStatus = FirmCategory

/** Label for a client with no Client Health rating yet (sorts last). */
export const NO_RATING_LABEL = "No Rating"

/** Filter / URL sentinel for "No Rating". */
export const NO_RATING = "__none__"

/**
 * Pill variant per category — the app's shared light-pill palette
 * (STATUS_PILL_LIGHT). Was RATING_STYLE on the Client Health page; the masthead
 * pill (Client Detail) takes the variant, everything else the colours below.
 */
export const CLIENT_STATUS_VARIANT: Record<ClientStatus, PillVariant> = {
  "3": "atRisk",
  "2": "watch",
  // Nearest shared variant (amber) for callers that only take a variant; the
  // exact colours are MANAGEMENT_IR_STYLE below.
  "Management / IR Change": "watch",
  "1": "positive",
}
export const NO_RATING_VARIANT: PillVariant = "neutral"

/**
 * Management / IR Change (2026-10-15): a YELLOW-amber in Monitor's family but
 * a distinct shade — lemon fill + olive-gold text, vs Monitor's peach fill +
 * brown-amber text (STATUS_PILL_LIGHT.watch) — so the two read as related yet
 * tellable apart. Text on fill is ~5:1 contrast. Not one of the shared pill
 * variants, so it is defined here; change it in this one place.
 */
export const MANAGEMENT_IR_STYLE = { bg: "#FBF1BF", text: "#7D6200" }

/** Pill colours per category — THE place to recolour a client status app-wide. */
export const CLIENT_STATUS_STYLE: Record<ClientStatus, { bg: string; text: string }> = {
  "3": STATUS_PILL_LIGHT[CLIENT_STATUS_VARIANT["3"]],
  "2": STATUS_PILL_LIGHT[CLIENT_STATUS_VARIANT["2"]],
  "Management / IR Change": MANAGEMENT_IR_STYLE,
  "1": STATUS_PILL_LIGHT[CLIENT_STATUS_VARIANT["1"]],
}
export const NO_RATING_STYLE = STATUS_PILL_LIGHT[NO_RATING_VARIANT]

export function clientStatusVariant(rating: string | null | undefined): PillVariant {
  const c = categoryOf(rating)
  return c ? CLIENT_STATUS_VARIANT[c] : NO_RATING_VARIANT
}

/** The rating as a known category, or null (not rated / unknown value). */
export function clientStatusOf(rating: string | null | undefined): ClientStatus | null {
  return categoryOf(rating)
}

/** Number-free label: "High Risk", …, or "No Rating". */
export function clientStatusLabel(rating: string | null | undefined): string {
  const c = categoryOf(rating)
  return c ? FIRM_CATEGORY_LABEL[c] : NO_RATING_LABEL
}

export function clientStatusStyle(rating: string | null | undefined): { bg: string; text: string } {
  const c = categoryOf(rating)
  return c ? CLIENT_STATUS_STYLE[c] : NO_RATING_STYLE
}

/** Severity rank for sorting, 0 = most severe; No Rating = CLIENT_STATUS_ORDER.length. */
export function clientStatusRank(rating: string | null | undefined): number {
  return categoryIndex(rating)
}

/** The High Risk code — Live Outreach's client-level "High Priority" trigger. */
export const HIGH_RISK: ClientStatus = "3"
