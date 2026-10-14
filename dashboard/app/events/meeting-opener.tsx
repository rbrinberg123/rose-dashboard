"use client"

import * as React from "react"
import { ExternalLink } from "lucide-react"

import { loadMeetingRecord } from "@/app/meetings/actions"
import { MeetingRecordPane } from "@/app/meetings/meeting-record-pane"
import { EditMeetingDialog } from "@/app/meetings/new-meeting-dialog"
import type { MeetingRecord } from "@/lib/meeting-record"
import { cn } from "@/lib/utils"

/**
 * Click-to-open a meeting from an event's Meetings & Reports panel / read-only
 * list (event drawer + Edit Event dialog). Reuses the Meetings page's own
 * components, so their permission checks and the ORIGIN FENCE apply unchanged:
 *   - origin='dashboard' → EditMeetingDialog (loadMeetingForEdit refuses any
 *     non-dashboard row and re-checks the CRM-writer gate server-side);
 *   - anything else (Dynamics) → the read-only MeetingRecordPane, via
 *     loadMeetingRecord (super user). Its Edit button is RecordEditBar's, so a
 *     Dynamics record shows "read-only until cutover".
 * Both are Radix dialogs/sheets, so they layer over the drawer or the dialog.
 *
 * Render `element` OUTSIDE any clickable row: React bubbles events through
 * portals along the component tree. It also stops `submit` so the meeting
 * form's save can never submit the Edit Event <form> around it.
 */
export function useMeetingOpener({ eventName, onSaved }: { eventName: string | null; onSaved?: () => void }) {
  const [editId, setEditId] = React.useState<string | null>(null)
  const [viewId, setViewId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<{ id: string; record: MeetingRecord | null; error: string | null } | null>(null)

  // The effect owns only the async fetch — every setState is in its callback.
  React.useEffect(() => {
    if (!viewId) return
    let live = true
    loadMeetingRecord(viewId).then((r) => {
      if (live) setView({ id: viewId, record: r.ok ? (r.data ?? null) : null, error: r.ok ? null : r.error })
    })
    return () => {
      live = false
    }
  }, [viewId])

  const open = React.useCallback((meetingId: string, origin: string | null) => {
    if (origin === "dashboard") setEditId(meetingId)
    else setViewId(meetingId)
  }, [])
  const closeView = React.useCallback(() => {
    setViewId(null)
    setView(null)
  }, [])
  const closeEdit = React.useCallback(() => setEditId(null), [])

  const current = view && view.id === viewId ? view : null
  const element = (
    <div className="contents" onSubmit={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <EditMeetingDialog
        id={editId}
        onClose={closeEdit}
        onSaved={() => {
          setEditId(null)
          onSaved?.()
        }}
      />
      <MeetingRecordPane
        record={current?.record ?? null}
        loading={viewId !== null && current === null}
        error={current?.error ?? null}
        eventName={eventName}
        crmBase={null}
        onClose={closeView}
      />
    </div>
  )
  return { open, element }
}

/** Row classes: the whole meeting row is the click target. */
export const MEETING_ROW_CLICKABLE = "cursor-pointer transition-colors hover:bg-[#EEF2F8]"

/**
 * The explicit "open" icon at the end of a meeting row (the row is clickable
 * too). Its own button, so it is focusable / keyboard-operable.
 */
export function OpenMeetingIcon({ origin, onOpen, className }: { origin: string | null; onOpen: () => void; className?: string }) {
  const label = origin === "dashboard" ? "Open meeting (edit)" : "Open meeting (read-only)"
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className={cn(
        "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-[#9AA1AD]",
        "transition-colors hover:bg-white hover:text-[#0355A7] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0355A7]/40",
        className,
      )}
    >
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </button>
  )
}
