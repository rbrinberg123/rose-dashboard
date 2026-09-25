"use server"

/**
 * CRM → Time Off: every server action — the drawer's record fetch, create,
 * edit, delete, approve / deny, and the test-data purge.
 *
 * ══ WHO MAY DO WHAT (enforced HERE, never by hiding buttons) ═══════════════
 *   create          super_user, not in "View as"        (requireCrmWriter)
 *   edit / delete   super_user, not in "View as"        (requireCrmWriter)
 *                   — dashboard rows only, in ANY status. Being the REQUESTER
 *                   grants nothing: a requester can never edit or delete a
 *                   request, their own included. Only the super_user check
 *                   opens these, and that stays true when access is broadened.
 *   approve / deny  super_user, not in "View as", AND the REAL actor is on the
 *                   requester's reviewing team right now (time_off_reviewers),
 *                   AND is not the requester, AND the request is still Pending.
 *   Dynamics rows   read-only, always (they are synced history).
 *
 * The tables are read and written with the service-role key (RLS bypassed), so
 * these checks ARE the gate. Every write calls recordAudit.
 *
 * ══ total_days + day rows ══════════════════════════════════════════════════
 * Written ONLY by public.time_off_set_days() (sql/patches/2026-09-24_time_off_requests.sql),
 * which replaces the day rows and re-derives the total in one transaction.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { diffRows, recordAudit } from "@/lib/audit"
import {
  countTestRows,
  isUuid,
  loadUserOptions,
  purgeTestRows,
  requireCrmWriter,
  resolveUser,
} from "@/lib/crm-write"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import type { UserOption } from "@/lib/types"
import {
  MAX_RANGE_DAYS,
  buildDays,
  dynamicsTotalDays,
  isPortion,
  isRequestType,
  isYmd,
  type TimeOffDayInput,
  type TimeOffInput,
  type TimeOffListRow,
  type TimeOffPortion,
  type TimeOffRecord,
} from "@/lib/time-off-requests/model"
import {
  idsForEmail,
  idsForUser,
  isReviewerOf,
  reviewerNamesFor,
} from "@/lib/time-off-requests/reviewers"

const TABLE = "time_off_requests"
const PATH = "/time-off-requests"

/** Everything that shows a request, refreshed after any write. */
function revalidateAll() {
  revalidatePath(PATH)
  revalidatePath("/clients/alerts")
  revalidatePath("/ooo-summary")
}

/** The editable request columns (never status / review / provenance). */
const FIELD_COLUMNS =
  "requested_by_id, requested_by_name, request_type, start_date, end_date, description, comments"

type RequestRow = {
  id: string
  requested_by_id: string
  requested_by_name: string | null
  request_type: string
  start_date: string
  end_date: string
  total_days: number
  description: string | null
  comments: string | null
  status: string
  reviewed_by_id: string | null
  reviewed_by_name: string | null
  reviewed_at: string | null
  review_comments: string | null
  origin: string
  is_test: boolean
  created_by_id: string | null
  created_by_name: string | null
  created_on: string
  modified_on: string
}

/** One dashboard request + its days, or an error. Dashboard rows only. */
async function readRequest(
  id: string,
): Promise<ActionResult<{ row: RequestRow; days: TimeOffDayInput[] }>> {
  if (!isUuid(id)) return fail("Unknown request.")
  const sb = getSupabaseServer()
  const [rowRes, daysRes] = await Promise.all([
    sb.from(TABLE).select("*").eq("id", id).maybeSingle(),
    sb.from("time_off_days").select("off_date, portion").eq("request_id", id).order("off_date"),
  ])
  if (rowRes.error) return fail(describeError(rowRes.error))
  if (!rowRes.data) return fail("Request not found.")
  if (daysRes.error) return fail(describeError(daysRes.error))
  const row = rowRes.data as RequestRow
  if (row.origin !== "dashboard") return fail("Only dashboard requests can be changed.")
  const days = ((daysRes.data ?? []) as { off_date: string; portion: string }[]).map((d) => ({
    date: d.off_date,
    portion: (isPortion(d.portion) ? d.portion : "Full") as TimeOffPortion,
  }))
  return ok({ row, days })
}

/** "2026-10-12 Full, 2026-10-13 AM" — the days as one audit-friendly string. */
const daysText = (days: readonly TimeOffDayInput[]) =>
  days.map((d) => `${d.date} ${d.portion}`).join(", ")

/** Validate the form and build the request columns + day rows. */
async function buildRequest(
  input: TimeOffInput,
  defaultPersonId: string | null,
): Promise<ActionResult<{ columns: Record<string, unknown>; days: TimeOffDayInput[] }>> {
  if (!isRequestType(input.requestType)) return fail("Pick a request type.")
  if (!isYmd(input.startDate)) return fail("Enter a start date.")
  if (!isYmd(input.endDate)) return fail("Enter an end date.")
  if (input.endDate < input.startDate) return fail("The end date is before the start date.")

  const span =
    (Date.parse(`${input.endDate}T00:00:00Z`) - Date.parse(`${input.startDate}T00:00:00Z`)) /
    86_400_000
  if (span >= MAX_RANGE_DAYS) return fail("That range is longer than a year.")

  // Portions: only known values survive; unknown dates are ignored by buildDays.
  const portions: Record<string, TimeOffPortion> = {}
  for (const [date, p] of Object.entries(input.portions ?? {})) {
    if (isYmd(date) && isPortion(p)) portions[date] = p
  }
  const days = buildDays(input.startDate, input.endDate, portions)
  if (days.length === 0) {
    return fail("That range has no working days — weekends and market holidays aren't counted.")
  }

  // Re-read the person server-side; the name written comes from here.
  const personRes = await resolveUser(input.requestedById ?? defaultPersonId)
  if (!personRes.ok) return fail(personRes.error)
  if (!personRes.data) return fail("Pick who the time off is for.")

  const clean = (v: string | null | undefined) => {
    const s = (v ?? "").trim()
    return s === "" ? null : s
  }

  return ok({
    columns: {
      requested_by_id: personRes.data.user_id,
      requested_by_name: personRes.data.display_name,
      request_type: input.requestType,
      start_date: input.startDate,
      end_date: input.endDate,
      description: clean(input.description),
      comments: clean(input.comments),
    },
    days,
  })
}

/** Replace a request's days + total in one transaction. Returns the total. */
async function setDays(id: string, days: TimeOffDayInput[]): Promise<ActionResult<number>> {
  const { data, error } = await getSupabaseServer().rpc("time_off_set_days", {
    p_request_id: id,
    p_days: days.map((d) => ({ off_date: d.date, portion: d.portion })),
  })
  if (error) return fail(describeError(error))
  return ok(Number(data))
}

/* ------------------------------------------------------------ form pickers */

/** People for the Requested By picker. */
export async function loadTimeOffUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

/** The chosen person's reviewing team, resolved live — shown on the form. */
export async function loadReviewingTeam(personId: string | null): Promise<ActionResult<string[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  let id = personId
  if (!id) id = (await getEffectiveIdentity()).userId
  if (!id || !isUuid(id)) return ok([])
  return ok(await reviewerNamesFor(id))
}

/* ------------------------------------------------------------------ create */

/** "New Time Off" — a Pending request plus one day row per counted day. */
export async function createTimeOffRequest(
  input: TimeOffInput,
): Promise<ActionResult<{ id: string; totalDays: number }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating time off requests")
  if (!gate.ok) return fail(gate.error)

  const built = await buildRequest(input, gate.userId)
  if (!built.ok) return fail(built.error)

  const sb = getSupabaseServer()
  const now = new Date().toISOString()
  const row = {
    ...built.data.columns,
    status: "Pending",
    origin: "dashboard",
    is_test: input.isTest === true,
    created_by_id: gate.userId,
    created_by_name: gate.name,
    created_on: now,
    modified_on: now,
  }

  const { data: inserted, error } = await sb.from(TABLE).insert(row).select("id").single()
  if (error) return fail(describeError(error))
  const id = (inserted as { id: string }).id

  const total = await setDays(id, built.data.days)
  if (!total.ok) {
    // Never leave a request with no days behind.
    await sb.from(TABLE).delete().eq("id", id)
    return fail(total.error)
  }

  await recordAudit({
    action: "create",
    entity: TABLE,
    recordId: id,
    changes: { id, ...row, total_days: total.data, days: daysText(built.data.days) },
    context: "/time-off-requests · New Time Off",
  })

  revalidateAll()
  return ok({ id, totalDays: total.data })
}

/* ------------------------------------------------------------------ drawer */

/** Can the viewer approve / deny this request right now? And if not, why. */
async function reviewState(row: {
  status: string | null
  requested_by_id: string | null
}): Promise<{ canReview: boolean; reason: string | null }> {
  if (row.status !== "Pending") return { canReview: false, reason: null }
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (identity.impersonated) return { canReview: false, reason: "Exit “View as” to approve or deny." }
  if (role !== "super_user") return { canReview: false, reason: "Approving is super-user only for now." }
  if (!row.requested_by_id) return { canReview: false, reason: "This request has no requester." }
  const actorIds = [...new Set([...(await idsForEmail(identity.email)), identity.userId ?? ""])].filter(Boolean)
  if (actorIds.length === 0) return { canReview: false, reason: "Your sign-in isn't matched to a CRM user." }
  const requesterIds = await idsForUser(row.requested_by_id)
  if (actorIds.some((id) => requesterIds.includes(id))) {
    return { canReview: false, reason: "You can't review your own request." }
  }
  if (!(await isReviewerOf(actorIds, row.requested_by_id))) {
    return { canReview: false, reason: "Only this person's reviewing team can approve or deny." }
  }
  return { canReview: true, reason: null }
}

/** One record for the drawer — either source. */
export async function loadTimeOffRecord(
  id: string,
  source: "Dynamics" | "Dashboard",
): Promise<ActionResult<TimeOffRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  if (!isUuid(id)) return fail("Unknown request.")

  const { data, error } = await getSupabaseServer()
    .from("v_admin_time_off_all")
    .select("*")
    .eq("id", id)
    .eq("source", source)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("Request not found.")
  const row = data as TimeOffListRow

  if (source === "Dynamics") {
    return ok({
      ...row,
      total_days: dynamicsTotalDays(row.start_date, row.end_date, row.description),
      days: [],
      reviewers: row.reviewing_team ? [row.reviewing_team] : [],
      canReview: false,
      reviewBlockedReason: null,
      canEdit: false,
    })
  }

  const [daysRes, reviewers, review, identity] = await Promise.all([
    getSupabaseServer()
      .from("time_off_days")
      .select("off_date, portion")
      .eq("request_id", id)
      .order("off_date"),
    row.requested_by_id ? reviewerNamesFor(row.requested_by_id) : Promise.resolve([]),
    reviewState(row),
    getEffectiveIdentity(),
  ])
  const days = ((daysRes.data ?? []) as { off_date: string; portion: string }[]).map((d) => ({
    date: d.off_date,
    portion: (isPortion(d.portion) ? d.portion : "Full") as TimeOffPortion,
  }))

  return ok({
    ...row,
    days,
    reviewers,
    canReview: review.canReview,
    reviewBlockedReason: review.reason,
    // Hides the buttons only — updateTimeOffRequest / deleteTimeOffRequest
    // re-check this server-side.
    canEdit: role === "super_user" && !identity.impersonated,
  })
}

/* -------------------------------------------------------------------- edit */

/** A DASHBOARD request, as form input. */
export async function loadTimeOffForEdit(id: string): Promise<ActionResult<TimeOffInput>> {
  const gate = await requireCrmWriter("editing time off requests")
  if (!gate.ok) return fail(gate.error)
  const res = await readRequest(id)
  if (!res.ok) return fail(res.error)
  const { row, days } = res.data
  return ok({
    requestedById: row.requested_by_id,
    requestType: isRequestType(row.request_type) ? row.request_type : "",
    startDate: row.start_date,
    endDate: row.end_date,
    portions: Object.fromEntries(days.map((d) => [d.date, d.portion])),
    description: row.description ?? "",
    comments: row.comments ?? "",
    isTest: row.is_test,
  })
}

/**
 * Edit a DASHBOARD request — any field, in any status. SUPER_USER ONLY: the
 * requester can never edit, not even their own. Changing dates or portions
 * re-derives the day rows and total_days (time_off_set_days). Status and the
 * review fields are NOT editable here — they change only through
 * reviewTimeOffRequest, which checks the reviewing team.
 */
export async function updateTimeOffRequest(
  id: string,
  input: TimeOffInput,
): Promise<ActionResult<{ changed: number; totalDays: number }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("editing time off requests")
  if (!gate.ok) return fail(gate.error)

  const before = await readRequest(id)
  if (!before.ok) return fail(before.error)
  const { row: prior, days: priorDays } = before.data

  const built = await buildRequest(input, prior.requested_by_id)
  if (!built.ok) return fail(built.error)

  const cols = FIELD_COLUMNS.split(", ")
  const beforeView = {
    ...Object.fromEntries(cols.map((c) => [c, prior[c as keyof RequestRow] ?? null])),
    days: daysText(priorDays),
    total_days: Number(prior.total_days),
  }
  const afterDays = daysText(built.data.days)
  const fieldsDiff = diffRows(beforeView, built.data.columns)
  const daysChanged = afterDays !== beforeView.days
  if (!fieldsDiff && !daysChanged) return ok({ changed: 0, totalDays: Number(prior.total_days) })

  const sb = getSupabaseServer()
  if (fieldsDiff) {
    const { data: updated, error } = await sb
      .from(TABLE)
      .update({ ...built.data.columns, modified_on: new Date().toISOString() })
      .eq("id", id)
      .eq("origin", "dashboard")
      .select("id")
    if (error) return fail(describeError(error))
    if (!updated || updated.length !== 1) return fail("Refused: only dashboard requests can be edited.")
  }

  let total = Number(prior.total_days)
  if (daysChanged) {
    const res = await setDays(id, built.data.days)
    if (!res.ok) return fail(`Saved the fields but not the days: ${res.error}`)
    total = res.data
    if (!fieldsDiff) {
      await sb.from(TABLE).update({ modified_on: new Date().toISOString() }).eq("id", id)
    }
  }

  const diff = diffRows(beforeView, { ...built.data.columns, days: afterDays, total_days: total })
  await recordAudit({
    action: "update",
    entity: TABLE,
    recordId: id,
    changes: diff,
    context: `/time-off-requests · Edit request · dashboard row${prior.is_test ? " · test" : ""}`,
  })

  revalidateAll()
  return ok({ changed: Object.keys(diff ?? {}).length, totalDays: total })
}

/* ------------------------------------------------------------------ delete */

/**
 * Delete a DASHBOARD request (its days cascade). SUPER_USER ONLY, any status —
 * the requester can never delete, not even their own.
 */
export async function deleteTimeOffRequest(id: string): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("deleting time off requests")
  if (!gate.ok) return fail(gate.error)

  const before = await readRequest(id)
  if (!before.ok) return fail(before.error)
  const { row, days } = before.data

  const { data: deleted, error } = await getSupabaseServer()
    .from(TABLE)
    .delete()
    .eq("id", id)
    .eq("origin", "dashboard")
    .select("id")
  if (error) return fail(describeError(error))
  if (!deleted || deleted.length !== 1) return fail("Refused: only dashboard requests can be deleted.")

  await recordAudit({
    action: "delete",
    entity: TABLE,
    recordId: id,
    changes: { ...row, days: daysText(days) },
    context: "/time-off-requests · Delete request",
  })

  revalidateAll()
  return ok()
}

/* ---------------------------------------------------------- approve / deny */

/**
 * Approve or deny a PENDING dashboard request. The REAL actor must be a
 * super_user (not in View as), must be on the requester's reviewing team at
 * this moment, and must not be the requester. reviewed_by_* is that real actor.
 */
export async function reviewTimeOffRequest(
  id: string,
  decision: "Approved" | "Denied",
  reviewComments?: string,
): Promise<ActionResult<{ status: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("approving or denying time off")
  if (!gate.ok) return fail(gate.error)
  if (decision !== "Approved" && decision !== "Denied") return fail("Unknown decision.")

  const before = await readRequest(id)
  if (!before.ok) return fail(before.error)
  const prior = before.data.row
  if (prior.status !== "Pending") return fail(`This request is already ${prior.status}.`)

  // requireCrmWriter refused View as, so the effective identity IS the real one.
  const identity = await getEffectiveIdentity()
  const actorIds = [...new Set([...(await idsForEmail(identity.email)), gate.userId ?? ""])].filter(Boolean)
  if (actorIds.length === 0) return fail("Your sign-in isn't matched to a CRM user.")
  const requesterIds = await idsForUser(prior.requested_by_id)
  if (actorIds.some((a) => requesterIds.includes(a))) return fail("You can't review your own request.")
  if (!(await isReviewerOf(actorIds, prior.requested_by_id))) {
    return fail("Not authorised: you are not on this person's reviewing team.")
  }

  const comments = (reviewComments ?? "").trim() || null
  const patch = {
    status: decision,
    reviewed_by_id: gate.userId,
    reviewed_by_name: gate.name,
    reviewed_at: new Date().toISOString(),
    review_comments: comments,
  }

  // Only a still-Pending row moves — a double click or a race can't re-decide it.
  const { data: updated, error } = await getSupabaseServer()
    .from(TABLE)
    .update({ ...patch, modified_on: patch.reviewed_at })
    .eq("id", id)
    .eq("origin", "dashboard")
    .eq("status", "Pending")
    .select("id")
  if (error) return fail(describeError(error))
  if (!updated || updated.length !== 1) return fail("This request was already reviewed.")

  await recordAudit({
    action: "update",
    entity: TABLE,
    recordId: id,
    changes: diffRows(
      {
        status: prior.status,
        reviewed_by_id: prior.reviewed_by_id,
        reviewed_by_name: prior.reviewed_by_name,
        reviewed_at: prior.reviewed_at,
        review_comments: prior.review_comments,
      },
      patch,
    ),
    context: `/time-off-requests · ${decision === "Approved" ? "Approve" : "Deny"} request · dashboard row${prior.is_test ? " · test" : ""}`,
  })

  revalidateAll()
  return ok({ status: decision })
}

/* ------------------------------------------------------------- test purge */

/** How many test requests the purge would remove — for the confirm prompt. */
export async function countTestTimeOff(): Promise<ActionResult<number>> {
  return countTestRows(TABLE, "id")
}

/** Delete every dashboard TEST request (their days cascade). Audited per row. */
export async function purgeTestTimeOff(): Promise<ActionResult<{ deleted: number }>> {
  const res = await purgeTestRows({
    table: TABLE,
    pk: "id",
    snapshot: "requested_by_name, request_type, start_date, end_date, total_days, status, created_by_name",
    path: PATH,
    context: "/time-off-requests · Delete test requests",
  })
  if (res.ok) revalidateAll()
  return res
}
