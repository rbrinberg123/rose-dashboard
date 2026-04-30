"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"

const upsertSchema = z
  .object({
    id: z.number().int().positive().optional(),
    client_account_id: z.string().uuid(),
    period_year: z.number().int().min(2020),
    period_quarter: z.number().int().min(1).max(4),
    fixed_amount: z.number().nonnegative().nullable(),
    percent_of_total: z.number().min(0).max(1).nullable(),
    notes: z.string().nullable().optional(),
  })
  .refine(
    (v) => (v.fixed_amount !== null) !== (v.percent_of_total !== null),
    { message: "Set exactly one of fixed amount or percent" },
  )

export type OverheadOverrideInput = z.infer<typeof upsertSchema>

export async function upsertOverheadOverride(input: OverheadOverrideInput): Promise<ActionResult<{ id: number }>> {
  const parsed = upsertSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }
  const { id, ...row } = parsed.data
  const sb = getSupabaseServer()

  if (id) {
    const { error } = await sb.from("overhead_overrides").update(row).eq("id", id)
    if (error) return fail(humanize(error))
    revalidatePath("/overhead-overrides")
    return ok({ id })
  }

  const { data, error } = await sb
    .from("overhead_overrides")
    .insert(row)
    .select("id")
    .single()
  if (error) return fail(humanize(error))
  revalidatePath("/overhead-overrides")
  return ok({ id: data.id as number })
}

export async function deleteOverheadOverride(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  const { error } = await sb.from("overhead_overrides").delete().eq("id", id)
  if (error) return fail(describeError(error))
  revalidatePath("/overhead-overrides")
  return ok()
}

function humanize(err: { code?: string; message?: string; details?: string; hint?: string }): string {
  if (err.code === "23505" && err.message?.includes("overhead_override_unique")) {
    return "This client already has an override for that quarter. Edit the existing row instead."
  }
  if (err.code === "23514" && err.message?.includes("overhead_override_one_only")) {
    return "Pick either a fixed dollar amount or a percent — not both, and not neither."
  }
  return describeError(err)
}
