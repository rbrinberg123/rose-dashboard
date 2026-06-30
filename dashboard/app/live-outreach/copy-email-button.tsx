"use client"

import * as React from "react"
import { format } from "date-fns"
import { Clipboard, Check, AlertTriangle } from "lucide-react"
import { buildEmailHtml, buildEmailPlain } from "./email-html"
import type { LiveOutreachRow } from "@/lib/types"

type State = "idle" | "copied" | "manual"

/**
 * Copies the rendered selection of an offscreen element. This mirrors the manual
 * "open in browser → select all → copy" flow: it writes both text/html (keeping
 * the formatting) and text/plain, and pastes as formatted content into Outlook.
 * Works across Chrome/Edge/Firefox. Returns false if the copy command fails.
 */
function copyViaSelection(html: string): boolean {
  const container = document.createElement("div")
  container.setAttribute("contenteditable", "true")
  container.innerHTML = html
  // Offscreen but still rendered (display:none would not be selectable).
  container.style.position = "fixed"
  container.style.left = "-99999px"
  container.style.top = "0"
  container.style.opacity = "0"
  container.style.pointerEvents = "none"
  document.body.appendChild(container)

  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(container)
  selection?.removeAllRanges()
  selection?.addRange(range)

  let ok = false
  try {
    ok = document.execCommand("copy")
  } catch {
    ok = false
  }
  selection?.removeAllRanges()
  document.body.removeChild(container)
  return ok
}

export function CopyEmailButton({ rows }: { rows: LiveOutreachRow[] }) {
  const [state, setState] = React.useState<State>("idle")

  async function handleCopy() {
    const today = format(new Date(), "MMMM d, yyyy")
    const html = buildEmailHtml(rows, today)
    const plain = buildEmailPlain(rows, today)

    // 1) Primary: rendered-selection copy (best fidelity for Outlook paste).
    if (copyViaSelection(html)) {
      flash("copied")
      return
    }

    // 2) Fallback: Clipboard API write of text/html + text/plain.
    try {
      if (navigator.clipboard && typeof window.ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new window.ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ])
        flash("copied")
        return
      }
    } catch {
      // fall through to manual
    }

    // 3) Last resort: open the email HTML in a new tab for manual select-all/copy.
    const w = window.open("", "_blank")
    if (w) {
      w.document.write(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Live Outreach — copy this</title></head><body style="margin:0;padding:24px;background:#fff;">` +
          `<p style="font-family:Arial,sans-serif;font-size:13px;color:#555;">Automatic copy was blocked by your browser. Select all (Ctrl+A), copy (Ctrl+C), then paste into Outlook.</p>` +
          html +
          `</body></html>`,
      )
      w.document.close()
    }
    flash("manual")
  }

  function flash(next: State) {
    setState(next)
    window.setTimeout(() => setState("idle"), 2500)
  }

  const label =
    state === "copied" ? "Copied!" : state === "manual" ? "Opened — copy manually" : "Copy for Email"
  const Icon = state === "copied" ? Check : state === "manual" ? AlertTriangle : Clipboard
  const copied = state === "copied"

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors"
      style={{
        background: copied ? "#E7F5EE" : "#FFFFFF",
        borderColor: copied ? "#A7DABE" : "#E6E9EF",
        color: copied ? "#0E7C56" : "#1E2858",
        boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
      }}
      aria-live="polite"
    >
      <Icon className="size-4" />
      {label}
    </button>
  )
}
