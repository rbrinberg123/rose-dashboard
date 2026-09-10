import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import type { AdminMeetingRow } from "@/lib/types"
import {
  ROW_CAP,
  availableColumns,
  countViewRows,
  fetchViewRows,
  loadHostAliasGroups,
  type QuickFilters,
} from "@/lib/meetings/query"
import { decodeConfig, resolveActiveView, type SavedView } from "@/lib/meetings/views"
import { listSavedViews } from "./views-actions"
import { MeetingsView } from "./meetings-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Meetings" }

/**
 * Meetings — reached from the CRM entry at the bottom of the main nav rail
 * (super-user-only; see canSeeCrmNav in lib/access-control.ts). Every meeting in
 * the CRM: all statuses, all
 * dates past and future, active and deactivated alike — subject to the ACTIVE
 * SAVED VIEW, whose columns, filters and sort are all applied in the QUERY
 * rather than in the browser.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * This page is the one place in the app that reads meetings WITHOUT
 * `resolveMeetingScope`. `v_admin_meetings_all` is unscoped by design, and the
 * read goes through the service-role client, which bypasses RLS — so a
 * successful load hands the caller every client's meetings. Three independent
 * gates stand in front of it, and the data fetch happens after all of them:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and
 *      /meetings is in ADMIN_ONLY_ROUTES — super-user-only, and NOT openable
 *      through the Admin → Roles matrix.
 *   2. The check below re-verifies the role in the page itself, so the page is
 *      still safe if it is ever reached by a path that skips the proxy.
 *   3. The Supabase query is only constructed *after* that check returns.
 *
 * The role is the EFFECTIVE one, so a super-user using "View as" previews the
 * denial exactly as the impersonated person would experience it, instead of
 * quietly keeping their own access.
 *
 * The `?view=` param is NOT a security boundary. It selects a saved view, and
 * `listSavedViews` only ever returns views the caller may see — so an id naming
 * someone else's personal view simply is not found and the default chain runs
 * instead. It also cannot widen the row set beyond what "All meetings" already
 * returns to the same (super-user) caller.
 *
 * SAVED-VIEW WRITES live in ./views-actions.ts, which carries its own security
 * contract. Read that file's header before touching it — it is the app's only
 * write path.
 *
 * If you add a data read to this file, put it BELOW the guard.
 */
export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[]
    cfg?: string | string[]
    client?: string | string[]
    host?: string | string[]
    fb?: string | string[]
  }>
}) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sp = await searchParams
  const requestedId = typeof sp.view === "string" ? sp.view : null
  // An UNSAVED working config from "Edit columns" / "Edit filters" — see
  // encodeConfig in lib/meetings/views.ts for why it rides in the URL. Validated
  // there; anything unparseable is ignored and the saved view's config is used.
  const workingOverride = decodeConfig(typeof sp.cfg === "string" ? sp.cfg : null)

  // The toolbar's Client / Host / Feedback dropdowns. Their own params rather
  // than part of the view config — see QuickFilters in lib/meetings/query.ts for
  // why. Anything that is not a non-empty string is simply "no filter".
  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined
  const quick: QuickFilters = { client: one(sp.client), host: one(sp.host), feedback: one(sp.fb) }

  const sb = getSupabaseServer()
  const now = new Date()

  // ── THE INDEPENDENT STAGES, TOGETHER ─────────────────────────────────────
  // None of these needs the others: the saved views come from their own table,
  // the column list is the database describing itself, and the alias map is a
  // tiny lookup. Only the ROW FETCH below depends on any of it (it needs the
  // resolved view and the column list), so that stays after.
  //
  // NOTE WHAT IS NOT HERE: the Client/Host/Feedback dropdown choices. Sourcing
  // those can take seconds when v_admin_meetings_filter_options is missing, and
  // nothing on screen needs them to paint a table — so the client asks for them
  // after render, via the loadMeetingFilterOptions action. Do not move that back
  // into this Promise.all; it would put a multi-second query in front of a
  // quarter-second one again.
  const [viewsResult, available, aliasGroups] = await Promise.all([
    listSavedViews(),
    availableColumns(sb),
    loadHostAliasGroups(sb),
  ])
  if (!viewsResult.ok) {
    return (
      <PageShell title="Meetings">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load saved views</div>
          <div className="mt-1 text-muted-foreground">{viewsResult.error}</div>
          <div className="mt-2 text-muted-foreground">
            If the table does not exist yet, run{" "}
            <code>sql/patches/2026-09-09_meeting_saved_views.sql</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  const views: SavedView[] = viewsResult.data
  const active = resolveActiveView(views, requestedId)
  // What actually drives the query: the working config when one is in flight,
  // otherwise the active view's saved config. `active` stays the SAVED baseline
  // so the switcher can tell whether there are unsaved changes and what Save
  // would write over.
  const effectiveConfig = workingOverride ?? active.config
  const identity = await getEffectiveIdentity()

  // Only the active view's rows, only its columns, and at most ROW_CAP of them —
  // see lib/meetings/query.ts. `available` is the deployed view's real column
  // list, so a column the SQL patches have not delivered is dropped rather than
  // erroring the page.
  const { rows, error: loadError, truncated } = await fetchViewRows<AdminMeetingRow>(
    sb,
    effectiveConfig,
    now,
    available,
    quick,
    aliasGroups,
  )

  if (loadError) {
    return (
      <PageShell title="Meetings">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_admin_meetings_all</div>
          <div className="mt-1 text-muted-foreground">{loadError}</div>
          <div className="mt-2 text-muted-foreground">
            If the view is missing columns the active view asks for, run{" "}
            <code>sql/patches/2026-09-09_admin_meetings_view_columns.sql</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  // Per-view row counts for the switcher's labels, counted in the DB (`head:
  // true` returns no rows). Built-ins plus saved rows is a small number of cheap
  // queries, run together; they fail soft to null, which renders as "—".
  // Per-view counts for the switcher labels. Counted WITHOUT the quick filters:
  // the number beside a view name should say how big that view is, not how big
  // it happens to be under the dropdown selection you have made — otherwise
  // every label moves when you pick a host. The toolbar's own count (the rows on
  // screen) is the one that reflects the filters.
  const counts = await Promise.all(
    views.map(async (v) => [v.id, await countViewRows(sb, v.config, now, available)] as const),
  )
  const viewCounts = Object.fromEntries(counts) as Record<string, number | null>

  // How many rows the active view + filters actually match. Only needed when the
  // fetch was capped — that is the number the "showing first N of M" notice
  // reports, and it is a count query, not another page of rows.
  const matchingRows = truncated
    ? await countViewRows(sb, effectiveConfig, now, available, quick, aliasGroups)
    : rows.length

  // Dynamics deep-link base for the per-row "open in CRM" icon. Same env var the
  // Admin hub reads, with the same default; the column is dropped entirely when
  // neither resolves, rather than linking somewhere invented.
  const crmBase =
    process.env.NEXT_PUBLIC_DYNAMICS_URL?.replace(/\/$/, "") ||
    "https://clientcrm.crm.dynamics.com"

  return (
    <PageShell title="Meetings" hideHeader canvas>
      <MeetingsView
        rows={rows}
        crmBase={crmBase}
        views={views}
        activeViewId={active.id}
        savedConfig={active.config}
        activeConfig={effectiveConfig}
        viewCounts={viewCounts}
        canManageSystemViews={role === "super_user"}
        /* Writes are refused while impersonating (views-actions invariant 4);
           the UI hides the save controls rather than offering a doomed click. */
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
