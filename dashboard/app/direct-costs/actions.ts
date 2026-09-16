"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { recordAudit, snapshot } from "@/lib/audit"
import { DIRECT_COST_CATEGORIES } from "@/lib/types"

const insertSchema = z.object({
  client_account_id: z.guid(),
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
  // .select("id") added so the audit entry can carry the new row's id. It adds
  // a RETURNING clause and changes nothing about what is written.
  const { data, error } = await sb
    .from("client_direct_costs")
    .insert(parsed.data)
    .select("id")
    .single()
  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts.
  await recordAudit({
    action: "create",
    entity: "client_direct_costs",
    recordId: data?.id ?? null,
    changes: snapshot(parsed.data),
    context: "/direct-costs",
  })

  revalidatePath("/direct-costs")
  return ok()
}

export async function deleteDirectCost(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  // Read it before it goes — a deleted cost is otherwise unrecoverable.
  const { data: before } = await sb
    .from("client_direct_costs")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  const { error } = await sb.from("client_direct_costs").delete().eq("id", id)
  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts.
  if (before) {
    await recordAudit({
      action: "delete",
      entity: "client_direct_costs",
      recordId: id,
      changes: snapshot(before),
      context: "/direct-costs",
    })
  }
  revalidatePath("/direct-costs")
  return ok()
}
