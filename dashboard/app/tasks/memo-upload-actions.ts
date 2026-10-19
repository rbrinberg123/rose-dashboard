"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { hasSuperUserPrivileges } from "@/lib/access-control"
import { recordAudit } from "@/lib/audit"
import { isUuid } from "@/lib/crm-write"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { GraphError, uploadToCrmDocuments } from "@/lib/graph"
import { idsForEmail } from "@/lib/time-off-requests/reviewers"
import { getSupabaseServer } from "@/lib/supabase"
import {
  MEMO_FILE_CONTENT_TYPE,
  canUploadMemo,
  memoFileExtension,
  memoFileName,
  memoUploadErrorMessage,
  validateMemoFile,
} from "@/lib/tasks/memo-file"
import { readMemoFile } from "@/lib/tasks/memo-file-server"
import type { MemoFileRef } from "@/lib/tasks/record"

/**
 * Marketing Memo DOCUMENT upload — the task drawer's "Memo document" field.
 *
 * The file goes to the CRMDocuments SharePoint site's Documents library via
 * Microsoft Graph, app-only (lib/graph/sharepoint.ts — the same app, token and
 * HTTP core as calendar and mail), named after the task (memoFileName). The
 * resulting driveItem id + webUrl are stored on the task (tasks.memo_file_*,
 * sql/patches/2026-10-19_task_memo_file.sql).
 *
 * GATE (server-side; the service-role client bypasses RLS, so the hidden
 * button is never the guard): a Marketing Memo task, and the viewer is its
 * OWNER (any of their CRM ids) or a super user — never in "View as"
 * (canUploadMemo). Works on Dynamics- and dashboard-origin tasks alike: it
 * writes only dashboard-owned columns.
 *
 * Re-upload on the same task → a new VERSION of the stored item. A first
 * upload whose name is taken by another file → SharePoint keeps both.
 * Every failure returns a message (a 403 names the missing Graph grant).
 */
export async function uploadMarketingMemo(formData: FormData): Promise<ActionResult<MemoFileRef>> {
  // ---- GATE (must stay first) ----
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (!role) return fail("Not authorised.")

  const taskId = String(formData.get("taskId") ?? "")
  if (!isUuid(taskId)) return fail("Unknown task.")
  const file = formData.get("file")
  if (!(file instanceof File)) return fail("Choose a file to upload.")

  const sb = getSupabaseServer()
  const { data: task, error } = await sb
    .from("tasks")
    .select("task_id, subject, owner_id, bcs_task_subtype_label, origin")
    .eq("task_id", taskId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!task) return fail("That task no longer exists.")

  const myIds = new Set([...(await idsForEmail(identity.email)), identity.userId ?? ""].filter(Boolean))
  const refused = canUploadMemo(
    { subtypeLabel: (task.bcs_task_subtype_label as string | null) ?? null, ownerId: (task.owner_id as string | null) ?? null },
    { myIds, isAdmin: hasSuperUserPrivileges(role), impersonated: identity.impersonated },
  )
  if (refused) return fail(refused)

  const invalid = validateMemoFile({ name: file.name, size: file.size })
  if (invalid) return fail(invalid)
  const ext = memoFileExtension(file.name)!

  // Before the SQL patch the link couldn't be stored — refuse before uploading.
  const current = await readMemoFile(taskId)
  if (!current.ok) return fail(current.error)

  const fileName = memoFileName(task.subject as string | null, ext)
  let item
  try {
    item = await uploadToCrmDocuments({
      fileName,
      bytes: await file.arrayBuffer(),
      contentType: MEMO_FILE_CONTENT_TYPE[ext],
      replaceItemId: current.itemId,
    })
  } catch (e) {
    console.warn("[tasks] marketing memo upload failed:", e instanceof Error ? e.message : e)
    if (e instanceof GraphError) return fail(memoUploadErrorMessage(e.status, e.body.slice(0, 300)))
    const msg = e instanceof Error ? e.message : String(e)
    if (/Missing GRAPH_/.test(msg)) return fail("SharePoint upload isn't configured on this server (Graph credentials missing).")
    return fail(memoUploadErrorMessage(null, msg))
  }

  const uploadedAt = new Date().toISOString()
  const patch = {
    memo_file_item_id: item.id,
    memo_file_web_url: item.webUrl,
    memo_file_name: item.name,
    memo_file_uploaded_at: uploadedAt,
    memo_file_uploaded_by_id: identity.userId,
    memo_file_uploaded_by_name: identity.name,
  }
  const { data: changed, error: upErr } = await sb.from("tasks").update(patch).eq("task_id", taskId).select("task_id")
  if (upErr || !changed || changed.length !== 1) {
    // The file IS in SharePoint; only the link failed to save — say so.
    return fail(
      `The document was uploaded to SharePoint (${item.name}), but the link couldn't be saved on the task: ${
        upErr ? describeError(upErr) : "no row updated"
      }`,
    )
  }

  await recordAudit({
    action: "update",
    entity: "tasks",
    recordId: taskId,
    changes: {
      memo_file_name: { from: current.ref?.name ?? null, to: item.name },
      memo_file_web_url: item.webUrl,
      memo_file_item_id: item.id,
      mode: current.itemId && current.itemId === item.id ? "new version" : "new file",
    },
    context: `/tasks · Marketing Memo upload · ${task.origin} row`,
  })

  revalidatePath("/tasks")
  return ok({ name: item.name, webUrl: item.webUrl, uploadedAt, uploadedByName: identity.name })
}
