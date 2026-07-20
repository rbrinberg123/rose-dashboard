import { NextResponse } from "next/server"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { sendMail, GraphError } from "@/lib/graph"
import { loadLiveOutreachRows } from "@/app/live-outreach/load"
import { buildEmailHtml } from "@/app/live-outreach/email-html"

/**
 * POST /api/live-outreach/send-email — send the CURRENT Live Outreach digest as
 * an on-demand email (as dashboards@) to the interim recipient.
 *
 * Auth: `/api/*` bypasses the Supabase auth proxy (see proxy.ts), so this route
 * self-gates — it requires a valid signed-in session (401 otherwise). The
 * dashboard is staff-only behind login, so an authenticated caller = staff.
 *
 * Single send: exactly ONE sendMail call (one email) per invocation. A
 * module-level in-flight lock rejects overlapping calls with 429 so a rapid
 * double-click can't fire two emails; the Stage-3 button also disables itself
 * while a send is in progress. (The lock is per warm server instance — fine for
 * this manual admin action, where a double-click hits the same instance.)
 */

export const dynamic = "force-dynamic"

const TIME_ZONE = "America/New_York"

// Interim recipient — hardcoded for now. TODO: make configurable later (e.g. a
// distribution list, or a recipient chosen in the UI).
const RECIPIENT = "scott@roseandco.com"

/** In-flight lock: true while a send is running, to block overlapping sends. */
let sending = false

/** e.g. "July 20, 2026" in US Eastern, matching the on-page digest label. */
function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date())
}

export async function POST() {
  // --- Auth gate: require a valid signed-in session -------------------------
  // getUser() validates the JWT against Supabase Auth (not just a cookie read).
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 })
  }

  // --- Double-send guard: reject overlapping sends --------------------------
  // The check + set below run synchronously with no await between them, so two
  // near-simultaneous requests can't both pass (Node won't interleave them
  // mid-block). The second gets 429 instead of firing a duplicate email.
  if (sending) {
    return NextResponse.json({ error: "A send is already in progress." }, { status: 429 })
  }
  sending = true

  try {
    const { rows, error } = await loadLiveOutreachRows()
    if (error) {
      return NextResponse.json(
        { error: `Could not load v_live_outreach: ${error}` },
        { status: 500 },
      )
    }

    const label = todayLabel()
    const html = buildEmailHtml(rows, label)
    const subject = `Non-Deal Roadshow Update — ${label}`

    // ONE sendMail call, ONE email to the single recipient.
    await sendMail({ recipients: [RECIPIENT], subject, html })

    return NextResponse.json({ ok: true, sentTo: RECIPIENT, subject, events: rows.length })
  } catch (err) {
    if (err instanceof GraphError) {
      // A 403 here almost certainly means the Application Access Policy rejected
      // the dashboards@ sender (or Mail.Send isn't consented).
      return NextResponse.json(
        { error: "Graph sendMail failed", status: err.status, body: err.body },
        { status: 502 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  } finally {
    // Always release the lock, even on load/send failure, so the next click works.
    sending = false
  }
}
