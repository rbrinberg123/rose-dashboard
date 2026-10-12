/**
 * The Onboarding page ↔ touchpoints two-way link — the client-safe constants.
 * Server actions: app/onboarding/actions.ts. View rule: sql/patches/
 * 2026-10-12c_onboarding_touchpoint_dates.sql. Docs: content/docs/02-pages.md
 * "Onboarding ↔ touchpoints".
 *
 * Two onboarding steps are backed by touchpoints of a matching TYPE. The view
 * shows the date of the most-recently-ENTERED touchpoint of that type
 * (created_on DESC), falling back to the stored account date.
 */

import { TOUCH_TYPE_OPTIONS } from "@/lib/touchpoints/create"

export type OnboardingTouchKind = "onboarding_call" | "teach_in"

const code = (label: string) => {
  const hit = TOUCH_TYPE_OPTIONS.find((o) => o.label === label)
  if (!hit) throw new Error(`Touchpoint type "${label}" is missing from TOUCH_TYPE_OPTIONS`)
  return hit.code
}

/**
 * `label` is matched EXACTLY against touchpoints.touchpoint_type_label — the
 * same strings the view uses. Note the lower-case "i" in "Teach-in".
 */
export const ONBOARDING_TOUCH_KINDS: Record<
  OnboardingTouchKind,
  { label: "Onboarding Call" | "Teach-in"; code: string }
> = {
  onboarding_call: { label: "Onboarding Call", code: code("Onboarding Call") },
  teach_in: { label: "Teach-in", code: code("Teach-in") },
}

/** The only touchpoint type codes the onboarding path may create or edit. */
export const ONBOARDING_TOUCH_TYPE_CODES: readonly string[] = Object.values(ONBOARDING_TOUCH_KINDS).map((k) => k.code)

/** The only type labels it may load. */
export const ONBOARDING_TOUCH_TYPE_LABELS: readonly string[] = Object.values(ONBOARDING_TOUCH_KINDS).map((k) => k.label)

export function isOnboardingTouchKind(v: unknown): v is OnboardingTouchKind {
  return v === "onboarding_call" || v === "teach_in"
}
