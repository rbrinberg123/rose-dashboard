"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import { loadTaskRecord } from "@/app/tasks/actions"
import type { TaskRecord } from "@/lib/tasks/record"
import { TaskRecordPane } from "@/app/tasks/task-record-pane"
import { EditTaskDialog } from "@/app/tasks/new-task-dialog"

/**
 * The CRM task drawer, hosted on My Dashboard. It is the SAME TaskRecordPane +
 * EditTaskDialog the CRM Tasks page uses, wired the same way, so every rule is
 * the existing one, unchanged:
 *   - loadTaskRecord is super-user only (the page only offers the drawer when
 *     the viewer can open CRM → Tasks);
 *   - the drawer offers Edit ONLY for origin = 'dashboard' tasks (RecordEditBar),
 *     and the edit / complete is refused server-side for anything else
 *     (updateDashboardRow) — Dynamics tasks open read-only until cutover.
 * "Close out" = Edit → Status: Completed, the drawer's existing workflow.
 * After a save the dashboard re-renders (router.refresh), so a completed task
 * drops off Open Tasks / My To-Do, and the drawer reopens on the record.
 */

const OpenTaskContext = React.createContext<((taskId: string) => void) | null>(null)

export function TaskDrawerHost({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<TaskRecord | null>(null)
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
    loadTaskRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  return (
    <OpenTaskContext.Provider value={openRecord}>
      {children}
      <TaskRecordPane
        onEdit={openId ? () => setEditId(openId) : undefined}
        onClosed={openId ? () => afterEdit(openId) : undefined}
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        onClose={closeRecord}
      />
      <EditTaskDialog id={editId} onClose={() => setEditId(null)} onSaved={afterEdit} />
    </OpenTaskContext.Provider>
  )
}

/** A dashboard row that opens its task in the drawer instead of navigating. */
/**
 * The nearest TaskDrawerHost's opener — for callers that render their own
 * trigger (e.g. the Feedback Reports row shortcut). null outside a host.
 */
export function useOpenTask(): ((taskId: string) => void) | null {
  return React.useContext(OpenTaskContext)
}

export function OpenTaskRow({ taskId, children }: { taskId: string; children: React.ReactNode }) {
  const open = React.useContext(OpenTaskContext)
  return (
    <button
      type="button"
      onClick={() => open?.(taskId)}
      className="block w-full cursor-pointer text-left transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
    >
      {children}
    </button>
  )
}
