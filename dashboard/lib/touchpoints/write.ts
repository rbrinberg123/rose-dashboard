import "server-only"

/**
 * The touchpoint READ / WRITE core, UNGATED — moved out of
 * app/touchpoints/actions.ts (2026-10-12) so two differently-gated entry points
 * share one implementation:
 *
 *   - app/touchpoints/actions.ts   the Touchpoints tab — super_user
 *                                  (requireCrmWriter / getEffectiveRole)
 *   - app/onboarding/actions.ts    the Onboarding page's two date cells — the
 *                                  viewer's client scope (resolveClientScope),
 *                                  Onboarding Call / Teach-in touchpoints only
 *
 * NOTHING here checks who the caller is. Every call from a "use server" file
 * must sit behind a gate, and nothing here may be re-exported from one (a
 * "use server" export is a public endpoint). "server-only" keeps it off the
 * client bundle.
 */

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import {
  DASHBOARD_ROW_BASE,
  asText,
  cleanText,
  easternLocalToIso,
  isUuid,
  isoToEasternLocal,
  readDashboardRowForEdit,
  resolveAccount,
  updateDashboardRow,
} from "@/lib/crm-write"
import {
  TOUCH_CONTACT_TYPE_OPTIONS,
  TOUCH_STATUS_OPTIONS,
  TOUCH_TYPE_OPTIONS,
  validateTouchRequired,
  type NewTouchInput,
  type TouchContact,
} from "@/lib/touchpoints/create"
import { TOUCHPOINTS_SPEC } from "@/lib/touchpoints/spec"
import type { TouchpointRecord } from "@/lib/touchpoints/record"

/** Whoever the caller's gate let through — stamped as created/modified by. */
export type TouchActor = { userId: string | null; name: string | null }

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE touchpoint's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list: the list carries only its
 * seven display columns, and the single biggest field on the record — the
 * free-text call notes, often several paragraphs and present on 93% of rows — is
 * never shown in the table at all. One row on open is far cheaper than a
 * thousand rows of notes nobody reads.
 *
 * No `_raw` here. The view already digs `modified_by_name` out of it (the mirror
 * flattens created_by but not modified_by), so every field the drawer wants is a
 * real column by the time this query runs; `_raw` is deliberately NOT selected by
 * either this query or the list.
 */
const RECORD_COLUMNS = [
  "touchpoint_id",
  "client_account_id",
  "subject",
  "description",
  "touchpoint_type_label",
  "contact_type_label",
  "direction_label",
  "status_label",
  "state_label",
  "touchpoint_date",
  "scheduled_end",
  "duration_minutes",
  "client_account_name",
  "client_ticker",
  "regarding_id",
  "created_by_id",
  "created_by_name",
  "modified_by_name",
  "owner_team_name",
  "created_on",
  "modified_on",
  "is_recent",
].join(", ")

/** One touchpoint for the drawer, ANY origin. UNGATED — callers gate. */
export async function readTouchRecord(
  touchpointId: string,
): Promise<ActionResult<TouchpointRecord>> {
  if (!touchpointId) return fail("No touchpoint id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(TOUCHPOINTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("touchpoint_id", touchpointId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Touchpoint not found.")

  // is_test for the drawer TEST badge, read off the table (not the view) so the
  // drawer does not depend on the view patch. Non-fatal if it fails.
  const { data: flag } = await sb
    .from("touchpoints")
    .select("is_test, origin")
    .eq("touchpoint_id", touchpointId)
    .maybeSingle()

  return ok({ ...(data as unknown as TouchpointRecord), is_test: flag?.is_test === true, origin: (flag?.origin as string | undefined) ?? null })
}

/* ------------------------------------------------------ client contacts */

const TOUCH_CONTACTS_PATCH_MSG =
  "Client contacts need the 2026-10-12 touchpoint_contacts SQL patch run first."

/** Before sql/patches/2026-10-12_touchpoint_contacts.sql runs, the table is missing. */
function isMissingTouchContacts(message: string): boolean {
  return /touchpoint_contacts|does not exist/.test(message)
}

type ContactRow = { contact_id: string; full_name: string | null; job_title: string | null; parent_customer_name: string | null }

/** "Job title · Company" — the chips' / list's second line (as on events). */
function touchContactDetail(c: { job_title: string | null; parent_customer_name: string | null }): string | null {
  return [c.job_title, c.parent_customer_name].map((v) => (v ?? "").trim()).filter(Boolean).join(" · ") || null
}

/** A touchpoint's client contacts, joined to their contact records. UNGATED — callers gate. */
export async function readTouchContacts(touchpointId: string): Promise<ActionResult<TouchContact[]>> {
  const sb = getSupabaseServer()
  const { data: links, error } = await sb
    .from("touchpoint_contacts")
    .select("contact_id, added_at")
    .eq("touchpoint_id", touchpointId)
    .order("added_at")
  if (error) {
    if (isMissingTouchContacts(error.message)) return ok([])
    return fail(describeError(error))
  }
  const ids = (links ?? []).map((l) => l.contact_id as string)
  if (ids.length === 0) return ok([])
  const { data: contacts, error: cErr } = await sb
    .from("contacts")
    .select("contact_id, full_name, job_title, parent_customer_name")
    .in("contact_id", ids)
  if (cErr) return fail(describeError(cErr))
  const byId = new Map(((contacts ?? []) as ContactRow[]).map((c) => [c.contact_id, c]))
  return ok(
    ids.map((id) => {
      const c = byId.get(id)
      return { contactId: id, name: c?.full_name ?? "(deleted contact)", detail: c ? touchContactDetail(c) : null }
    }),
  )
}


/**
 * Make the touchpoint's client contacts exactly `wanted` (adds + removes,
 * audited) — the touchpoint twin of the event form's saveRepresentatives.
 * Contact ids are re-read, and each must belong to `clientAccountId`, so a
 * tampered request can only attach real contacts at this touchpoint's client.
 * UNGATED — the caller has already gated this dashboard touchpoint.
 */
export async function saveTouchContacts(
  touchpointId: string,
  clientAccountId: string | null,
  wanted: TouchContact[],
  actor: { userId: string | null; name: string | null },
  context: string,
): Promise<ActionResult<{ added: number; removed: number }>> {
  const sb = getSupabaseServer()
  const want = [...new Set((wanted ?? []).map((c) => c.contactId))]
  if (want.some((id) => !isUuid(id))) return fail("Unknown contact.")
  if (want.length > 100) return fail("Too many client contacts.")
  if (want.length) {
    const { data: found, error } = await sb
      .from("contacts")
      .select("contact_id, parent_customer_id")
      .in("contact_id", want)
    if (error) return fail(describeError(error))
    const rows = (found ?? []) as { contact_id: string; parent_customer_id: string | null }[]
    if (rows.length !== want.length) return fail("A selected contact no longer exists.")
    if (rows.some((r) => !clientAccountId || r.parent_customer_id !== clientAccountId)) {
      return fail("Every client contact must be a contact at this touchpoint's client.")
    }
  }

  const { data: current, error: curErr } = await sb
    .from("touchpoint_contacts")
    .select("contact_id")
    .eq("touchpoint_id", touchpointId)
  if (curErr) {
    if (isMissingTouchContacts(curErr.message)) {
      return want.length ? fail(TOUCH_CONTACTS_PATCH_MSG) : ok({ added: 0, removed: 0 })
    }
    return fail(describeError(curErr))
  }
  const have = new Set((current ?? []).map((r) => r.contact_id as string))
  const toAdd = want.filter((id) => !have.has(id))
  const toRemove = [...have].filter((id) => !want.includes(id))

  if (toAdd.length) {
    const { error } = await sb.from("touchpoint_contacts").insert(
      toAdd.map((contact_id) => ({
        touchpoint_id: touchpointId,
        contact_id,
        added_by_id: actor.userId,
        added_by_name: actor.name,
      })),
    )
    if (error) return fail(describeError(error))
  }
  if (toRemove.length) {
    const { error } = await sb
      .from("touchpoint_contacts")
      .delete()
      .eq("touchpoint_id", touchpointId)
      .in("contact_id", toRemove)
    if (error) return fail(describeError(error))
  }
  if (toAdd.length || toRemove.length) {
    await recordAudit({
      action: "update",
      entity: "touchpoint_contacts",
      recordId: touchpointId,
      changes: { added: toAdd, removed: toRemove },
      context,
    })
  }
  return ok({ added: toAdd.length, removed: toRemove.length })
}

/** Validate + build the FLATTENED touch columns — shared by create and edit. */
export async function buildTouchColumns(input: NewTouchInput): Promise<ActionResult<Record<string, unknown>>> {
  // REQUIRED: Client, Date, Subject, Type, Contact Type — the same rule the
  // form applies before submit (lib/touchpoints/create.ts validateTouchRequired).
  const missing = Object.values(validateTouchRequired(input))
  if (missing.length) return fail(missing.join(" "))
  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

  const subject = cleanText(input.subject)
  if (!subject) return fail("Enter a subject.")

  const type = TOUCH_TYPE_OPTIONS.find((o) => o.code === input.typeCode)
  if (!type) return fail("Pick a touchpoint type.")

  const picked = new Set(input.contactTypeCodes ?? [])
  const contactTypes = TOUCH_CONTACT_TYPE_OPTIONS.filter((o) => picked.has(o.code))
  if (contactTypes.length !== picked.size) return fail("Unknown contact type.")

  const start = easternLocalToIso(input.start)
  if (!start) return fail("Enter the date and time.")

  const durText = cleanText(input.durationMinutes)
  const duration = durText === null ? null : Number(durText)
  if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 1440)) {
    return fail("Duration must be whole minutes (0–1440).")
  }

  const status = TOUCH_STATUS_OPTIONS.find((s) => s.key === input.statusKey)
  if (!status) return fail("Pick a status.")

  // Owner Team: on touches the owner is a per-client Dynamics TEAM (named after
  // the account), never a person, and there is no teams table to pick from. So
  // it is DERIVED: the team the client's own synced touches use (97% have one).
  const { data: teamRows } = await getSupabaseServer()
    .from("touchpoints")
    .select("owner_id, owner_name")
    .eq("client_account_id", client.account_id)
    .eq("origin", "dynamics")
    .not("owner_id", "is", null)
    .order("modified_on", { ascending: false })
    .limit(1)
  const team = (teamRows?.[0] as { owner_id: string; owner_name: string | null } | undefined) ?? null

  return ok({
    owner_id: team?.owner_id ?? null,
    owner_name: team?.owner_name ?? null,
    state_code: status.state,
    state_label: status.stateLabel,
    status_code: status.status,
    status_label: status.statusLabel,
    subject,
    description: cleanText(input.description),
    touchpoint_type_code: type.code,
    touchpoint_type_label: type.label,
    contact_type_code: contactTypes.length ? contactTypes.map((o) => o.code).join(",") : null,
    contact_type_label: contactTypes.length ? contactTypes.map((o) => o.label).join("; ") : null,
    client_account_id: client.account_id,
    client_account_name: client.name,
    regarding_id: client.account_id,
    direction_code: input.outgoing !== false,
    scheduled_start: start,
    scheduled_end:
      duration !== null ? new Date(Date.parse(start) + duration * 60_000).toISOString() : start,
    actual_duration_minutes: duration,
  })
}

/* ------------------------------------------------------------- touch writes */

/**
 * "Add New Touch" — insert ONE dashboard-authored touchpoint (phonecall mirror).
 *
 * Constraints on public.touchpoints (checked live 2026-09-23): touchpoint_id is
 * the only required column with no default; client_account_id → accounts is
 * the one enforced FK. owner is left NULL on purpose: on this entity the owner
 * is a per-client TEAM named after the account, never a person. regarding_id =
 * the client (97% of Dynamics touches); state "Open" (96% of live rows).
 *
 * NOT FILTERED ANYWHERE. Containment is the ZVZZT test client.
 *
 * UNGATED — callers pass an actor they have already gated (createTouch:
 * requireCrmWriter; the Onboarding cells: their client-scope gate).
 */
export async function insertTouch(
  input: NewTouchInput,
  gate: TouchActor,
  context: string,
): Promise<ActionResult<{ touchpointId: string }>> {
  const built = await buildTouchColumns(input)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    touchpoint_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    is_test: input.isTest === true,
    ...built.data,
    created_by_id: gate.userId,
    created_by_name: gate.name,
    modified_by_id: gate.userId,
    modified_by_name: gate.name,
    created_on: now,
    modified_on: now,
  }

  const { error } = await getSupabaseServer().from("touchpoints").insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "touchpoints",
    recordId: row.touchpoint_id,
    changes: snapshot,
    context,
  })

  // Client contacts — saved after the touchpoint exists (FK).
  const links = await saveTouchContacts(
    row.touchpoint_id,
    input.clientAccountId,
    input.contacts ?? [],
    { userId: gate.userId, name: gate.name },
    `${context} · client contacts`,
  )
  revalidatePath("/touchpoints")
  if (!links.ok) return fail(`The touchpoint was created, but its client contacts were not saved: ${links.error}`)
  return ok({ touchpointId: row.touchpoint_id })
}

/** A DASHBOARD touch, as form input — Dynamics rows are refused. UNGATED — callers gate. */
export async function readTouchForEdit(id: string): Promise<ActionResult<NewTouchInput>> {
  const res = await readDashboardRowForEdit(
    "touchpoints",
    "touchpoint_id",
    id,
    "client_account_id, subject, description, touchpoint_type_code, contact_type_code, direction_code, scheduled_start, actual_duration_minutes, status_code",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  const contacts = await readTouchContacts(id)
  if (!contacts.ok) return fail(contacts.error)
  return ok({
    contacts: contacts.data!,
    clientAccountId: (r.client_account_id as string | null) ?? null,
    subject: asText(r.subject),
    description: asText(r.description),
    typeCode: asText(r.touchpoint_type_code),
    contactTypeCodes: asText(r.contact_type_code).split(",").filter(Boolean),
    outgoing: r.direction_code !== false,
    start: isoToEasternLocal(r.scheduled_start),
    durationMinutes: asText(r.actual_duration_minutes),
    statusKey: (TOUCH_STATUS_OPTIONS.find((s) => s.status === r.status_code) ?? TOUCH_STATUS_OPTIONS[0]).key,
    isTest: r.is_test === true,
  })
}

/**
 * Edit a DASHBOARD touch. The origin guard lives in updateDashboardRow, which
 * is handed the already-gated actor. UNGATED here — callers gate.
 */
export async function updateTouchRow(
  id: string,
  input: NewTouchInput,
  gate: TouchActor,
  context: string,
): Promise<ActionResult<{ changed: number }>> {
  const built = await buildTouchColumns(input)
  if (!built.ok) return fail(built.error)
  // updateDashboardRow holds the origin guard, so contacts are only saved for
  // a row it actually let through.
  const res = await updateDashboardRow({
    table: "touchpoints",
    pk: "touchpoint_id",
    id,
    patch: built.data,
    path: "/touchpoints",
    context,
    verb: "editing touchpoints",
    actor: gate,
  })
  if (!res.ok) return res
  const links = await saveTouchContacts(
    id,
    input.clientAccountId,
    input.contacts ?? [],
    { userId: gate.userId, name: gate.name },
    `${context} · client contacts`,
  )
  if (!links.ok) return fail(`Changes saved, but client contacts were not: ${links.error}`)
  if (links.data!.added || links.data!.removed) revalidatePath("/touchpoints")
  return res
}

/* ---------------------------------------------- contact picker options */

/** One contact in the touch form's Client Contact picker. */
export type TouchContactOption = {
  contact_id: string
  full_name: string | null
  job_title: string | null
  parent_customer_name: string | null
}

/**
 * The picker's candidates: ACTIVE contacts at one client — the same query as
 * the event form's loadEventContactOptions in client-only mode. UNGATED.
 */
export async function readTouchContactOptions(
  clientAccountId: string | null,
): Promise<ActionResult<TouchContactOption[]>> {
  if (!clientAccountId || !isUuid(clientAccountId)) return ok([])
  const { data, error } = await getSupabaseServer()
    .from("contacts")
    .select("contact_id, full_name, job_title, parent_customer_name")
    .eq("state_label", "Active")
    .eq("parent_customer_id", clientAccountId)
    .order("full_name", { ascending: true })
    .limit(5000)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as TouchContactOption[])
}
