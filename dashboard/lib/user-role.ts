import { getSupabaseServer } from "@/lib/supabase"
import type { Role } from "@/lib/access-control"

/**
 * Look up a signed-in user's role from the user_roles table.
 *
 * SERVER-ONLY: uses the service_role client (bypasses RLS — the table has
 * RLS on with no policies, so this is the only way to read it). Never import
 * this into a Client Component; the role for the nav is passed down from the
 * server layout instead.
 *
 * Returns 'super_user' | 'user', or null when the email is absent, not in
 * the table, or holds an unexpected value — all of which mean "no access"
 * under the deny-by-default model.
 */
export async function getUserRole(
  email: string | null | undefined,
): Promise<Role | null> {
  if (!email) return null

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("user_roles")
    .select("role")
    // Emails are stored lower-cased (enforced by a DB trigger); match that.
    .eq("email", email.toLowerCase())
    .maybeSingle()

  if (error || !data) return null
  return data.role === "super_user" || data.role === "user" ? data.role : null
}
