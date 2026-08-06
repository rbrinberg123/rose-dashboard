import type { Metadata } from "next"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { UsersView, type UserRow, type RoleValue } from "./users-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Users & Roles" }

/*
 * Admin → Users & Roles — a STAGING screen only.
 *
 * Lists every active @roseandco.com person from the `users` mirror (Dynamics
 * system users) and lets a super-user stage a role for each into the DECOUPLED
 * public.user_role_grants table. This page and its action write ONLY to that
 * staging table — they never touch the live `user_roles` table, proxy.ts,
 * canAccessRoute, or getUserRole. Assignments made here have ZERO effect on
 * what anyone can actually access. Going live is a separate, later change that
 * points enforcement at user_role_grants.
 *
 * The route lives under /admin (super-user-only by the deny-by-default rule)
 * and is intentionally kept OUT of USER_ALLOWED_ROUTES.
 */

const DOMAIN = "@roseandco.com"

type MirrorUser = { display_name: string | null; email: string | null }
type Grant = { email: string; role: string }

/** Read staged grants; guard the table not existing yet (DDL run manually). */
async function loadGrants(
  sb: ReturnType<typeof getSupabaseServer>,
): Promise<{ grants: Map<string, RoleValue>; missingTable: boolean }> {
  const { data, error } = await sb.from("user_role_grants").select("email, role")
  if (error) {
    // 42P01 = undefined_table. Treat "table not created yet" as an empty,
    // non-fatal state so the roster still renders with everyone at None.
    const missingTable = error.code === "42P01" || /does not exist/i.test(error.message)
    return { grants: new Map(), missingTable }
  }
  const grants = new Map<string, RoleValue>()
  for (const g of (data ?? []) as Grant[]) {
    grants.set(g.email.toLowerCase(), g.role as RoleValue)
  }
  return { grants, missingTable: false }
}

export default async function UsersRolesPage() {
  const sb = getSupabaseServer()

  const [usersRes, grantsRes] = await Promise.all([
    sb
      .from("users")
      .select("display_name, email")
      .eq("is_active", true)
      .ilike("email", `%${DOMAIN}`)
      .order("display_name", { ascending: true }),
    loadGrants(sb),
  ])

  if (usersRes.error) {
    return (
      <PageShell title="Users & Roles" description="Stage a role for each staff member">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load users</div>
          <div className="mt-1 text-muted-foreground">{usersRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const { grants, missingTable } = grantsRes

  // Build the roster: one row per active @roseandco.com user with a real
  // mailbox, deduped by lower-cased email, current staged role attached.
  const seen = new Set<string>()
  const users: UserRow[] = []
  for (const u of (usersRes.data ?? []) as MirrorUser[]) {
    const email = u.email?.trim()
    if (!email) continue
    const key = email.toLowerCase()
    if (!key.endsWith(DOMAIN) || seen.has(key)) continue
    seen.add(key)
    users.push({
      email,
      name: u.display_name?.trim() || email,
      role: grants.get(key) ?? null,
    })
  }
  users.sort((a, b) => a.name.localeCompare(b.name))

  return (
    <PageShell
      title="Users & Roles"
      description="Staging only — assignments here do not affect real access yet."
    >
      <UsersView users={users} missingTable={missingTable} />
    </PageShell>
  )
}
