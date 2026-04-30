"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
import { ClientCombobox } from "@/components/client-combobox"
import { NumberField, TextAreaField } from "@/components/form-fields"
import { addRevenueOverride } from "./actions"
import type { AccountOption } from "@/lib/types"

const formSchema = z.object({
  client_account_id: z.string().uuid("Pick a client"),
  period_year: z.number({ message: "Required" }).int().min(2020),
  period_quarter: z.number({ message: "Required" }).int().min(1).max(4),
  adjustment_amount: z.number({ message: "Required" }).refine((v) => v !== 0, "Use positive or negative, not zero"),
  reason: z.string().min(1, "Reason is required"),
})

type FormValues = z.infer<typeof formSchema>

const QUARTERS = [1, 2, 3, 4] as const

export function RevenueOverrideForm({ accounts }: { accounts: AccountOption[] }) {
  const now = new Date()
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      client_account_id: "",
      period_year: now.getFullYear(),
      period_quarter: Math.floor(now.getMonth() / 3) + 1,
      adjustment_amount: NaN,
      reason: "",
    },
  })

  const [pending, startTransition] = React.useTransition()

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const result = await addRevenueOverride(values)
      if (result.ok) {
        toast.success("Revenue override added")
        form.reset({
          client_account_id: "",
          period_year: values.period_year,
          period_quarter: values.period_quarter,
          adjustment_amount: NaN,
          reason: "",
        })
      } else {
        toast.error("Could not add revenue override", { description: result.error })
      }
    })
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Add revenue override</CardTitle>
        <CardDescription>
          Append-only — overrides cannot be edited. Delete and re-add if you need to fix one.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField
                control={form.control}
                name="client_account_id"
                render={({ field }) => (
                  <FormItem className="sm:col-span-3">
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

              <NumberField control={form.control} name="period_year" label="Year" step="1" min="2020" />

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

              <NumberField
                control={form.control}
                name="adjustment_amount"
                label="Adjustment ($)"
                step="0.01"
                description="Positive = add revenue; negative = subtract."
              />
            </div>

            <TextAreaField
              control={form.control}
              name="reason"
              label="Reason"
              placeholder="e.g. Project fee billed outside the contract"
              description="Required for audit trail."
              rows={2}
            />

            <div className="flex items-center gap-2 pt-1">
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Adding…
                  </>
                ) : (
                  <>
                    <Plus className="size-4" /> Add override
                  </>
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
