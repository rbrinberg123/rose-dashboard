"use server"

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import {
  DASHBOARD_ROW_BASE,
  cleanText,
  countTestRows,
  easternLocalToIso,
  isUuid,
  loadAccountOptions,
  loadClientEventOptions,
  loadUserOptions,
  purgeTestRows,
  requireCrmWriter,
  isIsoDate,
  updateDashboardRow,
  loadDashboardRowForEdit,
  asText,
  isoToEasternLocal,
  resolveAccount,
  resolveClientEvent,
  resolveUser,
  searchInstitutionOptions,
} from "@/lib/crm-write"
import {
  MEETING_STATUS_OPTIONS,
  MEETING_TYPE_OPTIONS,
  type ChoiceOption,
  type MeetingChoiceOptions,
  type NewMeetingInput,
} from "@/lib/meetings/create"
import type { AccountOption, UserOption } from "@/lib/types"
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
  "feedback_status_label",
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
  "is_test",
  "origin",
  // Flattened columns (2026-09-23e patch + the 2026-09-16 provenance columns).
  "city_name",
  "state_region_name",
  "on_behalf_of_name",
  "host2_name",
  "fb_received_date",
  "created_by_name",
  "modified_by_name",
].join(", ")

/** A date column → "M/D/YYYY", the shape Dynamics' formatted value had. */
function fbReceivedText(v: unknown): string | null {
  const m = typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : null
}

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
    textOrNull(row.host2_name) ?? rawLabel(blob, "_bcs_host2_value"),
  ].filter(Boolean) as string[]

  const typeLabel = textOrNull(row.meeting_type_label)

  const record: MeetingRecord = {
    meeting_id: String(row.meeting_id),
    is_test: row.is_test === true,
    origin: (row.origin as string | undefined) ?? null,
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
    // Flattened 2026-09-23; _raw stays as a fallback for a row the backfill missed.
    city: textOrNull(row.city_name) ?? rawLabel(blob, "_bcs_city_value"),
    state_region: textOrNull(row.state_region_name) ?? rawLabel(blob, "_bcs_stateregion_value"),
    group_meeting: boolOrNull(row.group_meeting),
    hosted_in_hq: boolOrNull(row.hosted_in_hq),
    general_notes: textOrNull(row.general_notes),

    // Representatives
    booked_by: textOrNull(row.booker_name),
    // Not a flattened column. Rose custom lookup first, then the Dataverse
    // system field — the same order v_admin_meetings_all uses.
    on_behalf_of:
      textOrNull(row.on_behalf_of_name) ??
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
    feedback_status: textOrNull(row.feedback_status_label),
    fb_in_bda: textOrNull(row.feedback_bda_label),
    fb_received:
      fbReceivedText(row.fb_received_date) ??
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
    // FIX 2026-09-23: read the flattened provenance columns (dashboard meetings
    // have no _raw provenance, so these were blank); _raw is only a fallback.
    modified_by: textOrNull(row.modified_by_name) ?? rawLabel(blob, "_modifiedby_value"),
    modified_on: textOrNull(row.modified_on),
    created_by: textOrNull(row.created_by_name) ?? rawLabel(blob, "_createdby_value"),
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

/* ----------------------------------------------------------- meeting writes */
// The same shared plumbing as every live CRM entity (lib/crm-write.ts): write
// gate, re-reads, ownership stamp, guarded edit, audited purge.

export async function loadMeetingClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

export async function loadMeetingUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

export async function loadMeetingEventOptions(accountId: string) {
  return loadClientEventOptions(accountId)
}

export async function searchMeetingInstitutions(query: string) {
  return searchInstitutionOptions(query)
}

/**
 * Distinct (code, label) pairs for the four choice fields, plus the cities and
 * states/regions already on meetings. Paged over the whole table, so it is
 * CACHED for 10 minutes per server process — option lists barely move, and
 * the cache holds no per-user data. Every label pairs 1:1 with a code in the
 * mirror (measured 2026-09-23), so a dashboard meeting stores both.
 */
let choiceCache: { at: number; data: MeetingChoiceOptions } | null = null

async function meetingChoiceOptions(): Promise<ActionResult<MeetingChoiceOptions>> {
  if (choiceCache && Date.now() - choiceCache.at < 10 * 60_000) return ok(choiceCache.data)
  const sb = getSupabaseServer()
  const cols =
    "host_notes_code, host_notes_label, calendar_code, calendar_label, profile_code, profile_label, feedback_bda_code, feedback_bda_label, feedback_status_code, feedback_status_label, city_id, city_name, state_region_id, state_region_name"
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("meetings").select(cols).order("meeting_id").range(from, from + 999)
    if (error) return fail(describeError(error))
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]))
    if (!data || data.length < 1000) break
  }
  const pairs = (code: string, label: string): ChoiceOption[] => {
    const m = new Map<number, string>()
    for (const r of rows) if (r[code] != null && r[label]) m.set(Number(r[code]), String(r[label]))
    return [...m].map(([c, l]) => ({ code: c, label: l })).sort((a, b) => a.label.localeCompare(b.label))
  }
  const places = (id: string, name: string) => {
    const m = new Map<string, string | null>()
    for (const r of rows) {
      const n = typeof r[name] === "string" ? (r[name] as string).trim() : ""
      if (n && !m.has(n)) m.set(n, (r[id] as string | null) ?? null)
    }
    return [...m].map(([n, i]) => ({ id: i, name: n })).sort((a, b) => a.name.localeCompare(b.name))
  }
  const data: MeetingChoiceOptions = {
    hostNotes: pairs("host_notes_code", "host_notes_label"),
    calendar: pairs("calendar_code", "calendar_label"),
    profile: pairs("profile_code", "profile_label"),
    feedbackBda: pairs("feedback_bda_code", "feedback_bda_label"),
    feedbackStatus: pairs("feedback_status_code", "feedback_status_label"),
    cities: places("city_id", "city_name"),
    states: places("state_region_id", "state_region_name"),
  }
  choiceCache = { at: Date.now(), data }
  return ok(data)
}

export async function loadMeetingChoiceOptions(): Promise<ActionResult<MeetingChoiceOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  return meetingChoiceOptions()
}

/**
 * Validate + build the FLATTENED meeting columns — shared by create and edit —
 * plus the `_raw` compatibility keys (see createMeeting) for the chosen event.
 */
async function buildMeetingColumns(
  input: NewMeetingInput,
): Promise<ActionResult<{ cols: Record<string, unknown>; raw: Record<string, unknown> }>> {
  if (!cleanText(input.clientAccountId)) return fail("Pick a client.")
  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

  const type = MEETING_TYPE_OPTIONS.find((t) => t.code === input.typeCode)
  if (!type) return fail("Pick Live or Virtual.")
  const status = MEETING_STATUS_OPTIONS.find((s) => s.code === input.statusCode)
  if (!status) return fail("Pick a status.")

  const start = easternLocalToIso(input.start)
  if (!start) return fail("Enter the date and time.")

  const evRes = await resolveClientEvent(input.eventId, client.account_id)
  if (!evRes.ok) return fail(evRes.error)
  const event = evRes.data

  // Institution: must be one already on a meeting (not a synced table).
  let institution: { id: string; name: string } | null = null
  const instId = cleanText(input.institutionId)
  if (instId) {
    if (!isUuid(instId)) return fail("Unknown institution.")
    const { data, error } = await getSupabaseServer()
      .from("meetings")
      .select("institution_name")
      .eq("institution_id", instId)
      .not("institution_name", "is", null)
      .limit(1)
    if (error) return fail(describeError(error))
    const name = (data?.[0] as { institution_name?: string } | undefined)?.institution_name
    if (!name) return fail("That institution isn't known.")
    institution = { id: instId, name }
  }

  const hostRes = await resolveUser(input.hostId)
  if (!hostRes.ok) return fail(hostRes.error)
  const bookerRes = await resolveUser(input.bookerId)
  if (!bookerRes.ok) return fail(bookerRes.error)
  const host = hostRes.data
  const booker = bookerRes.data

  // ---- the rest of the drawer's fields ----
  const people: Record<string, { user_id: string; display_name: string | null } | null> = {}
  for (const k of ["onBehalfOfId", "host2Id", "feedbackId"] as const) {
    const r = await resolveUser(input[k])
    if (!r.ok) return fail(r.error)
    people[k] = r.data
  }

  const optsRes = await meetingChoiceOptions()
  if (!optsRes.ok) return fail(optsRes.error)
  const opts = optsRes.data
  const choice = (list: ChoiceOption[], code: number | null | undefined, label: string) => {
    if (code == null) return { ok: true as const, v: null }
    const o = list.find((x) => x.code === code)
    return o ? { ok: true as const, v: o } : { ok: false as const, error: `Unknown ${label}.` }
  }
  const hostNotes = choice(opts.hostNotes, input.hostNotesCode, "host notes")
  const calendar = choice(opts.calendar, input.calendarCode, "calendar value")
  const profile = choice(opts.profile, input.profileCode, "profile value")
  const bda = choice(opts.feedbackBda, input.feedbackBdaCode, "FB in BDA value")
  const fbStatus = choice(opts.feedbackStatus, input.feedbackStatusCode, "feedback status")
  for (const c of [hostNotes, calendar, profile, bda, fbStatus]) if (!c.ok) return fail(c.error)

  const cityName = cleanText(input.cityName)
  const city = cityName ? opts.cities.find((c) => c.name === cityName) : null
  if (cityName && !city) return fail("Pick a city from the list.")
  const stateName = cleanText(input.stateRegionName)
  const stateRegion = stateName ? opts.states.find((c) => c.name === stateName) : null
  if (stateName && !stateRegion) return fail("Pick a state / region from the list.")

  const fbRec = cleanText(input.fbReceivedDate)
  if (fbRec && !isIsoDate(fbRec)) return fail("FB Rec'd isn't a valid date.")

  const extra = {
    city_id: city?.id ?? null,
    city_name: city?.name ?? null,
    state_region_id: stateRegion?.id ?? null,
    state_region_name: stateRegion?.name ?? null,
    group_meeting: input.groupMeeting === true,
    hosted_in_hq: input.hostedInHq === true,
    on_behalf_of_id: people.onBehalfOfId?.user_id ?? null,
    on_behalf_of_name: people.onBehalfOfId?.display_name ?? null,
    host2_id: people.host2Id?.user_id ?? null,
    host2_name: people.host2Id?.display_name ?? null,
    feedback_id: people.feedbackId?.user_id ?? null,
    feedback_name: people.feedbackId?.display_name ?? null,
    client_booked: input.clientBooked === true,
    host_notes_code: hostNotes.ok && hostNotes.v ? hostNotes.v.code : null,
    host_notes_label: hostNotes.ok && hostNotes.v ? hostNotes.v.label : null,
    calendar_code: calendar.ok && calendar.v ? calendar.v.code : null,
    calendar_label: calendar.ok && calendar.v ? calendar.v.label : null,
    profile_code: profile.ok && profile.v ? profile.v.code : null,
    profile_label: profile.ok && profile.v ? profile.v.label : null,
    feedback_bda_code: bda.ok && bda.v ? bda.v.code : null,
    feedback_bda_label: bda.ok && bda.v ? bda.v.label : null,
    // Drives Feedback Collection / the Outstanding Feedback email.
    feedback_status_code: fbStatus.ok && fbStatus.v ? fbStatus.v.code : null,
    feedback_status_label: fbStatus.ok && fbStatus.v ? fbStatus.v.label : null,
    fb_received_date: fbRec,
    feedback_notes: cleanText(input.feedbackNotes),
    sent: input.sent === true,
    confirm: input.confirm === true,
    driver: input.driver === true,
    food_order: cleanText(input.foodOrder),
    logistics_notes: cleanText(input.logisticsNotes),
  }

  return ok({
    cols: {
      meeting_date: start,
      client_account_id: client.account_id,
      client_account_name: client.name,
      event_id: event?.event_id ?? null,
      institution_id: institution?.id ?? null,
      institution_name: institution?.name ?? null,
      investor_text: cleanText(input.investor),
      host_id: host?.user_id ?? null,
      host_name: host?.display_name ?? null,
      booker_id: booker?.user_id ?? null,
      booker_name: booker?.display_name ?? null,
      meeting_type_code: type.code,
      meeting_type_label: type.label,
      is_in_person: type.label === "Live",
      meeting_status_code: status.code,
      meeting_status_label: status.label,
      general_notes: cleanText(input.generalNotes),
      ...extra,
    },
    // _raw compatibility keys — ONLY the ones downstream views still read out of
    // _raw: the event name (v_planning_events, v_profiles_upcoming) and the
    // feedback assignee id (v_feedback_outstanding). Never shown on the form.
    raw: {
      ...(event
        ? {
            _bcs_event_value: event.event_id,
            "_bcs_event_value@OData.Community.Display.V1.FormattedValue": event.name,
          }
        : null),
      ...(extra.feedback_id
        ? {
            _bcs_feedback_value: extra.feedback_id,
            "_bcs_feedback_value@OData.Community.Display.V1.FormattedValue": extra.feedback_name,
          }
        : null),
    },
  })
}

/**
 * "Add New Meeting" — insert ONE dashboard-authored meeting.
 *
 * Constraints on public.meetings (checked live 2026-09-23): meeting_id is
 * required with no default; is_in_person NOT NULL (set from the type);
 * client_account_id → accounts and feedback_id → users are the enforced FKs
 * (feedback left NULL). Institutions are Dynamics accounts OUTSIDE the mirror,
 * so the institution must be one already on a meeting. The event must belong
 * to the same client.
 *
 * _raw is {} EXCEPT for the event name: v_planning_events (Scheduler, Planning,
 * Week Ahead) and v_profiles_upcoming still read a meeting's event name out of
 * _raw ('_bcs_event_value@…FormattedValue'). An edit rewrites those keys too
 * (server-side, never from the form), so a changed event shows there.
 *
 * NOT FILTERED ANYWHERE. Containment is the ZVZZT test client.
 */
export async function createMeeting(input: NewMeetingInput): Promise<ActionResult<{ meetingId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting meetings")
  if (!gate.ok) return fail(gate.error)

  const built = await buildMeetingColumns(input)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    meeting_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    _raw: built.data.raw,
    is_test: input.isTest === true,
    ...built.data.cols,
    // Owner is a PERSON on meetings — usually the booker. Set once, at create.
    owner_id: (built.data.cols.booker_id as string | null) ?? gate.userId,
    created_by_id: gate.userId,
    created_by_name: gate.name,
    modified_by_id: gate.userId,
    modified_by_name: gate.name,
    state_code: 0,
    state_label: "Active",
    status_code: 1,
    status_label: "Active",
    created_on: now,
    modified_on: now,
  }

  const { error } = await getSupabaseServer().from("meetings").insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "meetings",
    recordId: row.meeting_id,
    changes: snapshot,
    context: "/meetings · Add New Meeting",
  })

  revalidatePath("/meetings")
  return ok({ meetingId: row.meeting_id })
}

/** A DASHBOARD meeting, as form input — Dynamics rows are refused. */
export async function loadMeetingForEdit(id: string): Promise<ActionResult<NewMeetingInput>> {
  const res = await loadDashboardRowForEdit(
    "meetings",
    "meeting_id",
    id,
    "client_account_id, meeting_type_code, meeting_status_code, meeting_date, event_id, institution_id, institution_name, investor_text, host_id, booker_id, general_notes, city_name, state_region_name, group_meeting, hosted_in_hq, on_behalf_of_id, host2_id, feedback_id, client_booked, host_notes_code, calendar_code, profile_code, feedback_bda_code, feedback_status_code, fb_received_date, feedback_notes, sent, confirm, driver, food_order, logistics_notes",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  return ok({
    clientAccountId: (r.client_account_id as string | null) ?? null,
    typeCode: Number(r.meeting_type_code ?? MEETING_TYPE_OPTIONS[0].code),
    statusCode: Number(r.meeting_status_code ?? MEETING_STATUS_OPTIONS[0].code),
    start: isoToEasternLocal(r.meeting_date),
    eventId: asText(r.event_id),
    institutionId: (r.institution_id as string | null) ?? null,
    institutionName: (r.institution_name as string | null) ?? null,
    investor: asText(r.investor_text),
    hostId: (r.host_id as string | null) ?? null,
    bookerId: (r.booker_id as string | null) ?? null,
    generalNotes: asText(r.general_notes),
    cityName: (r.city_name as string | null) ?? null,
    stateRegionName: (r.state_region_name as string | null) ?? null,
    groupMeeting: r.group_meeting === true,
    hostedInHq: r.hosted_in_hq === true,
    onBehalfOfId: (r.on_behalf_of_id as string | null) ?? null,
    host2Id: (r.host2_id as string | null) ?? null,
    feedbackId: (r.feedback_id as string | null) ?? null,
    clientBooked: r.client_booked === true,
    hostNotesCode: r.host_notes_code == null ? null : Number(r.host_notes_code),
    calendarCode: r.calendar_code == null ? null : Number(r.calendar_code),
    profileCode: r.profile_code == null ? null : Number(r.profile_code),
    feedbackBdaCode: r.feedback_bda_code == null ? null : Number(r.feedback_bda_code),
    feedbackStatusCode: r.feedback_status_code == null ? null : Number(r.feedback_status_code),
    fbReceivedDate: asText(r.fb_received_date).slice(0, 10),
    feedbackNotes: asText(r.feedback_notes),
    sent: r.sent === true,
    confirm: r.confirm === true,
    driver: r.driver === true,
    foodOrder: asText(r.food_order),
    logisticsNotes: asText(r.logistics_notes),
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD meeting. The origin guard lives in updateDashboardRow. */
export async function updateMeeting(
  id: string,
  input: NewMeetingInput,
): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing meetings")
  if (!gate.ok) return fail(gate.error)
  const built = await buildMeetingColumns(input)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: "meetings",
    pk: "meeting_id",
    id,
    patch: built.data.cols,
    rawShim: built.data.raw,
    path: "/meetings",
    context: "/meetings · Edit meeting",
    verb: "editing meetings",
  })
}

export async function countTestMeetings(): Promise<ActionResult<number>> {
  return countTestRows("meetings", "meeting_id")
}

export async function purgeTestMeetings(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: "meetings",
    pk: "meeting_id",
    snapshot: "client_account_name, meeting_date, meeting_type_label, meeting_status_label, institution_name, created_on",
    path: "/meetings",
    context: "/meetings · Delete test meetings",
  })
}
