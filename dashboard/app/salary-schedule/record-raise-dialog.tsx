"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2, TrendingUp } from "lucide-react"

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
import { UserCombobox } from "@/components/user-combobox"
import { DateField, NumberField, TextAreaField } from "@/components/form-fields"
import { recordRaise } from "./actions"
import type { SalaryScheduleRow, UserOption, CostAssumptionsRow } from "@/lib/types"
import { formatCurrency, formatDate } from "@/lib/format"

const formSchema = z.object({
  user_id: z.string().uuid("Pick a user"),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the raise effective date"),
  annual_salary: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
  annual_bonus: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
  benefits_multiplier: z.number({ message: "Required" }).positive("Must be greater than zero"),
  notes: z.string().nullable(),
})

type FormValues = z.infer<typeof formSchema>

export function RecordRaiseDialog({
  open,
  onOpenChange,
  users,
  rows,
  costDefaults,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  users: UserOption[]
  rows: SalaryScheduleRow[]
  costDefaults: CostAssumptionsRow | null
}) {
  const defaultMultiplier = costDefaults ? Number(costDefaults.default_benefits_multiplier) : 1.15

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      user_id: "",
      effective_from: "",
      annual_salary: NaN,
      annual_bonus: 0,
      benefits_multiplier: defaultMultiplier,
      notes: null,
    },
  })

  // Reset every time the dialog opens so a stale draft doesn't carry over.
  React.useEffect(() => {
    if (open) {
      form.reset({
        user_id: "",
        effective_from: "",
        annual_salary: NaN,
        annual_bonus: 0,
        benefits_multiplier: defaultMultiplier,
        notes: null,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const [pending, startTransition] = React.useTransition()

  // Show the user's currently active row so the operator knows what's being
  // truncated.
  const userId = form.watch("user_id")
  const currentActive = userId
    ? rows.find((r) => r.user_id === userId && r.effective_to === null)
    : undefined

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await recordRaise({
        user_id: values.user_id,
        effective_from: values.effective_from,
        annual_salary: values.annual_salary,
        annual_bonus: values.annual_bonus,
        benefits_multiplier: values.benefits_multiplier,
        notes: values.notes,
      })
      if (result.ok) {
        toast.success("Raise recorded", {
          description: "Previous active row was end-dated and a new row was added.",
        })
        onOpenChange(false)
      } else {
        toast.error("Could not record raise", { description: result.error })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="size-4" /> Record raise
          </DialogTitle>
          <DialogDescription>
            Two-step shortcut: end-dates the user&apos;s currently active row and creates a new one starting on the
            raise date.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <FormField
              control={form.control}
              name="user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>User</FormLabel>
                  <FormControl>
                    <UserCombobox
                      options={users}
                      value={field.value || null}
                      onChange={(v) => field.onChange(v ?? "")}
                      invalid={!!form.formState.errors.user_id}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {userId ? (
              currentActive ? (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
                  <div className="font-medium">Current active record</div>
                  <div className="text-muted-foreground">
                    {formatCurrency(Number(currentActive.annual_salary))} salary · since{" "}
                    {formatDate(currentActive.effective_from)}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    Will be end-dated to the day before the raise.
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-amber-300/50 bg-amber-100/40 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                  No currently active record found for this user. The raise will be added as a new record;
                  no other row gets end-dated.
                </div>
              )
            ) : null}

            <DateField control={form.control} name="effective_from" label="Raise effective from" />

            <div className="grid grid-cols-2 gap-4">
              <NumberField
                control={form.control}
                name="annual_salary"
                label="New annual salary"
                step="100"
                min="0"
              />
              <NumberField
                control={form.control}
                name="annual_bonus"
                label="New annual bonus"
                step="100"
                min="0"
              />
            </div>

            <NumberField
              control={form.control}
              name="benefits_multiplier"
              label="Benefits multiplier"
              step="0.01"
              min="0.01"
            />

            <TextAreaField
              control={form.control}
              name="notes"
              label="Notes"
              placeholder='e.g. "Promotion to Senior Analyst"'
              rows={2}
            />

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Recording…
                  </>
                ) : (
                  "Record raise"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
