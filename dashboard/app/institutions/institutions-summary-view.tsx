"use client"

import * as React from "react"
import Link from "next/link"
import { format, parseISO } from "date-fns"
import type { InstitutionSummaryRow } from "@/lib/types"

// Brand palette
const NAVY_DEEP = "#1E2858"
const RED = "#C53030"
const AMBER = "#B7791F"
const GREEN = "#2D7A2D"
const RED_BG = "#FED7D7"
const AMBER_BG = "#FEEBC8"
const GREEN_BG = "#C6F6D5"
const SOFT_BG = "#F8F9FB"

const PAGE_SIZE = 50
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("")

type FilterKey = "all" | "active" | "cold" | "heavy"
type SortKey =
  | "institution_name"
  | "lifetime_meetings"
  | "ltm_meetings"
  | "unique_clients_lifetime"
  | "unique_people_lifetime"
  | "first_met"
  | "last_met"
type SortDir = "asc" | "desc"

function safeParseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatMonthYearShort(value: string | null | undefined): string {
  const d = safeParseDate(value)
  return d ? format(d, "MMM ''yy") : "—"
}

function compareNullable<T extends number | string | null>(a: T, b: T): number {
  if (a == null && b == null) return 0
  if (a == null) return 1
  if (b == null) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b))
}

export function InstitutionsSummaryView({
  rows,
}: {
  rows: InstitutionSummaryRow[]
}) {
  const total = rows.length

  const [filter, setFilter] = React.useState<FilterKey>("all")
  const [letter, setLetter] = React.useState<string>("All")
  const [search, setSearch] = React.useState<string>("")
  const [sortKey, setSortKey] = React.useState<SortKey>("lifetime_meetings")
  const [sortDir, setSortDir] = React.useState<SortDir>("desc")
  const [currentPage, setCurrentPage] = React.useState<number>(1)

  // Counts for the filter pills
  const counts = React.useMemo(() => {
    let active = 0
    let cold = 0
    let heavy = 0
    for (const r of rows) {
      if (r.is_active) active++
      if (r.is_cold) cold++
      if (r.is_heavy_hitter) heavy++
    }
    return { all: rows.length, active, cold, heavy }
  }, [rows])

  // Letters that have at least one institution starting with them
  const availableLetters = React.useMemo(() => {
    const s = new Set<string>()
    for (const r of rows) {
      const first = r.institution_name?.[0]?.toUpperCase()
      if (first && first >= "A" && first <= "Z") s.add(first)
    }
    return s
  }, [rows])

  // Filter pipeline: filter pill → letter → search
  const filteredRows = React.useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((r) => {
      if (filter === "active" && !r.is_active) return false
      if (filter === "cold" && !r.is_cold) return false
      if (filter === "heavy" && !r.is_heavy_hitter) return false
      if (letter !== "All") {
        const first = r.institution_name?.[0]?.toUpperCase()
        if (first !== letter) return false
      }
      if (term && !r.institution_name.toLowerCase().includes(term)) {
        return false
      }
      return true
    })
  }, [rows, filter, letter, search])

  const sortedRows = React.useMemo(() => {
    const arr = [...filteredRows]
    arr.sort((a, b) => {
      const av = a[sortKey] as number | string | null
      const bv = b[sortKey] as number | string | null
      const cmp = compareNullable(av, bv)
      return sortDir === "asc" ? cmp : -cmp
    })
    return arr
  }, [filteredRows, sortKey, sortDir])

  // Reset to page 1 whenever the filtered set changes shape
  React.useEffect(() => {
    setCurrentPage(1)
  }, [filter, letter, search, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const startIdx = (safePage - 1) * PAGE_SIZE
  const pagedRows = sortedRows.slice(startIdx, startIdx + PAGE_SIZE)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " ↓" : " ↑") : ""

  const pills: { key: FilterKey; label: string }[] = [
    { key: "all", label: `All (${counts.all})` },
    { key: "active", label: `Active LTM (${counts.active})` },
    { key: "cold", label: `Cold (${counts.cold})` },
    { key: "heavy", label: `Heavy Hitters (${counts.heavy})` },
  ]

  return (
    <>
      {/* Section 1: Page header */}
      <div className="mb-4">
        <h1
          className="text-2xl font-medium tracking-tight"
          style={{ color: NAVY_DEEP }}
        >
          Institution Summary
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          All institutions ever met · {total.toLocaleString()} total
        </p>
      </div>

      {/* Section 1.5: Status legend */}
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center rounded-full"
            style={{
              backgroundColor: GREEN_BG,
              color: GREEN,
              padding: "2px 7px",
              fontSize: "10px",
              fontWeight: 500,
            }}
          >
            Active
          </span>
          <span>Met in past 12 months</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center rounded-full"
            style={{
              backgroundColor: RED_BG,
              color: RED,
              padding: "2px 7px",
              fontSize: "10px",
              fontWeight: 500,
            }}
          >
            Cold
          </span>
          <span>No meeting in 2+ years</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center rounded-full"
            style={{
              backgroundColor: AMBER_BG,
              color: AMBER,
              padding: "2px 7px",
              fontSize: "10px",
              fontWeight: 500,
            }}
          >
            Heavy Hitter
          </span>
          <span>10+ lifetime meetings</span>
        </span>
      </div>

      {/* Section 2: Filter pills + search */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {pills.map(({ key, label }) => {
          const active = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
                (active
                  ? "bg-[#1E2858] text-white border-[#1E2858]"
                  : "bg-white border-border text-foreground hover:bg-slate-50")
              }
            >
              {label}
            </button>
          )
        })}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name..."
          className="ml-auto h-8 w-56 rounded-md border border-border bg-white px-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#1E2858]"
          aria-label="Search institutions"
        />
      </div>

      {/* Section 3: A-Z letter filter */}
      <div
        className="mb-4 flex flex-wrap items-center gap-1 rounded-md p-2"
        style={{ backgroundColor: SOFT_BG }}
      >
        <button
          type="button"
          onClick={() => setLetter("All")}
          className={
            "rounded px-2 py-0.5 text-xs font-medium transition-colors " +
            (letter === "All"
              ? "bg-[#1E2858] text-white"
              : "bg-transparent hover:bg-white")
          }
          style={letter === "All" ? undefined : { color: NAVY_DEEP }}
        >
          All
        </button>
        {LETTERS.map((L) => {
          const isActive = letter === L
          const isAvailable = availableLetters.has(L)
          if (isActive) {
            return (
              <button
                key={L}
                type="button"
                onClick={() => setLetter(L)}
                className="rounded bg-[#1E2858] px-2 py-0.5 text-xs font-medium text-white"
              >
                {L}
              </button>
            )
          }
          if (!isAvailable) {
            return (
              <span
                key={L}
                aria-disabled="true"
                className="cursor-not-allowed rounded px-2 py-0.5 text-xs font-medium text-muted-foreground"
              >
                {L}
              </span>
            )
          }
          return (
            <button
              key={L}
              type="button"
              onClick={() => setLetter(L)}
              className="rounded bg-transparent px-2 py-0.5 text-xs font-medium hover:bg-white"
              style={{ color: NAVY_DEEP }}
            >
              {L}
            </button>
          )
        })}
      </div>

      {/* Section 4: Table card */}
      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="text-base font-semibold" style={{ color: NAVY_DEEP }}>
            Institutions
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">
            {sortedRows.length.toLocaleString()} of {total.toLocaleString()}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-12 px-3 py-2 text-left font-medium">#</th>
                <th
                  className="cursor-pointer px-3 py-2 text-left font-medium hover:text-foreground"
                  onClick={() => handleSort("institution_name")}
                >
                  Institution{sortIndicator("institution_name")}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => handleSort("lifetime_meetings")}
                >
                  Lifetime{sortIndicator("lifetime_meetings")}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => handleSort("ltm_meetings")}
                >
                  LTM{sortIndicator("ltm_meetings")}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => handleSort("unique_clients_lifetime")}
                >
                  Clients{sortIndicator("unique_clients_lifetime")}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => handleSort("unique_people_lifetime")}
                >
                  People{sortIndicator("unique_people_lifetime")}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => handleSort("first_met")}
                >
                  First Met{sortIndicator("first_met")}
                </th>
                <th
                  className="cursor-pointer px-3 py-2 text-right font-medium hover:text-foreground"
                  onClick={() => handleSort("last_met")}
                >
                  Last Met{sortIndicator("last_met")}
                </th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((r, i) => {
                const rank = startIdx + i + 1
                const showDash =
                  !r.is_active && !r.is_cold && !r.is_heavy_hitter
                const detailHref = r.institution_id
                  ? `/institution-detail?institution_id=${r.institution_id}`
                  : `/institution-detail`
                return (
                  <tr key={`${r.institution_name}-${rank}`} className="border-b last:border-0">
                    <td className="px-3 py-2 text-muted-foreground tabular-nums">
                      {rank}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={detailHref}
                        className="font-medium hover:underline"
                        style={{ color: NAVY_DEEP }}
                      >
                        {r.institution_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.lifetime_meetings.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.ltm_meetings.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.unique_clients_lifetime.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.unique_people_lifetime.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMonthYearShort(r.first_met)}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatMonthYearShort(r.last_met)}
                    </td>
                    <td className="px-3 py-2">
                      {showDash ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.is_active ? (
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: GREEN_BG, color: GREEN }}
                            >
                              Active
                            </span>
                          ) : r.is_cold ? (
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: RED_BG, color: RED }}
                            >
                              Cold
                            </span>
                          ) : null}
                          {r.is_heavy_hitter ? (
                            <span
                              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              style={{ backgroundColor: AMBER_BG, color: AMBER }}
                            >
                              Heavy Hitter
                            </span>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {pagedRows.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-3 py-8 text-center text-sm text-muted-foreground"
                  >
                    No institutions match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Pagination */}
        {sortedRows.length > 0 && (
          <div className="flex items-center justify-between border-t px-4 py-3 text-xs">
            <span className="text-muted-foreground tabular-nums">
              Page {safePage.toLocaleString()} of {totalPages.toLocaleString()}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-border bg-white px-3 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Prev
              </button>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() =>
                  setCurrentPage((p) => Math.min(totalPages, p + 1))
                }
                className="rounded-md border border-border bg-white px-3 py-1 text-xs font-medium hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
