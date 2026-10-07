"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { requireSuperUser } from "@/lib/api-auth"
import { diffRows, recordAudit } from "@/lib/audit"

const PATH = "/admin/users"

/**
 * The roles that may be assigned in public.user_role_grants — the four live
 * roles (matching the `Role` type in lib/access-control.ts). This is now the
 * LIVE role source: getRealRole reads this table, so a change here changes what
 * the person can access on their next page load.
 *
 * NB the user_role_grants CHECK constraint must permit each of these values;
 * "client_manager" and later "associate" were each added alongside a constraint
 * update (see docs 01-access-and-users.md). Until the constraint is widened,
 * saving that role fails at the DB rather than silently granting it.
 */
const STAGED_ROLES = [
  "user",
  "associate",
  "client_manager",
  "logistics",
  "super_user",
] as const
export type StagedRole = (typeof STAGED_ROLES)[number]

/** "None" is represented by the ABSENCE of a row — passed from the client as null. */
export type RoleSelection = StagedRole | null

/**
 * Set the live role for one @roseandco.com user in public.user_role_grants.
 *
 *   - Super-user gated (mirrors admin/sync + reconciliation: reuses the same
 *     requireSuperUser guard the API routes use).
 *   - Validates the @roseandco.com domain server-side — never trust the client.
 *   - role === null → DELETE the row ("None").
 *   - otherwise UPSERT (email is the PRIMARY KEY), stamping updated_by/at.
 *   - revalidatePath so the roster reflects the new state on the next render.
 */
export async function setUserRole(
  email: string,
  role: RoleSelection,
): Promise<ActionResult> {
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorized.")

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail.endsWith("@roseandco.com")) {
    return fail("Only @roseandco.com users can be granted a role here.")
  }

  if (role !== null && !STAGED_ROLES.includes(role)) {
    return fail(`Invalid role: ${role}`)
  }

  const sb = getSupabaseServer()

  // Prior grant, for the audit diff — read once, used by both branches.
  const { data: priorGrant } = await sb
    .from("user_role_grants")
    .select("role")
    .eq("email", normalizedEmail)
    .maybeSingle()

  if (role === null) {
    // "None" — remove any staged grant for this user.
    const { error } = await sb.from("user_role_grants").delete().eq("email", normalizedEmail)
    if (error) return fail(describeError(error))

    // AUDIT — a role being REMOVED is the change most worth reconstructing
    // later, and deleting the row is otherwise completely untraceable.
    if (priorGrant) {
      await recordAudit({
        action: "delete",
        entity: "user_role_grants",
        recordId: normalizedEmail,
        changes: { email: normalizedEmail, role: priorGrant.role },
        context: PATH,
      })
    }

    revalidatePath(PATH)
    return ok()
  }

  const { error } = await sb
    .from("user_role_grants")
    .upsert(
      {
        email: normalizedEmail,
        role,
        updated_at: new Date().toISOString(),
        updated_by: auth.email,
      },
      { onConflict: "email" },
    )
  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts.
  await recordAudit({
    action: priorGrant ? "update" : "create",
    entity: "user_role_grants",
    recordId: normalizedEmail,
    changes: priorGrant ? diffRows(priorGrant, { role }) : { email: normalizedEmail, role },
    context: PATH,
  })

  revalidatePath(PATH)
  return ok()
}

// ---------------------------------------------------------------------------
// Level-2 data scopes — LIVE for Account Management (client pages)
// ---------------------------------------------------------------------------

/**
 * A person's row-level data scopes. `public.user_data_scopes` is the single
 * source of truth: this action writes it and `getUserScopes`
 * (lib/access/data-scope.ts) reads the SAME table to enforce.
 *
 *   - all          → no row filtering (see everything on any page they can open).
 *                    Overrides the other four. Implied+locked for super_user.
 *   - account_mgmt → client-level: clients where they're on the account team.
 *                    ENFORCED on the client pages (Portfolio, Client Detail,
 *                    NDRS Calendar, Onboarding).
 *   - booker/host/feedback → meeting-level: meetings where they are the
 *                    booker / host / feedback assignee. RECORDED here; enforced
 *                    in a later pass.
 *   - financials   → NOT a row scope: a FIELD-level grant deciding whether the
 *                    person may see dollar figures (Portfolio's Retainer column
 *                    + contract doc link; Client Detail's Annualized Retainer
 *                    and $ per Meeting KPIs). Orthogonal to the four above —
 *                    row scoping picks which clients, this picks whether their
 *                    money is in the payload at all. Read by canSeeFinancials
 *                    (lib/access/financials.ts). Deny-by-default.
 *
 * ENFORCEMENT MAPPING (client-level is wired; meeting-level is the later pass):
 *   - Account Management team = accounts.sales_lead_primary_id,
 *     secondary_manager_id, associate_id, logistics_coordinator_id
 *     (EXCLUDE `owner`).
 *   - Booker   = meetings.booker_id
 *   - Host     = meetings.host_id
 *   - Feedback = meetings.feedback_id
 *   All resolve against the login-email → users.user_id mapping.
 */
export type DataScopes = {
  all: boolean
  account_mgmt: boolean
  booker: boolean
  host: boolean
  feedback: boolean
  /** Field-level Financials grant (see above) — NOT a row scope. */
  financials: boolean
  /** "Can claim feedback" capability (lib/feedback-claims/) — NOT a row scope. */
  claim_feedback: boolean
}

/**
 * Persist one @roseandco.com user's Level-2 data scopes to
 * public.user_data_scopes — the LIVE table `getUserScopes` reads to enforce.
 *
 *   - Super-user gated (reuses requireSuperUser, like setUserRole).
 *   - Validates the @roseandco.com domain server-side.
 *   - UPSERTs the full scope set (email is the PRIMARY KEY), stamping
 *     updated_by/at. All-false is stored explicitly (deny-by-default).
 *   - revalidatePath so the roster reflects the saved state on the next render.
 */
export async function setUserDataScopes(
  email: string,
  scopes: DataScopes,
): Promise<ActionResult> {
  const auth = await requireSuperUser()
  if (!auth.ok) return fail("Not authorized.")

  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail.endsWith("@roseandco.com")) {
    return fail("Only @roseandco.com users can be scoped here.")
  }

  const sb = getSupabaseServer()
  const { data: before } = await sb
    .from("user_data_scopes")
    .select("*")
    .eq("email", normalizedEmail)
    .maybeSingle()

  const row: Record<string, unknown> = {
    email: normalizedEmail,
    scope_all: scopes.all,
    account_mgmt: scopes.account_mgmt,
    booker: scopes.booker,
    host: scopes.host,
    feedback: scopes.feedback,
    financials: scopes.financials,
    claim_feedback: scopes.claim_feedback,
    updated_at: new Date().toISOString(),
    updated_by: auth.email,
  }
  let { error } = await sb.from("user_data_scopes").upsert(row, { onConflict: "email" })
  // Before sql/patches/2026-10-07_feedback_claims.sql is run the column does
  // not exist; save everything else rather than failing every scope edit.
  if (error && /claim_feedback/.test(error.message)) {
    if (scopes.claim_feedback) {
      return fail("“Claim feedback” needs the 2026-10-07 feedback-claims SQL patch run first.")
    }
    delete row.claim_feedback
    ;({ error } = await sb.from("user_data_scopes").upsert(row, { onConflict: "email" }))
  }
  if (error) return fail(describeError(error))

  // Permission changes are audited (the claim capability gates writes).
  const auditable = (r: Record<string, unknown> | null) =>
    r
      ? {
          scope_all: r.scope_all,
          account_mgmt: r.account_mgmt,
          booker: r.booker,
          host: r.host,
          feedback: r.feedback,
          financials: r.financials,
          claim_feedback: r.claim_feedback ?? false,
        }
      : null
  const prev = auditable(before as Record<string, unknown> | null)
  const next = auditable(row)!
  await recordAudit({
    action: prev ? "update" : "create",
    entity: "user_data_scopes",
    recordId: normalizedEmail,
    changes: prev ? diffRows(prev, next) : next,
  })

  revalidatePath(PATH)
  return ok()
}
