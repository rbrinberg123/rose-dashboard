"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Check } from "lucide-react"

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
import { CARD_CLASS, DAYS_LEFT_PILL } from "@/lib/design"
import { cn } from "@/lib/utils"
import type { ClientOnboardingRow } from "@/lib/types"

const NAVY = "#1E2858"
const ALL = "__all__"

// Days at which a client counts as "stalled" — flagged with a red pill.
const STALLED_DAYS = 60

// The nine onboarding steps, in grid order. `key` is the view's boolean column;
// `short` is the compact column label; `full` is the tooltip / full name.
const STEPS = [
  { key: "f_onboarding_call", short: "Onb. Call", full: "Onboarding Call" },
  { key: "f_teach_in_date", short: "Teach-in", full: "Teach-in Date" },
  { key: "f_calendar", short: "Calendar", full: "Calendar" },
  { key: "f_calendar_confirmed", short: "Cal. Conf.", full: "Calendar Confirmed" },
  { key: "f_meeting_history_received", short: "Mtg Hist.", full: "Meeting History Received" },
  { key: "f_distro", short: "Distro", full: "Distro" },
  { key: "f_bda_peers", short: "BDA Peers", full: "BDA Peers" },
  { key: "f_recurring_call_scheduled", short: "Rec. Call", full: "Recurring Call Scheduled" },
  { key: "f_report", short: "Report", full: "Report" },
] as const

type StepKey = (typeof STEPS)[number]["key"]
type SortKey = "name" | "days_onboarding" | "filled_count" | StepKey
type SortDir = "asc" | "desc"

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
  const arc = complete ? "#2D7A2D" : NAVY
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
function CheckCell({ done, label }: { done: boolean; label: string }) {
  return done ? (
    <span className="inline-flex" title={`${label}: complete`} aria-label={`${label}: complete`}>
      <Check className="size-4" style={{ color: "#2D7A2D" }} strokeWidth={3} />
    </span>
  ) : (
    <span className="text-muted-foreground" title={`${label}: missing`} aria-label={`${label}: missing`}>
      —
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
      <div className="mb-4">
        <ListTitleCard
          title="Onboarding"
          subtitle={`${rows.length.toLocaleString()} clients still onboarding · ${stalledCount.toLocaleString()} stalled (${STALLED_DAYS}+ days)`}
        />
      </div>

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
          swatch={<Check className="size-4" style={{ color: "#2D7A2D" }} strokeWidth={3} />}
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
              <TableHead colSpan={4} className={GROUP_BAND_CLASS} style={GROUP_BAND_STYLE}>
                Client
              </TableHead>
              <TableHead colSpan={STEPS.length} className={GROUP_BAND_CLASS} style={GROUP_BAND_SEP_STYLE}>
                Onboarding Steps
              </TableHead>
            </TableRow>

            {/* Second tier: sortable column labels. */}
            <TableRow style={{ backgroundColor: SUBHEADER_BG }}>
              <TableHead className="h-8 px-2.5">
                <SortHeader label="Client" sortKey="name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} />
              </TableHead>
              <TableHead className="h-8 px-2.5 text-xs font-medium text-muted-foreground">Team</TableHead>
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
            </TableRow>
          </TableHeader>

          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4 + STEPS.length} className="h-32 text-center text-sm text-muted-foreground">
                  {rows.length === 0
                    ? "No clients are currently onboarding."
                    : "No clients match the current filters."}
                </TableCell>
              </TableRow>
            ) : (
              sorted.map((r) => (
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
                      <CheckCell done={r[step.key]} label={step.full} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
