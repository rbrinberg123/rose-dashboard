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
  isUuid,
  purgeTestRows,
  requireCrmWriter,
  loadUserOptions,
  loadActiveAccountOptions,
  updateDashboardRow,
  loadDashboardRowForEdit,
  asText,
  isoToEasternDate,
  resolveAccount,
} from "@/lib/crm-write"
import {
  EVENT_LEAD_OPTIONS,
  EVENT_MARKETING_OPTIONS,
  EVENT_STATE_OPTIONS,
  EVENT_URGENCY_OPTIONS,
  EVENT_TASK_DATE_SUBTYPES,
  validateEventRequired,
  type EventRepresentative,
  type EventTaskDateKey,
  type EventTaskDates,
  buildEventName,
  type NewEventInput,
} from "@/lib/events/create"
import { ACCOUNT_TEAM_KEYS } from "@/lib/account-team"
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
    .select("is_test, origin, mining, paused")
    .eq("event_id", eventId)
    .maybeSingle()

  // The client's CURRENT account team, for the drawer's icons — read live off
  // the account (projected from account_team_members for dashboard clients).
  const clientId = (data as unknown as EventRecord).client_account_id
  let clientTeam: EventRecord["client_team"] = []
  if (clientId) {
    const { data: acct } = await sb
      .from("accounts")
      .select([...ACCOUNT_TEAM_KEYS, "feedback_report_name"].join(", "))
      .eq("account_id", clientId)
      .maybeSingle()
    const a = (acct ?? {}) as unknown as Record<string, string | null>
    clientTeam = CLIENT_TEAM_FIELDS.map((f) => ({ role: f.role, name: a[f.key] ?? null }))
  }

  return ok({
    ...(data as unknown as EventRecord),
    is_test: flag?.is_test === true,
    origin: (flag?.origin as string | undefined) ?? null,
    mining: (flag?.mining as boolean | null | undefined) ?? null,
    paused: (flag?.paused as boolean | null | undefined) ?? null,
    client_team: clientTeam,
  })
}

/** The account-team roles the drawer shows, in order, with their accounts column. */
const CLIENT_TEAM_FIELDS = [
  { role: "Account Manager", key: "sales_lead_primary_name" },
  { role: "Secondary Manager", key: "secondary_manager_name" },
  { role: "Associate", key: "associate_name" },
  { role: "Logistics Coordinator", key: "logistics_coordinator_name" },
  { role: "Feedback Report", key: "feedback_report_name" },
] as const

/* ------------------------------------------------------------- event writes */
// The same shared plumbing as every live CRM entity (lib/crm-write.ts): write
// gate, re-reads, ownership stamp, guarded edit, audited purge.

/**
 * The form's client picker: ACTIVE clients only — accounts.state_label =
 * 'Active', the same rule Portfolio and the views use. `includeAccountId`
 * keeps an edited event's own client listed even if it has since gone
 * inactive.
 */
export async function loadEventClientOptions(includeAccountId?: string | null): Promise<ActionResult<AccountOption[]>> {
  return loadActiveAccountOptions(includeAccountId)
}

/** People for the Account Manager / Logistics Coordinator / Feedback Report pickers. */
export async function loadEventUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

/**
 * The client's three LOOKED-UP dates — Last Data Upload, Memo Date, Targeting
 * Date: each the completion time of its most recent Completed task of that
 * sub-type (EVENT_TASK_DATE_SUBTYPES, linked by bcs_account_id). Client-level —
 * the latest wins whichever event it was for. null = none. Same rule as
 * event_client_latest_task() in SQL, which keeps the stored columns fresh.
 */
async function latestTaskDates(accountId: string): Promise<ActionResult<EventTaskDates>> {
  const keys = Object.keys(EVENT_TASK_DATE_SUBTYPES) as EventTaskDateKey[]
  const results = await Promise.all(
    keys.map((k) =>
      getSupabaseServer()
        .from("tasks")
        .select("actual_end")
        .eq("bcs_account_id", accountId)
        .eq("bcs_task_subtype_label", EVENT_TASK_DATE_SUBTYPES[k])
        .eq("state_label", "Completed")
        .not("actual_end", "is", null)
        .order("actual_end", { ascending: false })
        .limit(1),
    ),
  )
  const out = {} as EventTaskDates
  for (let i = 0; i < keys.length; i++) {
    const { data, error } = results[i]
    if (error) return fail(describeError(error))
    out[keys[i]] = ((data ?? [])[0]?.actual_end as string | undefined) ?? null
  }
  return ok(out)
}

/** The form's read-only task-derived dates, for the picked client. */
export async function loadClientTaskDates(accountId: string): Promise<ActionResult<EventTaskDates>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  if (!isUuid(accountId)) return fail("Unknown client.")
  return latestTaskDates(accountId)
}

/* ------------------------------------------------- company representatives */

export type EventContactOption = { contact_id: string; full_name: string | null; job_title: string | null; parent_customer_name: string | null }

/**
 * Contacts for the "Add existing contact" picker: by default the event
 * client's own contacts (contacts.parent_customer_id = the client); `all`
 * widens to every active contact. Active contacts only.
 */
export async function loadEventContactOptions(input: {
  clientAccountId: string | null
  all: boolean
}): Promise<ActionResult<EventContactOption[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  let q = getSupabaseServer()
    .from("contacts")
    .select("contact_id, full_name, job_title, parent_customer_name")
    .eq("state_label", "Active")
  if (!input.all) {
    if (!input.clientAccountId || !isUuid(input.clientAccountId)) return ok([])
    q = q.eq("parent_customer_id", input.clientAccountId)
  }
  const { data, error } = await q.order("full_name", { ascending: true }).limit(5000)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as EventContactOption[])
}

/** "Job title · Company" — the picker / list's second line. */
function contactDetail(c: { job_title: string | null; parent_customer_name: string | null }): string | null {
  return [c.job_title, c.parent_customer_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ") || null
}

/** An event's representatives, joined to their contact records. */
async function loadRepresentatives(eventId: string): Promise<ActionResult<EventRepresentative[]>> {
  const sb = getSupabaseServer()
  const { data: links, error } = await sb.from("event_contacts").select("contact_id, added_at").eq("event_id", eventId).order("added_at")
  if (error) {
    // Before sql/patches/2026-10-07g runs, the table doesn't exist — no reps.
    if (/event_contacts|does not exist/.test(error.message)) return ok([])
    return fail(describeError(error))
  }
  const ids = (links ?? []).map((l) => l.contact_id as string)
  if (ids.length === 0) return ok([])
  const { data: contacts, error: cErr } = await sb
    .from("contacts")
    .select("contact_id, full_name, job_title, parent_customer_name")
    .in("contact_id", ids)
  if (cErr) return fail(describeError(cErr))
  const byId = new Map(((contacts ?? []) as EventContactOption[]).map((c) => [c.contact_id, c]))
  return ok(
    ids.map((id) => {
      const c = byId.get(id)
      return { contactId: id, name: c?.full_name ?? "(deleted contact)", detail: c ? contactDetail(c) : null }
    }),
  )
}

/** The drawer's Company Representatives list (any origin; empty for Dynamics). */
export async function loadEventRepresentatives(eventId: string): Promise<ActionResult<EventRepresentative[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  if (!isUuid(eventId)) return fail("Unknown event.")
  return loadRepresentatives(eventId)
}

/**
 * Make the event's representatives exactly `wanted` (adds + removes, audited).
 * Contact ids are re-read so a tampered request can only attach real contacts.
 * Caller has already passed requireCrmWriter for this dashboard event.
 */
async function saveRepresentatives(
  eventId: string,
  wanted: EventRepresentative[],
  actor: { userId: string | null; name: string | null },
  context: string,
): Promise<ActionResult<{ added: number; removed: number }>> {
  const sb = getSupabaseServer()
  const want = [...new Set((wanted ?? []).map((r) => r.contactId))]
  if (want.some((id) => !isUuid(id))) return fail("Unknown contact.")
  if (want.length > 100) return fail("Too many representatives.")
  if (want.length) {
    const { data: found, error } = await sb.from("contacts").select("contact_id").in("contact_id", want)
    if (error) return fail(describeError(error))
    if ((found ?? []).length !== want.length) return fail("A selected contact no longer exists.")
  }

  const { data: current, error: curErr } = await sb.from("event_contacts").select("contact_id").eq("event_id", eventId)
  if (curErr) {
    if (/event_contacts|does not exist/.test(curErr.message)) {
      return want.length ? fail("Company representatives need the 2026-10-07g SQL patch run first.") : ok({ added: 0, removed: 0 })
    }
    return fail(describeError(curErr))
  }
  const have = new Set((current ?? []).map((r) => r.contact_id as string))
  const toAdd = want.filter((id) => !have.has(id))
  const toRemove = [...have].filter((id) => !want.includes(id))

  if (toAdd.length) {
    const { error } = await sb.from("event_contacts").insert(
      toAdd.map((contact_id) => ({ event_id: eventId, contact_id, added_by_id: actor.userId, added_by_name: actor.name })),
    )
    if (error) return fail(describeError(error))
  }
  if (toRemove.length) {
    const { error } = await sb.from("event_contacts").delete().eq("event_id", eventId).in("contact_id", toRemove)
    if (error) return fail(describeError(error))
  }
  if (toAdd.length || toRemove.length) {
    await recordAudit({
      action: "update",
      entity: "event_contacts",
      recordId: eventId,
      changes: { added: toAdd, removed: toRemove },
      context,
    })
  }
  return ok({ added: toAdd.length, removed: toRemove.length })
}

/** Validate + build the FLATTENED event columns — shared by create and edit. */
async function buildEventColumns(input: NewEventInput): Promise<ActionResult<Record<string, unknown>>> {
  // REQUIRED: Client, Location, # of Slots, Urgency — the same rule the form
  // applies before submit (lib/events/create.ts validateEventRequired).
  const missing = Object.values(validateEventRequired(input))
  if (missing.length) return fail(missing.join(" "))
  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

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
  ] as const) {
    const v = cleanText(input[k])
    if (v && !isIsoDate(v)) return fail(`${label} isn't a valid date.`)
    days[k] = v ? easternLocalToIso(`${v}T00:00`) : null
  }

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
  const ticker = (acct as { ticker_symbol?: string | null } | null)?.ticker_symbol ?? null

  // The name is REBUILT here from the raw fields on every save — never taken
  // from the browser. A client with no ticker falls back to its name.
  const name = buildEventName(cleanText(ticker) ?? client.name, input.location, input.dates)

  // Last Data Upload / Memo Date / Targeting Date are LOOKED UP (the client's
  // latest completed task of each sub-type), never typed. The database keeps
  // them fresh as tasks change (sql/patches/2026-10-07g_event_reps_task_dates.sql).
  const taskDates = await latestTaskDates(client.account_id)
  if (!taskDates.ok) return fail(taskDates.error)

  // NO stage and NO marketing state here: event_state_* are computed by the
  // database (events_compute_stage, sql/patches/2026-10-07e/f) from launch /
  // outreach_complete / paused below + meetings + feedback tasks, and
  // marketing_state_* is derived from that stage in the same trigger.
  // Shareholder Report Received is no longer written (column kept for history).
  // NO people either: createEvent snapshots the client's team once, at create;
  // an edit never rewrites them.
  return ok({
    name,
    client_account_id: client.account_id,
    client_account_name: client.name,
    client_ticker: ticker,
    dates: cleanText(input.dates),
    event_location: cleanText(input.location),
    event_start_actual: startDay ? easternLocalToIso(`${startDay}T00:00`) : null,
    event_end_actual: endDay ? easternLocalToIso(`${endDay}T00:00`) : null,
    of_slots: slots,
    event_notes: cleanText(input.notes),

    tbc: input.tbc === true,
    mining: input.mining === true,
    team: input.team === true,
    leads_codes: leads.length ? leads.map((l) => l.code).join(",") : null,
    leads_labels: leads.length ? leads.map((l) => l.label).join("; ") : null,
    event_parameters: cleanText(input.eventParameters),
    urgency_code: urgency?.code ?? null,
    urgency_label: urgency?.label ?? null,
    proposed_launch_date: days.launchWeek,
    teaser_date: taskDates.data!.memoDate,
    last_data_upload: taskDates.data!.lastDataUpload,
    targeting_date: taskDates.data!.targetingDate,
    targeting_not_required: input.targetingNotRequired === true,
    teaser_not_required: input.memoNotRequired === true,
    targeting_url: cleanText(input.targetingUrl),
    profile_link: cleanText(input.profileLink),
    targeting_notes: cleanText(input.targetingNotes),
    launch: input.launch === true,
    outreach_complete: input.outreachComplete === true,
    paused: input.paused === true,
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

  // ACCOUNT-TEAM SNAPSHOT: the event's three people columns are copied from the
  // client's CURRENT account team (its accounts lookups) — once, here. Edits
  // never rewrite them, so they record who was on the team at creation, and
  // every downstream reader of the event columns is unchanged. Feedback Team is
  // left blank.
  const { data: team, error: teamErr } = await getSupabaseServer()
    .from("accounts")
    .select(
      "sales_lead_primary_id, sales_lead_primary_name, logistics_coordinator_id, logistics_coordinator_name, feedback_report_id, feedback_report_name",
    )
    .eq("account_id", built.data.client_account_id as string)
    .maybeSingle()
  if (teamErr) return fail(describeError(teamErr))
  const t = (team ?? {}) as Record<string, string | null>

  const now = new Date().toISOString()
  const row = {
    event_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    is_test: input.isTest === true,
    ...built.data,
    sales_lead_primary_id: t.sales_lead_primary_id ?? null,
    sales_lead_primary_name: t.sales_lead_primary_name ?? null,
    logistics_coordinator_id: t.logistics_coordinator_id ?? null,
    logistics_coordinator_name: t.logistics_coordinator_name ?? null,
    feedback_report_id: t.feedback_report_id ?? null,
    feedback_report_name: t.feedback_report_name ?? null,
    feedback_team_id: null,
    feedback_team_name: null,
    // Pre-Launch is the starting stage. The database's events_compute_stage
    // trigger overwrites both columns on insert from the toggles, so a form
    // that already ticks Launch lands on Live Outreach.
    event_state_code: EVENT_STATE_OPTIONS[0].code,
    event_state_label: EVENT_STATE_OPTIONS[0].label,
    // …and Not Marketing, which the same trigger derives from the stage.
    marketing_state_code: EVENT_MARKETING_OPTIONS[1].code,
    marketing_state_label: EVENT_MARKETING_OPTIONS[1].label,
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

  // Company representatives — saved after the event exists (FK).
  const reps = await saveRepresentatives(
    row.event_id,
    input.representatives ?? [],
    { userId: gate.userId, name: gate.name },
    "/events · Add New Event · representatives",
  )
  if (!reps.ok) return fail(`The event was created, but its representatives were not saved: ${reps.error}`)

  revalidatePath("/events")
  return ok({ eventId: row.event_id })
}

/**
 * A DASHBOARD event, as form input — Dynamics rows are refused. Also returns
 * its STORED stage (and the stored toggles) for the form's read-only
 * lifecycle stepper — never recomputed here.
 */
export async function loadEventForEdit(id: string): Promise<
  ActionResult<{
    input: NewEventInput
    stage: { event_state_label: string | null; launch: boolean; outreach_complete: boolean; origin: string }
  }>
> {
  const res = await loadDashboardRowForEdit(
    "events",
    "event_id",
    id,
    "client_account_id, dates, event_location, event_start_actual, event_end_actual, of_slots, event_notes, tbc, team, mining, leads_codes, event_parameters, urgency_code, proposed_launch_date, targeting_not_required, teaser_not_required, targeting_url, profile_link, targeting_notes, launch, outreach_complete, paused, event_state_label",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  const reps = await loadRepresentatives(id)
  if (!reps.ok) return fail(reps.error)
  const stage = {
    event_state_label: (r.event_state_label as string | null) ?? null,
    launch: r.launch === true,
    outreach_complete: r.outreach_complete === true,
    origin: "dashboard", // loadDashboardRowForEdit refuses every other origin
  }
  return ok({ stage, input: {
    representatives: reps.data!,
    clientAccountId: (r.client_account_id as string | null) ?? null,
    dates: asText(r.dates),
    location: asText(r.event_location),
    meetingsStart: isoToEasternDate(r.event_start_actual),
    meetingsEnd: isoToEasternDate(r.event_end_actual),
    slots: asText(r.of_slots),
    notes: asText(r.event_notes),
    tbc: r.tbc === true,
    mining: r.mining === true,
    team: r.team === true,
    leadCodes: asText(r.leads_codes).split(",").filter(Boolean),
    eventParameters: asText(r.event_parameters),
    urgencyCode: r.urgency_code == null ? null : Number(r.urgency_code),
    launchWeek: isoToEasternDate(r.proposed_launch_date),
    targetingNotRequired: r.targeting_not_required === true,
    memoNotRequired: r.teaser_not_required === true,
    targetingUrl: asText(r.targeting_url),
    profileLink: asText(r.profile_link),
    targetingNotes: asText(r.targeting_notes),
    launch: r.launch === true,
    outreachComplete: r.outreach_complete === true,
    paused: r.paused === true,
    isTest: r.is_test === true,
  } })
}

/** Edit a DASHBOARD event. The origin guard lives in updateDashboardRow. */
export async function updateEvent(id: string, input: NewEventInput): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing events")
  if (!gate.ok) return fail(gate.error)
  const built = await buildEventColumns(input)
  if (!built.ok) return fail(built.error)
  const updated = await updateDashboardRow({
    table: "events",
    pk: "event_id",
    id,
    patch: built.data,
    path: "/events",
    context: "/events · Edit event",
    verb: "editing events",
  })
  // updateDashboardRow refused a Dynamics / missing row → never touch its reps.
  if (!updated.ok) return updated
  const reps = await saveRepresentatives(
    id,
    input.representatives ?? [],
    { userId: gate.userId, name: gate.name },
    "/events · Edit event · representatives",
  )
  if (!reps.ok) return fail(`Changes saved, but representatives were not: ${reps.error}`)
  revalidatePath("/events")
  return ok({ changed: (updated.data?.changed ?? 0) + reps.data!.added + reps.data!.removed })
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
