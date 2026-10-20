"use server"

/**
 * Tools → Data Uploads — server actions.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * A server action is its own entry point, so it re-checks the PAGE gate
 * (canOpenDataUploads — the same predicate proxy.ts runs) before reading
 * anything. Reads and writes use the service-role client (RLS bypassed).
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { isUuid } from "@/lib/crm-write"
import { recordAudit } from "@/lib/audit"
import { TASK_STATUS_OPTIONS } from "@/lib/tasks/create"
import { canOpenDataUploads } from "@/lib/data-upload/load"
import { DATA_UPLOADS_ROUTE, decideComplete, decideSetClient } from "@/lib/data-upload/rules"

/**
 * Mark a mailbox Data Upload task complete. ANYONE who can open the page may
 * complete ANY open one (decideComplete); doing so makes them the task's OWNER
 * and closes it with the existing completion fields — state/status Completed,
 * actual_end = now — plus the dashboard-owned closed_by_* / closed_at sidecar,
 * exactly like closeTask's dashboard-origin ("native") close.
 *
 * Guarded UPDATE: still Open and not closed, same origin — must change exactly
 * one row, so two people completing at once can't both win.
 */
export async function completeDataUploadTask(taskId: string): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  if (!(await canOpenDataUploads())) return fail("Not authorised.")
  const identity = await getEffectiveIdentity()
  if (!isUuid(taskId)) return fail("Unknown task.")

  const sb = getSupabaseServer()
  const { data: t, error } = await sb
    .from("tasks")
    .select(
      "task_id, origin, state_label, closed_at, bcs_task_subtype_label, created_by_name, owner_id, owner_name, is_test, bcs_account_id",
    )
    .eq("task_id", taskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!t) return fail("That task no longer exists.")

  // decideComplete includes the REQUIRED-CLIENT guard (clientRequiredToClose).
  const refused = decideComplete(
    {
      origin: t.origin as string | null,
      stateLabel: t.state_label as string | null,
      closedAt: t.closed_at as string | null,
      subtypeLabel: t.bcs_task_subtype_label as string | null,
      createdByName: t.created_by_name as string | null,
      clientId: t.bcs_account_id as string | null,
    },
    { userId: identity.userId, impersonated: identity.impersonated },
  )
  if (refused) return fail(refused)

  const now = new Date().toISOString()
  const completed = TASK_STATUS_OPTIONS.find((o) => o.key === "completed")!
  const { data: changed, error: upErr } = await sb
    .from("tasks")
    .update({
      owner_id: identity.userId,
      owner_name: identity.name,
      state_code: completed.state,
      state_label: completed.stateLabel,
      status_code: completed.status,
      status_label: completed.statusLabel,
      actual_end: now,
      closed_by_id: identity.userId,
      closed_by_name: identity.name,
      closed_at: now,
      modified_on: now,
      modified_by_id: identity.userId,
      modified_by_name: identity.name,
    })
    .eq("task_id", taskId)
    .eq("origin", "dashboard")
    .eq("state_label", "Open")
    .is("closed_at", null)
    // The required client, repeated in the WHERE so a concurrent clear can't slip past.
    .not("bcs_account_id", "is", null)
    .select("task_id")
  if (upErr) return fail(describeError(upErr))
  if (!changed || changed.length !== 1) {
    return fail("This task changed while you were looking at it — refresh and try again.")
  }

  await recordAudit({
    action: "update",
    entity: "tasks",
    recordId: taskId,
    changes: {
      owner_name: { from: (t.owner_name as string | null) ?? null, to: identity.name },
      state_label: { from: "Open", to: completed.stateLabel },
      closed_by_name: { from: null, to: identity.name },
    },
    context: `${DATA_UPLOADS_ROUTE} · Mark complete${t.is_test ? " · test" : ""}`,
  })

  revalidatePath(DATA_UPLOADS_ROUTE)
  revalidatePath("/tasks")
  revalidatePath("/my-dashboard")
  return ok()
}

/**
 * Set (or change) the CLIENT on a mailbox Data Upload task — the card's
 * required Client picker. Anyone who can open the page may do it while the
 * task is open (decideSetClient). The client must be ACTIVE; the name written
 * comes from a fresh read, never from the browser. Writes the task's client
 * and its Regarding (mailbox tasks regard the client, never an event).
 */
export async function setDataUploadClient(taskId: string, accountId: string): Promise<ActionResult<{ name: string }>> {
  // ---- GATE (must stay first) ----
  if (!(await canOpenDataUploads())) return fail("Not authorised.")
  const identity = await getEffectiveIdentity()
  if (!isUuid(taskId)) return fail("Unknown task.")
  if (!isUuid(accountId)) return fail("Pick a client.")

  const sb = getSupabaseServer()
  const { data: t, error } = await sb
    .from("tasks")
    .select("task_id, origin, state_label, closed_at, bcs_task_subtype_label, created_by_name, bcs_account_id, bcs_account_name, is_test")
    .eq("task_id", taskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!t) return fail("That task no longer exists.")
  const refused = decideSetClient(
    {
      origin: t.origin as string | null,
      stateLabel: t.state_label as string | null,
      closedAt: t.closed_at as string | null,
      subtypeLabel: t.bcs_task_subtype_label as string | null,
      createdByName: t.created_by_name as string | null,
    },
    { impersonated: identity.impersonated },
  )
  if (refused) return fail(refused)
  if (t.bcs_account_id === accountId) return ok({ name: (t.bcs_account_name as string | null) ?? "" })

  const { data: acct, error: aErr } = await sb
    .from("accounts")
    .select("account_id, name, state_label")
    .eq("account_id", accountId)
    .maybeSingle()
  if (aErr) return fail(describeError(aErr))
  if (!acct) return fail("That client no longer exists.")
  if (acct.state_label !== "Active") return fail("Pick an active client.")

  const now = new Date().toISOString()
  const { data: changed, error: upErr } = await sb
    .from("tasks")
    .update({
      bcs_account_id: acct.account_id,
      bcs_account_name: acct.name,
      regarding_id: acct.account_id,
      regarding_name: acct.name,
      regarding_type: "account",
      modified_on: now,
      modified_by_id: identity.userId,
      modified_by_name: identity.name,
    })
    .eq("task_id", taskId)
    .eq("origin", "dashboard")
    .eq("state_label", "Open")
    .is("closed_at", null)
    .select("task_id")
  if (upErr) return fail(describeError(upErr))
  if (!changed || changed.length !== 1) {
    return fail("This task changed while you were looking at it — refresh and try again.")
  }

  await recordAudit({
    action: "update",
    entity: "tasks",
    recordId: taskId,
    changes: {
      bcs_account_name: { from: (t.bcs_account_name as string | null) ?? null, to: acct.name as string },
    },
    context: `${DATA_UPLOADS_ROUTE} · Set client${t.is_test ? " · test" : ""}`,
  })

  revalidatePath(DATA_UPLOADS_ROUTE)
  revalidatePath("/tasks")
  return ok({ name: acct.name as string })
}
