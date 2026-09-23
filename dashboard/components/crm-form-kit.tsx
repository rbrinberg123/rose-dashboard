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

/** A titled group of fields — mirrors one drawer section. */
export function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
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
  ...props
}: {
  id: string
  label: string
  value: string | null | undefined
  onChange: (v: string) => void
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "id">) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} {...props} />
    </div>
  )
}

/** A labelled Yes/No checkbox. */
export function YesNo({
  label,
  checked,
  onChange,
}: {
  label: string
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
}: {
  id: string
  label: string
  value: string | number | null | undefined
  onChange: (v: string) => void
  options: readonly { value: string | number; label: string }[]
  empty?: string | null
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={SELECT_CLASS}>
        {empty !== null && <option value="">{empty}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}
