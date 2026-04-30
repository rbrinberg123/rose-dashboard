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
import { DateField, NumberField, TextAreaField } from "@/components/form-fields"
import { addDirectCost } from "./actions"
import { DIRECT_COST_CATEGORIES, type AccountOption } from "@/lib/types"

const formSchema = z.object({
  client_account_id: z.string().uuid("Pick a client"),
  cost_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  category: z.enum(DIRECT_COST_CATEGORIES, { message: "Pick a category" }),
  amount: z.number({ message: "Required" }).nonnegative("Cannot be negative"),
  description: z.string().nullable(),
})

type FormValues = z.infer<typeof formSchema>

function todayIso(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function DirectCostForm({ accounts }: { accounts: AccountOption[] }) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      client_account_id: "",
      cost_date: todayIso(),
      category: "T&E",
      amount: NaN,
      description: null,
    },
  })

  const [pending, startTransition] = React.useTransition()
  const [keepOpen, setKeepOpen] = React.useState(false)

  function submit(values: FormValues, addAnother: boolean) {
    setKeepOpen(addAnother)
    startTransition(async () => {
      const result = await addDirectCost(values)
      if (result.ok) {
        toast.success("Direct cost added")
        if (addAnother) {
          // Keep date, client, category — clear amount + description so each
          // line gets its own value but bulk entry stays fast.
          form.reset({
            ...values,
            amount: NaN,
            description: null,
          })
        } else {
          form.reset({
            client_account_id: "",
            cost_date: todayIso(),
            category: "T&E",
            amount: NaN,
            description: null,
          })
        }
      } else {
        toast.error("Could not add direct cost", { description: result.error })
      }
    })
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Add direct cost</CardTitle>
        <CardDescription>
          T&E, event fees, ad-hoc charges. Use <strong>Save and add another</strong> to streamline bulk entry —
          date, client, and category are kept; amount and description clear.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="client_account_id"
                render={({ field }) => (
                  <FormItem className="sm:col-span-2">
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

              <DateField control={form.control} name="cost_date" label="Date" />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <FormControl>
                      <Select
                        value={field.value ?? ""}
                        onValueChange={(v) => { if (v) field.onChange(v) }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Pick a category" />
                        </SelectTrigger>
                        <SelectContent>
                          {DIRECT_COST_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
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
                name="amount"
                label="Amount ($)"
                step="0.01"
                min="0"
              />
            </div>

            <TextAreaField
              control={form.control}
              name="description"
              label="Description"
              placeholder="Optional — what was this for?"
              rows={2}
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                type="button"
                disabled={pending}
                onClick={form.handleSubmit((v) => submit(v, false))}
              >
                {pending && !keepOpen ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Plus className="size-4" /> Save
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={form.handleSubmit((v) => submit(v, true))}
              >
                {pending && keepOpen ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  "Save and add another"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}
