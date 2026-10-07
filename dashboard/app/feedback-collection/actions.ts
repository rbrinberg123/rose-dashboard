"use server"

import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { isUuid } from "@/lib/crm-write"
import { loadClaimViewer } from "@/lib/feedback-claims/server"
import { validateReceivedDay } from "@/lib/feedback-reports/policy"
import { decideSetMeetingFeedback, feedbackStatusByCode } from "@/lib/feedback-collection/policy"

/**
 * Feedback Collection → set a meeting's FEEDBACK STATUS + FB Received Date.
 *
 * GATE (all server-side; the page only decides what to SHOW):
 *   - not in "View as" (a super user previewing someone must not act as them);
 *   - the meeting is dashboard-origin, Confirmed, Active;
 *   - the actor is the meeting's FEEDBACK REPRESENTATIVE (its feedback person,
 *     else its host — lib/feedback-collection/policy.ts) or an admin (super
 *     user). Anyone else gets "Not authorised"-style refusal.
 *
 * WRITE: the meeting's existing columns (feedback_status_code / _label,
 * fb_received_date) in ONE guarded UPDATE that repeats the origin + status
 * conditions and must hit exactly one row; audited. No sidecar — dashboard
 * meetings are never synced. The report task is NOT touched.
 */
export async function setMeetingFeedback(input: {
  meetingId: string
  statusCode: number
  /** YYYY-MM-DD (Eastern) or null to clear. */
  receivedDay: string | null
}): Promise<ActionResult> {
  const actor = await loadClaimViewer()
  if (actor.impersonated) return fail("Exit “View as” before changing feedback.")
  if (!actor.email) return fail("Not authorised.")
  if (!isUuid(input.meetingId)) return fail("Unknown meeting.")

  const status = feedbackStatusByCode(input.statusCode)
  if (!status) return fail("Pick a feedback status.")

  const day = (input.receivedDay ?? "").trim() || null
  if (day) {
    const todayET = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())
    const dayError = validateReceivedDay(day, todayET)
    if (dayError) return fail(dayError.replace("received date", "FB Received date"))
  }

  const sb = getSupabaseServer()
  const { data: m, error } = await sb
    .from("meetings")
    .select("meeting_id, origin, meeting_status_label, state_label, feedback_id, host_id, feedback_status_label, fb_received_date")
    .eq("meeting_id", input.meetingId)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!m) return fail("That meeting no longer exists.")

  const refusal = decideSetMeetingFeedback(
    {
      origin: m.origin as string | null,
      meetingStatus: m.meeting_status_label as string | null,
      state: m.state_label as string | null,
      feedbackId: m.feedback_id as string | null,
      hostId: m.host_id as string | null,
    },
    actor,
  )
  if (refusal) return fail(refusal)

  const now = new Date().toISOString()
  const { data: updated, error: upErr } = await sb
    .from("meetings")
    .update({
      feedback_status_code: status.code,
      feedback_status_label: status.label,
      fb_received_date: day,
      modified_on: now,
      modified_by_id: actor.userId,
      modified_by_name: actor.name,
    })
    .eq("meeting_id", input.meetingId)
    .eq("origin", "dashboard")
    .eq("meeting_status_label", "Confirmed")
    .select("meeting_id")
  if (upErr) return fail(describeError(upErr))
  if (!updated || updated.length !== 1) {
    return fail("This meeting changed while you were looking at it — refresh and try again.")
  }

  await recordAudit({
    action: "update",
    entity: "meetings",
    recordId: input.meetingId,
    changes: {
      feedback_status_label: { from: m.feedback_status_label ?? null, to: status.label },
      fb_received_date: { from: m.fb_received_date ?? null, to: day },
    },
    context: "/feedback-collection · Set feedback",
  })
  for (const p of ["/feedback-collection", "/meetings", "/my-dashboard"]) revalidatePath(p)
  return ok()
}
