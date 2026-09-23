import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { easternDayStartIso } from "@/lib/table-views/query"
import {
  resolveRecord,
  summarise,
  originOf,
  type AuditListRow,
  type NameLookup,
  type ResolveContext,
} from "@/lib/audit-log/labels"
import { AuditLogView, type AuditFilters } from "./audit-log-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Audit Log" }

const PATCH = "sql/patches/2026-09-15c_audit_log.sql"

/** The most rows one page will fetch. Same shape as the CRM tables' ROW_CAP. */
export const AUDIT_ROW_CAP = 2000

/** The default window: the last 30 days. */
const DEFAULT_DAYS = 30

/**
 * Admin → Audit Log. A READ-ONLY viewer over `public.audit_log`.
 *
 * ── READ-ONLY, STRUCTURALLY ────────────────────────────────────────────────
 * This page and its ./actions.ts contain no insert, update or delete of any
 * kind. That is not merely a convention here: `audit_log` is append-only and the
 * database enforces it — UPDATE and DELETE are revoked from service_role AND
 * blocked by a trigger that raises even for the table owner. A write from this
 * page would fail loudly rather than corrupt the trail. See
 * sql/patches/2026-09-15c_audit_log.sql.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * The trail records every write in the app, including salary edits and
 * permission grants, so it is at least as sensitive as the most sensitive thing
 * it describes. Reads use the service-role client (RLS bypassed) and the table
 * carries no policies, so a successful load is fully privileged. Three gates:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and
 *      /admin/audit-log is in ADMIN_ONLY_ROUTES — super-user-only, and NOT
 *      openable through the Admin → Roles matrix.
 *   2. The check below re-verifies the EFFECTIVE role in the page itself.
 *   3. The filter-options action re-checks independently.
 *
 * ── PERFORMANCE ────────────────────────────────────────────────────────────
 * Same shape as the CRM tables, because an audit trail only ever grows:
 *
 *   * THE LIST NEVER SELECTS `changes`. It is a jsonb blob per row — a view
 *     config, a salary snapshot — and the list shows one line of it. The
 *     one-line `summary` is built HERE, server-side, from a SECOND query that
 *     fetches `changes` only for the rows being displayed, and the full blob is
 *     fetched again only when a drawer opens.
 *   * Every filter is applied in the QUERY, never in the browser.
 *   * The default window is 30 days, and the fetch is capped at AUDIT_ROW_CAP
 *     with a "showing first N" notice.
 *   * The date filter uses the `occurred_at DESC` index; entity+record history
 *     uses the `(entity, record_id, occurred_at DESC)` index.
 */
export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    actor?: string | string[]
    entity?: string | string[]
    action?: string | string[]
    from?: string | string[]
    to?: string | string[]
    record?: string | string[]
    all?: string | string[]
  }>
}) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sp = await searchParams
  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined

  const filters: AuditFilters = {
    actor: one(sp.actor),
    entity: one(sp.entity),
    action: one(sp.action),
    from: one(sp.from),
    to: one(sp.to),
    record: one(sp.record),
    all: one(sp.all) === "1",
  }

  const sb = getSupabaseServer()

  /**
   * HISTORY FOR ONE RECORD. `?entity=…&record=…` pins the view to a single
   * thing's timeline and flips the sort to CHRONOLOGICAL — reading a history
   * backwards is the wrong way round. It also drops the date window, since the
   * point is to see the whole life of the record.
   */
  const isHistory = !!(filters.entity && filters.record)

  // The default window. `all=1` removes it; a history view ignores it.
  let sinceIso: string | null = null
  if (!isHistory && !filters.all) {
    if (filters.from) {
      sinceIso = dayStart(filters.from)
    } else {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - DEFAULT_DAYS)
      sinceIso = easternDayStartIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    }
  } else if (filters.from) {
    sinceIso = dayStart(filters.from)
  }

  // `to` is inclusive of the chosen day, so compare against the NEXT midnight.
  const untilIso = filters.to ? dayStartPlusOne(filters.to) : null

  const applyFilters = <T extends AuditQuery>(q: T): T => {
    let out = q as AuditQuery
    if (filters.actor) out = out.eq("actor_email", filters.actor)
    if (filters.entity) out = out.eq("entity", filters.entity)
    if (filters.action) out = out.eq("action", filters.action)
    if (filters.record) out = out.eq("record_id", filters.record)
    if (sinceIso) out = out.gte("occurred_at", sinceIso)
    if (untilIso) out = out.lt("occurred_at", untilIso)
    return out as T
  }

  // The LIST columns only — note the absence of `changes`.
  const LIST_COLUMNS = "id, occurred_at, actor_email, actor_user_id, action, entity, record_id, context"

  const listQuery = applyFilters(
    sb.from("audit_log").select(LIST_COLUMNS) as unknown as AuditQuery,
  )
    .order("occurred_at", { ascending: isHistory })
    .order("id", { ascending: isHistory })
    .range(0, AUDIT_ROW_CAP) // one extra, so "was it capped?" needs no count

  const countQuery = applyFilters(
    sb.from("audit_log").select("id", { count: "exact", head: true }) as unknown as AuditQuery,
  )

  const [listRes, countRes, accountsRes, usersRes] = await Promise.all([
    listQuery,
    countQuery,
    sb.from("accounts").select("account_id, name"),
    sb.from("users").select("user_id, display_name, email"),
  ])

  // The table may not exist yet — the patch is run by hand. Fail soft with the
  // filename rather than 500ing, the same as the other pending-patch pages.
  const tableMissing =
    !!listRes.error &&
    (listRes.error.code === "42P01" ||
      listRes.error.code === "PGRST205" ||
      /does not exist|could not find the table/i.test(listRes.error.message))

  if (listRes.error && !tableMissing) {
    return (
      <PageShell title="Audit Log">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load audit_log</div>
          <div className="mt-1 text-muted-foreground">{listRes.error.message}</div>
        </div>
      </PageShell>
    )
  }

  /* -------- the lookups that make uuids readable -------- */

  const accounts: NameLookup = {}
  for (const a of (accountsRes.data ?? []) as { account_id: string; name: string | null }[]) {
    if (a.name) accounts[a.account_id] = a.name
  }

  const people: NameLookup = {}
  for (const u of (usersRes.data ?? []) as {
    user_id: string
    display_name: string | null
    email: string | null
  }[]) {
    people[u.user_id] = u.display_name?.trim() || u.email || "(unknown)"
  }
  const ctx: ResolveContext = { people, accounts }

  /** actor_email -> friendly name, for the avatar + name column. */
  const actorNames: NameLookup = {}
  for (const u of (usersRes.data ?? []) as { display_name: string | null; email: string | null }[]) {
    if (u.email) actorNames[u.email.toLowerCase()] = u.display_name?.trim() || u.email
  }

  /* -------- the summary column -------- */

  const raw = (listRes.data ?? []) as Omit<AuditListRow, "summary">[]
  const truncated = raw.length > AUDIT_ROW_CAP
  const page = truncated ? raw.slice(0, AUDIT_ROW_CAP) : raw

  /**
   * `changes` for the DISPLAYED rows only, in one keyed fetch, so the summary
   * can be built server-side without the list query dragging every blob along.
   * At the cap that is 2,000 jsonb values read once here rather than shipped to
   * the browser; the browser receives 2,000 short strings.
   */
  const changesById = new Map<number, unknown>()
  if (page.length > 0) {
    const { data: blobs } = await sb
      .from("audit_log")
      .select("id, changes")
      .in("id", page.map((r) => r.id))
    for (const b of (blobs ?? []) as { id: number; changes: unknown }[]) {
      changesById.set(b.id, b.changes)
    }
  }

  const rows: AuditListRow[] = page.map((r) => ({
    ...r,
    summary: summarise(r.entity, r.record_id, changesById.get(r.id), ctx),
    origin: originOf(changesById.get(r.id), r.context),
  }))

  // What the record column shows, resolved once here rather than per render.
  const recordLabels: Record<number, string> = {}
  const recordAccountIds: Record<number, string> = {}
  for (const r of page) {
    const res = resolveRecord(r.entity, r.record_id, ctx)
    recordLabels[r.id] = res.label
    if (res.accountId) recordAccountIds[r.id] = res.accountId
  }

  return (
    <PageShell title="Audit Log" hideHeader canvas>
      <AuditLogView
        rows={rows}
        totalMatching={countRes.count ?? rows.length}
        truncated={truncated}
        rowCap={AUDIT_ROW_CAP}
        filters={filters}
        isHistory={isHistory}
        defaultDays={DEFAULT_DAYS}
        actorNames={actorNames}
        recordLabels={recordLabels}
        recordAccountIds={recordAccountIds}
        tableMissing={tableMissing}
        patchPath={PATCH}
      />
    </PageShell>
  )
}

/* ------------------------------------------------------------------ dates */

/** "YYYY-MM-DD" -> the UTC instant of that Eastern day's midnight. */
function dayStart(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return easternDayStartIso(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** The day AFTER `ymd`, so a `to` filter includes the whole chosen day. */
function dayStartPlusOne(ymd: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  return easternDayStartIso(Number(m[1]), Number(m[2]), Number(m[3]) + 1)
}

/**
 * The subset of the PostgREST builder this page uses.
 *
 * Typed structurally rather than against the concrete PostgrestFilterBuilder
 * for the same reason lib/table-views/query.ts does it: one `applyFilters`
 * has to serve both the row query and the `head: true` count query, whose
 * select() overloads differ, and expressing "returns this" as a generic bound
 * makes TypeScript recurse until it gives up.
 */
type AuditQuery = {
  eq(column: string, value: unknown): AuditQuery
  gte(column: string, value: string): AuditQuery
  lt(column: string, value: string): AuditQuery
  order(column: string, opts: { ascending: boolean }): AuditQuery
  range(from: number, to: number): PromiseLike<{
    data: unknown[] | null
    error: { code?: string; message: string } | null
  }>
  // The head:true count query is awaited directly, without .range().
  then<R>(
    onfulfilled: (v: { count: number | null; error: { message: string } | null }) => R,
  ): PromiseLike<R>
}
