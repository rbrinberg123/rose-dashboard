"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"

const upsertSchema = z.object({
  id: z.number().int().positive().optional(),
  period_year: z.number().int().min(2020),
  period_quarter: z.number().int().min(1).max(4),
  total_overhead_amount: z.number().nonnegative(),
  notes: z.string().nullable().optional(),
})

export type OverheadPeriodInput = z.infer<typeof upsertSchema>

export async function upsertOverheadPeriod(input: OverheadPeriodInput): Promise<ActionResult<{ id: number }>> {
  const parsed = upsertSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }
  const { id, ...row } = parsed.data
  const sb = getSupabaseServer()

  if (id) {
    const { error } = await sb.from("overhead_periods").update(row).eq("id", id)
    if (error) return fail(humanize(error))
    revalidatePath("/quarterly-overhead")
    return ok({ id })
  }

  const { data, error } = await sb
    .from("overhead_periods")
    .insert(row)
    .select("id")
    .single()
  if (error) return fail(humanize(error))
  revalidatePath("/quarterly-overhead")
  return ok({ id: data.id as number })
}

export async function deleteOverheadPeriod(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  const { error } = await sb.from("overhead_periods").delete().eq("id", id)
  if (error) return fail(describeError(error))
  revalidatePath("/quarterly-overhead")
  return ok()
}

/**
 * Postgres unique-violation comes back as code 23505 with a message that
 * leaks the constraint name. Surface a friendlier note when we recognise it.
 */
function humanize(err: { code?: string; message?: string; details?: string; hint?: string }): string {
  if (err.code === "23505" && err.message?.includes("overhead_periods_unique")) {
    return "A row already exists for that year and quarter. Edit it instead of adding a new one."
  }
  return describeError(err)
}
