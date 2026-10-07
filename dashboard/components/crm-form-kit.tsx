"use client"

/**
 * Small building blocks for the CRM create/edit forms (new-*-dialog.tsx), so
 * the full "form field set = drawer field set" forms stay short and grouped the
 * same way the drawers group their fields.
 */

import * as React from "react"

import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"

/**
 * A field-level validation message under an input (pair it with
 * aria-invalid on the input, which the base Input already styles red).
 */
export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

/**
 * A titled group of fields — mirrors one drawer section.
 *
 * `panel` (opt-in; the Meeting form) = the prominent treatment: the section sits
 * in a subtly bounded panel, with an uppercase brand-navy label, an optional
 * lucide icon, and the app's navy→teal gradient rule beneath it (the same rule
 * the record drawers' section headers carry) — so sections read as distinct,
 * scannable blocks. Without it, the original compact fieldset (other forms).
 *
 * Panel fills (with `panel`):
 *   default — the filled blue-tinted panel: primary sections, which stand out.
 *   `quiet` — the same light outline but a TRANSPARENT fill and a muted
 *             header: rarely used sections, present and findable but quiet.
 */
export function FormSection({
  title,
  children,
  panel = false,
  quiet = false,
  icon: Icon,
}: {
  title: string
  children: React.ReactNode
  panel?: boolean
  quiet?: boolean
  icon?: React.ComponentType<{ className?: string }>
}) {
  if (panel) {
    const fill = quiet ? "bg-transparent" : "bg-[#F6F8FC]"
    return (
      <section
        className={`rounded-lg border border-[#E4E9F4] ${fill} px-2.5 pb-2.5 pt-2`}
        aria-label={title}
      >
        <div className="mb-2">
          <h3
            className={
              "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider " +
              (quiet ? "text-[#5B6472]" : "text-[#1E2858]")
            }
          >
            {Icon && <Icon className={quiet ? "size-3.5 text-[#9AA1AD]" : "size-3.5 text-[#0355A7]"} />}
            {title}
          </h3>
          <div
            className="mt-1 h-[2px] w-full rounded-full"
            style={{
              background: quiet ? "#E4E9F4" : "linear-gradient(90deg, #1E2858, #0355A7, #1C8C9C)",
            }}
          />
        </div>
        <div className="grid gap-2">{children}</div>
      </section>
    )
  }
  return (
    <fieldset className="grid gap-3 border-t border-[#E5E8EC] pt-3">
      <legend className="pr-2 text-[11px] font-semibold uppercase tracking-wider text-[#5B6472]">{title}</legend>
      {children}
    </fieldset>
  )
}

/** A labelled text/date/number input bound to a string value. */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  ...props
}: {
  id: string
  label: React.ReactNode
  value: string | null | undefined
  onChange: (v: string) => void
  /** Optional validation message; marks the input invalid. */
  error?: string | null
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "id">) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...props}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}

/** A labelled Yes/No checkbox. */
export function YesNo({
  label,
  checked,
  onChange,
}: {
  label: React.ReactNode
  checked: boolean | null | undefined
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={checked === true} onCheckedChange={(c) => onChange(c === true)} />
      {label}
    </label>
  )
}

/** A labelled native select over { value, label } options, with an empty choice. */
export function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  empty = "—",
  error,
}: {
  id: string
  label: React.ReactNode
  value: string | number | null | undefined
  onChange: (v: string) => void
  options: readonly { value: string | number; label: string }[]
  empty?: string | null
  /** Optional validation message; marks the select invalid. */
  error?: string | null
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`${SELECT_CLASS} aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20`}
      >
        {empty !== null && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  )
}
