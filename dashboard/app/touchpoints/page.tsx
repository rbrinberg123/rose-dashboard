import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import type { AdminTouchpointRow } from "@/lib/types"
import { ROW_CAP, availableColumns, countRows, fetchRows } from "@/lib/table-views/query"
import { decodeConfig, resolveActiveView } from "@/lib/table-views/config"
import type { SavedView } from "@/lib/table-views/types"
import { TOUCHPOINTS_SPEC } from "@/lib/touchpoints/spec"
import {
  applyTouchpointQuickFilters,
  loadUserAliasGroups,
  type TouchpointQuickFilters,
} from "@/lib/touchpoints/filters"
import { listSavedViews } from "./actions"
import { TouchpointsView } from "./touchpoints-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Touches" }

const PATCH = "sql/patches/2026-09-15_admin_touchpoints.sql"

/**
 * CRM → Touches. Every logged client contact in the CRM — the mirror of the
 * Dynamics `phonecall` entity, which Rose uses for all contact, not just calls —
 * subject to the ACTIVE SAVED VIEW, whose columns, filters and sort are all
 * applied in the QUERY rather than in the browser.
 *
 * ── NAMING ─────────────────────────────────────────────────────────────────
 * The DISPLAY name is "Touches". Everything internal is still "touchpoints" —
 * the /touchpoints route, v_admin_touchpoints_all, public.touchpoints,
 * touchpoint_saved_views, TOUCHPOINTS_SPEC, and every file and symbol name.
 * Only user-visible strings changed, so nothing about the data layer moved.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * This page reads `v_admin_touchpoints_all`, which is UNSCOPED by design, through
 * the service-role client, which bypasses RLS — so a successful load hands the
 * caller every client's touchpoints. Three independent gates stand in front of
 * it, and the data fetch happens after all of them:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and /touchpoints
 *      is in ADMIN_ONLY_ROUTES — super-user-only, and NOT openable through the
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
 * back to what "All touchpoints" already returns to the same super-user caller.
 *
 * WRITES live in ./actions.ts, which delegates to lib/table-views/saved-views.ts
 * — the shared write path. Read that file's header before touching it.
 *
 * If you add a data read to this file, put it BELOW the guard.
 */
export default async function TouchpointsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[]
    cfg?: string | string[]
    client?: string | string[]
    type?: string | string[]
    contact?: string | string[]
    by?: string | string[]
    status?: string | string[]
  }>
}) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sp = await searchParams
  const requestedId = typeof sp.view === "string" ? sp.view : null
  const workingOverride = decodeConfig(TOUCHPOINTS_SPEC, typeof sp.cfg === "string" ? sp.cfg : null)

  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined
  const quick: TouchpointQuickFilters = {
    client: one(sp.client),
    type: one(sp.type),
    contact_type: one(sp.contact),
    created_by: one(sp.by),
    status: one(sp.status),
  }

  const sb = getSupabaseServer()
  const now = new Date()

  // The independent stages together. None needs the others; only the ROW FETCH
  // below depends on all three.
  //
  // NOTE WHAT IS NOT HERE: the filter-dropdown choices. The client asks for them
  // after the table renders (loadTouchpointFilterOptions) — nothing on screen
  // needs a dropdown's contents in order to paint a table.
  const [viewsResult, available, aliasGroups] = await Promise.all([
    listSavedViews(),
    availableColumns(sb, TOUCHPOINTS_SPEC),
    loadUserAliasGroups(sb),
  ])

  if (!viewsResult.ok) {
    return (
      <PageShell title="Touches">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load saved views</div>
          <div className="mt-1 text-muted-foreground">{viewsResult.error}</div>
          <div className="mt-2 text-muted-foreground">
            If the table does not exist yet, run <code>{PATCH}</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  const views: SavedView[] = viewsResult.data
  const active = resolveActiveView(TOUCHPOINTS_SPEC, views, requestedId)
  const effectiveConfig = workingOverride ?? active.config
  const identity = await getEffectiveIdentity()

  const extra = ((q: unknown) => applyTouchpointQuickFilters(q, quick, aliasGroups)) as <Q>(
    q: Q,
  ) => Q

  const {
    rows,
    error: loadError,
    truncated,
  } = await fetchRows<AdminTouchpointRow>(
    sb,
    TOUCHPOINTS_SPEC,
    effectiveConfig,
    now,
    available,
    extra,
  )

  if (loadError) {
    return (
      <PageShell title="Touches">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">
            Could not load v_admin_touchpoints_all
          </div>
          <div className="mt-1 text-muted-foreground">{loadError}</div>
          <div className="mt-2 text-muted-foreground">
            If the view does not exist yet, run <code>{PATCH}</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  // Per-view counts for the switcher labels, counted WITHOUT the quick filters:
  // the number beside a view name should say how big that view is, not how big it
  // happens to be under the current dropdown selection.
  const counts = await Promise.all(
    views.map(
      async (v) => [v.id, await countRows(sb, TOUCHPOINTS_SPEC, v.config, now, available)] as const,
    ),
  )
  const viewCounts = Object.fromEntries(counts) as Record<string, number | null>

  // Only needed when the fetch was capped — that is the number the
  // "showing first N of M" notice reports.
  const matchingRows = truncated
    ? await countRows(sb, TOUCHPOINTS_SPEC, effectiveConfig, now, available, extra)
    : rows.length

  return (
    <PageShell title="Touches" hideHeader canvas>
      <TouchpointsView
        rows={rows}
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
