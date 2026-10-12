"use client"

import * as React from "react"

import { loadDashboardEventRecord } from "@/app/events/actions"
import { EventRecordPane } from "@/app/events/event-record-pane"
import type { EventRecord } from "@/lib/events/record"

/**
 * The CRM event drawer, hosted on My Dashboard for the Active Marketing card —
 * the SAME EventRecordPane the CRM Events page uses (see meeting-drawer.tsx for
 * the twin). Opens for EVERY viewer through loadDashboardEventRecord, which
 * only returns a Live Outreach event of a client on the viewer's account team
 * (the card's own scope). Read-only here: editing stays on the Events page.
 * `showFeedbackReports` is passed only to super users — that panel's own
 * loader is super-user only.
 */

const OpenEventContext = React.createContext<((eventId: string) => void) | null>(null)

export function EventDrawerHost({ showAdminPanels, children }: { showAdminPanels: boolean; children: React.ReactNode }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<EventRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)

  const openRecord = React.useCallback((id: string) => {
    setRecord(null)
    setRecordError(null)
    setOpenId(id)
  }, [])
  const closeRecord = React.useCallback(() => {
    setRecord(null)
    setRecordError(null)
    setOpenId(null)
  }, [])

  // The effect owns only the async fetch — every setState is in a callback.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadDashboardEventRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  return (
    <OpenEventContext.Provider value={openRecord}>
      {children}
      <EventRecordPane
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        onClose={closeRecord}
        showFeedbackReports={showAdminPanels}
      />
    </OpenEventContext.Provider>
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
