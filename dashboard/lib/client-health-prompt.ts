/**
 * PURE prompt + output contract for Client Health — no I/O, no SDK, so the
 * rating validation is unit-testable without an API key or a database.
 *
 * Unlike the AI client summary (lib/client-summary-prompt.ts), Client Health is
 * shown ONLY to super-users (/client-health is in ADMIN_ONLY_ROUTES), so its
 * input may include the retainer and the note may discuss it.
 */

/** The four allowed ratings. Mirrored by the CHECK constraints in
 *  sql/patches/2026-10-01_client_health.sql — change both together. */
export const HEALTH_RATINGS = ["1", "2", "3", "Management / IR Change"] as const
export type HealthRating = (typeof HEALTH_RATINGS)[number]

export function isHealthRating(v: unknown): v is HealthRating {
  return typeof v === "string" && (HEALTH_RATINGS as readonly string[]).includes(v)
}

/** Display label for each rating (badges, filter, Excel). Always text. */
export const HEALTH_RATING_LABEL: Record<HealthRating, string> = {
  "1": "1 · Healthy",
  "2": "2 · Monitor",
  "3": "3 · High risk",
  "Management / IR Change": "Management / IR Change",
}

/**
 * Risk severity for SORTING (higher = more attention): 3 High risk > 2 Monitor
 * > Management / IR Change > 1 Healthy — the firm standard order, the same as
 * FIRM_CATEGORY_ORDER in client-health-order.ts. Not the raw string order.
 * Unrated / unknown is null, which the table always sorts last.
 */
const RATING_SEVERITY: Record<HealthRating, number> = {
  "3": 4,
  "2": 3,
  "Management / IR Change": 2,
  "1": 1,
}

export function ratingSeverity(v: string | null | undefined): number | null {
  return isHealthRating(v) ? RATING_SEVERITY[v] : null
}

/**
 * Marker left in CLIENT_HEALTH_FRAMEWORK until the real framework is pasted in.
 * While it is present the batch route refuses to run (see isFrameworkConfigured)
 * so no paid call is ever made against a placeholder prompt.
 */
const FRAMEWORK_PLACEHOLDER = "<<CLIENT-HEALTH FRAMEWORK NOT YET PASTED>>"

/**
 * THE CLASSIFICATION FRAMEWORK — STORED VERBATIM.
 *
 * Paste the full Rose & Company client health / retention-risk framework
 * between the backticks below, EXACTLY as written (role line, inputs, the
 * 1 / 2 / 3 / Management / IR Change categories and all their examples, NOTES
 * guidance, RECENCY, CONSISTENCY RULES, STYLE, FINAL OUTPUT FORMAT). Do not
 * paraphrase or trim it.
 *
 * Its final table-style output instruction does not need editing:
 * CLIENT_HEALTH_OUTPUT_INSTRUCTION below is appended after it and tells the
 * model to return one JSON object for one client, and the API call enforces
 * that shape with structured output regardless.
 */
export const CLIENT_HEALTH_FRAMEWORK = `You are conducting a client health and retention-risk review for Rose & Company, an investor relations advisory firm.

Use everything available to you about this client, including structured and unstructured information. These may include:

- Client name
- Dated client notes
- Client status or classification
- Contract start and end dates
- Initial vs. renewal contract
- Renewal activity
- Retainer amount
- Account team
- Meeting activity
- Institutions met
- Investor introductions
- Follow-ups
- Last meeting date
- Next scheduled meeting
- Open meeting opportunities
- Touchpoints
- Other relationship, engagement, or account information

Your job is to synthesize all available information and assign the client to ONE of the following categories:

1 = No meaningful current risk
2 = Worth monitoring
3 = High risk
Management / IR Change = Client is undergoing a meaningful management or investor-relations personnel transition

RATING FRAMEWORK

RATING 1: NO MEANINGFUL CURRENT RISK

Use 1 when the relationship appears healthy or there is no meaningful evidence of risk.

Examples:

- Client relationship appears strong, stable, or normal.
- Client is renewing or has recently renewed without meaningful concerns.
- Client engagement is normal.
- There are no material service complaints or expectation gaps.
- Weak company performance exists, but the Rose relationship is healthy.
- The stock is difficult, but there is no evidence that this is affecting client satisfaction or Rose's ability to execute.
- Meeting activity is temporarily light but there are no other negative indicators.
- The client has been somewhat difficult to schedule but there is no evidence of dissatisfaction or relationship deterioration.

Do NOT flag a client simply because:

- Its business is underperforming.
- Its stock price is weak.
- Its industry is out of favor.
- Its market capitalization has fallen.
- Investor sentiment toward the company is poor.
- There have been few meetings recently.
- There are no upcoming meetings.
- The client is slow to provide dates.
- The client is demanding.

These factors are not leading indicators of client loss unless they are affecting the Rose relationship.

RATING 2: WORTH MONITORING

Use 2 when there is something management should pay attention to, but there is not yet a strong basis to conclude the client is likely to be lost.

The most important indicators are:

- Expression of client dissatisfaction.
- Friction between Rose and the client.
- Client frustration.
- Rose is not meeting client expectations.
- Client has questioned the quality, pace, quantity, or effectiveness of Rose's work.
- Communication has deteriorated.
- Engagement with Rose has declined in a way that appears relationship-related.
- Client-side sponsor has become less engaged.
- Scope or budget concerns.
- Renewal discussions are uncertain but not clearly at risk.
- A significant service or execution issue occurred.
- Difficult interactions with senior management or the IR team.
- Client relationship requires unusual management attention.

MARKETABILITY RISK IS ALSO A VALID RATING 2 INDICATOR.

Assign a 2 when the client is materially difficult to market because there is weak actual or expected investor demand and this creates a meaningful challenge for Rose's engagement.

Examples include:

- Very limited investor appetite despite active outreach.
- Investor demand is structurally weak.
- The addressable investor universe is unusually narrow.
- The company is unlikely to attract meaningful investor interest in the foreseeable future.
- Rose is struggling to generate meetings because of weak demand rather than execution.
- The account is likely to be difficult to service successfully because the investor opportunity set is poor.

Examples of this type of situation include Bendigo & Adelaide Bank, Midnight Sun Mining, and Platinum Group Metals.

Do not confuse marketability risk with simple poor company performance. The relevant question is:

"Is actual or expected investor demand sufficiently weak that this makes the Rose engagement materially difficult to execute successfully?"

If yes, a 2 may be appropriate.

RATING 3: HIGH RISK

Use 3 when there is credible risk that Rose may lose the client.

Examples include:

- Client has discussed terminating the relationship.
- Client has indicated it may not renew.
- Client is actively considering another provider.
- Client is comparing Rose unfavorably to another provider.
- Client expresses significant dissatisfaction.
- Rose has materially failed to meet the client's expectations.
- There is a serious expectation gap that appears difficult to resolve.
- Renewal discussions are materially uncertain or deteriorating.
- The client has stopped using Rose or materially reduced use in a way suggesting the relationship itself is failing.
- A key sponsor has left and there is additional evidence that the account is vulnerable.
- The client is undergoing restructuring, acquisition, budget cuts, or another change that creates a credible possibility that the engagement will end.
- Multiple moderate warning signs combine into a credible churn risk.

Use 3 when the risk exists independently of a management or IR personnel change.

Example:

Li-FT Power should be rated 3 if the notes indicate materially unrealistic meeting expectations, dissatisfaction with results, comparison with another provider, or another expectation gap that could threaten the relationship. A new IRO does not override that independent risk.

MANAGEMENT / IR CHANGE

Use this category when the client is currently undergoing a meaningful change in:

- CEO
- CFO
- Investor Relations Officer
- Head of IR
- Senior IR staff
- Other senior management directly relevant to Rose's relationship

Examples:

- New IRO has been hired.
- Existing IRO is leaving.
- CFO transition is underway.
- New CEO is coming in.
- Key Rose sponsor has departed and a replacement is being established.

IMPORTANT:

Do NOT automatically place every client with a personnel change into Management / IR Change.

Use the following hierarchy:

1. First determine whether the client independently qualifies as a 3.
   - If yes, assign 3.

2. If not, determine whether the client independently qualifies as a 2 for reasons other than the personnel change.
   - If yes, assign 2.

3. Only if the primary issue is the personnel transition itself should the client be categorized as Management / IR Change.

Examples:

Li-FT Power:
New IRO + separate material expectation/relationship risk
Rating = 3

Client with a new CFO but otherwise healthy relationship:
Rating = Management / IR Change

Client with a departing IRO plus significant dissatisfaction with Rose:
Rating = 2 or 3 depending on severity

Alliance Laundry:
If the note merely says the IRO has been difficult to pin down for dates, this is NOT a management or IR change.
Do not classify it as Management / IR Change unless there is evidence of an actual personnel transition.

NOTES

Write a concise management-level note, generally 1-3 sentences.

The note should synthesize the available information rather than list statistics.

Prioritize:

1. Client satisfaction or dissatisfaction.
2. Relationship friction.
3. Whether Rose is meeting expectations.
4. Renewal or termination risk.
5. Management or IR personnel changes.
6. Marketability and investor-demand challenges.
7. Material changes in engagement.
8. Supporting activity data when relevant.

Do not overload the note with routine metrics.

Good:
"The relationship remains healthy and the client is renewing. Recent meeting activity has been solid and there are no material client-service concerns."

Good:
"Investor demand remains very limited despite active outreach, making the account difficult to market. The client relationship itself appears stable, but the constrained opportunity set warrants monitoring."

Good:
"The client has expressed dissatisfaction with meeting volume and has compared Rose's results with another provider. Expectations appear materially misaligned, creating credible retention risk."

Bad:
"34 meetings L12M, 12 meetings L3M, 4 next 3M, 38 introductions, 17 follow-ups."

RECENCY

Give greater weight to recent information.

If multiple dated notes exist:

- Use the most recent substantive note as the starting point.
- Review earlier notes for unresolved issues or trends.
- Do not allow a routine positive update to erase a serious unresolved issue from a recent prior note.
- If an earlier issue has clearly been resolved, do not continue flagging it.

CONSISTENCY RULES

Before finalizing, perform a second-pass review.

If rating 3, ask: "Is there credible evidence that Rose could lose this client?" If not, downgrade to 2.

If rating 2, ask: "Is there a specific relationship, expectation, engagement, or marketability issue that management should monitor?" If not, downgrade to 1.

If Management / IR Change, ask: "Is there actually a current personnel transition?" If not, reclassify numerically. Then ask: "Does this client have a separate risk that independently warrants a 2 or 3?" If yes, use the numeric rating instead.

If rating 1, ask: "Is there any explicit dissatisfaction, client friction, unmet expectation, weak investor demand, personnel issue, or retention concern that management should know about?" If yes, reconsider the rating.

Ensure the Note and Rating agree. If the note says "client-side friction warrants monitoring" the client cannot be rated 1. If the note says "credible possibility the client will not renew" the client should generally be rated 3. If the note says "management change is the only material issue" the client should generally be Management / IR Change.

STYLE

Write for senior management. Be concise, commercially sophisticated, and specific.

Avoid vague phrases such as "Continue to monitor," "Keep an eye on," "There may be concerns," "Engagement remains important."

State the actual issue and why it matters. Do not exaggerate risk. Do not treat poor company performance as client-health risk unless there is evidence it is affecting the Rose relationship or investor marketability. Do not treat a management change as automatically more important than a separate relationship risk.

OUTPUT

Return ONLY a single JSON object for this one client, exactly:

{"rating": "<one of: 1 | 2 | 3 | Management / IR Change>", "note": "<1-3 sentence management-level note>"}

The "rating" value must be exactly one of those four strings and nothing else. Do not include any text outside the JSON object.`

/** Appended after the framework: the per-client JSON contract (spec §4). */
export const CLIENT_HEALTH_OUTPUT_INSTRUCTION =
  "OUTPUT FOR THIS REQUEST (overrides any table-format output instruction above): " +
  "you are assessing ONE client at a time. The application assembles the table itself. " +
  'Return only a JSON object of the form {"rating": "<1|2|3|Management / IR Change>", "note": "<note>"}. ' +
  'The rating must be exactly one of "1", "2", "3", or "Management / IR Change". ' +
  "The note is concise and management-level, generally 1–3 sentences, synthesized rather than statistical. " +
  'When there is no meaningful evidence of risk, the rating is "1".'

/** The full system prompt sent to the model. */
export function buildHealthSystemPrompt(): string {
  return `${CLIENT_HEALTH_FRAMEWORK}\n\n${CLIENT_HEALTH_OUTPUT_INSTRUCTION}`
}

/**
 * Override-context block — appended to the per-client USER message (after the
 * client data), only when a super-user override is active. It is deliberately
 * NOT part of the system prompt: that prompt is identical for every client and
 * prompt-cached, and a per-client block there would break the cache. The JSON
 * output contract above is unchanged (and enforced by HEALTH_OUTPUT_SCHEMA).
 */
export function buildOverrideContextBlock(o: {
  overriddenAt: string | null
  reviewer: string | null
  rating: string | null
  note: string | null
  /** override_reviewed_at, when a human reaffirmed the override after it was set. */
  reaffirmedAt: string | null
}): string {
  const d = (iso: string | null) => (iso ? iso.slice(0, 10) : "unknown date")
  const rating = o.rating ?? "(not overridden — the reviewer left the rating to you)"
  const note = o.note ? `'${o.note}'` : "(no note)"
  const reaffirmed =
    o.reaffirmedAt && o.overriddenAt && o.reaffirmedAt.slice(0, 10) > o.overriddenAt.slice(0, 10)
      ? ` A human reaffirmed this override on ${d(o.reaffirmedAt)}.`
      : ""
  return (
    "## Human override\n" +
    `A human reviewer has overridden this client's rating. Override (dated ${d(o.overriddenAt)}, by ${o.reviewer ?? "a super-user"}): ` +
    `rating = ${rating}; note = ${note}.${reaffirmed} ` +
    "Treat this as strong, recent, human evidence and weight it heavily when forming your assessment. " +
    "Only diverge from it if clearly newer information materially contradicts it, and if you do, briefly state why in your note. " +
    "Still return your own best current rating and note."
  )
}

/** False until the real framework has been pasted over the placeholder. */
export function isFrameworkConfigured(): boolean {
  return (
    !CLIENT_HEALTH_FRAMEWORK.includes(FRAMEWORK_PLACEHOLDER) &&
    CLIENT_HEALTH_FRAMEWORK.trim().length > 0
  )
}

/** JSON schema for structured output (output_config.format). */
export const HEALTH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    rating: { type: "string", enum: [...HEALTH_RATINGS] },
    note: { type: "string" },
  },
  required: ["rating", "note"],
  additionalProperties: false,
} as const

/**
 * Parse + validate the model's JSON. Returns null for anything that is not
 * exactly {rating: <one of the four>, note: <non-empty string>} — the caller
 * retries once, then records an error rather than writing a bad value.
 */
export function parseHealthOutput(
  text: string,
): { rating: HealthRating; note: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object") return null
  const { rating, note } = parsed as { rating?: unknown; note?: unknown }
  const r = typeof rating === "string" ? rating.trim() : rating
  if (!isHealthRating(r)) return null
  if (typeof note !== "string" || note.trim() === "") return null
  return { rating: r, note: note.trim() }
}
