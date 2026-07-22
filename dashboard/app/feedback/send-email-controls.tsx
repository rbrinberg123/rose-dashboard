"use client"

import * as React from "react"
import { Send, Loader2, Check, AlertTriangle, Mail, X } from "lucide-react"

type State = "idle" | "sending" | "sent" | "error"

const BASE_BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed"

/** Idle/sent/error styling shared by both send buttons. */
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

/** POST the digest send. Returns an error string on failure, null on success. */
async function postSend(payload: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/feedback/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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
 * Outstanding Feedback digest send controls:
 *
 *  • "Send Email"      → the REAL send to the whole team (team@rosecoglobal.com,
 *    a server-owned constant). Guarded by a confirm() dialog so a stray click
 *    can't blast everyone.
 *  • "Send Test Email" → opens an input for ANY address and sends the same
 *    digest to just that address (prefilled with the current user's email). No
 *    confirmation — it only goes where you type.
 *
 * Each button disables itself while its send is in flight; the server also
 * rejects overlapping sends (429) and gates on super_user.
 */
export function SendEmailControls({ userEmail }: { userEmail?: string }) {
  const [teamState, setTeamState] = React.useState<State>("idle")
  const [teamMsg, setTeamMsg] = React.useState<string | null>(null)

  const [testOpen, setTestOpen] = React.useState(false)
  const [testRecipient, setTestRecipient] = React.useState(userEmail ?? "")
  const [testState, setTestState] = React.useState<State>("idle")
  const [testMsg, setTestMsg] = React.useState<string | null>(null)

  async function handleTeamSend() {
    if (teamState === "sending") return
    const ok = window.confirm(
      "Send the Outstanding Feedback digest to the ENTIRE team (team@rosecoglobal.com)?",
    )
    if (!ok) return

    setTeamState("sending")
    setTeamMsg(null)
    const err = await postSend({ mode: "team" })
    if (err) {
      setTeamMsg(err)
      setTeamState("error")
    } else {
      setTeamState("sent")
    }
    window.setTimeout(() => {
      setTeamState("idle")
      setTeamMsg(null)
    }, 3500)
  }

  async function handleTestSend() {
    if (testState === "sending") return
    const recipient = testRecipient.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setTestMsg("Enter a valid email address.")
      setTestState("error")
      window.setTimeout(() => {
        setTestState("idle")
        setTestMsg(null)
      }, 3000)
      return
    }

    setTestState("sending")
    setTestMsg(null)
    const err = await postSend({ mode: "test", recipient })
    if (err) {
      setTestMsg(err)
      setTestState("error")
    } else {
      setTestState("sent")
    }
    window.setTimeout(() => {
      setTestState("idle")
      setTestMsg(null)
    }, 3500)
  }

  const teamSending = teamState === "sending"
  const teamLabel =
    teamState === "sending" ? "Sending…"
      : teamState === "sent" ? "Sent"
      : teamState === "error" ? "Failed"
      : "Send Email"
  const TeamIcon =
    teamState === "sending" ? Loader2
      : teamState === "sent" ? Check
      : teamState === "error" ? AlertTriangle
      : Send

  const testSending = testState === "sending"
  const testLabel =
    testState === "sending" ? "Sending…"
      : testState === "sent" ? "Sent"
      : testState === "error" ? "Failed"
      : "Send"
  const TestSendIcon =
    testState === "sending" ? Loader2
      : testState === "sent" ? Check
      : testState === "error" ? AlertTriangle
      : Send

  return (
    <div className="flex items-center gap-2">
      {/* Real send — to the whole team, behind a confirm dialog. */}
      <button
        type="button"
        onClick={handleTeamSend}
        disabled={teamSending}
        title={teamState === "error" && teamMsg ? teamMsg : "Send to the entire team"}
        className={BASE_BTN}
        style={btnStyle(teamState)}
        aria-live="polite"
      >
        <TeamIcon className={`size-4${teamSending ? " animate-spin" : ""}`} />
        {teamLabel}
      </button>

      {/* Test send — to a typed address, no confirmation. */}
      {testOpen ? (
        <div className="flex items-center gap-1.5">
          <input
            type="email"
            value={testRecipient}
            onChange={(e) => setTestRecipient(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTestSend()
              if (e.key === "Escape") setTestOpen(false)
            }}
            placeholder="you@example.com"
            autoFocus
            className="h-9 w-56 rounded-md border px-2.5 text-sm outline-none"
            style={{ borderColor: "#E6E9EF", color: "#1E2858" }}
          />
          <button
            type="button"
            onClick={handleTestSend}
            disabled={testSending}
            title={testState === "error" && testMsg ? testMsg : "Send test to this address"}
            className={BASE_BTN}
            style={btnStyle(testState)}
            aria-live="polite"
          >
            <TestSendIcon className={`size-4${testSending ? " animate-spin" : ""}`} />
            {testLabel}
          </button>
          <button
            type="button"
            onClick={() => setTestOpen(false)}
            title="Close"
            className="inline-flex h-9 items-center rounded-md border px-2 transition-colors"
            style={{ background: "#FFFFFF", borderColor: "#E6E9EF", color: "#6B7280" }}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setTestOpen(true)
            if (!testRecipient && userEmail) setTestRecipient(userEmail)
          }}
          title="Send a test copy to an address you choose"
          className={BASE_BTN}
          style={btnStyle("idle")}
        >
          <Mail className="size-4" />
          Send Test Email
        </button>
      )}
    </div>
  )
}
