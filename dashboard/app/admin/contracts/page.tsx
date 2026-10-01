import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import type { AdminContractRow } from "@/lib/types"
import { ROW_CAP, availableColumns, countRows, fetchRows } from "@/lib/table-views/query"
import { decodeConfig, resolveActiveView } from "@/lib/table-views/config"
import type { SavedView } from "@/lib/table-views/types"
import { CONTRACTS_SPEC } from "@/lib/contracts/spec"
import { applyContractQuickFilters, type ContractQuickFilters } from "@/lib/contracts/filters"
import { listSavedViews } from "./actions"
import { ContractsView } from "./contracts-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Contract Management" }

const PATCH = "sql/patches/2026-09-29_contracts_crm.sql"

/**
 * Admin → Contract Management (/admin/contracts). Every contract in the CRM — the
 * Dynamics `bcs_contract` mirror plus contracts created in the dashboard —
 * subject to the ACTIVE SAVED VIEW, applied in the QUERY.
 *
 * NOT the reporting page at /contract-management (Contracts section), which is
 * a one-row-per-client expiry summary over v_contract_management and is
 * unchanged.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * Reads the UNSCOPED v_admin_contracts_all with the service-role client (RLS
 * bypassed) — every client's retainer. Three gates, the same as the other
 * super-user admin pages (Audit Log, Account Teams, Time Off Reviewers):
 *   1. proxy.ts: /admin/contracts is in ADMIN_ONLY_ROUTES (super-user only,
 *      never delegable through the Roles matrix);
 *   2. the admin page gate below (effective role must be super_user), before
 *      any data read;
 *   3. every server action in ./actions.ts re-checks on its own.
 *
 * If you add a data read to this file, put it BELOW the guard.
 */
export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string | string[]
    cfg?: string | string[]
    client?: string | string[]
    scope?: string | string[]
    status?: string | string[]
    currency?: string | string[]
    autoRenew?: string | string[]
  }>
}) {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") redirect("/no-access")

  const sp = await searchParams
  const requestedId = typeof sp.view === "string" ? sp.view : null
  const workingOverride = decodeConfig(CONTRACTS_SPEC, typeof sp.cfg === "string" ? sp.cfg : null)

  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined
  const quick: ContractQuickFilters = {
    client: one(sp.client),
    scope: one(sp.scope),
    status: one(sp.status),
    currency: one(sp.currency),
    autoRenew: one(sp.autoRenew),
  }

  const sb = getSupabaseServer()
  const now = new Date()

  const [viewsResult, available] = await Promise.all([
    listSavedViews(),
    availableColumns(sb, CONTRACTS_SPEC),
  ])

  if (!viewsResult.ok) {
    return (
      <PageShell title="Contract Management">
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
  const active = resolveActiveView(CONTRACTS_SPEC, views, requestedId)
  const effectiveConfig = workingOverride ?? active.config
  const identity = await getEffectiveIdentity()

  const extra = ((q: unknown) => applyContractQuickFilters(q, quick)) as <Q>(q: Q) => Q

  const {
    rows,
    error: loadError,
    truncated,
  } = await fetchRows<AdminContractRow>(sb, CONTRACTS_SPEC, effectiveConfig, now, available, extra)

  if (loadError) {
    return (
      <PageShell title="Contract Management">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_admin_contracts_all</div>
          <div className="mt-1 text-muted-foreground">{loadError}</div>
          <div className="mt-2 text-muted-foreground">
            If the view does not exist yet, run <code>{PATCH}</code> in Supabase.
          </div>
        </div>
      </PageShell>
    )
  }

  // Per-view counts for the switcher, WITHOUT the quick filters.
  const counts = await Promise.all(
    views.map(
      async (v) => [v.id, await countRows(sb, CONTRACTS_SPEC, v.config, now, available)] as const,
    ),
  )
  const viewCounts = Object.fromEntries(counts) as Record<string, number | null>

  const matchingRows = truncated
    ? await countRows(sb, CONTRACTS_SPEC, effectiveConfig, now, available, extra)
    : rows.length

  return (
    <PageShell title="Contract Management" hideHeader canvas>
      <ContractsView
        rows={rows}
        views={views}
        activeViewId={active.id}
        savedConfig={active.config}
        activeConfig={effectiveConfig}
        viewCounts={viewCounts}
        canManageSystemViews={role === "super_user"}
        /* Writes are refused while impersonating; hide the save controls. */
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
