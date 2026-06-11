import * as React from "react"
import {
  HERO_GRADIENT,
  HERO_OVERLAY,
  PILL_VARIANTS,
  type PillVariant,
} from "@/lib/gradients"

/** Translucent rounded status pill, tuned to read on the dark hero gradient. */
export function StatusPill({
  label,
  variant,
}: {
  label: string
  variant: PillVariant
}) {
  const v = PILL_VARIANTS[variant]
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium"
      style={{
        padding: "3px 10px",
        fontSize: 11.5,
        background: v.bg,
        border: `1px solid ${v.border}`,
        color: v.text,
      }}
    >
      {label}
    </span>
  )
}

/**
 * Reusable gradient banner header.
 *
 * Renders a title + subtitle on a navy→teal gradient with soft radial blooms.
 * Optional left monogram tile, an optional status pill next to the title, and
 * an optional right-side slot for controls (restyle those controls translucent
 * so they sit on the gradient).
 */
export function GradientHero({
  title,
  subtitle,
  monogram,
  status,
  rightSlot,
}: {
  title: string
  subtitle: React.ReactNode
  monogram?: string
  status?: { label: string; variant: PillVariant }
  rightSlot?: React.ReactNode
}) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: HERO_GRADIENT,
        borderRadius: 18,
        boxShadow: "0 10px 30px rgba(10,31,92,0.16)",
      }}
    >
      {/* Depth overlay — soft radial blooms behind the content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ background: HERO_OVERLAY }}
      />

      <div
        className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
        style={{ padding: 24 }}
      >
        <div className="flex min-w-0 items-center gap-3">
          {monogram && (
            <div
              className="flex shrink-0 items-center justify-center whitespace-nowrap font-semibold text-white"
              style={{
                height: 42,
                minWidth: 42,
                padding: "0 12px",
                borderRadius: 12,
                fontSize: 13.5,
                letterSpacing: "0.02em",
                background: "rgba(255,255,255,0.16)",
                border: "1px solid rgba(255,255,255,0.25)",
              }}
            >
              {monogram}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1
                className="truncate font-semibold text-white"
                style={{ fontSize: 25, lineHeight: 1.15 }}
              >
                {title}
              </h1>
              {status && (
                <StatusPill label={status.label} variant={status.variant} />
              )}
            </div>
            <p
              className="mt-1"
              style={{ color: "rgba(255,255,255,0.74)", fontSize: 12.5 }}
            >
              {subtitle}
            </p>
          </div>
        </div>

        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </div>
  )
}
