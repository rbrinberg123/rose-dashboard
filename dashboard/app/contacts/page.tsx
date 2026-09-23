import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import type { AdminContactRow } from "@/lib/types"
import { ROW_CAP, availableColumns, countRows, fetchRows } from "@/lib/table-views/query"
import { decodeConfig, resolveActiveView } from "@/lib/table-views/config"
import type { SavedView } from "@/lib/table-views/types"
import { CONTACTS_SPEC } from "@/lib/contacts/spec"
import {
  applyContactQuickFilters,
  CONTACT_QUICK_FILTER_KEYS,
  type ContactQuickFilters,
} from "@/lib/contacts/filters"
import { listSavedViews } from "./actions"
import { ContactsView } from "./contacts-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Contacts" }

const PATCH = "sql/patches/2026-09-16_admin_contacts.sql"

/**
 * CRM → Contacts. Every contact in the CRM — the mirror of the Dynamics
 * `contact` entity, the PEOPLE at client companies — subject to the ACTIVE SAVED
 * VIEW, whose columns, filters and sort are all applied in the QUERY rather than
 * in the browser.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * This page reads `v_admin_contacts_all`, which is UNSCOPED by design, through
 * the service-role client, which bypasses RLS — so a successful load hands the
 * caller every contact at every client.
 *
 * This is the only CRM table that is mostly PERSONAL data: names, job titles,
 * employers, previous employers, and a do-not-call flag. Notes is the firm's
 * candid assessment of its clients; this one is a directory of named individuals
 * outside the firm. Treat a leak here as its own category of problem.
 *
 * Three independent gates stand in front of it, and the data fetch happens after
 * all of them:
 *
 *   1. proxy.ts runs `canAccessRoute` before this file renders, and /contacts is
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
 * back to what "All contacts" already returns to the same super-user caller.
 *
 * `_raw` is never selected by the list. Only the drawer's single-row fetch reads
 * it — see the note in ./actions.ts.
 *
 * WRITES live in ./actions.ts, which delegates to lib/table-views/saved-views.ts
 * — the shared write path. Read that file's header before touching it. There are
 * "Add New Contact" IS live — createContact in ./actions.ts (origin='dashboard').
 *
 * If you add a data read to this file, put it BELOW the guard.
 */
export default async function ContactsPage({
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
    CONTACTS_SPEC,
    typeof sp.cfg === "string" ? sp.cfg : null,
  )

  const one = (v: string | string[] | undefined) =>
    typeof v === "string" && v.trim() ? v.trim() : undefined

  // Read the ten dropdowns from the ONE key list, so a filter can never be
  // added to the toolbar and silently dropped here.
  const quick = Object.fromEntries(
    CONTACT_QUICK_FILTER_KEYS.map((k) => [k, one(sp[k])]),
  ) as ContactQuickFilters

  const sb = getSupabaseServer()
  const now = new Date()

  // The independent stages together. Neither needs the other; only the ROW FETCH
  // below depends on both.
  //
  // NOTE WHAT IS NOT HERE: the filter-dropdown choices. The client asks for them
  // after the table renders (loadContactFilterOptions) — nothing on screen needs
  // a dropdown's contents in order to paint a table.
  //
  // Nor is there an alias-group load, unlike the five sibling pages: none of this
  // entity's filters is a systemuser, so there is nothing to expand.
  const [viewsResult, available] = await Promise.all([
    listSavedViews(),
    availableColumns(sb, CONTACTS_SPEC),
  ])

  if (!viewsResult.ok) {
    return (
      <PageShell title="Contacts">
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
  const active = resolveActiveView(CONTACTS_SPEC, views, requestedId)
  const effectiveConfig = workingOverride ?? active.config
  const identity = await getEffectiveIdentity()

  const extra = ((q: unknown) => applyContactQuickFilters(q, quick)) as <Q>(q: Q) => Q

  const {
    rows,
    error: loadError,
    truncated,
  } = await fetchRows<AdminContactRow>(sb, CONTACTS_SPEC, effectiveConfig, now, available, extra)

  if (loadError) {
    return (
      <PageShell title="Contacts">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_admin_contacts_all</div>
          <div className="mt-1 text-muted-foreground">{loadError}</div>
          <div className="mt-2 text-muted-foreground">
            If the view does not exist yet, run <code>{PATCH}</code> in Supabase. It also needs{" "}
            <code>sql/23_contacts_table.sql</code> to have been run first.
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
      async (v) => [v.id, await countRows(sb, CONTACTS_SPEC, v.config, now, available)] as const,
    ),
  )
  const viewCounts = Object.fromEntries(counts) as Record<string, number | null>

  // Only needed when the fetch was capped — that is the number the
  // "showing first N of M" notice reports.
  const matchingRows = truncated
    ? await countRows(sb, CONTACTS_SPEC, effectiveConfig, now, available, extra)
    : rows.length

  return (
    <PageShell title="Contacts" hideHeader canvas>
      <ContactsView
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
