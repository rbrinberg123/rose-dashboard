"use client"

/**
 * Deactivate / Reactivate for ONE client — used by the Clients record drawer
 * (app/accounts/account-record-pane.tsx) and the Client Detail "deactivated"
 * notice (app/client-detail/deactivated-notice.tsx).
 *
 * Renders nothing unless the server said the viewer may act (`state.canManage`,
 * from lib/accounts/deactivation-gate.ts). Hiding the button is cosmetic: the
 * actions re-run the same gate before writing.
 */

import * as React from "react"
import { toast } from "sonner"
import { Ban, RotateCcw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { deactivateClient, reactivateClient } from "@/app/accounts/actions"
import {
  DEACTIVATION_REASON_MAX,
  type ClientDeactivationState,
} from "@/lib/accounts/deactivation"

export function ClientDeactivationControl({
  state,
  onDone,
  size = "sm",
}: {
  state: ClientDeactivationState
  /** Called after a successful deactivate / reactivate. */
  onDone: () => void
  size?: "sm" | "default"
}) {
  const [open, setOpen] = React.useState(false)
  const [reason, setReason] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  if (!state.canManage) return null
  const deactivated = !!state.deactivatedAt
  const name = state.name ?? "this client"

  const run = async () => {
    setBusy(true)
    const res = deactivated
      ? await reactivateClient({ accountId: state.accountId })
      : await deactivateClient({ accountId: state.accountId, reason })
    setBusy(false)
    if (!res.ok) {
      toast.error(deactivated ? "Couldn't reactivate" : "Couldn't deactivate", { description: res.error })
      return
    }
    toast.success(deactivated ? `${name} reactivated` : `${name} deactivated`)
    setOpen(false)
    setReason("")
    onDone()
  }

  const small = size === "sm"
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={deactivated ? "outline" : "destructive"}
        className={small ? "h-6 px-2 text-[11px]" : undefined}
        onClick={() => setOpen(true)}
      >
        {deactivated ? <RotateCcw className="size-3" /> : <Ban className="size-3" />}
        {deactivated ? "Reactivate" : "Deactivate"}
      </Button>

      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deactivated ? `Reactivate ${name}?` : `Deactivate ${name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deactivated
                ? "It becomes an active client again: back in Portfolio, Client Detail, the active counts and the Client pickers."
                : "It stops counting as an active client: it leaves Portfolio, Client Detail, the active counts and the Client pickers. Nothing is deleted. Its events, meetings, contacts and tasks are untouched, and it stays in the Clients table as Inactive so it can be reactivated."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {!deactivated && (
            <div className="space-y-1">
              <label htmlFor="deactivation-reason" className="text-[12px] font-medium text-[#1A2233]">
                Reason <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <Textarea
                id="deactivation-reason"
                value={reason}
                maxLength={DEACTIVATION_REASON_MAX}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Contract ended"
                rows={3}
                disabled={busy}
              />
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant={deactivated ? "default" : "destructive"}
              disabled={busy}
              onClick={() => void run()}
            >
              {busy ? "Saving…" : deactivated ? "Reactivate" : "Deactivate"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** "Deactivated 10/12/2026 by Jane Doe" — Eastern, matching the drawer's dates. */
export function describeDeactivation(state: Pick<ClientDeactivationState, "deactivatedAt" | "deactivatedBy">): string {
  if (!state.deactivatedAt) return ""
  const d = new Date(state.deactivatedAt)
  const when = Number.isNaN(d.getTime())
    ? state.deactivatedAt
    : new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        month: "numeric",
        day: "numeric",
        year: "numeric",
      }).format(d)
  return `Deactivated ${when}${state.deactivatedBy ? ` by ${state.deactivatedBy}` : ""}`
}
