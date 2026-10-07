"use client"

/** Activity tab — a readable log of who changed what and when (ep_activity_log). */

import * as React from "react"
import { History, Loader2, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { CARD_CLASS, TEXT_MUTED } from "@/lib/design"
import { useBuilder } from "./builder-context"
import { listActivity, type ActivityRow } from "./builder-actions"

const WHEN = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))

/** One plain-English line per entry. */
function describe(a: ActivityRow): string {
  const d = a.details ?? {}
  const dry = d.dry_run ? " (dry run)" : ""
  switch (a.action) {
    case "created":
      return `Created the itinerary${d.crm_event_name ? ` from CRM event “${str(d.crm_event_name)}”` : ""} — ${str(d.days)} days, ${str(d.meetings_imported)} meetings imported`
    case "settings_updated":
      return "Changed the itinerary settings"
    case "day_added":
      return `Added ${str(d.date)}${d.city ? ` (${str(d.city)})` : ""}`
    case "day_updated":
      return `Edited ${str(d.date)}${d.items_retimed ? ` — ${str(d.items_retimed)} items kept their clock time in the new zone` : ""}`
    case "day_removed":
      return `Removed ${str(d.date)}`
    case "item_added":
      return `Added “${str(d.title)}”`
    case "item_updated":
      return `Edited “${str(d.title)}”`
    case "item_deleted":
      return `Deleted “${str(d.title)}”`
    case "item_duplicated":
      return `Duplicated “${str(d.from)}”`
    case "item_status":
      return `Marked “${str(d.title)}” ${str(d.to)}`
    case "items_shifted":
      return `Shifted ${str(d.count)} items on ${str(d.date)} by ${str(d.minutes)} min`
    case "travelling_party_assigned":
      return `Put the travelling party (${str(d.people)}) on ${str(d.items)} items`
    case "attendees_added":
      return `Added ${Array.isArray(d.names) ? (d.names as string[]).join(", ") : "attendees"}`
    case "attendee_updated":
      return `Edited ${str(d.name)}`
    case "attendee_removed":
      return `Removed ${str(d.name)}`
    case "block_added":
      return `Added availability block “${str(d.label)}”`
    case "block_updated":
      return `Edited availability block “${str(d.label)}”`
    case "block_removed":
      return `Deleted availability block “${str(d.label)}”`
    case "finalized":
      return `Finalised version ${str(d.version)}${Array.isArray(d.warnings_acknowledged) && d.warnings_acknowledged.length ? ` (${d.warnings_acknowledged.length} warnings acknowledged)` : ""}`
    case "returned_to_review":
      return "Edited after finalising — back in review"
    case "pdf_generated":
      return `Generated a ${str(d.audience)} PDF (v${str(d.version)})`
    case "invite_sent":
      return `Invite sent to ${str(d.attendee)} for “${str(d.item)}”${dry}`
    case "invite_updated":
      return `Update sent to ${str(d.attendee)} for “${str(d.item)}”${dry}`
    case "invite_cancelled":
      return `Cancellation sent to ${str(d.attendee)} for “${str(d.item)}”${dry}`
    case "invite_failed":
      return `Invite to ${str(d.attendee)} for “${str(d.item)}” failed: ${str(d.error)}`
    default:
      return a.action.replace(/_/g, " ")
  }
}

export function ActivityTab() {
  const { itin } = useBuilder()
  const [rows, setRows] = React.useState<ActivityRow[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(() => {
    listActivity(itin.id).then((r) => (r.ok ? setRows(r.data) : setError(r.error)))
  }, [itin.id])
  React.useEffect(() => {
    load()
  }, [load])

  return (
    <div className={`${CARD_CLASS} p-4`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-semibold">Activity</div>
        <Button variant="ghost" size="sm" onClick={load}>
          <RefreshCw className="size-4" /> Refresh
        </Button>
      </div>
      {error ? (
        <div className="text-sm text-destructive">{error}</div>
      ) : rows == null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
          <History className="size-6" /> No activity yet.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((a) => (
            <li key={a.id} className="flex gap-3 py-2 text-sm">
              <span className="w-32 shrink-0 text-xs tabular-nums" style={{ color: TEXT_MUTED }}>
                {WHEN.format(new Date(a.created_at))}
              </span>
              <span className="w-36 shrink-0 truncate text-xs font-medium">{a.actor_name ?? "—"}</span>
              <span className="min-w-0 flex-1">{describe(a)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
