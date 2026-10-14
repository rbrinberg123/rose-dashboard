"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import { AddNewButton } from "@/components/crm-add-new"
import { cn } from "@/lib/utils"
import { canAddMeetingFromEvent } from "@/lib/meetings/create"
import { NewMeetingForEventDialog } from "@/app/meetings/new-meeting-dialog"

/**
 * "Add Meeting" on an event — the PROMINENT create action: top-right of the
 * Meetings & Reports panel (event drawer + Edit Event dialog) and the Edit
 * Event dialog's header. It IS the shared CRM primary button, AddNewButton
 * (components/crm-add-new.tsx — the blue→teal RAIL_ACCENT_FILL "+ Add New …"
 * button on every CRM page), just a size smaller. Opens the existing Add New
 * Meeting form with Client + Event locked to this event
 * (NewMeetingForEventDialog).
 *
 * ORIGIN GATE: canAddMeetingFromEvent(origin) — ON for dashboard AND Dynamics
 * events (ADD_MEETING_FROM_EVENT_INCLUDES_DYNAMICS, see lib/meetings/create.ts
 * for why that is safe). The new meeting is always origin='dashboard'.
 * createMeeting applies the same check server-side, so this only decides what
 * is offered.
 */
export function AddMeetingFromEventButton({
  origin,
  eventId,
  eventName,
  clientAccountId,
  location,
  className,
  onAdded,
  variant = "primary",
}: {
  origin: string | null | undefined
  eventId: string
  eventName: string | null
  clientAccountId: string | null
  location: string | null
  /** Wrapper class (e.g. ml-auto to pin it right). */
  className?: string
  /** After a meeting is saved — the caller reloads its meeting lists. */
  onAdded?: () => void
  /**
   * "primary" = the shared AddNewButton (panels). "icon" = a small, quiet "+"
   * for the event drawer's Meetings KPI tile — same action, same pre-fill.
   */
  variant?: "primary" | "icon"
}) {
  const [open, setOpen] = React.useState(false)
  if (!clientAccountId || !canAddMeetingFromEvent(origin)) return null

  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          title="Add meeting"
          aria-label="Add meeting"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex size-5 cursor-pointer items-center justify-center rounded-md border border-[#E4E9F4] bg-white text-[#5B6472]",
            "transition-colors hover:border-[#0355A7] hover:bg-[#0355A7] hover:text-white",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0355A7]/40",
            className,
          )}
        >
          <Plus className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
        </button>
      ) : (
        <span className={className} title="Add a meeting to this event">
          <AddNewButton
            entity="meeting"
            label="Add Meeting"
            // A size down from the page-masthead button.
            className="gap-1 px-2.5 py-1 text-xs [&>svg]:size-3.5"
            onClick={() => setOpen(true)}
          />
        </span>
      )}
      {open && (
        // React bubbles events through the PORTAL along the component tree, so
        // inside the event edit dialog the meeting form's submit would also
        // reach the event <form> and save it. Stop it here.
        <div className="contents" onSubmit={(e) => e.stopPropagation()}>
          <NewMeetingForEventDialog
            event={{ eventId, eventName, clientAccountId, location }}
            onClose={() => setOpen(false)}
            onSaved={onAdded}
          />
        </div>
      )}
    </>
  )
}
