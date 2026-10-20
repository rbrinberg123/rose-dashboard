"use client"

import * as React from "react"
import { useRouter } from "next/navigation"

import {
  loadProfileMeetingRecord,
  loadProfileStageOptions,
  updateMeetingProfileStage,
} from "@/app/meetings/actions"
import { MeetingRecordPane } from "@/app/meetings/meeting-record-pane"
import type { MeetingRecord } from "@/lib/meeting-record"
import { nextProfileStage, type ChoiceOption } from "@/lib/meetings/create"
import { PROFILE_STAGE, PROFILE_STAGE_FALLBACK } from "@/lib/design"

/**
 * The meeting drawer, hosted on the Profiles board — the SAME MeetingRecordPane
 * the CRM Meetings page uses (see my-dashboard/meeting-drawer.tsx for the
 * twin). A card click opens its meeting via loadProfileMeetingRecord, which
 * re-checks the board's own access + meeting scope server-side.
 *
 * PROFILE STAGE: a prominent badge above the record (every meeting), plus a
 * picker and a one-click "Mark <next> →" advance (PROFILE_ADVANCE_ORDER) shown
 * only when the meeting is dashboard-origin AND the viewer can edit meetings
 * (loadProfileStageOptions refuses otherwise). Both save the same way. Dynamics meetings stay read-only until cutover — the
 * pane's RecordEditBar says so. updateMeetingProfileStage enforces all of it
 * again server-side (Edit level, row scope, origin fence, audit).
 */

const OpenProfileMeetingContext = React.createContext<((meetingId: string) => void) | null>(null)

export function useOpenProfileMeeting() {
  return React.useContext(OpenProfileMeetingContext)
}

export function ProfileMeetingDrawerHost({
  eventNames,
  children,
}: {
  /** meeting_id → event name, from the board's rows (not on public.meetings). */
  eventNames: Map<string, string | null>
  children: React.ReactNode
}) {
  const router = useRouter()
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<MeetingRecord | null>(null)
  const [recordError, setRecordError] = React.useState<string | null>(null)
  // null = not loaded / not permitted → no picker.
  const [stages, setStages] = React.useState<ChoiceOption[] | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [reload, setReload] = React.useState(0)

  const openRecord = React.useCallback((id: string) => {
    setRecord(null)
    setRecordError(null)
    setSaveError(null)
    setOpenId(id)
  }, [])
  const closeRecord = React.useCallback(() => {
    setRecord(null)
    setRecordError(null)
    setSaveError(null)
    setOpenId(null)
  }, [])

  // The effect owns only the async fetch — every setState is in a callback.
  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadProfileMeetingRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setRecordError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId, reload])

  // Stage choices: fetched once, the first time a dashboard meeting opens.
  const needStages = record?.origin === "dashboard" && stages === null
  React.useEffect(() => {
    if (!needStages) return
    let cancelled = false
    loadProfileStageOptions().then((res) => {
      if (!cancelled && res.ok) setStages(res.data ?? [])
    })
    return () => {
      cancelled = true
    }
  }, [needStages])

  const current = record && stages ? stages.find((s) => s.label === record.profile) ?? null : null

  async function changeStage(code: number) {
    if (!openId) return
    setSaving(true)
    setSaveError(null)
    const res = await updateMeetingProfileStage(openId, code)
    setSaving(false)
    if (!res.ok) {
      setSaveError(res.error)
      return
    }
    router.refresh()
    setReload((n) => n + 1)
  }

  const editable = record?.origin === "dashboard" && !!stages && stages.length > 0
  // One-click advance: the next stage in PROFILE_ADVANCE_ORDER, if it is a real
  // option. Hidden at Sent, on Not Needed, or when the viewer can't edit.
  const nextLabel = nextProfileStage(record?.profile)
  const next = editable && nextLabel ? (stages!.find((s) => s.label.trim() === nextLabel) ?? null) : null
  // Prominent badge: the stage's own dark palette colour as a SOLID fill with
  // white text — readable on the light and dark drawer alike.
  const stageLabel = record?.profile?.trim() || null
  const badgeBg = stageLabel ? (PROFILE_STAGE[stageLabel] ?? PROFILE_STAGE_FALLBACK).text : "#5B6472"

  const picker = record ? (
    <div className="mb-4 rounded-md border border-[#EDEFF3] bg-[#F7F8FA] p-3 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]">
          Profile stage
        </span>
        <span
          className="rounded-full px-3 py-1 text-sm font-semibold leading-none text-white shadow-sm"
          style={{ backgroundColor: badgeBg }}
        >
          {stageLabel ?? "Not set"}
        </span>
      </div>
      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor="profile-stage" className="sr-only">
            Change profile stage
          </label>
          <select
            id="profile-stage"
            value={current?.code ?? ""}
            disabled={saving}
            onChange={(e) => {
              if (e.target.value !== "") void changeStage(Number(e.target.value))
            }}
            className="h-8 w-auto min-w-0 max-w-[220px] rounded-md border border-input bg-background px-2.5 text-[13px] disabled:opacity-60"
          >
            {!current && <option value="">—</option>}
            {stages!.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
          {next && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void changeStage(next.code)}
              className="h-8 shrink-0 cursor-pointer rounded-md bg-[#1E2858] px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-[#0355A7] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Mark {next.label} →
            </button>
          )}
        </div>
      )}
      {saving && <div className="mt-1 text-[11px] text-muted-foreground">Saving…</div>}
      {saveError && <div className="mt-1 text-[11px] text-destructive">{saveError}</div>}
    </div>
  ) : null

  return (
    <OpenProfileMeetingContext.Provider value={openRecord}>
      {children}
      <MeetingRecordPane
        record={record}
        loading={openId !== null && record === null && recordError === null}
        error={recordError}
        eventName={openId ? (eventNames.get(openId) ?? null) : null}
        crmBase={null}
        onClose={closeRecord}
        topSlot={picker}
      />
    </OpenProfileMeetingContext.Provider>
  )
}
