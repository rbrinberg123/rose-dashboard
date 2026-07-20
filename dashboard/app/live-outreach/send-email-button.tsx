"use client"

import * as React from "react"
import { Send, Loader2, Check, AlertTriangle } from "lucide-react"

type State = "idle" | "sending" | "sent" | "error"

/**
 * Sends the current Live Outreach digest on demand by POSTing to
 * /api/live-outreach/send-email (which builds the HTML server-side and sends it
 * as dashboards@ to the interim recipient).
 *
 * Double-send protection: the button DISABLES itself while a send is in flight
 * (and the click handler early-returns if already sending), so a rapid
 * double-click can't fire two emails. The server also rejects overlapping sends
 * with 429 as a backstop.
 *
 * Styling mirrors the neighbouring CopyEmailButton (same height/border/shadow),
 * with green = sent and red = failed, matching that button's success palette.
 */
export function SendEmailButton() {
  const [state, setState] = React.useState<State>("idle")
  const [message, setMessage] = React.useState<string | null>(null)

  async function handleSend() {
    if (state === "sending") return // guard: no second send while one is running
    setState("sending")
    setMessage(null)

    try {
      const res = await fetch("/api/live-outreach/send-email", { method: "POST" })
      if (res.ok) {
        setState("sent")
      } else {
        let detail = `Send failed (${res.status}).`
        try {
          const body = await res.json()
          if (body && typeof body.error === "string") detail = body.error
        } catch {
          // non-JSON body — keep the generic status message
        }
        setMessage(detail)
        setState("error")
      }
    } catch {
      setMessage("Network error — could not reach the server.")
      setState("error")
    }

    // Revert to idle after a moment so the button is reusable.
    window.setTimeout(() => {
      setState("idle")
      setMessage(null)
    }, 3500)
  }

  const sending = state === "sending"
  const sent = state === "sent"
  const error = state === "error"

  const label = sending ? "Sending…" : sent ? "Sent" : error ? "Failed" : "Send email"
  const Icon = sending ? Loader2 : sent ? Check : error ? AlertTriangle : Send

  return (
    <button
      type="button"
      onClick={handleSend}
      disabled={sending}
      title={error && message ? message : undefined}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed"
      style={{
        background: sent ? "#E7F5EE" : error ? "#FDE7E7" : "#FFFFFF",
        borderColor: sent ? "#A7DABE" : error ? "#E7B8B8" : "#E6E9EF",
        color: sent ? "#0E7C56" : error ? "#A32D2D" : "#1E2858",
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
        opacity: sending ? 0.7 : 1,
      }}
      aria-live="polite"
    >
      <Icon className={`size-4${sending ? " animate-spin" : ""}`} />
      {label}
    </button>
  )
}
