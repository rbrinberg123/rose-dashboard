"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { NumberField, TextAreaField } from "@/components/form-fields"
import { upsertOverheadPeriod } from "./actions"
import type { OverheadPeriodRow } from "@/lib/types"

const formSchema = z.object({
  period_year: z.number({ message: "Required" }).int().min(2020, "Must be 2020 or later"),
  period_quarter: z.number({ message: "Required" }).int().min(1).max(4),
  total_overhead_amount: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
  notes: z.string().nullable(),
})

type FormValues = z.infer<typeof formSchema>

const QUARTERS = [1, 2, 3, 4] as const

export function OverheadPeriodDialog({
  open,
  onOpenChange,
  initial,
  hasOverridesForRow,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, dialog edits the row; when null, it creates a new one. */
  initial: OverheadPeriodRow | null
  /** Did the row being edited have any overhead_overrides at load time? */
  hasOverridesForRow: boolean
}) {
  const isEdit = !!initial
  const currentYear = new Date().getFullYear()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      period_year: initial?.period_year ?? currentYear,
      period_quarter: initial?.period_quarter ?? Math.floor(new Date().getMonth() / 3) + 1,
      total_overhead_amount: initial ? Number(initial.total_overhead_amount) : 0,
      notes: initial?.notes ?? null,
    },
  })

  // Reset form whenever a different row (or new-row) is opened.
  React.useEffect(() => {
    form.reset({
      period_year: initial?.period_year ?? currentYear,
      period_quarter: initial?.period_quarter ?? Math.floor(new Date().getMonth() / 3) + 1,
      total_overhead_amount: initial ? Number(initial.total_overhead_amount) : 0,
      notes: initial?.notes ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id])

  const [pending, startTransition] = React.useTransition()

  // Show a soft warning (not a hard error) when editing a row that has
  // overrides — the UI nudge is in the spec; user can still proceed.
  const newTotal = form.watch("total_overhead_amount")
  const totalChanged = isEdit && initial && Number(initial.total_overhead_amount) !== newTotal
  const showOverrideWarning = isEdit && hasOverridesForRow && totalChanged

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await upsertOverheadPeriod({
        id: initial?.id,
        ...values,
      })
      if (result.ok) {
        toast.success(isEdit ? "Period updated" : "Period added")
        onOpenChange(false)
      } else {
        toast.error("Could not save period", { description: result.error })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit quarterly overhead" : "Add quarterly overhead"}</DialogTitle>
          <DialogDescription>
            One row per (year, quarter) — the database enforces uniqueness.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <NumberField
                control={form.control}
                name="period_year"
                label="Year"
                step="1"
                min="2020"
              />
              <FormField
                control={form.control}
                name="period_quarter"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quarter</FormLabel>
                    <FormControl>
                      <Select
                        value={String(field.value ?? "")}
                        onValueChange={(v) => { if (v) field.onChange(Number(v)) }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Quarter" />
                        </SelectTrigger>
                        <SelectContent>
                          {QUARTERS.map((q) => (
                            <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <NumberField
              control={form.control}
              name="total_overhead_amount"
              label="Total overhead amount"
              step="0.01"
              min="0"
              description="Pool of overhead dollars to allocate across clients this quarter."
            />

            <TextAreaField
              control={form.control}
              name="notes"
              label="Notes"
              placeholder="Optional context (e.g. one-time charges, source of figure)"
              rows={3}
            />

            {showOverrideWarning ? (
              <div className="rounded-md border border-amber-300/50 bg-amber-100/40 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                Changes will affect overhead allocation across clients with overrides for this quarter.
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  isEdit ? "Save changes" : "Add period"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
