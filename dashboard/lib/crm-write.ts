import "server-only"

/**
 * Shared plumbing for DASHBOARD-AUTHORED CRM records — the write path every
 * live "Add New" uses (Contacts, Notes, Touches, Tasks, Meetings, Events). Each entity's server action does
 * its own field mapping; everything that must be identical across entities
 * lives here so it cannot drift:
 *
 *   - requireCrmWriter   the write gate: super_user AND not in "View as"
 *   - loadAccountOptions the client picker's list
 *   - resolveAccount     re-read a picked client server-side (never trust the name)
 *   - DASHBOARD_ROW_BASE the ownership stamp: origin='dashboard', _raw={}
 *   - purgeTestRows      delete origin='dashboard' AND is_test=true, audited
 *
 * Callers must still: generate the pk with randomUUID(), set is_test from the
 * form, and call recordAudit after the insert succeeds.
 * See content/docs/22-cutover-ownership-boundary.md.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { diffRows, recordAudit } from "@/lib/audit"
import { getEffectiveAllowedRoutes, getEffectiveCrmLevels, getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import {
  CRM_LEVEL_ROUTES,
  CRM_LEVEL_TABLE_ROUTE,
  decideCrmWrite,
  levelAtLeast,
  protectedFieldViolation,
  type CrmLevel,
  type CrmLevelRoute,
  type CrmWriteAction,
} from "@/lib/access/crm-levels-policy"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import type { AccountOption, UserOption } from "@/lib/types"
import { easternOffsetMs } from "@/lib/table-views/query"
import { classifyUser } from "@/lib/access/identity-index"
import { canAccessRoute, hasSuperUserPrivileges } from "@/lib/access-control"

/**
 * The WRITE gate. Stricter than the read gates: the effective role must be
 * super_user AND the caller must not be in "View as" — a super-user previewing
 * as someone else must not create or delete records under that preview. (The
 * effective role can only be super_user for a real super-user, so this is a
 * real-role check too.) Returns the real caller's identity for provenance.
 */
export async function requireCrmWriter(
  verb = "creating or deleting records",
): Promise<{ ok: true; userId: string | null; name: string | null } | { ok: false; error: string }> {
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (!hasSuperUserPrivileges(role)) return { ok: false, error: "Not authorised." }
  if (identity.impersonated) return { ok: false, error: `Exit “View as” before ${verb}.` }
  return { ok: true, userId: identity.userId, name: identity.name }
}

/**
 * The READ gate for the four grantable CRM list pages (2026-10-16): Clients
 * (/accounts), Events, Meetings, Contacts. May the EFFECTIVE viewer open
 * `route`? The same predicate proxy.ts enforces, so a role / per-user page
 * grant opens the list, its filters, export, saved views and row drawers.
 * NO row scoping on the four original tables — a granted page shows every row;
 * Tasks / Touchpoints / Notes (2026-10-20) add the Actions row scope
 * (lib/access/actions-scope.ts) on top. This never opens a write.
 */
export async function canReadCrmPage(route: string): Promise<boolean> {
  const [role, allowed] = await Promise.all([getEffectiveRole(), getEffectiveAllowedRoutes()])
  return canAccessRoute(role, route, allowed)
}

/**
 * The CRM ACCESS-LEVEL write gate (2026-10-16) for the four level-gated tables
 * — Clients (/accounts), Events, Meetings, Contacts:
 *   edit    an existing record  → level >= Edit
 *   create  a record            → Manage
 *   delete  / purge             → Manage
 * hasSuperUserPrivileges (super user OR admin) bypasses the level — implicitly
 * full (see decideCrmWrite in lib/access/crm-levels-policy.ts to change that).
 * Like requireCrmWriter it refuses while in "View as", and returns the real
 * caller for provenance, plus the level for the protected-fields check.
 * Tasks / Touchpoints / Notes joined 2026-10-20; their actions ALSO require the
 * row to be visible (canSeeActionsRow), checked by the caller.
 */
export async function requireCrmLevel(
  route: CrmLevelRoute,
  action: CrmWriteAction,
  verb = "changing records",
): Promise<
  | { ok: true; userId: string | null; name: string | null; level: CrmLevel; isSuper: boolean }
  | { ok: false; error: string }
> {
  const [role, identity, levels] = await Promise.all([
    getEffectiveRole(),
    getEffectiveIdentity(),
    getEffectiveCrmLevels(),
  ])
  const isSuper = hasSuperUserPrivileges(role)
  const level: CrmLevel = isSuper ? "manage" : levels[route]
  const reason = decideCrmWrite(action, level, isSuper)
  if (reason) return { ok: false, error: reason }
  if (identity.impersonated) return { ok: false, error: `Exit “View as” before ${verb}.` }
  return { ok: true, userId: identity.userId, name: identity.name, level, isSuper }
}

/**
 * May the viewer use a CRM create / edit FORM (its pickers, its edit load)?
 * Super users / admins, or Edit+ on `route` — or, with no route (the shared
 * pickers), Edit+ on ANY of the four level-gated tables.
 */
export async function canUseCrmForms(route?: CrmLevelRoute): Promise<boolean> {
  const [role, levels] = await Promise.all([getEffectiveRole(), getEffectiveCrmLevels()])
  if (hasSuperUserPrivileges(role)) return true
  const routes = route ? [route] : CRM_LEVEL_ROUTES
  return routes.some((r) => levelAtLeast(levels[r], "edit"))
}

/** Every column a dashboard-authored mirror row gets regardless of entity. */
export const DASHBOARD_ROW_BASE = { origin: "dashboard", _raw: {} } as const

/** Trim to a value or null. */
export const cleanText = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim()
  return s === "" ? null : s
}

export const isUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** A YYYY-MM-DD calendar date, or null. */
export const isIsoDate = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))

/** Clients for a form's picker: every account, by name. Read gate only. */
export async function loadAccountOptions(): Promise<ActionResult<AccountOption[]>> {
  // Pickers (2026-10-16): super users, or anyone at Edit+ on a level-gated
  // CRM table (their create / edit forms need them) — incl. Tasks / Notes /
  // Touchpoints since 2026-10-20.
  if (!(await canUseCrmForms())) return fail("Not authorised.")

  const { data, error } = await getSupabaseServer()
    .from("accounts")
    .select("account_id, name, ticker_symbol")
    .order("name", { ascending: true })
    .limit(5000)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as AccountOption[])
}

/**
 * ACTIVE clients only — accounts.state_label = 'Active', the same rule
 * Portfolio and the views use. `includeAccountId` keeps an edited record's own
 * client listed even if it has since gone inactive. Used by the Event and
 * Meeting forms' client pickers. Read gate only.
 */
export async function loadActiveAccountOptions(
  includeAccountId?: string | null,
): Promise<ActionResult<AccountOption[]>> {
  // Pickers (2026-10-16): super users, or anyone at Edit+ on a level-gated
  // CRM table (their create / edit forms need them) — incl. Tasks / Notes /
  // Touchpoints since 2026-10-20.
  if (!(await canUseCrmForms())) return fail("Not authorised.")
  return readActiveAccountOptions(includeAccountId)
}

/**
 * loadActiveAccountOptions WITHOUT the role gate, optionally limited to
 * `onlyIds` (a caller's client scope). For callers that gate themselves.
 */
export async function readActiveAccountOptions(
  includeAccountId?: string | null,
  onlyIds?: readonly string[] | null,
): Promise<ActionResult<AccountOption[]>> {
  const keep = includeAccountId && isUuid(includeAccountId) ? includeAccountId : null
  let q = getSupabaseServer().from("accounts").select("account_id, name, ticker_symbol")
  q = keep ? q.or(`state_label.eq.Active,account_id.eq.${keep}`) : q.eq("state_label", "Active")
  if (onlyIds) {
    if (onlyIds.length === 0) return ok([])
    q = q.in("account_id", [...onlyIds])
  }
  const { data, error } = await q.order("name", { ascending: true }).limit(5000)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as AccountOption[])
}

/**
 * Re-read a picked client. The browser sends only the id; the name written to
 * the record comes from here, so a tampered request cannot mislabel a client.
 */
export async function resolveAccount(
  accountId: string | null | undefined,
): Promise<ActionResult<{ account_id: string; name: string } | null>> {
  const id = cleanText(accountId)
  if (!id) return ok(null)
  if (!isUuid(id)) return fail("Unknown client.")
  const { data, error } = await getSupabaseServer()
    .from("accounts")
    .select("account_id, name")
    .eq("account_id", id)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("That client no longer exists.")
  return ok(data as { account_id: string; name: string })
}

/** How many test rows the purge would remove — for the confirm prompt. */
export async function countTestRows(
  table: string,
  pk: string,
  /** Row-scoped tables (Tasks / Touchpoints / Notes): the viewer's visible test
   *  ids, run AFTER the gate. null = no restriction (super users / admins). */
  restrict?: (testIds: string[]) => Promise<string[] | null>,
): Promise<ActionResult<number>> {
  // Level-gated tables (2026-10-16): Manage (= delete / purge); others super only.
  const levelRoute = CRM_LEVEL_TABLE_ROUTE[table]
  if (levelRoute) {
    const [role, levels] = await Promise.all([getEffectiveRole(), getEffectiveCrmLevels()])
    if (decideCrmWrite("delete", levels[levelRoute], hasSuperUserPrivileges(role))) return fail("Not authorised.")
  } else {
    const role = await getEffectiveRole()
    if (!hasSuperUserPrivileges(role)) return fail("Not authorised.")
  }
  if (restrict) {
    const only = await restrict([...(await testRowIds(table, pk))])
    if (only) return ok(only.length)
  }
  const { count, error } = await getSupabaseServer()
    .from(table)
    .select(pk, { count: "exact", head: true })
    .eq("origin", "dashboard")
    .eq("is_test", true)
  if (error) return fail(describeError(error))
  return ok(count ?? 0)
}

/**
 * Delete every dashboard-created TEST row in `table` — and nothing else. Both
 * filters sit on the DELETE itself, so a Dynamics row (origin='dynamics') or a
 * real dashboard row (is_test=false) can never match. Not blocked by the
 * ownership fence, which guards only the reconciliation approve-delete. One
 * audit entry per removed row, with the `snapshot` columns.
 */
export async function purgeTestRows(opts: {
  table: string
  pk: string
  snapshot: string
  path: string
  context: string
  /** See countTestRows — limits the purge to the viewer's visible test rows. */
  restrict?: (testIds: string[]) => Promise<string[] | null>
}): Promise<ActionResult<{ deleted: number }>> {
  // Level-gated tables (2026-10-16): Manage; others the super-user writer gate.
  const levelRoute = CRM_LEVEL_TABLE_ROUTE[opts.table]
  const gate = levelRoute ? await requireCrmLevel(levelRoute, "delete", "purging test records") : await requireCrmWriter()
  if (!gate.ok) return fail(gate.error)

  const only = opts.restrict ? await opts.restrict([...(await testRowIds(opts.table, opts.pk))]) : null
  if (only && only.length === 0) return ok({ deleted: 0 })
  let del = getSupabaseServer()
    .from(opts.table)
    .delete()
    .eq("origin", "dashboard")
    .eq("is_test", true)
  if (only) del = del.in(opts.pk, only)
  const { data, error } = await del.select(`${opts.pk}, ${opts.snapshot}`)
  if (error) return fail(describeError(error))

  const deleted = (data ?? []) as unknown as Record<string, unknown>[]
  for (const r of deleted) {
    await recordAudit({
      action: "delete",
      entity: opts.table,
      recordId: String(r[opts.pk]),
      changes: { ...r, origin: "dashboard", is_test: true },
      context: opts.context,
    })
  }

  revalidatePath(opts.path)
  return ok({ deleted: deleted.length })
}

/**
 * An Eastern wall-clock "YYYY-MM-DDTHH:mm" (a datetime-local input) → the UTC
 * ISO instant, or null. Two passes, like easternDayStartIso, so a time next to a
 * DST changeover lands correctly. Every date on the CRM pages is Eastern.
 */
export function easternLocalToIso(local: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec((local ?? "").trim())
  if (!m) return null
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5])
  let t = wall - easternOffsetMs(new Date(wall))
  t = wall - easternOffsetMs(new Date(t))
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/* ------------------------------------------------ pickers (read gate only) */

/** People for owner / host / booker pickers: active mirror users, by name. */
export async function loadUserOptions(): Promise<ActionResult<UserOption[]>> {
  // Pickers (2026-10-16): super users, or anyone at Edit+ on a level-gated
  // CRM table (their create / edit forms need them) — incl. Tasks / Notes /
  // Touchpoints since 2026-10-20.
  if (!(await canUseCrmForms())) return fail("Not authorised.")
  const { data, error } = await getSupabaseServer()
    .from("users")
    .select("user_id, display_name")
    .eq("is_active", true)
    .order("display_name", { ascending: true })
    .limit(2000)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as UserOption[])
}

type PersonnelRow = { user_id: string; display_name: string | null; email: string | null; is_active: boolean | null }

/** A Rose & Co person: a `human` row of the identity rule, and active in Dynamics. */
function isActivePersonnel(r: PersonnelRow): boolean {
  return r.is_active === true && classifyUser(r).classification === "human"
}

/**
 * ROSE & CO ACTIVE PERSONNEL — the people pickers on the Meeting form (Host,
 * Booker, Second Host, On Behalf Of, Feedback). Source: public.users, the
 * Dynamics systemuser mirror these fields reference, filtered to
 * `is_active` (= NOT isdisabled) AND the identity rule's `human`
 * classification (lib/access/identity-index.ts classifyUser: @roseandco.com,
 * not a hashed / shared-mailbox / #-app account). That drops ~240 active
 * service + external rows the plain is_active list carried.
 *
 * `keepIds` — people already assigned on the record being edited — are always
 * listed, even if now inactive (labelled "(inactive)"), so the value is not lost.
 */
export async function loadPersonnelOptions(keepIds: readonly (string | null | undefined)[] = []): Promise<ActionResult<UserOption[]>> {
  // Pickers (2026-10-16): super users, or anyone at Edit+ on a level-gated
  // CRM table (their create / edit forms need them) — incl. Tasks / Notes /
  // Touchpoints since 2026-10-20.
  if (!(await canUseCrmForms())) return fail("Not authorised.")
  const { data, error } = await getSupabaseServer()
    .from("users")
    .select("user_id, display_name, email, is_active")
    .order("display_name", { ascending: true })
    .limit(5000)
  if (error) return fail(describeError(error))
  const keep = new Set(keepIds.filter((v): v is string => !!v))
  const rows = (data ?? []) as PersonnelRow[]
  // Same-name duplicate records are ONE person (the identity rule unions
  // them), so each person is listed once — preferring an already-assigned id.
  const byName = new Map<string, PersonnelRow>()
  for (const r of rows) {
    if (!isActivePersonnel(r)) continue
    const k = (r.display_name ?? "").trim().toLowerCase()
    const prev = byName.get(k)
    if (!prev || (keep.has(r.user_id) && !keep.has(prev.user_id))) byName.set(k, r)
  }
  const listed = new Set([...byName.values()].map((r) => r.user_id))
  const out: UserOption[] = []
  for (const r of rows) {
    if (listed.has(r.user_id)) out.push({ user_id: r.user_id, display_name: r.display_name })
    else if (keep.has(r.user_id)) {
      // Assigned but not in the active list (inactive, a service mailbox, or the
      // twin of a listed person) — keep it visible so the value is not lost.
      out.push({ user_id: r.user_id, display_name: `${r.display_name ?? "Unknown"}${r.is_active ? "" : " (inactive)"}` })
    }
  }
  return ok(out)
}

/**
 * Server-side check for a people field: `userId` must be active Rose & Co
 * personnel — unless it is in `allowIds` (the value already stored on the
 * record), so an inactive person already assigned can stay. Empty = ok.
 */
export async function requireActivePersonnel(
  userId: string | null | undefined,
  allowIds: ReadonlySet<string>,
  label: string,
): Promise<ActionResult> {
  const id = cleanText(userId)
  if (!id || allowIds.has(id)) return ok()
  if (!isUuid(id)) return fail(`Unknown ${label}.`)
  const { data, error } = await getSupabaseServer()
    .from("users")
    .select("user_id, display_name, email, is_active")
    .eq("user_id", id)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data || !isActivePersonnel(data as PersonnelRow)) return fail(`${label} must be active Rose & Co personnel.`)
  return ok()
}

/**
 * One client's marketing events (newest first) — for event pickers.
 * `opts.stages` limits to those stored event_state_label values (the Meeting
 * form); `opts.keepEventId` keeps an edited record's current event listed even
 * if its stage is outside that list. No opts = every event (unchanged).
 */
export async function loadClientEventOptions(
  accountId: string,
  opts?: { stages?: readonly string[]; keepEventId?: string | null },
): Promise<ActionResult<{ event_id: string; name: string | null; event_state_label: string | null }[]>> {
  // Pickers (2026-10-16): super users, or anyone at Edit+ on a level-gated
  // CRM table (their create / edit forms need them) — incl. Tasks / Notes /
  // Touchpoints since 2026-10-20.
  if (!(await canUseCrmForms())) return fail("Not authorised.")
  if (!isUuid(accountId)) return ok([])
  let q = getSupabaseServer()
    .from("events")
    .select("event_id, name, event_state_label")
    .eq("client_account_id", accountId)
  if (opts?.stages) {
    const inList = opts.stages.map((s) => `"${s}"`).join(",")
    const keep = opts.keepEventId && isUuid(opts.keepEventId) ? opts.keepEventId : null
    q = keep ? q.or(`event_state_label.in.(${inList}),event_id.eq.${keep}`) : q.in("event_state_label", [...opts.stages])
  }
  const { data, error } = await q.order("created_on", { ascending: false }).limit(200)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as { event_id: string; name: string | null; event_state_label: string | null }[])
}

/**
 * Institutions matching a search, for the meeting form. Institutions are
 * Dynamics accounts the mirror does NOT sync (public.accounts holds only the
 * ~230 clients), so the only source is the institutions already on meetings.
 */
export async function searchInstitutionOptions(
  query: string,
): Promise<ActionResult<{ institution_id: string; institution_name: string }[]>> {
  // Pickers (2026-10-16): super users, or anyone at Edit+ on a level-gated
  // CRM table (their create / edit forms need them) — incl. Tasks / Notes /
  // Touchpoints since 2026-10-20.
  if (!(await canUseCrmForms())) return fail("Not authorised.")
  const q = cleanText(query)
  if (!q || q.length < 2) return ok([])
  const escaped = q.replace(/([%_\\])/g, "\\$1")
  const { data, error } = await getSupabaseServer()
    .from("meetings")
    .select("institution_id, institution_name")
    .ilike("institution_name", `%${escaped}%`)
    .not("institution_id", "is", null)
    .limit(500)
  if (error) return fail(describeError(error))
  const seen = new Map<string, string>()
  for (const r of (data ?? []) as { institution_id: string; institution_name: string }[]) {
    if (!seen.has(r.institution_id)) seen.set(r.institution_id, r.institution_name)
  }
  return ok(
    [...seen]
      .map(([institution_id, institution_name]) => ({ institution_id, institution_name }))
      .sort((a, b) => a.institution_name.localeCompare(b.institution_name))
      .slice(0, 50),
  )
}

/** Re-read a picked person server-side (never trust a name from the browser). */
export async function resolveUser(
  userId: string | null | undefined,
): Promise<ActionResult<{ user_id: string; display_name: string | null } | null>> {
  const id = cleanText(userId)
  if (!id) return ok(null)
  if (!isUuid(id)) return fail("Unknown person.")
  const { data, error } = await getSupabaseServer()
    .from("users")
    .select("user_id, display_name")
    .eq("user_id", id)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("That person no longer exists.")
  return ok(data as { user_id: string; display_name: string | null })
}

/** Re-read a picked event and check it belongs to the client. */
export async function resolveClientEvent(
  eventId: string | null | undefined,
  accountId: string,
): Promise<ActionResult<{ event_id: string; name: string | null; event_state_label: string | null } | null>> {
  const id = cleanText(eventId)
  if (!id) return ok(null)
  if (!isUuid(id)) return fail("Unknown event.")
  const { data, error } = await getSupabaseServer()
    .from("events")
    .select("event_id, name, client_account_id, event_state_label")
    .eq("event_id", id)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("That event no longer exists.")
  const ev = data as { event_id: string; name: string | null; client_account_id: string | null; event_state_label: string | null }
  if (ev.client_account_id !== accountId) return fail("That event belongs to a different client.")
  return ok({ event_id: ev.event_id, name: ev.name, event_state_label: ev.event_state_label })
}

/* ----------------------------------------------------- list TEST badges */

/**
 * The ids of every dashboard-created TEST row in `table` — a handful, so one
 * small query. Pages whose list view does not carry is_test (Tasks, Meetings,
 * Events) mark their rows with this instead of a view patch. Call it only
 * AFTER the page's own super_user gate. Fails soft: no badges, never an error.
 */
export async function testRowIds(table: string, pk: string): Promise<Set<string>> {
  const { data, error } = await getSupabaseServer()
    .from(table)
    .select(pk)
    .eq("origin", "dashboard")
    .eq("is_test", true)
    .limit(5000)
  if (error || !data) return new Set()
  return new Set((data as unknown as Record<string, unknown>[]).map((r) => String(r[pk])))
}

/** Stamp is_test onto list rows whose pk is in `ids`. */
export function markTestRows<T extends object>(rows: T[], pk: keyof T, ids: Set<string>): T[] {
  if (ids.size === 0) return rows
  return rows.map((r) => (ids.has(String(r[pk])) ? { ...r, is_test: true } : r))
}

/* ------------------------------------------------------ editing (updates) */

/**
 * Columns an edit may NEVER set, whatever the caller passes: identity,
 * ownership, the test marker, sync bookkeeping and creation provenance.
 * (`_raw` is allowed only when the caller opts in — see `rawShim`.)
 */
const NEVER_EDITABLE = new Set([
  "origin",
  "is_test",
  "_synced_at",
  "created_on",
  "created_by_id",
  "created_by_name",
])

/**
 * THE edit path for dashboard-authored CRM rows — every entity's update action
 * funnels through here, so the origin guard exists exactly once.
 *
 * ── THE ORIGIN GUARD (belt and braces) ─────────────────────────────────────
 * The service-role client bypasses RLS, so this function IS the gate.
 *   1. Re-read the row. Missing → refuse. origin <> 'dashboard' → refuse with
 *      "synced from Dynamics — read-only until cutover".
 *   2. The UPDATE itself also filters origin = 'dashboard', and must report
 *      exactly one row changed — otherwise refuse, never a silent no-op. A
 *      crafted request for a Dynamics row fails at both steps.
 * Only the given flattened columns change, plus modified_on / modified_by_*.
 * origin cannot flip anyway (the origin-lock trigger), and _synced_at is left
 * alone for dashboard rows by the fenced touch_synced_at trigger.
 *
 * Audited as an `update` with the before → after diff of the edited columns;
 * the context carries "dashboard row" (and "test") for the Audit Log's origin
 * badge, since a diff has no origin field of its own.
 */
export async function updateDashboardRow(opts: {
  table: string
  pk: string
  id: string
  /** Flattened columns from the entity's own validated builder. */
  patch: Record<string, unknown>
  /** Opt-in: also rewrite _raw (meetings' event-name compatibility keys). */
  rawShim?: Record<string, unknown>
  path: string
  context: string
  verb?: string
  /**
   * A writer the CALLER has already gated, in place of requireCrmWriter — for
   * a narrower path with its own server-side gate (the Onboarding page's
   * touchpoint cells, app/onboarding/actions.ts). Omitted = the usual
   * super_user write gate. The origin guard below applies either way.
   */
  actor?: { userId: string | null; name: string | null }
}): Promise<ActionResult<{ changed: number }>> {
  // Level-gated tables (2026-10-16): Edit or above (requireCrmLevel); every
  // other table keeps the super-user writer gate.
  const levelRoute = opts.actor ? undefined : CRM_LEVEL_TABLE_ROUTE[opts.table]
  const gate = opts.actor
    ? ({ ok: true, ...opts.actor } as const)
    : levelRoute
      ? await requireCrmLevel(levelRoute, "edit", opts.verb ?? "editing records")
      : await requireCrmWriter(opts.verb ?? "editing records")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(opts.id)) return fail("Unknown record.")

  const bad = Object.keys(opts.patch).filter(
    (k) => k === opts.pk || k === "_raw" || NEVER_EDITABLE.has(k),
  )
  if (bad.length) return fail(`These fields can't be edited: ${bad.join(", ")}.`)

  const sb = getSupabaseServer()
  const cols = Object.keys(opts.patch)

  // 1. Re-read, and refuse anything that is not a dashboard row.
  const { data: beforeData, error: readErr } = await sb
    .from(opts.table)
    .select([opts.pk, "origin", "is_test", ...cols].join(", "))
    .eq(opts.pk, opts.id)
    .maybeSingle()
  if (readErr) return fail(describeError(readErr))
  if (!beforeData) return fail("Record not found.")
  const before = beforeData as unknown as Record<string, unknown>
  if (before.origin !== "dashboard") {
    return fail("This record is synced from Dynamics and is read-only until cutover.")
  }

  const prior = Object.fromEntries(cols.map((c) => [c, before[c]]))
  const diff = diffRows(prior, opts.patch)
  if (!diff) return ok({ changed: 0 }) // nothing to save — no write, no audit

  // PROTECTED FIELDS (2026-10-16): a listed column changes only at Manage or for
  // super users / admins. The lists ship EMPTY (lib/access/crm-levels-policy.ts).
  if (levelRoute && "level" in gate) {
    const g = gate as unknown as { level: CrmLevel; isSuper: boolean }
    const blocked = protectedFieldViolation(levelRoute, Object.keys(diff), g.level, g.isSuper)
    if (blocked) return fail(blocked)
  }

  // 2. The guarded UPDATE: pk AND origin = 'dashboard', and it must hit one row.
  const { data: updated, error: updErr } = await sb
    .from(opts.table)
    .update({
      ...opts.patch,
      ...(opts.rawShim ? { _raw: opts.rawShim } : null),
      modified_on: new Date().toISOString(),
      modified_by_id: gate.userId,
      modified_by_name: gate.name,
    })
    .eq(opts.pk, opts.id)
    .eq("origin", "dashboard")
    .select(opts.pk)
  if (updErr) return fail(describeError(updErr))
  if (!updated || updated.length !== 1) {
    return fail("Refused: only records created in the dashboard can be edited.")
  }

  await recordAudit({
    action: "update",
    entity: opts.table,
    recordId: opts.id,
    changes: diff,
    context: `${opts.context} · dashboard row${before.is_test === true ? " · test" : ""}`,
  })

  revalidatePath(opts.path)
  return ok({ changed: Object.keys(diff).length })
}

/**
 * Read one row for an edit form — dashboard rows ONLY, so a Dynamics row can
 * never even be loaded into an editor. Read gate is super_user.
 */
export async function loadDashboardRowForEdit(
  table: string,
  pk: string,
  id: string,
  columns: string,
): Promise<ActionResult<Record<string, unknown>>> {
  // Level-gated tables (2026-10-16): Edit or above; others super only.
  const levelRoute = CRM_LEVEL_TABLE_ROUTE[table]
  if (levelRoute) {
    if (!(await canUseCrmForms(levelRoute))) return fail("Not authorised.")
  } else {
    const role = await getEffectiveRole()
    if (!hasSuperUserPrivileges(role)) return fail("Not authorised.")
  }
  return readDashboardRowForEdit(table, pk, id, columns)
}

/** loadDashboardRowForEdit WITHOUT the role gate — for callers that gate themselves. */
export async function readDashboardRowForEdit(
  table: string,
  pk: string,
  id: string,
  columns: string,
): Promise<ActionResult<Record<string, unknown>>> {
  if (!isUuid(id)) return fail("Unknown record.")
  const { data, error } = await getSupabaseServer()
    .from(table)
    .select(`${pk}, origin, is_test, ${columns}`)
    .eq(pk, id)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("Record not found.")
  const row = data as unknown as Record<string, unknown>
  if (row.origin !== "dashboard") {
    return fail("This record is synced from Dynamics and is read-only until cutover.")
  }
  return ok(row)
}

const EASTERN_LOCAL = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** A stored instant → Eastern "YYYY-MM-DDTHH:mm" (datetime-local), or "". */
export function isoToEasternLocal(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const p = EASTERN_LOCAL.formatToParts(d)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00"
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`
}

/** A stored instant → Eastern "YYYY-MM-DD", or "". */
export function isoToEasternDate(iso: unknown): string {
  return isoToEasternLocal(iso).slice(0, 10)
}

/** A stored value → form text. */
export const asText = (v: unknown): string => (v == null ? "" : String(v))
