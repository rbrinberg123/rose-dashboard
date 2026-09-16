"use server"

/**
 * Account Team management — the write path.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function re-checks super_user via `requireSuperUser()` before it builds
 * a query. `account_team_members` is read and written with the service-role key
 * (RLS bypassed, zero policies on the table), so a successful call is fully
 * privileged. The page gate and the proxy gate are not enough on their own: a
 * server action is its own entry point and can be invoked directly.
 *
 * `requireSuperUser` resolves the REAL role, not the effective one — the same
 * guard admin/users and the admin API routes use. That is deliberate for a
 * WRITE path: a super-user previewing the app through "View as" should not be
 * able to save, and the real identity is what gets stamped into updated_by.
 *
 * ══ SCOPE ══════════════════════════════════════════════════════════════════
 * This file is the ONLY writer of public.account_team_members, and
 * /admin/account-teams is its only reader. Nothing here is imported by any
 * scope, permission or visibility code, and nothing here changes the behaviour
 * of any existing page. See the header of lib/account-teams/roles.ts.
 *
 * ══ VALIDATION — FAIL LOUD ═════════════════════════════════════════════════
 * Every write validates, server-side, against the database rather than
 * trusting the client:
 *   * `role`       must be one of the six (checked here AND by a CHECK constraint)
 *   * `accountId`  must exist in public.accounts
 *   * `userId`     must be an ACTIVE, non-service, @roseandco.com person
 *   * the actor's email is stamped into created_by / updated_by
 * A failed check returns a `fail(...)` with the reason; nothing is written.
 */

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { requireSuperUser } from "@/lib/api-auth"
import { buildIdentityIndex } from "@/lib/access/identity-index"
import { diffRows, recordAudit, snapshot } from "@/lib/audit"
import {
  isAccountTeamRole,
  type AccountTeamAssignment,
  type RosterPerson,
} from "@/lib/account-teams/roles"

const PATH = "/admin/account-teams"
const TABLE = "account_team_members"

/* ------------------------------------------------------------------ roster */

/**
 * The people offerable in the role dropdowns: ACTIVE, `@roseandco.com`, real
 * humans.
 *
 * Reuses `buildIdentityIndex` from lib/access/identity-index.ts READ-ONLY —
 * that module is pure and already encodes the firm's rules for what counts as a
 * person: it drops non-Rose domains and Dynamics-disabled rows whose local-part
 * is a 32-hex hash, and TAGS shared mailboxes (`conference*`, `ga`,
 * `corporateaccess`, `dmgsupport`, `externaldev`, `#`-prefixed names) as
 * `service`. Re-deriving that here would be a second copy of a rule that must
 * not drift. Importing it changes nothing about how it behaves elsewhere.
 *
 * `is_active` is applied in the QUERY rather than by the index, which does not
 * model it. Of the 50 active @roseandco.com rows, the index drops the five
 * service mailboxes, leaving the real employee list.
 *
 * NOTE the roster dedupes by EMAIL, so the three people with two mailboxes each
 * (Blair Mutschler, Brian Smith, Simon Rose) appear twice. That is correct —
 * they are two distinct `user_id`s and either may be the one the CRM used — so
 * the UI shows the email alongside a duplicated name to tell them apart.
 */
export async function loadRoster(): Promise<ActionResult<RosterPerson[]>> {
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorised.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("users")
    .select("user_id, display_name, email")
    .eq("is_active", true)

  if (error) return fail(describeError(error))

  const index = buildIdentityIndex(data ?? [])
  return ok(
    index.roster
      .filter((r) => !r.service)
      .map((r) => ({ userId: r.userId, name: r.name, email: r.email, active: true })),
  )
}

/* ------------------------------------------------------------- assignments */

type MemberRow = {
  id: string
  account_id: string
  role: string
  user_id: string
  source: string
  updated_at: string | null
  updated_by: string | null
}

/**
 * Every assignment for one account.
 *
 * Returns rows for people who are no longer active too — see the note on
 * `RosterPerson.active`. Hiding them would make a real assignment look empty.
 */
export async function loadAccountTeam(
  accountId: string,
): Promise<ActionResult<AccountTeamAssignment[]>> {
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorised.")
  if (!accountId) return fail("No account id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(TABLE)
    .select("id, account_id, role, user_id, source, updated_at, updated_by")
    .eq("account_id", accountId)

  if (error) return fail(describeError(error))

  return ok(
    ((data ?? []) as MemberRow[]).flatMap((r) =>
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
    ),
  )
}

/* ------------------------------------------------------------------ writes */

/** Shared validation for both write paths. Returns the actor's email, or an error. */
async function guard(
  accountId: string,
  role: string,
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const auth = await requireSuperUser()
  if (!auth.ok) return { ok: false, error: "Not authorised." }

  if (!isAccountTeamRole(role)) return { ok: false, error: `Invalid role: ${role}` }
  if (!accountId) return { ok: false, error: "No account id." }

  const sb = getSupabaseServer()
  const { data: acct, error: acctErr } = await sb
    .from("accounts")
    .select("account_id")
    .eq("account_id", accountId)
    .maybeSingle()
  if (acctErr) return { ok: false, error: describeError(acctErr) }
  if (!acct) return { ok: false, error: "That account does not exist." }

  return { ok: true, email: auth.email }
}

/**
 * Assign `userId` to (`accountId`, `role`), replacing whoever holds it.
 *
 * ONE ASSIGNEE PER SLOT is enforced HERE, not in the schema — the table
 * deliberately permits several people in a role so that a future
 * multi-assignee UI needs no migration. This action implements today's rule by
 * deleting the slot and inserting one row.
 *
 * The write is always `source = 'manual'`, which is what makes it survive the
 * next CRM re-seed: the seed skips any slot holding a manual row. Re-assigning
 * a seeded slot therefore takes it out of the CRM's hands permanently, which is
 * the intended behaviour — this page is the system of record for the team going
 * forward.
 */
export async function assignRole(input: {
  accountId: string
  role: string
  userId: string
}): Promise<ActionResult> {
  const g = await guard(input.accountId, input.role)
  if (!g.ok) return fail(g.error)

  if (!input.userId) return fail("No user id.")

  // The assignee must be an ACTIVE, non-service Rose employee. Checked against
  // the database, not against whatever the client sent.
  const roster = await loadRoster()
  if (!roster.ok) return fail(roster.error)
  const person = roster.data.find((p) => p.userId === input.userId)
  if (!person) {
    return fail("That person is not an active Rose employee and cannot be assigned.")
  }

  const sb = getSupabaseServer()
  const now = new Date().toISOString()

  // Read the slot BEFORE mutating, so the audit entry can carry an old -> new
  // diff rather than just the new value.
  const { data: before } = await sb
    .from(TABLE)
    .select("user_id, source, updated_by")
    .eq("account_id", input.accountId)
    .eq("role", input.role)
    .maybeSingle()

  // Clear the slot first — see the one-assignee-per-slot note above.
  const { error: delErr } = await sb
    .from(TABLE)
    .delete()
    .eq("account_id", input.accountId)
    .eq("role", input.role)
  if (delErr) return fail(describeError(delErr))

  const after = {
    account_id: input.accountId,
    role: input.role,
    user_id: input.userId,
    source: "manual",
    created_by: g.email,
    updated_by: g.email,
    updated_at: now,
  }
  const { error: insErr } = await sb.from(TABLE).insert(after)
  if (insErr) return fail(describeError(insErr))

  // AUDIT — see lib/audit.ts. Reassigning an occupied slot reads as an update
  // (who held it -> who holds it now); filling an empty one reads as a create.
  await recordAudit({
    action: before ? "update" : "create",
    entity: TABLE,
    // The SLOT is the thing being changed, and the row's own uuid is replaced
    // on every reassignment — keying on it would scatter one slot's history
    // across a new id each time.
    recordId: `${input.accountId}|${input.role}`,
    changes: before
      ? diffRows(before, { user_id: input.userId, source: "manual", updated_by: g.email })
      : snapshot(after),
    context: PATH,
  })

  revalidatePath(PATH)
  return ok()
}

/**
 * Clear (`accountId`, `role`) entirely.
 *
 * Deletes rather than writing an empty row, so "nobody in this role" and "this
 * role has never been set" are the same state — which is what the seed's
 * "fill blanks" behaviour expects.
 *
 * NOTE a cleared slot becomes re-seedable: with no manual row present, the next
 * CRM seed will put the CRM's person back. That is deliberate — clearing means
 * "this is not a Rose-owned override", not "keep this permanently empty". If a
 * permanently-empty slot is ever needed it wants a tombstone row, which is a
 * schema change and is out of scope here.
 */
export async function clearRole(input: {
  accountId: string
  role: string
}): Promise<ActionResult> {
  const g = await guard(input.accountId, input.role)
  if (!g.ok) return fail(g.error)

  const sb = getSupabaseServer()

  // Read it before it goes, so the audit entry records WHAT was removed.
  const { data: before } = await sb
    .from(TABLE)
    .select("account_id, role, user_id, source, updated_by, updated_at")
    .eq("account_id", input.accountId)
    .eq("role", input.role)
    .maybeSingle()

  const { error } = await sb
    .from(TABLE)
    .delete()
    .eq("account_id", input.accountId)
    .eq("role", input.role)
  if (error) return fail(describeError(error))

  // AUDIT — only when something was actually there. Clearing an already-empty
  // slot changed nothing and should not leave a trail entry saying it did.
  if (before) {
    await recordAudit({
      action: "delete",
      entity: TABLE,
      recordId: `${input.accountId}|${input.role}`,
      changes: snapshot(before),
      context: PATH,
    })
  }

  revalidatePath(PATH)
  return ok()
}

/* ---------------------------------------------------- owned account status */

/**
 * Set a client's DASHBOARD-OWNED Active/Inactive flag.
 *
 * ⚠️  SETUP ONLY. This writes `public.account_status` and affects NOTHING else.
 * It does not filter, hide or change any page. In particular it does NOT touch
 * `accounts.state_label`, which is the CRM field roughly fifteen views in
 * sql/03_views.sql (v_client_portfolio and friends) and
 * app/institution-style/page.tsx still filter on. The two flags can diverge the
 * moment this is used, and that divergence is inert by design — see the header
 * of lib/account-teams/status.ts.
 *
 * Always written as `source = 'manual'`, which is what makes it survive the next
 * CRM re-seed: the seed's upsert only updates rows whose source is 'crm_seed'.
 * Toggling therefore takes a client's status out of the CRM's hands permanently,
 * which is the intent.
 *
 * `changed_at` is set explicitly rather than by a row-touch trigger, so it means
 * "when the status changed" rather than "when the row was last written".
 */
export async function setAccountStatus(input: {
  accountId: string
  isActive: boolean
}): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorised.")

  if (!input.accountId) return fail("No account id.")
  if (typeof input.isActive !== "boolean") {
    return fail("Status must be true or false.")
  }

  const sb = getSupabaseServer()

  // The account must exist — checked against the database, not taken on trust.
  const { data: acct, error: acctErr } = await sb
    .from("accounts")
    .select("account_id")
    .eq("account_id", input.accountId)
    .maybeSingle()
  if (acctErr) return fail(describeError(acctErr))
  if (!acct) return fail("That account does not exist.")

  // Prior state, for the audit diff.
  const { data: before } = await sb
    .from("account_status")
    .select("is_active, source, changed_by")
    .eq("account_id", input.accountId)
    .maybeSingle()

  const { error } = await sb.from("account_status").upsert(
    {
      account_id: input.accountId,
      is_active: input.isActive,
      source: "manual",
      changed_at: new Date().toISOString(),
      changed_by: auth.email,
    },
    { onConflict: "account_id" },
  )
  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts. A create the first time a client's status is set
  // (or first overridden after seeding), an update thereafter.
  await recordAudit({
    action: before ? "update" : "create",
    entity: "account_status",
    recordId: input.accountId,
    changes: before
      ? diffRows(before, {
          is_active: input.isActive,
          source: "manual",
          changed_by: auth.email,
        })
      : snapshot({
          account_id: input.accountId,
          is_active: input.isActive,
          source: "manual",
          changed_by: auth.email,
        }),
    context: PATH,
  })

  revalidatePath(PATH)
  return ok()
}
