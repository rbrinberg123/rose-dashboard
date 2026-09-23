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
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import type { AccountOption, UserOption } from "@/lib/types"
import { easternOffsetMs } from "@/lib/table-views/query"

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
  if (role !== "super_user") return { ok: false, error: "Not authorised." }
  if (identity.impersonated) return { ok: false, error: `Exit “View as” before ${verb}.` }
  return { ok: true, userId: identity.userId, name: identity.name }
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
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const { data, error } = await getSupabaseServer()
    .from("accounts")
    .select("account_id, name, ticker_symbol")
    .order("name", { ascending: true })
    .limit(5000)
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
export async function countTestRows(table: string, pk: string): Promise<ActionResult<number>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
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
}): Promise<ActionResult<{ deleted: number }>> {
  const gate = await requireCrmWriter()
  if (!gate.ok) return fail(gate.error)

  const { data, error } = await getSupabaseServer()
    .from(opts.table)
    .delete()
    .eq("origin", "dashboard")
    .eq("is_test", true)
    .select(`${opts.pk}, ${opts.snapshot}`)
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
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  const { data, error } = await getSupabaseServer()
    .from("users")
    .select("user_id, display_name")
    .eq("is_active", true)
    .order("display_name", { ascending: true })
    .limit(2000)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as UserOption[])
}

/** One client's marketing events (newest first) — for event pickers. */
export async function loadClientEventOptions(
  accountId: string,
): Promise<ActionResult<{ event_id: string; name: string | null; event_state_label: string | null }[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  if (!isUuid(accountId)) return ok([])
  const { data, error } = await getSupabaseServer()
    .from("events")
    .select("event_id, name, event_state_label")
    .eq("client_account_id", accountId)
    .order("created_on", { ascending: false })
    .limit(200)
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
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
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
): Promise<ActionResult<{ event_id: string; name: string | null } | null>> {
  const id = cleanText(eventId)
  if (!id) return ok(null)
  if (!isUuid(id)) return fail("Unknown event.")
  const { data, error } = await getSupabaseServer()
    .from("events")
    .select("event_id, name, client_account_id")
    .eq("event_id", id)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("That event no longer exists.")
  const ev = data as { event_id: string; name: string | null; client_account_id: string | null }
  if (ev.client_account_id !== accountId) return fail("That event belongs to a different client.")
  return ok({ event_id: ev.event_id, name: ev.name })
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
}): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter(opts.verb ?? "editing records")
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
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
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
