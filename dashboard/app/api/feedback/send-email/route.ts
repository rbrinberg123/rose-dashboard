import { type NextRequest, NextResponse } from "next/server"
import { requireSuperUser } from "@/lib/api-auth"
import { sendMail, GraphError } from "@/lib/graph"
import { loadFeedbackOutstandingRows, loadFeedbackPipelineRows } from "@/app/feedback/load"
import { buildFeedbackEmailHtml } from "@/app/feedback/feedback-email-html"

/**
 * Outstanding Feedback digest email.
 *
 * SCOPE (this stage): TEST SEND ONLY. A signed-in **super_user** can POST
 * { mode: "test", recipient: "…" } to send the real digest (built from live
 * v_feedback_outstanding data) to a single typed address, so the Outlook
 * rendering can be validated before the rest is built.
 *
 * NOT built yet (later stages, mirroring app/api/live-outreach/send-email):
 *   • POST { mode: "team" } → a server-owned TEAM_RECIPIENT constant.
 *   • GET  → the Vercel cron path (CRON_SECRET bearer, Eastern-time window gate,
 *            once-per-day claim in cron_send_log with its OWN job_key). No cron
 *            is scheduled until the template is validated and the user turns it on.
 *
 * Sends AS dashboards@ (MAIL_SENDER, fixed by the Graph Application Access Policy).
 * Every path makes exactly ONE sendMail call = ONE email.
 */

export const dynamic = "force-dynamic"

const TIME_ZONE = "America/New_York"

/** In-flight lock: true while a manual send is running, to block overlapping sends. */
let sending = false

/** e.g. "July 21, 2026" in US Eastern, matching the on-page digest label. */
function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date())
}

/** Minimal email-shape check for the test-recipient box. */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** Build + send the current digest to exactly one recipient. Throws on failure. */
async function sendDigestTo(recipient: string): Promise<{ subject: string; meetings: number }> {
  const { rows, error } = await loadFeedbackOutstandingRows()
  if (error) throw new Error(`Could not load v_feedback_outstanding: ${error}`)

  const { rows: pipelineRows, error: pipelineError } = await loadFeedbackPipelineRows()
  if (pipelineError) throw new Error(`Could not load v_feedback_pipeline: ${pipelineError}`)

  const label = todayLabel()
  const html = buildFeedbackEmailHtml(rows, pipelineRows, label)
  const subject = `Outstanding Feedback — ${label}`

  // ONE sendMail call, ONE email to the single recipient. (An empty outstanding
  // set still sends a valid "nothing outstanding" digest — fine for a test.)
  await sendMail({ recipients: [recipient], subject, html })
  return { subject, meetings: rows.length }
}

/** Map a thrown error to a JSON response, distinguishing Graph failures. */
function errorResponse(err: unknown): NextResponse {
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
}

// ---- POST: manual TEST send (super_user, test mode only) --------------------
export async function POST(request: NextRequest) {
  const auth = await requireSuperUser()
  if (!auth.ok) return auth.response

  let body: { mode?: string; recipient?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // no/invalid JSON body — rejected below (mode is required)
  }

  // Only "test" is wired up right now. Team mode is deliberately NOT built yet,
  // so an authenticated POST can never fall through to a team blast.
  if (body.mode !== "test") {
    return NextResponse.json(
      { error: "Only test sends are enabled right now (expected mode 'test')." },
      { status: 400 },
    )
  }

  const typed = typeof body.recipient === "string" ? body.recipient.trim() : ""
  if (!isValidEmail(typed)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
  }

  // Double-send guard: reject overlapping manual sends (check + set are
  // synchronous with no await between, so two near-simultaneous requests can't
  // both pass on the same instance).
  if (sending) {
    return NextResponse.json({ error: "A send is already in progress." }, { status: 429 })
  }
  sending = true
  try {
    const { subject, meetings } = await sendDigestTo(typed)
    return NextResponse.json({ ok: true, sentTo: typed, subject, meetings })
  } catch (err) {
    return errorResponse(err)
  } finally {
    sending = false
  }
}
