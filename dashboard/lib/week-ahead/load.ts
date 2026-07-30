// Server-side loader for the "Week Ahead" meetings digest.
//
// Pulls Confirmed meetings for the upcoming business week (Mon–Fri) from
// v_planning_events, enriches each with its city (looked up from public.meetings,
// exactly like app/live-outreach/load.ts), flags the in-office meetings from
// hosted_in_hq, and derives the two rollups the email renders: a per-day summary
// (the Mon–Fri grid + the in-office banner) and a per-client/event summary.
//
// Fails soft on the city read: any error there just leaves meetings without a
// city (city is display-only — the Event Summary Location column). Only a fatal
// v_planning_events fetch error is surfaced via the returned `error`.

import { getSupabaseServer } from "@/lib/supabase"
import type { PlanningEventRow } from "@/lib/types"

// ---- window ----------------------------------------------------------------
// THE window boundary lives here — one place to change. Today the digest covers
// the upcoming Monday–Friday business week (the default read of "next 7 days" for
// a Friday afternoon send: the *coming* work week). To switch to a rolling 7
// calendar days later, change this one knob to 7 (the day-grid loop in the email
// builder follows automatically, rendering 7 cells).
const WINDOW_LENGTH_DAYS = 5 // Mon, Tue, Wed, Thu, Fri (inclusive)

const NY_TZ = "America/New_York"

// Show only the base ticker, dropping an exchange/country qualifier such as
// "NVCR US", "SGO:FP", or "STVL-LN". Share-class dots (e.g. "BRK.B") are kept.
// Same logic as the Live Outreach / Feedback email builders.
export function baseTicker(t: string): string {
  return t.trim().split(/[\s:]/)[0].replace(/-[A-Za-z]{1,4}$/, "")
}

// Integer day index (days since epoch) for a 'YYYY-MM-DD' date string. Lets us
// range-test meeting_day against the window and iterate the window days.
function dayNumFromYMD(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}

// The Eastern calendar day (as a day index + weekday 0=Sun…6=Sat) that anchors
// which business week we target. We anchor on the Eastern date so the "coming
// week" is correct for the 3:45 PM ET Friday send regardless of server locale.
function easternAnchor(now: Date): { dayNum: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TZ,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  const dayNum = dayNumFromYMD(`${get("year")}-${get("month")}-${get("day")}`)
  return { dayNum, weekday: weekdayMap[get("weekday")] ?? -1 }
}

/** Window start (Monday) + end (Friday) day indices for the digest. Monday is the
 *  next Monday ON OR AFTER the Eastern anchor date: for the Friday send that is
 *  the coming Monday (+3 days); on a Monday it is that same Monday. */
export function computeWindow(now: Date): { startNum: number; endNum: number } {
  const { dayNum, weekday } = easternAnchor(now)
  const daysToMonday = (1 - weekday + 7) % 7 // Fri→3, Sat→2, Sun→1, Mon→0
  const startNum = dayNum + daysToMonday
  const endNum = startNum + (WINDOW_LENGTH_DAYS - 1)
  return { startNum, endNum }
}

// ---- enriched shapes the email consumes ------------------------------------

export type WeekAheadMeeting = {
  meeting_id: string
  dayNum: number // window day index (for grid bucketing)
  meeting_day: string // 'YYYY-MM-DD'
  timeLabel: string // e.g. "9:30 AM" (meeting wall-clock)
  sortMs: number // for chronological ordering within a day
  ticker: string | null // base ticker (suffix stripped)
  clientName: string | null
  eventName: string | null
  institution: string | null
  investor: string | null
  isLive: boolean // is_in_person
  host: string | null
  city: string | null // display only (Location column); NOT the office source
  isNyOffice: boolean // hosted_in_hq === true (authoritative office flag)
}

export type WeekAheadDay = {
  dayNum: number
  weekdayShort: string // "Mon"
  dateLabel: string // "Jul 27"
  meetings: WeekAheadMeeting[]
  count: number
  tickers: string[] // distinct base tickers that day (in first-seen order)
  nyOffice: boolean // any in-office meeting that day
  nyCount: number // # of in-office meetings that day
  nyTickers: string[] // distinct tickers driving the in-office day
}

export type WeekAheadEvent = {
  event_id: string
  ticker: string | null
  clientName: string | null
  eventName: string | null
  count: number // # meetings in-window
  dateRange: string // "Jul 27" or "Jul 27–Jul 29"
  type: "Live" | "Virtual" | "Hybrid"
  location: string // in-office flagged; else cities / "Virtual"
  isNyOffice: boolean
  firstMs: number // earliest meeting, for sorting
}

export type WeekAheadData = {
  meetings: WeekAheadMeeting[] // all in-window, chronological
  days: WeekAheadDay[] // exactly WINDOW_LENGTH_DAYS entries (Mon…Fri)
  events: WeekAheadEvent[] // one per client/event, earliest first
  startNum: number
  endNum: number
  totalMeetings: number
  totalClients: number
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** "Mon" / "Jul 27" for a window day index (read as a UTC calendar day). Exported
 *  so the email header can label the full Mon–Sun span. */
export function labelForDayNum(dayNum: number): { weekdayShort: string; dateLabel: string } {
  const d = new Date(dayNum * 86400000)
  return {
    weekdayShort: WEEKDAYS[d.getUTCDay()],
    dateLabel: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
  }
}

/** Meeting wall-clock time label, e.g. "9:30 AM". meeting_date is stored with the
 *  wall-clock time read as UTC (the app-wide convention, see v_planning_events),
 *  so we format from the UTC parts — NOT a timezone conversion. */
function timeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  let h = d.getUTCHours()
  const m = d.getUTCMinutes()
  const ampm = h >= 12 ? "PM" : "AM"
  h = h % 12
  if (h === 0) h = 12
  const mm = m < 10 ? `0${m}` : String(m)
  return `${h}:${mm} ${ampm}`
}

/** Compact date range across meeting_day strings, e.g. "Jul 27" or "Jul 27–Jul 29". */
function dateRange(dayNums: number[]): string {
  if (dayNums.length === 0) return "—"
  const min = Math.min(...dayNums)
  const max = Math.max(...dayNums)
  const a = labelForDayNum(min).dateLabel
  if (min === max) return a
  return `${a}–${labelForDayNum(max).dateLabel}`
}

export async function loadWeekAheadData(now: Date = new Date()): Promise<{
  data: WeekAheadData | null
  error: string | null
}> {
  const sb = getSupabaseServer()
  const { startNum, endNum } = computeWindow(now)

  // v_planning_events is one row per Confirmed meeting of an upcoming event
  // (comfortably under the PostgREST 1,000-row cap). Fetch all, then keep only
  // meetings whose day falls inside the Mon–Fri window.
  const { data, error } = await sb.from("v_planning_events").select("*")
  if (error) return { data: null, error: error.message }

  const allRows = (data ?? []) as PlanningEventRow[]
  const inWindow = allRows.filter((r) => {
    if (!r.meeting_day) return false
    const dn = dayNumFromYMD(r.meeting_day)
    return dn >= startNum && dn <= endNum
  })

  // ---- per-meeting city lookup (Location column display only) ---------------
  // v_planning_events carries no city, so — exactly like Live Outreach — pull it
  // from public.meetings for just the in-window meetings: the city NAME lives
  // only inside the raw Dynamics blob under _bcs_city_value's FormattedValue.
  // NB the in-office flag comes from hosted_in_hq (bcs_HostedinHQ), NOT the city
  // — the city is used only to label the Event Summary's Location column.
  // Fails soft — any error just leaves the city blank.
  const ids = Array.from(new Set(inWindow.map((r) => r.meeting_id).filter(Boolean)))
  const cityById = new Map<string, string | null>()
  if (ids.length > 0) {
    const { data: locRows } = await sb
      .from("meetings")
      .select('meeting_id,city:_raw->>"_bcs_city_value@OData.Community.Display.V1.FormattedValue"')
      .in("meeting_id", ids)
    for (const row of locRows ?? []) {
      cityById.set(row.meeting_id as string, (row.city as string | null) || null)
    }
  }

  // ---- build enriched meetings ---------------------------------------------
  const meetings: WeekAheadMeeting[] = inWindow.map((r) => {
    const city = cityById.get(r.meeting_id) ?? null
    const isLive = r.is_in_person === true
    const sortMs = Date.parse(r.meeting_date)
    return {
      meeting_id: r.meeting_id,
      dayNum: dayNumFromYMD(r.meeting_day),
      meeting_day: r.meeting_day,
      timeLabel: timeLabel(r.meeting_date),
      sortMs: Number.isNaN(sortMs) ? 0 : sortMs,
      ticker: r.client_ticker ? baseTicker(r.client_ticker) : null,
      clientName: r.client_account_name,
      eventName: r.event_name,
      institution: r.institution_name,
      investor: r.investor_text,
      isLive,
      host: r.host_name,
      city,
      // Authoritative office flag from Dynamics bcs_HostedinHQ (mirrored to
      // v_planning_events). No more Live-plus-city guessing.
      isNyOffice: r.hosted_in_hq === true,
    }
  })

  // Chronological order (by exact time, then ticker for a stable tiebreak).
  meetings.sort((a, b) => {
    if (a.sortMs !== b.sortMs) return a.sortMs - b.sortMs
    return (a.ticker ?? "").localeCompare(b.ticker ?? "")
  })

  // ---- per-day rollup (Mon…Fri, always WINDOW_LENGTH_DAYS cells) -------------
  const days: WeekAheadDay[] = []
  for (let dn = startNum; dn <= endNum; dn++) {
    const dayMeetings = meetings.filter((m) => m.dayNum === dn)
    const tickers: string[] = []
    const nyTickers: string[] = []
    let nyCount = 0
    for (const m of dayMeetings) {
      if (m.ticker && !tickers.includes(m.ticker)) tickers.push(m.ticker)
      if (m.isNyOffice) {
        nyCount++
        if (m.ticker && !nyTickers.includes(m.ticker)) nyTickers.push(m.ticker)
      }
    }
    const { weekdayShort, dateLabel } = labelForDayNum(dn)
    days.push({
      dayNum: dn,
      weekdayShort,
      dateLabel,
      meetings: dayMeetings,
      count: dayMeetings.length,
      tickers,
      nyOffice: nyCount > 0,
      nyCount,
      nyTickers,
    })
  }

  // ---- per-client/event rollup ---------------------------------------------
  const eventMap = new Map<string, WeekAheadMeeting[]>()
  for (const m of meetings) {
    // Group key: event_id when present; otherwise fall back to the meeting id so a
    // meeting with no event still forms its own summary row. (v_planning_events
    // rows always have event_id, so this is just belt-and-suspenders.)
    const key = (inWindow.find((r) => r.meeting_id === m.meeting_id)?.event_id) || m.meeting_id
    const arr = eventMap.get(key)
    if (arr) arr.push(m)
    else eventMap.set(key, [m])
  }

  const events: WeekAheadEvent[] = Array.from(eventMap.entries()).map(([event_id, ms]) => {
    const hasLive = ms.some((m) => m.isLive)
    const hasVirtual = ms.some((m) => !m.isLive)
    const type: WeekAheadEvent["type"] = hasLive && hasVirtual ? "Hybrid" : hasLive ? "Live" : "Virtual"
    const isNyOffice = ms.some((m) => m.isNyOffice)
    // Location: in-office wins; else distinct live-meeting cities; else Virtual.
    let location: string
    if (isNyOffice) {
      location = "New York (office)"
    } else if (hasLive) {
      const cities = Array.from(new Set(ms.filter((m) => m.isLive && m.city).map((m) => m.city as string)))
      location = cities.length ? cities.join(", ") : "In person"
    } else {
      location = "Virtual"
    }
    return {
      event_id,
      ticker: ms[0].ticker,
      clientName: ms[0].clientName,
      eventName: ms[0].eventName,
      count: ms.length,
      dateRange: dateRange(ms.map((m) => m.dayNum)),
      type,
      location,
      isNyOffice,
      firstMs: Math.min(...ms.map((m) => m.sortMs)),
    }
  })
  // Earliest meeting first; ticker as a stable tiebreak.
  events.sort((a, b) => {
    if (a.firstMs !== b.firstMs) return a.firstMs - b.firstMs
    return (a.ticker ?? "").localeCompare(b.ticker ?? "")
  })

  const totalClients = new Set(
    inWindow.map((r) => r.client_account_id).filter(Boolean),
  ).size

  return {
    data: {
      meetings,
      days,
      events,
      startNum,
      endNum,
      totalMeetings: meetings.length,
      totalClients,
    },
    error: null,
  }
}
