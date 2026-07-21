"use client"

import * as React from "react"
import { Send, Loader2, Check, AlertTriangle, Mail, X } from "lucide-react"

type State = "idle" | "sending" | "sent" | "error"

const BASE_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed"

/** Idle/sent/error styling, matching the Live Outreach send buttons. */
function btnStyle(state: State): React.CSSProperties {
  const sent = state === "sent"
  const error = state === "error"
  return {
    background: sent ? "#E7F5EE" : error ? "#FDE7E7" : "#FFFFFF",
    borderColor: sent ? "#A7DABE" : error ? "#E7B8B8" : "#E6E9EF",
    color: sent ? "#0E7C56" : error ? "#A32D2D" : "#1E2858",
    boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
    opacity: state === "sending" ? 0.7 : 1,
  }
}

/** POST the test send. Returns an error string on failure, null on success. */
async function postTestSend(recipient: string): Promise<string | null> {
  try {
    const res = await fetch("/api/feedback/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "test", recipient }),
    })
    if (res.ok) return null
    let detail = `Send failed (${res.status}).`
    try {
      const body = await res.json()
      if (body && typeof body.error === "string") detail = body.error
    } catch {
      // non-JSON body — keep the generic status message
    }
    return detail
  } catch {
    return "Network error — could not reach the server."
  }
}

/**
 * Outstanding Feedback digest — TEST send only (this stage).
 *
 * Opens an input for ANY address and sends the same digest to just that address
 * (prefilled with the current user's email). No confirmation — it only goes
 * where you type. The team send + cron come later; the server also gates on
 * super_user and rejects overlapping sends (429).
 */
export function SendTestEmailButton({ userEmail }: { userEmail?: string }) {
  const [open, setOpen] = React.useState(false)
  const [recipient, setRecipient] = React.useState(userEmail ?? "")
  const [state, setState] = React.useState<State>("idle")
  const [msg, setMsg] = React.useState<string | null>(null)

  async function handleSend() {
    if (state === "sending") return
    const to = recipient.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setMsg("Enter a valid email address.")
      setState("error")
      window.setTimeout(() => {
        setState("idle")
        setMsg(null)
      }, 3000)
      return
    }

    setState("sending")
    setMsg(null)
    const err = await postTestSend(to)
    if (err) {
      setMsg(err)
      setState("error")
    } else {
      setState("sent")
    }
    window.setTimeout(() => {
      setState("idle")
      setMsg(null)
    }, 3500)
  }

  const sending = state === "sending"
  const label =
    state === "sending" ? "Sending…"
      : state === "sent" ? "Sent"
      : state === "error" ? "Failed"
      : "Send"
  const Icon =
    state === "sending" ? Loader2
      : state === "sent" ? Check
      : state === "error" ? AlertTriangle
      : Send

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          if (!recipient && userEmail) setRecipient(userEmail)
        }}
        title="Send a test copy to an address you choose"
        className={BASE_BTN}
        style={btnStyle("idle")}
      >
        <Mail className="size-4" />
        Send Test Email
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="email"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSend()
          if (e.key === "Escape") setOpen(false)
        }}
        placeholder="you@example.com"
        autoFocus
        className="h-9 w-56 rounded-md border px-2.5 text-sm outline-none"
        style={{ borderColor: "#E6E9EF", color: "#1E2858" }}
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={sending}
        title={state === "error" && msg ? msg : "Send test to this address"}
        className={BASE_BTN}
        style={btnStyle(state)}
        aria-live="polite"
      >
        <Icon className={`size-4${sending ? " animate-spin" : ""}`} />
        {label}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        title="Close"
        className="inline-flex h-9 items-center rounded-md border px-2 transition-colors"
        style={{ background: "#FFFFFF", borderColor: "#E6E9EF", color: "#6B7280" }}
      >
        <X className="size-4" />
      </button>
    </div>
  )
}
