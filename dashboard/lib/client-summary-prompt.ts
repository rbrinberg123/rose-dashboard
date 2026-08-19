/**
 * PURE prompt assembly for the AI client summary — no I/O, no SDK, so the
 * guarantees below are unit-testable without an API key or a database.
 *
 * ONE summary is generated per client and shown to EVERYONE; there is no
 * per-viewer variant. A reader may lack the **Financials** permission (see
 * lib/access/financials.ts), so the summary must never contain a money amount.
 * That is enforced twice over:
 *
 *   1. `buildSummaryFields` never puts the retainer in the model's input — the
 *      model cannot state a figure it was never given.
 *   2. `SUMMARY_SYSTEM_PROMPT` explicitly forbids monetary figures.
 *
 * Renewal / term-end DATES are NOT financial and are deliberately kept.
 */

export const SUMMARY_SYSTEM_PROMPT =
  "You are writing a brief relationship summary for an investor-relations advisory firm's internal dashboard. Below is structured data about one corporate client. Write a 2–3 sentence summary that helps an account manager quickly understand the state of this relationship.\n\n" +
  "Guidelines:\n\n" +
  "Be factual, concise, and neutral. Use only the data provided — do not invent details, numbers, or events. If a field is missing or null, omit it; do not speculate. Synthesize; do not recite every field.\n" +
  "State what is true, not how good it is. Do not editorialize or apply subjective labels. Never use phrases like \"valued client,\" \"strong relationship,\" or \"well-positioned,\" and never use any adjective that is a judgment rather than a fact.\n" +
  "Mention how long they have been a client (from the start date).\n" +
  "Reflect the most recent client note and its sentiment if present.\n" +
  "Summarize the recent touchpoints — what kinds of contact have happened and roughly when. Touchpoints tagged \"[longest]\" are the longest-duration recent ones; mention a long touchpoint only if its duration genuinely stands out from the others, and never imply there were tasks or activities beyond the touchpoints listed.\n" +
  "You may state plain facts such as the number of recent meetings, the number of unique institutions met, and upcoming confirmed meetings. Do NOT comment on meeting pace in any way: no \"low\" or \"high,\" no \"light\" or \"active,\" no \"on track\" or \"behind.\" Report counts, never a judgment about them.\n" +
  "NEVER state any money amount. Do not mention contract revenue, retainer, fee, rate, price, or billing figures — no dollar amounts, no currency symbols, and no numbers standing in for them (not exact, not rounded, not approximate, not a range, and not per-quarter or per-meeting derivations). Do not describe the client in financial-size terms. This one summary is shown to EVERYONE, including readers who are not permitted to see financials. Contract DATES are fine — state the renewal or term-end date and the qualitative state of the relationship; just never a monetary figure.\n" +
  'Do not give explicit recommendations (no "you should…"). Describe the state; let the reader draw conclusions.\n' +
  "Neutral, professional tone. No bullet points — 2–3 flowing sentences."

/**
 * The client facts fed to the model. Structural on purpose (no import of the
 * app's row types) so this module stays dependency-free and testable.
 */
export type SummarySourceFields = {
  clientName: string
  clientSince: string | null
  lifetimeMeetings: number
  trailing12m: number
  upcomingConfirmed: number
  ltmUniqueInstitutions: number
  /** Contract renewal / term-end date. A DATE, not a financial figure — kept. */
  latestTermEnd: string | null
  noteDate: string | null
  noteText: string | null
  noteStatus: string | null
  noteRiskDriver: string | null
}

/**
 * The label → value map fed to the model.
 *
 * The retainer is DELIBERATELY ABSENT — no key, no value, not even rounded.
 * This is the primary guarantee that no summary can quote a dollar figure; the
 * prompt rule is the backstop. Do not add a money field here without splitting
 * the summary per-viewer first.
 */
export function buildSummaryFields(
  f: SummarySourceFields,
): Record<string, string | number | null> {
  return {
    "Client name": f.clientName,
    "Client since": f.clientSince,
    "Lifetime meetings": f.lifetimeMeetings,
    "Trailing-12-month meetings": f.trailing12m,
    "Confirmed upcoming meetings": f.upcomingConfirmed,
    "Institutions met (last 12 months)": f.ltmUniqueInstitutions,
    "Contract renewal date": f.latestTermEnd,
    "Most recent client note date": f.noteDate,
    "Most recent client note": f.noteText,
    "Client note status / sentiment": f.noteStatus,
    "Primary risk driver": f.noteRiskDriver,
  }
}

/** Render only the non-null fields so the model never sees "null". */
export function buildClientDataBlock(
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
 * Does `text` appear to state a money amount? Used as a post-generation
 * TRIPWIRE only — it logs, it never rewrites the summary. Deliberately
 * conservative about dates: "2026-12-31" and "December 31, 2026" are not money.
 */
export function containsMoneyAmount(text: string): boolean {
  // A currency symbol followed by digits: $1,200 / $1.2M / US$400000.
  if (/[$€£]\s?\d/.test(text)) return true
  // A number next to a currency word: "400,000 dollars", "1.2 million USD".
  if (/\d[\d,.]*\s*(?:k\b|m\b|mm\b|million|thousand)?\s*(?:dollars?|usd)\b/i.test(text))
    return true
  // A money word carrying an explicit figure: "retainer of 400,000",
  // "fee is 1.2 million", "rate: 5,000 per meeting". The figure must LOOK like
  // money — comma-grouped, decimal-with-magnitude, or 5+ bare digits — so a
  // 4-digit year ("the retainer renews in December 2026") is not flagged.
  if (
    /\b(?:retainer|fee|fees|rate|revenue|billing|price|contract value)\b[^.\n]{0,40}?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:k|m|mm|million|thousand)\b|\d{5,})/i.test(
      text,
    )
  )
    return true
  return false
}
