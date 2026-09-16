import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { buildIdentityIndex } from "@/lib/access/identity-index"
import {
  isAccountTeamRole,
  type AccountTeamAssignment,
  type RosterPerson,
} from "@/lib/account-teams/roles"
import { toAccountStatusSource, type AccountStatus } from "@/lib/account-teams/status"
import { AccountTeamsView, type AccountOption, type PersonLookup } from "./account-teams-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Account Teams" }

const PATCH = "sql/patches/2026-09-15_account_team_members.sql"
const STATUS_PATCH = "sql/patches/2026-09-15b_account_status.sql"

/**
 * Admin → Account Teams. The one place the account team is managed going
 * forward.
 *
 * ⚠️  SETUP ONLY — THIS PAGE CHANGES NO EXISTING BEHAVIOUR.
 * `public.account_team_members` is read and written by this page and its
 * ./actions.ts, and by nothing else. It is deliberately NOT wired into
 * `teamAccountIds`, `resolveClientScope`, `lib/access/*`, `lib/account-team.ts`
 * or any CRM or reporting page. The account-team avatar clusters on Portfolio,
 * Profiles and the Events table still read the four `*_name` columns straight
 * off `public.accounts`, exactly as before. Editing a team here affects THIS
 * PAGE ONLY.
 *
 * The table is intended to become the source of truth for account-team-based
 * visibility later; that is a separate, deliberate change. See the header of
 * lib/account-teams/roles.ts.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * Reads use the service-role client (RLS bypassed) and the table carries no
 * policies, so a successful load is fully privileged. Three gates:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and
 *      /admin/account-teams is in ADMIN_ONLY_ROUTES — super-user-only, and NOT
 *      openable through the Admin → Roles matrix.
 *   2. The check below re-verifies the role in the page itself.
 *   3. Every server action in ./actions.ts re-checks independently.
 *
 * The READ gate uses the EFFECTIVE role, so a super-user using "View as"
 * previews the denial as the impersonated person would see it. The WRITE gate
 * in ./actions.ts uses the REAL role (`requireSuperUser`) — previewing must not
 * be able to save, and the real identity is what gets stamped into updated_by.
 * That asymmetry is deliberate and matches the CRM pages' `readOnlyViews`.
 */
export default async function AccountTeamsPage() {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sb = getSupabaseServer()

  // Everything at once. The whole dataset is tiny — 228 accounts, ~801
  // assignments, ~50 people — so the client gets the lot and switching between
  // clients is instant with no round-trip. There is no pagination to design and
  // no per-selection fetch to keep in sync.
  const [accountsRes, membersRes, usersRes, identity, statusRes] = await Promise.all([
    sb.from("accounts").select("account_id, name, ticker_symbol").order("name"),
    sb
      .from("account_team_members")
      .select("id, account_id, role, user_id, source, updated_at, updated_by"),
    sb.from("users").select("user_id, display_name, email, is_active"),
    getEffectiveIdentity(),
    // The OWNED Active/Inactive flag. Setup only — nothing else reads it, and it
    // is NOT accounts.state_label, which is what every existing filter still
    // uses. See lib/account-teams/status.ts.
    sb.from("account_status").select("account_id, is_active, source, changed_at, changed_by"),
  ])

  if (accountsRes.error) {
    return (
      <PageShell title="Account Teams">
        <ErrorCard title="Could not load accounts" message={accountsRes.error.message} />
      </PageShell>
    )
  }
  if (usersRes.error) {
    return (
      <PageShell title="Account Teams">
        <ErrorCard title="Could not load users" message={usersRes.error.message} />
      </PageShell>
    )
  }

  // The table may not exist yet — the patch is run by hand. Treat that as an
  // empty, non-fatal state so the page still renders and says what to run,
  // rather than 500ing. Same fail-soft the Users page uses for user_role_grants.
  const tableMissing =
    !!membersRes.error &&
    (membersRes.error.code === "42P01" || /does not exist/i.test(membersRes.error.message))
  if (membersRes.error && !tableMissing) {
    return (
      <PageShell title="Account Teams">
        <ErrorCard
          title="Could not load account_team_members"
          message={membersRes.error.message}
        />
      </PageShell>
    )
  }

  // Same fail-soft as account_team_members: the patch is run by hand, so a
  // missing table renders every client as "Not set" rather than 500ing.
  const statusTableMissing =
    !!statusRes.error &&
    (statusRes.error.code === "42P01" || /does not exist/i.test(statusRes.error.message))
  if (statusRes.error && !statusTableMissing) {
    return (
      <PageShell title="Account Teams">
        <ErrorCard title="Could not load account_status" message={statusRes.error.message} />
      </PageShell>
    )
  }

  const statuses: Record<string, AccountStatus> = {}
  for (const r of (statusRes.data ?? []) as {
    account_id: string
    is_active: boolean
    source: string
    changed_at: string | null
    changed_by: string | null
  }[]) {
    statuses[r.account_id] = {
      accountId: r.account_id,
      isActive: r.is_active,
      source: toAccountStatusSource(r.source),
      changedAt: r.changed_at,
      changedBy: r.changed_by,
    }
  }

  const userRows = (usersRes.data ?? []) as {
    user_id: string
    display_name: string | null
    email: string | null
    is_active: boolean | null
  }[]

  /**
   * Names for EVERY user id, active or not — the drawer must be able to render
   * a seeded assignee who has since been deactivated (38 rows are like this).
   * The roster below is the narrower set that may be newly assigned.
   */
  const people: PersonLookup = {}
  for (const u of userRows) {
    people[u.user_id] = {
      name: u.display_name?.trim() || u.email || "(unknown)",
      email: u.email ?? null,
      active: u.is_active === true,
    }
  }

  /**
   * The assignable roster: ACTIVE, @roseandco.com, real humans.
   *
   * `buildIdentityIndex` is reused READ-ONLY from lib/access/identity-index.ts —
   * it already encodes which rows are people (dropping non-Rose domains and
   * hash-prefixed disabled rows, tagging shared mailboxes as `service`).
   * Importing it changes nothing about how it behaves elsewhere.
   */
  const index = buildIdentityIndex(userRows.filter((u) => u.is_active === true))
  const roster: RosterPerson[] = index.roster
    .filter((r) => !r.service)
    .map((r) => ({ userId: r.userId, name: r.name, email: r.email, active: true }))

  const assignments: AccountTeamAssignment[] = ((membersRes.data ?? []) as {
    id: string
    account_id: string
    role: string
    user_id: string
    source: string
    updated_at: string | null
    updated_by: string | null
  }[]).flatMap((r) =>
    isAccountTeamRole(r.role)
      ? [
          {
            id: r.id,
            accountId: r.account_id,
            role: r.role,
            userId: r.user_id,
            source: r.source === "crm_seed" ? ("crm_seed" as const) : ("manual" as const),
            updatedAt: r.updated_at,
            updatedBy: r.updated_by,
          },
        ]
      : [],
  )

  const accounts: AccountOption[] = ((accountsRes.data ?? []) as {
    account_id: string
    name: string | null
    ticker_symbol: string | null
  }[]).map((a) => ({
    accountId: a.account_id,
    name: a.name ?? "(unnamed)",
    ticker: a.ticker_symbol,
  }))

  return (
    <PageShell title="Account Teams" hideHeader canvas>
      <AccountTeamsView
        accounts={accounts}
        assignments={assignments}
        people={people}
        roster={roster}
        tableMissing={tableMissing}
        patchPath={PATCH}
        statuses={statuses}
        statusTableMissing={statusTableMissing}
        statusPatchPath={STATUS_PATCH}
        /* Writes are refused while impersonating — the action's requireSuperUser
           resolves the REAL role. Hide the controls rather than offer a doomed
           click, matching the CRM pages. */
        readOnly={identity.impersonated}
      />
    </PageShell>
  )
}

function ErrorCard({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <div className="font-medium text-destructive">{title}</div>
      <div className="mt-1 text-muted-foreground">{message}</div>
    </div>
  )
}
