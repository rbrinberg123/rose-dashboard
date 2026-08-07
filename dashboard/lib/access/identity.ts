import { getSupabaseServer } from "@/lib/supabase"
import { fromUsersQuery, type IdentityData, type UsersRow } from "./identity-index"

export type { IdentityData, PersonResolution, RosterEntry } from "./identity-index"

/**
 * Load the identity index from `public.users` (active rows) — the single source
 * for both the Admin → Users roster/badges and the data-scope resolver.
 *
 * Selects `email` ONLY (no `internalemailaddress` — that column does not exist
 * on public.users; matching it silently errored and denied everyone). On a query
 * error it logs at ERROR level and returns `{ ok: false }` so callers surface a
 * LOUD "resolver error" state — a schema/query fault must never again masquerade
 * as a silent, index-wide "no access".
 */
export async function loadIdentity(): Promise<IdentityData> {
  const sb = getSupabaseServer()
  const res = await sb
    .from("users")
    .select("user_id, display_name, email")
    .eq("is_active", true)
  if (res.error) {
    console.error(
      "[identity] public.users lookup failed — identity resolution unavailable; access is fail-closed until fixed:",
      res.error.message,
    )
  }
  return fromUsersQuery(res as { data: UsersRow[] | null; error: { message: string } | null })
}
