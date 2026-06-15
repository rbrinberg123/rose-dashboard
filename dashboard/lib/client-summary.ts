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

// How many of the most recent touchpoints to feed the model.
const RECENT_TOUCHPOINTS = 5
// How many of the longest recent touchpoints to tag as "[longest]" so the model
// can decide whether their duration genuinely stands out.
const LONGEST_TO_TAG = 2

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
  monthsActive: number
  trailing12m: number
  upcomingConfirmed: number
  recentTouchpoints: number
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

/** A recent touchpoint as fed to the model. */
type TouchpointRow = {
  touchpoint_type_label: string | null
  subject: string | null
  description: string | null
  scheduled_start: string | null
  actual_duration_minutes: number | null
}

/**
 * Render the recent touchpoints as plain lines for the prompt. The 1–2
 * longest-duration ones are tagged "[longest]" so the model can decide whether
 * their length genuinely stands out — we do not force it to comment.
 * Returns "" when there are no touchpoints to show.
 */
function buildTouchpointsBlock(rows: TouchpointRow[]): string {
  if (rows.length === 0) return ""

  // Indices of the longest 1–2 touchpoints that have a real duration.
  const longest = new Set(
    rows
      .map((r, i) => ({ i, mins: r.actual_duration_minutes }))
      .filter((x): x is { i: number; mins: number } => x.mins != null && x.mins > 0)
      .sort((a, b) => b.mins - a.mins)
      .slice(0, LONGEST_TO_TAG)
      .map((x) => x.i),
  )

  const lines = rows.map((r, i) => {
    const parts: string[] = []
    parts.push(r.touchpoint_type_label ?? "Touchpoint")
    if (r.scheduled_start) parts.push(r.scheduled_start.slice(0, 10))
    if (r.subject) parts.push(r.subject)
    let line = parts.join(" — ")
    if (r.actual_duration_minutes != null)
      line += ` (${r.actual_duration_minutes} min)`
    if (longest.has(i)) line += " [longest]"
    if (r.description) line += `: ${r.description}`
    return `- ${line}`
  })

  return lines.join("\n")
}

const SYSTEM_PROMPT =
  "You are writing a brief relationship summary for an investor-relations advisory firm's internal dashboard. Below is structured data about one corporate client. Write a 2–3 sentence summary that helps an account manager quickly understand the state of this relationship.\n\n" +
  "Guidelines:\n\n" +
  "Be factual, concise, and neutral. Use only the data provided — do not invent details, numbers, or events. If a field is missing or null, omit it; do not speculate. Synthesize; do not recite every field.\n" +
  "State what is true, not how good it is. Do not editorialize or apply subjective labels. Never use phrases like \"valued client,\" \"strong relationship,\" or \"well-positioned,\" and never use any adjective that is a judgment rather than a fact.\n" +
  "Mention how long they have been a client (from the start date).\n" +
  "Reflect the most recent client note and its sentiment if present.\n" +
  "Summarize the recent touchpoints — what kinds of contact have happened and roughly when. Touchpoints tagged \"[longest]\" are the longest-duration recent ones; mention a long touchpoint only if its duration genuinely stands out from the others, and never imply there were tasks or activities beyond the touchpoints listed.\n" +
  "You may state plain facts such as the number of recent meetings, the number of unique institutions met, and upcoming confirmed meetings. Do NOT comment on meeting pace in any way: no \"low\" or \"high,\" no \"light\" or \"active,\" no \"on track\" or \"behind.\" Report counts, never a judgment about them.\n" +
  'Do not give explicit recommendations (no "you should…"). Describe the state; let the reader draw conclusions.\n' +
  "Neutral, professional tone. No bullet points — 2–3 flowing sentences."

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
  // count confirmed meetings directly. The summary view's ltm_meetings has no
  // upper date bound (it folds in future-dated confirmed meetings), so we
  // compute clean trailing-12m and upcoming counts here instead. The recent
  // touchpoints come straight from the base table so we get the description and
  // duration the v_client_detail_touchpoints view omits.
  const [summaryRes, noteRes, trailing12mRes, upcomingRes, touchpointsRes] =
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
        .gte("meeting_date", twelveMonthsAgoIso)
        .lt("meeting_date", todayIso),
      sb
        .from("meetings")
        .select("*", { count: "exact", head: true })
        .eq("client_account_id", accountId)
        .eq("meeting_status_label", "Confirmed")
        .gte("meeting_date", todayIso),
      sb
        .from("touchpoints")
        .select(
          "touchpoint_type_label, subject, description, scheduled_start, actual_duration_minutes",
        )
        .eq("client_account_id", accountId)
        .order("scheduled_start", { ascending: false, nullsFirst: false })
        .limit(RECENT_TOUCHPOINTS),
    ])

  const dbError =
    summaryRes.error ??
    noteRes.error ??
    trailing12mRes.error ??
    upcomingRes.error ??
    touchpointsRes.error
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

  const trailing12m = trailing12mRes.count ?? 0
  const upcomingConfirmed = upcomingRes.count ?? 0
  const touchpoints = (touchpointsRes.data ?? []) as TouchpointRow[]

  const clientSince = summary.client_since
    ? new Date(summary.client_since)
    : null
  const monthsActive = clientSince ? monthsBetween(clientSince, new Date()) : 0

  let clientData = buildClientDataBlock({
    "Client name": summary.client_name,
    "Client since": summary.client_since,
    "Lifetime meetings": summary.lifetime_meetings,
    "Trailing-12-month meetings": trailing12m,
    "Confirmed upcoming meetings": upcomingConfirmed,
    "Institutions met (last 12 months)": summary.ltm_unique_institutions,
    "Annualized retainer (USD)": summary.annualized_retainer
      ? Math.round(summary.annualized_retainer)
      : null,
    "Contract renewal date": summary.latest_term_end,
    "Most recent client note date": note?.note_date ?? null,
    "Most recent client note": note?.notes_text ?? null,
    "Client note status / sentiment": note?.status_text ?? null,
    "Primary risk driver": note?.primary_risk_driver ?? null,
  })

  const touchpointsBlock = buildTouchpointsBlock(touchpoints)
  if (touchpointsBlock) {
    clientData += `\n\nRecent touchpoints (most recent first):\n${touchpointsBlock}`
  }

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
    monthsActive,
    trailing12m,
    upcomingConfirmed,
    recentTouchpoints: touchpoints.length,
    clientData,
  }
}
