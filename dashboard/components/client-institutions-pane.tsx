"use client"

import { format, parseISO } from "date-fns"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { ClientInstitutionRow } from "@/lib/types"

/**
 * The right-side detail pane listing every institution a client has met, behind
 * Portfolio's # Intro / # F/U cells.
 *
 * MODELLED ON components/event-meetings-pane.tsx — same `Sheet` drawer, same
 * `sm:max-w-md` width and slide-in, same three-part header (teal eyebrow, navy
 * title, muted description), same scrolling list body and row rhythm. It is a
 * sibling of that pane rather than a call INTO it because the row shape differs:
 * that one lists individual meetings (institution + investor + one date), this
 * one lists institutions (name + last date + a meeting COUNT). Passing these
 * rows through MarketingEventMeeting would mean faking a meeting_id and dropping
 * the count the panel exists to show. The drawer the user sees is identical.
 *
 * Feed it with `loadInstitutionBreakdownByClient` (lib/client-institutions.ts) so
 * the rows come from the one shared query that reconciles with the columns.
 */

const NAVY_DEEP = "#1E2858"
const TEAL = "#00B8B8"

/** "Mar 4, 26" — the pane's compact date. Slightly longer than the event pane's
 *  "Mar 4" because this list spans YEARS (a client's whole history with an
 *  institution), where that one sits inside a single event's date window. */
function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = parseISO(value)
  return Number.isNaN(d.getTime()) ? "—" : format(d, "MMM d, yy")
}

/** The client the pane is showing, or null when it's closed. */
export type ClientInstitutionsPaneClient = {
  accountId: string
  clientName: string
}

export function ClientInstitutionsPane({
  client,
  institutions,
  onClose,
}: {
  client: ClientInstitutionsPaneClient | null
  /** That client's institutions. Already A→Z from the loader; not re-sorted. */
  institutions: ClientInstitutionRow[]
  onClose: () => void
}) {
  const totalMeetings = institutions.reduce((n, i) => n + i.meeting_count, 0)

  return (
    <Sheet
      open={client !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="gap-1 border-b p-4 pr-12">
          <div
            className="text-[11px] font-medium uppercase tracking-wide"
            style={{ color: TEAL }}
          >
            Institutions Met
          </div>
          <SheetTitle className="text-base" style={{ color: NAVY_DEEP }}>
            {client?.clientName ?? "Client"}
          </SheetTitle>
          {/* The reconciliation, stated: the institution count IS # Intro (one
              intro per institution) and the meeting total IS # Intro + # F/U, so
              the reader can tie the panel back to the cell they clicked. */}
          <SheetDescription>
            {client
              ? `${institutions.length.toLocaleString()} institution${institutions.length === 1 ? "" : "s"} · ${totalMeetings.toLocaleString()} confirmed meeting${totalMeetings === 1 ? "" : "s"}, all-time`
              : null}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-2">
          {institutions.length === 0 ? (
            <div className="px-2 py-10 text-center text-sm text-muted-foreground">
              No confirmed meetings for this client.
            </div>
          ) : (
            <>
              {/* Column captions — this list has three values per row, unlike
                  the event pane's two, so the two numeric ones are labelled. */}
              <div className="flex items-baseline gap-3 px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className="min-w-0 flex-1">Institution</span>
                <span className="w-16 shrink-0 text-right">Last</span>
                <span className="w-8 shrink-0 text-right">Mtgs</span>
              </div>
              <ul>
                {institutions.map((i) => (
                  <li key={i.institution_name}>
                    <div className="flex items-baseline gap-3 rounded-md px-2 py-2">
                      <div
                        className="min-w-0 flex-1 truncate text-sm font-medium"
                        style={{ color: NAVY_DEEP }}
                        title={i.institution_name}
                      >
                        {i.institution_name}
                      </div>
                      <span className="w-16 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                        {formatShortDate(i.last_meeting_date)}
                      </span>
                      <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums">
                        {i.meeting_count}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
