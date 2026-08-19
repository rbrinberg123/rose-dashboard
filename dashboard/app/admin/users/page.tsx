import type { Metadata } from "next"
import Link from "next/link"

import { PageShell } from "@/components/page-shell"
import { buttonVariants } from "@/components/ui/button"
import { getSupabaseServer } from "@/lib/supabase"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { loadIdentity, type PersonResolution } from "@/lib/access/identity"
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
 * Admin → Users — LIVE.
 *
 * Lists every human @roseandco.com person resolved from the `users` mirror
 * (via lib/access/identity) and lets a super-user set each one's role in
 * public.user_role_grants — the live role source that getRealRole reads. A
 * person with no grant ("None") has no role and can reach nothing beyond the
 * always-allowed infra routes.
 *
 * The route lives under /admin, which is itself gated by the Roles matrix
 * (super-user-only in practice).
 */

type Grant = { email: string; role: string }

/** All-deny default when a user has no user_data_scopes row yet. */
const DEFAULT_SCOPES: DataScopes = {
  all: false,
  account_mgmt: false,
  booker: false,
  host: false,
  feedback: false,
  financials: false,
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
  /** Later addition — absent until the ALTER TABLE is run (see docs). */
  financials?: boolean | null
}

/**
 * Read each person's Level-2 data scopes; guard the table not existing yet.
 * LIVE — the same rows getUserScopes reads to enforce (row scoping) and
 * canSeeFinancials reads to gate dollar figures.
 *
 * SELECT * rather than a column list so a database that has not had the
 * `financials` ALTER TABLE run yet still loads (a named missing column would
 * error and silently blank every checkbox).
 */
async function loadScopes(
  sb: ReturnType<typeof getSupabaseServer>,
): Promise<{ scopes: Map<string, DataScopes>; missingTable: boolean }> {
  const { data, error } = await sb.from("user_data_scopes").select("*")
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
      financials: !!s.financials,
    })
  }
  return { scopes, missingTable: false }
}

/** Map the resolver's PersonResolution to the per-row badge Resolution. */
function toBadge(r: PersonResolution): Resolution {
  if (r.state === "resolved") return { state: "resolved", userIds: r.userIds, name: r.name }
  if (r.state === "ambiguous") return { state: "ambiguous", personCount: r.personCount }
  return { state: "no_match" }
}

export default async function UsersRolesPage() {
  const sb = getSupabaseServer()

  const [grantsRes, scopesRes, identity] = await Promise.all([
    loadGrants(sb),
    loadScopes(sb),
    loadIdentity(),
  ])

  const backLink = (
    <div className="mb-4">
      <Link href="/admin" className={buttonVariants({ variant: "outline", size: "sm" })}>
        ← Back
      </Link>
    </div>
  )

  // LOUD resolver-error state — visually distinct from a per-row "No match" so a
  // schema/query fault can never masquerade as "nobody has access".
  if (!identity.ok) {
    return (
      <PageShell title="Users" description="Identity resolver error">
        {backLink}
        <div className="rounded-lg border-2 border-destructive bg-destructive/10 p-4 text-sm">
          <div className="font-semibold text-destructive">
            Identity resolver error — access resolution is unavailable
          </div>
          <p className="mt-1 text-muted-foreground">
            The <code className="font-mono">public.users</code> lookup failed, so no login can be
            resolved to a CRM user. This is a <span className="font-medium">system error</span>, not
            &ldquo;nobody has access&rdquo; — data scopes are failing closed (denying) until it&apos;s
            fixed.
          </p>
          <p className="mt-2 font-mono text-xs text-destructive">{identity.error}</p>
        </div>
      </PageShell>
    )
  }

  const { grants, missingTable } = grantsRes
  const { scopes, missingTable: missingScopesTable } = scopesRes

  // Resolve the LIVE authenticated session email (the real login the app
  // authenticates with — NOT the impersonation-aware effective identity, and
  // NOT a roster row) through the SAME resolver. This is the actual
  // session→user_id path enforcement relies on, which the per-row column can't
  // exercise (the roster is built from the users table itself). Display-only.
  const authClient = await getSupabaseServerAuth()
  const {
    data: { user: sessionUser },
  } = await authClient.auth.getUser()
  const sessionEmail = sessionUser?.email?.trim() || null
  let sessionResolution: SessionResolution = null
  if (sessionEmail) {
    const r = identity.resolve(sessionEmail)
    sessionResolution =
      r.state === "resolved"
        ? { state: "resolved", email: sessionEmail, userIds: r.userIds, name: r.name }
        : r.state === "ambiguous"
          ? { state: "ambiguous", email: sessionEmail, personCount: r.personCount }
          : { state: "no_match", email: sessionEmail }
  }

  // Build the roster from the resolved identity index (humans + tagged service
  // rows; excluded/hashed/non-Rose rows are already dropped). Each row carries
  // its staged role + scopes and its resolution badge.
  const users: UserRow[] = identity.roster.map((entry) => ({
    email: entry.email,
    name: entry.name,
    role: grants.get(entry.email) ?? null,
    scopes: scopes.get(entry.email) ?? DEFAULT_SCOPES,
    service: entry.service,
    resolution: entry.service ? { state: "service" } : toBadge(identity.resolve(entry.email)),
  }))

  return (
    <PageShell
      title="Users"
      description="Live — the role set here controls what each person can access."
    >
      {backLink}
      <UsersView
        users={users}
        missingTable={missingTable}
        missingScopesTable={missingScopesTable}
        sessionResolution={sessionResolution}
      />
    </PageShell>
  )
}
