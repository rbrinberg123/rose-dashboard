import * as React from "react"
import { Video, MapPin, Shuffle } from "lucide-react"
import { ListTitleCard } from "@/components/page-masthead"
import { CARD_CLASS, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, TEXT_TERTIARY, BRAND_NAVY, STATUS_PILL_LIGHT } from "@/lib/design"
import { format } from "date-fns"
import { formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { LiveOutreachRow, LiveOutreachMeeting } from "@/lib/types"
import { priorityFlagKind, PRIORITY_FLAG_STYLE } from "./priority-flag"
import { SendEmailControls } from "./send-email-button"

// NEW recency flag uses the palette's "new" blue.
const NEW_FLAG = STATUS_PILL_LIGHT.new

// ---- small formatters (page-local; the shared ones don't cover these) ------

/** market_cap_b is already in $B. Show "$87.4B"; sub-$1B as "$970M". */
function formatMcap(b: number | null): string {
  if (b == null || Number.isNaN(b)) return "—"
  if (b >= 1) return `$${b.toFixed(1)}B`
  return `$${Math.round(b * 1000)}M`
}

/** div_yield is already a percent number (4.34 → "4.34%"). 0 stays "0.00%". */
function formatYield(v: number | null): string {
  if (v == null || Number.isNaN(v)) return "—"
  return `${v.toFixed(2)}%`
}

// ---- priority flag pill (High Priority / New Client / none) -----------------
// One flag per event, chosen by priorityFlagKind: High urgency → "High Priority"
// (alert red), else a new client → "New Client" (rose-crimson), else an At-Risk
// client → "High Priority", else nothing. Shared with the email so they match.
function PriorityPill({ row }: { row: LiveOutreachRow }) {
  const kind = priorityFlagKind(row)
  if (!kind) return null
  const s = PRIORITY_FLAG_STYLE[kind]
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-semibold"
      style={{ padding: "3px 10px", fontSize: 11, background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  )
}

// ---- Virtual / Live / Hybrid tag (derived from event_location) -------------
const MODE_STYLE = {
  Virtual: { bg: "#EEF2FB", text: "#2D4A8A", Icon: Video },
  Live: { bg: "#E7F5EE", text: "#0E7C56", Icon: MapPin },
  Hybrid: { bg: "#F3ECFB", text: "#6B3FA0", Icon: Shuffle },
} as const

function ModeTag({ mode }: { mode: LiveOutreachRow["event_mode"] }) {
  if (!mode) return null
  const s = MODE_STYLE[mode]
  const Icon = s.Icon
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md font-medium"
      style={{ padding: "2px 8px", fontSize: 11, background: s.bg, color: s.text }}
    >
      <Icon className="size-3" />
      {mode}
    </span>
  )
}

// ---- one labeled mini-stat -------------------------------------------------
function Stat({
  label,
  value,
  danger,
  title,
}: {
  label: string
  value: React.ReactNode
  danger?: boolean
  title?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: TEXT_TERTIARY }}>
        {label}
      </div>
      <div
        className="truncate text-sm font-semibold tabular-nums"
        style={{ color: danger ? "#A32D2D" : TEXT_PRIMARY }}
        title={title}
      >
        {value}
      </div>
    </div>
  )
}

// ---- open-slots stat: "X of Y", red when low (<= 2); overbooked clamps to 0
function OpenSlotsStat({ remaining, total }: { remaining: number | null; total: number | null }) {
  if (remaining == null) return <Stat label="Open Slots" value="—" />
  const shown = Math.max(0, remaining)
  const low = remaining <= 2
  const overbooked = remaining < 0
  return (
    <Stat
      label="Open Slots"
      value={`${shown}${total != null ? ` of ${total}` : ""}`}
      danger={low}
      title={overbooked ? `Overbooked by ${-remaining}` : undefined}
    />
  )
}

// ---- per-meeting recency flag (NEW = added to the CRM in the last 24 hours) -
// Mirrors the Live Outreach email exactly: the blue NEW pill shows only when the
// meeting's created_on is within the last 24 hours (and not in the future);
// otherwise no pill. No prior-meeting count.
const DAY_MS = 24 * 60 * 60 * 1000
function isRecentlyAdded(createdOn: string | null | undefined): boolean {
  if (!createdOn) return false
  const t = Date.parse(createdOn)
  if (Number.isNaN(t)) return false
  const age = Date.now() - t
  return age >= 0 && age <= DAY_MS
}

function NewPill() {
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-bold uppercase tracking-wide"
      style={{ padding: "1px 7px", fontSize: 10, background: NEW_FLAG.bg, color: NEW_FLAG.text }}
      title="Added to the CRM in the last 24 hours"
    >
      New
    </span>
  )
}

function MeetingFlag({ createdOn }: { createdOn: string | null | undefined }) {
  return isRecentlyAdded(createdOn) ? <NewPill /> : null
}

// ---- key explaining the NEW recency flag -----------------------------------
function HistoryLegend() {
  return (
    <div
      className={cn("mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 px-4 py-2.5", CARD_CLASS)}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: TEXT_TERTIARY }}>
        Key
      </span>
      <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: TEXT_SECONDARY }}>
        <NewPill />
        Meeting added to the CRM in the last 24 hours
      </span>
    </div>
  )
}

// ---- live-meeting city pill (teal, pin icon) -------------------------------
// Only live meetings get a pill; virtual meetings render nothing. The pin icon
// is the "live/in-person" indicator; the city follows it when known (just the
// pin when the city is unknown). Light teal fill / dark teal text, matching the
// email's version.
function LiveCityPill({ meeting }: { meeting: LiveOutreachMeeting }) {
  if (!meeting.is_in_person) return null
  return (
    <span
      className="ml-1.5 inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap rounded-full align-middle font-semibold"
      style={{ padding: "1px 7px", fontSize: 10, background: "#E1F0F2", color: "#146874" }}
    >
      <MapPin className="size-3" />
      {meeting.city}
    </span>
  )
}

// ---- one confirmed meeting line: date · [flag] · institution · contact -----
function MeetingLine({ m }: { m: LiveOutreachMeeting }) {
  return (
    <li className="flex items-start gap-2.5 py-0.5">
      <span
        className="mt-px w-[58px] shrink-0 text-[11px] font-semibold tabular-nums"
        style={{ color: BRAND_NAVY }}
      >
        {formatDate(m.meeting_date).replace(/, \d{4}$/, "")}
      </span>
      {/* NEW recency flag in a FIXED-WIDTH, centered column so the institution
          name always starts at the same x on every row, whether or not the pill
          shows. */}
      <div className="mt-px flex w-[46px] shrink-0 justify-center">
        <MeetingFlag createdOn={m.created_on} />
      </div>
      {/* Institution + contact on one line; long names wrap naturally rather
          than forcing the contact onto its own line. */}
      <div className="min-w-0 flex-1 text-[13px] leading-tight">
        <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
          {m.institution_name ?? "—"}
        </span>
        {m.contact ? (
          <>
            <span style={{ color: TEXT_TERTIARY }}> · </span>
            <span style={{ color: TEXT_MUTED }}>{m.contact}</span>
          </>
        ) : null}
        <LiveCityPill meeting={m} />
      </div>
    </li>
  )
}

// ---- one client/event card -------------------------------------------------
function OutreachCard({ row }: { row: LiveOutreachRow }) {
  const meetings = row.confirmed_meetings ?? []
  return (
    <div className={cn("flex flex-col overflow-hidden md:flex-row", CARD_CLASS)}>
      {/* LEFT — client + event facts */}
      <div className="min-w-0 flex-1 p-5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {row.ticker ? (
            <span className="text-sm font-bold tracking-wide" style={{ color: BRAND_NAVY }}>
              {row.ticker}
            </span>
          ) : null}
          <h3 className="min-w-0 truncate text-base font-semibold" style={{ color: TEXT_PRIMARY }}>
            {row.client_account_name ?? row.event_name ?? "—"}
          </h3>
          <PriorityPill row={row} />
        </div>
        {row.industry ? (
          <div className="mt-0.5 text-xs" style={{ color: TEXT_MUTED }}>
            {row.industry}
          </div>
        ) : null}

        {/* labeled mini-stats */}
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Div Yield" value={formatYield(row.div_yield)} />
          <Stat label="Mkt Cap" value={formatMcap(row.market_cap_b)} />
          <Stat label="Client Lead" value={row.sales_lead_name ?? "—"} title={row.sales_lead_name ?? undefined} />
          <OpenSlotsStat remaining={row.slots_remaining} total={row.of_slots} />
        </div>

        {/* mode + event dates */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
          <ModeTag mode={row.event_mode} />
          {row.event_dates ? (
            <span className="text-xs" style={{ color: TEXT_MUTED }}>
              {row.event_dates}
            </span>
          ) : (
            <span className="text-xs" style={{ color: TEXT_TERTIARY }}>
              No dates set
            </span>
          )}
        </div>
      </div>

      {/* RIGHT — confirmed meetings (subtle shaded panel) */}
      <div className="w-full shrink-0 border-t border-border/60 bg-[#F7F8FA] p-4 md:w-[58%] md:border-l md:border-t-0">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: TEXT_SECONDARY }}>
            Confirmed Meetings
          </span>
          <span
            className="inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold text-white"
            style={{ background: BRAND_NAVY }}
          >
            {row.confirmed_meeting_count}
          </span>
        </div>
        {meetings.length === 0 ? (
          <div className="py-3 text-sm" style={{ color: TEXT_TERTIARY }}>
            No confirmed meetings yet.
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {meetings.map((m) => (
              <MeetingLine key={m.meeting_id} m={m} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function LiveOutreachView({ rows, userEmail }: { rows: LiveOutreachRow[]; userEmail?: string }) {
  const totalMeetings = rows.reduce((sum, r) => sum + (r.confirmed_meeting_count ?? 0), 0)
  // Today's date, rendered server-side on every request (the page is
  // force-dynamic), so it rolls over to the current day automatically.
  const todayLabel = format(new Date(), "MMMM d, yyyy")

  return (
    <>
      <div className="mb-4">
        <ListTitleCard
          title={`Non-Deal Roadshow Update - ${todayLabel}`}
          subtitle={
            rows.length === 0
              ? "No events are currently in Live Outreach."
              : `${rows.length} event${rows.length === 1 ? "" : "s"} in active outreach · ${totalMeetings} confirmed meeting${totalMeetings === 1 ? "" : "s"}`
          }
          rightSlot={<SendEmailControls userEmail={userEmail} />}
        />
      </div>

      {rows.length > 0 ? <HistoryLegend /> : null}

      {rows.length === 0 ? (
        <div className={cn("p-6 text-sm", CARD_CLASS)} style={{ color: TEXT_MUTED }}>
          Nothing to show — no events are in the Live Outreach state right now.
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <OutreachCard key={row.event_id} row={row} />
          ))}
        </div>
      )}
    </>
  )
}
