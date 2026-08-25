"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { SegmentedToggle } from "@/components/segmented-toggle"
import { OooPersonPane, type OooPanePerson } from "./ooo-person-pane"
import {
  CARD_CLASS,
  KPI_CARD_CLASS,
  TEXT_MUTED,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
} from "@/lib/design"
import {
  CATEGORIES,
  pivotByPerson,
  type Category,
  type OooSummaryResult,
} from "@/lib/ooo-summary/compute"

/** Trim a trailing ".0" so 5 reads as "5" and 5.5 as "5.5". */
function fmt(n: number): string {
  return n === 0 ? "—" : String(Number(n.toFixed(1)))
}

type SortKey = "person" | Category | "totalAway"

/** Declared at module scope so it is not re-created on every render. */
function SortArrow({ active, asc }: { active: boolean; asc: boolean }) {
  if (!active) return null
  return asc ? <ArrowUp className="ml-1 inline size-3" /> : <ArrowDown className="ml-1 inline size-3" />
}

export function OooSummaryView({ summary }: { summary: OooSummaryResult }) {
  const { rows, years, details, skipped } = summary

  // The person whose requests the side pane is showing. Clicking another row
  // just replaces this, so the pane swaps without closing.
  const [openPerson, setOpenPerson] = useState<OooPanePerson | null>(null)

  // Open on the CURRENT year when it has data — not the latest year present,
  // which is a sparse tail of requests booked months ahead (2027 holds two).
  const [year, setYear] = useState<number>(() => {
    const now = new Date().getFullYear()
    return years.includes(now) ? now : (years[years.length - 1] ?? now)
  })
  const [sortKey, setSortKey] = useState<SortKey>("totalAway")
  const [asc, setAsc] = useState(false)

  const people = useMemo(() => {
    const list = pivotByPerson(rows, year)
    const dir = asc ? 1 : -1
    return [...list].sort((a, b) => {
      if (sortKey === "person") return a.person.localeCompare(b.person) * (asc ? 1 : -1)
      const av = sortKey === "totalAway" ? a.totalAway : a.byCategory[sortKey]
      const bv = sortKey === "totalAway" ? b.totalAway : b.byCategory[sortKey]
      return (av - bv) * dir || a.person.localeCompare(b.person)
    })
  }, [rows, year, sortKey, asc])

  // Firm-wide totals for the year, for the KPI strip.
  const totals = useMemo(() => {
    const t: Record<Category, number> = { "Time Off": 0, Remote: 0, Sick: 0, "Jury Duty": 0 }
    for (const p of people) for (const c of CATEGORIES) t[c] += p.byCategory[c]
    return t
  }, [people])

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setAsc((v) => !v)
    else {
      setSortKey(k)
      setAsc(k === "person")
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Heading + year selector ---- */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold" style={{ color: TEXT_PRIMARY }}>
            OOO Summary
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: TEXT_MUTED }}>
            Business days taken per person, per year. Weekends and NYSE market holidays are
            excluded; a request whose comment says &ldquo;half day&rdquo; counts as 0.5.
          </p>
        </div>
        {years.length > 0 ? (
          <SegmentedToggle
            value={String(year)}
            onChange={(v) => setYear(Number(v))}
            options={years.map((y) => ({ value: String(y), label: String(y) }))}
          />
        ) : null}
      </div>

      {/* ---- Firm-wide KPI strip ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CATEGORIES.map((c) => (
          <div key={c} className={`p-4 ${KPI_CARD_CLASS}`}>
            <div className="text-xs font-medium" style={{ color: TEXT_MUTED }}>
              {c}
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums" style={{ color: TEXT_PRIMARY }}>
              {totals[c] === 0 ? "0" : Number(totals[c].toFixed(1))}
            </div>
            <div className="text-[11px]" style={{ color: TEXT_MUTED }}>
              days across {people.length} {people.length === 1 ? "person" : "people"}
            </div>
          </div>
        ))}
      </div>

      {/* ---- The tally ---- */}
      <div className={`overflow-hidden ${CARD_CLASS}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-white">
                <th
                  className="cursor-pointer select-none px-4 py-2.5 text-left text-xs font-semibold"
                  style={{ color: TEXT_SECONDARY }}
                  onClick={() => toggleSort("person")}
                >
                  Person
                  <SortArrow active={sortKey === "person"} asc={asc} />
                </th>
                {CATEGORIES.map((c) => (
                  <th
                    key={c}
                    className="cursor-pointer select-none px-4 py-2.5 text-right text-xs font-semibold whitespace-nowrap"
                    style={{ color: TEXT_SECONDARY }}
                    onClick={() => toggleSort(c)}
                  >
                    {c}
                    <SortArrow active={sortKey === c} asc={asc} />
                  </th>
                ))}
                <th
                  className="cursor-pointer select-none px-4 py-2.5 text-right text-xs font-semibold whitespace-nowrap"
                  style={{ color: TEXT_SECONDARY }}
                  onClick={() => toggleSort("totalAway")}
                  title="Time Off + Sick + Jury Duty. Remote is not absence, so it is excluded."
                >
                  Total away
                  <SortArrow active={sortKey === "totalAway"} asc={asc} />
                </th>
              </tr>
            </thead>
            <tbody>
              {people.length === 0 ? (
                <tr>
                  <td
                    colSpan={CATEGORIES.length + 2}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: TEXT_MUTED }}
                  >
                    No time-off requests recorded for {year}.
                  </td>
                </tr>
              ) : (
                people.map((p) => (
                  <tr
                    key={p.person_id}
                    className="cursor-pointer border-b border-border/40 last:border-0 hover:bg-[#F8FAFC]"
                    onClick={() => setOpenPerson({ personId: p.person_id, person: p.person })}
                    // Keyboard-reachable: the row is the control, so it needs a
                    // role and an Enter/Space handler of its own.
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault()
                        setOpenPerson({ personId: p.person_id, person: p.person })
                      }
                    }}
                    title={`See ${p.person}'s individual requests`}
                  >
                    <td
                      className="px-4 py-2 font-medium underline decoration-transparent underline-offset-2 transition hover:decoration-inherit"
                      style={{ color: TEXT_PRIMARY }}
                    >
                      {p.person}
                    </td>
                    {CATEGORIES.map((c) => (
                      <td
                        key={c}
                        className="px-4 py-2 text-right tabular-nums"
                        style={{ color: p.byCategory[c] === 0 ? TEXT_MUTED : TEXT_PRIMARY }}
                      >
                        {fmt(p.byCategory[c])}
                      </td>
                    ))}
                    <td
                      className="px-4 py-2 text-right font-semibold tabular-nums"
                      style={{ color: TEXT_PRIMARY }}
                    >
                      {fmt(p.totalAway)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- Footnotes: the rules that surprise people ---- */}
      <p className="text-[11px] leading-relaxed" style={{ color: TEXT_MUTED }}>
        <strong>Total away</strong> is Time Off + Sick + Jury Duty — Remote is working, not absence,
        so it is shown but never added in. Categories: Remote = Remote Work, Sick = Sick Leave, Jury
        Duty = Jury Duty, and <strong>Time Off</strong> is everything else (Vacation, Personal,
        Other). Holidays follow the <strong>NYSE</strong> calendar, so Good Friday is a day off but
        Columbus Day and Veterans Day are ordinary working days. Every request counts as approved.
        {skipped > 0 ? ` ${skipped} request(s) were skipped for a missing or invalid date.` : ""}{" "}
        Click any person to see their individual requests. Full definition in Admin → Docs → OOO
        Summary.
      </p>

      <OooPersonPane
        person={openPerson}
        details={details}
        onClose={() => setOpenPerson(null)}
      />
    </div>
  )
}
