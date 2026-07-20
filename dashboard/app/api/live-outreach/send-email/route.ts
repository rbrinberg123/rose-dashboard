import { type NextRequest, NextResponse } from "next/server"
import { requireSuperUser } from "@/lib/api-auth"
import { sendMail, GraphError } from "@/lib/graph"
import { loadLiveOutreachRows } from "@/app/live-outreach/load"
import { buildEmailHtml } from "@/app/live-outreach/email-html"
import { claimDailySend, releaseDailySend } from "@/lib/live-outreach-send-log"

/**
 * Live Outreach digest email — two entry points, two auth models:
 *
 *  • POST — manual send from the dashboard. Gated to a signed-in **super_user**
 *    (requireSuperUser). Body picks the recipient:
 *      { mode: "team" }                 → the server-owned TEAM_RECIPIENT const
 *      { mode: "test", recipient: "…" } → a single typed address (test only)
 *    The team address is ALWAYS the server constant; the test box can never
 *    override it. Used by the "Send Email" (team) and "Send Test Email" buttons.
 *
 *  • GET — the Vercel scheduled cron (Mon–Fri). Gated by the CRON_SECRET bearer
 *    (Vercel attaches `Authorization: Bearer ${CRON_SECRET}` automatically).
 *    Sends to TEAM_RECIPIENT. DST-safe: the cron fires at BOTH 11:30 and 12:30
 *    UTC and this handler only proceeds when it is actually 7:30–7:59 AM Eastern
 *    — so exactly one of the two fires sends (11:30 UTC = 7:30 EDT in summer,
 *    12:30 UTC = 7:30 EST in winter). A persistent once-per-day claim
 *    (cron_send_log) is a second guard against a rare duplicate delivery.
 *
 * Every path makes exactly ONE sendMail call = ONE email (no loops). sendMail
 * sends AS dashboards@ (MAIL_SENDER, fixed).
 */

export const dynamic = "force-dynamic"

const TIME_ZONE = "America/New_York"

/**
 * The team distribution address the scheduled digest AND the "Send Email" button
 * both target. Server-owned — the client cannot override it (the test box only
 * feeds the "test" path). Note this is a different domain from the sender
 * (dashboards@roseandco.com), i.e. a normal external send.
 */
export const TEAM_RECIPIENT = "team@rosecoglobal.com"

/** Idempotency key for the scheduled once-per-day send (cron_send_log.job_key). */
const CRON_JOB_KEY = "live_outreach_digest"

/** In-flight lock: true while a manual send is running, to block overlapping sends. */
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

/** Current wall-clock in US Eastern: weekday (0=Sun…6=Sat), hour (0–23), minute, and YYYY-MM-DD date. */
function easternNow(d: Date): { weekday: number; hour: number; minute: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ""
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  }
  // hour12:false can emit "24" at midnight in some ICU builds — normalize to 0.
  let hour = parseInt(get("hour"), 10)
  if (hour === 24) hour = 0
  return {
    weekday: weekdayMap[get("weekday")] ?? -1,
    hour,
    minute: parseInt(get("minute"), 10),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  }
}

/** Minimal email-shape check for the test-recipient box. */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

/** Build + send the current digest to exactly one recipient. Throws on failure. */
async function sendDigestTo(recipient: string): Promise<{ subject: string; events: number }> {
  const { rows, error } = await loadLiveOutreachRows()
  if (error) throw new Error(`Could not load v_live_outreach: ${error}`)

  const label = todayLabel()
  const html = buildEmailHtml(rows, label)
  const subject = `Non-Deal Roadshow Update — ${label}`

  // ONE sendMail call, ONE email to the single recipient.
  await sendMail({ recipients: [recipient], subject, html })
  return { subject, events: rows.length }
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

// ---- POST: manual send (super_user) ----------------------------------------
export async function POST(request: NextRequest) {
  const auth = await requireSuperUser()
  if (!auth.ok) return auth.response

  // Choose recipient from the body. Anything other than an explicit, valid
  // "test" send falls through to the server-owned team address.
  let body: { mode?: string; recipient?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // no/invalid JSON body → treated as a team send below
  }

  // Require an explicit mode so a malformed/empty authenticated POST can NEVER
  // fall through to a team blast. The test box can only feed the "test" path.
  let recipient: string
  if (body.mode === "test") {
    const typed = typeof body.recipient === "string" ? body.recipient.trim() : ""
    if (!isValidEmail(typed)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
    }
    recipient = typed
  } else if (body.mode === "team") {
    recipient = TEAM_RECIPIENT
  } else {
    return NextResponse.json(
      { error: "Missing or invalid 'mode' (expected 'team' or 'test')." },
      { status: 400 },
    )
  }

  // Double-send guard: reject overlapping manual sends (check + set are
  // synchronous with no await between, so two near-simultaneous requests can't
  // both pass on the same instance).
  if (sending) {
    return NextResponse.json({ error: "A send is already in progress." }, { status: 429 })
  }
  sending = true
  try {
    const { subject, events } = await sendDigestTo(recipient)
    return NextResponse.json({ ok: true, sentTo: recipient, subject, events })
  } catch (err) {
    return errorResponse(err)
  } finally {
    sending = false
  }
}

// ---- GET: scheduled cron send (CRON_SECRET) --------------------------------
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  // Fail closed: no secret configured → reject everything.
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // DST-safe time gate: only the fire that lands at 7:30–7:59 AM Eastern on a
  // weekday proceeds. The two UTC fires are an hour apart, so exactly one passes.
  const now = easternNow(new Date())
  const isWeekday = now.weekday >= 1 && now.weekday <= 5
  const inWindow = now.hour === 7 && now.minute >= 30
  if (!isWeekday || !inWindow) {
    return NextResponse.json({
      ok: true,
      skipped: "outside-send-window",
      eastern: `${now.date} ${now.hour}:${String(now.minute).padStart(2, "0")} (wd ${now.weekday})`,
    })
  }

  // Persistent once-per-day claim: the first delivery for today wins; a rare
  // duplicate delivery of the same fire finds the row already claimed and skips.
  // Fails closed (won't send) if the ledger can't be written — safer for a
  // team-wide blast than risking a double-send.
  const claim = await claimDailySend(CRON_JOB_KEY, now.date)
  if (!claim.claimed) {
    return NextResponse.json({ ok: true, skipped: claim.reason ?? "already-sent-today", date: now.date })
  }

  try {
    const { subject, events } = await sendDigestTo(TEAM_RECIPIENT)
    return NextResponse.json({ ok: true, sentTo: TEAM_RECIPIENT, subject, events, date: now.date })
  } catch (err) {
    // Send failed after claiming — release the claim so a later retry can resend.
    await releaseDailySend(CRON_JOB_KEY, now.date).catch(() => {})
    return errorResponse(err)
  }
}
