"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { DIRECT_COST_CATEGORIES } from "@/lib/types"

const insertSchema = z.object({
  client_account_id: z.string().uuid(),
  cost_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  amount: z.number().nonnegative("Cannot be negative"),
  category: z.enum(DIRECT_COST_CATEGORIES),
  description: z.string().nullable().optional(),
})

export type DirectCostInput = z.infer<typeof insertSchema>

export async function addDirectCost(input: DirectCostInput): Promise<ActionResult> {
  const parsed = insertSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }
  const sb = getSupabaseServer()
  const { error } = await sb.from("client_direct_costs").insert(parsed.data)
  if (error) return fail(describeError(error))
  revalidatePath("/direct-costs")
  return ok()
}

export async function deleteDirectCost(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  const { error } = await sb.from("client_direct_costs").delete().eq("id", id)
  if (error) return fail(describeError(error))
  revalidatePath("/direct-costs")
  return ok()
}
