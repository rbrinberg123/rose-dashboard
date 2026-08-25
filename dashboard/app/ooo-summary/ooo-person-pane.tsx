"use client"

import { format, parseISO } from "date-fns"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { detailsForPerson, type OooRequestDetail } from "@/lib/ooo-summary/compute"

/**
 * The right-side detail pane listing one person's individual OOO requests.
 *
 * Built on the SAME `components/ui/sheet` primitives as
 * `components/event-meetings-pane.tsx` — the drawer used by Client Detail and
 * the To-Do List — and reuses its shell verbatim: identical `SheetContent`
 * width/layout classes, the same bordered header with a teal eyebrow over a
 * navy title, the same scrollable body and close affordance. It is a separate
 * component only because `EventMeetingsPane` is typed to
 * `MarketingEventMeeting` and renders event meetings; the chrome is the same.
 *
 * Fed from `computeOooSummary(...).details`, so every number here is the exact
 * per-request figure the summary table aggregated — the two cannot disagree.
 */

const NAVY_DEEP = "#1E2858"
const TEAL = "#00B8B8"

/** "Mar 4, 2026" — enough to read a span without ambiguity across years. */
function formatDate(value: string): string {
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d, yyyy")
}

/** "Mar 4" for the end of a same-year span, so the row stays compact. */
function formatSpan(start: string, end: string): string {
  if (start === end) return formatDate(start)
  const a = parseISO(start)
  const b = parseISO(end)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${start} – ${end}`
  const endFmt = a.getUTCFullYear() === b.getUTCFullYear() ? "MMM d" : "MMM d, yyyy"
  return `${format(a, "MMM d")} – ${format(b, endFmt)}, ${b.getUTCFullYear()}`
}

/** "2.5 days" / "1 day" / "½ day". */
function formatDays(days: number, isHalf: boolean): string {
  if (days === 0.5) return "½ day"
  const label = `${Number(days.toFixed(1))} day${days === 1 ? "" : "s"}`
  return isHalf ? `${label} (incl. ½)` : label
}

/** Category pill colours — muted, so the dates stay the loudest thing. */
const CATEGORY_STYLE: Record<string, { bg: string; fg: string }> = {
  "Time Off": { bg: "#EEF2FB", fg: "#1E2858" },
  Remote: { bg: "#E6F6F6", fg: "#0E6E75" },
  Sick: { bg: "#FDF0E7", fg: "#9A4E18" },
  "Jury Duty": { bg: "#F1EEFB", fg: "#4B3B8F" },
}

export type OooPanePerson = { personId: string; person: string }

export function OooPersonPane({
  person,
  details,
  onClose,
}: {
  /** The person the pane is showing, or null when it's closed. */
  person: OooPanePerson | null
  /** Every request across everyone — filtered to `person` here. */
  details: readonly OooRequestDetail[]
  onClose: () => void
}) {
  const groups = person ? detailsForPerson(details, person.personId) : []
  const total = groups.reduce((a, g) => a + g.requests.length, 0)

  return (
    <Sheet
      open={person !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: TEAL }}>
            Days Off
          </div>
          <SheetTitle className="text-base" style={{ color: NAVY_DEEP }}>
            {person?.person ?? "Person"}
          </SheetTitle>
          <SheetDescription>
            {person
              ? `${total.toLocaleString()} request${total === 1 ? "" : "s"} · most recent first`
              : null}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-2">
          {total === 0 ? (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">
              No time-off requests on record for this person.
            </div>
          ) : (
            groups.map((group) => (
              <section key={group.year} className="mb-3 last:mb-0">
                <div className="sticky top-0 z-10 bg-white/95 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                  {group.year}
                </div>
                <ul>
                  {group.requests.map((r) => {
                    const style = CATEGORY_STYLE[r.category] ?? CATEGORY_STYLE["Time Off"]
                    return (
                      <li key={r.ooo_id}>
                        <div className="rounded-md px-2 py-2 hover:bg-[#F8FAFC]">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="min-w-0 text-sm font-medium" style={{ color: NAVY_DEEP }}>
                              {formatSpan(r.start_date, r.end_date)}
                            </div>
                            <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                              {formatDays(r.days, r.isHalf)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                              style={{ background: style.bg, color: style.fg }}
                            >
                              {r.category}
                            </span>
                            {r.isHalf ? (
                              <span
                                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                style={{ background: "#FEF6E7", color: "#8A5A00" }}
                                title="The comment indicates a half day, so the last business day counts as ½."
                              >
                                ½ last day
                              </span>
                            ) : null}
                          </div>
                          {r.comment ? (
                            <p className="mt-1 text-xs leading-snug text-muted-foreground">
                              {r.comment}
                            </p>
                          ) : (
                            <p className="mt-1 text-xs italic text-muted-foreground/70">
                              No comment
                            </p>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
