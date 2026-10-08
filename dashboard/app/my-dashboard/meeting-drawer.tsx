"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { loadHostedMeetingRecord } from "@/app/meetings/actions"
import type { MeetingRecord } from "@/lib/meeting-record"
import { MeetingRecordPane } from "@/app/meetings/meeting-record-pane"
import { EditMeetingDialog } from "@/app/meetings/new-meeting-dialog"

/**
 * The CRM meeting drawer, hosted on My Dashboard — the SAME MeetingRecordPane +
 * EditMeetingDialog the CRM Meetings page uses, wired the same way (see
 * task-drawer.tsx for the twin). Opens for EVERY viewer, through
 * loadHostedMeetingRecord — which only returns a meeting the viewer hosts (the
 * Hosting card's own scope). Edit stays super-user only (canEdit), and is
 * offered for dashboard-origin meetings only, refused server-side otherwise.
 */

const OpenMeetingContext = React.createContext<((meetingId: string) => void) | null>(null)

export function MeetingDrawerHost({
  crmBase,
  canEdit,
  children,
}: {
  crmBase: string
  /** Edit is offered only to viewers who can open CRM → Meetings. */
  canEdit: boolean
  children: React.ReactNode
}) {
  const router = useRouter()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<MeetingRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)
  const [editId, setEditId] = React.useState<string | null>(null)

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
  const afterEdit = React.useCallback(
    (id: string) => {
      closeRecord()
      router.refresh()
      setTimeout(() => openRecord(id), 0)
    },
    [closeRecord, openRecord, router],
  )

  // The effect owns only the async fetch — every setState is in a callback.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadHostedMeetingRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  return (
    <OpenMeetingContext.Provider value={openRecord}>
      {children}
      <MeetingRecordPane
        onEdit={openId && canEdit ? () => setEditId(openId) : undefined}
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        eventName={null}
        crmBase={crmBase}
        onClose={closeRecord}
      />
      <EditMeetingDialog id={editId} onClose={() => setEditId(null)} onSaved={afterEdit} />
    </OpenMeetingContext.Provider>
  )
}

/** A dashboard row that opens its meeting in the drawer instead of navigating. */
export function OpenMeetingRow({ meetingId, children }: { meetingId: string; children: React.ReactNode }) {
  const open = React.useContext(OpenMeetingContext)
  return (
    <button
      type="button"
      onClick={() => open?.(meetingId)}
      className="block w-full cursor-pointer text-left transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
    >
      {children}
    </button>
  )
}
