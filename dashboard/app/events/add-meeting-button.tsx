"use client"

import * as React from "react"
import { CalendarPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { canAddMeetingFromEvent } from "@/lib/meetings/create"
import { NewMeetingForEventDialog } from "@/app/meetings/new-meeting-dialog"

/**
 * "Add Meeting" on an event — the event drawer header and the event edit
 * dialog. Opens the existing Add New Meeting form with Client + Event locked to
 * this event (NewMeetingForEventDialog).
 *
 * CUTOVER GATE: canAddMeetingFromEvent(origin) — dashboard-origin only until
 * ADD_MEETING_FROM_EVENT_INCLUDES_DYNAMICS flips. A Dynamics event shows the
 * button disabled with an "available at cutover" tooltip. createMeeting applies
 * the same check server-side, so this only decides what is offered.
 */
export function AddMeetingFromEventButton({
  origin,
  eventId,
  eventName,
  clientAccountId,
  location,
  className,
  compact = true,
}: {
  origin: string | null | undefined
  eventId: string
  eventName: string | null
  clientAccountId: string | null
  location: string | null
  /** Wrapper class (e.g. mr-auto in a dialog footer). */
  className?: string
  /** Small header-chip size (drawer); false = normal button (dialog footer). */
  compact?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const allowed = canAddMeetingFromEvent(origin)
  if (!clientAccountId || (!allowed && origin !== "dynamics")) return null

  return (
    <>
      <span className={className} title={allowed ? "Add a meeting to this event" : "Adding meetings to Dynamics events is available at cutover"}>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={compact ? "h-6 px-2 text-[11px]" : undefined}
          disabled={!allowed}
          onClick={() => setOpen(true)}
        >
          <CalendarPlus className={compact ? "size-3" : "size-4"} /> Add Meeting
        </Button>
      </span>
      {open && (
        // React bubbles events through the PORTAL along the component tree, so
        // inside the event edit dialog the meeting form's submit would also
        // reach the event <form> and save it. Stop it here.
        <div className="contents" onSubmit={(e) => e.stopPropagation()}>
          <NewMeetingForEventDialog
            event={{ eventId, eventName, clientAccountId, location }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  )
}
