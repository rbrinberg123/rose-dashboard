import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import type {
  ClientDetailRecentNoteRow,
  ClientDetailSummaryRow,
} from "@/lib/types"
import {
  buildClientDataBlock,
  buildSummaryFields,
  containsMoneyAmount,
  SUMMARY_SYSTEM_PROMPT,
} from "@/lib/client-summary-prompt"

/**
 * Shared AI client-summary generation. Both routes call into here so the single
 * route (/api/client-summary) and the nightly batch (/api/client-summary/
 * refresh-all) can never drift in how a summary is produced or cached.
 *
 * ONE summary per client, shown to EVERYONE — there is no per-viewer variant.
 * Because a reader may lack the Financials permission, the summary must never
 * contain a money amount: the retainer is withheld from the model's input
 * entirely AND the prompt forbids monetary figures. Renewal / term-end DATES are
 * allowed. Summaries cached BEFORE this change may still mention amounts until
 * they are regenerated (the nightly refresh, or /api/client-summary/refresh-all).
 *
 * Server-only: uses ANTHROPIC_API_KEY and the service_role Supabase client.
 */

export const SUMMARY_MODEL = "claude-haiku-4-5-20251001"

// How many of the most recent touchpoints to feed the model.
const RECENT_TOUCHPOINTS = 5
// How many of the longest recent touchpoints to tag as "[longest]" so the model
// can decide whether their duration genuinely stands out.
const LONGEST_TO_TAG = 2

/**
 * Carries an HTTP status so the single route can map failures to a response.
 *
 * `upstreamStatus` preserves the ORIGINAL Anthropic status (429 rate-limited,
 * 529 overloaded, 5xx transient) when there was one, so the batch route can
 * tell "back off and retry this" apart from "this client is broken". Undefined
 * for our own errors (missing client, cache write failure) — those are not
 * retried.
 */
export class ClientSummaryError extends Error {
  status: number
  upstreamStatus?: number
  constructor(message: string, status: number, upstreamStatus?: number) {
    super(message)
    this.name = "ClientSummaryError"
    this.status = status
    this.upstreamStatus = upstreamStatus
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

/** One active client plus the timestamp of its last cached summary (null if never). */
export type ClientRefreshCandidate = {
  account_id: string
  ai_summary_generated_at: string | null
}

/**
 * The active clients to consider for a refresh, each paired with when its
 * summary was last generated. Same active set as listActiveClientIds (the
 * v_client_detail_summary view), joined to the cache timestamp on accounts.
 */
export async function listActiveClientsForRefresh(
  sb: SupabaseClient,
): Promise<ClientRefreshCandidate[]> {
  const accountIds = await listActiveClientIds(sb)
  if (accountIds.length === 0) return []

  const { data, error } = await sb
    .from("accounts")
    .select("account_id, ai_summary_generated_at")
    .in("account_id", accountIds)
  if (error) {
    throw new ClientSummaryError(
      `Failed to read summary timestamps: ${error.message}`,
      500,
    )
  }

  const generatedAtById = new Map<string, string | null>(
    (data ?? []).map((r) => [
      r.account_id as string,
      (r.ai_summary_generated_at as string | null) ?? null,
    ]),
  )
  // Drive off the active list so order is stable and every active client is
  // present even if its accounts row somehow lacks a timestamp.
  return accountIds.map((id) => ({
    account_id: id,
    ai_summary_generated_at: generatedAtById.get(id) ?? null,
  }))
}

// The Dynamics-mirrored tables that feed a client summary. Each has a
// client_account_id and a modified_on (Dynamics' own modifiedon, refreshed by
// the 07:00 sync before this batch runs at 08:00), so "any row modified after
// the last summary" is our change signal.
const CHANGE_SOURCE_TABLES = [
  "meetings",
  "touchpoints",
  "client_notes",
  "contracts",
] as const

/** True if any row for this client in `table` was modified after `since`. */
async function hasChangeSince(
  sb: SupabaseClient,
  table: string,
  accountId: string,
  since: string,
): Promise<boolean> {
  const { count, error } = await sb
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("client_account_id", accountId)
    .gt("modified_on", since)
  if (error) {
    throw new ClientSummaryError(
      `Failed to check ${table} for changes: ${error.message}`,
      500,
    )
  }
  return (count ?? 0) > 0
}

/**
 * Decide whether a client's summary needs regenerating. Stale when it has never
 * been generated, when it is older than `thresholdDays` (a freshness floor), or
 * when any underlying record (meeting / touchpoint / note / contract) changed
 * since it was generated. Otherwise fresh-and-unchanged → skip the paid call.
 *
 * Uses only cheap Supabase count queries (not the Anthropic API), short-circuit-
 * ing on the first source table that shows a change.
 */
export async function isClientSummaryStale(
  sb: SupabaseClient,
  candidate: ClientRefreshCandidate,
  thresholdDays: number,
): Promise<boolean> {
  const generatedAt = candidate.ai_summary_generated_at
  if (!generatedAt) return true

  const ageMs = Date.now() - new Date(generatedAt).getTime()
  if (ageMs > thresholdDays * 24 * 60 * 60 * 1000) return true

  for (const table of CHANGE_SOURCE_TABLES) {
    if (await hasChangeSince(sb, table, candidate.account_id, generatedAt)) {
      return true
    }
  }
  return false
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

  // The retainer is deliberately NOT among these fields — see
  // lib/client-summary-prompt.ts. One summary is shown to EVERYONE, including
  // people without the Financials permission, so the strongest guarantee that
  // no dollar figure appears is that the model never sees one. The renewal
  // DATE stays: dates are not gated.
  let clientData = buildClientDataBlock(
    buildSummaryFields({
      clientName: summary.client_name,
      clientSince: summary.client_since,
      lifetimeMeetings: summary.lifetime_meetings,
      trailing12m,
      upcomingConfirmed,
      ltmUniqueInstitutions: summary.ltm_unique_institutions,
      latestTermEnd: summary.latest_term_end,
      noteDate: note?.note_date ?? null,
      noteText: note?.notes_text ?? null,
      noteStatus: note?.status_text ?? null,
      noteRiskDriver: note?.primary_risk_driver ?? null,
    }),
  )

  const touchpointsBlock = buildTouchpointsBlock(touchpoints)
  if (touchpointsBlock) {
    clientData += `\n\nRecent touchpoints (most recent first):\n${touchpointsBlock}`
  }

  let summaryText: string
  try {
    const message = await anthropic.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 400,
      system: SUMMARY_SYSTEM_PROMPT,
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
        err.status,
      )
    }
    throw err
  }

  // TRIPWIRE: the summary is shown to everyone, so a money amount slipping
  // through is a permission leak. We log loudly rather than rewriting the text
  // (silently editing a cached summary would hide a prompt regression).
  if (containsMoneyAmount(summaryText)) {
    console.error(
      "[client-summary] generated summary for",
      accountId,
      "appears to contain a money amount — it is shown to users WITHOUT the Financials permission. Review the prompt:",
      summaryText,
    )
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
