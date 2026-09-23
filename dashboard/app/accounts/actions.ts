"use server"

/**
 * Clients' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes and the filter-dropdown options.
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks that the EFFECTIVE role is super_user before it
 * builds a query. `v_admin_accounts_all` is unscoped and read with the
 * service-role key (RLS bypassed), so a successful call hands back every client
 * Rose has — active and inactive, with the full account team and every
 * engagement date on the record.
 *
 * The page gate and the proxy gate are not enough on their own: a server action
 * is its own entry point and can be invoked directly.
 *
 * The saved-view writes delegate to lib/table-views/saved-views.ts, which is
 * where the who-may-do-what rules live — shared with the other six CRM tables
 * so there is one implementation, not seven. Read that file's header before
 * changing them.
 *
 * READ-ONLY. Nothing here creates or updates an account; Dynamics is the system
 * of record and the "Add New Client" button is an inert placeholder (see
 * components/crm-add-new.tsx). In particular nothing here touches
 * public.account_status or public.account_team_members — the two dashboard-owned
 * accounts-overlay tables — in either direction.
 */

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { recordAudit } from "@/lib/audit"
import {
  DASHBOARD_ROW_BASE,
  asText,
  cleanText,
  countTestRows,
  easternLocalToIso,
  isIsoDate,
  isoToEasternDate,
  isUuid,
  loadClientEventOptions as loadClientEventOptionsShared,
  loadDashboardRowForEdit,
  loadUserOptions,
  purgeTestRows,
  requireCrmWriter,
  resolveClientEvent,
  resolveUser,
  updateDashboardRow,
} from "@/lib/crm-write"
import {
  CLIENT_DATES,
  CLIENT_FLAGS,
  CLIENT_PROFILE_FLAGS,
  type ClientChoice,
  type ClientChoiceOptions,
  type ClientLookup,
  type NewClientInput,
} from "@/lib/accounts/create"
import type { UserOption } from "@/lib/types"
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
import { ACCOUNTS_SPEC } from "@/lib/accounts/spec"
import {
  applyAccountQuickFilters,
  ACCOUNT_QUICK_FILTER_KEYS,
  type AccountQuickFilters,
} from "@/lib/accounts/filters"
import type { AccountRecord } from "@/lib/accounts/record"
import type { AdminAccountRow } from "@/lib/types"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(ACCOUNTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(ACCOUNTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(ACCOUNTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(ACCOUNTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(ACCOUNTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/**
 * The eleven dropdown choice lists.
 *
 * Fetched by the CLIENT after the table renders, never by the page loader —
 * nothing on screen needs a dropdown's contents in order to paint a table. Reads
 * v_admin_accounts_filter_options, where the distinct-ing is done in Postgres.
 *
 * `state` comes back as TEXT ("0"/"1") because the options view is one UNION and
 * every branch must share a type; lib/accounts/filters.ts converts it back to an
 * integer before querying. The five team kinds come back as display NAMES rather
 * than user ids — deliberately, so the duplicate systemuser records two people
 * carry are unioned without an alias-expansion step. See the filters header.
 */
export async function loadAccountFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(
    getSupabaseServer(),
    ACCOUNTS_SPEC,
    "account_count",
  )

  // One entry per declared filter key, so a kind the view has no rows for still
  // renders as an empty dropdown rather than disappearing from the toolbar.
  return ok(
    Object.fromEntries(
      ACCOUNT_QUICK_FILTER_KEYS.map((k) => [k, groups[k] ?? []]),
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
 *
 * With ~228 accounts the cap does not bite today. The path exists anyway, for
 * the same reason it does on the other six: the day it starts to matter should
 * not also be the day someone discovers their export was short.
 */
export async function loadAccountRowsForExport(input: {
  config: unknown
  quick?: AccountQuickFilters
}): Promise<ActionResult<AdminAccountRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(ACCOUNTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const available = await availableColumns(sb, ACCOUNTS_SPEC)
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminAccountRow>(
    sb,
    ACCOUNTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyAccountQuickFilters(q, quick)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

/**
 * Load ONE client's full record for the drawer.
 *
 * Fetched on demand rather than shipped with the list — which is what lets this
 * query, and ONLY this query, reach `_raw`.
 *
 * ── WHY `_raw` IS HERE AND NOT ON THE LIST ─────────────────────────────────
 * The mirror still leaves ~40 accounts fields unflattened — the staff-initials
 * cluster, the address1_* block, and others — pending a dedicated accounts
 * flatten pass. `_raw` is where they live, so the drawer carries the COMPLETE
 * record and promoting one of them to a rendered field later needs no second
 * fetch.
 *
 * Nothing renders it today — every field in the drawer's six sections is a
 * flattened column. It is one row, behind the same super_user gate as everything
 * else on this page, which is the only reason shipping the whole payload is
 * acceptable: on the LIST it would be the entire CRM's account payload crossing
 * the wire for nothing, which is why `selectListFor` never asks for it.
 */
const RECORD_COLUMNS = [
  "account_id",
  "client_account_id",
  "client_account_name",
  "client_ticker",
  // identity
  "name",
  "ticker_symbol",
  "ipreo_ticker",
  "website_url",
  "email",
  "company_master_id",
  "company_master_name",
  // classification / size / geography
  "client_status_label",
  "client_status_code",
  "sector_label",
  "industry_option_label",
  "fs_sector",
  "fs_industry",
  "exchange_label",
  "market_cap_b",
  "market_cap_label",
  "hq_country_name",
  "region_label",
  "city",
  "state_province",
  "country",
  // account team
  "sales_lead_primary_id",
  "sales_lead_primary_name",
  "secondary_manager_id",
  "secondary_manager_name",
  "associate_id",
  "associate_name",
  "feedback_report_id",
  "feedback_report_name",
  "logistics_coordinator_id",
  "logistics_coordinator_name",
  "targeting_id",
  "targeting_name",
  "teaser_id",
  "teaser_name",
  "primary_contact_id",
  "primary_contact_name",
  "owner_id",
  "owner_name",
  // engagement
  "current_event_id",
  "current_event_name",
  "current_project_id",
  "current_project_name",
  "last_touchpoint_date",
  "next_touchpoint_date",
  "last_event_date",
  "next_event_date",
  "ongoing_event_date",
  "last_targeting_date",
  "last_teaser_date",
  "days_since_last_review",
  "original_start_date",
  "onboarding_call",
  "last_data_upload",
  "teach_in",
  "teach_in_date",
  "shareholder_report_received_date",
  // flags
  "do_not_call",
  "ir_only",
  "bda_peers",
  "calendar",
  "calendar_confirmed",
  "distro",
  "meeting_history_received",
  "mgmt_review",
  "recurring_call_scheduled",
  "report",
  "rep_short_interest",
  "sh_report",
  // free text
  "dietary_restrictions",
  "onboarding_notes",
  "peers",
  // flattened 2026-09-23g
  "street",
  "postal_code",
  "phone",
  "secondary_exchange_label",
  "hq_state_label",
  "reporting_frequency_label",
  "timezone_code",
  "meeting_slot_minutes",
  "meeting_platform_pref",
  "div_yield",
  "targeting_parameters",
  "additional_notes",
  "estimates",
  "include_admin",
  "exclude_from_distribution",
  "contact_ir_only",
  // status / system
  "is_active",
  "state_code",
  "state_label",
  "status_code",
  "status_label",
  "created_by_id",
  "created_by_name",
  "modified_by_id",
  "modified_by_name",
  "created_on",
  "modified_on",
].join(", ")

export async function loadAccountRecord(
  accountId: string,
): Promise<ActionResult<AccountRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  if (!accountId) return fail("No client id.")

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(ACCOUNTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq("account_id", accountId)
    .maybeSingle()

  if (error) return fail(describeError(error))
  if (!data) return fail("Client not found.")

  // `_raw` is not on v_admin_accounts_all (the list view must never expose it),
  // so it is read separately, straight off the mirror table, and only for this
  // one row. A failure here is NOT fatal: every rendered field came from the
  // query above, so the drawer opens fine without it.
  const { data: rawRow } = await sb
    .from("accounts")
    .select("_raw, is_test, origin")
    .eq("account_id", accountId)
    .maybeSingle()

  return ok({
    ...(data as unknown as Omit<AccountRecord, "_raw">),
    _raw: (rawRow?._raw as Record<string, unknown> | undefined) ?? null,
    is_test: rawRow?.is_test === true,
    origin: (rawRow?.origin as string | undefined) ?? null,
  })
}

/* ------------------------------------------------------------ client writes */
// "Add New Client" + edit — the same shared plumbing as the other six live CRM
// entities (lib/crm-write.ts): write gate, re-reads, ownership stamp, guarded
// edit (origin='dashboard' only), audited purge. The ACCOUNT TEAM is NOT set
// here (deferred source-of-truth decision) and Dynamics rollups stay read-only.

export async function loadClientUserOptions(): Promise<ActionResult<UserOption[]>> {
  return loadUserOptions()
}

export async function loadClientEventOptions(accountId: string) {
  return loadClientEventOptionsShared(accountId)
}

/** Contacts whose parent is this client — for the Primary Contact picker. */
export async function loadClientContactOptions(
  accountId: string,
): Promise<ActionResult<{ contact_id: string; full_name: string | null }[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  if (!isUuid(accountId)) return ok([])
  const { data, error } = await getSupabaseServer()
    .from("contacts")
    .select("contact_id, full_name")
    .eq("parent_customer_id", accountId)
    .eq("parent_customer_type", "account")
    .order("full_name", { ascending: true })
    .limit(500)
  if (error) return fail(describeError(error))
  return ok((data ?? []) as { contact_id: string; full_name: string | null }[])
}

/** Distinct code/label (and id/name) pairs for the client form's dropdowns. */
async function clientChoiceOptions(): Promise<ActionResult<ClientChoiceOptions>> {
  const { data, error } = await getSupabaseServer()
    .from("accounts")
    .select(
      "client_status_code, client_status_label, sector_code, sector_label, industry_option_code, industry_option_label, exchange_code, exchange_label, secondary_exchange_code, secondary_exchange_label, hq_state_code, hq_state_label, reporting_frequency_code, reporting_frequency_label, hq_country_id, hq_country_name, company_master_id, company_master_name",
    )
    .limit(5000)
  if (error) return fail(describeError(error))
  const rows = (data ?? []) as unknown as Record<string, unknown>[]
  const pairs = (code: string, label: string): ClientChoice[] => {
    const m = new Map<number, string>()
    for (const r of rows) if (r[code] != null && r[label]) m.set(Number(r[code]), String(r[label]))
    return [...m].map(([c, l]) => ({ code: c, label: l })).sort((a, b) => a.label.localeCompare(b.label))
  }
  const lookups = (id: string, name: string): ClientLookup[] => {
    const m = new Map<string, string>()
    for (const r of rows) if (r[id] && r[name]) m.set(String(r[id]), String(r[name]))
    return [...m].map(([i, n]) => ({ id: i, name: n })).sort((a, b) => a.name.localeCompare(b.name))
  }
  return ok({
    clientStatus: pairs("client_status_code", "client_status_label"),
    sector: pairs("sector_code", "sector_label"),
    industry: pairs("industry_option_code", "industry_option_label"),
    exchange: pairs("exchange_code", "exchange_label"),
    secondaryExchange: pairs("secondary_exchange_code", "secondary_exchange_label"),
    hqState: pairs("hq_state_code", "hq_state_label"),
    reportingFrequency: pairs("reporting_frequency_code", "reporting_frequency_label"),
    hqCountry: lookups("hq_country_id", "hq_country_name"),
    companyMaster: lookups("company_master_id", "company_master_name"),
  })
}

export async function loadClientChoiceOptions(): Promise<ActionResult<ClientChoiceOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  return clientChoiceOptions()
}

/**
 * Validate + build the FLATTENED client columns — shared by create and edit.
 * Never returns the pk, origin, is_test, _raw, provenance or ANY account-team
 * column. `accountId` is set on edit (for the primary-contact / current-event
 * checks, which must belong to this client).
 */
async function buildClientColumns(
  input: NewClientInput,
  defaultOwnerId: string | null,
  accountId: string | null,
): Promise<ActionResult<Record<string, unknown>>> {
  const name = cleanText(input.name)
  if (!name) return fail("Enter the client name.")

  const email = cleanText(input.email)
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("That email address doesn't look valid.")

  const optsRes = await clientChoiceOptions()
  if (!optsRes.ok) return fail(optsRes.error)
  const o = optsRes.data
  const pick = (list: ClientChoice[], code: number | null | undefined, label: string) => {
    if (code == null) return { ok: true as const, v: null }
    const hit = list.find((x) => x.code === code)
    return hit ? { ok: true as const, v: hit } : { ok: false as const, error: `Unknown ${label}.` }
  }
  const look = (list: ClientLookup[], id: string | null | undefined, label: string) => {
    const v = cleanText(id)
    if (!v) return { ok: true as const, v: null }
    const hit = list.find((x) => x.id === v)
    return hit ? { ok: true as const, v: hit } : { ok: false as const, error: `Unknown ${label}.` }
  }
  const status = pick(o.clientStatus, input.clientStatusCode, "client status")
  const sector = pick(o.sector, input.sectorCode, "sector")
  const industry = pick(o.industry, input.industryCode, "industry")
  const exchange = pick(o.exchange, input.exchangeCode, "exchange")
  const secEx = pick(o.secondaryExchange, input.secondaryExchangeCode, "secondary exchange")
  const hqState = pick(o.hqState, input.hqStateCode, "HQ state")
  const freq = pick(o.reportingFrequency, input.reportingFrequencyCode, "reporting frequency")
  const hqCountry = look(o.hqCountry, input.hqCountryId, "HQ country")
  const master = look(o.companyMaster, input.companyMasterId, "master company record")
  for (const r of [status, sector, industry, exchange, secEx, hqState, freq, hqCountry, master]) {
    if (!r.ok) return fail(r.error)
  }

  const num = (v: string | undefined, label: string, int = false) => {
    const t = cleanText(v)
    if (t === null) return { ok: true as const, v: null }
    const n = Number(t)
    if (!Number.isFinite(n) || (int && !Number.isInteger(n))) return { ok: false as const, error: `${label} must be a number.` }
    return { ok: true as const, v: n }
  }
  const mcap = num(input.marketCapB, "Market cap")
  const yieldPct = num(input.divYield, "Dividend yield")
  const slot = num(input.meetingSlotMinutes, "Meeting slot", true)
  const tz = num(input.timezoneCode, "Time zone code", true)
  for (const r of [mcap, yieldPct, slot, tz]) if (!r.ok) return fail(r.error)

  const dates: Record<string, string | null> = {}
  for (const [k, label] of CLIENT_DATES) {
    const v = cleanText(input.dates?.[k])
    if (v && !isIsoDate(v)) return fail(`${label} isn't a valid date.`)
    dates[k] = v ? easternLocalToIso(`${v}T00:00`) : null
  }
  const flags: Record<string, boolean> = {}
  for (const [k] of [...CLIENT_FLAGS, ...CLIENT_PROFILE_FLAGS]) flags[k] = input.flags?.[k] === true

  const ownerRes = await resolveUser(input.ownerId ?? defaultOwnerId)
  if (!ownerRes.ok) return fail(ownerRes.error)

  // Primary contact / current event must belong to THIS client (edit only —
  // a brand-new client has neither yet).
  let contact: { id: string; name: string | null } | null = null
  const contactId = cleanText(input.primaryContactId)
  if (contactId) {
    if (!accountId) return fail("Save the client first, then pick its primary contact.")
    if (!isUuid(contactId)) return fail("Unknown contact.")
    const { data } = await getSupabaseServer()
      .from("contacts")
      .select("contact_id, full_name, parent_customer_id")
      .eq("contact_id", contactId)
      .maybeSingle()
    const c = data as { contact_id: string; full_name: string | null; parent_customer_id: string | null } | null
    if (!c || c.parent_customer_id !== accountId) return fail("That contact isn't at this client.")
    contact = { id: c.contact_id, name: c.full_name }
  }
  let event: { event_id: string; name: string | null } | null = null
  if (cleanText(input.currentEventId)) {
    if (!accountId) return fail("Save the client first, then pick its current event.")
    const evRes = await resolveClientEvent(input.currentEventId, accountId)
    if (!evRes.ok) return fail(evRes.error)
    event = evRes.data
  }

  const active = input.active !== false
  const v = <T,>(r: { ok: true; v: T } | { ok: false; error: string }) => (r.ok ? r.v : null)
  return ok({
    name,
    ticker_symbol: cleanText(input.tickerSymbol),
    // DRIVES VISIBILITY — Portfolio etc. filter on state_label = 'Active'.
    state_code: active ? 0 : 1,
    state_label: active ? "Active" : "Inactive",
    status_code: active ? 1 : 2,
    status_label: active ? "Active" : "Inactive",
    client_status_code: v(status)?.code ?? null,
    client_status_label: v(status)?.label ?? null,
    sector_code: v(sector)?.code ?? null,
    sector_label: v(sector)?.label ?? null,
    industry_option_code: v(industry)?.code ?? null,
    industry_option_label: v(industry)?.label ?? null,
    exchange_code: v(exchange)?.code ?? null,
    exchange_label: v(exchange)?.label ?? null,
    hq_country_id: v(hqCountry)?.id ?? null,
    hq_country_name: v(hqCountry)?.name ?? null,
    market_cap_b: v(mcap),
    website_url: cleanText(input.websiteUrl),
    email,
    ipreo_ticker: cleanText(input.ipreoTicker),
    company_master_id: v(master)?.id ?? null,
    company_master_name: v(master)?.name ?? null,
    // PRIMARY address block (address1_*).
    address1_line1: cleanText(input.street),
    address1_city: cleanText(input.city),
    address1_state: cleanText(input.stateProvince),
    address1_postal_code: cleanText(input.postalCode),
    address1_country: cleanText(input.country),
    phone: cleanText(input.phone),
    primary_contact_id: contact?.id ?? null,
    primary_contact_name: contact?.name ?? null,
    current_event_id: event?.event_id ?? null,
    current_event_name: event?.name ?? null,
    ...dates,
    ...flags,
    secondary_exchange_code: v(secEx)?.code ?? null,
    secondary_exchange_label: v(secEx)?.label ?? null,
    hq_state_code: v(hqState)?.code ?? null,
    hq_state_label: v(hqState)?.label ?? null,
    reporting_frequency_code: v(freq)?.code ?? null,
    reporting_frequency_label: v(freq)?.label ?? null,
    div_yield: v(yieldPct),
    meeting_slot_minutes: v(slot),
    meeting_platform_pref: cleanText(input.meetingPlatformPref),
    timezone_code: v(tz),
    onboarding_notes: cleanText(input.onboardingNotes),
    peers: cleanText(input.peers),
    dietary_restrictions: cleanText(input.dietaryRestrictions),
    additional_notes: cleanText(input.additionalNotes),
    targeting_parameters: cleanText(input.targetingParameters),
    owner_id: ownerRes.data?.user_id ?? null,
    owner_name: ownerRes.data?.display_name ?? null,
  })
}

/**
 * "Add New Client" — insert ONE dashboard-authored account (top-level, no
 * parent). Constraints (checked live 2026-09-23): account_id and name are the
 * only required columns without a default; no foreign keys are enforced.
 * NOT FILTERED ANYWHERE; containment is by using test clients.
 */
export async function createClient(input: NewClientInput): Promise<ActionResult<{ accountId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating or deleting clients")
  if (!gate.ok) return fail(gate.error)

  const built = await buildClientColumns(input, gate.userId, null)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    account_id: randomUUID(),
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

  const { error } = await getSupabaseServer().from("accounts").insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: "accounts",
    recordId: row.account_id,
    changes: snapshot,
    context: "/accounts · Add New Client",
  })

  revalidatePath("/accounts")
  return ok({ accountId: row.account_id })
}

/** A DASHBOARD client, as form input — Dynamics rows are refused. */
export async function loadClientForEdit(id: string): Promise<ActionResult<NewClientInput>> {
  const res = await loadDashboardRowForEdit(
    "accounts",
    "account_id",
    id,
    [
      "name, ticker_symbol, state_code, client_status_code, sector_code, industry_option_code, exchange_code",
      "hq_country_id, market_cap_b, website_url, email, ipreo_ticker, company_master_id",
      "address1_line1, address1_city, address1_state, address1_postal_code, address1_country, phone",
      "primary_contact_id, current_event_id",
      CLIENT_DATES.map(([k]) => k).join(", "),
      [...CLIENT_FLAGS, ...CLIENT_PROFILE_FLAGS].map(([k]) => k).join(", "),
      "secondary_exchange_code, hq_state_code, reporting_frequency_code, div_yield, meeting_slot_minutes",
      "meeting_platform_pref, timezone_code, onboarding_notes, peers, dietary_restrictions",
      "additional_notes, targeting_parameters, owner_id",
    ].join(", "),
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  const n = (x: unknown) => (x == null ? null : Number(x))
  return ok({
    name: asText(r.name),
    tickerSymbol: asText(r.ticker_symbol),
    active: r.state_code !== 1,
    clientStatusCode: n(r.client_status_code),
    sectorCode: n(r.sector_code),
    industryCode: n(r.industry_option_code),
    exchangeCode: n(r.exchange_code),
    hqCountryId: (r.hq_country_id as string | null) ?? null,
    marketCapB: asText(r.market_cap_b),
    websiteUrl: asText(r.website_url),
    email: asText(r.email),
    ipreoTicker: asText(r.ipreo_ticker),
    companyMasterId: (r.company_master_id as string | null) ?? null,
    street: asText(r.address1_line1),
    city: asText(r.address1_city),
    stateProvince: asText(r.address1_state),
    postalCode: asText(r.address1_postal_code),
    country: asText(r.address1_country),
    phone: asText(r.phone),
    primaryContactId: (r.primary_contact_id as string | null) ?? null,
    currentEventId: (r.current_event_id as string | null) ?? null,
    dates: Object.fromEntries(CLIENT_DATES.map(([k]) => [k, isoToEasternDate(r[k])])),
    flags: Object.fromEntries([...CLIENT_FLAGS, ...CLIENT_PROFILE_FLAGS].map(([k]) => [k, r[k] === true])),
    secondaryExchangeCode: n(r.secondary_exchange_code),
    hqStateCode: n(r.hq_state_code),
    reportingFrequencyCode: n(r.reporting_frequency_code),
    divYield: asText(r.div_yield),
    meetingSlotMinutes: asText(r.meeting_slot_minutes),
    meetingPlatformPref: asText(r.meeting_platform_pref),
    timezoneCode: asText(r.timezone_code),
    onboardingNotes: asText(r.onboarding_notes),
    peers: asText(r.peers),
    dietaryRestrictions: asText(r.dietary_restrictions),
    additionalNotes: asText(r.additional_notes),
    targetingParameters: asText(r.targeting_parameters),
    ownerId: (r.owner_id as string | null) ?? null,
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD client. The origin guard lives in updateDashboardRow. */
export async function updateClient(id: string, input: NewClientInput): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing clients")
  if (!gate.ok) return fail(gate.error)
  const built = await buildClientColumns(input, gate.userId, id)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: "accounts",
    pk: "account_id",
    id,
    patch: built.data,
    path: "/accounts",
    context: "/accounts · Edit client",
    verb: "editing clients",
  })
}

export async function countTestClients(): Promise<ActionResult<number>> {
  return countTestRows("accounts", "account_id")
}

export async function purgeTestClients(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: "accounts",
    pk: "account_id",
    snapshot: "name, ticker_symbol, state_label, created_on, created_by_name",
    path: "/accounts",
    context: "/accounts · Delete test clients",
  })
}
