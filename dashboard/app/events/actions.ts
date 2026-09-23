"use server"

/**
 * Events' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_events_all` is unscoped and read with the
 * service-role key (RLS bypassed), so a successful call hands back every
 * client's events. The page gate and the proxy gate are not enough on their own:
 * a server action is its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with Meetings so there is one
 * implementation, not two. Read that file's header before changing them.
 */

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
  isIsoDate,
  loadAccountOptions,
  purgeTestRows,
  requireCrmWriter,
  loadUserOptions,
  resolveUser,
  updateDashboardRow,
  loadDashboardRowForEdit,
  asText,
  isoToEasternDate,
  resolveAccount,
} from "@/lib/crm-write"
import {
  EVENT_FEEDBACK_TEAMS,
  EVENT_LEAD_OPTIONS,
  EVENT_MARKETING_OPTIONS,
  EVENT_STATE_OPTIONS,
  EVENT_URGENCY_OPTIONS,
  type NewEventInput,
} from "@/lib/events/create"
import type { AccountOption, UserOption } from "@/lib/types"
import {
  availableColumns,
  fetchAllRows,
  loadFilterOptionGroups,
} from "@/lib/table-views/query"
import type { QuickFilterOptions } from "@/components/table-views/quick-filters"
import {
  createSavedView as sharedCreate,
  deleteSavedView as sharedDelete,
  listSavedViews as sharedList,
  setDefaultSavedView as sharedSetDefault,
  updateSavedView as sharedUpdate,
} from "@/lib/table-views/saved-views"
import { parseConfig } from "@/lib/table-views/config"
import type { SavedView, SavedViewScope } from "@/lib/table-views/types"
import { EVENTS_SPEC } from "@/lib/events/spec"
import { applyEventQuickFilters, type EventQuickFilters } from "@/lib/events/filters"
import type { EventRecord } from "@/lib/events/record"
import type { AdminEventRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(EVENTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(EVENTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(EVENTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(EVENTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(EVENTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * Client / Event State / Account Manager choices.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_events_filter_options, where the distinct-ing is done in Postgres.
 */
export async function loadEventFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(getSupabaseServer(), EVENTS_SPEC, "event_count")
  return ok({
    client: groups.client ?? [],
    event_state: groups.event_state ?? [],
    manager: groups.manager ?? [],
  })
}

/* ------------------------------------------------------------------- export */

/**
 * Every row of the current view, UNCAPPED — for the Excel export only.
 *
 * The page stops at ROW_CAP; the export must not, or capping the page would
 * silently start truncating spreadsheets. `config` arrives from the client, so
 * it goes through `parseConfig`, which admits only known column keys and a
 * closed operator set.
 */
export async function loadEventRowsForExport(input: {
  config: unknown
  quick?: EventQuickFilters
}): Promise<ActionResult<AdminEventRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(EVENTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const available = await availableColumns(sb, EVENTS_SPEC)
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminEventRow>(
    sb,
    EVENTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyEventQuickFilters(q, quick)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE event's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list: the list carries only its
 * seven display columns, and most of what the drawer shows (notes, the whole
 * Planning block) is never looked at. One row on open is far cheaper than
 * hundreds of rows of detail.
 *
 * Unlike the meetings drawer this needs no `_raw` at all — public.events is a
 * fully flattened mirror, so every field the drawer wants is a real column.
 */
const RECORD_COLUMNS = [
  "event_id",
  "client_account_id",
  "event_title",
  "event_state_label",
  "marketing_state_label",
  "client_account_name",
  "client_ticker",
  "event_location",
  "tbc",
  "event_dates",
  "account_manager_name",
  "logistics_coordinator_name",
  "feedback_team_name",
  "feedback_report_name",
  "leads_labels",
  "team",
  "event_notes",
  "meetings_start",
  "meetings_end",
  "event_parameters",
  "of_slots",
  "confirmed_meetings",
  "slots_remaining",
  "urgency_label",
  "launch_week",
  "memo_date",
  "last_data_upload",
  "shareholder_report_received_date",
  "targeting_not_required",
  "memo_not_required",
  "targeting_date",
  "targeting_url",
  "profile_link",
  "targeting_notes",
  "launch",
  "outreach_complete",
  "user_team_lead",
  "state_label",
  "created_on",
  "modified_on",
].join(", ")

export async function loadEventRecord(eventId: string): Promise<ActionResult<EventRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!eventId) return fail("No event id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(EVENTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("event_id", eventId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Event not found.")

  // is_test for the drawer TEST badge, read off the table (the view lacks it).
  const { data: flag } = await sb
    .from("events")
    .select("is_test, origin, mining")
    .eq("event_id", eventId)
    .maybeSingle()

  return ok({ ...(data as unknown as EventRecord), is_test: flag?.is_test === true, origin: (flag?.origin as string | undefined) ?? null, mining: (flag?.mining as boolean | null | undefined) ?? null })
}

/* ------------------------------------------------------------- event writes */
// The same shared plumbing as every live CRM entity (lib/crm-write.ts): write
// gate, re-reads, ownership stamp, guarded edit, audited purge.

export async function loadEventClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

/** People for the Account Manager / Logistics Coordinator / Feedback Report pickers. */
export async function loadEventUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

/** Validate + build the FLATTENED event columns — shared by create and edit. */
async function buildEventColumns(input: NewEventInput): Promise<ActionResult<Record<string, unknown>>> {
  if (!cleanText(input.clientAccountId)) return fail("Pick a client.")
  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

  const name = cleanText(input.name)
  if (!name) return fail("Enter the event name.")

  const state = EVENT_STATE_OPTIONS.find((s) => s.code === input.stateCode)
  if (!state) return fail("Pick a stage.")
  const marketing = EVENT_MARKETING_OPTIONS.find((m) => m.code === input.marketingCode)
  if (!marketing) return fail("Pick a marketing state.")

  const startDay = cleanText(input.meetingsStart)
  const endDay = cleanText(input.meetingsEnd)
  if (startDay && !isIsoDate(startDay)) return fail("The meetings start isn't a valid date.")
  if (endDay && !isIsoDate(endDay)) return fail("The meetings end isn't a valid date.")
  if (startDay && endDay && endDay < startDay) return fail("The meetings end is before the start.")

  const slotsText = cleanText(input.slots)
  const slots = slotsText === null ? null : Number(slotsText)
  if (slots !== null && (!Number.isInteger(slots) || slots < 0 || slots > 1000)) {
    return fail("Slots must be a whole number.")
  }

  const days: Record<string, string | null> = {}
  for (const [k, label] of [
    ["launchWeek", "Launch Week"],
    ["memoDate", "Memo Date"],
    ["lastDataUpload", "Last Data Upload"],
    ["shareholderReportReceived", "Shareholder Report Received"],
    ["targetingDate", "Targeting Date"],
  ] as const) {
    const v = cleanText(input[k])
    if (v && !isIsoDate(v)) return fail(`${label} isn't a valid date.`)
    days[k] = v ? easternLocalToIso(`${v}T00:00`) : null
  }

  const people: Record<string, { user_id: string; display_name: string | null } | null> = {}
  for (const k of ["accountManagerId", "logisticsCoordinatorId", "feedbackReportId"] as const) {
    const r = await resolveUser(input[k])
    if (!r.ok) return fail(r.error)
    people[k] = r.data
  }

  const team = cleanText(input.feedbackTeamId)
    ? EVENT_FEEDBACK_TEAMS.find((t) => t.id === input.feedbackTeamId)
    : null
  if (cleanText(input.feedbackTeamId) && !team) return fail("Unknown feedback team.")

  const pickedLeads = new Set(input.leadCodes ?? [])
  const leads = EVENT_LEAD_OPTIONS.filter((o) => pickedLeads.has(o.code))
  if (leads.length !== pickedLeads.size) return fail("Unknown lead.")

  const urgency =
    input.urgencyCode == null ? null : EVENT_URGENCY_OPTIONS.find((u) => u.code === input.urgencyCode)
  if (input.urgencyCode != null && !urgency) return fail("Unknown urgency.")

  // The ticker rides on the event row too (events.client_ticker).
  const { data: acct } = await getSupabaseServer()
    .from("accounts")
    .select("ticker_symbol")
    .eq("account_id", client.account_id)
    .maybeSingle()

  return ok({
    name,
    client_account_id: client.account_id,
    client_account_name: client.name,
    client_ticker: (acct as { ticker_symbol?: string | null } | null)?.ticker_symbol ?? null,
    dates: cleanText(input.dates),
    event_location: cleanText(input.location),
    event_start_actual: startDay ? easternLocalToIso(`${startDay}T00:00`) : null,
    event_end_actual: endDay ? easternLocalToIso(`${endDay}T00:00`) : null,
    of_slots: slots,
    event_state_code: state.code,
    event_state_label: state.label,
    marketing_state_code: marketing.code,
    marketing_state_label: marketing.label,
    event_notes: cleanText(input.notes),

    tbc: input.tbc === true,
    mining: input.mining === true,
    team: input.team === true,
    sales_lead_primary_id: people.accountManagerId?.user_id ?? null,
    sales_lead_primary_name: people.accountManagerId?.display_name ?? null,
    logistics_coordinator_id: people.logisticsCoordinatorId?.user_id ?? null,
    logistics_coordinator_name: people.logisticsCoordinatorId?.display_name ?? null,
    feedback_report_id: people.feedbackReportId?.user_id ?? null,
    feedback_report_name: people.feedbackReportId?.display_name ?? null,
    feedback_team_id: team?.id ?? null,
    feedback_team_name: team?.name ?? null,
    leads_codes: leads.length ? leads.map((l) => l.code).join(",") : null,
    leads_labels: leads.length ? leads.map((l) => l.label).join("; ") : null,
    event_parameters: cleanText(input.eventParameters),
    urgency_code: urgency?.code ?? null,
    urgency_label: urgency?.label ?? null,
    proposed_launch_date: days.launchWeek,
    teaser_date: days.memoDate,
    last_data_upload: days.lastDataUpload,
    shareholder_report_received_date: days.shareholderReportReceived,
    targeting_date: days.targetingDate,
    targeting_not_required: input.targetingNotRequired === true,
    teaser_not_required: input.memoNotRequired === true,
    targeting_url: cleanText(input.targetingUrl),
    profile_link: cleanText(input.profileLink),
    targeting_notes: cleanText(input.targetingNotes),
    launch: input.launch === true,
    outreach_complete: input.outreachComplete === true,
  })
}

/**
 * "Add New Event" — insert ONE dashboard-authored marketing event.
 *
 * Constraints on public.events (checked live 2026-09-23): event_id is the only
 * required column with no default; there are NO foreign keys, so the client is
 * re-read here. of_slots is the capacity; the view computes slots_remaining
 * from confirmed meetings. _raw is {} — the only view reading an event's _raw
 * is v_live_outreach (bcs_mining), where missing means "not mining".
 *
 * NOT FILTERED ANYWHERE: the "Live Outreach" stage puts the event on the Live
 * Outreach page AND in its daily email. Containment is the ZVZZT test client.
 */
export async function createEvent(input: NewEventInput): Promise<ActionResult<{ eventId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting events")
  if (!gate.ok) return fail(gate.error)

  const built = await buildEventColumns(input)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    event_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    is_test: input.isTest === true,
    ...built.data,
    owner_id: gate.userId,
    owner_name: gate.name,
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

  const { error } = await getSupabaseServer().from("events").insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "events",
    recordId: row.event_id,
    changes: snapshot,
    context: "/events · Add New Event",
  })

  revalidatePath("/events")
  return ok({ eventId: row.event_id })
}

/** A DASHBOARD event, as form input — Dynamics rows are refused. */
export async function loadEventForEdit(id: string): Promise<ActionResult<NewEventInput>> {
  const res = await loadDashboardRowForEdit(
    "events",
    "event_id",
    id,
    "client_account_id, name, event_state_code, marketing_state_code, dates, event_location, event_start_actual, event_end_actual, of_slots, event_notes, tbc, team, mining, sales_lead_primary_id, logistics_coordinator_id, feedback_report_id, feedback_team_id, leads_codes, event_parameters, urgency_code, proposed_launch_date, teaser_date, last_data_upload, shareholder_report_received_date, targeting_date, targeting_not_required, teaser_not_required, targeting_url, profile_link, targeting_notes, launch, outreach_complete",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  return ok({
    clientAccountId: (r.client_account_id as string | null) ?? null,
    name: asText(r.name),
    stateCode: Number(r.event_state_code ?? EVENT_STATE_OPTIONS[0].code),
    marketingCode: Number(r.marketing_state_code ?? EVENT_MARKETING_OPTIONS[0].code),
    dates: asText(r.dates),
    location: asText(r.event_location),
    meetingsStart: isoToEasternDate(r.event_start_actual),
    meetingsEnd: isoToEasternDate(r.event_end_actual),
    slots: asText(r.of_slots),
    notes: asText(r.event_notes),
    tbc: r.tbc === true,
    mining: r.mining === true,
    team: r.team === true,
    accountManagerId: (r.sales_lead_primary_id as string | null) ?? null,
    logisticsCoordinatorId: (r.logistics_coordinator_id as string | null) ?? null,
    feedbackReportId: (r.feedback_report_id as string | null) ?? null,
    feedbackTeamId: (r.feedback_team_id as string | null) ?? null,
    leadCodes: asText(r.leads_codes).split(",").filter(Boolean),
    eventParameters: asText(r.event_parameters),
    urgencyCode: r.urgency_code == null ? null : Number(r.urgency_code),
    launchWeek: isoToEasternDate(r.proposed_launch_date),
    memoDate: isoToEasternDate(r.teaser_date),
    lastDataUpload: isoToEasternDate(r.last_data_upload),
    shareholderReportReceived: isoToEasternDate(r.shareholder_report_received_date),
    targetingDate: isoToEasternDate(r.targeting_date),
    targetingNotRequired: r.targeting_not_required === true,
    memoNotRequired: r.teaser_not_required === true,
    targetingUrl: asText(r.targeting_url),
    profileLink: asText(r.profile_link),
    targetingNotes: asText(r.targeting_notes),
    launch: r.launch === true,
    outreachComplete: r.outreach_complete === true,
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD event. The origin guard lives in updateDashboardRow. */
export async function updateEvent(id: string, input: NewEventInput): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing events")
  if (!gate.ok) return fail(gate.error)
  const built = await buildEventColumns(input)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: "events",
    pk: "event_id",
    id,
    patch: built.data,
    path: "/events",
    context: "/events · Edit event",
    verb: "editing events",
  })
}

export async function countTestEvents(): Promise<ActionResult<number>> {
  return countTestRows("events", "event_id")
}

export async function purgeTestEvents(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: "events",
    pk: "event_id",
    snapshot: "name, client_account_name, event_state_label, dates, created_on, created_by_name",
    path: "/events",
    context: "/events · Delete test events",
  })
}
