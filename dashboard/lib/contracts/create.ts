/**
 * Shared definitions for "Add New Contract" — the SINGLE SOURCE OF TRUTH for
 * the contract dropdowns. Used by the form (app/admin/contracts/new-contract-dialog.tsx)
 * and the server actions (app/admin/contracts/actions.ts); kept out of the "use server"
 * file, which may export only async functions.
 *
 * ── THE DB MIRRORS THESE LISTS ─────────────────────────────────────────────
 * sql/patches/2026-09-29_contracts_crm.sql Part C has a CHECK constraint per
 * list with the SAME values. Change a list here → change its CHECK there and
 * re-run Part C, or saves will be refused by the database.
 *
 * See content/docs/24-contracts.md and 22-cutover-ownership-boundary.md.
 */

/** Whether the form's "Test record" toggle starts ON. TEST PHASE: true. */
export const NEW_CONTRACT_TEST_DEFAULT = true

/** Contract status. PLACEHOLDER — the client will refine. */
export const CONTRACT_STATUS = ["Draft", "Active", "Renewed", "Expired", "Terminated"] as const

/** Retainer currency. */
export const CONTRACT_CURRENCY = ["USD", "GBP", "EUR"] as const

/** Scope of work. PLACEHOLDER — the client will replace with the real scope list. */
export const CONTRACT_SCOPE = [
  "Corporate Access",
  "Investor Perception",
  "Advisory Retainer",
  "Project",
  "Other",
] as const

export type NewContractInput = {
  contractName: string
  /** accounts.account_id — REQUIRED (a contract belongs to one client). */
  accountId: string | null
  scope: string
  contractStatus: string
  /** YYYY-MM-DD */
  startDate: string
  /** Whole months, as typed. */
  termLengthMonths: string
  /** Whole days, as typed. */
  terminationNoticeDays: string
  autoRenew: boolean
  /** YYYY-MM-DD — defaults to term end in the form, editable. */
  renewalDate: string
  /** Money, as typed (e.g. "25000" or "25,000.00"). */
  quarterlyRetainer: string
  currency: string
  referralSource: string
  notes: string
  /** YYYY-MM-DD — the date the contract ACTUALLY ended. */
  terminationDate: string
  terminationReason: string
  isTest: boolean
}

/**
 * Browser-side PREVIEW of the two DB-generated columns, so the form can show
 * them live. The database computes the stored values (Part B of the patch);
 * this mirrors its arithmetic: date + N months (clamped to the month's last
 * day, as Postgres does — Jan 31 + 1 month = Feb 28/29), then minus notice days.
 * Returns YYYY-MM-DD or null.
 */
export function previewTermEnd(startDate: string, months: number | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate)
  if (!m || months == null || !Number.isInteger(months)) return null
  const y = +m[1]
  const mo = +m[2] - 1 + months
  const ty = y + Math.floor(mo / 12)
  const tm = ((mo % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  const d = new Date(Date.UTC(ty, tm, Math.min(+m[3], lastDay)))
  return d.toISOString().slice(0, 10)
}

export function previewNoticeDate(
  startDate: string,
  months: number | null,
  noticeDays: number | null,
): string | null {
  const end = previewTermEnd(startDate, months)
  if (!end || noticeDays == null || !Number.isInteger(noticeDays)) return null
  const d = new Date(`${end}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - noticeDays)
  return d.toISOString().slice(0, 10)
}

/** A typed whole number ("24") → 24; blank → null; anything else → NaN. */
export function parseWhole(v: string | null | undefined): number | null {
  const s = (v ?? "").trim()
  if (s === "") return null
  return /^\d+$/.test(s) ? Number(s) : NaN
}
