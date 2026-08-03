import { type NextRequest, NextResponse } from "next/server"
import { requireSuperUser } from "@/lib/api-auth"
import { sendMail, GraphError } from "@/lib/graph"
import { loadTimeOffData } from "@/lib/time-off/load"
import { buildTimeOffEmailHtml } from "@/lib/time-off/email-html"
import { claimDailySend, releaseDailySend } from "@/lib/live-outreach-send-log"

/**
 * Weekly "Time Off" digest email — two entry points, two auth models (mirrors
 * app/api/week-ahead/send-email):
 *
 *  • POST — manual send from the dashboard. Gated to a signed-in **super_user**
 *    (requireSuperUser). Body picks the recipients:
 *      { mode: "team" }                 → the four server-owned TIME_OFF_RECIPIENTS
 *      { mode: "test", recipient: "…" } → a single typed address (test only)
 *    The team list is ALWAYS the server constant; the test box can never override
 *    it. An explicit mode is required, so a malformed/empty authenticated POST
 *    can never fall through to a team blast.
 *
 *  • GET — the Vercel scheduled cron (Mondays). Gated by the CRON_SECRET bearer
 *    (Vercel attaches `Authorization: Bearer ${CRON_SECRET}` automatically).
 *    Sends to TIME_OFF_RECIPIENTS. DST-safe: the cron fires at BOTH 12:00 and
 *    13:00 UTC and this handler only proceeds when it is actually Monday 8:00–8:59
 *    AM Eastern — so exactly one of the two fires sends (12:00 UTC = 8:00 EDT in
 *    summer, 13:00 UTC = 8:00 EST in winter). A persistent once-per-day claim
 *    (cron_send_log, its OWN job_key) is a second guard against a rare duplicate.
 *
 * Sends AS dashboards@ (MAIL_SENDER, fixed by the Graph Application Access Policy).
 * Every path makes exactly ONE sendMail call = ONE email (all recipients in one
 * message, no loops).
 */

export const dynamic = "force-dynamic"

const TIME_ZONE = "America/New_York"

/**
 * The four fixed recipients the scheduled Monday digest AND the "Send Email"
 * button both target. Server-owned — the client cannot override it (the test box
 * only feeds the "test" path). DELIBERATELY separate from every other digest's
 * recipient constant, so changing it here never redirects those.
 */
export const TIME_OFF_RECIPIENTS = [
  "simon@roseandco.com",
  "robert@roseandco.com",
  "blair@roseandco.com",
  "scott@roseandco.com",
]

/** Idempotency key for the scheduled once-per-day send (cron_send_log.job_key). */
const CRON_JOB_KEY = "time_off_digest"

/** In-flight lock: true while a manual send is running, to block overlapping sends. */
let sending = false

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

/** Build + send the current digest to the given recipient(s). Throws on failure. */
async function sendDigestTo(recipients: string[]): Promise<{ subject: string }> {
  const { data, error } = await loadTimeOffData()
  if (error || !data) throw new Error(`Could not load v_time_off: ${error ?? "no data"}`)

  const html = buildTimeOffEmailHtml(data)
  const subject = `Time Off — Week of ${data.mondayLabel}`

  // ONE sendMail call, ONE email — every recipient in a single toRecipients array.
  await sendMail({ recipients, subject, html })
  return { subject }
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

  // Choose recipient(s) from the body. An explicit mode is required.
  let body: { mode?: string; recipient?: string } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    // no/invalid JSON body → rejected below (mode is required)
  }

  // Require an explicit mode so a malformed/empty authenticated POST can NEVER
  // fall through to a team blast. The test box can only feed the "test" path.
  let recipients: string[]
  if (body.mode === "test") {
    const typed = typeof body.recipient === "string" ? body.recipient.trim() : ""
    if (!isValidEmail(typed)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 })
    }
    recipients = [typed]
  } else if (body.mode === "team") {
    recipients = TIME_OFF_RECIPIENTS
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
    const { subject } = await sendDigestTo(recipients)
    return NextResponse.json({ ok: true, sentTo: recipients, subject })
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

  // DST-safe time gate: only the fire that lands at Monday 8:00–8:59 AM Eastern
  // proceeds. The two UTC fires are an hour apart, so exactly one passes.
  const now = easternNow(new Date())
  const isMonday = now.weekday === 1
  const inWindow = now.hour === 8
  if (!isMonday || !inWindow) {
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
    const { subject } = await sendDigestTo(TIME_OFF_RECIPIENTS)
    return NextResponse.json({ ok: true, sentTo: TIME_OFF_RECIPIENTS, subject, date: now.date })
  } catch (err) {
    // Send failed after claiming — release the claim so a later retry can resend.
    await releaseDailySend(CRON_JOB_KEY, now.date).catch(() => {})
    return errorResponse(err)
  }
}
