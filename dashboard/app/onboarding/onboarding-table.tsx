"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Search,
  Check,
  Info,
  StickyNote,
} from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { ListTitleCard } from "@/components/page-masthead"
import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import {
  CARD_CLASS,
  DAYS_LEFT_PILL,
  EVENT_STAGE_PILL,
  EVENT_STAGE_PILL_FALLBACK,
  EVENT_STAGE_SHORT,
  TEXT_TERTIARY,
} from "@/lib/design"
import { cn } from "@/lib/utils"
import { formatDay, stripTickerPrefix } from "@/lib/client-todo-format"
import type { ClientOnboardingRow } from "@/lib/types"

const NAVY = "#1E2858"
// The app-wide "complete / positive" green — the same value carried as GREEN or
// DONE_GREEN in Planning, Contract Management, Client Detail and Institutions.
// Named here so the step check, the completion ring and the legend can't drift
// apart, and so it stays recognisably the brand green rather than a local one.
const DONE_GREEN = "#2D7A2D"
const ALL = "__all__"

// Days at which a client counts as "stalled" — flagged with a red pill.
const STALLED_DAYS = 60

type StepKey =
  | "f_onboarding_call"
  | "f_teach_in_date"
  | "f_calendar"
  | "f_calendar_confirmed"
  | "f_meeting_history"
  | "f_distro"
  | "f_bda_peers"
  | "f_recurring_call_scheduled"
  | "f_report"

/** The three steps that carry a date; the grid prints it under the checkmark. */
type StepDateKey = "onboarding_call_date" | "teach_in_date" | "meeting_history_date"

type Step = { key: StepKey; short: string; full: string; dateKey?: StepDateKey }

// The nine onboarding steps, in grid order. `key` is the view's boolean column;
// `short` is the compact column label; `full` is the tooltip / full name.
// `dateKey` is set only on the three date-backed steps — the two Dynamics date
// fields, plus Meeting History, which is derived from the client's latest
// completed Outreach → Data Upload task rather than a flag on the account.
const STEPS: readonly Step[] = [
  {
    key: "f_onboarding_call",
    short: "Onb. Call",
    full: "Onboarding Call",
    dateKey: "onboarding_call_date",
  },
  {
    key: "f_teach_in_date",
    short: "Teach-in",
    full: "Teach-in Date",
    dateKey: "teach_in_date",
  },
  { key: "f_calendar", short: "Calendar", full: "Calendar" },
  { key: "f_calendar_confirmed", short: "Cal. Conf.", full: "Calendar Confirmed" },
  {
    key: "f_meeting_history",
    short: "Mtg Hist.",
    full: "Meeting History — latest completed Data Upload task",
    dateKey: "meeting_history_date",
  },
  { key: "f_distro", short: "Distro", full: "Distro" },
  { key: "f_bda_peers", short: "BDA Peers", full: "BDA Peers" },
  { key: "f_recurring_call_scheduled", short: "Rec. Call", full: "Recurring Call Scheduled" },
  { key: "f_report", short: "Report", full: "Report" },
]

type SortKey =
  | "name"
  | "days_onboarding"
  | "contract_start_date"
  | "first_event_date"
  | "filled_count"
  | StepKey
type SortDir = "asc" | "desc"

/**
 * A plain YYYY-MM-DD day as mm/dd/yy.
 *
 * String-sliced rather than parsed into a Date, for the same reason `formatDay`
 * does it: the view has already resolved the calendar day, and round-tripping
 * through `new Date(...)` would re-interpret it in the browser's zone and can
 * shift it. The view's parts are already zero-padded, so this is mm/dd/yy.
 */
function formatShortDay(ymd: string | null): string {
  if (!ymd) return "—"
  const [y, m, d] = ymd.split("-")
  if (!y || !m || !d) return "—"
  return `${m}/${d}/${y.slice(2)}`
}

// Account-team roles → shared avatar cluster (same mapping + palette as Portfolio,
// so the treatment stays identical across pages).
const ACCOUNT_TEAM_ROLES = [
  { role: "Account mgr", key: "sales_lead_primary_name", bg: "#1E2858", fg: "#FFFFFF" },
  { role: "Secondary", key: "secondary_manager_name", bg: "#3D5599", fg: "#FFFFFF" },
  { role: "Associate", key: "associate_name", bg: "#1C8C9C", fg: "#FFFFFF" },
  { role: "Logistics", key: "logistics_coordinator_name", bg: "#4FC6BC", fg: "#0A3B36" },
] as const

function AccountTeamAvatars({ row }: { row: ClientOnboardingRow }) {
  const members = ACCOUNT_TEAM_ROLES.map((r) => ({
    role: r.role,
    name: row[r.key],
    bg: r.bg,
    fg: r.fg,
  }))
  return <TeamAvatars members={members} />
}

// Two-tier header bands (dark caps), matching the Portfolio / Marketing Status look.
const BAND_BG = "#DDE1E8"
const GROUP_BAND_CLASS =
  "rounded-t-md h-8 px-3 text-center text-[11px] font-semibold uppercase tracking-wider text-[#1A2233]"
const GROUP_BAND_STYLE: React.CSSProperties = { backgroundColor: BAND_BG }
const GROUP_BAND_SEP_STYLE: React.CSSProperties = {
  ...GROUP_BAND_STYLE,
  borderLeft: "3px solid var(--card)",
}
const GROUP_DIVIDER = "#EEF0F4"
const GROUP_START_STYLE: React.CSSProperties = { borderLeft: `1px solid ${GROUP_DIVIDER}` }
const SUBHEADER_BG = "#F7F8FA"

// nulls / blanks last; numbers numerically; booleans as 0/1; strings case-folded.
function compareValues(
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
  dir: SortDir,
): number {
  const na = typeof a === "boolean" ? Number(a) : a
  const nb = typeof b === "boolean" ? Number(b) : b
  const aNull = na == null || na === ""
  const bNull = nb == null || nb === ""
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  if (typeof na === "number" && typeof nb === "number") {
    return dir === "asc" ? na - nb : nb - na
  }
  const av = String(na).toLowerCase()
  const bv = String(nb).toLowerCase()
  if (av < bv) return dir === "asc" ? -1 : 1
  if (av > bv) return dir === "asc" ? 1 : -1
  return 0
}

function SortHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "left",
  title,
}: {
  label: string
  sortKey: SortKey
  currentKey: SortKey
  currentDir: SortDir
  onSort: (k: SortKey) => void
  align?: "left" | "right" | "center"
  title?: string
}) {
  const isActive = currentKey === sortKey
  const Icon = isActive ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title={title}
      className={cn(
        "inline-flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground",
        align === "right" && "justify-end",
        align === "center" && "justify-center",
      )}
    >
      <span>{label}</span>
      <Icon
        className={cn(
          "size-3 shrink-0",
          isActive ? "text-foreground" : "text-muted-foreground/60",
        )}
      />
    </button>
  )
}

// Days-since-onboarding pill. 60+ = stalled (red pill). 0–59 = plain count.
// Negative (future-dated start) or missing = muted dash / "upcoming".
function DaysCell({ days }: { days: number | null }) {
  if (days == null) return <span className="text-muted-foreground">—</span>
  if (days < 0)
    return (
      <span className="text-xs text-muted-foreground" title="Onboarding start date is in the future">
        upcoming
      </span>
    )
  if (days >= STALLED_DAYS) {
    const s = DAYS_LEFT_PILL.red
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums"
        style={{ backgroundColor: s.bg, color: s.fg }}
        title={`Stalled — ${days} days onboarding`}
      >
        {days}d
      </span>
    )
  }
  return <span className="tabular-nums text-foreground">{days}d</span>
}

// Completion ring + "N/M" label. Arc fills navy for completed steps over a light
// track; the count sits to the right.
function CompletionRing({ filled, total }: { filled: number; total: number }) {
  const r = 9
  const c = 2 * Math.PI * r
  const frac = total > 0 ? filled / total : 0
  const complete = filled >= total
  const arc = complete ? DONE_GREEN : NAVY
  return (
    <div className="inline-flex items-center gap-1.5">
      <svg width={24} height={24} viewBox="0 0 24 24" className="shrink-0 -rotate-90">
        <circle cx={12} cy={12} r={r} fill="none" stroke="#E5E7EB" strokeWidth={3} />
        {filled > 0 && (
          <circle
            cx={12}
            cy={12}
            r={r}
            fill="none"
            stroke={arc}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${frac * c} ${c}`}
          />
        )}
      </svg>
      <span className="tabular-nums text-xs font-medium text-foreground">
        {filled}/{total}
      </span>
    </div>
  )
}

// One grid cell: green check when the step is complete, muted dash when missing.
// The three date-backed steps print their date on a small second line beneath.
// A step with no date renders exactly as before — mark only, no date line — so
// the six flag-only steps are untouched.
//
// The check is deliberately heavier than the rest of the grid (20px at stroke
// 3.5 against 9px date text): a run of ticks is the thing you scan this table
// for, so it has to read from a distance. The colour is unchanged — it was
// already the brand green — the prominence comes from size and stroke weight.
function CheckCell({
  done,
  label,
  date,
}: {
  done: boolean
  label: string
  date?: string | null
}) {
  const mark = done ? (
    <span className="inline-flex" title={`${label}: complete`} aria-label={`${label}: complete`}>
      <Check className="size-5" style={{ color: DONE_GREEN }} strokeWidth={3.5} />
    </span>
  ) : (
    <span className="text-muted-foreground" title={`${label}: missing`} aria-label={`${label}: missing`}>
      —
    </span>
  )
  if (!date) return mark
  return (
    <span className="inline-flex flex-col items-center leading-none">
      {mark}
      <span
        className="tabular-nums whitespace-nowrap text-muted-foreground"
        style={{ fontSize: 9, marginTop: 3 }}
        title={`${label}: ${formatDay(date)}`}
      >
        {formatDay(date)}
      </span>
    </span>
  )
}

// First (earliest) marketing event: abbreviated name over date · stage pill.
//
// The name is stripped of its leading "TICKER - " with the shared helper — the
// ticker is already the row's identity two columns to the left, so the prefix is
// pure duplication ("DSFIR-NL - Virtual - 8/17…" → "Virtual - 8/17…"). CRM event
// names then still run long (they carry the full meeting-date list), so the cell
// caps its width and truncates; the untouched original is on hover.
function FirstEventCell({
  name,
  date,
  state,
  ticker,
}: {
  name: string | null
  date: string | null
  state: string | null
  ticker: string | null
}) {
  if (!name && !date) return <span className="text-muted-foreground">—</span>
  const label = name ? stripTickerPrefix(name, ticker).trim() : null
  const stage = state?.trim()
  const pill = (stage && EVENT_STAGE_PILL[stage]) || EVENT_STAGE_PILL_FALLBACK
  return (
    <div className="flex max-w-[150px] flex-col items-start gap-0.5">
      <span
        className="max-w-full truncate text-[11px] leading-tight text-foreground"
        title={name ?? undefined}
      >
        {label || "—"}
      </span>
      <span className="flex items-center gap-1">
        <span className="tabular-nums text-[10px] leading-none text-muted-foreground">
          {formatShortDay(date)}
        </span>
        {stage ? (
          <span
            className="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium leading-[15px]"
            style={{ backgroundColor: pill.bg, color: pill.text }}
            title={stage}
          >
            {EVENT_STAGE_SHORT[stage] ?? stage}
          </span>
        ) : null}
      </span>
    </div>
  )
}

// Onboarding notes (Dynamics bcs_onboardingnotes, via the view's onboarding_notes).
// FILLED navy note = has a note, and hover/focus reveals the full text; HOLLOW
// grey note = none. Same glyph either way at the same size, so the column keeps
// its rhythm and the only thing that varies is weight/colour — which is what
// makes a run of rows scannable at a glance. The reveal panel is the same one
// the To-Do List uses for touchpoint detail.
//
// `flipUp` opens the panel above the icon instead of below. The card is
// `overflow-x-auto`, which forces overflow-y to compute to auto as well, so the
// card clips on BOTH axes — a downward panel on the last row is cut off by the
// card's bottom edge (measured: 62px clipped). Flipping the bottom rows keeps
// the whole note on screen without giving up the CSS-only hover pattern.
function NotesCell({ note, flipUp }: { note: string | null; flipUp?: boolean }) {
  const text = note?.trim()
  if (!text) {
    // NB `inline-flex`, not a bare inline span: Tailwind's preflight makes
    // `svg { display: block }`, and a block box inside an inline box is NOT
    // centred by the cell's text-align — it hugs the left. inline-flex makes
    // this an inline-LEVEL box, so text-align centres it like the filled state.
    return (
      <span
        title="No onboarding notes"
        aria-label="No onboarding notes"
        className="inline-flex text-muted-foreground/30"
      >
        <StickyNote className="size-4" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span className="group relative inline-flex">
      {/* tabIndex makes the note reachable by keyboard; group-focus-within on the
          panel is what actually opens it, matching the To-Do List pattern. */}
      <span
        tabIndex={0}
        aria-label="Onboarding notes"
        className="inline-flex cursor-help text-[#1E2858] outline-none transition-colors hover:text-[#0355A7] focus-visible:text-[#0355A7]"
      >
        {/* SOLID navy note vs the hollow grey one above — fill + stroke share
            currentColor, so the glyph reads as one filled shape and the column
            can be scanned at a glance for who has notes. */}
        <StickyNote className="size-4" fill="currentColor" aria-hidden="true" />
      </span>
      <div
        className={cn(
          "pointer-events-none absolute right-0 z-30 hidden w-[300px] rounded-md border bg-white p-2.5 text-left text-[12px] shadow-md",
          flipUp ? "bottom-full mb-1" : "top-full mt-1",
          "group-hover:block group-focus-within:block",
        )}
        style={{ borderColor: "#E6E9EF" }}
        role="tooltip"
      >
        <div className="mb-1 font-medium" style={{ color: NAVY }}>
          Onboarding notes
        </div>
        {/* pre-line keeps the line breaks the CRM free-text field carries. */}
        <div className="whitespace-pre-line text-muted-foreground">{text}</div>
      </div>
    </span>
  )
}

// A single legend chip.
function LegendItem({ swatch, text }: { swatch: React.ReactNode; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {swatch}
      {text}
    </span>
  )
}

export function OnboardingTable({ rows }: { rows: ClientOnboardingRow[] }) {
  // Default sort: most-stalled first (longest days at top) so problems surface.
  const [sortKey, setSortKey] = React.useState<SortKey>("days_onboarding")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")
  const [search, setSearch] = React.useState("")
  const [salesLead, setSalesLead] = React.useState<string>(ALL)

  const total = rows[0]?.onboarding_field_count ?? STEPS.length

  const salesLeads = React.useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.sales_lead_primary_name) set.add(r.sales_lead_primary_name)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  function handleSort(k: SortKey) {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else {
      setSortKey(k)
      // Days / progress / step columns are most useful high-to-low first;
      // the client name reads better A→Z.
      setSortDir(k === "name" ? "asc" : "desc")
    }
  }

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (salesLead !== ALL && (r.sales_lead_primary_name ?? "") !== salesLead) return false
      if (q) {
        const name = (r.name ?? "").toLowerCase()
        const ticker = (r.ticker_symbol ?? "").toLowerCase()
        if (!name.includes(q) && !ticker.includes(q)) return false
      }
      return true
    })
  }, [rows, search, salesLead])

  const sorted = React.useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const primary = compareValues(a[sortKey] as never, b[sortKey] as never, sortDir)
      // Stable tie-break: always fall back to client name A→Z.
      return primary !== 0 ? primary : compareValues(a.name, b.name, "asc")
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const stalledCount = React.useMemo(
    () => rows.filter((r) => (r.days_onboarding ?? -1) >= STALLED_DAYS).length,
    [rows],
  )

  return (
    <>
      <div className="mb-2">
        <ListTitleCard
          title="Onboarding"
          subtitle={`${rows.length.toLocaleString()} clients still onboarding · ${stalledCount.toLocaleString()} stalled (${STALLED_DAYS}+ days)`}
        />
      </div>

      {/* Why a client vanishes from this page. The exit rule is invisible from
          the grid itself — nothing here counts down to it — so it is stated
          once, quietly, rather than left to be rediscovered. Same muted-italic
          helper treatment as the Client Statistics footnote. */}
      <p
        className="mb-3 flex items-center gap-1.5 text-[11px] italic"
        style={{ color: TEXT_TERTIARY }}
      >
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        <span>
          Clients automatically drop off this list once their first Feedback
          Report has been sent.
        </span>
      </p>

      {/* Filter row */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={salesLead}
          onChange={(e) => setSalesLead(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Account Manager"
        >
          <option value={ALL}>Account Manager (all)</option>
          {salesLeads.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className="relative ml-auto w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client, ticker…"
            className="pl-8"
          />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {filtered.length.toLocaleString()} of {rows.length.toLocaleString()}
        </span>
      </div>

      {/* Legend */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <LegendItem
          swatch={<Check className="size-5" style={{ color: DONE_GREEN }} strokeWidth={3.5} />}
          text="complete"
        />
        <LegendItem swatch={<span className="text-muted-foreground">—</span>} text="missing" />
        <LegendItem
          swatch={
            <span
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: DAYS_LEFT_PILL.red.fg }}
            />
          }
          text={`stalled — ${STALLED_DAYS}+ days onboarding`}
        />
      </div>

      <div
        className={`overflow-x-auto ${CARD_CLASS} [&_thead_tr:first-child_th:first-child]:rounded-tl-[14px] [&_thead_tr:first-child_th:last-child]:rounded-tr-[14px]`}
      >
        <Table>
          <TableHeader className="sticky top-0 z-20 bg-card">
            {/* Top tier: group bands. */}
            <TableRow className="bg-card">
              <TableHead colSpan={6} className={GROUP_BAND_CLASS} style={GROUP_BAND_STYLE}>
                Client
              </TableHead>
              <TableHead colSpan={STEPS.length} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Onboarding Steps
              </TableHead>
              {/* Notes stands outside the steps block — it is a reference field,
                  not a step, and does not count toward the progress ring. */}
              <TableHead colSpan={1} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Notes
              </TableHead>
            </TableRow>

            {/* Second tier: sortable column labels. */}
            <TableRow style={{ backgroundColor: SUBHEADER_BG }}>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Client" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5 text-xs font-medium text-muted-foreground">Team</TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader
                  label="Contract Start"
                  sortKey="contract_start_date"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  align="center"
                  title="Contract term start date (Dynamics Contract Start Date) — not the onboarding start"
                />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader
                  label="First Event"
                  sortKey="first_event_date"
                  currentKey={sortKey}
                  currentDir={sortDir}
                  onSort={handleSort}
                  title="Earliest marketing event — name (ticker stripped), start date and stage"
                />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Days" sortKey="days_onboarding" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="center" title="Days since onboarding started" />
              </TableHead>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Progress" sortKey="filled_count" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="center" title="Onboarding steps complete" />
              </TableHead>
              {STEPS.map((step, i) => (
                <TableHead
                  key={step.key}
                  className="h-8 px-1.5"
                  style={i === 0 ? GROUP_START_STYLE : undefined}
                >
                  <SortHeader
                    label={step.short}
                    sortKey={step.key}
                    currentKey={sortKey}
                    currentDir={sortDir}
                    onSort={handleSort}
                    align="center"
                    title={step.full}
                  />
                </TableHead>
              ))}
              <TableHead
                className="h-8 px-1.5 text-center text-xs font-medium text-muted-foreground"
                style={GROUP_START_STYLE}
                title="Onboarding notes from Dynamics — hover the icon to read"
              >
                Notes
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7 + STEPS.length} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No clients are currently onboarding."
                    : "No clients match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r, rowIdx) => (
                <TableRow key={r.account_id}>
                  {/* Client */}
                  <TableCell className="px-2.5 py-1.5 align-middle">
                    <div className="max-w-[220px] truncate" title={r.name}>
                      <Link
                        href={`/client-detail?account_id=${r.account_id}`}
                        className="font-medium hover:underline"
                        style={{ color: NAVY }}
                      >
                        {r.name}
                      </Link>
                    </div>
                    <div
                      className="text-muted-foreground"
                      style={{ fontFamily: "monospace", fontSize: "10px", marginTop: 2 }}
                    >
                      {r.ticker_symbol ?? "—"}
                    </div>
                  </TableCell>

                  {/* Account Team */}
                  <TableCell className="px-2.5 py-1.5 align-middle">
                    <AccountTeamAvatars row={r} />
                  </TableCell>

                  {/* Contract Start — contract TERM start, mm/dd/yy */}
                  <TableCell className="px-2.5 py-1.5 text-center align-middle">
                    <span className="tabular-nums whitespace-nowrap text-foreground">
                      {formatShortDay(r.contract_start_date)}
                    </span>
                  </TableCell>

                  {/* First Event — earliest event, ticker stripped, + stage pill */}
                  <TableCell className="px-2.5 py-1.5 align-middle">
                    <FirstEventCell
                      name={r.first_event_name}
                      date={r.first_event_date}
                      state={r.first_event_state_label}
                      ticker={r.ticker_symbol}
                    />
                  </TableCell>

                  {/* Days */}
                  <TableCell className="px-2.5 py-1.5 text-center align-middle">
                    <DaysCell days={r.days_onboarding} />
                  </TableCell>

                  {/* Progress ring */}
                  <TableCell className="px-2.5 py-1.5 text-center align-middle">
                    <CompletionRing filled={r.filled_count} total={total} />
                  </TableCell>

                  {/* Onboarding step checks */}
                  {STEPS.map((step, i) => (
                    <TableCell
                      key={step.key}
                      className="px-1.5 py-1.5 text-center align-middle"
                      style={i === 0 ? GROUP_START_STYLE : undefined}
                    >
                      <CheckCell
                        done={r[step.key]}
                        label={step.full}
                        date={step.dateKey ? r[step.dateKey] : null}
                      />
                    </TableCell>
                  ))}

                  {/* Onboarding notes — icon reveals the free text on hover/focus */}
                  <TableCell
                    className="px-1.5 py-1.5 text-center align-middle"
                    style={GROUP_START_STYLE}
                  >
                    {/* Bottom rows open the note upward so the card cannot clip
                        it. Only when there is room above (>4 rows), otherwise a
                        short table would just clip at the top instead. */}
                    <NotesCell
                      note={r.onboarding_notes}
                      flipUp={sorted.length > 4 && rowIdx >= sorted.length - 2}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
