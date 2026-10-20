import "server-only"

import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { DASHBOARD_ROW_BASE, easternLocalToIso } from "@/lib/crm-write"
import {
  GraphError,
  getMessageBodyText,
  listAttachmentNames,
  listInboxMessages,
  type InboxMessage,
} from "@/lib/graph"
import {
  DATA_CRM_MAILBOX,
  DATA_UPLOAD_CREATED_BY,
  DATA_UPLOAD_TASK,
  dataUploadDueDay,
  dataUploadTitle,
  findClientCandidates,
  matchClient,
  nextWatermark,
  pollSince,
  type ClientMatch,
  type MatchAccount,
} from "./rules"

/**
 * The data-crm@ MAILBOX POLL — one Data Upload task per new email thread.
 *
 * Runs inside the Dynamics sync cron (/api/sync-dynamics, every 10 minutes on
 * weekdays) as its own step: it never throws, so it can neither fail the
 * Dynamics sync nor be failed by it.
 *
 *   1. Read the watermark (mail_poll_state). First run: set it to now and stop
 *      — no backfill (move the watermark back by hand to backfill; see the patch).
 *   2. Graph: every Inbox message received since watermark − 10 min, oldest first.
 *   3. Per message (skipped if its internet_message_id is already ingested):
 *        - sent BY the mailbox itself → recorded, skip_reason 'own_mail'
 *        - first message of its conversationId → claim the conversation
 *          (data_crm_mail_conversations PK), insert its Data Upload task with
 *          the task_id chosen at claim time, record the message
 *        - any later message in that conversation → recorded, 'reply'
 *   4. Advance the watermark (rules.nextWatermark): to the newest message, or
 *      hold at the earliest failure so it is retried.
 *
 * IDEMPOTENT at every step. The message row is written LAST, so a crash
 * anywhere before it simply re-processes that message next poll: the
 * conversation claim is insert-or-ignore, and the task insert reuses the
 * claimed task_id with insert-or-ignore, so a retry can never make a second
 * task. Writes with the service-role client (no user session).
 */

export type MailPollResult = {
  mailbox: string
  status: "success" | "partial" | "error" | "initialised" | "skipped"
  fetched: number
  tasksCreated: number
  replies: number
  failed: number
  watermark?: string
  message?: string
}

/** Postgres / PostgREST "table does not exist" — the patch hasn't been run. */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  return !!err && (err.code === "42P01" || err.code === "PGRST205" || /does not exist|schema cache/i.test(err.message ?? ""))
}

const PATCH = "sql/patches/2026-10-19b_data_crm_mail.sql"

const EASTERN_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  dateStyle: "medium",
  timeStyle: "short",
})

/** The task's description: where it came from, then the email's preview. */
function describeEmail(m: InboxMessage, match: ClientMatch | null): string {
  const from = m.from?.emailAddress
  const sender = from?.name && from?.address ? `${from.name} <${from.address}>` : from?.address || from?.name || "unknown"
  const lines = [
    `Email to ${DATA_CRM_MAILBOX}`,
    `From: ${sender}`,
    `Received: ${EASTERN_STAMP.format(new Date(m.receivedDateTime))} ET`,
    `Subject: ${m.subject?.trim() || "(no subject)"}`,
  ]
  if (match) {
    const where = match.where === "sender" ? "" : ` in the ${match.where === "attachment" ? "attachment name" : match.where}`
    lines.push(`Client match: ${match.ticker ?? match.name ?? match.accountId} (by ${match.source.replace("_", " ")}${where})`)
  }
  const preview = m.bodyPreview?.trim()
  return preview ? `${lines.join("\n")}\n\n${preview}` : lines.join("\n")
}

/**
 * The body text and attachment NAMES used for client matching (never stored).
 * Best-effort: if Graph refuses either read, matching falls back to what it has
 * (`partial`), rather than failing the message and holding the watermark.
 */
async function readMatchText(
  m: InboxMessage,
): Promise<{ bodyText: string; attachmentNames: string[]; partial: boolean }> {
  const [body, names] = await Promise.allSettled([
    getMessageBodyText(DATA_CRM_MAILBOX, m.id),
    m.hasAttachments ? listAttachmentNames(DATA_CRM_MAILBOX, m.id) : Promise.resolve([] as string[]),
  ])
  for (const r of [body, names]) {
    if (r.status === "rejected") console.warn("[data-upload] match text read failed:", r.reason instanceof Error ? r.reason.message : r.reason)
  }
  return {
    bodyText: body.status === "fulfilled" ? body.value : (m.bodyPreview ?? ""),
    attachmentNames: names.status === "fulfilled" ? names.value : [],
    partial: body.status === "rejected" || names.status === "rejected",
  }
}

type MessageOutcome = "existing" | "own_mail" | "reply" | "task"

async function processMessage(
  sb: SupabaseClient,
  m: InboxMessage,
  accounts: () => Promise<MatchAccount[]>,
): Promise<MessageOutcome> {
  const key = m.internetMessageId?.trim() || `graph:${m.id}`

  const { data: seen, error: seenErr } = await sb
    .from("data_crm_mail_messages")
    .select("internet_message_id")
    .eq("internet_message_id", key)
    .maybeSingle()
  if (seenErr) throw seenErr
  if (seen) return "existing"

  const senderAddress = m.from?.emailAddress?.address?.trim() || null
  const senderName = m.from?.emailAddress?.name?.trim() || null
  const base = {
    internet_message_id: key,
    mailbox: DATA_CRM_MAILBOX,
    graph_message_id: m.id,
    conversation_id: m.conversationId,
    subject: m.subject,
    sender_name: senderName,
    sender_address: senderAddress,
    received_at: m.receivedDateTime,
    web_link: m.webLink,
    body_preview: m.bodyPreview,
    has_attachments: m.hasAttachments,
  }
  const record = async (extra: Record<string, unknown>) => {
    const { error } = await sb
      .from("data_crm_mail_messages")
      .upsert({ ...base, ...extra }, { onConflict: "internet_message_id", ignoreDuplicates: true })
    if (error) throw error
  }

  if (senderAddress?.toLowerCase() === DATA_CRM_MAILBOX) {
    await record({ skip_reason: "own_mail" })
    return "own_mail"
  }

  // Exchange always sets conversationId; a message without one is its own thread.
  const conversationId = m.conversationId || `msg:${key}`

  // Claim the conversation (insert-or-ignore), then read who owns it.
  const { error: claimErr } = await sb.from("data_crm_mail_conversations").upsert(
    { conversation_id: conversationId, mailbox: DATA_CRM_MAILBOX, task_id: randomUUID(), first_message_id: key },
    { onConflict: "conversation_id", ignoreDuplicates: true },
  )
  if (claimErr) throw claimErr
  const { data: conv, error: convErr } = await sb
    .from("data_crm_mail_conversations")
    .select("task_id, first_message_id, task_created_at")
    .eq("conversation_id", conversationId)
    .single()
  if (convErr) throw convErr

  if (conv.first_message_id !== key) {
    await record({ skip_reason: "reply" })
    return "reply"
  }

  // This message starts the conversation → its Data Upload task. Match the
  // client on the subject, the plain-text body and the attachment NAMES.
  const { bodyText, attachmentNames, partial } = await readMatchText(m)
  const matchInput = { subject: m.subject, bodyText, attachmentNames, senderAddress }
  const accts = await accounts()
  const match = matchClient(matchInput, accts)
  const candidates = match ? 1 : findClientCandidates(matchInput, accts).size
  // Stored on the message row: "ticker:attachment", or why there is no client.
  const matchSource = match
    ? `${match.source}:${match.where}`
    : candidates > 1
      ? `ambiguous:${candidates}`
      : partial
        ? "none:subject-only"
        : null
  const taskId = conv.task_id as string
  const dueDay = dataUploadDueDay()
  const now = new Date().toISOString()
  const row = {
    task_id: taskId,
    ...DASHBOARD_ROW_BASE,
    is_test: false,
    activity_type_code: "task",
    priority_code: 1,
    priority_label: "Normal",
    subject: dataUploadTitle({ subject: m.subject, senderName, senderAddress, match }),
    description: describeEmail(m, match),
    bcs_task_type_code: DATA_UPLOAD_TASK.typeCode,
    bcs_task_type_label: DATA_UPLOAD_TASK.typeLabel,
    bcs_task_subtype_code: DATA_UPLOAD_TASK.subtypeCode,
    bcs_task_subtype_label: DATA_UPLOAD_TASK.subtypeLabel,
    state_code: 0,
    state_label: "Open",
    status_code: 2,
    status_label: "Not Started",
    scheduled_end: easternLocalToIso(`${dueDay}T00:00`),
    // Unassigned: whoever marks it complete becomes the owner.
    owner_id: null,
    owner_name: null,
    bcs_account_id: match?.accountId ?? null,
    bcs_account_name: match?.name ?? null,
    regarding_id: match?.accountId ?? null,
    regarding_name: match?.name ?? null,
    regarding_type: match ? "account" : null,
    created_by_name: DATA_UPLOAD_CREATED_BY,
    modified_by_name: DATA_UPLOAD_CREATED_BY,
    created_on: now,
    modified_on: now,
  }

  if (!conv.task_created_at) {
    const { data: inserted, error: insErr } = await sb
      .from("tasks")
      .upsert(row, { onConflict: "task_id", ignoreDuplicates: true })
      .select("task_id")
    if (insErr) throw insErr
    const { error: markErr } = await sb
      .from("data_crm_mail_conversations")
      .update({ task_created_at: now })
      .eq("conversation_id", conversationId)
      .is("task_created_at", null)
    if (markErr) throw markErr
    if ((inserted ?? []).length > 0) {
      const { _raw, ...snapshot } = row
      void _raw
      await recordAudit({
        action: "create",
        entity: "tasks",
        recordId: taskId,
        changes: {
          ...snapshot,
          source_message: key,
          ...(match ? { match_source: matchSource } : { flag: `No client match${matchSource ? ` (${matchSource})` : ""}` }),
        },
        context: `automation:data-upload:mailbox${match ? "" : " · no client match"}`,
      })
    }
  }

  await record({ task_id: taskId, matched_account_id: match?.accountId ?? null, match_source: matchSource })
  return "task"
}

/** Poll data-crm@ once. Never throws — the outcome is in the result. */
export async function pollDataCrmMailbox(): Promise<MailPollResult> {
  const result: MailPollResult = {
    mailbox: DATA_CRM_MAILBOX,
    status: "success",
    fetched: 0,
    tasksCreated: 0,
    replies: 0,
    failed: 0,
  }
  const sb = getSupabaseServer()
  const now = new Date().toISOString()

  try {
    const { data: state, error: stateErr } = await sb
      .from("mail_poll_state")
      .select("last_received_at")
      .eq("mailbox", DATA_CRM_MAILBOX)
      .maybeSingle()
    if (isMissingTable(stateErr)) return { ...result, status: "skipped", message: `Run ${PATCH} first.` }
    if (stateErr) throw stateErr

    if (!state) {
      // First run: start from now — no backfill.
      const { error } = await sb.from("mail_poll_state").insert({
        mailbox: DATA_CRM_MAILBOX,
        last_received_at: now,
        last_polled_at: now,
        last_status: "initialised",
        last_fetched: 0,
        last_tasks_created: 0,
      })
      if (error) throw error
      return { ...result, status: "initialised", watermark: now }
    }

    const watermark = new Date(state.last_received_at as string).toISOString()
    let messages: InboxMessage[]
    let truncated = false
    try {
      ;({ messages, truncated } = await listInboxMessages(DATA_CRM_MAILBOX, pollSince(watermark)))
    } catch (e) {
      const msg =
        e instanceof GraphError && e.status === 403
          ? `Graph 403 — ${DATA_CRM_MAILBOX} is outside the app's Exchange Application Access Policy (or Mail.Read isn't consented). ${e.body.slice(0, 300)}`
          : e instanceof Error
            ? e.message
            : String(e)
      await sb
        .from("mail_poll_state")
        .update({ last_polled_at: now, last_status: "error", last_error: msg.slice(0, 2000), updated_at: now })
        .eq("mailbox", DATA_CRM_MAILBOX)
      return { ...result, status: "error", watermark, message: msg }
    }
    result.fetched = messages.length

    // Active clients, loaded once and only if a new thread needs matching.
    let accountsCache: Promise<MatchAccount[]> | null = null
    const loadAccounts = async (): Promise<MatchAccount[]> => {
      const { data, error } = await sb
        .from("accounts")
        .select("account_id, name, ticker_symbol, website_url, email")
        .eq("state_label", "Active")
        .limit(5000)
      if (error) {
        accountsCache = null // let the next message retry the read
        throw error
      }
      return (data ?? []) as MatchAccount[]
    }
    const accounts = () => (accountsCache ??= loadAccounts())

    const processed: { receivedAt: string; ok: boolean }[] = []
    const errors: string[] = []
    for (const m of messages) {
      try {
        const outcome = await processMessage(sb, m, accounts)
        if (outcome === "task") result.tasksCreated++
        if (outcome === "reply") result.replies++
        processed.push({ receivedAt: m.receivedDateTime, ok: true })
      } catch (e) {
        result.failed++
        processed.push({ receivedAt: m.receivedDateTime, ok: false })
        const err = e as { message?: string }
        errors.push(`${m.internetMessageId ?? m.id}: ${err?.message ?? String(e)}`)
      }
    }

    const next = nextWatermark(watermark, processed)
    result.watermark = next
    result.status = result.failed > 0 ? "partial" : "success"
    if (truncated) errors.push("More mail than one poll reads — the rest follows next poll.")
    if (errors.length) result.message = errors.join(" | ").slice(0, 2000)

    const { error: saveErr } = await sb
      .from("mail_poll_state")
      .update({
        last_received_at: next,
        last_polled_at: now,
        last_status: result.status,
        last_error: result.failed > 0 ? (result.message ?? null) : null,
        last_fetched: result.fetched,
        last_tasks_created: result.tasksCreated,
        updated_at: now,
      })
      .eq("mailbox", DATA_CRM_MAILBOX)
    if (saveErr) throw saveErr
    return result
  } catch (e) {
    const err = e as { message?: string }
    return { ...result, status: "error", message: err?.message ?? String(e) }
  }
}
