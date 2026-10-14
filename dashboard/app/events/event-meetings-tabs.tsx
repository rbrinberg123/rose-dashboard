"use client"

import * as React from "react"

import { CRM_TEAL, STATUS_PILL_LIGHT, TEXT_MUTED, TEXT_PRIMARY, TEXT_TERTIARY } from "@/lib/design"
import type { EventMeetingRow } from "@/lib/event-meetings"
import { isEligibleMeeting } from "@/lib/feedback-reports/policy"
import { formatMeetingWhen } from "@/lib/meeting-time"
import { cn } from "@/lib/utils"
import { loadEventMeetingsList } from "./actions"
import { FeedbackFlagPill } from "./report-locks"
import { MEETING_ROW_CLICKABLE, OpenMeetingIcon, useMeetingOpener } from "./meeting-opener"

/**
 * The TABS shared by the event drawer (event-record-pane) and the Edit Event
 * form (new-event-dialog): Details · Meetings & Reports · Targeting & Other Prep, plus the
 * event's meeting list that feeds the Meetings & Reports badge and the DYNAMICS
 * READ-ONLY list. Meeting-level feedback lives inside Meetings & Reports (no
 * separate Feedback tab).
 *
 * Dashboard-origin events keep the full combined Meetings & Reports panel
 * (meetings-reports-panel.tsx: report grouping, report line items, feedback
 * chips, split / move / delete). Dynamics-origin events get the flat read-only
 * list below instead — the feedback automation switch
 * (FEEDBACK_AUTOMATION_INCLUDES_DYNAMICS) is deliberately NOT flipped.
 */

export type EventTabKey = "details" | "meetings" | "targeting"

/** The event's meetings (all statuses), reloaded when `reloadKey` changes. */
export function useEventMeetings(eventId: string | null, enabled: boolean, reloadKey = 0) {
  const [state, setState] = React.useState<{
    key: string
    rows: EventMeetingRow[] | null
    error: string | null
  } | null>(null)
  const key = `${eventId}:${reloadKey}`

  // The effect owns only the async fetch — every setState is in its callback.
  React.useEffect(() => {
    if (!eventId || !enabled) return
    let live = true
    loadEventMeetingsList(eventId).then((r) => {
      if (!live) return
      setState({ key, rows: r.ok ? (r.data ?? []) : null, error: r.ok ? null : r.error })
    })
    return () => {
      live = false
    }
  }, [eventId, enabled, key])

  const current = state?.key === key ? state : null
  return { rows: current?.rows ?? null, error: current?.error ?? null }
}

/**
 * The Meetings & Reports badge: the event's non-cancelled, active meetings (the
 * same eligibility as the feedback reports). null until loaded.
 */
export function eventMeetingCount(rows: EventMeetingRow[] | null): number | null {
  if (!rows) return null
  return rows.filter((m) => isEligibleMeeting(m.meeting_status_label, m.state_label)).length
}

/** The tab strip. Badges only render once a count is known. */
export function EventTabBar({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: { key: EventTabKey; label: string; count?: number | null }[]
  active: EventTabKey
  onChange: (k: EventTabKey) => void
  className?: string
}) {
  return (
    <div role="tablist" className={cn("flex gap-1 border-b border-[#E5E8EC]", className)}>
      {tabs.map((t) => {
        const on = t.key === active
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              "-mb-px inline-flex cursor-pointer items-center gap-1.5 border-b-2 px-2.5 py-2 text-[12px] font-medium transition-colors",
              on ? "" : "border-transparent hover:text-[#1A2233]",
            )}
            style={on ? { borderColor: CRM_TEAL, color: CRM_TEAL } : { color: TEXT_MUTED }}
          >
            {t.label}
            {t.count != null && (
              <span
                className="rounded-full px-1.5 text-[10px] font-semibold leading-4 tabular-nums"
                style={
                  on
                    ? { backgroundColor: `color-mix(in srgb, ${CRM_TEAL} 12%, white)`, color: CRM_TEAL }
                    : { backgroundColor: STATUS_PILL_LIGHT.neutral.bg, color: STATUS_PILL_LIGHT.neutral.text }
                }
              >
                {t.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function statusPill(m: EventMeetingRow): { bg: string; text: string; label: string } {
  const label = m.meeting_status_label?.trim() || "—"
  if ((m.state_label ?? "Active") !== "Active") return { ...STATUS_PILL_LIGHT.neutral, label: "Inactive" }
  if (label === "Confirmed") return { ...STATUS_PILL_LIGHT.positive, label }
  if (label === "Cancelled") return { ...STATUS_PILL_LIGHT.atRisk, label }
  return { ...STATUS_PILL_LIGHT.neutral, label }
}

/** Frame of the read-only list — the same look as the Meetings & Reports panel. */
function ListShell({
  title,
  aside,
  action,
  children,
}: {
  title: string
  aside?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-[#E5E8EC] bg-[#FBFCFD]">
      <div className="flex items-center gap-2 border-b border-[#E5E8EC] px-3 py-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: TEXT_MUTED }}>
          {title}
        </h3>
        {aside && <span className="text-[11px]" style={{ color: TEXT_TERTIARY }}>{aside}</span>}
        {action && <span className="ml-auto shrink-0">{action}</span>}
      </div>
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 py-6 text-center text-xs" style={{ color: TEXT_MUTED }}>
      {children}
    </p>
  )
}

/**
 * DYNAMICS-origin events: a flat, READ-ONLY list of every meeting on the event
 * — date + time (midnight-guarded), institution / investor, host / booker,
 * status, and the feedback chip when the meeting's feedback status is set. No
 * report grouping, report line items or stages, and no split / move / delete.
 */
export function EventMeetingsReadOnlyList({
  rows,
  error,
  action,
  eventName = null,
  onChanged,
}: {
  rows: EventMeetingRow[] | null
  error: string | null
  /** Pinned top-right of the header — the Add Meeting button. */
  action?: React.ReactNode
  /** Shown in the read-only meeting record's header. */
  eventName?: string | null
  /** After a (dashboard) meeting is edited from here — reload the list. */
  onChanged?: () => void
}) {
  // Click a row → its Edit Meeting form (dashboard-origin meeting) or the
  // read-only meeting record (Dynamics). The LIST stays read-only.
  const opener = useMeetingOpener({ eventName, onSaved: onChanged })
  const aside = rows ? `${rows.length} meeting${rows.length === 1 ? "" : "s"} · read-only` : "read-only"
  return (
    <ListShell title="Meetings & Reports" aside={aside} action={action}>
      {error ? (
        <p className="px-3 py-3 text-xs text-destructive">{error}</p>
      ) : !rows ? (
        <Empty>Loading…</Empty>
      ) : rows.length === 0 ? (
        <Empty>No meetings on this event yet.</Empty>
      ) : (
        <ul>
          {rows.map((m) => {
            const pill = statusPill(m)
            const people = [m.host_name && `Host ${m.host_name}`, m.booker_name && `Booker ${m.booker_name}`]
              .filter(Boolean)
              .join(" · ")
            return (
              <li
                key={m.meeting_id}
                onClick={() => opener.open(m.meeting_id, m.origin)}
                title={m.origin === "dashboard" ? "Open meeting (edit)" : "Open meeting (read-only)"}
                className={cn(
                  "flex items-start gap-2 border-b border-[#E5E8EC] px-3 py-1.5 text-xs last:border-0",
                  MEETING_ROW_CLICKABLE,
                )}
              >
                <span className="w-[104px] shrink-0 tabular-nums" style={{ color: TEXT_MUTED }}>
                  {formatMeetingWhen(m.meeting_date)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ color: TEXT_PRIMARY }}>
                    {m.institution_name ?? "Meeting"}
                    {m.investor_text && <span style={{ color: TEXT_MUTED }}> · {m.investor_text}</span>}
                  </span>
                  {people && (
                    <span className="block truncate text-[11px]" style={{ color: TEXT_TERTIARY }}>
                      {people}
                    </span>
                  )}
                </span>
                {m.feedback_status_label?.trim() && (
                  <FeedbackFlagPill status={m.feedback_status_label} receivedDate={m.fb_received_date} />
                )}
                <span
                  className="shrink-0 rounded-full px-1.5 text-[10px] font-medium leading-4"
                  style={{ backgroundColor: pill.bg, color: pill.text }}
                >
                  {pill.label}
                </span>
                <OpenMeetingIcon origin={m.origin} onOpen={() => opener.open(m.meeting_id, m.origin)} />
              </li>
            )
          })}
        </ul>
      )}
      {opener.element}
    </ListShell>
  )
}
