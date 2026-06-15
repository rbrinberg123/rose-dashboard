"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { format, parseISO } from "date-fns"
import { Gauge } from "lucide-react"
import { CARD_CLASS, TEXT_PRIMARY, TEXT_MUTED, TEXT_SECONDARY, TEXT_TERTIARY } from "@/lib/design"
import { ListTitleCard } from "@/components/page-masthead"
import { SegmentedToggle } from "@/components/segmented-toggle"
import type { PersonRole } from "@/lib/types"
import {
  CapacityAssumptions,
  CAP_BOOKING,
  CAP_HOSTING,
  CAP_FEEDBACK,
  CAP_ACCOUNT,
  CAP_OVERHEAD,
  CAP_OVER,
} from "./capacity-assumptions"

export type CapacityPeriod = "1m" | "3m" | "1y"

// One person's modeled hours for the selected window. Available hours are
// shared firm-wide (weekdays × 8), so they live on the view, not the row.
export type CapacityPerson = {
  user_id: string
  display_name: string
  role: PersonRole
  booking_hours: number
  hosting_hours: number
  feedback_hours: number
  account_hours: number
  accounted_hours: number
}

const PERIOD_OPTIONS: Array<{ value: CapacityPeriod; label: string }> = [
  { value: "1m", label: "1 Month" },
  { value: "3m", label: "3 Months" },
  { value: "1y", label: "1 Year" },
]

const PERIOD_LABEL: Record<CapacityPeriod, string> = {
  "1m": "1 Month",
  "3m": "3 Months",
  "1y": "1 Year",
}

/** "May 15 – Jun 15, 2026" (drops the year on the start when it matches the end). */
function fmtRange(from: string, to: string): string {
  const f = parseISO(from)
  const t = parseISO(to)
  const sameYear = f.getFullYear() === t.getFullYear()
  return `${format(f, sameYear ? "MMM d" : "MMM d, yyyy")} – ${format(t, "MMM d, yyyy")}`
}

// Display order for the group headers — same scheme + colors as the Activity
// Statistics "Activity by Person" chart (Bookers / Hosts / Hybrids, with any
// Unclassified people at the bottom).
const GROUPS: Array<{ label: string; role: PersonRole }> = [
  { label: "Bookers", role: "Booker" },
  { label: "Hosts", role: "Host" },
  { label: "Hybrids", role: "Hybrid" },
  { label: "Unclassified", role: null },
]

// Shared role dot colors (match the Summary role pills + Statistics group dots).
const ROLE_DOT: Record<"Host" | "Booker" | "Hybrid", string> = {
  Host: "#0E7C72",
  Booker: "#2A3C77",
  Hybrid: "#5B4B9E",
}
function roleDotColor(role: PersonRole): string {
  return role ? ROLE_DOT[role] : TEXT_TERTIARY
}

function fmtHours(h: number): string {
  return h.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

type Segment = { key: string; label: string; color: string; hours: number }

function segmentsFor(p: CapacityPerson): Segment[] {
  return [
    { key: "booking", label: "Booking", color: CAP_BOOKING, hours: p.booking_hours },
    { key: "hosting", label: "Hosting", color: CAP_HOSTING, hours: p.hosting_hours },
    { key: "feedback", label: "Feedback", color: CAP_FEEDBACK, hours: p.feedback_hours },
    { key: "account", label: "Account mgmt", color: CAP_ACCOUNT, hours: p.account_hours },
  ]
}

/** One person row: name · utilization % · stacked bar · hover tooltip. */
function PersonRow({
  person,
  availableHours,
}: {
  person: CapacityPerson
  availableHours: number
}) {
  const segs = segmentsFor(person)
  const accounted = person.accounted_hours
  const over = accounted > availableHours
  const util = availableHours > 0 ? (accounted / availableHours) * 100 : 0
  const overhead = Math.max(0, availableHours - accounted)

  // Over capacity: scale segments to the accounted total so the bar fills 100%
  // (no overhead gap) and gets a red over-capacity treatment. Otherwise scale
  // to available hours and let gray overhead fill the remainder.
  const denom = over ? accounted : availableHours
  const widthPct = (h: number) => (denom > 0 ? (h / denom) * 100 : 0)

  return (
    <div className="group relative flex items-center gap-3 py-[3px]">
      <div
        className="shrink-0 truncate text-[13px]"
        style={{ width: 150, color: TEXT_SECONDARY }}
        title={person.display_name}
      >
        {person.display_name}
      </div>

      {/* Utilization % — red when over capacity. */}
      <div
        className="shrink-0 text-right text-[13px] font-semibold tabular-nums"
        style={{ width: 48, color: over ? CAP_OVER : TEXT_PRIMARY }}
      >
        {Math.round(util)}%
      </div>

      {/* Stacked bar. Track background = gray overhead; colored segments fill
          from the left. When over capacity the segments fill the whole bar and
          a red over-marker caps the right edge (plus a red ring). */}
      <div
        className="relative h-2.5 flex-1 overflow-hidden rounded-full"
        style={{
          background: CAP_OVERHEAD,
          boxShadow: over ? `0 0 0 1.5px ${CAP_OVER}` : undefined,
        }}
      >
        <div className="flex h-full w-full">
          {segs.map((s) =>
            s.hours > 0 ? (
              <div
                key={s.key}
                style={{ width: `${widthPct(s.hours)}%`, background: s.color }}
              />
            ) : null,
          )}
        </div>
        {over ? (
          <div
            className="absolute inset-y-0 right-0"
            style={{ width: 6, background: CAP_OVER }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      {/* Hover tooltip — actual hours per category + totals. */}
      <div
        className="pointer-events-none absolute left-[150px] top-full z-20 mt-1 hidden min-w-[220px] rounded-md border bg-white p-2.5 text-[12.5px] shadow-md group-hover:block"
        style={{ borderColor: "#E6E9EF" }}
        role="tooltip"
      >
        <div className="mb-1.5 font-medium" style={{ color: TEXT_PRIMARY }}>
          {person.display_name}
        </div>
        {segs.map((s) => (
          <TooltipRow key={s.key} swatch={s.color} label={s.label} hours={s.hours} />
        ))}
        {!over ? (
          <TooltipRow
            swatch={CAP_OVERHEAD}
            outline
            label="Overhead"
            hours={overhead}
          />
        ) : null}
        <div className="mt-1.5 border-t pt-1.5" style={{ borderColor: "#EEF0F4" }}>
          <TooltipRow label="Accounted" hours={accounted} bold />
          <TooltipRow label="Available" hours={availableHours} bold />
          <div
            className="mt-0.5 flex items-center justify-between"
            style={{ color: over ? CAP_OVER : TEXT_SECONDARY }}
          >
            <span>Utilization</span>
            <span className="font-semibold tabular-nums">
              {Math.round(util)}%{over ? " · over capacity" : ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TooltipRow({
  swatch,
  outline,
  label,
  hours,
  bold,
}: {
  swatch?: string
  outline?: boolean
  label: string
  hours: number
  bold?: boolean
}) {
  return (
    <div className="flex items-center gap-2" style={{ color: TEXT_SECONDARY }}>
      {swatch ? (
        <span
          className="inline-block size-2.5 rounded-sm"
          style={{
            background: swatch,
            border: outline ? "1px solid #CDD3DC" : undefined,
          }}
          aria-hidden="true"
        />
      ) : (
        <span className="inline-block size-2.5" aria-hidden="true" />
      )}
      <span className="flex-1">{label}</span>
      <span
        className="tabular-nums"
        style={{ fontWeight: bold ? 600 : 400, color: TEXT_PRIMARY }}
      >
        {fmtHours(hours)} h
      </span>
    </div>
  )
}

function CapacityChartCard({
  period,
  from,
  to,
  availableHours,
  weekdays,
  people,
  onPeriodChange,
}: {
  period: CapacityPeriod
  from: string
  to: string
  availableHours: number
  weekdays: number
  people: CapacityPerson[]
  onPeriodChange: (p: CapacityPeriod) => void
}) {
  const groups = React.useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        members: people
          .filter((p) => p.role === g.role)
          .sort((a, b) => b.accounted_hours - a.accounted_hours),
      })).filter((g) => g.members.length > 0),
    [people],
  )

  return (
    <div className={`mt-4 p-5 ${CARD_CLASS}`}>
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex size-7 items-center justify-center rounded-lg"
            style={{ background: "#EEF2FB", color: CAP_BOOKING }}
          >
            <Gauge className="size-4" />
          </span>
          <div>
            <div className="text-[15px] font-semibold" style={{ color: TEXT_PRIMARY }}>
              Utilization by Person
            </div>
            {/* Prominent period basis: window label · actual dates · the hour
                total that 100% represents. */}
            <div className="mt-0.5 text-[13px] font-medium" style={{ color: TEXT_SECONDARY }}>
              {PERIOD_LABEL[period]} · {fmtRange(from, to)} ·{" "}
              <span style={{ color: TEXT_PRIMARY, fontWeight: 600 }}>
                {availableHours.toLocaleString()} available hours
              </span>
            </div>
            <div className="mt-0.5 text-[12px]" style={{ color: TEXT_MUTED }}>
              trailing window · {weekdays.toLocaleString()} weekdays × 8 · grouped by
              primary function
            </div>
          </div>
        </div>
        <SegmentedToggle value={period} onChange={onPeriodChange} options={PERIOD_OPTIONS} />
      </div>

      {/* Key / legend — every segment color labeled, above the bars. */}
      <div
        className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3 text-[13px]"
        style={{ borderColor: "#EEF0F4", color: TEXT_MUTED }}
      >
        <span className="font-semibold" style={{ color: TEXT_SECONDARY }}>
          Key
        </span>
        <LegendItem swatch={CAP_BOOKING} label="Booking" />
        <LegendItem swatch={CAP_HOSTING} label="Hosting" />
        <LegendItem swatch={CAP_FEEDBACK} label="Feedback" />
        <LegendItem swatch={CAP_ACCOUNT} label="Account mgmt" />
        <LegendItem swatch={CAP_OVERHEAD} label="Overhead" outline />
        <LegendItem swatch={CAP_OVER} label="Over capacity" />
      </div>

      {availableHours === 0 ? (
        <div
          className="flex h-[120px] items-center justify-center text-center text-sm"
          style={{ color: TEXT_MUTED }}
        >
          No weekdays in this window.
        </div>
      ) : people.length === 0 ? (
        <div
          className="flex h-[120px] items-center justify-center text-center text-sm"
          style={{ color: TEXT_MUTED }}
        >
          No modeled activity in this period yet.
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[#EEF0F4]">
          {groups.map((g) => (
            <div key={g.label} className="py-4 first:pt-0 last:pb-0">
              <div className="mb-1.5 flex items-center gap-2">
                <span
                  className="inline-block size-2 rounded-full"
                  style={{ background: roleDotColor(g.role) }}
                  aria-hidden="true"
                />
                <span className="text-[13px] font-semibold" style={{ color: TEXT_PRIMARY }}>
                  {g.label}
                </span>
                <span className="text-[13px]" style={{ color: TEXT_MUTED }}>
                  {g.members.length}
                </span>
              </div>
              <div>
                {g.members.map((p) => (
                  <PersonRow
                    key={p.user_id}
                    person={p}
                    availableHours={availableHours}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LegendItem({
  swatch,
  label,
  outline,
}: {
  swatch: string
  label: string
  outline?: boolean
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block size-2.5 rounded-sm"
        style={{ background: swatch, border: outline ? "1px solid #CDD3DC" : undefined }}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  )
}

export function CapacityView({
  period,
  from,
  to,
  availableHours,
  weekdays,
  people,
}: {
  period: CapacityPeriod
  from: string
  to: string
  availableHours: number
  weekdays: number
  people: CapacityPerson[]
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  const onPeriodChange = React.useCallback(
    (next: CapacityPeriod) => {
      startTransition(() => {
        router.push(`/capacity?period=${next}`)
      })
    },
    [router],
  )

  return (
    <div style={{ opacity: pending ? 0.6 : 1, transition: "opacity 150ms" }}>
      <div className="mb-4">
        <ListTitleCard
          title="Capacity"
          subtitle={`How each person’s available hours break down across activities · ${from} → ${to}`}
        />
      </div>

      <CapacityAssumptions />

      <CapacityChartCard
        period={period}
        from={from}
        to={to}
        availableHours={availableHours}
        weekdays={weekdays}
        people={people}
        onPeriodChange={onPeriodChange}
      />
    </div>
  )
}
