import type { Metadata } from "next"
import Link from "next/link"

import { PageShell } from "@/components/page-shell"
import { buttonVariants } from "@/components/ui/button"
import { getSupabaseServer } from "@/lib/supabase"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import {
  UsersView,
  type UserRow,
  type RoleValue,
  type Resolution,
  type SessionResolution,
} from "./users-view"
import type { DataScopes } from "./actions"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Users" }

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

type IdentityRow = {
  user_id: string
  display_name: string | null
  email: string | null
  internalemailaddress: string | null
}

/**
 * DISPLAY-ONLY identity-mapping index for the "Resolves?" indicator.
 *
 * Builds normalized-login-email → the DISTINCT `users` rows (by user_id) it maps
 * to, matching case-insensitively + trimmed against BOTH `users.email` and
 * `users.internalemailaddress`. This is the same email→user_id mapping every
 * relationship-based data scope will rely on, surfaced here as a pre-flight
 * check. It reads nothing into enforcement, proxy.ts, canAccessRoute, or any
 * loader gating — it only powers a badge.
 *
 * Fails soft: on error returns an empty index (badges show "No match") rather
 * than crashing the page.
 */
async function loadIdentityIndex(
  sb: ReturnType<typeof getSupabaseServer>,
): Promise<Map<string, { userId: string; name: string }[]>> {
  const index = new Map<string, { userId: string; name: string }[]>()
  const { data, error } = await sb
    .from("users")
    .select("user_id, display_name, email, internalemailaddress")
  if (error) return index
  for (const u of (data ?? []) as IdentityRow[]) {
    const entry = {
      userId: u.user_id,
      name: u.display_name?.trim() || u.email?.trim() || u.user_id,
    }
    for (const raw of [u.email, u.internalemailaddress]) {
      const k = raw?.trim().toLowerCase()
      if (!k) continue
      const list = index.get(k) ?? []
      // Count each users row ONCE per email key (email may equal
      // internalemailaddress) — dedupe by user_id so that isn't a false dup.
      if (!list.some((x) => x.userId === entry.userId)) list.push(entry)
      index.set(k, list)
    }
  }
  return index
}

export default async function UsersRolesPage() {
  const sb = getSupabaseServer()

  const [usersRes, grantsRes, scopesRes, identityIndex] = await Promise.all([
    sb
      .from("users")
      .select("display_name, email")
      .eq("is_active", true)
      .ilike("email", `%${DOMAIN}`)
      .order("display_name", { ascending: true }),
    loadGrants(sb),
    loadScopes(sb),
    loadIdentityIndex(sb),
  ])

  if (usersRes.error) {
    return (
      <PageShell title="Users" description="Stage a role for each staff member">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load users</div>
          <div className="mt-1 text-muted-foreground">{usersRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  const { grants, missingTable } = grantsRes
  const { scopes, missingTable: missingScopesTable } = scopesRes

  // Resolve the LIVE authenticated session email (the real login the app
  // authenticates with — NOT the impersonation-aware effective identity, and
  // NOT a roster row) through the SAME normalized index. This is the actual
  // session→user_id path enforcement relies on, which the per-row column can't
  // exercise (the roster is built from the users table itself). Display-only.
  const authClient = await getSupabaseServerAuth()
  const {
    data: { user: sessionUser },
  } = await authClient.auth.getUser()
  const sessionEmail = sessionUser?.email?.trim() || null
  let sessionResolution: SessionResolution = null
  if (sessionEmail) {
    const m = identityIndex.get(sessionEmail.toLowerCase()) ?? []
    sessionResolution =
      m.length === 1
        ? { state: "resolved", email: sessionEmail, userId: m[0].userId, name: m[0].name }
        : m.length === 0
          ? { state: "no_match", email: sessionEmail }
          : { state: "duplicate", email: sessionEmail, count: m.length }
  }

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

    // Identity-mapping check (display-only): does this login email resolve to
    // exactly one CRM users row?
    const matches = identityIndex.get(key) ?? []
    const resolution: Resolution =
      matches.length === 1
        ? { state: "resolved", userId: matches[0].userId, name: matches[0].name }
        : matches.length === 0
          ? { state: "no_match" }
          : { state: "duplicate", count: matches.length }

    users.push({
      email,
      name: u.display_name?.trim() || email,
      role: grants.get(key) ?? null,
      scopes: scopes.get(key) ?? DEFAULT_SCOPES,
      resolution,
    })
  }
  users.sort((a, b) => a.name.localeCompare(b.name))

  return (
    <PageShell
      title="Users"
      description="Live — the role set here controls what each person can access."
    >
      <div className="mb-4">
        <Link
          href="/admin"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          ← Back
        </Link>
      </div>
      <UsersView
        users={users}
        missingTable={missingTable}
        missingScopesTable={missingScopesTable}
        sessionResolution={sessionResolution}
      />
    </PageShell>
  )
}
