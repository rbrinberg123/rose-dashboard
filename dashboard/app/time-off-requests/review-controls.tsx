"use client"

/**
 * Approve / Deny for one PENDING time-off request, with an optional review
 * comment. Used by the Time Off drawer and the Alerts "Time Off Approvals"
 * section. It only calls reviewTimeOffRequest — the server decides whether the
 * caller may (super_user, not in View as, on the requester's reviewing team,
 * not the requester). `disabledReason` merely explains a button that would be
 * refused anyway.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { reviewTimeOffRequest } from "./actions"

export function ReviewControls({
  id,
  disabledReason,
  onDone,
  compact,
}: {
  id: string
  disabledReason?: string | null
  onDone?: (status: string) => void
  /** Alerts rows: buttons only, the comment box opens on demand. */
  compact?: boolean
}) {
  const router = useRouter()
  const [comments, setComments] = React.useState("")
  const [showComment, setShowComment] = React.useState(!compact)
  const [pending, startTransition] = React.useTransition()
  const disabled = pending || !!disabledReason

  function decide(decision: "Approved" | "Denied") {
    startTransition(async () => {
      const r = await reviewTimeOffRequest(id, decision, comments)
      if (!r.ok) {
        toast.error(`Could not ${decision === "Approved" ? "approve" : "deny"}`, { description: r.error })
        return
      }
      toast.success(decision === "Approved" ? "Request approved" : "Request denied")
      router.refresh()
      onDone?.(r.data.status)
    })
  }

  return (
    <div className="grid gap-1.5" title={disabledReason ?? undefined}>
      {showComment && (
        <Input
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="Review comment (optional)"
          disabled={disabled}
          className="h-8 text-sm"
        />
      )}
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => decide("Approved")}
          className="h-7 bg-[#0E7C56] px-2.5 text-[12px] text-white hover:bg-[#0E7C56]/90"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          Approve
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => decide("Denied")}
          className="h-7 px-2.5 text-[12px] text-[#B42318]"
        >
          <X className="size-3.5" /> Deny
        </Button>
        {!showComment && !disabledReason && (
          <button
            type="button"
            onClick={() => setShowComment(true)}
            className="text-[11px] text-muted-foreground hover:text-foreground hover:underline"
          >
            + comment
          </button>
        )}
      </div>
      {disabledReason && <div className="text-[11px] text-muted-foreground">{disabledReason}</div>}
    </div>
  )
}
