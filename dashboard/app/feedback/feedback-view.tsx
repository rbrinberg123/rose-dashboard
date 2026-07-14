"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import {
  ChevronDown,
  ChevronRight,
  Flame,
  MapPin,
  Users,
  Video,
} from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import { StatCard } from "@/components/stat-card"
import { CARD_CLASS } from "@/lib/design"
import type { FeedbackOutstandingRow } from "@/lib/types"

// Brand + status palette. One source of truth for the coral (no feedback),
// amber (awaiting additional), and red (30+ days stale) accents used across the
// summary strip, group headers, status pills, and the Days column.
const NAVY_DEEP = "#1E2858"

// DOM id + ring applied to the client card a deep-link (?client=<id>) targets, so
// it can be scrolled into view and visually picked out on arrival.
const DEEPLINK_ANCHOR = "feedback-client-deeplink"

const CORAL = { text: "#993C1D", border: "#D85A30", pillBg: "#FAECE7" }
const AMBER = { text: "#854F0B", border: "#EF9F27", pillBg: "#FAEEDA" }
const RED = { text: "#A32D2D", flameBg: "#FCEBEB" }

// "Awaiting Additional" is the one incomplete-but-started feedback state the
// view surfaces; everything else coming out of v_feedback_outstanding is the
// blank / no-feedback bucket (feedback_status_label IS NULL).
const AWAITING = "Awaiting Additional"

// Shared column geometry for every group's meeting table. Applied via a
// <colgroup> with table-layout: fixed so all tables render identical column
// widths regardless of cell content — column boundaries stay perfectly vertical
// down the whole page, in every view. The two middle columns swap labels per
// view (Client/Institution, Host/Institution, Host/Client) but keep these
// widths; they flex to fill the remaining space and truncate long values. The
// Investor column (meetings.investor_text) always follows the two middle
// dimensions, and likewise flexes + truncates.
const TABLE_COLS = [
  "110px", // Date
  "25%", // middle dimension 1
  "25%", // middle dimension 2
  "25%", // Investor
  "70px", // Flags
  "112px", // Status
  "64px", // Days
]

function TableCols() {
  return (
    <colgroup>
      {TABLE_COLS.map((w, i) => (
        <col key={i} style={{ width: w }} />
      ))}
    </colgroup>
  )
}

type ViewKey = "person" | "client" | "institution"
type SortKey = "open" | "az"

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: "person", label: "By person" },
  { key: "client", label: "By client" },
  { key: "institution", label: "By institution" },
]

const SORTS: { key: SortKey; label: string }[] = [
  { key: "az", label: "A–Z" },
  { key: "open", label: "Most open" },
]

// A meeting is "blank" when it has no feedback status at all; "awaiting" when
// it is the partial 'Awaiting Additional' state.
function isAwaiting(r: FeedbackOutstandingRow): boolean {
  return r.feedback_status_label === AWAITING
}

type Group = {
  key: string
  name: string
  items: FeedbackOutstandingRow[]
  blank: number
  awaiting: number
  flame: number // days_since >= 30
}

const NO_CLIENT = "No client"
const NO_INSTITUTION = "No institution"

function groupName(view: ViewKey, r: FeedbackOutstandingRow): string {
  if (view === "person") return r.host_name || "Unknown host"
  if (view === "client") return r.client_account_name || NO_CLIENT
  return r.institution_name || NO_INSTITUTION
}

// Build the group list for a view: one card per distinct group name, each with
// its meetings (stalest first) and the per-bucket tallies the header shows.
// The chosen sort applies in every view: "open" = total outstanding desc (name
// tiebreaker), "az" = alphabetical by group name.
function buildGroups(view: ViewKey, sort: SortKey, rows: FeedbackOutstandingRow[]): Group[] {
  const map = new Map<string, Group>()
  for (const r of rows) {
    const name = groupName(view, r)
    let g = map.get(name)
    if (!g) {
      g = { key: name, name, items: [], blank: 0, awaiting: 0, flame: 0 }
      map.set(name, g)
    }
    g.items.push(r)
    if (isAwaiting(r)) g.awaiting++
    else g.blank++
    if (r.days_since >= 30) g.flame++
  }

  const groups = Array.from(map.values())
  for (const g of groups) {
    g.items.sort((a, b) => b.days_since - a.days_since)
  }

  if (sort === "open") {
    groups.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name))
  } else {
    groups.sort((a, b) => a.name.localeCompare(b.name))
  }
  return groups
}

export function FeedbackView({ rows }: { rows: FeedbackOutstandingRow[] }) {
  // Deep-link support: /feedback?client=<account_id> lands on that client in the
  // By-client view with its card expanded and scrolled into view — used by the
  // Client Marketing Status page's Feedback Collection pill. The link carries the
  // account_id; groups are keyed by name, so resolve the name from the rows.
  const searchParams = useSearchParams()
  const deepLinkClientId = searchParams.get("client")
  const deepLinkClientName = deepLinkClientId
    ? rows.find((r) => r.client_account_id === deepLinkClientId)?.client_account_name ?? null
    : null

  const [view, setView] = React.useState<ViewKey>(deepLinkClientName ? "client" : "person")
  const [sort, setSort] = React.useState<SortKey>("open")
  // Expanded groups, keyed by `${view}::${name}` so toggles don't bleed across
  // views. Default is empty (all collapsed) — unless a deep-link pre-expands the
  // targeted client's card.
  const [expanded, setExpanded] = React.useState<Set<string>>(() =>
    deepLinkClientName ? new Set([`client::${deepLinkClientName}`]) : new Set(),
  )

  // On a deep-link, scroll the targeted (pre-expanded) client card into view once.
  React.useEffect(() => {
    if (!deepLinkClientName) return
    document.getElementById(DEEPLINK_ANCHOR)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    })
    // Mount-only: the deep-link is read from the initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Firm-wide summary (static, regardless of active view) --------------
  const summary = React.useMemo(() => {
    let blank = 0
    let awaiting = 0
    let stale30 = 0
    let oldest = 0
    const people = new Set<string>()
    const clients = new Set<string>()
    const institutions = new Set<string>()
    for (const r of rows) {
      if (isAwaiting(r)) awaiting++
      else blank++
      if (r.days_since >= 30) stale30++
      if (r.days_since > oldest) oldest = r.days_since
      people.add(r.host_id)
      if (r.client_account_id) clients.add(r.client_account_id)
      if (r.institution_name) institutions.add(r.institution_name)
    }
    return {
      total: rows.length,
      blank,
      awaiting,
      stale30,
      oldest,
      people: people.size,
      clients: clients.size,
      institutions: institutions.size,
    }
  }, [rows])

  const groups = React.useMemo(() => buildGroups(view, sort, rows), [view, sort, rows])

  const noun =
    view === "person"
      ? groups.length === 1
        ? "person"
        : "people"
      : view === "client"
        ? groups.length === 1
          ? "client"
          : "clients"
        : groups.length === 1
          ? "institution"
          : "institutions"
  const sortNote = `${groups.length} ${noun} · ${sort === "open" ? "most open first" : "A–Z"}`

  const keyOf = (name: string) => `${view}::${name}`

  function toggle(name: string) {
    const k = keyOf(name)
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }

  function expandAll() {
    setExpanded(new Set(groups.map((g) => keyOf(g.name))))
  }

  function collapseAll() {
    setExpanded(new Set())
  }

  return (
    <>
      {/* Floating list-title card (firm-wide list page) */}
      <div className="mb-4">
        <ListTitleCard
          title="Feedback"
          subtitle="Concluded meetings still missing complete feedback — blank or awaiting additional."
        />
      </div>

      {/* Summary strip — firm-wide, static across views. */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard floating label="Need feedback" value={summary.total} />
        <StatCard
          floating
          label="No feedback"
          value={summary.blank}
          valueColor={CORAL.text}
        />
        <StatCard
          floating
          label="Awaiting add'l"
          value={summary.awaiting}
          valueColor={AMBER.text}
        />
        <StatCard
          floating
          label={
            <span className="inline-flex items-center gap-1">
              <Flame className="size-3" style={{ color: RED.text }} />
              30+ days
            </span>
          }
          value={summary.stale30}
          valueColor={RED.text}
        />
        <StatCard
          floating
          label="Oldest"
          value={
            <>
              {summary.oldest}
              <span className="text-base font-normal">d</span>
            </>
          }
        />
      </div>

      {/* Distinct-counts line */}
      <p className="mb-5 text-xs text-muted-foreground">
        Across {summary.people} {summary.people === 1 ? "person" : "people"} ·{" "}
        {summary.clients} {summary.clients === 1 ? "client" : "clients"} ·{" "}
        {summary.institutions} {summary.institutions === 1 ? "institution" : "institutions"}
      </p>

      {/* View toggle + sort toggle + expand/collapse + active-sort note */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex h-9 items-center rounded-md border border-border bg-card p-0.5">
          {VIEWS.map((opt) => {
            const active = view === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setView(opt.key)}
                className={
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                  (active ? "bg-[#1E2858] text-white" : "text-foreground hover:bg-slate-50")
                }
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <div className="flex h-9 items-center rounded-md border border-border bg-card p-0.5">
          {SORTS.map((opt) => {
            const active = sort === opt.key
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setSort(opt.key)}
                className={
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors " +
                  (active ? "bg-[#1E2858] text-white" : "text-foreground hover:bg-slate-50")
                }
              >
                {opt.label}
              </button>
            )
          })}
        </div>

        <div className="flex h-9 items-center gap-1">
          <button
            type="button"
            onClick={expandAll}
            className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-slate-50"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="h-9 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-slate-50"
          >
            Collapse all
          </button>
        </div>

        <span className="text-xs text-muted-foreground">{sortNote}</span>
      </div>

      <Legend />

      {/* Group cards */}
      {groups.length === 0 ? (
        <div className={`px-4 py-10 text-center text-sm text-muted-foreground ${CARD_CLASS}`}>
          No outstanding feedback. Every concluded confirmed meeting has complete feedback.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <GroupCard
              key={g.key}
              group={g}
              view={view}
              expanded={expanded.has(keyOf(g.name))}
              onToggle={() => toggle(g.name)}
              anchorId={
                view === "client" && g.name === deepLinkClientName
                  ? DEEPLINK_ANCHOR
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// One group card: a clickable header (chevron, name, right-aligned tallies) and,
// when expanded, a table of that group's meetings.
// ---------------------------------------------------------------------------
function GroupCard({
  group,
  view,
  expanded,
  onToggle,
  anchorId,
}: {
  group: Group
  view: ViewKey
  expanded: boolean
  onToggle: () => void
  /** Set on the deep-link target card: adds the scroll anchor id + a highlight ring. */
  anchorId?: string
}) {
  return (
    <div
      id={anchorId}
      className={`overflow-hidden ${CARD_CLASS}${anchorId ? " ring-2 ring-[#1E2858]/25" : ""}`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-slate-50"
      >
        {expanded ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm font-medium" style={{ color: NAVY_DEEP }}>
          {group.name}
        </span>

        {group.flame > 0 && (
          <span
            className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: RED.flameBg, color: RED.text }}
            title={`${group.flame} meeting${group.flame === 1 ? "" : "s"} 30+ days old`}
          >
            <Flame className="size-3" />
            {group.flame}
          </span>
        )}
        {group.blank > 0 && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: CORAL.pillBg, color: CORAL.text }}
          >
            {group.blank} blank
          </span>
        )}
        {group.awaiting > 0 && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[11px] font-medium"
            style={{ backgroundColor: AMBER.pillBg, color: AMBER.text }}
          >
            {group.awaiting} awaiting
          </span>
        )}
        <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">
          {group.items.length}
        </span>
      </button>

      {expanded && (
        <div className="overflow-x-auto border-t">
          <table className="w-full table-fixed text-sm">
            <TableCols />
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                {view !== "person" && (
                  <th className="px-3 py-2 text-left font-medium">Host</th>
                )}
                {view !== "client" && (
                  <th className="px-3 py-2 text-left font-medium">Client</th>
                )}
                {view !== "institution" && (
                  <th className="px-3 py-2 text-left font-medium">Institution</th>
                )}
                <th className="px-3 py-2 text-left font-medium">Investor</th>
                <th className="px-3 py-2 text-center font-medium">Flags</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((r) => (
                <tr key={r.meeting_id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                    {fmtDate(r.meeting_date)}
                  </td>
                  {view !== "person" && (
                    <td className="truncate px-3 py-2.5" title={r.host_name || undefined}>
                      {r.host_name || "—"}
                    </td>
                  )}
                  {view !== "client" && (
                    <td
                      className="truncate px-3 py-2.5"
                      title={r.client_account_name || undefined}
                    >
                      {r.client_account_name || "—"}
                    </td>
                  )}
                  {view !== "institution" && (
                    <td
                      className="truncate px-3 py-2.5"
                      title={r.institution_name || undefined}
                    >
                      {r.institution_name || "—"}
                    </td>
                  )}
                  <td className="truncate px-3 py-2.5" title={r.investor_text || undefined}>
                    {r.investor_text || ""}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <FlagsCell row={r} />
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill row={r} />
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <DaysCell days={r.days_since} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Meeting format + group flags, each with a hover tooltip (native title attr).
function FlagsCell({ row }: { row: FeedbackOutstandingRow }) {
  return (
    <span className="flex items-center justify-center gap-2 text-muted-foreground">
      {row.is_in_person ? (
        <span title="In-person" aria-label="In-person" className="inline-flex">
          <MapPin className="size-4" />
        </span>
      ) : (
        <span title="Virtual" aria-label="Virtual" className="inline-flex">
          <Video className="size-4" />
        </span>
      )}
      {row.group_meeting && (
        <span title="Group meeting" aria-label="Group meeting" className="inline-flex">
          <Users className="size-4" />
        </span>
      )}
    </span>
  )
}

function StatusPill({ row }: { row: FeedbackOutstandingRow }) {
  if (isAwaiting(row)) {
    return (
      <span
        className="rounded-full px-1.5 py-0.5 text-[11px] font-medium"
        style={{ backgroundColor: AMBER.pillBg, color: AMBER.text }}
      >
        Awaiting
      </span>
    )
  }
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: CORAL.pillBg, color: CORAL.text }}
    >
      No feedback
    </span>
  )
}

// Days since the meeting: muted under 10, coral 10–29, bold red with a flame
// at 30+.
function DaysCell({ days }: { days: number }) {
  if (days >= 30) {
    return (
      <span
        className="inline-flex items-center justify-end gap-1 font-semibold tabular-nums"
        style={{ color: RED.text }}
      >
        <Flame className="size-3" />
        {days}
      </span>
    )
  }
  if (days >= 10) {
    return (
      <span className="tabular-nums" style={{ color: CORAL.text }}>
        {days}
      </span>
    )
  }
  return <span className="tabular-nums text-muted-foreground">{days}</span>
}

function Legend() {
  return (
    <div className={`mb-3 p-3 ${CARD_CLASS}`}>
      <div className="flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full"
            style={{ backgroundColor: CORAL.pillBg, border: `1px solid ${CORAL.border}` }}
          />
          No feedback
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-full"
            style={{ backgroundColor: AMBER.pillBg, border: `1px solid ${AMBER.border}` }}
          />
          Awaiting
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="size-4" />
          Group
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <MapPin className="size-4" />
          In-person
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Video className="size-4" />
          Virtual
        </span>
        <span className="flex items-center gap-1.5" style={{ color: RED.text }}>
          <Flame className="size-4" />
          30+ days
        </span>
      </div>
    </div>
  )
}

// Eastern-local meeting date as "Mon D, YYYY". days_since is computed in
// America/New_York (see v_feedback_outstanding), so we format the date in the
// same zone — independent of the browser's locale — so Date and Days agree.
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
})
function fmtDate(iso: string): string {
  return DATE_FMT.format(new Date(iso))
}
