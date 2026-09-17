import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import type { AdminAccountRow } from "@/lib/types"
import { ROW_CAP, availableColumns, countRows, fetchRows } from "@/lib/table-views/query"
import { decodeConfig, resolveActiveView } from "@/lib/table-views/config"
import type { SavedView } from "@/lib/table-views/types"
import { ACCOUNTS_SPEC } from "@/lib/accounts/spec"
import {
  applyAccountQuickFilters,
  ACCOUNT_QUICK_FILTER_KEYS,
  type AccountQuickFilters,
} from "@/lib/accounts/filters"
import { listSavedViews } from "./actions"
import { AccountsView } from "./accounts-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Clients" }

const PATCH = "sql/patches/2026-09-17_admin_accounts.sql"

/**
 * CRM → Clients. Every client in the CRM — the mirror of the Dynamics `account`
 * entity, the ISSUERS Rose works for — subject to the ACTIVE SAVED VIEW, whose
 * columns, filters and sort are all applied in the QUERY rather than in the
 * browser.
 *
 * ── THIS IS NOT THE PORTFOLIO TABLE ────────────────────────────────────────
 * /portfolio reads v_client_portfolio: an ANALYTICS rollup over ACTIVE clients
 * only, carrying meeting counts, retainers, open slots and a latest note status,
 * none of which live on the account row. This page is the RECORD — every
 * account, active and inactive, with only its own flattened fields, plus saved
 * views, a column picker and a record drawer. Both exist deliberately; neither
 * replaces the other, and nothing here reads or changes v_client_portfolio.
 *
 * The route is /accounts because the entity, the mirror table and the view are
 * all `account`; only the label says "Clients". Same split as Touches, whose
 * route stays /touchpoints. It deliberately avoids /clients/*, which is the
 * scoped To-Do worklist, and /portfolio.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * This page reads `v_admin_accounts_all`, which is UNSCOPED by design, through
 * the service-role client, which bypasses RLS — so a successful load hands the
 * caller every client Rose has, including the ~122 inactive ones the scoped
 * pages never show.
 *
 * Three independent gates stand in front of it, and the data fetch happens after
 * all of them:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and /accounts is
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
 * back to what "All clients" already returns to the same super-user caller.
 *
 * `_raw` is never selected by the list. Only the drawer's single-row fetch reads
 * it — see the note in ./actions.ts.
 *
 * WRITES live in ./actions.ts, which delegates to lib/table-views/saved-views.ts
 * — the shared write path. Read that file's header before touching it. There are
 * no account writes at all: "Add New Client" is inert, and neither of the
 * dashboard-owned accounts-overlay tables (account_status, account_team_members)
 * is read or written from here.
 *
 * If you add a data read to this file, put it BELOW the guard.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sp = await searchParams
  const requestedId = typeof sp.view === "string" ? sp.view : null
  const workingOverride = decodeConfig(
    ACCOUNTS_SPEC,
    typeof sp.cfg === "string" ? sp.cfg : null,
  )

  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined

  // Read the eleven dropdowns from the ONE key list, so a filter can never be
  // added to the toolbar and silently dropped here.
  const quick = Object.fromEntries(
    ACCOUNT_QUICK_FILTER_KEYS.map((k) => [k, one(sp[k])]),
  ) as AccountQuickFilters

  const sb = getSupabaseServer()
  const now = new Date()

  // The independent stages together. Neither needs the other; only the ROW FETCH
  // below depends on both.
  //
  // NOTE WHAT IS NOT HERE:
  //   * the filter-dropdown choices. The client asks for them after the table
  //     renders (loadAccountFilterOptions) — nothing on screen needs a
  //     dropdown's contents in order to paint a table.
  //   * an alias-group load. The five account-team filters match on the display
  //     NAME rather than on a systemuser id, which unions the duplicate records
  //     two people carry without an expansion step — see lib/accounts/filters.ts.
  //   * an account-team bulk read. app/events/page.tsx has to merge the team in
  //     from `accounts` by account_id; here the row IS the account, so the four
  //     name columns are already on it (ACCOUNT_ALWAYS_SELECT).
  const [viewsResult, available] = await Promise.all([
    listSavedViews(),
    availableColumns(sb, ACCOUNTS_SPEC),
  ])

  if (!viewsResult.ok) {
    return (
      <PageShell title="Clients">
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
  const active = resolveActiveView(ACCOUNTS_SPEC, views, requestedId)
  const effectiveConfig = workingOverride ?? active.config
  const identity = await getEffectiveIdentity()

  const extra = ((q: unknown) => applyAccountQuickFilters(q, quick)) as <Q>(q: Q) => Q

  const {
    rows,
    error: loadError,
    truncated,
  } = await fetchRows<AdminAccountRow>(sb, ACCOUNTS_SPEC, effectiveConfig, now, available, extra)

  if (loadError) {
    return (
      <PageShell title="Clients">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_admin_accounts_all</div>
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
      async (v) => [v.id, await countRows(sb, ACCOUNTS_SPEC, v.config, now, available)] as const,
    ),
  )
  const viewCounts = Object.fromEntries(counts) as Record<string, number | null>

  // Only needed when the fetch was capped — that is the number the
  // "showing first N of M" notice reports.
  const matchingRows = truncated
    ? await countRows(sb, ACCOUNTS_SPEC, effectiveConfig, now, available, extra)
    : rows.length

  return (
    <PageShell title="Clients" hideHeader canvas>
      <AccountsView
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
