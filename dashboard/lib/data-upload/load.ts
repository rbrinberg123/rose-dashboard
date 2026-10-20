import "server-only"

import { getSupabaseServer } from "@/lib/supabase"
import { canAccessRoute } from "@/lib/access-control"
import { getEffectiveAllowedRoutes, getEffectiveRole } from "@/lib/effective-identity"
import { DATA_UPLOAD_CREATED_BY, DATA_UPLOAD_TASK, DATA_UPLOADS_ROUTE } from "./rules"

/**
 * May the EFFECTIVE person open Tools → Data Uploads? The same predicate
 * proxy.ts enforces: super user / admin always; anyone else only through an
 * Admin → Roles (or per-user) grant on /data-uploads. The page AND every server
 * action call this — the data is read with the service role (RLS bypassed).
 */
export async function canOpenDataUploads(): Promise<boolean> {
  const [role, allowed] = await Promise.all([getEffectiveRole(), getEffectiveAllowedRoutes()])
  return canAccessRoute(role, DATA_UPLOADS_ROUTE, allowed)
}

/** One open mailbox Data Upload task, with the email that created it. Serialisable. */
export type DataUploadRow = {
  taskId: string
  title: string
  clientName: string | null
  clientId: string | null
  /** ISO — the due date (Eastern midnight). */
  due: string | null
  createdOn: string | null
  isTest: boolean
  emailSubject: string | null
  senderName: string | null
  senderAddress: string | null
  receivedAt: string | null
  webLink: string | null
  bodyPreview: string | null
  hasAttachments: boolean
  matchSource: string | null
}

/** Postgres / PostgREST "table does not exist". */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? ""))
}

/**
 * Every OPEN Data Upload task the mailbox poll created (origin dashboard,
 * created_by_name = the mailbox automation, not closed), soonest due first.
 * Callers gate first (canOpenDataUploads). `patchMissing` = the 2026-10-19b
 * patch has not been run.
 */
export async function loadOpenDataUploads(): Promise<
  { ok: true; rows: DataUploadRow[] } | { ok: false; patchMissing: boolean; error: string }
> {
  const sb = getSupabaseServer()
  const { data: tasks, error } = await sb
    .from("tasks")
    .select("task_id, subject, bcs_account_id, bcs_account_name, scheduled_end, created_on, is_test")
    .eq("origin", "dashboard")
    .eq("bcs_task_subtype_label", DATA_UPLOAD_TASK.subtypeLabel)
    .eq("created_by_name", DATA_UPLOAD_CREATED_BY)
    .eq("state_label", "Open")
    .is("closed_at", null)
    .order("scheduled_end", { ascending: true, nullsFirst: false })
    .order("created_on", { ascending: true })
    .limit(1000)
  if (error) return { ok: false, patchMissing: false, error: error.message }

  const ids = (tasks ?? []).map((t) => t.task_id as string)
  const byTask = new Map<string, Record<string, unknown>>()
  if (ids.length) {
    const { data: mails, error: mErr } = await sb
      .from("data_crm_mail_messages")
      .select("task_id, subject, sender_name, sender_address, received_at, web_link, body_preview, has_attachments, match_source")
      .in("task_id", ids)
    if (mErr) return { ok: false, patchMissing: isMissingTable(mErr), error: mErr.message }
    for (const m of mails ?? []) byTask.set(m.task_id as string, m)
  } else {
    // Nothing open — still confirm the patch has been run, so the page can say so.
    const { error: probe } = await sb.from("data_crm_mail_messages").select("task_id").limit(1)
    if (probe) return { ok: false, patchMissing: isMissingTable(probe), error: probe.message }
  }

  const rows: DataUploadRow[] = (tasks ?? []).map((t) => {
    const m = byTask.get(t.task_id as string)
    return {
      taskId: t.task_id as string,
      title: (t.subject as string | null) ?? "Data Upload",
      clientName: (t.bcs_account_name as string | null) ?? null,
      clientId: (t.bcs_account_id as string | null) ?? null,
      due: (t.scheduled_end as string | null) ?? null,
      createdOn: (t.created_on as string | null) ?? null,
      isTest: t.is_test === true,
      emailSubject: (m?.subject as string | null) ?? null,
      senderName: (m?.sender_name as string | null) ?? null,
      senderAddress: (m?.sender_address as string | null) ?? null,
      receivedAt: (m?.received_at as string | null) ?? null,
      webLink: (m?.web_link as string | null) ?? null,
      bodyPreview: (m?.body_preview as string | null) ?? null,
      hasAttachments: m?.has_attachments === true,
      matchSource: (m?.match_source as string | null) ?? null,
    }
  })
  return { ok: true, rows }
}
