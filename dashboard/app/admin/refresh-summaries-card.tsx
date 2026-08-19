"use client"

import * as React from "react"
import { Loader2, Sparkles, Check, AlertTriangle } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import {
  applyBatch,
  buildBatchUrl,
  describeProgress,
  describeResult,
  initialProgress,
  isComplete,
  shouldContinue,
  type RefreshBatchResponse,
  type RefreshProgress,
} from "@/lib/client-summary-refresh"

/**
 * Admin → Maintenance → "Refresh all AI summaries".
 *
 * Regenerates every active client's AI summary using the prompt the SERVER is
 * running — click it on production and production summaries are rewritten with
 * the deployed prompt. Use it after a prompt change; the nightly cron only ever
 * touches stale clients and is left completely alone by this button.
 *
 * It generates nothing itself. It drives the existing
 * /api/client-summary/refresh-all route in small batches — exactly what
 * scripts/refresh-summaries.mjs does from the command line — so pacing, the
 * per-client 429/529 backoff, and the resume window all come from the route.
 * Short requests mean no single call can hit a serverless timeout.
 *
 * Auth: the fetches carry the session cookie and the route authorizes them with
 * requireSuperUser(), so the cron bearer token never touches the browser. The
 * server is the gate — this card being rendered is not.
 *
 * Safety: paid action, so it asks first. A ref-based lock (not just the
 * disabled attribute) makes a double-click or a second concurrent run
 * impossible, and the campaign timestamp is fixed at start, so a run that is
 * interrupted (closed tab, network drop) resumes rather than restarts when the
 * button is clicked again.
 */

type Phase = "idle" | "running" | "done" | "error"

export function RefreshSummariesCard({ clientCount }: { clientCount: number | null }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [progress, setProgress] = React.useState<RefreshProgress>(initialProgress)
  const [error, setError] = React.useState<string | null>(null)
  // The authoritative concurrency lock. React state updates are async, so the
  // disabled prop alone can still let a fast double-click through; this ref
  // flips synchronously.
  const runningRef = React.useRef(false)

  const countLabel = clientCount == null ? "all" : `~${clientCount.toLocaleString()}`

  async function run() {
    if (runningRef.current) return
    runningRef.current = true

    // Fixed for the whole campaign: the route regenerates only clients whose
    // summary predates it, so each pass skips what earlier passes finished —
    // and so does a later re-run after an interruption.
    const before = new Date().toISOString()

    setPhase("running")
    setError(null)
    let current = initialProgress()
    setProgress(current)

    try {
      for (;;) {
        const res = await fetch(buildBatchUrl(before), {
          method: "POST",
          cache: "no-store",
        })
        const body = (await res.json().catch(() => ({}))) as RefreshBatchResponse & {
          error?: string
        }

        // 200 = all good, 207 = some clients failed but the batch ran.
        if (res.status !== 200 && res.status !== 207) {
          throw new Error(
            body.error ??
              (res.status === 401 || res.status === 403
                ? "Not authorized — sign in as a super user and try again."
                : `The refresh route returned ${res.status}.`),
          )
        }

        current = applyBatch(current, body)
        setProgress(current)

        if (!shouldContinue(current, body)) {
          if (!isComplete(current)) {
            throw new Error(
              "No client regenerated in that pass, so the run stopped rather than retrying forever. " +
                "Check the server logs (ANTHROPIC_API_KEY, quota), then run it again to resume.",
            )
          }
          break
        }
      }
      setPhase("done")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPhase("error")
    } finally {
      runningRef.current = false
    }
  }

  const running = phase === "running"

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 p-4 ${CARD_CLASS}`}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#EEF2FB] text-[#1E2858]">
        <Sparkles className="size-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="font-medium" style={{ color: TEXT_PRIMARY }}>
          Refresh all AI summaries
        </div>
        <p className="text-xs" style={{ color: TEXT_MUTED }}>
          Regenerate every client summary with the current prompt. Run this after a prompt change —
          the nightly job only refreshes stale clients.
        </p>

        {/* Live progress / result line */}
        {phase !== "idle" ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs" aria-live="polite">
            {running ? (
              <>
                <Loader2 className="size-3.5 shrink-0 animate-spin" style={{ color: "#0355A7" }} />
                <span style={{ color: "#0355A7" }}>{describeProgress(progress)}</span>
              </>
            ) : phase === "done" ? (
              <>
                <Check className="size-3.5 shrink-0" style={{ color: "#0E7C56" }} />
                <span style={{ color: "#0E7C56" }}>{describeResult(progress)}</span>
              </>
            ) : (
              <>
                <AlertTriangle className="size-3.5 shrink-0" style={{ color: "#C53030" }} />
                <span style={{ color: "#C53030" }}>
                  {error}
                  {progress.done > 0
                    ? ` (${progress.done} regenerated before stopping — re-run to resume.)`
                    : ""}
                </span>
              </>
            )}
          </p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={running}
        className="ml-auto shrink-0 rounded-md bg-[#1E2858] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#0355A7] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {running ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            Regenerating…
          </span>
        ) : (
          "Refresh all AI summaries"
        )}
      </button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Regenerate {countLabel} client {clientCount === 1 ? "summary" : "summaries"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This calls the AI once per client and may take a few minutes. It costs API money and
              overwrites every existing summary with a freshly generated one, using the prompt this
              server is running. Keep this tab open until it finishes — if it is interrupted, run it
              again and it picks up where it stopped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={running}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={running} onClick={() => void run()}>
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
