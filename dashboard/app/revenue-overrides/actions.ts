"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"

/**
 * revenue_overrides is append-only: insert + delete, no update path.
 * adjustment_amount is intentionally signed.
 */
const insertSchema = z.object({
  client_account_id: z.string().uuid(),
  period_year: z.number().int().min(2020),
  period_quarter: z.number().int().min(1).max(4),
  adjustment_amount: z.number().refine((v) => v !== 0, "Use a positive or negative amount, not zero"),
  reason: z.string().min(1, "Reason is required"),
})

export type RevenueOverrideInput = z.infer<typeof insertSchema>

export async function addRevenueOverride(input: RevenueOverrideInput): Promise<ActionResult> {
  const parsed = insertSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }
  const sb = getSupabaseServer()
  const { error } = await sb.from("revenue_overrides").insert(parsed.data)
  if (error) return fail(describeError(error))
  revalidatePath("/revenue-overrides")
  return ok()
}

export async function deleteRevenueOverride(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  const { error } = await sb.from("revenue_overrides").delete().eq("id", id)
  if (error) return fail(describeError(error))
  revalidatePath("/revenue-overrides")
  return ok()
}
