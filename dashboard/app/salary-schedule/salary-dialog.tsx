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
import { UserCombobox } from "@/components/user-combobox"
import { DateField, NumberField, TextAreaField } from "@/components/form-fields"
import { upsertSalary } from "./actions"
import type { SalaryScheduleRow, UserOption, CostAssumptionsRow } from "@/lib/types"

const formSchema = z
  .object({
    user_id: z.string().uuid("Pick a user"),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an effective-from date"),
    effective_to: z.string().nullable(),
    annual_salary: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
    annual_bonus: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
    benefits_multiplier: z.number({ message: "Required" }).positive("Must be greater than zero"),
    notes: z.string().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.effective_to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.effective_to)) {
        ctx.addIssue({ code: "custom", path: ["effective_to"], message: "Use YYYY-MM-DD" })
      } else if (v.effective_to < v.effective_from) {
        ctx.addIssue({
          code: "custom",
          path: ["effective_to"],
          message: "Must be on or after effective-from",
        })
      }
    }
  })

type FormValues = z.infer<typeof formSchema>

export function SalaryDialog({
  open,
  onOpenChange,
  initial,
  users,
  costDefaults,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: SalaryScheduleRow | null
  users: UserOption[]
  costDefaults: CostAssumptionsRow | null
}) {
  const isEdit = !!initial

  const defaultMultiplier = costDefaults
    ? Number(costDefaults.default_benefits_multiplier)
    : 1.15

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      user_id: initial?.user_id ?? "",
      effective_from: initial?.effective_from ?? "",
      effective_to: initial?.effective_to ?? null,
      annual_salary: initial ? Number(initial.annual_salary) : NaN,
      annual_bonus: initial ? Number(initial.annual_bonus) : 0,
      benefits_multiplier: initial ? Number(initial.benefits_multiplier) : defaultMultiplier,
      notes: initial?.notes ?? null,
    },
  })

  React.useEffect(() => {
    form.reset({
      user_id: initial?.user_id ?? "",
      effective_from: initial?.effective_from ?? "",
      effective_to: initial?.effective_to ?? null,
      annual_salary: initial ? Number(initial.annual_salary) : NaN,
      annual_bonus: initial ? Number(initial.annual_bonus) : 0,
      benefits_multiplier: initial ? Number(initial.benefits_multiplier) : defaultMultiplier,
      notes: initial?.notes ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial?.id])

  const [pending, startTransition] = React.useTransition()

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await upsertSalary({
        id: initial?.id,
        user_id: values.user_id,
        effective_from: values.effective_from,
        effective_to: values.effective_to,
        annual_salary: values.annual_salary,
        annual_bonus: values.annual_bonus,
        benefits_multiplier: values.benefits_multiplier,
        notes: values.notes,
      })
      if (result.ok) {
        toast.success(isEdit ? "Salary record updated" : "Salary record added")
        onOpenChange(false)
      } else {
        toast.error("Could not save salary record", { description: result.error })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit salary record" : "Add salary record"}</DialogTitle>
          <DialogDescription>
            One row per (user, effective period). Leave <strong>effective-to</strong> blank for the currently
            active record.
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

            <div className="grid grid-cols-2 gap-4">
              <DateField control={form.control} name="effective_from" label="Effective from" />
              <DateField
                control={form.control}
                name="effective_to"
                label="Effective to"
                description="Leave blank for currently active."
                optional
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <NumberField
                control={form.control}
                name="annual_salary"
                label="Annual salary"
                step="100"
                min="0"
              />
              <NumberField
                control={form.control}
                name="annual_bonus"
                label="Annual bonus"
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
              description={`Default: ${defaultMultiplier}× (set in Cost Assumptions).`}
            />

            <TextAreaField
              control={form.control}
              name="notes"
              label="Notes"
              placeholder="Optional context (role, source of figure, etc.)"
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
                  isEdit ? "Save changes" : "Add record"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
