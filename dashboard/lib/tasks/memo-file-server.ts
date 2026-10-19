import "server-only"

import { getSupabaseServer } from "@/lib/supabase"
import type { MemoFileRef } from "@/lib/tasks/record"

/** Shown until sql/patches/2026-10-19_task_memo_file.sql is run. */
export const MEMO_UPLOAD_NOT_SWITCHED_ON =
  "Document upload isn't switched on yet — run sql/patches/2026-10-19_task_memo_file.sql first."

const MEMO_COLS = "memo_file_item_id, memo_file_web_url, memo_file_name, memo_file_uploaded_at, memo_file_uploaded_by_name"

/**
 * A task's stored memo document (tasks.memo_file_*). Read separately from the
 * drawer's other columns so that, before the SQL patch is run, the drawer still
 * opens: a missing column comes back as `unavailable`, not an error.
 */
export async function readMemoFile(
  taskId: string,
): Promise<
  | { ok: true; ref: MemoFileRef | null; itemId: string | null }
  | { ok: false; unavailable: true; error: string }
  | { ok: false; unavailable: false; error: string }
> {
  const { data, error } = await getSupabaseServer().from("tasks").select(MEMO_COLS).eq("task_id", taskId).maybeSingle()
  if (error) {
    if (/memo_file_|does not exist|column/i.test(error.message)) {
      return { ok: false, unavailable: true, error: MEMO_UPLOAD_NOT_SWITCHED_ON }
    }
    return { ok: false, unavailable: false, error: error.message }
  }
  const r = (data ?? {}) as Record<string, string | null>
  const url = r.memo_file_web_url ?? null
  return {
    ok: true,
    itemId: r.memo_file_item_id ?? null,
    ref: url
      ? {
          name: r.memo_file_name ?? null,
          webUrl: url,
          uploadedAt: r.memo_file_uploaded_at ?? null,
          uploadedByName: r.memo_file_uploaded_by_name ?? null,
        }
      : null,
  }
}
