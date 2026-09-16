"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { diffRows, recordAudit } from "@/lib/audit"

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
  primary_manager_hours_monthly: z.number().nonnegative(),
  secondary_manager_hours_monthly: z.number().nonnegative(),
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

  // Prior values, for the audit diff. These assumptions drive every margin and
  // productivity figure in the app, so "who changed the multiplier, and from
  // what" is exactly the question this trail has to answer.
  const { data: before } = await sb
    .from("cost_assumptions")
    .select("*")
    .eq("id", 1)
    .maybeSingle()

  const { error } = await sb
    .from("cost_assumptions")
    .update(parsed.data)
    .eq("id", 1)

  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts. Null diff = a save that changed nothing.
  const changes = diffRows(before, parsed.data)
  if (changes) {
    await recordAudit({
      action: "update",
      entity: "cost_assumptions",
      recordId: 1,
      changes,
      context: "/cost-assumptions",
    })
  }

  revalidatePath("/cost-assumptions")
  return ok()
}
