import { cn } from "@/lib/utils"
import { formatPercent } from "@/lib/format"

/**
 * Colored badge for margin %. Bands per the spec:
 *   ≥ 30%   green (healthy)
 *   0–30%   amber (thin but positive)
 *   < 0     red   (losing money)
 *   null    gray  (no revenue → undefined)
 */
export function MarginBadge({ value }: { value: number | null | undefined }) {
  const tone =
    value == null
      ? "bg-muted text-muted-foreground"
      : value >= 0.3
        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
        : value >= 0
          ? "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200"
          : "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200"

  return (
    <span
      className={cn(
        "inline-flex items-center justify-end rounded-md px-2 py-0.5 text-xs font-medium tabular-nums",
        tone,
      )}
    >
      {formatPercent(value ?? null)}
    </span>
  )
}
