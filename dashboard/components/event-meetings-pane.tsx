"use client"

import { format, parseISO } from "date-fns"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { MarketingEventMeeting } from "@/lib/types"

/**
 * The right-side detail pane listing one marketing event's CONFIRMED meetings.
 *
 * Extracted verbatim from the Client Detail "Marketing Events & Dates" block so
 * every page that drills into an event gets the identical drawer — same width,
 * slide-in, header, and close affordance as the Investor Reach Depth pane it was
 * originally modelled on. Used by:
 *   - app/client-detail/client-detail-view.tsx (Marketing Events & Dates)
 *   - app/clients/to-do/todo-table.tsx         (Current & Upcoming Event cluster)
 *
 * Feed it with `loadConfirmedMeetingsByEvent` (lib/event-meetings.ts) so the
 * rows come from the one shared query too.
 */

const NAVY_DEEP = "#1E2858"
const TEAL = "#00B8B8"

/** "Mar 4" — the pane's own compact date, matching the original drawer. */
function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d")
}

/**
 * The event the pane is showing, or null when it's closed. `dateSpan` is passed
 * pre-formatted because each page already formats its own event window (Client
 * Detail from Eastern day strings, To-Do from the view's day columns).
 */
export type EventMeetingsPaneEvent = {
  eventId: string
  eventName: string
  dateSpan: string
}

export function EventMeetingsPane({
  event,
  meetings,
  onClose,
}: {
  event: EventMeetingsPaneEvent | null
  /** That event's confirmed meetings, in any order — sorted here. */
  meetings: MarketingEventMeeting[]
  onClose: () => void
}) {
  // Sorted in the pane so both callers get the same order (date ascending, a
  // missing date last) without each having to remember to do it.
  const sorted = [...meetings].sort((a, b) =>
    (a.meeting_date ?? "").localeCompare(b.meeting_date ?? ""),
  )

  return (
    <Sheet
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <div
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: TEAL }}
          >
            Marketing Event
          </div>
          <SheetTitle className="text-base" style={{ color: NAVY_DEEP }}>
            {event?.eventName ?? "Event"}
          </SheetTitle>
          <SheetDescription>
            {event
              ? `${event.dateSpan} · ${sorted.length.toLocaleString()} confirmed meeting${sorted.length === 1 ? "" : "s"}`
              : null}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-2">
          {sorted.length === 0 ? (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">
              No confirmed meetings for this event.
            </div>
          ) : (
            <ul>
              {sorted.map((m) => (
                <li key={m.meeting_id}>
                  <div className="flex items-baseline justify-between gap-3 rounded-md px-2 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-[#1E2858]">
                        {m.institution_name ?? "—"}
                      </div>
                      {m.investor_text && (
                        <div className="truncate text-xs text-muted-foreground">
                          {m.investor_text}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatShortDate(m.meeting_date)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
