import "server-only"

import { randomUUID } from "node:crypto"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { DASHBOARD_ROW_BASE, easternLocalToIso, isoToEasternDate } from "@/lib/crm-write"
import {
  MARKETING_MEMO_CREATED_BY,
  MARKETING_MEMO_TASK,
  marketingMemoDueDay,
  marketingMemoSubject,
} from "./marketing-memo"

/**
 * The event's auto-created MARKETING MEMO task (rules: ./marketing-memo.ts).
 *
 * Runs app-side right after createEvent's insert — the same moment the
 * database's trg_events_auto_feedback_report creates the Feedback report — and
 * writes with the service-role client, the same way the review-owner hand-off
 * does (lib/feedback-reports/review-owner.ts). No SQL change.
 *
 *   Type / sub-type  Outreach / Marketing Memo (the existing pair, 755860014)
 *   Owner            the client's teaser — accounts.teaser_id / teaser_name
 *                    (memo = teaser). No teaser → created UNASSIGNED (shown as
 *                    "System"), and the audit row says so.
 *   Due              Launch Week − 7 days, Eastern midnight; blank with no
 *                    Launch Week. Kept in step by syncEventMarketingMemoDue on
 *                    every event edit while the memo is Open.
 *   Idempotent       skipped when the event already has ANY Marketing Memo task
 *                    (any state, any author) — mirroring the Feedback report's
 *                    "already has a report" guard.
 *   Skipped          when the event's "Memo Not Required" is ticked.
 *
 * Best-effort, like the review-owner hand-off: a failure is logged and never
 * fails the event save (the event itself was written).
 */
export async function createEventMarketingMemo(eventId: string): Promise<void> {
  try {
    const sb = getSupabaseServer()
    const { data: ev, error } = await sb
      .from("events")
      .select("event_id, name, origin, is_test, client_account_id, client_account_name, proposed_launch_date, teaser_not_required")
      .eq("event_id", eventId)
      .maybeSingle()
    if (error) throw error
    if (!ev || ev.origin !== "dashboard") return
    if (ev.teaser_not_required === true) return

    // Idempotent: one Marketing Memo per event, ever.
    const { data: existing, error: exErr } = await sb
      .from("tasks")
      .select("task_id")
      .eq("bcs_event_id", eventId)
      .eq("bcs_task_subtype_label", MARKETING_MEMO_TASK.subtypeLabel)
      .limit(1)
    if (exErr) throw exErr
    if ((existing ?? []).length > 0) return

    let teaserId: string | null = null
    let teaserName: string | null = null
    if (ev.client_account_id) {
      const { data: acct, error: acctErr } = await sb
        .from("accounts")
        .select("teaser_id, teaser_name")
        .eq("account_id", ev.client_account_id as string)
        .maybeSingle()
      if (acctErr) throw acctErr
      teaserId = (acct?.teaser_id as string | null) ?? null
      teaserName = teaserId ? ((acct?.teaser_name as string | null) ?? null) : null
    }

    const dueDay = marketingMemoDueDay(isoToEasternDate(ev.proposed_launch_date) || null)
    const subject = marketingMemoSubject(ev.name as string | null)
    const now = new Date().toISOString()
    const row = {
      task_id: randomUUID(),
      ...DASHBOARD_ROW_BASE,
      is_test: ev.is_test === true,
      activity_type_code: "task",
      priority_code: 1,
      priority_label: "Normal",
      subject,
      bcs_task_type_code: MARKETING_MEMO_TASK.typeCode,
      bcs_task_type_label: MARKETING_MEMO_TASK.typeLabel,
      bcs_task_subtype_code: MARKETING_MEMO_TASK.subtypeCode,
      bcs_task_subtype_label: MARKETING_MEMO_TASK.subtypeLabel,
      state_code: 0,
      state_label: "Open",
      status_code: 2,
      status_label: "Not Started",
      scheduled_end: dueDay ? easternLocalToIso(`${dueDay}T00:00`) : null,
      owner_id: teaserId,
      owner_name: teaserName,
      bcs_account_id: ev.client_account_id ?? null,
      bcs_account_name: ev.client_account_name ?? null,
      bcs_event_id: ev.event_id,
      bcs_event_name: ev.name ?? null,
      regarding_id: ev.event_id,
      regarding_name: ev.name ?? null,
      regarding_type: "bcs_event",
      created_by_name: MARKETING_MEMO_CREATED_BY,
      modified_by_name: MARKETING_MEMO_CREATED_BY,
      created_on: now,
      modified_on: now,
    }
    const { error: insErr } = await sb.from("tasks").insert(row)
    if (insErr) throw insErr

    const { _raw, ...snapshot } = row
    void _raw
    await recordAudit({
      action: "create",
      entity: "tasks",
      recordId: row.task_id,
      changes: { ...snapshot, ...(teaserId ? {} : { flag: "No teaser on the client — memo created unassigned" }) },
      context: `automation:marketing-memo:event-created${teaserId ? "" : " · no teaser"}`,
    })
  } catch (e) {
    console.warn("[events] marketing memo create failed:", e instanceof Error ? e.message : e)
  }
}

/**
 * Keep the automation memo's due date at Launch Week − 7 after an event edit.
 * Only the Open, automation-created memo of a dashboard event is touched; a
 * memo someone made by hand, or one already closed, keeps its date.
 * Best-effort, like the create.
 */
export async function syncEventMarketingMemoDue(eventId: string): Promise<void> {
  try {
    const sb = getSupabaseServer()
    const { data: ev, error } = await sb
      .from("events")
      .select("origin, proposed_launch_date")
      .eq("event_id", eventId)
      .maybeSingle()
    if (error) throw error
    if (!ev || ev.origin !== "dashboard") return

    const dueDay = marketingMemoDueDay(isoToEasternDate(ev.proposed_launch_date) || null)
    const due = dueDay ? easternLocalToIso(`${dueDay}T00:00`) : null

    const { data: memos, error: mErr } = await sb
      .from("tasks")
      .select("task_id, scheduled_end")
      .eq("bcs_event_id", eventId)
      .eq("bcs_task_subtype_label", MARKETING_MEMO_TASK.subtypeLabel)
      .eq("origin", "dashboard")
      .eq("created_by_name", MARKETING_MEMO_CREATED_BY)
      .eq("state_label", "Open")
    if (mErr) throw mErr

    for (const m of memos ?? []) {
      const cur = (m.scheduled_end as string | null) ?? null
      if ((cur ? new Date(cur).getTime() : null) === (due ? new Date(due).getTime() : null)) continue
      const { error: upErr } = await sb
        .from("tasks")
        .update({ scheduled_end: due, modified_on: new Date().toISOString(), modified_by_name: MARKETING_MEMO_CREATED_BY })
        .eq("task_id", m.task_id as string)
      if (upErr) throw upErr
      await recordAudit({
        action: "update",
        entity: "tasks",
        recordId: m.task_id as string,
        changes: { scheduled_end: { from: cur, to: due } },
        context: "automation:marketing-memo:launch-week-changed",
      })
    }
  } catch (e) {
    console.warn("[events] marketing memo due sync failed:", e instanceof Error ? e.message : e)
  }
}
