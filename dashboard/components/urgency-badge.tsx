import { cn } from "@/lib/utils"

/**
 * Renewal urgency, mapped to color per the spec:
 *   overdue → red    (renewal date in the past)
 *   urgent  → amber  (< 30 days)
 *   soon    → yellow (< 90 days)
 *   future  → grey   (≥ 90 days)
 *
 * Uses rose- for red and amber- to match the margin-badge palette so colors
 * read consistently across the dashboard.
 */
export type Urgency = "overdue" | "urgent" | "soon" | "future"

const LABEL: Record<Urgency, string> = {
  overdue: "Overdue",
  urgent: "Urgent",
  soon: "Soon",
  future: "Future",
}

const TONE: Record<Urgency, string> = {
  overdue: "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200",
  urgent: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  soon: "bg-yellow-100 text-yellow-900 dark:bg-yellow-900/30 dark:text-yellow-200",
  future: "bg-muted text-muted-foreground",
}

export function UrgencyBadge({ value }: { value: Urgency }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium",
        TONE[value],
      )}
    >
      {LABEL[value]}
    </span>
  )
}
