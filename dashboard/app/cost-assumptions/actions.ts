"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"

/**
 * Cost-assumptions has exactly one row (id = 1, enforced by DB CHECK).
 * The page only ever updates that row — no insert path needed.
 */
const updateSchema = z.object({
  work_hours_per_year: z.number().int().positive(),
  booker_hours_per_meeting_base: z.number().nonnegative(),
  host_hours_per_meeting_base: z.number().nonnegative(),
  in_person_multiplier: z.number().positive(),
  default_benefits_multiplier: z.number().positive(),
})

export type CostAssumptionsInput = z.infer<typeof updateSchema>

export async function updateCostAssumptions(
  input: CostAssumptionsInput,
): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }

  const sb = getSupabaseServer()
  const { error } = await sb
    .from("cost_assumptions")
    .update(parsed.data)
    .eq("id", 1)

  if (error) return fail(describeError(error))

  revalidatePath("/cost-assumptions")
  return ok()
}
