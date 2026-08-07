import type { Metadata } from "next"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { UsersView, type UserRow, type RoleValue } from "./users-view"
import type { DataScopes } from "./actions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Users & Roles" }

/*
 * Admin → Users & Roles — LIVE.
 *
 * Lists every active @roseandco.com person from the `users` mirror (Dynamics
 * system users) and lets a super-user set each one's role in
 * public.user_role_grants — the live role source that getRealRole reads. A
 * person with no grant ("None") has no role and can reach nothing beyond the
 * always-allowed infra routes.
 *
 * The route lives under /admin, which is itself gated by the Roles matrix
 * (super-user-only in practice).
 */

const DOMAIN = "@roseandco.com"

type MirrorUser = { display_name: string | null; email: string | null }
type Grant = { email: string; role: string }

/** All-deny default when a user has no user_data_scopes row yet. */
const DEFAULT_SCOPES: DataScopes = {
  all: false,
  account_mgmt: false,
  booker: false,
  host: false,
  feedback: false,
}

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

type ScopeRow = {
  email: string
  scope_all: boolean
  account_mgmt: boolean
  booker: boolean
  host: boolean
  feedback: boolean
}

/**
 * Read staged Level-2 data scopes; guard the table not existing yet. STAGING
 * ONLY — these values are recorded for the future Phase-3 enforcement and are
 * read by nothing else.
 */
async function loadScopes(
  sb: ReturnType<typeof getSupabaseServer>,
): Promise<{ scopes: Map<string, DataScopes>; missingTable: boolean }> {
  const { data, error } = await sb
    .from("user_data_scopes")
    .select("email, scope_all, account_mgmt, booker, host, feedback")
  if (error) {
    const missingTable = error.code === "42P01" || /does not exist/i.test(error.message)
    return { scopes: new Map(), missingTable }
  }
  const scopes = new Map<string, DataScopes>()
  for (const s of (data ?? []) as ScopeRow[]) {
    scopes.set(s.email.toLowerCase(), {
      all: s.scope_all,
      account_mgmt: s.account_mgmt,
      booker: s.booker,
      host: s.host,
      feedback: s.feedback,
    })
  }
  return { scopes, missingTable: false }
}

export default async function UsersRolesPage() {
  const sb = getSupabaseServer()

  const [usersRes, grantsRes, scopesRes] = await Promise.all([
    sb
      .from("users")
      .select("display_name, email")
      .eq("is_active", true)
      .ilike("email", `%${DOMAIN}`)
      .order("display_name", { ascending: true }),
    loadGrants(sb),
    loadScopes(sb),
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
  const { scopes, missingTable: missingScopesTable } = scopesRes

  // Build the roster: one row per active @roseandco.com user with a real
  // mailbox, deduped by lower-cased email, current staged role + scopes attached.
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
      scopes: scopes.get(key) ?? DEFAULT_SCOPES,
    })
  }
  users.sort((a, b) => a.name.localeCompare(b.name))

  return (
    <PageShell
      title="Users & Roles"
      description="Live — the role set here controls what each person can access."
    >
      <UsersView
        users={users}
        missingTable={missingTable}
        missingScopesTable={missingScopesTable}
      />
    </PageShell>
  )
}
