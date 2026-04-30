"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"

const baseRow = z.object({
  user_id: z.string().uuid("Pick a user"),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick an effective-from date"),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
  annual_salary: z.number().nonnegative("Cannot be negative"),
  annual_bonus: z.number().nonnegative("Cannot be negative"),
  benefits_multiplier: z.number().positive("Must be greater than zero"),
  notes: z.string().nullable().optional(),
})

const upsertSchema = baseRow
  .extend({ id: z.number().int().positive().optional() })
  .superRefine((v, ctx) => {
    if (v.effective_to && v.effective_to < v.effective_from) {
      ctx.addIssue({
        code: "custom",
        path: ["effective_to"],
        message: "Effective-to must be on or after effective-from",
      })
    }
  })

export type SalaryInput = z.infer<typeof upsertSchema>

export async function upsertSalary(input: SalaryInput): Promise<ActionResult<{ id: number }>> {
  const parsed = upsertSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }
  const { id, ...row } = parsed.data
  const sb = getSupabaseServer()

  if (id) {
    const { error } = await sb.from("salary_schedule").update(row).eq("id", id)
    if (error) return fail(humanize(error))
    revalidatePath("/salary-schedule")
    return ok({ id })
  }

  const { data, error } = await sb
    .from("salary_schedule")
    .insert(row)
    .select("id")
    .single()
  if (error) return fail(humanize(error))
  revalidatePath("/salary-schedule")
  return ok({ id: data.id as number })
}

export async function deleteSalary(id: number): Promise<ActionResult> {
  const sb = getSupabaseServer()
  const { error } = await sb.from("salary_schedule").delete().eq("id", id)
  if (error) return fail(describeError(error))
  revalidatePath("/salary-schedule")
  return ok()
}

const raiseSchema = z.object({
  user_id: z.string().uuid("Pick a user"),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the raise date"),
  annual_salary: z.number().nonnegative(),
  annual_bonus: z.number().nonnegative().default(0),
  benefits_multiplier: z.number().positive(),
  notes: z.string().nullable().optional(),
})

export type RaiseInput = z.infer<typeof raiseSchema>

/**
 * Two-step "record raise":
 *   1) end-date the user's currently active row (effective_to is NULL)
 *      to the day BEFORE the new effective_from
 *   2) insert the new row starting at effective_from
 *
 * NOTE: not strictly atomic — Supabase JS doesn't expose a transaction.
 * If step 2 fails we attempt to roll back step 1. For full atomicity, move
 * this into a Postgres function (TODO: sql/06_admin_functions.sql) and call
 * it via .rpc("record_raise", ...).
 */
export async function recordRaise(input: RaiseInput): Promise<ActionResult> {
  const parsed = raiseSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }
  const { user_id, effective_from, ...rest } = parsed.data

  const newFrom = new Date(effective_from)
  if (Number.isNaN(newFrom.getTime())) return fail("Invalid raise date")

  // Day before the raise — that's the new effective_to for the prior active row.
  const dayBefore = new Date(newFrom)
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1)
  const dayBeforeIso = dayBefore.toISOString().slice(0, 10)

  if (dayBeforeIso >= effective_from) {
    return fail("Could not compute the day before the raise date")
  }

  const sb = getSupabaseServer()

  // Step 0: find the current active row (effective_to IS NULL) for this user.
  const { data: current, error: findErr } = await sb
    .from("salary_schedule")
    .select("id, effective_from, effective_to")
    .eq("user_id", user_id)
    .is("effective_to", null)
    .maybeSingle()
  if (findErr) return fail(describeError(findErr))

  if (current && current.effective_from > dayBeforeIso) {
    return fail(
      `The user's current active period starts ${current.effective_from}. Pick a raise date after that.`,
    )
  }

  // Step 1: end-date the current row, if any.
  let prevRowId: number | null = null
  if (current) {
    const { error } = await sb
      .from("salary_schedule")
      .update({ effective_to: dayBeforeIso })
      .eq("id", current.id)
    if (error) return fail(humanize(error))
    prevRowId = current.id
  }

  // Step 2: insert the new row.
  const { error: insertErr } = await sb.from("salary_schedule").insert({
    user_id,
    effective_from,
    effective_to: null,
    annual_salary: rest.annual_salary,
    annual_bonus: rest.annual_bonus,
    benefits_multiplier: rest.benefits_multiplier,
    notes: rest.notes ?? null,
  })

  if (insertErr) {
    // Best-effort rollback on the previous row's end-date.
    if (prevRowId !== null) {
      await sb.from("salary_schedule").update({ effective_to: null }).eq("id", prevRowId)
    }
    return fail(humanize(insertErr))
  }

  revalidatePath("/salary-schedule")
  return ok()
}

function humanize(err: { code?: string; message?: string; details?: string; hint?: string }): string {
  if (err.code === "23P01" || (err.message ?? "").includes("salary_schedule_no_overlap")) {
    return "User already has a salary record covering this period. Adjust the dates so the periods don't overlap."
  }
  if (err.code === "23514" && (err.message ?? "").includes("salary_schedule_period_valid")) {
    return "Effective-to must be on or after effective-from."
  }
  return describeError(err)
}
