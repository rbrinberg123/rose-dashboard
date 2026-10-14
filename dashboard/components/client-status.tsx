import * as React from "react"

import {
  CLIENT_STATUS_ORDER,
  CLIENT_STATUS_STYLE,
  NO_RATING_LABEL,
  NO_RATING_STYLE,
  clientStatusLabel,
  clientStatusOf,
  clientStatusStyle,
} from "@/lib/client-status"

/**
 * CLIENT STATUS — the shared pill and its colour key, driven by the EFFECTIVE
 * Client Health rating (`health_rating`; see lib/client-status.ts). Used by
 * Portfolio, Outreach Status, Client Detail and the Client Health page, so
 * every surface shows the same label and colour. Replaces the retired
 * notes-driven components/note-status.tsx.
 */

/**
 * The status pill. A client with no rating shows a muted "No Rating" pill when
 * `showNoRating` is set (Client Health, Client Detail), otherwise an em dash —
 * so dense tables stay quiet.
 */
export function ClientStatusPill({
  rating,
  showNoRating = false,
  className,
}: {
  rating: string | null | undefined
  showNoRating?: boolean
  className?: string
}) {
  if (!clientStatusOf(rating) && !showNoRating) {
    return <span className="text-muted-foreground">—</span>
  }
  const s = clientStatusStyle(rating)
  return (
    <span
      title={`Client Health: ${clientStatusLabel(rating)}`}
      // Styling hook only — lets a page's print CSS reach the pill. Inert on screen.
      data-status-pill=""
      className={
        className ??
        "inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium"
      }
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {clientStatusLabel(rating)}
    </span>
  )
}

/** The colour key for the pills — tiny (9px), inline, in a helper-text row. */
export function ClientStatusLegend({ label = "Status (Client Health):" }: { label?: string }) {
  const chips = [
    ...CLIENT_STATUS_ORDER.map((c) => ({ key: c, text: clientStatusLabel(c), s: CLIENT_STATUS_STYLE[c] })),
    { key: "none", text: NO_RATING_LABEL, s: NO_RATING_STYLE },
  ]
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-semibold text-foreground">{label}</span>
      {chips.map((c) => (
        <span
          key={c.key}
          style={{
            backgroundColor: c.s.bg,
            color: c.s.text,
            padding: "1px 6px",
            borderRadius: "10px",
            fontSize: "9px",
            fontWeight: 500,
          }}
        >
          {c.text}
        </span>
      ))}
    </div>
  )
}
