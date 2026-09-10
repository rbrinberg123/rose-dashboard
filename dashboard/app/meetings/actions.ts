"use server"

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import type { MeetingRecord } from "@/lib/meeting-record"
import type { AdminMeetingRow } from "@/lib/types"
import { parseConfig } from "@/lib/meetings/views"
import {
  availableColumns,
  fetchAllViewRows,
  loadFilterOptions,
  loadHostAliasGroups,
  type FilterOptions,
} from "@/lib/meetings/query"

/**
 * Load ONE meeting's full record for the Meetings drawer.
 *
 * Fetched on demand rather than shipped with the list: the list is 10k+ rows and
 * most of what the drawer shows (notes, logistics, the _raw-only lookups) is
 * never looked at. One row on open is far cheaper than 10k rows of blob.
 *
 * SECURITY: same gate as app/meetings/page.tsx — the EFFECTIVE role must be
 * super_user, so a super-user using "View as" gets the impersonated person's
 * answer rather than quietly keeping their own access. This read is unscoped
 * (any meeting, any client) and goes through the service-role client, so the
 * check must stay first and must stay on the effective role.
 *
 * `_raw` is flattened HERE, server-side, rather than shipped to the browser:
 * the blob carries every Dynamics field on the record, and the drawer needs a
 * dozen of them.
 */

/** Dataverse's formatted-value suffix — the human label beside a lookup/choice. */
const FV = "@OData.Community.Display.V1.FormattedValue"

type RawBlob = Record<string, unknown> | null

/** A `_raw` string value, or null when absent/blank. Never throws on a bad key. */
function raw(blob: RawBlob, key: string): string | null {
  if (!blob) return null
  const v = blob[key]
  if (typeof v !== "string") return null
  const t = v.trim()
  return t === "" ? null : t
}

/** The formatted label of a lookup/choice field. */
function rawLabel(blob: RawBlob, field: string): string | null {
  return raw(blob, `${field}${FV}`)
}

/** Nullable boolean passthrough — false is meaningful, so only undefined/null collapse. */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null
}

function textOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null
  const t = v.trim()
  return t === "" ? null : t
}

// The flattened columns the drawer reads. Selected explicitly (rather than "*")
// so the payload is predictable and _raw is the only large field in flight.
const COLUMNS = [
  "meeting_id",
  "meeting_date",
  "meeting_type_label",
  "meeting_status_label",
  "client_account_id",
  "client_account_name",
  "institution_name",
  "investor_text",
  "host_id",
  "host_name",
  "booker_name",
  "feedback_name",
  "group_meeting",
  "hosted_in_hq",
  "client_booked",
  "general_notes",
  "feedback_notes",
  "host_notes_label",
  "calendar_label",
  "profile_label",
  "feedback_bda_label",
  "sent",
  "confirm",
  "food_order",
  "driver",
  "logistics_notes",
  "created_on",
  "modified_on",
  "_raw",
].join(", ")

export async function loadMeetingRecord(
  meetingId: string,
): Promise<ActionResult<MeetingRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!meetingId) return fail("No meeting id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("meetings")
    .select(COLUMNS)
    .eq("meeting_id", meetingId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Meeting not found.")

  // Through `unknown`: the client types a dynamic column string as an opaque
  // GenericStringError, which does not overlap a plain record.
  const row = data as unknown as Record<string, unknown>
  const blob = (row._raw ?? null) as RawBlob

  // Hosts: the flattened host plus a second one from _raw when the record
  // carries one — the same pairing v_admin_meetings_all does, kept in step here.
  const hosts = [
    textOrNull(row.host_name),
    rawLabel(blob, "_bcs_host2_value"),
  ].filter(Boolean) as string[]

  const typeLabel = textOrNull(row.meeting_type_label)

  const record: MeetingRecord = {
    meeting_id: String(row.meeting_id),
    client_account_id: textOrNull(row.client_account_id),

    // Overview
    date_time: textOrNull(row.meeting_date),
    meeting_type: typeLabel,
    status: textOrNull(row.meeting_status_label),
    investor: textOrNull(row.investor_text),
    client: textOrNull(row.client_account_name),
    institution: textOrNull(row.institution_name),
    // Only the ids are flattened (city_id / state_region_id), so the readable
    // names come from the lookups' formatted values in _raw.
    city: rawLabel(blob, "_bcs_city_value"),
    state_region: rawLabel(blob, "_bcs_stateregion_value"),
    group_meeting: boolOrNull(row.group_meeting),
    hosted_in_hq: boolOrNull(row.hosted_in_hq),
    general_notes: textOrNull(row.general_notes),

    // Representatives
    booked_by: textOrNull(row.booker_name),
    // Not a flattened column. Rose custom lookup first, then the Dataverse
    // system field — the same order v_admin_meetings_all uses.
    on_behalf_of:
      rawLabel(blob, "_bcs_onbehalfof_value") ??
      rawLabel(blob, "_createdonbehalfby_value"),
    hosts: hosts.length ? hosts.join(", ") : null,
    feedback_assignee: textOrNull(row.feedback_name),
    client_booked: boolOrNull(row.client_booked),
    host_notes: textOrNull(row.host_notes_label),

    // Planning
    calendar: textOrNull(row.calendar_label),
    profile: textOrNull(row.profile_label),

    // Feedback
    fb_in_bda: textOrNull(row.feedback_bda_label),
    fb_received:
      rawLabel(blob, "bcs_feedbackreceived") ??
      rawLabel(blob, "bcs_feedbackreceiveddate") ??
      rawLabel(blob, "crdfa_feedbackreceiveddate"),
    feedback_notes: textOrNull(row.feedback_notes),

    // Logistics — Live meetings only (see the pane's context-aware section).
    is_live: typeLabel === "Live",
    sent: boolOrNull(row.sent),
    confirm: boolOrNull(row.confirm),
    food_order: textOrNull(row.food_order),
    driver: boolOrNull(row.driver),
    logistics_notes: textOrNull(row.logistics_notes),

    // System. modified_by / created_by are not flattened columns on
    // public.meetings, so both come from _raw.
    modified_by: rawLabel(blob, "_modifiedby_value"),
    modified_on: textOrNull(row.modified_on),
    created_by: rawLabel(blob, "_createdby_value"),
    created_on: textOrNull(row.created_on),
  }

  return ok(record)
}

/**
 * Every row of the current view, UNCAPPED — for the Excel export only.
 *
 * The page itself stops at ROW_CAP (lib/meetings/query.ts) because "All
 * meetings" is ~13.6k rows and painting a screen never needed them. The export
 * is different: it is an explicit click with a progress state, and a silently
 * truncated spreadsheet is a far worse failure than a slow download. So this
 * re-runs the same query with no cap and hands back the lot.
 *
 * SECURITY: same gate as the page and the record loader — the EFFECTIVE role
 * must be super_user, checked before any query is built. `config` arrives from
 * the client, so it goes through `parseConfig`, which admits only known column
 * keys and a closed operator set; the quick filters are three opaque strings
 * used as equality arguments, never as query syntax.
 */
export async function loadRowsForExport(input: {
  config: unknown
  quick?: { client?: string; host?: string; feedback?: string }
}): Promise<ActionResult<AdminMeetingRow[]>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const [available, aliasGroups] = await Promise.all([
    availableColumns(sb),
    loadHostAliasGroups(sb),
  ])

  const { rows, error } = await fetchAllViewRows<AdminMeetingRow>(
    sb,
    parsed.config,
    new Date(),
    available,
    input.quick ?? {},
    aliasGroups,
  )
  if (error) return fail(error)
  return ok(rows)
}

/**
 * The Client / Host / Feedback dropdown choices.
 *
 * ── WHY THIS IS AN ACTION AND NOT PART OF THE PAGE LOAD ────────────────────
 * These used to be fetched in app/meetings/page.tsx, in the critical path. That
 * was fine when `v_admin_meetings_filter_options` existed and cost one small
 * query — but when it does not, the loader falls back to scanning every row of
 * the view, which measured 4.6 s. The table's own rows were ready in ~250 ms and
 * sat there waiting for a list of dropdown values nobody had clicked yet.
 *
 * So the page no longer waits for them. The client asks for them after the table
 * has rendered, and the result is cached for the browser session. The fast path
 * is unchanged — the view is still preferred whenever it exists; the fallback
 * simply can no longer hold the page up.
 *
 * SECURITY: same gate as the rest of this file — the EFFECTIVE role must be
 * super_user, checked before any query is built. The lists are distinct values
 * drawn from the same unscoped view the page already shows.
 */
export async function loadMeetingFilterOptions(): Promise<ActionResult<FilterOptions>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  return ok(await loadFilterOptions(getSupabaseServer()))
}
