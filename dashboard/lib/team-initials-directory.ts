import { getSupabaseServer } from "@/lib/supabase"
import { buildInitialsMap } from "@/lib/team-initials"

/**
 * Loads the GLOBAL account-team initials map (see `lib/team-initials.ts`).
 *
 * The four roles rendered as avatar circles (Account mgr / Secondary / Associate
 * / Logistics on Portfolio, Onboarding, and Profiles) all draw from these
 * `accounts` columns. Their distinct member names across ALL accounts are the
 * directory over which same-initial collisions are resolved — so a given person
 * disambiguates the same way on every team/page, not just within one circle.
 */
const TEAM_NAME_COLUMNS = [
  "sales_lead_primary_name",
  "secondary_manager_name",
  "associate_name",
  "logistics_coordinator_name",
] as const

/**
 * Build the map from the account-team directory. Fail-soft: on any error it
 * returns an empty map, so avatars simply fall back to plain two-letter
 * initials — never a broken page.
 */
export async function loadTeamInitialsMap(): Promise<Record<string, string>> {
  try {
    const sb = getSupabaseServer()
    const res = await sb.from("accounts").select(TEAM_NAME_COLUMNS.join(", "))
    if (res.error) {
      console.error("[team-initials] accounts lookup failed:", res.error.message)
      return {}
    }
    const names: string[] = []
    const rows = (res.data ?? []) as unknown as Record<string, unknown>[]
    for (const r of rows) {
      for (const col of TEAM_NAME_COLUMNS) {
        const v = r[col]
        if (typeof v === "string" && v.trim()) names.push(v)
      }
    }
    return buildInitialsMap(names)
  } catch (e) {
    console.error("[team-initials] unexpected error building initials map:", e)
    return {}
  }
}
