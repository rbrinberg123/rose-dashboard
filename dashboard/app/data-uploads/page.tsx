import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageShell } from "@/components/page-shell"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { canOpenDataUploads, loadOpenDataUploads } from "@/lib/data-upload/load"
import { DATA_CRM_MAILBOX } from "@/lib/data-upload/rules"
import { readActiveAccountOptions } from "@/lib/crm-write"
import type { AccountOption } from "@/lib/types"
import { DataUploadsView } from "./data-uploads-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Data Uploads" }

const PATCH = "sql/patches/2026-10-19b_data_crm_mail.sql"

/**
 * Tools → Data Uploads. Every OPEN Data Upload task the data-crm@ mailbox poll
 * created (lib/data-upload/poll.ts), soonest due first. Click one for the email
 * it came from (sender, received, a link to open it in Outlook) and Mark
 * complete, which makes the clicker the owner and closes the task.
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * Super-user (and admin) by default, grantable to other roles through the
 * Admin → Roles matrix (/data-uploads — NOT in ADMIN_ONLY_ROUTES). proxy.ts
 * runs canAccessRoute first; this page re-checks the same predicate before
 * any read, because the data is read with the service role (RLS bypassed).
 * The Mark complete action re-checks it again (app/data-uploads/actions.ts).
 */
export default async function DataUploadsPage() {
  // ---- GATE (must stay first — nothing above this line may touch data) ----
  if (!(await canOpenDataUploads())) redirect("/no-access")

  const [res, identity, clientsRes] = await Promise.all([
    loadOpenDataUploads(),
    getEffectiveIdentity(),
    // The card's required Client picker: active clients (the same rule as every
    // CRM client picker). Gated above; readActiveAccountOptions has no gate.
    readActiveAccountOptions(),
  ])
  // A task's client stays listed even if it has since gone inactive.
  const clientOptions: AccountOption[] = clientsRes.ok ? [...clientsRes.data] : []
  if (res.ok) {
    const known = new Set(clientOptions.map((o) => o.account_id))
    for (const r of res.rows) {
      if (r.clientId && !known.has(r.clientId)) {
        known.add(r.clientId)
        clientOptions.push({ account_id: r.clientId, name: r.clientName ?? "Client", ticker_symbol: null })
      }
    }
  }
  const editBlocked = identity.impersonated ? "Exit “View as” to change tasks." : null
  const completeBlocked = identity.impersonated
    ? "Exit “View as” to complete tasks."
    : !identity.userId
      ? "Your sign-in isn't linked to a CRM user."
      : null

  return (
    <PageShell
      title="Data Uploads"
      description={`Open Data Upload tasks from new email to ${DATA_CRM_MAILBOX}`}
      canvas
    >
      {res.ok ? (
        <DataUploadsView
          rows={res.rows}
          clientOptions={clientOptions}
          editBlocked={editBlocked}
          completeBlocked={completeBlocked}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-white p-6 text-sm text-muted-foreground">
          {res.patchMissing
            ? `Data Uploads isn't switched on yet — run ${PATCH} in the Supabase SQL editor.`
            : `Could not load Data Upload tasks: ${res.error}`}
        </div>
      )}
    </PageShell>
  )
}
