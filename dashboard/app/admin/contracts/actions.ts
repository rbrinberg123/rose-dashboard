"use server"

/**
 * Contracts' server actions: the record drawer's on-demand fetch, the uncapped
 * export, the saved-view writes, the filter-dropdown options — and the contract
 * writes (create / edit / delete / purge test rows).
 *
 * ══ SECURITY ═══════════════════════════════════════════════════════════════
 * Every function here re-checks the EFFECTIVE role server-side before it builds
 * a query. `v_admin_contracts_all` is unscoped and read with the service-role
 * key (RLS bypassed), and a server action is its own entry point, so the page
 * and proxy gates are not enough on their own. Hidden buttons are never the
 * gate.
 *
 * WRITES go through lib/crm-write.ts like every live CRM entity:
 *   - create  requireCrmWriter (super_user, not in "View as"); origin is
 *             ALWAYS 'dashboard' (DASHBOARD_ROW_BASE) — the browser cannot set it.
 *   - edit    updateDashboardRow: re-read + UPDATE … WHERE pk AND
 *             origin='dashboard', must hit exactly 1 row, else refused.
 *   - delete  DELETE … WHERE pk AND origin='dashboard', must hit exactly 1 row.
 * Every write is audited (recordAudit). See content/docs/24-contracts.md.
 */

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { recordAudit } from "@/lib/audit"
import {
  DASHBOARD_ROW_BASE,
  asText,
  cleanText,
  countTestRows,
  isIsoDate,
  isUuid,
  loadAccountOptions,
  loadDashboardRowForEdit,
  purgeTestRows,
  requireCrmWriter,
  resolveAccount,
  updateDashboardRow,
} from "@/lib/crm-write"
import {
  CONTRACT_CURRENCY,
  CONTRACT_SCOPE,
  CONTRACT_STATUS,
  parseWhole,
  type NewContractInput,
} from "@/lib/contracts/create"
import type { AccountOption } from "@/lib/types"
import { getEffectiveRole } from "@/lib/effective-identity"
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
import { CONTRACTS_SPEC } from "@/lib/contracts/spec"
import { applyContractQuickFilters, type ContractQuickFilters } from "@/lib/contracts/filters"
import type { ContractRecord } from "@/lib/contracts/record"
import type { AdminContractRow } from "@/lib/types"

const TABLE = "contracts"
const PK = "contract_id"
const PATH = "/admin/contracts"

/* ---------------------------------------------------------------- saved views */

export async function listSavedViews(): Promise<ActionResult<SavedView[]>> {
  return sharedList(CONTRACTS_SPEC)
}

export async function createSavedView(input: {
  name: string
  scope: SavedViewScope
  config: unknown
}): Promise<ActionResult<{ id: string }>> {
  return sharedCreate(CONTRACTS_SPEC, input)
}

export async function updateSavedView(input: {
  id: string
  name?: string
  config?: unknown
}): Promise<ActionResult> {
  return sharedUpdate(CONTRACTS_SPEC, input)
}

export async function setDefaultSavedView(input: {
  id: string | null
  scope: SavedViewScope
}): Promise<ActionResult> {
  return sharedSetDefault(CONTRACTS_SPEC, input)
}

export async function deleteSavedView(input: { id: string }): Promise<ActionResult> {
  return sharedDelete(CONTRACTS_SPEC, input)
}

/* ------------------------------------------------------------ filter options */

/** Client / Scope / Status / Currency / Auto-Renew choices, fetched after render. */
export async function loadContractFilterOptions(): Promise<ActionResult<QuickFilterOptions>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const groups = await loadFilterOptionGroups(getSupabaseServer(), CONTRACTS_SPEC, "contract_count")
  return ok({
    client: groups.client ?? [],
    scope: groups.scope ?? [],
    status: groups.status ?? [],
    currency: groups.currency ?? [],
    autoRenew: groups.autoRenew ?? [],
  })
}

/* ------------------------------------------------------------------- export */

/** Every row of the current view, UNCAPPED — for the Excel export only. */
export async function loadContractRowsForExport(input: {
  config: unknown
  quick?: ContractQuickFilters
}): Promise<ActionResult<AdminContractRow[]>> {
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")

  const parsed = parseConfig(CONTRACTS_SPEC, input.config)
  if (!parsed.ok) return fail(parsed.error)

  const sb = getSupabaseServer()
  const available = await availableColumns(sb, CONTRACTS_SPEC)
  const quick = input.quick ?? {}

  const { rows, error } = await fetchAllRows<AdminContractRow>(
    sb,
    CONTRACTS_SPEC,
    parsed.config,
    new Date(),
    available,
    ((q: unknown) => applyContractQuickFilters(q, quick)) as <Q>(q: Q) => Q,
  )
  if (error) return fail(error)
  return ok(rows)
}

/* ------------------------------------------------------------ record drawer */

const RECORD_COLUMNS = [
  "contract_id",
  "origin",
  "is_test",
  "contract_name",
  "contract_status",
  "scope",
  "referral_source",
  "notes",
  "account_id",
  "client_name",
  "client_ticker",
  "start_date",
  "term_length_months",
  "term_end",
  "termination_notice_days",
  "notice_date",
  "auto_renew",
  "renewal_date",
  "quarterly_retainer",
  "currency",
  "termination_date",
  "termination_reason",
  "created_by",
  "modified_by_name",
  "created_at",
  "updated_at",
].join(", ")

/** Load ONE contract's full record for the drawer. */
export async function loadContractRecord(id: string): Promise<ActionResult<ContractRecord>> {
  // ---- GATE (must stay first) ----
  const role = await getEffectiveRole()
  if (role !== "super_user") return fail("Not authorised.")
  if (!id) return fail("No contract id.")

  const { data, error } = await getSupabaseServer()
    .from(CONTRACTS_SPEC.viewName)
    .select(RECORD_COLUMNS)
    .eq(PK, id)
    .maybeSingle()
  if (error) return fail(describeError(error))
  if (!data) return fail("Contract not found.")
  return ok(data as unknown as ContractRecord)
}

/* ---------------------------------------------------------- contract writes */

/** Clients for the form's picker: every account, by name. */
export async function loadContractClientOptions(): Promise<ActionResult<AccountOption[]>> {
  return loadAccountOptions()
}

/** A value from one of the fixed lists, or blank. Anything else is refused. */
function pick(
  value: string | null | undefined,
  allowed: readonly string[],
  label: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = cleanText(value)
  if (v === null) return { ok: true, value: null }
  if (!allowed.includes(v)) return { ok: false, error: `Pick a ${label} from the list.` }
  return { ok: true, value: v }
}

/** A calendar date or blank. */
function dateOrNull(value: string | null | undefined, label: string): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = cleanText(value)
  if (v === null) return { ok: true, value: null }
  if (!isIsoDate(v)) return { ok: false, error: `${label} isn't a valid date.` }
  return { ok: true, value: v }
}

/**
 * Validate + build the contract columns — shared by create and edit. Writes
 * ONLY the dashboard-authored columns (2026-09-29 patch Part A), never the
 * DB-generated term_end / notice_date and never the Dynamics-mirror columns.
 */
async function buildContractColumns(input: NewContractInput): Promise<ActionResult<Record<string, unknown>>> {
  const contractName = cleanText(input.contractName)
  if (!contractName) return fail("Enter a contract name.")

  if (!cleanText(input.accountId)) return fail("Pick a client.")
  const clientRes = await resolveAccount(input.accountId)
  if (!clientRes.ok) return fail(clientRes.error)
  const client = clientRes.data!

  const scope = pick(input.scope, CONTRACT_SCOPE, "scope")
  if (!scope.ok) return fail(scope.error)
  const status = pick(input.contractStatus, CONTRACT_STATUS, "contract status")
  if (!status.ok) return fail(status.error)
  const currency = pick(input.currency, CONTRACT_CURRENCY, "currency")
  if (!currency.ok) return fail(currency.error)

  const start = dateOrNull(input.startDate, "Start date")
  if (!start.ok) return fail(start.error)
  const renewal = dateOrNull(input.renewalDate, "Renewal date")
  if (!renewal.ok) return fail(renewal.error)
  const terminated = dateOrNull(input.terminationDate, "Termination date")
  if (!terminated.ok) return fail(terminated.error)

  const months = parseWhole(input.termLengthMonths)
  if (Number.isNaN(months) || (months !== null && (months < 1 || months > 600))) {
    return fail("Term length must be a whole number of months (1–600).")
  }
  const noticeDays = parseWhole(input.terminationNoticeDays)
  if (Number.isNaN(noticeDays) || (noticeDays !== null && noticeDays > 3650)) {
    return fail("Termination notice must be a whole number of days (0–3650).")
  }

  const moneyText = (input.quarterlyRetainer ?? "").replace(/[,\s]/g, "")
  let retainer: number | null = null
  if (moneyText !== "") {
    if (!/^\d{1,12}(\.\d{1,2})?$/.test(moneyText)) {
      return fail("Quarterly retainer must be an amount like 25000 or 25,000.00.")
    }
    retainer = Number(moneyText)
  }
  if (retainer !== null && !currency.value) return fail("Pick a currency for the retainer.")

  return ok({
    contract_name: contractName,
    account_id: client.account_id,
    scope: scope.value,
    contract_status: status.value,
    start_date: start.value,
    term_length_months: months,
    termination_notice_days: noticeDays,
    auto_renew: input.autoRenew === true,
    renewal_date: renewal.value,
    quarterly_retainer: retainer,
    currency: currency.value,
    referral_source: cleanText(input.referralSource),
    notes: cleanText(input.notes),
    termination_date: terminated.value,
    termination_reason: cleanText(input.terminationReason),
  })
}

/**
 * "Add New Contract" — insert ONE dashboard-authored contract.
 *
 * origin is ALWAYS 'dashboard' (never from the browser); is_test is as passed.
 * The Dynamics state_code is left NULL on purpose: the reporting views
 * (v_contract_management, Client Statistics, Onboarding …) select
 * state_code = 0 and read only the Dynamics columns, so a dashboard contract
 * does not reach them until a deliberate cutover step.
 */
export async function createContract(input: NewContractInput): Promise<ActionResult<{ contractId: string }>> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("creating contracts")
  if (!gate.ok) return fail(gate.error)

  const built = await buildContractColumns(input)
  if (!built.ok) return fail(built.error)

  const now = new Date().toISOString()
  const row = {
    [PK]: randomUUID(),
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

  const { error } = await getSupabaseServer().from(TABLE).insert(row)
  if (error) return fail(describeError(error))

  const { _raw, ...snapshot } = row
  void _raw
  await recordAudit({
    action: "create",
    entity: TABLE,
    recordId: String(row[PK]),
    changes: snapshot,
    context: `${PATH} · Add New Contract`,
  })

  revalidatePath(PATH)
  return ok({ contractId: String(row[PK]) })
}

/** A DASHBOARD contract, as form input — Dynamics rows are refused. */
export async function loadContractForEdit(id: string): Promise<ActionResult<NewContractInput>> {
  const res = await loadDashboardRowForEdit(
    TABLE,
    PK,
    id,
    "contract_name, account_id, scope, contract_status, start_date, term_length_months, termination_notice_days, auto_renew, renewal_date, quarterly_retainer, currency, referral_source, notes, termination_date, termination_reason",
  )
  if (!res.ok) return fail(res.error)
  const r = res.data
  return ok({
    contractName: asText(r.contract_name),
    accountId: (r.account_id as string | null) ?? null,
    scope: asText(r.scope),
    contractStatus: asText(r.contract_status),
    startDate: asText(r.start_date).slice(0, 10),
    termLengthMonths: asText(r.term_length_months),
    terminationNoticeDays: asText(r.termination_notice_days),
    autoRenew: r.auto_renew === true,
    renewalDate: asText(r.renewal_date).slice(0, 10),
    quarterlyRetainer: asText(r.quarterly_retainer),
    currency: asText(r.currency),
    referralSource: asText(r.referral_source),
    notes: asText(r.notes),
    terminationDate: asText(r.termination_date).slice(0, 10),
    terminationReason: asText(r.termination_reason),
    isTest: r.is_test === true,
  })
}

/** Edit a DASHBOARD contract. The origin guard lives in updateDashboardRow. */
export async function updateContract(
  id: string,
  input: NewContractInput,
): Promise<ActionResult<{ changed: number }>> {
  const gate = await requireCrmWriter("editing contracts")
  if (!gate.ok) return fail(gate.error)
  const built = await buildContractColumns(input)
  if (!built.ok) return fail(built.error)
  return updateDashboardRow({
    table: TABLE,
    pk: PK,
    id,
    patch: built.data,
    path: PATH,
    context: `${PATH} · Edit contract`,
    verb: "editing contracts",
  })
}

/**
 * Delete ONE dashboard contract. The origin filter is on the DELETE itself, so
 * a Dynamics row can never match; it must remove exactly one row or it is
 * refused. Audited with the row as it was.
 */
export async function deleteContract(id: string): Promise<ActionResult> {
  // ---- GATE (must stay first) ----
  const gate = await requireCrmWriter("deleting contracts")
  if (!gate.ok) return fail(gate.error)
  if (!isUuid(id)) return fail("Unknown record.")

  const { data: deleted, error } = await getSupabaseServer()
    .from(TABLE)
    .delete()
    .eq(PK, id)
    .eq("origin", "dashboard")
    .select(
      "contract_id, contract_name, account_id, contract_status, start_date, term_length_months, quarterly_retainer, currency, is_test",
    )
  if (error) return fail(describeError(error))
  if (!deleted || deleted.length !== 1) {
    return fail("Refused: only contracts created in the dashboard can be deleted.")
  }

  await recordAudit({
    action: "delete",
    entity: TABLE,
    recordId: id,
    changes: { ...(deleted[0] as Record<string, unknown>), origin: "dashboard" },
    context: `${PATH} · Delete contract`,
  })

  revalidatePath(PATH)
  return ok()
}

/** How many test contracts the purge would remove — for the confirm prompt. */
export async function countTestContracts(): Promise<ActionResult<number>> {
  return countTestRows(TABLE, PK)
}

/** Delete every dashboard-created TEST contract (see purgeTestRows). */
export async function purgeTestContracts(): Promise<ActionResult<{ deleted: number }>> {
  return purgeTestRows({
    table: TABLE,
    pk: PK,
    snapshot: "contract_name, account_id, contract_status, start_date, created_on, created_by_name",
    path: PATH,
    context: `${PATH} · Delete test contracts`,
  })
}
