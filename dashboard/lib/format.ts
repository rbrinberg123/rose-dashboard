import { format, formatDistanceToNowStrict, parseISO } from "date-fns"

/**
 * Display formatters used across dashboards. Keep these pure and side-effect
 * free — they're used both in Server Components (initial render) and Client
 * Components (table cells).
 */

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const usdPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
})

const pct1 = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

/** "$1,234,567" — for KPI strips and totals where dollars-only is fine. */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—"
  return usd.format(value)
}

/** "$1,234,567.89" — for line-item amounts. */
export function formatCurrencyPrecise(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—"
  return usdPrecise.format(value)
}

/** Accepts a fraction (0.234 → "23.4%"). NULL when revenue is zero etc. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—"
  return pct1.format(value)
}

/** "Apr 29, 2026" — for table cells and labels. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? parseISO(value) : value
  if (Number.isNaN(d.getTime())) return "—"
  return format(d, "MMM d, yyyy")
}

/** "Apr 29, 2026 · 2:30 PM" — for timestamps where the time matters. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? parseISO(value) : value
  if (Number.isNaN(d.getTime())) return "—"
  return format(d, "MMM d, yyyy · h:mm a")
}

/** "3 days ago", "in 2 weeks" — relative phrasing for last/next dates. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "—"
  const d = typeof value === "string" ? parseISO(value) : value
  if (Number.isNaN(d.getTime())) return "—"
  return formatDistanceToNowStrict(d, { addSuffix: true })
}

/** "Q2 2026" — for period headers in margin/analyst views. */
export function formatQuarter(year: number, quarter: number): string {
  return `Q${quarter} ${year}`
}
