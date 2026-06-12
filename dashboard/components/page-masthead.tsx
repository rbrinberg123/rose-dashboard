import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { PillVariant } from "@/lib/gradients"
import {
  ACCENT_STRIP,
  BADGE_GRADIENT,
  CONTROL_STYLE,
  STATUS_PILL_LIGHT,
  TEXT_MUTED,
  TEXT_PRIMARY,
} from "@/lib/design"

/**
 * Shared header surface ("Option 4") for both masthead variants. Reads as the
 * page's anchor: a barely-cool tint, a stronger/higher-floating shadow than the
 * pure-white content cards, a widened 5px brand accent strip, and one faint
 * upper-right bloom for depth. Surface treatment only — content is passed in.
 */
function HeaderCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative overflow-hidden rounded-[14px]"
      style={{
        background: "linear-gradient(120deg, #FBFCFE, #F1F5FA)",
        border: "1px solid #EAF0F7",
        boxShadow:
          "0 2px 4px rgba(16,24,40,0.05), 0 14px 32px rgba(16,24,40,0.09)",
        padding: 20,
      }}
    >
      {/* One faint upper-right bloom, behind the content. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 95% 40%, rgba(3,85,167,0.06), transparent 46%)",
        }}
      />
      {/* Widened 5px brand accent strip. */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0"
        style={{ width: 5, background: ACCENT_STRIP }}
      />
      {children}
    </div>
  )
}

/** Semantic status pill on a light tint. */
function LightPill({
  label,
  variant,
}: {
  label: string
  variant: PillVariant
}) {
  const v = STATUS_PILL_LIGHT[variant]
  return (
    <span
      className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full font-medium"
      style={{ padding: "3px 10px", fontSize: 11.5, background: v.bg, color: v.text }}
    >
      {label}
    </span>
  )
}

/**
 * Entity masthead — a floating white card replacing the old gradient banner on
 * the detail pages (Client / People / Institution). Badge + name + status +
 * subtitle on the left, an optional control slot (selector / prev-next) on the
 * right, and an optional folded section below a thin divider (e.g. the Client
 * Detail Account Team).
 */
export function EntityMasthead({
  badge,
  name,
  subtitle,
  status,
  rightSlot,
  children,
}: {
  badge?: string
  name: string
  subtitle?: React.ReactNode
  status?: { label: string; variant: PillVariant }
  rightSlot?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <HeaderCard>
      <div className="flex flex-col gap-3 pl-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          {badge && (
            <span
              className="flex shrink-0 items-center justify-center whitespace-nowrap font-semibold text-white"
              style={{
                height: 38,
                minWidth: 38,
                padding: "0 11px",
                borderRadius: 10,
                fontSize: 13,
                letterSpacing: "0.02em",
                background: BADGE_GRADIENT,
                boxShadow: "0 2px 6px rgba(3,85,167,0.25)",
              }}
            >
              {badge}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1
                className="truncate font-semibold"
                style={{ fontSize: 23, lineHeight: 1.15, color: TEXT_PRIMARY }}
              >
                {name}
              </h1>
              {status && <LightPill label={status.label} variant={status.variant} />}
            </div>
            {subtitle && (
              <p className="mt-1" style={{ color: TEXT_MUTED, fontSize: 12.5 }}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>

      {children && (
        <div
          className="mt-3 border-t pt-3 pl-4"
          style={{ borderColor: "rgba(16,24,40,0.07)" }}
        >
          {children}
        </div>
      )}
    </HeaderCard>
  )
}

/**
 * List title card — same floating white card + accent strip, holding just the
 * page title + subtitle and an optional right-side control (e.g. a date range),
 * for the firm-wide list pages (Feedback, Pipeline, etc.).
 */
export function ListTitleCard({
  title,
  subtitle,
  rightSlot,
}: {
  title: string
  subtitle?: React.ReactNode
  rightSlot?: React.ReactNode
}) {
  return (
    <HeaderCard>
      <div className="flex flex-col gap-3 pl-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1
            className="truncate font-semibold"
            style={{ fontSize: 23, lineHeight: 1.15, color: TEXT_PRIMARY }}
          >
            {title}
          </h1>
          {subtitle && (
            <p className="mt-1" style={{ color: TEXT_MUTED, fontSize: 12.5 }}>
              {subtitle}
            </p>
          )}
        </div>
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </div>
    </HeaderCard>
  )
}

/**
 * Clean white prev / ‹select› / next control for the detail-page mastheads.
 * Shared so the three entity pages get identical styling.
 */
export function MastheadSelector({
  items,
  value,
  onChange,
  onPrev,
  onNext,
  ariaLabel,
}: {
  items: Array<{ value: string; label: string }>
  value: string
  onChange: (value: string) => void
  onPrev: () => void
  onNext: () => void
  ariaLabel: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous"
        className="flex h-9 w-9 items-center justify-center transition-colors hover:bg-[#F4F6F9]"
        style={CONTROL_STYLE}
      >
        <ChevronLeft className="size-4" />
      </button>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 min-w-[220px] px-2 text-sm"
        style={CONTROL_STYLE}
        aria-label={ariaLabel}
      >
        {items.map((it) => (
          <option key={it.value} value={it.value}>
            {it.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onNext}
        aria-label="Next"
        className="flex h-9 w-9 items-center justify-center transition-colors hover:bg-[#F4F6F9]"
        style={CONTROL_STYLE}
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
