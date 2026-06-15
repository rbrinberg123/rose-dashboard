import * as React from "react"
import type { StatGradient } from "@/lib/gradients"
import { KPI_CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"

/**
 * KPI card. Two looks:
 *
 * - Default (legacy): white card, hairline border, a 3px gradient top edge that
 *   encodes the metric, subtle hover lift. Unchanged so existing pages render
 *   exactly as before.
 * - `floating`: the new light-and-airy surface — soft layered shadow, hover
 *   lift, NO gradient top-edge (depth comes from the shadow). Optional small
 *   `sparkline` slot renders under the number.
 */
export function StatCard({
  label,
  value,
  hint,
  valueColor,
  valueSize,
  gradient,
  floating = false,
  sparkline,
}: {
  label: React.ReactNode
  value: React.ReactNode
  hint?: React.ReactNode
  valueColor?: string
  /** Number font size in px. Defaults to 25 (legacy) / 24 (floating). */
  valueSize?: number
  /** Required for the legacy look; ignored when `floating`. */
  gradient?: StatGradient
  /** Opt into the new floating surface. */
  floating?: boolean
  /** Optional sparkline / trend node, shown under the number (floating only). */
  sparkline?: React.ReactNode
}) {
  if (floating) {
    return (
      <div className={`relative overflow-hidden p-4 ${KPI_CARD_CLASS}`}>
        <div
          className="font-semibold leading-tight tracking-tight tabular-nums"
          style={{
            fontSize: valueSize ?? 24,
            color: valueColor ?? TEXT_PRIMARY,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </div>
        {sparkline != null && <div className="mt-1.5">{sparkline}</div>}
        <div className="mt-1 text-[11.5px]" style={{ color: TEXT_MUTED }}>
          {label}
        </div>
        {hint != null && (
          <div className="mt-0.5 text-[11px]" style={{ color: TEXT_MUTED }}>
            {hint}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      className="relative overflow-hidden rounded-[13px] bg-card p-3.5"
      style={{ border: "0.5px solid var(--border)" }}
    >
      {/* Gradient top edge */}
      {gradient && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0"
          style={{
            height: 3,
            background: `linear-gradient(90deg, ${gradient[0]}, ${gradient[1]})`,
          }}
        />
      )}
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
