"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Check, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { reviewTimeOffRequest } from "@/app/time-off-requests/actions"
import { TimeOffPane } from "@/app/time-off-requests/time-off-requests-view"

/**
 * The time-off request drawer, hosted on My Dashboard's Time Off Approvals card
 * — the SAME TimeOffPane (with its Approve / Deny ReviewControls) the CRM Time
 * Off page uses, opened in `approval` mode so it reads through
 * loadTimeOffApprovalRecord: any reviewer of the requester may open it, not
 * only super users. Approve / Deny is enforced server-side by
 * reviewTimeOffRequest (reviewing team, not the requester, not in View as).
 * After a decision ReviewControls refreshes the page, so the row drops off the
 * card and the nav badge recounts.
 */

const OpenTimeOffContext = React.createContext<((id: string) => void) | null>(null)

export function TimeOffDrawerHost({ children }: { children: React.ReactNode }) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  const close = React.useCallback(() => setOpenId(null), [])
  return (
    <OpenTimeOffContext.Provider value={setOpenId}>
      {children}
      {openId && <TimeOffPane key={openId} id={openId} source="Dashboard" onClose={close} approval />}
    </OpenTimeOffContext.Provider>
  )
}

const RULE = "rgba(16,24,40,0.07)"

/**
 * One Time Off Approvals row: click the row → the full approval drawer; the
 * inline buttons are the fast path.
 *   Approve — one click, then an inline "Confirm", → approved.
 *   Deny    — never instant: opens an inline reason prompt (required), → denied
 *             with that reason as the review comment.
 * Both are OPTIMISTIC (the row disappears at once, comes back with an error
 * toast if the server refuses) and call the same reviewTimeOffRequest as the
 * drawer and CRM → Time Off — so who may act is enforced server-side (reviewing
 * team, not the requester, not in View as). On success the page refreshes, so
 * the card count, the "critical" pill and the nav badge all recount.
 */
export function TimeOffApprovalRow({
  id,
  requester,
  canAct,
  children,
}: {
  id: string
  requester: string
  /** Show the inline buttons (false in "View as"). The server decides anyway. */
  canAct: boolean
  children: React.ReactNode
}) {
  const open = React.useContext(OpenTimeOffContext)
  const router = useRouter()
  const [gone, setGone] = React.useState(false)
  const [mode, setMode] = React.useState<"idle" | "confirm" | "deny">("idle")
  const [reason, setReason] = React.useState("")
  const [, startTransition] = React.useTransition()

  if (gone) return null

  function decide(decision: "Approved" | "Denied", comment?: string) {
    setGone(true) // optimistic
    startTransition(async () => {
      const r = await reviewTimeOffRequest(id, decision, comment)
      if (!r.ok) {
        setGone(false)
        setMode("idle")
        toast.error(`Could not ${decision === "Approved" ? "approve" : "deny"}`, { description: r.error })
        return
      }
      toast.success(`${requester}'s request ${decision === "Approved" ? "approved" : "denied"}`)
      router.refresh()
    })
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <div>
      <div className="flex items-stretch">
        <div
          role="button"
          tabIndex={0}
          onClick={() => open?.(id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              open?.(id)
            }
          }}
          className="min-w-0 flex-1 cursor-pointer transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
        >
          {children}
        </div>
        {canAct && (
          <div
            className="flex shrink-0 items-center gap-1 pr-3"
            style={{ borderBottom: "1px solid " + RULE }}
            onClick={stop}
          >
            {mode === "confirm" ? (
              <>
                <Button type="button" size="xs" onClick={() => decide("Approved")}>
                  <Check /> Confirm
                </Button>
                <Button type="button" size="xs" variant="ghost" onClick={() => setMode("idle")}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => setMode("confirm")}
                  aria-label={`Approve ${requester}'s request`}
                >
                  <Check /> Approve
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="text-[#B42318]"
                  onClick={() => setMode(mode === "deny" ? "idle" : "deny")}
                  aria-label={`Deny ${requester}'s request`}
                >
                  <X /> Deny
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {canAct && mode === "deny" && (
        <form
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: "1px solid " + RULE, background: "#FDF6F5" }}
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim()) decide("Denied", reason.trim())
          }}
        >
          <Input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Reason for denying ${requester}'s request (required)`}
            className="h-7 flex-1 text-xs"
          />
          <Button type="submit" size="xs" variant="destructive" disabled={!reason.trim()}>
            Deny
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={() => setMode("idle")}>
            Cancel
          </Button>
        </form>
      )}
    </div>
  )
}

/** A dashboard row that opens its request in the drawer instead of navigating. */
export function OpenTimeOffRow({ id, children }: { id: string; children: React.ReactNode }) {
  const open = React.useContext(OpenTimeOffContext)
  return (
    <button
      type="button"
      onClick={() => open?.(id)}
      className="block w-full cursor-pointer text-left transition-colors hover:bg-[rgba(16,24,40,0.02)] focus:outline-none focus-visible:bg-[rgba(16,24,40,0.04)]"
    >
      {children}
    </button>
  )
}
