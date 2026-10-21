import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { ActionStepLink } from "@/lib/tasks/action-step-links"

/**
 * The action_step_tasks links for ONE note — the Most Recent Client Note the
 * page is showing (its client has already passed the page's scope check, so
 * the note's visibility is the page's). Links whose task no longer exists
 * (e.g. a purged test task) are dropped. Fail-soft: any error — including the
 * table not existing yet (sql/patches/2026-10-21_action_step_tasks.sql) —
 * returns [] so the steps simply show "＋ Task".
 */
export async function loadActionStepLinks(sb: SupabaseClient, noteId: string | null): Promise<ActionStepLink[]> {
  if (!noteId) return []
  const { data: links, error } = await sb
    .from("action_step_tasks")
    .select("task_id, step_index, step_text, created_at")
    .eq("note_id", noteId)
  if (error || !links?.length) return []
  const ids = [...new Set(links.map((l) => l.task_id as string))]
  const { data: tasks, error: taskErr } = await sb.from("tasks").select("task_id").in("task_id", ids)
  if (taskErr) return []
  const alive = new Set((tasks ?? []).map((t) => t.task_id as string))
  return links
    .filter((l) => alive.has(l.task_id as string))
    .map((l) => ({
      taskId: l.task_id as string,
      stepIndex: l.step_index as number,
      stepText: l.step_text as string,
      createdAt: l.created_at as string,
    }))
}
