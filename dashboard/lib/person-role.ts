import type { PersonRole } from "@/lib/types"

// Single source of truth for the trailing-12-month role classification used by
// both the People → Summary page and the People → Statistics "Activity by
// Person" chart. Keeping this here (rather than inline in a page) means the two
// surfaces can never drift apart.
//
// One symmetric ratio over TTM actions (from v_person_role_ttm): fewer than 25
// total actions → unclassified (null); otherwise Host/Booker when that side is
// >= 70% of total actions, else Hybrid.
export const ROLE_MIN_TOTAL = 25
export const ROLE_THRESHOLD = 0.7

export function deriveRole(bookedTtm: number, hostedTtm: number): PersonRole {
  const total = bookedTtm + hostedTtm
  if (total < ROLE_MIN_TOTAL) return null
  const hostedShare = hostedTtm / total
  if (hostedShare >= ROLE_THRESHOLD) return "Host"
  if (hostedShare <= 1 - ROLE_THRESHOLD) return "Booker"
  return "Hybrid"
}

// Shared role palette (pill background + saturated identity/text color) so the
// People → Summary role pills and the People → Statistics group dots match
// exactly. Unclassified has no colored entry — it renders muted on both pages.
export const ROLE_STYLES: Record<
  "Host" | "Booker" | "Hybrid",
  { bg: string; text: string }
> = {
  Host: { bg: "#E2F2EE", text: "#0E7C72" },
  Booker: { bg: "#EAF0FB", text: "#2A3C77" },
  Hybrid: { bg: "#F0EAFB", text: "#5B4B9E" },
}
