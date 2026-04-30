"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { updateCostAssumptions } from "./actions"
import type { CostAssumptionsRow } from "@/lib/types"

const formSchema = z.object({
  work_hours_per_year: z.number({ message: "Required" }).int("Must be a whole number").positive("Must be greater than zero"),
  booker_hours_per_meeting_base: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
  host_hours_per_meeting_base: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
  in_person_multiplier: z.number({ message: "Required" }).positive("Must be greater than zero"),
  default_benefits_multiplier: z.number({ message: "Required" }).positive("Must be greater than zero"),
})

type FormValues = z.infer<typeof formSchema>

export function CostAssumptionsForm({ row }: { row: CostAssumptionsRow }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      work_hours_per_year: row.work_hours_per_year,
      booker_hours_per_meeting_base: Number(row.booker_hours_per_meeting_base),
      host_hours_per_meeting_base: Number(row.host_hours_per_meeting_base),
      in_person_multiplier: Number(row.in_person_multiplier),
      default_benefits_multiplier: Number(row.default_benefits_multiplier),
    },
  })

  const [pending, startTransition] = React.useTransition()

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await updateCostAssumptions(values)
      if (result.ok) {
        toast.success("Cost assumptions updated", {
          description: "Per-meeting costs will recalculate automatically.",
        })
        form.reset(values)
      } else {
        toast.error("Could not save cost assumptions", { description: result.error })
      }
    })
  }

  const isDirty = form.formState.isDirty

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Cost model parameters</CardTitle>
        <CardDescription>
          Single row of inputs used to derive per-meeting labor cost. Defaults: 2,000 work hours/year,
          0.5 booker hours, 1.5 host hours, 2× in-person multiplier, 1.15 benefits multiplier.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-5">
            <FormField
              control={form.control}
              name="work_hours_per_year"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Work hours per year</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="1"
                      min="1"
                      value={Number.isFinite(field.value) ? field.value : ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? NaN : Number(e.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormDescription>
                    Divisor for hourly cost. Standard US full-time year is 2,000.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-5 sm:grid-cols-2">
              <NumberInputField name="booker_hours_per_meeting_base" label="Booker hours per meeting" description="Base hours for non-in-person meetings." step="0.05" min="0" form={form} />
              <NumberInputField name="host_hours_per_meeting_base" label="Host hours per meeting" description="Base hours for non-in-person meetings." step="0.05" min="0" form={form} />
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <NumberInputField name="in_person_multiplier" label="In-person multiplier" description="Applied to both booker and host hours when meeting is in person." step="0.05" min="0.01" form={form} />
              <NumberInputField name="default_benefits_multiplier" label="Default benefits multiplier" description="Suggested value for new salary rows. Each row stores its own." step="0.01" min="0.01" form={form} />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Button type="submit" disabled={pending || !isDirty}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending || !isDirty}
                onClick={() => form.reset()}
              >
                Reset
              </Button>
              <p className="ml-auto text-xs text-muted-foreground">
                Last updated{" "}
                {new Date(row.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </p>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

function NumberInputField({
  form,
  name,
  label,
  description,
  step,
  min,
}: {
  form: ReturnType<typeof useForm<FormValues>>
  name: keyof FormValues
  label: string
  description: string
  step: string
  min: string
}) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              step={step}
              min={min}
              value={Number.isFinite(field.value) ? field.value : ""}
              onChange={(e) => field.onChange(e.target.value === "" ? NaN : Number(e.target.value))}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          </FormControl>
          <FormDescription>{description}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}
