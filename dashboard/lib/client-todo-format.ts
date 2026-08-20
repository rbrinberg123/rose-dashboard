/**
 * Pure display helpers, originally for the Clients → To-Do List.
 *
 * Shared by the on-screen table (app/clients/to-do/todo-table.tsx) and the Excel
 * export (lib/client-todo-excel.ts) so an exported cell can never drift from the
 * cell it mirrors. No React, no I/O.
 *
 * `formatDay` is also used by the Onboarding grid (app/onboarding/
 * onboarding-table.tsx) for the dates under the step checkmarks — it is the
 * app's one "plain YYYY-MM-DD → Mmm d, yyyy with no timezone shifting" helper,
 * which is exactly what a view-computed calendar day needs.
 */

/**
 * Strip a ticker's exchange/country suffix for display ("TNL-US" -> "TNL",
 * "4DX-AU" -> "4DX"); dotted class tickers like "BRK.B" are preserved. Same
 * logic (and the same name) as the Planning V2 view and the email builders.
 */
export function baseTicker(t: string): string {
  return t.trim().split(/[\s:]/)[0].replace(/-[A-Za-z]{1,4}$/, "")
}

/**
 * Event names lead with the client's own ticker — "4DX-AU -  Virtual -
 * September, October (TBC)". The ticker is the row's identity, so that prefix is
 * pure duplication: strip it.
 *
 * Both the full ticker and its base form are tried (an event can be named
 * "4DX - …" while the account carries "4DX-AU"), separator spacing is loose
 * because the CRM names are inconsistent, and anything that does NOT start with
 * this row's ticker is left completely alone.
 */
export function stripTickerPrefix(name: string, ticker: string | null): string {
  if (!ticker) return name
  const base = baseTicker(ticker)
  for (const candidate of [ticker.trim(), base]) {
    if (!candidate) continue
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const stripped = name.replace(new RegExp(`^\\s*${escaped}\\s*-\\s*`, "i"), "")
    if (stripped !== name) return stripped.trim()
  }
  return name
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

/** "Mar 4, 2026" from a plain YYYY-MM-DD day, with no timezone shifting. */
export function formatDay(ymd: string | null): string {
  if (!ymd) return "—"
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d) return "—"
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

/** The event's window: one day, or a span (collapsed when the year matches). */
export function formatDaySpan(startYmd: string | null, endYmd: string | null): string {
  if (!startYmd) return "—"
  if (!endYmd || endYmd === startYmd) return formatDay(startYmd)
  const sameYear = startYmd.slice(0, 4) === endYmd.slice(0, 4)
  const start = sameYear ? formatDay(startYmd).replace(/,\s*\d{4}$/, "") : formatDay(startYmd)
  return `${start} – ${formatDay(endYmd)}`
}

/**
 * A plain YYYY-MM-DD day as a real Date for Excel. Built at UTC midnight because
 * ExcelJS converts a Date via its UTC epoch with no timezone shift, so the day
 * that lands in the cell is exactly the day the view computed (the view already
 * resolved every timestamp to an Eastern calendar day). Parsing the string with
 * `new Date(...)` directly would be at the mercy of the browser's zone.
 */
export function dayToDate(ymd: string | null): Date | null {
  if (!ymd) return null
  const [y, m, d] = ymd.split("-").map(Number)
  if (!y || !m || !d) return null
  return new Date(Date.UTC(y, m - 1, d))
}
