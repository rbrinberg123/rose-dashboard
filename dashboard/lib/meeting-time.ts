/**
 * A meeting's "when" for the compact event lists (event drawer + Edit Event →
 * Meetings & Reports, the Dynamics read-only list): "Oct 6 · 11:30 AM",
 * Eastern — the same Intl time format the Meetings page uses
 * (app/meetings/meetings-view.tsx EASTERN_TIME). Pure; safe in client code.
 *
 * MIDNIGHT GUARD: meetings.meeting_date is a timestamptz, but a meeting saved
 * with no real time lands on a midnight placeholder — either UTC midnight (a
 * date-only Dynamics value, "…T00:00:00Z") or Eastern midnight (a dashboard
 * date with no time). Neither is a real start time, so both print the DATE
 * ONLY, never a fake "12:00 AM" / "8:00 PM". A UTC-midnight value is read as a
 * UTC day so it does not slip to the previous Eastern day.
 */

const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })
const UTC_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" })
const ET_TIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "numeric",
  minute: "2-digit",
})
const ET_HM = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

/** "Oct 6 · 11:30 AM", or "Oct 6" for a midnight placeholder, or "—". */
export function formatMeetingWhen(iso: string | null | undefined): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "—"
  const utcMidnight =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  if (utcMidnight) return UTC_DAY.format(d)
  // Some ICU builds print "24:00" for midnight in h23 — accept both.
  const hm = ET_HM.format(d)
  if (hm === "00:00" || hm === "24:00") return ET_DAY.format(d)
  return `${ET_DAY.format(d)} · ${ET_TIME.format(d)}`
}
