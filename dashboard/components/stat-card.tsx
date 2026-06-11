import * as React from "react"
import type { StatGradient } from "@/lib/gradients"

/**
 * KPI card with a 3px gradient top edge that encodes the metric.
 *
 * White card, hairline border, rounded, with a subtle hover lift. The gradient
 * pair is a prop so the same card is reusable across metrics and pages.
 */
export function StatCard({
  label,
  value,
  hint,
  valueColor,
  valueSize,
  gradient,
}: {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  valueColor?: string
  /** Number font size in px. Defaults to 25 (Client Detail KPI strip). */
  valueSize?: number
  gradient: StatGradient
}) {
  return (
    <div
      className="relative overflow-hidden rounded-[13px] bg-card p-3.5 transition duration-150 hover:-translate-y-[2px] hover:shadow-[0_8px_20px_rgba(10,31,92,0.12)]"
      style={{ border: "0.5px solid var(--border)" }}
    >
      {/* Gradient top edge */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0"
        style={{
          height: 3,
          background: `linear-gradient(90deg, ${gradient[0]}, ${gradient[1]})`,
        }}
      />
      <div
        className="font-semibold leading-tight tracking-tight tabular-nums"
        style={{
          fontSize: valueSize ?? 25,
          color: valueColor ?? "#1E2858",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
      {hint != null && (
        <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
      )}
    </div>
  )
}
