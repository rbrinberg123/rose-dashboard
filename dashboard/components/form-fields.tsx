"use client"

/**
 * Generic form-field wrappers used across admin pages. Each accepts a
 * react-hook-form `control` (typed via FieldValues) and a string `name` and
 * renders a consistent label + input + error structure built on top of the
 * shadcn-style Form primitives.
 *
 * Number handling: the underlying value is `number`, but `<input type=number>`
 * round-trips strings, so we convert in onChange / format on display. Empty
 * input → NaN, which zod will reject with "Required" via the page's schema.
 */

import * as React from "react"
import {
  type Control,
  type FieldPath,
  type FieldValues,
} from "react-hook-form"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

type Common<TFieldValues extends FieldValues> = {
  control: Control<TFieldValues>
  name: FieldPath<TFieldValues>
  label: React.ReactNode
  description?: React.ReactNode
}

export function NumberField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  step = "any",
  min,
  max,
  placeholder,
}: Common<TFieldValues> & {
  step?: string
  min?: string | number
  max?: string | number
  placeholder?: string
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              step={step}
              min={min}
              max={max}
              placeholder={placeholder}
              value={Number.isFinite(field.value as number) ? (field.value as number) : ""}
              onChange={(e) => field.onChange(e.target.value === "" ? NaN : Number(e.target.value))}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TextField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder,
  type = "text",
}: Common<TFieldValues> & {
  placeholder?: string
  type?: string
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type={type}
              placeholder={placeholder}
              value={(field.value as string | null | undefined) ?? ""}
              onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function TextAreaField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  placeholder,
  rows = 3,
}: Common<TFieldValues> & {
  placeholder?: string
  rows?: number
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Textarea
              placeholder={placeholder}
              rows={rows}
              value={(field.value as string | null | undefined) ?? ""}
              onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

export function DateField<TFieldValues extends FieldValues>({
  control,
  name,
  label,
  description,
  optional = false,
}: Common<TFieldValues> & {
  /** When true, blank input becomes null (e.g., "currently active" salary). */
  optional?: boolean
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="date"
              value={(field.value as string | null | undefined) ?? ""}
              onChange={(e) =>
                field.onChange(e.target.value === "" ? (optional ? null : "") : e.target.value)
              }
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
