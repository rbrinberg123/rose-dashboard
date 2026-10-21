"use client"

import * as React from "react"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TaskDrawerHost, useOpenTask } from "@/app/my-dashboard/task-drawer"
import { NewTaskFromActionStepDialog } from "@/app/tasks/new-task-dialog"
import { BADGE_GRADIENT, CRM_TEAL, CRM_TEAL_BORDER, CRM_TEAL_TINT } from "@/lib/design"
import { matchActionStepLinks, type ActionStepLink, type ActionStepRef } from "@/lib/tasks/action-step-links"

const NAVY_DEEP = "#1E2858"
const CHIP_CLASS =
  "shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0355A7]/40"

/**
 * The Most Recent Client Note's action steps, each with its task button:
 *  - no task yet → "＋ Task" (viewers with Manage on Tasks) opens the create
 *    form pre-filled from the step;
 *  - a task already created from it (action_step_tasks) → "✓ Task created",
 *    which opens that task in the CRM task drawer (the latest, if several),
 *    plus a small "+" that asks "Create another?" before opening a fresh form.
 *    Indicate, don't block.
 * The link is written by createTask on save only; the form's router.refresh()
 * then re-reads the links, so the step flips to "✓ Task created".
 */
export function ActionStepsList(props: {
  steps: string[]
  noteId: string
  clientAccountId: string
  links: ActionStepLink[]
  canCreateTask: boolean
}) {
  return (
    <TaskDrawerHost>
      <Steps {...props} />
    </TaskDrawerHost>
  )
}

function Steps({
  steps,
  noteId,
  clientAccountId,
  links,
  canCreateTask,
}: {
  steps: string[]
  noteId: string
  clientAccountId: string
  links: ActionStepLink[]
  canCreateTask: boolean
}) {
  const openTask = useOpenTask()
  const [creating, setCreating] = React.useState<ActionStepRef | null>(null)
  const [confirmIndex, setConfirmIndex] = React.useState<number | null>(null)
  const linked = React.useMemo(() => matchActionStepLinks(steps, links), [steps, links])

  return (
    <>
      <ul className="space-y-0.5">
        {steps.map((step, i) => {
          const created = linked[i]
          const from = { noteId, stepIndex: i, stepText: step }
          return (
            <li key={`${i}-${step}`} className="flex items-start gap-2">
              <span
                className="mt-[6px] size-1.5 shrink-0 rounded-full"
                style={{ background: BADGE_GRADIENT }}
                aria-hidden="true"
              />
              <span className="min-w-0 flex-1 break-words text-xs leading-relaxed" style={{ color: NAVY_DEEP }}>
                {step}
              </span>
              {created.length > 0 ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openTask?.(created[0].taskId)}
                    title={
                      created.length > 1
                        ? `${created.length} tasks created from this step — opens the latest`
                        : "A task was created from this step — open it"
                    }
                    className={`${CHIP_CLASS} hover:brightness-95`}
                    style={{ backgroundColor: CRM_TEAL_TINT, borderColor: CRM_TEAL_BORDER, color: CRM_TEAL }}
                  >
                    ✓ Task created{created.length > 1 ? ` (${created.length})` : ""}
                  </button>
                  {canCreateTask && (
                    <Popover open={confirmIndex === i} onOpenChange={(o) => setConfirmIndex(o ? i : null)}>
                      <PopoverTrigger
                        title="Create another task from this step"
                        aria-label="Create another task from this step"
                        className={`${CHIP_CLASS} border-[#0355A7]/25 bg-white text-[#0355A7] hover:bg-[#EEF2FB]`}
                      >
                        ＋
                      </PopoverTrigger>
                      <PopoverContent side="top" align="end" className="w-60 gap-2 p-3 text-xs">
                        <p style={{ color: NAVY_DEEP }}>
                          A task was already created from this step. Create another?
                        </p>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setConfirmIndex(null)}
                            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmIndex(null)
                              setCreating(from)
                            }}
                            className="rounded-md bg-[#0355A7] px-2 py-1 font-medium text-white hover:opacity-90"
                          >
                            Create another
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </span>
              ) : (
                canCreateTask && (
                  <button
                    type="button"
                    onClick={() => setCreating(from)}
                    title="Create a task from this action step"
                    className={`${CHIP_CLASS} border-[#0355A7]/25 bg-white text-[#0355A7] hover:bg-[#EEF2FB]`}
                  >
                    ＋ Task
                  </button>
                )
              )}
            </li>
          )
        })}
      </ul>
      {creating && (
        <NewTaskFromActionStepDialog
          clientAccountId={clientAccountId}
          from={creating}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  )
}
