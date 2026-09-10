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
 * How long a built map is reused before it is rebuilt from the database.
 *
 * The directory only changes when the Dynamics sync rewrites `accounts`, which
 * runs every 10 minutes on weekdays, so a 5-minute window never shows initials
 * more than one sync behind. Worst case is a newly-added colleague's avatar
 * disambiguating a few minutes late.
 */
const TTL_MS = 5 * 60 * 1000

/**
 * Process-level cache of the built map.
 *
 * ── WHY A PROCESS CACHE IS SAFE *HERE* ─────────────────────────────────────
 * This is the ONE thing in the identity area that may outlive a request, and
 * only because it contains no per-user data and takes no per-user input:
 * `loadTeamInitialsMap()` takes no arguments and returns the same global
 * name → initials directory for every viewer. It is a display detail on an
 * avatar, not a permission, a scope, or a row filter.
 *
 * Everything that DOES vary per user — role, data scopes, identity, allowed
 * routes — is memoised per REQUEST with React's `cache()` instead, and must
 * never be moved to a cache like this one. See lib/user-role.ts.
 */
let cached: { map: Record<string, string>; at: number } | null = null

/**
 * Build the map from the account-team directory. Fail-soft: on any error it
 * returns an empty map, so avatars simply fall back to plain two-letter
 * initials — never a broken page.
 *
 * Served from the process cache when fresh. A failed rebuild is NOT cached, so
 * a transient database error retries on the next call rather than pinning an
 * empty map for the whole TTL.
 */
export async function loadTeamInitialsMap(): Promise<Record<string, string>> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.map
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
    const map = buildInitialsMap(names)
    cached = { map, at: Date.now() }
    return map
  } catch (e) {
    console.error("[team-initials] unexpected error building initials map:", e)
    return {}
  }
}
