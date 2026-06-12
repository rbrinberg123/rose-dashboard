import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ClientDetailRecentNoteRow,
  ClientDetailSummaryRow,
} from "@/lib/types"

/**
 * Shared AI client-summary generation. Both routes call into here so the single
 * route (/api/client-summary) and the nightly batch (/api/client-summary/
 * refresh-all) can never drift in how a summary is produced or cached.
 *
 * Server-only: uses ANTHROPIC_API_KEY and the service_role Supabase client.
 */

export const SUMMARY_MODEL = "claude-haiku-4-5-20251001"

// Meeting-pace guideline: ~60 confirmed meetings/year. We only ever tell the
// model "low" / "normal" / "high" / "too_new" — it never sees these thresholds
// and never does the math itself.
const PACE_LOW = 40
const PACE_HIGH = 80

export type PaceFlag = "too_new" | "low" | "normal" | "high"

/** Carries an HTTP status so the single route can map failures to a response. */
export class ClientSummaryError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = "ClientSummaryError"
    this.status = status
  }
}

export type ClientSummaryResult = {
  accountId: string
  clientName: string
  summary: string
  generatedAt: string
  paceFlag: PaceFlag
  monthsActive: number
  meetingsToDate: number
  trailing12m: number
  upcomingConfirmed: number
  clientData: string
}

/** Whole months between two dates (floored), e.g. Jan 15 -> Jul 10 = 5. */
function monthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth())
  if (to.getUTCDate() < from.getUTCDate()) months -= 1
  return Math.max(0, months)
}

function bandFromAnnualized(value: number): PaceFlag {
  if (value < PACE_LOW) return "low"
  if (value > PACE_HIGH) return "high"
  return "normal"
}

/**
 * Tenure-aware pace flag, computed server-side so the model never does this
 * arithmetic.
 *   < 6 months active        -> "too_new" (do not comment on pace)
 *   6–12 months              -> annualize meetings-so-far, then band it
 *   12+ months               -> trailing-12m + confirmed-upcoming, then band it
 */
function computePaceFlag(args: {
  monthsActive: number
  meetingsToDate: number
  trailing12m: number
  upcomingConfirmed: number
}): PaceFlag {
  const { monthsActive, meetingsToDate, trailing12m, upcomingConfirmed } = args
  if (monthsActive < 6) return "too_new"
  if (monthsActive < 12) {
    const annualized = (meetingsToDate / monthsActive) * 12
    return bandFromAnnualized(annualized)
  }
  return bandFromAnnualized(trailing12m + upcomingConfirmed)
}

const SYSTEM_PROMPT =
  "You are writing a brief relationship summary for an investor-relations advisory firm's internal dashboard. Below is structured data about one corporate client. Write a 2–3 sentence summary that helps an account manager quickly understand the state of this relationship.\n\n" +
  "Guidelines:\n\n" +
  "Be factual and concise. Use only the data provided — do not invent details, numbers, or events. If a field is missing or null, omit it; do not speculate.\n" +
  "Lead with the most important signal about the relationship.\n" +
  "Mention how long they've been a client (from the start date).\n" +
  "Reflect the most recent client note and its sentiment if present.\n" +
  'Only remark on meeting pace if the pace flag is "low" or "high": if "low," note meeting activity appears unusually light; if "high," note it is unusually active. If the flag is "normal" or "too_new," do not mention pace at all. Never state whether they are precisely "on track." Never comment on meeting pace for a client active less than six months, regardless of any flag.\n' +
  'Do not give explicit recommendations (no "you should…"). Describe the state; let the reader draw conclusions.\n' +
  "Neutral, professional tone. No bullet points — 2–3 flowing sentences. Don't restate every number; synthesize."

/** Render only the non-null fields so the model never sees "null". */
function buildClientDataBlock(
  fields: Record<string, string | number | null>,
): string {
  const lines: string[] = []
  for (const [label, value] of Object.entries(fields)) {
    if (value === null || value === "") continue
    lines.push(`${label}: ${value}`)
  }
  return lines.join("\n")
}

/**
 * The active clients that should have summaries — the same set the rest of the
 * app treats as active (v_client_detail_summary = accounts.state_label
 * 'Active'). One row per active client; we only need the ids here.
 */
export async function listActiveClientIds(
  sb: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await sb
    .from("v_client_detail_summary")
    .select("account_id")
    .order("client_name", { ascending: true })
  if (error) {
    throw new ClientSummaryError(
      `Failed to list active clients: ${error.message}`,
      500,
    )
  }
  return (data ?? []).map((r) => r.account_id as string)
}

/**
 * Generate the summary for ONE client and write it to the cache columns
 * (accounts.ai_summary / ai_summary_generated_at). Throws ClientSummaryError on
 * any failure so callers can decide how to surface it (HTTP status vs. batch
 * tally). The single route and the batch route both go through here.
 */
export async function generateAndCacheClientSummary(
  sb: SupabaseClient,
  anthropic: Anthropic,
  accountId: string,
): Promise<ClientSummaryResult> {
  const todayIso = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC, like the SQL views)
  const twelveMonthsAgo = new Date()
  twelveMonthsAgo.setUTCMonth(twelveMonthsAgo.getUTCMonth() - 12)
  const twelveMonthsAgoIso = twelveMonthsAgo.toISOString().slice(0, 10)

  // Reuse the same Client Detail views the page uses for the display fields, and
  // count confirmed meetings directly for the pace math. The summary view's
  // ltm_meetings has no upper date bound (it folds in future-dated confirmed
  // meetings), so we compute clean past-vs-upcoming counts here instead.
  const [summaryRes, noteRes, toDateRes, trailing12mRes, upcomingRes] =
    await Promise.all([
      sb
        .from("v_client_detail_summary")
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle(),
      sb
        .from("v_client_detail_recent_note")
        .select("*")
        .eq("account_id", accountId)
        .maybeSingle(),
      sb
        .from("meetings")
        .select("*", { count: "exact", head: true })
        .eq("client_account_id", accountId)
        .eq("meeting_status_label", "Confirmed")
        .lte("meeting_date", todayIso),
      sb
        .from("meetings")
        .select("*", { count: "exact", head: true })
        .eq("client_account_id", accountId)
        .eq("meeting_status_label", "Confirmed")
        .gte("meeting_date", twelveMonthsAgoIso)
        .lt("meeting_date", todayIso),
      sb
        .from("meetings")
        .select("*", { count: "exact", head: true })
        .eq("client_account_id", accountId)
        .eq("meeting_status_label", "Confirmed")
        .gte("meeting_date", todayIso),
    ])

  const dbError =
    summaryRes.error ??
    noteRes.error ??
    toDateRes.error ??
    trailing12mRes.error ??
    upcomingRes.error
  if (dbError) {
    throw new ClientSummaryError(dbError.message, 500)
  }

  const summary = summaryRes.data as ClientDetailSummaryRow | null
  if (!summary) {
    throw new ClientSummaryError(
      `No active client found for account_id ${accountId}`,
      404,
    )
  }
  const note = noteRes.data as ClientDetailRecentNoteRow | null

  const meetingsToDate = toDateRes.count ?? 0
  const trailing12m = trailing12mRes.count ?? 0
  const upcomingConfirmed = upcomingRes.count ?? 0

  const clientSince = summary.client_since
    ? new Date(summary.client_since)
    : null
  const monthsActive = clientSince ? monthsBetween(clientSince, new Date()) : 0

  const paceFlag: PaceFlag = clientSince
    ? computePaceFlag({
        monthsActive,
        meetingsToDate,
        trailing12m,
        upcomingConfirmed,
      })
    : "too_new"

  const feedbackRate =
    summary.ltm_feedback_rate === null
      ? null
      : `${Math.round(summary.ltm_feedback_rate * 100)}%`

  const clientData = buildClientDataBlock({
    "Client name": summary.client_name,
    "Client since": summary.client_since,
    "Lifetime meetings": summary.lifetime_meetings,
    "Trailing-12-month meetings": trailing12m,
    "Confirmed upcoming meetings": upcomingConfirmed,
    "Institutions met (last 12 months)": summary.ltm_unique_institutions,
    "Feedback received rate (last 12 months)": feedbackRate,
    "Annualized retainer (USD)": summary.annualized_retainer
      ? Math.round(summary.annualized_retainer)
      : null,
    "Contract renewal date": summary.latest_term_end,
    "Most recent client note date": note?.note_date ?? null,
    "Most recent client note": note?.notes_text ?? null,
    "Client note status / sentiment": note?.status_text ?? null,
    "Primary risk driver": note?.primary_risk_driver ?? null,
    "Meeting pace flag": paceFlag,
  })

  let summaryText: string
  try {
    const message = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Client data:\n\n${clientData}` }],
    })
    summaryText = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new ClientSummaryError(
        `Anthropic API error ${err.status}: ${err.message}`,
        502,
      )
    }
    throw err
  }

  // Persist to the cache columns. The Dynamics sync upsert only writes mapped
  // columns (see lib/sync/mappers.ts), so these survive every sync.
  const generatedAt = new Date().toISOString()
  const { error: cacheError } = await sb
    .from("accounts")
    .update({ ai_summary: summaryText, ai_summary_generated_at: generatedAt })
    .eq("account_id", accountId)
  if (cacheError) {
    throw new ClientSummaryError(
      `Generated the summary but failed to cache it: ${cacheError.message}`,
      500,
    )
  }

  return {
    accountId,
    clientName: summary.client_name,
    summary: summaryText,
    generatedAt,
    paceFlag,
    monthsActive,
    meetingsToDate,
    trailing12m,
    upcomingConfirmed,
    clientData,
  }
}
