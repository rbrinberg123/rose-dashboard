import Anthropic from "@anthropic-ai/sdk"
import type { SupabaseClient } from "@supabase/supabase-js"
import { listActiveClientIds } from "@/lib/client-summary"
import { withBackoff } from "@/lib/ai-batch"
import {
  buildHealthSystemPrompt,
  HEALTH_OUTPUT_SCHEMA,
  parseHealthOutput,
  type HealthRating,
} from "@/lib/client-health-prompt"

/**
 * Client Health — per-client aggregation, classification and storage.
 *
 * Both entry points go through here: the batch route
 * (/api/client-health/refresh, cron + the page's Refresh button + the per-client
 * "Regenerate" action), so a rating is always produced the same way.
 *
 * STORAGE RULE: a regeneration writes ONLY the ai_* columns (plus run_id and the
 * ai_error pair) of public.client_health_assessments. The upsert never names an
 * override_* column, so a super-user override survives every regeneration.
 *
 * SUPER-USER ONLY. The input includes the retainer, which is fine because the
 * page (/client-health) is in ADMIN_ONLY_ROUTES. Do not surface ai_note anywhere
 * a non-super-user can see it without revisiting that.
 *
 * Server-only: uses ANTHROPIC_API_KEY and the service_role Supabase client.
 */

/** Judgement-heavy synthesis over long free-text notes, so a stronger model
 *  than the summary's Haiku. Stored per row in ai_model. */
export const HEALTH_MODEL = "claude-sonnet-5-5"

export const HEALTH_TABLE = "client_health_assessments"

// Payload bounds — comprehensive but never unbounded.
const MAX_NOTE_CHARS = 3000
const RECENT_TOUCHPOINTS = 15
const MAX_TOUCHPOINT_CHARS = 600
const RECENT_MEETINGS = 20

/** Carries the upstream Anthropic status so the route can back off on 429/529. */
export class ClientHealthError extends Error {
  status: number
  upstreamStatus?: number
  constructor(message: string, status: number, upstreamStatus?: number) {
    super(message)
    this.name = "ClientHealthError"
    this.status = status
    this.upstreamStatus = upstreamStatus
  }
}

/**
 * Active clients still to do in run `runId` — the SAME active set the AI
 * summary and the rest of the app use (v_client_detail_summary =
 * accounts.state_label 'Active'), minus every client this run already rated
 * (run_id = runId) or already tried and failed (ai_error_run_id = runId). That
 * is what makes a run resumable without redoing completed clients.
 */
export async function listPendingForRun(
  sb: SupabaseClient,
  runId: string,
): Promise<{ active: number; pending: string[] }> {
  const ids = await listActiveClientIds(sb)
  const { data, error } = await sb
    .from(HEALTH_TABLE)
    .select("account_id")
    .or(`run_id.eq.${runId},ai_error_run_id.eq.${runId}`)
  if (error) {
    throw new ClientHealthError(`Failed to read ${HEALTH_TABLE}: ${error.message}`, 500)
  }
  const tried = new Set((data ?? []).map((r) => r.account_id as string))
  return { active: ids.length, pending: ids.filter((id) => !tried.has(id)) }
}

/** Is `accountId` an active client? (Never classify an arbitrary id.) */
export async function isActiveClientId(sb: SupabaseClient, accountId: string): Promise<boolean> {
  return (await listActiveClientIds(sb)).includes(accountId)
}

// ---- aggregation -------------------------------------------------------------

type Row = Record<string, unknown>

const day = (v: unknown): string | null =>
  typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null
  const s = v.trim()
  if (!s) return null
  return s.length > max ? `${s.slice(0, max)}…` : s
}

const money = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v)
    ? `$${Math.round(v).toLocaleString("en-US")}`
    : null

/** "Label: value" lines, skipping empty values so the model never sees "null". */
function fieldLines(fields: Record<string, unknown>): string {
  const out: string[] = []
  for (const [k, v] of Object.entries(fields)) {
    if (v === null || v === undefined || v === "") continue
    out.push(`${k}: ${typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}`)
  }
  return out.join("\n")
}

function section(title: string, body: string): string {
  return body.trim() ? `## ${title}\n${body}` : ""
}

/**
 * Assemble the per-client context payload (spec §3). Reuses the portfolio and
 * Client Detail views for synthesized metrics, and reads notes, contracts,
 * touchpoints and meetings directly for the dated detail. Test rows (is_test)
 * are excluded from the mirror tables that carry the flag.
 */
export async function buildClientHealthContext(
  sb: SupabaseClient,
  accountId: string,
): Promise<{ clientName: string; context: string }> {
  const todayIso = new Date().toISOString().slice(0, 10)
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6)
  const sixMonthsAgoIso = sixMonthsAgo.toISOString().slice(0, 10)

  const [
    portfolioRes,
    summaryRes,
    teamRes,
    contractsRes,
    notesRes,
    touchRes,
    pastMeetingsRes,
    futureMeetingsRes,
    cancelledRes,
    eventsRes,
  ] = await Promise.all([
    sb.from("v_client_portfolio").select("*").eq("account_id", accountId).maybeSingle(),
    sb.from("v_client_detail_summary").select("*").eq("account_id", accountId).maybeSingle(),
    sb
      .from("accounts")
      .select(
        "name, sales_lead_primary_name, secondary_manager_name, associate_name, logistics_coordinator_name, state_label",
      )
      .eq("account_id", accountId)
      .maybeSingle(),
    sb
      .from("contracts")
      .select(
        "name, contract_start_date, initial_term_end, contract_renewal_date, contract_termination_date, contract_status_label, auto_renew, renew, renewal_check_in_date, renewal_notice_date, reason_for_termination_label, quarterly_retainer, contract_length_years, notes",
      )
      .eq("client_account_id", accountId)
      .order("contract_start_date", { ascending: true, nullsFirst: true }),
    sb
      .from("client_notes")
      .select(
        "note_date, notes_text, note_body, status_text, primary_risk_driver, action_step, action_owner, action_deadline, owner_name",
      )
      .eq("client_account_id", accountId)
      .eq("is_test", false)
      .order("note_date", { ascending: false, nullsFirst: false }),
    sb
      .from("touchpoints")
      .select("touchpoint_type_label, subject, description, scheduled_start")
      .eq("client_account_id", accountId)
      .eq("is_test", false)
      .order("scheduled_start", { ascending: false, nullsFirst: false })
      .limit(RECENT_TOUCHPOINTS),
    sb
      .from("meetings")
      .select("meeting_date, institution_name, is_in_person")
      .eq("client_account_id", accountId)
      .eq("is_test", false)
      .eq("meeting_status_label", "Confirmed")
      .lt("meeting_date", todayIso)
      .order("meeting_date", { ascending: false })
      .limit(RECENT_MEETINGS),
    sb
      .from("meetings")
      .select("meeting_date, institution_name, meeting_status_label, is_in_person")
      .eq("client_account_id", accountId)
      .eq("is_test", false)
      .gte("meeting_date", todayIso)
      .neq("meeting_status_label", "Cancelled")
      .order("meeting_date", { ascending: true })
      .limit(RECENT_MEETINGS),
    sb
      .from("meetings")
      .select("*", { count: "exact", head: true })
      .eq("client_account_id", accountId)
      .eq("is_test", false)
      .eq("meeting_status_label", "Cancelled")
      .gte("meeting_date", sixMonthsAgoIso),
    sb.from("v_marketing_calendar").select("*").eq("client_account_id", accountId),
  ])

  const dbError =
    portfolioRes.error ??
    summaryRes.error ??
    teamRes.error ??
    contractsRes.error ??
    notesRes.error ??
    touchRes.error ??
    pastMeetingsRes.error ??
    futureMeetingsRes.error ??
    cancelledRes.error
  if (dbError) throw new ClientHealthError(dbError.message, 500)

  const p = (portfolioRes.data ?? {}) as Row
  const s = (summaryRes.data ?? {}) as Row
  const t = (teamRes.data ?? null) as Row | null
  if (!t) throw new ClientHealthError(`No client found for account_id ${accountId}`, 404)
  const clientName = String(t.name ?? p.name ?? s.client_name ?? accountId)

  const parts: string[] = []

  parts.push(
    section(
      "Client",
      fieldLines({
        "Client name": clientName,
        Ticker: p.ticker_symbol,
        "Account status": t.state_label ?? p.account_state,
        "Latest client-note status flag": p.note_status,
        "Status flag as of": day(p.note_status_date),
        Sector: p.sector_label,
        Region: p.region_label,
        "Market cap": p.market_cap_label,
        "Client since": day(s.client_since),
      }),
    ),
  )

  parts.push(
    section(
      "Account team",
      fieldLines({
        "Account manager": t.sales_lead_primary_name,
        "Secondary manager": t.secondary_manager_name,
        Associate: t.associate_name,
        "Logistics coordinator": t.logistics_coordinator_name,
      }),
    ),
  )

  // Contracts: oldest first, so the first is the initial contract and any later
  // ones are renewals.
  const contracts = (contractsRes.data ?? []) as Row[]
  const contractLines = contracts.map((c, i) => {
    const kind = i === 0 ? "Initial contract" : `Renewal #${i}`
    return (
      `- ${kind}: ` +
      [
        c.contract_status_label ? `status ${c.contract_status_label}` : null,
        day(c.contract_start_date) ? `start ${day(c.contract_start_date)}` : null,
        day(c.initial_term_end) ? `initial term end ${day(c.initial_term_end)}` : null,
        day(c.contract_renewal_date) ? `renewal date ${day(c.contract_renewal_date)}` : null,
        day(c.contract_termination_date) ? `termination date ${day(c.contract_termination_date)}` : null,
        c.reason_for_termination_label ? `termination reason ${c.reason_for_termination_label}` : null,
        c.auto_renew === true ? "auto-renew" : c.auto_renew === false ? "no auto-renew" : null,
        c.renew === true ? "marked to renew" : null,
        day(c.renewal_check_in_date) ? `renewal check-in ${day(c.renewal_check_in_date)}` : null,
        day(c.renewal_notice_date) ? `renewal notice ${day(c.renewal_notice_date)}` : null,
        money(c.quarterly_retainer) ? `quarterly retainer ${money(c.quarterly_retainer)}` : null,
        clip(c.notes, 500) ? `notes: ${clip(c.notes, 500)}` : null,
      ]
        .filter(Boolean)
        .join("; ")
    )
  })
  parts.push(
    section(
      "Contract",
      [
        fieldLines({
          "Contracts on record": contracts.length,
          "Initial vs renewal": contracts.length === 0 ? null : contracts.length === 1 ? "Initial term" : `Renewed ${contracts.length - 1} time(s)`,
          "Latest term end / renewal date": day(s.latest_term_end),
          "Days to renewal": s.days_to_renewal,
          "Annualized retainer": money(s.annualized_retainer ?? p.annualized_retainer),
        }),
        contractLines.join("\n"),
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  )

  parts.push(
    section(
      "Meeting activity",
      fieldLines({
        "Lifetime confirmed meetings": s.lifetime_meetings,
        "Meetings, last 12 months": s.ltm_meetings ?? p.meetings_last_365d,
        "Meetings, prior 12 months": s.prior_12mo_meetings,
        "Meetings, year to date": p.meetings_ytd,
        "Meetings, last 90 days": p.meetings_last_90d,
        "Confirmed meetings, next 3 months": p.meetings_next_3m,
        "Last meeting": day(p.last_meeting_date),
        "Next scheduled meeting": day(p.next_meeting_date),
        "Open event slots (unfilled meeting opportunities)": p.open_slots,
        "Institutions met, last 12 months": s.ltm_unique_institutions ?? p.unique_institutions_last_365d,
        "Investors met, last 12 months": s.ltm_unique_investors,
        "Investor introductions (first meeting with an institution, all time)": p.intro_meetings,
        "Follow-up meetings (repeat institution, all time)": p.followup_meetings,
        "Feedback collection rate, last 12 months":
          typeof s.ltm_feedback_rate === "number" ? `${Math.round(s.ltm_feedback_rate * 100)}%` : null,
        "Meetings cancelled, last 6 months": cancelledRes.count ?? 0,
        "Last marketing event": day(p.last_event_date),
      }),
    ),
  )

  const past = (pastMeetingsRes.data ?? []) as Row[]
  if (past.length > 0) {
    parts.push(
      section(
        "Recent confirmed meetings (most recent first)",
        past
          .map(
            (m) =>
              `- ${day(m.meeting_date)} — ${m.institution_name ?? "Unknown institution"}${m.is_in_person === true ? " (in person)" : m.is_in_person === false ? " (virtual)" : ""}`,
          )
          .join("\n"),
      ),
    )
  }

  const future = (futureMeetingsRes.data ?? []) as Row[]
  if (future.length > 0) {
    parts.push(
      section(
        "Upcoming / open meetings",
        future
          .map(
            (m) =>
              `- ${day(m.meeting_date)} — ${m.institution_name ?? "Unknown institution"} [${m.meeting_status_label ?? "status unknown"}]`,
          )
          .join("\n"),
      ),
    )
  }

  // Events are optional context — a missing view degrades to nothing.
  const events = (eventsRes.error ? [] : (eventsRes.data ?? [])) as Row[]
  if (events.length > 0) {
    parts.push(
      section(
        "Marketing events",
        events
          .sort((a, b) => String(b.event_start_actual ?? "").localeCompare(String(a.event_start_actual ?? "")))
          .map(
            (e) =>
              `- ${e.event_name ?? "Event"} — ${e.event_dates ?? day(e.event_start_actual) ?? "dates TBD"}${e.event_state_label ? ` [${e.event_state_label}]` : ""}${e.event_location ? `, ${e.event_location}` : ""}`,
          )
          .join("\n"),
      ),
    )
  }

  const touches = (touchRes.data ?? []) as Row[]
  if (touches.length > 0) {
    parts.push(
      section(
        "Recent touchpoints (most recent first)",
        touches
          .map((tp) => {
            const head = [tp.touchpoint_type_label ?? "Touchpoint", day(tp.scheduled_start), tp.subject]
              .filter(Boolean)
              .join(" — ")
            const desc = clip(tp.description, MAX_TOUCHPOINT_CHARS)
            return `- ${head}${desc ? `: ${desc}` : ""}`
          })
          .join("\n"),
      ),
    )
  }

  // The primary signal: ALL dated client notes, most recent first.
  const notes = (notesRes.data ?? []) as Row[]
  parts.push(
    section(
      `Client notes — ${notes.length} total, MOST RECENT FIRST (primary signal; weight recent notes most)`,
      notes.length === 0
        ? "No client notes on record."
        : notes
            .map((n) => {
              const meta = [
                n.status_text ? `status: ${String(n.status_text).trim()}` : null,
                n.primary_risk_driver ? `risk driver: ${String(n.primary_risk_driver).trim()}` : null,
                n.owner_name ? `author: ${n.owner_name}` : null,
              ]
                .filter(Boolean)
                .join("; ")
              const action = [
                n.action_step ? `action: ${String(n.action_step).trim()}` : null,
                n.action_owner ? `owner: ${n.action_owner}` : null,
                day(n.action_deadline) ? `due ${day(n.action_deadline)}` : null,
              ]
                .filter(Boolean)
                .join("; ")
              const body = clip(n.note_body ?? n.notes_text, MAX_NOTE_CHARS) ?? "(no text)"
              return `### ${day(n.note_date) ?? "Undated"}${meta ? ` (${meta})` : ""}\n${body}${action ? `\n${action}` : ""}`
            })
            .join("\n\n"),
    ),
  )

  return {
    clientName,
    context: `Today's date: ${todayIso}\n\n${parts.filter(Boolean).join("\n\n")}`,
  }
}

// ---- classification ------------------------------------------------------------

async function callModel(anthropic: Anthropic, context: string): Promise<string> {
  try {
    const message = await anthropic.messages.create({
      model: HEALTH_MODEL,
      max_tokens: 800,
      // Cached: the framework is identical for every client, so after the first
      // call each batch reads it from cache — cheaper, and cached input tokens
      // do not count toward the input-tokens-per-minute rate limit.
      system: [{ type: "text", text: buildHealthSystemPrompt(), cache_control: { type: "ephemeral" } }],
      output_config: {
        format: { type: "json_schema", schema: HEALTH_OUTPUT_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: "user", content: `Client data:\n\n${context}` }],
    })
    return message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()
  } catch (err) {
    // A timeout / dropped connection has no HTTP status; report it as 408 so
    // the shared backoff treats it as transient (lib/ai-batch.ts).
    if (err instanceof Anthropic.APIConnectionError) {
      throw new ClientHealthError(`Anthropic connection error: ${err.message}`, 504, 408)
    }
    if (err instanceof Anthropic.APIError) {
      throw new ClientHealthError(`Anthropic API error ${err.status}: ${err.message}`, 502, err.status)
    }
    throw err
  }
}

/** One client through the SHARED throttled path (jittered backoff on 429/5xx/timeout). */
export function generateWithBackoff(
  sb: SupabaseClient,
  anthropic: Anthropic,
  accountId: string,
  runId: string,
): Promise<ClientHealthResult> {
  return withBackoff(() => generateAndStoreClientHealth(sb, anthropic, accountId, runId), {
    label: `client-health ${accountId}`,
    upstreamStatusOf: (err) => (err instanceof ClientHealthError ? err.upstreamStatus : undefined),
  })
}

export type ClientHealthResult = {
  accountId: string
  clientName: string
  rating: HealthRating
  note: string
  generatedAt: string
}

/**
 * Aggregate → classify → store ONE client. A rating outside the four allowed
 * values is retried once; a second bad answer throws (status 422) WITHOUT
 * writing, so a bad value never reaches the table. Upstream errors keep their
 * status for the route's backoff.
 */
export async function generateAndStoreClientHealth(
  sb: SupabaseClient,
  anthropic: Anthropic,
  accountId: string,
  runId: string,
): Promise<ClientHealthResult> {
  const { clientName, context } = await buildClientHealthContext(sb, accountId)

  let parsed = parseHealthOutput(await callModel(anthropic, context))
  if (!parsed) parsed = parseHealthOutput(await callModel(anthropic, context))
  if (!parsed) {
    throw new ClientHealthError(
      "Model returned an invalid rating twice; nothing was written.",
      422,
    )
  }

  const generatedAt = new Date().toISOString()
  // ai_* ONLY — never an override_* column (see the header).
  const { error } = await sb.from(HEALTH_TABLE).upsert(
    {
      account_id: accountId,
      ai_rating: parsed.rating,
      ai_note: parsed.note,
      ai_model: HEALTH_MODEL,
      ai_generated_at: generatedAt,
      run_id: runId,
      ai_error: null,
      ai_error_at: null,
      ai_error_run_id: null,
    },
    { onConflict: "account_id" },
  )
  if (error) {
    throw new ClientHealthError(`Classified but failed to store: ${error.message}`, 500)
  }

  return { accountId, clientName, rating: parsed.rating, note: parsed.note, generatedAt }
}

/**
 * Record a client's final failure for the page to show. Leaves the previous
 * ai_* values (and every override_* value) untouched. Best-effort: a failure to
 * record is logged, never thrown.
 */
export async function recordClientHealthError(
  sb: SupabaseClient,
  accountId: string,
  message: string,
  runId: string,
): Promise<void> {
  const { error } = await sb
    .from(HEALTH_TABLE)
    .upsert(
      {
        account_id: accountId,
        ai_error: message.slice(0, 1000),
        ai_error_at: new Date().toISOString(),
        // Marks the client as "tried" in this run so a resume skips it.
        ai_error_run_id: runId,
      },
      { onConflict: "account_id" },
    )
  if (error) console.warn(`[client-health] could not record error for ${accountId}: ${error.message}`)
}
