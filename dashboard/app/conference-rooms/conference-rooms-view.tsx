"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { CARD_CLASS } from "@/lib/design"
import type { ConferenceRoomsResponse, RoomSchedule } from "@/lib/conference-rooms"

// Vertical scale — mirrors the Scheduler grid so the two read as one system.
const PX_PER_HOUR = 44
const PX_PER_MIN = PX_PER_HOUR / 60

// Booked block: the same blue the Scheduler grid uses for scheduled meetings,
// so the two time-grids read as one system. Blue signals "occupied/scheduled",
// not the alert that red implied. Every occupied status (busy / tentative /
// oof) renders the same — the room is simply "Booked" (Graph ReadBasic gives
// free/busy only, no subject).
const BOOKED = { fill: "#378ADD", border: "#2C6FB0", text: "#FFFFFF" }

const CONTROL_CLASS =
  "inline-flex h-9 items-center justify-center rounded-md border border-border bg-card px-2 text-sm text-foreground transition-colors hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-50"

// --- date helpers (Eastern-safe: ymd parsed as UTC so day math never shifts) ---
function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}
function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
function prettyDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)))
}

// --- time helpers (minutes from midnight) ---
function clock(min: number): string {
  const h = Math.floor(min / 60)
  const mm = min % 60
  const h12 = ((h + 11) % 12) + 1
  return `${h12}:${String(mm).padStart(2, "0")}`
}
function meridiem(min: number): string {
  return Math.floor(min / 60) < 12 ? "AM" : "PM"
}
function tickLabel(min: number): string {
  const h = Math.floor(min / 60)
  const h12 = ((h + 11) % 12) + 1
  return `${h12} ${h < 12 ? "AM" : "PM"}`
}

export function ConferenceRoomsView() {
  const [date, setDate] = React.useState<string>(() => todayEastern())
  const [data, setData] = React.useState<ConferenceRoomsResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  // Guards against a slow earlier day's response landing after a newer one.
  const reqRef = React.useRef(0)

  React.useEffect(() => {
    const id = ++reqRef.current
    setLoading(true)
    setError(null)
    fetch(`/api/conference-rooms?date=${date}`, { headers: { accept: "application/json" } })
      .then(async (r) => {
        if (id !== reqRef.current) return
        if (!r.ok) {
          setData(null)
          setError(
            r.status === 401
              ? "Your session expired — please sign in again."
              : r.status === 403
                ? "You don't have access to this page."
                : `Could not load room availability (error ${r.status}).`,
          )
          return
        }
        const json = (await r.json()) as ConferenceRoomsResponse
        if (id === reqRef.current) setData(json)
      })
      .catch(() => {
        if (id === reqRef.current) {
          setData(null)
          setError("Could not reach the server.")
        }
      })
      .finally(() => {
        if (id === reqRef.current) setLoading(false)
      })
  }, [date])

  const isToday = date === todayEastern()

  return (
    <div className="space-y-4">
      {/* Day navigation */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setDate((d) => addDaysYmd(d, -1))}
          className={CONTROL_CLASS}
          aria-label="Previous day"
        >
          <ChevronLeft className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setDate((d) => addDaysYmd(d, 1))}
          className={CONTROL_CLASS}
          aria-label="Next day"
        >
          <ChevronRight className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setDate(todayEastern())}
          disabled={isToday}
          className={CONTROL_CLASS + " px-3 text-xs font-medium"}
        >
          Today
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) setDate(e.target.value)
          }}
          className={CONTROL_CLASS + " px-2"}
          aria-label="Selected date"
        />
        <span className="ml-1 text-sm font-medium tabular-nums text-foreground">
          {prettyDate(date)}
        </span>
        {loading && data ? (
          <span className="text-xs text-muted-foreground">Updating…</span>
        ) : null}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm"
            style={{ backgroundColor: BOOKED.fill, border: `1px solid ${BOOKED.border}` }}
          />
          Booked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm border border-border bg-white" />
          Free
        </span>
      </div>

      {/* Grid / states */}
      {error ? (
        <div
          className={`flex h-40 items-center justify-center px-4 text-center text-sm text-destructive ${CARD_CLASS}`}
        >
          {error}
        </div>
      ) : !data ? (
        <div
          className={`flex h-40 items-center justify-center text-sm text-muted-foreground ${CARD_CLASS}`}
        >
          Loading room availability…
        </div>
      ) : (
        <RoomGrid data={data} />
      )}
    </div>
  )
}

function RoomGrid({ data }: { data: ConferenceRoomsResponse }) {
  const startMin = data.startHour * 60
  const endMin = data.endHour * 60
  const gridHeight = (endMin - startMin) * PX_PER_MIN
  const topOf = (m: number) => (m - startMin) * PX_PER_MIN

  const ticks: number[] = []
  for (let t = startMin; t <= endMin; t += 60) ticks.push(t)

  return (
    <div className={`overflow-x-auto ${CARD_CLASS}`}>
      <div className="flex min-w-[720px]">
        {/* Time axis */}
        <div className="w-14 shrink-0">
          <div className="h-14 border-b border-border" />
          <div className="relative" style={{ height: gridHeight }}>
            {ticks.map((t) => (
              <span
                key={t}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: topOf(t) }}
              >
                {tickLabel(t)}
              </span>
            ))}
          </div>
        </div>

        {/* One column per room */}
        {data.rooms.map((room) => (
          <RoomColumn
            key={room.label}
            room={room}
            startMin={startMin}
            endMin={endMin}
            gridHeight={gridHeight}
            topOf={topOf}
            ticks={ticks}
          />
        ))}
      </div>
    </div>
  )
}

function RoomColumn({
  room,
  startMin,
  endMin,
  gridHeight,
  topOf,
  ticks,
}: {
  room: RoomSchedule
  startMin: number
  endMin: number
  gridHeight: number
  topOf: (m: number) => number
  ticks: number[]
}) {
  // Keep only blocks that overlap the visible window.
  const visible = room.blocks.filter((b) => b.endMinutes > startMin && b.startMinutes < endMin)

  return (
    <div className="min-w-[150px] flex-1 border-l border-border">
      {/* Header: label + display alias */}
      <div className="flex h-14 flex-col items-center justify-center gap-0.5 border-b border-border px-2 text-center">
        <span className="text-sm font-medium text-foreground">{room.label}</span>
        <span className="max-w-full truncate text-[11px] text-muted-foreground" title={room.displayEmail}>
          {room.displayEmail}
        </span>
      </div>

      {/* Day body */}
      <div className="relative" style={{ height: gridHeight }}>
        {/* Hour gridlines */}
        {ticks.map((t) => (
          <div
            key={t}
            className="absolute inset-x-0 border-t border-border/50"
            style={{ top: topOf(t) }}
          />
        ))}

        {room.error ? (
          <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-muted-foreground">
            No calendar available
          </div>
        ) : (
          visible.map((b, i) => {
            const top = topOf(Math.max(b.startMinutes, startMin))
            const bottom = topOf(Math.min(b.endMinutes, endMin))
            const height = Math.max(bottom - top, 4)
            const label = `${clock(b.startMinutes)}–${clock(b.endMinutes)} ${meridiem(b.endMinutes)}`
            return (
              <div
                key={i}
                title={`${label} · Booked`}
                className="absolute inset-x-0.5 box-border overflow-hidden rounded px-1 py-0.5"
                style={{ top, height, backgroundColor: BOOKED.fill, border: `1px solid ${BOOKED.border}` }}
              >
                {height >= 16 ? (
                  <span
                    className="block truncate text-[10px] font-medium leading-tight"
                    style={{ color: BOOKED.text }}
                  >
                    {label}
                  </span>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
