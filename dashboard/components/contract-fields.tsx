import * as React from "react"

// Shared rendering for the four contract fields (Days Left, Auto-Renew, plus the
// muted dash used for Term End / Status when a row is inactive). Used by both the
// Contract Management tab and the Client Portfolio table so the columns stay
// visually identical and the day-badge thresholds live in exactly one place.

const RED = "#C53030"
const AMBER = "#B7791F"
const GREEN = "#2D7A2D"
const GRAY_BG = "#E5E7EB"
const GRAY_FG = "#6B7280"
const RED_BG = "#FED7D7"
const AMBER_BG = "#FEEBC8"
const GREEN_BG = "#C6F6D5"

// The em-dash shown when a contract field has no value to display (inactive row,
// or a null Term End / Status). Matches the Contract tab's `dash`.
export function ContractDash() {
  return <span className="text-muted-foreground">—</span>
}

// Days-to-expiry badge: red < 30, amber 30–89, green ≥ 90. When days is null,
// a gray pill — "Terminated" if the client once had a contract but none is active
// now, otherwise "No contract".
export function DaysLeftPill({
  days,
  hasContract,
  totalContractCount,
}: {
  days: number | null
  hasContract: boolean
  totalContractCount: number
}) {
  if (days === null) {
    const label =
      !hasContract && totalContractCount > 0 ? "Terminated" : "No contract"
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
        style={{ backgroundColor: GRAY_BG, color: GRAY_FG }}
      >
        {label}
      </span>
    )
  }
  let bg = GREEN_BG
  let fg = GREEN
  if (days < 30) {
    bg = RED_BG
    fg = RED
  } else if (days < 90) {
    bg = AMBER_BG
    fg = AMBER
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
      style={{ backgroundColor: bg, color: fg }}
    >
      {days} d
    </span>
  )
}

// Auto-renew flag: green ● when on, red ○ when off, muted em-dash when unknown.
// Sizing is self-contained so the glyph looks the same regardless of the cell.
export function AutoRenewFlag({ value }: { value: boolean | null }) {
  if (value === true) return <span className="text-base" style={{ color: GREEN }}>●</span>
  if (value === false) return <span className="text-base" style={{ color: RED }}>○</span>
  return <span className="text-sm text-muted-foreground">—</span>
}
