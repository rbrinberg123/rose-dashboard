"use client"

/**
 * Schedule health (header button + popover) and Finalise (dialog).
 *
 * The checks (lib/events-planner/core.ts checkSchedule) run in the browser on
 * every change, so the count is always current; clicking an issue jumps to its
 * day / item / block. Finalise re-runs the same checks on the server, refuses
 * while any error remains, and needs the warnings acknowledged.
 */

import * as React from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { STATUS_PILL_LIGHT } from "@/lib/design"
import { healthSummary, type Issue, type IssueSeverity } from "@/lib/events-planner/core"
import { useBuilder } from "./builder-context"
import { finalizeItinerary } from "./builder-actions"

const TONE: Record<IssueSeverity, { bg: string; fg: string; Icon: React.ElementType; label: string }> = {
  error: { bg: STATUS_PILL_LIGHT.atRisk.bg, fg: STATUS_PILL_LIGHT.atRisk.text, Icon: AlertCircle, label: "Errors" },
  warning: { bg: STATUS_PILL_LIGHT.watch.bg, fg: STATUS_PILL_LIGHT.watch.text, Icon: AlertTriangle, label: "Warnings" },
  info: { bg: STATUS_PILL_LIGHT.new.bg, fg: STATUS_PILL_LIGHT.new.text, Icon: Info, label: "Notes" },
}

function IssueList({ issues, onPick }: { issues: Issue[]; onPick?: (i: Issue) => void }) {
  return (
    <div className="grid gap-3">
      {(["error", "warning", "info"] as const).map((sev) => {
        const list = issues.filter((i) => i.severity === sev)
        if (!list.length) return null
        const t = TONE[sev]
        return (
          <div key={sev} className="grid gap-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: t.fg }}>
              <t.Icon className="size-3.5" /> {t.label} ({list.length})
            </div>
            {list.map((i, k) => (
              <button
                key={`${i.code}-${k}`}
                type="button"
                disabled={!onPick || (!i.itemId && !i.blockId && !i.dayId)}
                onClick={() => onPick?.(i)}
                className="rounded-md px-2 py-1.5 text-left text-xs enabled:hover:brightness-95"
                style={{ background: t.bg, color: t.fg }}
              >
                {i.message}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}

export function HealthButton() {
  const { issues, jumpTo } = useBuilder()
  const [open, setOpen] = React.useState(false)
  const errors = issues.filter((i) => i.severity === "error").length
  const warnings = issues.filter((i) => i.severity === "warning").length
  const tone = errors ? TONE.error : warnings ? TONE.warning : null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            style={tone ? { background: tone.bg, color: tone.fg, borderColor: "transparent" } : undefined}
          />
        }
      >
        {tone ? <tone.Icon className="size-4" /> : <CheckCircle2 className="size-4" />} {healthSummary(issues)}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[70vh] w-[26rem] overflow-y-auto p-3">
        <div className="mb-2 text-sm font-semibold">Schedule health</div>
        {issues.length === 0 ? (
          <div className="text-sm text-muted-foreground">No problems found. Checks re-run on every change.</div>
        ) : (
          <IssueList
            issues={issues}
            onPick={(i) => {
              setOpen(false)
              jumpTo(i)
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

export function FinaliseButton() {
  const { itin, issues, readOnly, mutate, setItin } = useBuilder()
  const [open, setOpen] = React.useState(false)
  const [ack, setAck] = React.useState(false)
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const errors = issues.filter((i) => i.severity === "error")
  const warnings = issues.filter((i) => i.severity === "warning")
  const alreadyFinal = itin.status === "finalized" || itin.status === "invites_sent"

  async function onConfirm() {
    setPending(true)
    setError(null)
    const r = await mutate(null, () => finalizeItinerary(itin.id, ack), (d) =>
      setItin((s) => ({ ...s, status: d.status, version: d.version })),
    )
    setPending(false)
    if (!r.ok) return setError(r.error)
    toast.success(`Finalised — version ${r.data.version}`)
    setOpen(false)
  }

  if (readOnly) return null
  return (
    <>
      <Button
        size="sm"
        onClick={() => {
          setAck(false)
          setError(null)
          setOpen(true)
        }}
        disabled={alreadyFinal}
        title={alreadyFinal ? "Already finalised — any edit sends it back to review" : undefined}
      >
        <ShieldCheck className="size-4" /> {alreadyFinal ? `Finalised v${itin.version}` : "Finalise"}
      </Button>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Finalise this itinerary?</DialogTitle>
            <DialogDescription>
              Finalising locks in version {itin.version + 1} and saves a snapshot of the schedule. Any later edit sends it back
              to review.
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[50vh] gap-3 overflow-y-auto pr-1">
            {errors.length > 0 ? (
              <>
                <div className="text-sm">Fix these first — an itinerary with errors can&apos;t be finalised:</div>
                <IssueList issues={errors} />
              </>
            ) : warnings.length > 0 ? (
              <>
                <IssueList issues={warnings} />
                <label className="flex items-start gap-2 text-sm">
                  <Checkbox checked={ack} onCheckedChange={(c) => setAck(c === true)} className="mt-0.5" />
                  I&apos;ve reviewed these {warnings.length} warning{warnings.length === 1 ? "" : "s"} and want to finalise anyway.
                </label>
              </>
            ) : (
              <div className="text-sm text-muted-foreground">No errors or warnings.</div>
            )}
          </div>
          {error && <div className="text-sm text-destructive">{error}</div>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onConfirm} disabled={pending || errors.length > 0 || (warnings.length > 0 && !ack)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null} Finalise
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
