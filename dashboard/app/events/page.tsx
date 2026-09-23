import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { markTestRows, testRowIds } from "@/lib/crm-write"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import type { AdminEventRow } from "@/lib/types"
import { ROW_CAP, availableColumns, countRows, fetchRows } from "@/lib/table-views/query"
import { ACCOUNT_TEAM_KEYS } from "@/lib/account-team"
import { decodeConfig, resolveActiveView } from "@/lib/table-views/config"
import type { SavedView } from "@/lib/table-views/types"
import { EVENTS_SPEC } from "@/lib/events/spec"
import { applyEventQuickFilters, type EventQuickFilters } from "@/lib/events/filters"
import { listSavedViews } from "./actions"
import { EventsView } from "./events-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Events" }

/**
 * CRM → Events. Every marketing event in the CRM: all states, all dates, active
 * and deactivated alike — subject to the ACTIVE SAVED VIEW, whose columns,
 * filters and sort are all applied in the QUERY rather than in the browser.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * This page reads `v_admin_events_all`, which is UNSCOPED by design, through the
 * service-role client, which bypasses RLS — so a successful load hands the
 * caller every client's events. Three independent gates stand in front of it,
 * and the data fetch happens after all of them:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and /events is
 *      in ADMIN_ONLY_ROUTES — super-user-only, and NOT openable through the
 *      Admin → Roles matrix.
 *   2. The check below re-verifies the role in the page itself, so the page is
 *      still safe if it is ever reached by a path that skips the proxy.
 *   3. The Supabase query is only constructed *after* that check returns.
 *
 * The role is the EFFECTIVE one, so a super-user using "View as" previews the
 * denial exactly as the impersonated person would experience it.
 *
 * Neither `?view=` nor `?cfg=` is a security boundary: `listSavedViews` only
 * returns views the caller may see, and a config can at most widen the result
 * back to what "All events" already returns to the same super-user caller.
 *
 * WRITES live in ./actions.ts, which delegates to lib/table-views/saved-views.ts
 * — the shared write path. Read that file's header before touching it.
 *
 * If you add a data read to this file, put it BELOW the guard.
 */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[]
    cfg?: string | string[]
    client?: string | string[]
    state?: string | string[]
    mgr?: string | string[]
  }>
}) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sp = await searchParams
  const requestedId = typeof sp.view === "string" ? sp.view : null
  const workingOverride = decodeConfig(EVENTS_SPEC, typeof sp.cfg === "string" ? sp.cfg : null)

  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined
  const quick: EventQuickFilters = {
    client: one(sp.client),
    event_state: one(sp.state),
    manager: one(sp.mgr),
  }

  const sb = getSupabaseServer()
  const now = new Date()

  // The independent stages together. Neither needs the other; only the ROW FETCH
  // below depends on both.
  //
  // NOTE WHAT IS NOT HERE: the filter-dropdown choices. The client asks for them
  // after the table renders (loadEventFilterOptions) — nothing on screen needs a
  // dropdown's contents in order to paint a table.
  const [viewsResult, available] = await Promise.all([
    listSavedViews(),
    availableColumns(sb, EVENTS_SPEC),
  ])

  if (!viewsResult.ok) {
    return (
      <PageShell title="Events">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load saved views</div>
          <div className="mt-1 text-muted-foreground">{viewsResult.error}</div>
          <div className="mt-2 text-muted-foreground">
            If the table does not exist yet, run{" "}
            <code>sql/patches/2026-09-10_admin_events.sql</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  const views: SavedView[] = viewsResult.data
  const active = resolveActiveView(EVENTS_SPEC, views, requestedId)
  const effectiveConfig = workingOverride ?? active.config
  const identity = await getEffectiveIdentity()

  const extra = ((q: unknown) => applyEventQuickFilters(q, quick)) as <Q>(q: Q) => Q

  const {
    rows,
    error: loadError,
    truncated,
  } = await fetchRows<AdminEventRow>(sb, EVENTS_SPEC, effectiveConfig, now, available, extra)

  if (loadError) {
    return (
      <PageShell title="Events">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_admin_events_all</div>
          <div className="mt-1 text-muted-foreground">{loadError}</div>
          <div className="mt-2 text-muted-foreground">
            If the view does not exist yet, run{" "}
            <code>sql/patches/2026-09-10_admin_events.sql</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  // ---- the client's ACCOUNT TEAM, for the circles in the Client column ----
  // Mirrors what Portfolio does: one bulk read of `accounts`, merged by
  // account_id. Cheap — 968 events sit on ~141 distinct accounts, and the page
  // shows at most ROW_CAP of them, so the id list is deduplicated first.
  //
  // Fail-soft: if this read fails the circles are simply absent. It is a
  // decoration on a column that already carries the client link, and it must
  // never be the reason the events table does not render.
  const teamByAccount = new Map<string, Record<string, string | null>>()
  {
    const ids = [...new Set(rows.map((r) => r.client_account_id).filter((id): id is string => !!id))]
    if (ids.length > 0) {
      const { data: teamData } = await sb
        .from("accounts")
        .select(["account_id", ...ACCOUNT_TEAM_KEYS].join(", "))
        .in("account_id", ids)
      for (const t of (teamData ?? []) as unknown as Record<string, string | null>[]) {
        if (t.account_id) teamByAccount.set(t.account_id, t)
      }
    }
  }
  const rowsWithTeam: AdminEventRow[] = rows.map((r) => {
    const t = r.client_account_id ? teamByAccount.get(r.client_account_id) : undefined
    if (!t) return r
    return {
      ...r,
      sales_lead_primary_name: t.sales_lead_primary_name ?? null,
      secondary_manager_name: t.secondary_manager_name ?? null,
      associate_name: t.associate_name ?? null,
      // Renamed on the way in: the row ALREADY has a logistics_coordinator_name,
      // which is the event's, not the account's. Overwriting it would silently
      // change what the Logistics column and the drawer show.
      logistics_coordinator_account_name: t.logistics_coordinator_name ?? null,
    }
  })

  // Per-view counts for the switcher labels, counted WITHOUT the quick filters:
  // the number beside a view name should say how big that view is, not how big it
  // happens to be under the current dropdown selection.
  const counts = await Promise.all(
    views.map(
      async (v) => [v.id, await countRows(sb, EVENTS_SPEC, v.config, now, available)] as const,
    ),
  )
  const viewCounts = Object.fromEntries(counts) as Record<string, number | null>

  // Only needed when the fetch was capped — that is the number the
  // "showing first N of M" notice reports.
  const matchingRows = truncated
    ? await countRows(sb, EVENTS_SPEC, effectiveConfig, now, available, extra)
    : rows.length

  // Dashboard-created TEST rows get a badge. The list view does not carry
  // is_test, so the (small) set of test ids is read off the table instead.
  const testIds = await testRowIds("events", "event_id")

  return (
    <PageShell title="Events" hideHeader canvas>
      <EventsView
        rows={markTestRows(rowsWithTeam, "event_id", testIds)}
        views={views}
        activeViewId={active.id}
        savedConfig={active.config}
        activeConfig={effectiveConfig}
        viewCounts={viewCounts}
        canManageSystemViews={role === "super_user"}
        /* Writes are refused while impersonating (saved-views invariant 4); the
           UI hides the save controls rather than offering a doomed click. */
        readOnlyViews={identity.impersonated}
        availableColumns={available ? [...available] : null}
        quickFilters={quick}
        truncated={truncated}
        rowCap={ROW_CAP}
        matchingRows={matchingRows}
      />
    </PageShell>
  )
}
