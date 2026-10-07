import { STATUS_PILL_LIGHT } from "@/lib/design"
import { ITINERARY_STATUSES, type ItineraryStatus } from "@/lib/events-planner/types"

/** Itinerary status → the app's light status-pill tints (IQ palette). */
const VARIANT: Record<ItineraryStatus, keyof typeof STATUS_PILL_LIGHT> = {
  draft: "neutral",
  in_review: "watch",
  finalized: "new",
  invites_sent: "positive",
  archived: "neutral",
}

export function ItineraryStatusPill({ status }: { status: ItineraryStatus }) {
  const v = STATUS_PILL_LIGHT[VARIANT[status] ?? "neutral"]
  const label = ITINERARY_STATUSES.find((s) => s.value === status)?.label ?? status
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium"
      style={{ padding: "2px 9px", fontSize: 11.5, background: v.bg, color: v.text }}
    >
      {label}
    </span>
  )
}
