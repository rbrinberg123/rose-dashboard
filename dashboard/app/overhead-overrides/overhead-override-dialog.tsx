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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Label } from "@/components/ui/label"
import { ClientCombobox } from "@/components/client-combobox"
import { NumberField, TextAreaField } from "@/components/form-fields"
import { upsertOverheadOverride } from "./actions"
import type {
  AccountOption,
  OverheadOverrideRow,
  OverheadPeriodRow,
} from "@/lib/types"
import { formatCurrency, formatPercent, formatQuarter } from "@/lib/format"

const formSchema = z
  .object({
    client_account_id: z.string().uuid("Pick a client"),
    period_year: z.number({ message: "Required" }).int().min(2020),
    period_quarter: z.number({ message: "Required" }).int().min(1).max(4),
    type: z.enum(["fixed", "percent"]),
    fixed_amount: z.number().nonnegative("Cannot be negative").optional(),
    percent_of_total: z.number().min(0, "Cannot be negative").max(1, "Cannot exceed 100%").optional(),
    notes: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "fixed") {
      if (!Number.isFinite(v.fixed_amount as number)) {
        ctx.addIssue({ code: "custom", path: ["fixed_amount"], message: "Required" })
      }
    } else {
      if (!Number.isFinite(v.percent_of_total as number)) {
        ctx.addIssue({ code: "custom", path: ["percent_of_total"], message: "Required" })
      }
    }
  })

type FormValues = z.infer<typeof formSchema>

const QUARTERS = [1, 2, 3, 4] as const

export function OverheadOverrideDialog({
  open,
  onOpenChange,
  initial,
  accounts,
  periods,
  existingOverrides,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: OverheadOverrideRow | null
  accounts: AccountOption[]
  periods: OverheadPeriodRow[]
  existingOverrides: OverheadOverrideRow[]
}) {
  const isEdit = !!initial
  const now = new Date()

  const initialType: "fixed" | "percent" =
    initial?.fixed_amount != null ? "fixed" : "percent"

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      client_account_id: initial?.client_account_id ?? "",
      period_year: initial?.period_year ?? now.getFullYear(),
      period_quarter: initial?.period_quarter ?? Math.floor(now.getMonth() / 3) + 1,
      type: initialType,
      fixed_amount: initial?.fixed_amount != null ? Number(initial.fixed_amount) : undefined,
      percent_of_total:
        initial?.percent_of_total != null ? Number(initial.percent_of_total) : undefined,
      notes: initial?.notes ?? null,
    },
  })

  React.useEffect(() => {
    form.reset({
      client_account_id: initial?.client_account_id ?? "",
      period_year: initial?.period_year ?? now.getFullYear(),
      period_quarter: initial?.period_quarter ?? Math.floor(now.getMonth() / 3) + 1,
      type: initial?.fixed_amount != null ? "fixed" : "percent",
      fixed_amount: initial?.fixed_amount != null ? Number(initial.fixed_amount) : undefined,
      percent_of_total:
        initial?.percent_of_total != null ? Number(initial.percent_of_total) : undefined,
      notes: initial?.notes ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id])

  const [pending, startTransition] = React.useTransition()

  // Live warnings: roll up other overrides in the same quarter (excluding the
  // one being edited) and compare against the period total / 100 %.
  const watchYear = form.watch("period_year")
  const watchQuarter = form.watch("period_quarter")
  const watchType = form.watch("type")
  const watchFixed = form.watch("fixed_amount")
  const watchPercent = form.watch("percent_of_total")

  const period = periods.find(
    (p) => p.period_year === watchYear && p.period_quarter === watchQuarter,
  )

  const peers = existingOverrides.filter(
    (o) =>
      o.period_year === watchYear &&
      o.period_quarter === watchQuarter &&
      (!isEdit || o.id !== initial!.id),
  )
  const peerFixedSum = peers.reduce((s, o) => s + (o.fixed_amount != null ? Number(o.fixed_amount) : 0), 0)
  const peerPercentSum = peers.reduce(
    (s, o) => s + (o.percent_of_total != null ? Number(o.percent_of_total) : 0),
    0,
  )

  const newFixed = watchType === "fixed" && Number.isFinite(watchFixed as number) ? Number(watchFixed) : 0
  const newPercent =
    watchType === "percent" && Number.isFinite(watchPercent as number) ? Number(watchPercent) : 0

  const totalFixed = peerFixedSum + newFixed
  const totalPercent = peerPercentSum + newPercent

  const fixedExceedsPot =
    watchType === "fixed" && period && totalFixed > Number(period.total_overhead_amount)
  const percentExceeds100 = watchType === "percent" && totalPercent > 1

  const noPeriod = !period

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await upsertOverheadOverride({
        id: initial?.id,
        client_account_id: values.client_account_id,
        period_year: values.period_year,
        period_quarter: values.period_quarter,
        fixed_amount: values.type === "fixed" ? (values.fixed_amount ?? null) : null,
        percent_of_total: values.type === "percent" ? (values.percent_of_total ?? null) : null,
        notes: values.notes,
      })
      if (result.ok) {
        toast.success(isEdit ? "Override updated" : "Override added")
        if (fixedExceedsPot && period) {
          toast.warning("Fixed overrides now exceed the quarter total", {
            description: `Total fixed overrides: ${formatCurrency(totalFixed)} vs. pot ${formatCurrency(
              Number(period.total_overhead_amount),
            )}.`,
          })
        }
        if (percentExceeds100) {
          toast.warning("Percent overrides exceed 100% for the quarter", {
            description: `Sum: ${formatPercent(totalPercent)}.`,
          })
        }
        onOpenChange(false)
      } else {
        toast.error("Could not save override", { description: result.error })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit overhead override" : "Add overhead override"}</DialogTitle>
          <DialogDescription>
            Direct allocation for a single client per quarter. Used for advisory-only clients with no meetings.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="client_account_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Client</FormLabel>
                  <FormControl>
                    <ClientCombobox
                      options={accounts}
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? "")}
                      placeholder="Search by name or ticker"
                      invalid={!!form.formState.errors.client_account_id}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                          <SelectValue />
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

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Override type</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={(v) => { if (v) field.onChange(v) }}
                      className="flex gap-6"
                    >
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="fixed" id="oo-fixed" />
                        <Label htmlFor="oo-fixed" className="text-sm font-normal">
                          Fixed dollar amount
                        </Label>
                      </div>
                      <div className="flex items-center gap-2">
                        <RadioGroupItem value="percent" id="oo-percent" />
                        <Label htmlFor="oo-percent" className="text-sm font-normal">
                          Percent of total overhead
                        </Label>
                      </div>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchType === "fixed" ? (
              <NumberField
                control={form.control}
                name="fixed_amount"
                label="Fixed amount ($)"
                step="0.01"
                min="0"
              />
            ) : (
              <FormField
                control={form.control}
                name="percent_of_total"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Percent of total overhead</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="100"
                          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pr-10 text-sm shadow-sm ring-offset-background focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                          // Stored as a 0..1 fraction, but the input shows 0..100 to feel natural.
                          value={
                            Number.isFinite(field.value as number)
                              ? Math.round((field.value as number) * 10000) / 100
                              : ""
                          }
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? NaN : Number(e.target.value) / 100)
                          }
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref as React.Ref<HTMLInputElement>}
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          %
                        </span>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {/* Live validation hints — surface but allow save. */}
            {noPeriod ? (
              <div className="rounded-md border border-amber-300/50 bg-amber-100/40 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                No quarterly overhead row exists for {formatQuarter(watchYear, watchQuarter)} yet — overhead
                allocation will be limited until you add one.
              </div>
            ) : null}
            {fixedExceedsPot && period ? (
              <div className="rounded-md border border-amber-300/50 bg-amber-100/40 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                Heads up: total fixed overrides for this quarter would be{" "}
                <strong>{formatCurrency(totalFixed)}</strong>, exceeding the pot of{" "}
                <strong>{formatCurrency(Number(period.total_overhead_amount))}</strong>. Meeting-share clients
                will get a negative allocation.
              </div>
            ) : null}
            {percentExceeds100 ? (
              <div className="rounded-md border border-amber-300/50 bg-amber-100/40 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                Heads up: percent overrides for this quarter would total{" "}
                <strong>{formatPercent(totalPercent)}</strong>, exceeding 100%.
              </div>
            ) : null}

            <TextAreaField
              control={form.control}
              name="notes"
              label="Notes"
              placeholder="Optional context"
              rows={2}
            />

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
                  isEdit ? "Save changes" : "Add override"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
