/**
 * Action step → task links (public.action_step_tasks) — the pure half.
 *
 * Client Detail's "＋ Task" on a note action step records which note + step a
 * saved task came from (createTask, on save only). The page reads the links
 * for the note it shows and marks those steps "✓ Task created".
 *
 * See sql/patches/2026-10-21_action_step_tasks.sql and
 * content/docs/02-pages.md → /client-detail.
 */

/** Which note + step a task is being created from (sent with createTask). */
export type ActionStepRef = {
  noteId: string
  /** 0-based position in the semicolon-split action_step. */
  stepIndex: number
  /** The step as shown (trimmed). */
  stepText: string
}

/** One saved link, as read back for the displayed note. */
export type ActionStepLink = {
  taskId: string
  stepIndex: number
  stepText: string
  createdAt: string
}

/** The steps of a note's `action_step` — one semicolon-separated string. */
export function splitActionSteps(actionStep: string | null | undefined): string[] {
  return (actionStep ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Links per step (same order as `steps`), newest first. A link matches the
 * step with the SAME TEXT; a link whose text matches no current step (the
 * note was edited) falls back to its step_index. Pure.
 */
export function matchActionStepLinks(steps: string[], links: ActionStepLink[]): ActionStepLink[][] {
  const out: ActionStepLink[][] = steps.map(() => [])
  for (const link of links) {
    const text = link.stepText.trim()
    let i = steps.indexOf(text)
    if (i === -1 && link.stepIndex >= 0 && link.stepIndex < steps.length) i = link.stepIndex
    if (i !== -1) out[i].push(link)
  }
  for (const list of out) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return out
}
