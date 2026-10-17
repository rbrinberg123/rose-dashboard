"use client"

import * as React from "react"

import { loadDashboardEventRecord, loadEventRecord } from "@/app/events/actions"
import { EventRecordPane } from "@/app/events/event-record-pane"
import type { EventRecord } from "@/lib/events/record"

/**
 * The CRM event drawer, hosted on My Dashboard for the Active Marketing card —
 * the SAME EventRecordPane the CRM Events page uses (see meeting-drawer.tsx for
 * the twin). Opens for EVERY viewer through loadDashboardEventRecord, which
 * only returns a Live Outreach event of a client on the viewer's account team
 * (the card's own scope). Read-only here: editing stays on the Events page.
 * The Meetings & Reports tab shows for every viewer, read-only (its loaders
 * gate on canViewEvent — this card's scope included). `showFeedbackReports`
 * (super users / admins only) adds the editor controls — clickable meetings.
 */

/**
 * `reportTaskId` (2026-10-17) = the Feedback Reports page's row deep link: open
 * on Meetings & Reports, scrolled to that report. Those opens read through
 * loadEventRecord — the SAME loader and gate (CRM Events page granted) the
 * Feedback Reports page uses — and are only offered when the viewer has it.
 */
type OpenEvent = (eventId: string, opts?: { reportTaskId?: string | null }) => void

const OpenEventContext = React.createContext<OpenEvent | null>(null)

export function EventDrawerHost({ showAdminPanels, children }: { showAdminPanels: boolean; children: React.ReactNode }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [focusReportId, setFocusReportId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<EventRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)

  const openRecord = React.useCallback<OpenEvent>((id, opts) => {
    setRecord(null)
    setRecordError(null)
    setFocusReportId(opts?.reportTaskId ?? null)
    setOpenId(id)
  }, [])
  const closeRecord = React.useCallback(() => {
    setRecord(null)
    setRecordError(null)
    setFocusReportId(null)
    setOpenId(null)
  }, [])

  // The effect owns only the async fetch — every setState is in a callback.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    const load = focusReportId ? loadEventRecord : loadDashboardEventRecord
    load(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId, focusReportId])

  return (
    <OpenEventContext.Provider value={openRecord}>
      {children}
      <EventRecordPane
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        onClose={closeRecord}
        showFeedbackReports={showAdminPanels}
        initialTab={focusReportId ? "meetings" : undefined}
        focusReportId={focusReportId}
      />
    </OpenEventContext.Provider>
  )
}

/**
 * A feedback-report row that opens its EVENT on Meetings & Reports, focused on
 * the report — the Feedback Reports page's row behaviour (2026-10-17).
 */
export function OpenEventReportRow({
  eventId,
  reportTaskId,
  children,
}: {
  eventId: string
  reportTaskId: string | null
  children: React.ReactNode
}) {
  const open = React.useContext(OpenEventContext)
  return (
    <button
      type="button"
      onClick={() => open?.(eventId, { reportTaskId })}
      title="Open the event — Meetings & Reports"
      className="block w-full cursor-pointer text-left transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
    >
      {children}
    </button>
  )
}

/** A dashboard row that opens its event in the drawer instead of navigating. */
export function OpenEventRow({ eventId, children }: { eventId: string; children: React.ReactNode }) {
  const open = React.useContext(OpenEventContext)
  return (
    <button
      type="button"
      onClick={() => open?.(eventId)}
      className="block w-full cursor-pointer text-left transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
    >
      {children}
    </button>
  )
}
