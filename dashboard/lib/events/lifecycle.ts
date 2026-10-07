/**
 * The event LIFECYCLE as the drawer's stepper draws it. PURE — no I/O.
 *
 * The stage itself is computed by the DATABASE, not here
 * (event_lifecycle_stage in sql/patches/2026-10-07e_event_lifecycle.sql) and
 * persisted into events.event_state_label, so every existing filter and view
 * keeps working. This module only knows the ORDER of the steps, so the
 * stepper can mark which are done, which is current, and which are ahead.
 *
 * Labels are the stored event_state_label values exactly. "Pause" is not a
 * step: it overrides whichever step the event would otherwise be on.
 *
 * See content/docs/13-events.md ("Computed lifecycle").
 */

export const EVENT_LIFECYCLE_STEPS = [
  "Pre-Launch",
  "Live Outreach",
  "Schedule Closed",
  "Meetings Ongoing",
  "Preparing Feedback",
  "Complete",
] as const

export type EventLifecycleStep = (typeof EVENT_LIFECYCLE_STEPS)[number]

export const EVENT_PAUSE_LABEL = "Pause"

/** One-line "how you get here" for each step — the stepper's hover text. */
export const EVENT_LIFECYCLE_HINTS: Record<EventLifecycleStep, string> = {
  "Pre-Launch": "Default — Launch is not ticked",
  "Live Outreach": "Launch ticked",
  "Schedule Closed": "Launch + Outreach Complete ticked, meetings not started",
  "Meetings Ongoing": "Meetings start date reached; stays until every meeting date has passed",
  "Preparing Feedback": "Every (non-cancelled) meeting date has passed",
  Complete: "Every feedback report and its send/review task is closed",
}

/**
 * Index of the stage on the stepper, or -1 when the label is not a step
 * (Pause, blank, or an unknown future value).
 */
export function lifecycleIndex(label: string | null | undefined): number {
  const s = (label ?? "").trim()
  return EVENT_LIFECYCLE_STEPS.findIndex((step) => step === s)
}

export function isPausedStage(label: string | null | undefined): boolean {
  return (label ?? "").trim() === EVENT_PAUSE_LABEL
}

/**
 * The step a PAUSED event would be on if un-paused, from its toggles alone —
 * the furthest the toggles reach. Used only to show where a paused event sits
 * on the stepper; the date / meeting / feedback steps beyond Schedule Closed
 * need the database and are applied when the pause is lifted.
 */
export function stepFromToggles(launch: boolean | null | undefined, outreachComplete: boolean | null | undefined): EventLifecycleStep {
  if (!launch) return "Pre-Launch"
  if (!outreachComplete) return "Live Outreach"
  return "Schedule Closed"
}
