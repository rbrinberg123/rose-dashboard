"use server"

/**
 * Contacts' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_contacts_all` is unscoped and read with the
 * service-role key (RLS bypassed), so a successful call hands back every contact
 * at every client. This is the only CRM table that is mostly PERSONAL data —
 * names, job titles, employers, and the do-not-call flag — so treat it at least
 * as carefully as Notes.
 *
 * The page gate and the proxy gate are not enough on their own: a server action
 * is its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with the other five CRM tables
 * so there is one implementation, not six. Read that file's header before
 * changing them.
 *
 * ══ CONTACT WRITES — the first dashboard-authored records ══════════════════
 * `createContact` and `purgeTestContacts` (bottom of this file) are the ONLY
 * functions that write contacts. Every row they create is origin='dashboard',
 * which the ownership fence keeps out of the Dynamics sync, the deletion sweep
 * and the reconciliation approve-delete. Both refuse while impersonating and
 * both call recordAudit. See content/docs/22-cutover-ownership-boundary.md.
 * Contacts and Notes are the only live "Add New"s; every other CRM entity is
 * still the inert stub in components/crm-add-new.tsx.
 */

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import { getEffectiveRole } from "@/lib/effective-identity"
import {
  DASHBOARD_ROW_BASE,
  cleanText,
  countTestRows,
  loadAccountOptions,
  purgeTestRows,
  requireCrmWriter,
  isIsoDate,
  loadUserOptions,
  resolveUser,
  updateDashboardRow,
  loadDashboardRowForEdit,
  asText,
  resolveAccount,
} from "@/lib/crm-write"
import type { AccountOption, UserOption } from "@/lib/types"
import {
  CONTACT_INDUSTRY_OPTIONS,
  CONTACT_TYPE_OPTIONS,
  type NewContactInput,
} from "@/lib/contacts/create"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { availableColumns, fetchAllRows, loadFilterOptionGroups } from "@/lib/table-views/query"
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
import { CONTACTS_SPEC } from "@/lib/contacts/spec"
import {
  applyContactQuickFilters,
  CONTACT_QUICK_FILTER_KEYS,
  type ContactQuickFilters,
} from "@/lib/contacts/filters"
import type { ContactRecord } from "@/lib/contacts/record"
import type { AdminContactRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(CONTACTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(CONTACTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(CONTACTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(CONTACTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(CONTACTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * The eleven dropdown choice lists.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_contacts_filter_options, where the distinct-ing is done in Postgres.
 *
 * The four flag kinds and `state` come back as TEXT ("true"/"false", "0"/"1")
 * because the options view is one UNION and every branch must share a type.
 * lib/contacts/filters.ts converts them back before querying.
 */
export async function loadContactFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(
    getSupabaseServer(),
    CONTACTS_SPEC,
    "contact_count",
  )

  // One entry per declared filter key, so a kind the view has no rows for still
  // renders as an empty dropdown rather than disappearing from the toolbar.
  return ok(
    Object.fromEntries(
      CONTACT_QUICK_FILTER_KEYS.map((k) => [k, groups[k] ?? []]),
    ) as QuickFilterOptions,
  )
}

/* ------------------------------------------------------------------- export */

/**
 * Every row of the current view, UNCAPPED — for the Excel export only.
 *
 * The page stops at ROW_CAP; the export must not, or capping the page would
 * silently start truncating spreadsheets. `config` arrives from the client, so
 * it goes through `parseConfig`, which admits only known column keys and a
 * closed operator set. The quick filters are re-applied here too, so the export
 * matches the ACTIVE VIEW exactly — dropdowns included.
 */
export async function loadContactRowsForExport(input: {
  config: unknown
  quick?: ContactQuickFilters
}): Promise<ActionResult<AdminContactRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(CONTACTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const available = await availableColumns(sb, CONTACTS_SPEC)
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminContactRow>(
    sb,
    CONTACTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyContactQuickFilters(q, quick)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE contact's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list — which is what lets this
 * query, and ONLY this query, select `_raw`.
 *
 * ── WHY `_raw` IS HERE AND NOT ON THE LIST ─────────────────────────────────
 * The mirror deliberately leaves a set of contact fields unflattened: the
 * activity-pointer lookups (last appointment / email / phone / task activity),
 * primary opportunity, segment id, the country lookup and parent_contactid (see
 * sql/23_contacts_table.sql). `_raw` is where they live, so the drawer carries
 * the COMPLETE record and promoting one of them to a rendered field later needs
 * no second fetch.
 *
 * Nothing renders it today — the drawer's four sections are all flattened
 * columns. It is one row, behind the same super_user gate as everything else on
 * this page, which is the only reason shipping the whole payload is acceptable:
 * on the LIST it would be thousands of rows of unfiltered personal data crossing
 * the wire for nothing, which is why `selectListFor` never asks for it.
 */
const RECORD_COLUMNS = [
  "contact_id",
  "full_name",
  "first_name",
  "last_name",
  "job_title",
  "parent_customer_id",
  "parent_customer_name",
  "parent_customer_type",
  "company_master_record_id",
  "company_master_record_name",
  "client_account_id",
  "client_account_name",
  "client_ticker",
  "contact_type_label",
  "industry_label",
  "internal_assignment_label",
  "lead_state_label",
  "state_for_address_label",
  "previous_company",
  "ticker_symbol",
  // Contact info + provenance, flattened 2026-09-16.
  "email",
  "mobile_phone",
  "direct_phone",
  "city",
  "street",
  "owner_id",
  "owner_name",
  "created_by_id",
  "created_by_name",
  "modified_by_id",
  "modified_by_name",
  "ir_only",
  "poc",
  "do_not_call",
  "distribution_list",
  "ex_employee",
  "last_activity_subject",
  "last_activity_type_label",
  "last_activity_time",
  "verified_on",
  "is_active",
  "state_code",
  "state_label",
  "status_code",
  "status_label",
  "created_on",
  "modified_on",
].join(", ")

export async function loadContactRecord(
  contactId: string,
): Promise<ActionResult<ContactRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!contactId) return fail("No contact id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(CONTACTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("contact_id", contactId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Contact not found.")

  // `_raw` is not on v_admin_contacts_all (the list view must never expose it),
  // so it is read separately, straight off the mirror table, and only for this
  // one row. A failure here is NOT fatal: every rendered field came from the
  // query above, so the drawer opens fine without it.
  // is_test rides along (drawer TEST badge), read off the table like _raw.
  const { data: rawRow } = await sb
    .from("contacts")
    .select("_raw, is_test, origin")
    .eq("contact_id", contactId)
    .maybeSingle()

  return ok({
    ...(data as unknown as Omit<ContactRecord, "_raw">),
    _raw: (rawRow?._raw as Record<string, unknown> | undefined) ?? null,
    is_test: rawRow?.is_test === true,
    origin: (rawRow?.origin as string | undefined) ?? null,
  })
}

/* ----------------------------------------------------------- contact writes */
// Gate, client lookup, ownership stamp, guarded edit and purge are the shared
// ones in lib/crm-write.ts — the same plumbing every live CRM entity uses.

/** Clients for the form's picker: every account, by name. */
export async function loadContactClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

/** People for the Owner picker. */
export async function loadContactUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

/**
 * Validate the form and build the FLATTENED columns — shared by create and
 * edit, so an edit can never write anything a create would not. Never returns
 * the pk, origin, is_test, _raw or provenance columns.
 */
async function buildContactColumns(
  input: NewContactInput,
  defaultOwnerId: string | null,
): Promise<ActionResult<Record<string, unknown>>> {
  const firstName = cleanText(input.firstName)
  const lastName = cleanText(input.lastName)
  if (!firstName && !lastName) return fail("Enter a first or last name.")

  const email = cleanText(input.email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("That email address doesn't look valid.")

  const typeCode = cleanText(input.contactTypeCode)
  const type = typeCode ? CONTACT_TYPE_OPTIONS.find((o) => o.code === typeCode) : null
  if (typeCode && !type) return fail("Unknown contact type.")

  const clientRes = await resolveAccount(input.clientAccountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data

  // Industry: a known option, or an existing unlabelled Dynamics code kept as-is.
  const industryText = cleanText(input.industryCode)
  const industryCode = industryText === null ? null : Number(industryText)
  if (industryCode !== null && !Number.isInteger(industryCode)) return fail("Unknown industry.")
  const industry = CONTACT_INDUSTRY_OPTIONS.find((o) => o.code === industryText) ?? null

  const verifiedOn = cleanText(input.verifiedOn)
  if (verifiedOn && !isIsoDate(verifiedOn)) return fail("Verified On isn't a valid date.")

  const ownerRes = await resolveUser(input.ownerId ?? defaultOwnerId)
  if (!ownerRes.ok) return fail(ownerRes.error)
  const owner = ownerRes.data
  const active = input.active !== false

  return ok({
    first_name: firstName,
    last_name: lastName,
    full_name: [firstName, lastName].filter(Boolean).join(" "),
    job_title: cleanText(input.jobTitle),
    parent_customer_id: client?.account_id ?? null,
    parent_customer_name: client?.name ?? null,
    parent_customer_type: client ? "account" : null,
    contact_type_code: type?.code ?? null,
    contact_type_label: type?.label ?? null,
    email,
    mobile_phone: cleanText(input.mobilePhone),
    direct_phone: cleanText(input.directPhone),
    city: cleanText(input.city),
    street: cleanText(input.street),
    industry_code: industryCode,
    industry_label: industry?.label ?? null,
    ir_only: input.irOnly === true,
    poc: input.poc === true,
    do_not_call: input.doNotCall === true,
    distribution_list: input.distributionList === true,
    ex_employee: input.exEmployee === true,
    verified_on: verifiedOn,
    previous_company: cleanText(input.previousCompany),
    ticker_symbol: cleanText(input.tickerSymbol),
    owner_id: owner?.user_id ?? null,
    owner_name: owner?.display_name ?? null,
    // Active / Inactive — the Dynamics statecode + statuscode pair.
    state_code: active ? 0 : 1,
    state_label: active ? "Active" : "Inactive",
    status_code: active ? 1 : 2,
    status_label: active ? "Active" : "Inactive",
  })
}

/**
 * "Add New Contact" — insert ONE dashboard-authored contact.
 *
 * Satisfies every constraint on public.contacts (checked live 2026-09-23):
 *   contact_id  NOT NULL, no default → a fresh randomUUID(), never a Dynamics id
 *   _raw        NOT NULL, no default → {} (there is no Dynamics payload)
 *   origin      NOT NULL + CHECK     → 'dashboard'
 *   is_test     NOT NULL             → from the form's toggle
 *   _synced_at  NOT NULL DEFAULT now() → left to the default
 * There are NO foreign keys on contacts, so the client link is validated here.
 * State is set Active (0 / 1), matching a new Dynamics contact.
 */
export async function createContact(
  input: NewContactInput,
): Promise<ActionResult<{ contactId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting contacts")
  if (!gate.ok) return fail(gate.error)

  const built = await buildContactColumns(input, gate.userId)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    contact_id: randomUUID(),
    ...DASHBOARD_ROW_BASE,
    is_test: input.isTest === true,
    ...built.data,
    created_on: now,
    modified_on: now,
    created_by_id: gate.userId,
    created_by_name: gate.name,
    modified_by_id: gate.userId,
    modified_by_name: gate.name,
  }

  const { error } = await getSupabaseServer().from("contacts").insert(row)
  if (error) return fail(describeError(error))

  // AUDIT — after the write succeeded; actor is resolved from the real session.
  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "contacts",
    recordId: row.contact_id,
    changes: snapshot,
    context: "/contacts · Add New Contact",
  })

  revalidatePath("/contacts")
  return ok({ contactId: row.contact_id })
}

/** A DASHBOARD contact, as form input — Dynamics rows are refused. */
export async function loadContactForEdit(id: string): Promise<ActionResult<NewContactInput>> {
  const res = await loadDashboardRowForEdit(
    "contacts",
    "contact_id",
    id,
    "first_name, last_name, job_title, parent_customer_id, parent_customer_type, email, mobile_phone, direct_phone, city, contact_type_code, street, industry_code, state_code, ir_only, poc, do_not_call, distribution_list, ex_employee, verified_on, previous_company, ticker_symbol, owner_id",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  return ok({
    firstName: asText(r.first_name),
    lastName: asText(r.last_name),
    jobTitle: asText(r.job_title),
    clientAccountId: r.parent_customer_type === "account" ? (r.parent_customer_id as string | null) : null,
    email: asText(r.email),
    mobilePhone: asText(r.mobile_phone),
    directPhone: asText(r.direct_phone),
    city: asText(r.city),
    contactTypeCode: asText(r.contact_type_code),
    street: asText(r.street),
    industryCode: asText(r.industry_code),
    active: r.state_code !== 1,
    irOnly: r.ir_only === true,
    poc: r.poc === true,
    doNotCall: r.do_not_call === true,
    distributionList: r.distribution_list === true,
    exEmployee: r.ex_employee === true,
    verifiedOn: asText(r.verified_on).slice(0, 10),
    previousCompany: asText(r.previous_company),
    tickerSymbol: asText(r.ticker_symbol),
    ownerId: (r.owner_id as string | null) ?? null,
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD contact. The origin guard lives in updateDashboardRow. */
export async function updateContact(
  id: string,
  input: NewContactInput,
): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing contacts")
  if (!gate.ok) return fail(gate.error)
  const built = await buildContactColumns(input, gate.userId)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: "contacts",
    pk: "contact_id",
    id,
    patch: built.data,
    path: "/contacts",
    context: "/contacts · Edit contact",
    verb: "editing contacts",
  })
}

/** How many test contacts the purge would remove — for the confirm prompt. */
export async function countTestContacts(): Promise<ActionResult<number>> {
  return countTestRows("contacts", "contact_id")
}

/** Delete every dashboard-created TEST contact (see purgeTestRows). */
export async function purgeTestContacts(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: "contacts",
    pk: "contact_id",
    snapshot: "full_name, email, parent_customer_name, created_on, created_by_name",
    path: "/contacts",
    context: "/contacts · Delete test contacts",
  })
}
