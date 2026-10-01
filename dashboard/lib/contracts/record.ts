/**
 * The contract-record drawer's data shape and its FIELD DEFINITIONS.
 *
 * Same contract as lib/notes/record.ts: every section of the drawer renders from
 * `CONTRACT_SECTIONS` — `{ label, sourceKey, type }` — and the table's column
 * catalog is DERIVED from the same list (lib/contracts/spec.ts), so the two can
 * never drift. FORM FIELD SET = DRAWER FIELD SET: every field the create/edit
 * form writes is a field here (contract_document is reserved and not shown).
 *
 * EDITABLE only for origin='dashboard' rows — via the Add New form in edit mode
 * and updateDashboardRow (lib/crm-write.ts), which refuses any Dynamics row.
 *
 * ── WHAT A CONTRACT IS ─────────────────────────────────────────────────────
 * public.contracts mirrors Dynamics `bcs_contract`: one row per contract term,
 * one client → many contracts (generally sequential renewals). The dashboard
 * writes its OWN columns (sql/patches/2026-09-29_contracts_crm.sql Part A); the
 * view falls back to the Dynamics twin of each field for synced rows.
 *
 * term_end and notice_date are DB-GENERATED (read-only): term_end =
 * start + term months; notice_date = term_end − notice days.
 */

/** One contract, flattened for display. Keys are the view's column names. */
export type ContractRecord = {
  contract_id: string
  /** 'dashboard' = editable in the drawer; 'dynamics' = read-only until cutover. */
  origin?: string | null
  is_test?: boolean | null

  contract_name: string | null
  contract_status: string | null
  scope: string | null
  referral_source: string | null
  notes: string | null

  account_id: string | null
  client_name: string | null
  client_ticker: string | null

  start_date: string | null
  term_length_months: number | null
  term_end: string | null
  termination_notice_days: number | null
  notice_date: string | null
  auto_renew: boolean | null
  renewal_date: string | null

  quarterly_retainer: number | null
  currency: string | null

  termination_date: string | null
  termination_reason: string | null

  created_by: string | null
  modified_by_name: string | null
  created_at: string | null
  updated_at: string | null
}

/**
 * How a field is rendered:
 *   text    plain value
 *   date    a date, Eastern
 *   number  a whole number (months / days)
 *   money   the retainer, formatted with its currency
 *   toggle  Yes/No
 *   notes   long free text, full width
 *   link    the client, linked to Client Detail
 *   person  a person's name
 */
export type ContractFieldType =
  | "text"
  | "date"
  | "number"
  | "money"
  | "toggle"
  | "notes"
  | "link"
  | "person"

export type ContractFieldDef = {
  label: string
  sourceKey: keyof ContractRecord
  type: ContractFieldType
  /** Shown beside the label: the value is computed by the database. */
  calculated?: boolean
}

export type ContractSectionDef = {
  key: string
  title: string
  fields: ContractFieldDef[]
}

export const CONTRACT_SECTIONS: ContractSectionDef[] = [
  {
    key: "contract",
    title: "Contract",
    fields: [
      { label: "Contract Name", sourceKey: "contract_name", type: "text" },
      { label: "Client", sourceKey: "client_name", type: "link" },
      { label: "Scope", sourceKey: "scope", type: "text" },
      { label: "Contract Status", sourceKey: "contract_status", type: "text" },
      { label: "Referral Source", sourceKey: "referral_source", type: "text" },
    ],
  },
  {
    key: "term",
    title: "Term",
    fields: [
      { label: "Start Date", sourceKey: "start_date", type: "date" },
      { label: "Term Length (months)", sourceKey: "term_length_months", type: "number" },
      { label: "Term End", sourceKey: "term_end", type: "date", calculated: true },
      { label: "Termination Notice (days)", sourceKey: "termination_notice_days", type: "number" },
      { label: "Notice Date", sourceKey: "notice_date", type: "date", calculated: true },
      { label: "Auto-Renew", sourceKey: "auto_renew", type: "toggle" },
      { label: "Renewal Date", sourceKey: "renewal_date", type: "date" },
    ],
  },
  {
    key: "money",
    title: "Retainer",
    fields: [
      { label: "Quarterly Retainer", sourceKey: "quarterly_retainer", type: "money" },
      { label: "Currency", sourceKey: "currency", type: "text" },
    ],
  },
  {
    key: "termination",
    title: "Termination (actually ended)",
    fields: [
      { label: "Termination Date", sourceKey: "termination_date", type: "date" },
      { label: "Termination Reason", sourceKey: "termination_reason", type: "text" },
    ],
  },
  {
    key: "notes",
    title: "Notes",
    fields: [{ label: "Notes", sourceKey: "notes", type: "notes" }],
  },
  {
    key: "system",
    title: "System",
    fields: [
      { label: "Source", sourceKey: "origin", type: "text" },
      { label: "Created By", sourceKey: "created_by", type: "person" },
      { label: "Modified By", sourceKey: "modified_by_name", type: "person" },
      { label: "Created", sourceKey: "created_at", type: "date" },
      { label: "Updated", sourceKey: "updated_at", type: "date" },
    ],
  },
]

/** "USD 25,000.00" — the retainer with its currency (currency blank → plain). */
export function formatRetainer(amount: number | string | null | undefined, currency: string | null | undefined): string | null {
  if (amount === null || amount === undefined || amount === "") return null
  const n = Number(amount)
  if (!Number.isFinite(n)) return String(amount)
  const s = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${currency} ${s}` : s
}
