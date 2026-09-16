"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveClientScope } from "@/lib/access/data-scope"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { diffRows, recordAudit } from "@/lib/audit"
import { canEditClientNote } from "./todo-scope"

/**
 * Inline To-Do notes. One row per client, upserted on the PK, so LAST WRITE
 * WINS — whoever saved most recently owns the text. No attribution is stored
 * and nothing is written back to Dynamics.
 *
 * SECURITY: the note is keyed by client, so the write has to be scoped exactly
 * like the read. We re-resolve the caller's client scope server-side on every
 * save (never trusting the id the browser sent) and refuse a client the caller
 * can't see. `canEditClientNote` is the pure decision — see todo-scope.test.ts.
 */
const noteSchema = z.object({
  client_account_id: z.guid(),
  // Blank clears the note. Capped so a runaway paste can't be stored.
  note: z.string().max(4000, "Note is too long (4000 characters max)"),
})

export type ClientTodoNoteInput = z.infer<typeof noteSchema>

export async function saveClientTodoNote(
  input: ClientTodoNoteInput,
): Promise<ActionResult> {
  const parsed = noteSchema.safeParse(input)
  if (!parsed.success) {
    return fail(parsed.error.issues.map((i) => i.message).join("; "))
  }
  const { client_account_id, note } = parsed.data

  const scope = await resolveClientScope(await getEffectiveIdentity())
  if (!canEditClientNote(scope, client_account_id)) {
    return fail("You don't have access to this client.")
  }

  const trimmed = note.trim()
  const nextNote = trimmed === "" ? null : trimmed
  const sb = getSupabaseServer()

  // Prior text, for the audit diff. This table records only `updated_at` — no
  // actor at all — so until now a note's history was unrecoverable: the upsert
  // is last-write-wins and the previous text was simply gone. The trail is the
  // only place that now survives.
  const { data: before } = await sb
    .from("client_todo_notes")
    .select("note")
    .eq("client_account_id", client_account_id)
    .maybeSingle()

  const { error } = await sb
    .from("client_todo_notes")
    .upsert(
      {
        client_account_id,
        note: nextNote,
        // Set explicitly so an INSERT stamps it too (the trigger only fires on
        // UPDATE), keeping "saved N ago" honest on the first save.
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_account_id" },
    )
  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts. `diffRows` returns null when the text is
  // unchanged, so re-saving an untouched note leaves no entry.
  const changes = diffRows(before ?? {}, { note: nextNote })
  if (changes) {
    await recordAudit({
      action: before ? "update" : "create",
      entity: "client_todo_notes",
      recordId: client_account_id,
      changes,
      context: "/clients/to-do",
    })
  }

  revalidatePath("/clients/to-do")
  return ok()
}
