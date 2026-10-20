/**
 * PURE rules for DATA UPLOAD tasks created from the data-crm@ shared mailbox —
 * no I/O, so every decision is unit-testable (rules.test.ts). The poll
 * (./poll.ts) and the page's server actions (app/data-uploads/actions.ts)
 * apply these to what they read.
 *
 *   matchClient          subject + attachment names + body (tickers and name
 *                        fragments), one distinct client only; sender domain
 *                        as a fallback — active clients only
 *   clientRequiredToClose  a mailbox Data Upload task needs a client to complete
 *   dataUploadTitle      the task subject: "Data Upload – <client> – <subject>"
 *   dataUploadDueDay     today (Eastern) + 7 days
 *   nextWatermark        how far the poll may advance after a batch
 *   decideComplete       who may mark a task complete from /data-uploads
 */

/** The shared mailbox polled for new data-upload email. */
export const DATA_CRM_MAILBOX = "data-crm@roseandco.com"

/** The page route — its Roles-matrix row and the server actions' gate. */
export const DATA_UPLOADS_ROUTE = "/data-uploads"

/** created_by_name on every mailbox-created task — the page lists only these. */
export const DATA_UPLOAD_CREATED_BY = "Data CRM mailbox"

/** The existing Outreach / Data Upload pair (lib/tasks/create.ts TASK_TYPE_OPTIONS). */
export const DATA_UPLOAD_TASK = {
  typeCode: 755860003,
  typeLabel: "Outreach",
  subtypeCode: 755860000,
  subtypeLabel: "Data Upload",
} as const

/** Due = created (Eastern) + this many days. */
export const DATA_UPLOAD_DUE_DAYS = 7

/** Re-read this far behind the watermark each poll; the message-id dedup absorbs the overlap. */
export const WATERMARK_OVERLAP_MS = 10 * 60 * 1000

/** Dynamics' task subject limit. */
const SUBJECT_MAX = 200

/* ------------------------------------------------------------------ matching */

export type MatchAccount = {
  account_id: string
  name: string | null
  ticker_symbol: string | null
  website_url: string | null
  email: string | null
}

export type ClientMatch = {
  accountId: string
  name: string | null
  /** The BASE ticker ("ADT", not "ADT-US") — what the title shows. */
  ticker: string | null
  source: "ticker" | "name" | "sender_domain"
  /** Where it was found — the best place: subject > attachment name > body. */
  where: "subject" | "attachment" | "body" | "sender"
}

/** What an email offers for matching. Body and attachment names are optional. */
export type MatchInput = {
  subject: string | null
  /** Plain-text body (Graph's text conversion), possibly with quoted replies. */
  bodyText?: string | null
  /** Attachment FILE NAMES only — never content. */
  attachmentNames?: readonly string[] | null
  senderAddress: string | null
}

/**
 * Uppercase words that are also real tickers but far more often just words or
 * abbreviations. A ticker on this list never matches by itself (the company
 * name still can).
 */
const TICKER_STOPWORDS = new Set([
  "A", "AI", "ALL", "AM", "AN", "AND", "ARE", "AS", "AT", "BE", "BY", "CC", "CEO", "CFO", "CRM", "CSV",
  "DATA", "DO", "DOC", "EOD", "EST", "ET", "FOR", "FW", "FWD", "FY", "GO", "HAS", "HE", "HR", "ID", "IN",
  "INC", "IR", "IS", "IT", "LLC", "LTD", "ME", "MY", "NA", "NEW", "NO", "NOW", "OF", "OK", "ON", "OR",
  "OUT", "PDF", "PM", "PLC", "PROD", "Q1", "Q2", "Q3", "Q4", "RE", "SEE", "SO", "THE", "TO", "UK", "UP",
  "US", "USA", "USD", "WE", "XLS", "XLSX", "YOU",
])

/**
 * Words that are never a DISTINCTIVE name fragment on their own: generic
 * business / email vocabulary. A client whose name reduces to one of these
 * matches only through its full name or its ticker.
 */
const NAME_FRAGMENT_STOPWORDS = new Set([
  "data", "upload", "uploads", "report", "reports", "email", "file", "files", "list", "test", "the",
  "meeting", "meetings", "history", "planning", "holders", "shareholder", "shareholders", "register",
  "analysis", "update", "energy", "gold", "silver", "copper", "metals", "mining", "minerals",
  "resources", "royalties", "capital", "global", "international", "american", "national", "first",
  "royal", "bank", "banks", "partners", "financial", "services", "systems", "technologies",
  "technology", "solutions", "industries", "power", "health", "pharma", "therapeutics", "united",
  "general", "north", "south", "east", "west", "world", "trust", "investment", "investments",
  "management", "group", "holdings", "company", "rose",
  // Everyday prose that leads some client names ("Great-West Lifeco").
  "great", "best", "good", "next", "true", "golden", "summit", "pioneer", "premier",
  "please", "thanks", "team", "weekend",
])

/** Domains that say nothing about which client sent the email. */
const GENERIC_DOMAINS = new Set([
  "roseandco.com",
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com",
])

/** Legal-form words dropped before comparing a company name. */
const NAME_SUFFIXES = new Set([
  "inc", "incorporated", "corp", "corporation", "co", "company", "ltd", "limited", "llc", "plc",
  "lp", "sa", "nv", "ag", "se", "holdings", "holding", "group", "the",
])

/** Lowercase, punctuation → space, legal-form words dropped, single-spaced. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !NAME_SUFFIXES.has(w))
    .join(" ")
}

/** The bare host of a URL or email ("https://www.Acme.com/x" → "acme.com"). */
export function domainOf(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase()
  if (!v) return null
  const host = v.includes("@")
    ? v.slice(v.lastIndexOf("@") + 1)
    : v.replace(/^[a-z]+:\/\//, "").split(/[/?#:]/)[0]
  const bare = host.replace(/^www\./, "").replace(/\.$/, "")
  return bare.includes(".") ? bare : null
}

/**
 * Uppercase WHOLE-WORD tokens of a text (tickers are written in caps). Words
 * split on anything but letters, digits and dots; a dotted word also yields its
 * parts, so "ADT.xlsx" gives ADT while "BRK.B" stays BRK.B. Never a partial
 * match inside a longer word.
 */
function upperTokens(text: string): Set<string> {
  const out = new Set<string>()
  const add = (t: string) => {
    if (t.length >= 2 && t === t.toUpperCase() && /[A-Z]/.test(t)) out.add(t)
  }
  for (const raw of text.split(/[^A-Za-z0-9.]+/)) {
    const t = raw.replace(/^\.+|\.+$/g, "")
    if (!t) continue
    add(t)
    if (t.includes(".")) t.split(".").forEach(add)
  }
  return out
}

/**
 * The tradable ticker without its country suffix. accounts.ticker_symbol is
 * stored as BASE-CC for almost every client ("ADT-US", "WDS-AU", "SBRY-GB" —
 * 105 of 108 active accounts, 2026-10-19), but an email says "ADT". Uppercased;
 * null when blank.
 */
export function tickerBase(ticker: string | null | undefined): string | null {
  const t = (ticker ?? "").trim().toUpperCase().replace(/[-.: ][A-Z]{2}$/, "")
  return t || null
}

/**
 * A client's DISTINCTIVE name fragments, after the legal suffixes are
 * stripped: the whole remaining name, then its first word — each kept only if
 * it is 4+ characters and not a generic word. "Woodside Energy" →
 * [woodside energy, woodside]; "First Quantum Minerals" → [first quantum
 * minerals] ("first" is generic); "ADT, Inc." → [] (too short: ticker only).
 */
export function nameFragments(name: string | null | undefined): { full: string | null; first: string | null } {
  const n = normalizeName(name ?? "")
  const full = n.length >= 4 && !NAME_FRAGMENT_STOPWORDS.has(n) ? n : null
  const w = n.split(" ")[0] ?? ""
  const first = w !== n && w.length >= 4 && !NAME_FRAGMENT_STOPWORDS.has(w) ? w : null
  return { full, first }
}

type Where = Exclude<ClientMatch["where"], "sender">
const WHERE_ORDER: readonly Where[] = ["subject", "attachment", "body"]

export type ClientCandidate = { account: MatchAccount; source: "ticker" | "name"; where: Where }

/**
 * Every active client the email's TEXT points at: the candidate set behind
 * matchClient. Searched: subject (RE:/FW: stripped), attachment names, body.
 *   ticker  an uppercase whole word equal to the client's BASE ticker (2+
 *           chars, not a stopword); never a partial match
 *   name    a distinctive name fragment (nameFragments) found case-insensitively
 *           in the normalised text, starting at a word boundary (so plurals /
 *           possessives like "Woodside's" still match). In the BODY only the
 *           full name counts, never a first word alone. A hit that is only part
 *           of a LONGER hit for another client is ignored, so "Acme Bank" in
 *           the text doesn't also count for "Acme Corp".
 * One entry per distinct client, with its best evidence.
 */
export function findClientCandidates(
  input: MatchInput,
  accounts: readonly MatchAccount[],
): Map<string, ClientCandidate> {
  const texts: Record<Where, string> = {
    subject: cleanSubject(input.subject),
    attachment: (input.attachmentNames ?? []).join(" \n "),
    body: input.bodyText ?? "",
  }
  const found = new Map<string, ClientCandidate>()
  const note = (account: MatchAccount, source: ClientCandidate["source"], where: Where) => {
    const cur = found.get(account.account_id)
    const better =
      !cur ||
      WHERE_ORDER.indexOf(where) < WHERE_ORDER.indexOf(cur.where) ||
      (where === cur.where && source === "ticker" && cur.source === "name")
    if (better) found.set(account.account_id, { account, source, where })
  }

  for (const where of WHERE_ORDER) {
    const text = texts[where]
    if (!text.trim()) continue

    const tokens = upperTokens(text)
    for (const a of accounts) {
      const t = tickerBase(a.ticker_symbol)
      if (t && t.length >= 2 && !TICKER_STOPWORDS.has(t) && tokens.has(t)) note(a, "ticker", where)
    }

    const hay = ` ${normalizeName(text)}`
    const hits: { a: MatchAccount; frag: string; isFull: boolean }[] = []
    for (const a of accounts) {
      const { full, first } = nameFragments(a.name)
      if (full && hay.includes(` ${full}`)) hits.push({ a, frag: full, isFull: true })
      // First-word fragments are too weak for free prose: in the BODY only the
      // full name counts ("had a great weekend" is not Great-West Lifeco).
      else if (first && where !== "body" && hay.includes(` ${first}`)) hits.push({ a, frag: first, isFull: false })
    }
    // A hit covered by another client's STRONGER hit doesn't count: one that is
    // part of a longer hit ("Acme Bank" in the text is Acme Bank, not also Acme
    // Corp), or a first-word-only hit equal to another client's full name
    // ("Acme" is Acme Corp, not the first word of Acme Bank).
    for (const { a, frag, isFull } of hits) {
      const covered = hits.some(
        (h) =>
          h.a.account_id !== a.account_id &&
          ` ${h.frag} `.includes(` ${frag} `) &&
          (h.frag.length > frag.length || (h.isFull && !isFull)),
      )
      if (!covered) note(a, "name", where)
    }
  }
  return found
}

/**
 * Match an email to ONE client, or none. All text signals (tickers and name
 * fragments in the subject, attachment names and body) are POOLED:
 *   exactly one distinct client → that client
 *   more than one               → null: ambiguous, never guess
 *   none                        → the sender-domain fallback: the sender's
 *                                 domain equals exactly one client's website /
 *                                 email domain (Rose & Co and free-mail never)
 * Callers pass active clients only.
 */
export function matchClient(input: MatchInput, accounts: readonly MatchAccount[]): ClientMatch | null {
  const toMatch = (a: MatchAccount, source: ClientMatch["source"], where: ClientMatch["where"]): ClientMatch => ({
    accountId: a.account_id,
    name: a.name,
    ticker: tickerBase(a.ticker_symbol),
    source,
    where,
  })

  const candidates = findClientCandidates(input, accounts)
  if (candidates.size === 1) {
    const [{ account, source, where }] = [...candidates.values()]
    return toMatch(account, source, where)
  }
  if (candidates.size > 1) return null

  const sender = domainOf(input.senderAddress)
  if (sender && !GENERIC_DOMAINS.has(sender)) {
    const hits = accounts.filter((a) => domainOf(a.website_url) === sender || domainOf(a.email) === sender)
    if (new Set(hits.map((a) => a.account_id)).size === 1) return toMatch(hits[0], "sender_domain", "sender")
  }
  return null
}

/* --------------------------------------------------------------------- title */

/** Subject without leading RE: / FW: / FWD: prefixes (repeated), trimmed. */
export function cleanSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").replace(/\s+/g, " ").trim()
  for (;;) {
    const next = s.replace(/^(re|fw|fwd)\s*:\s*/i, "")
    if (next === s) return s
    s = next
  }
}

/**
 * The task subject. "Data Upload – <client> – <subject>", where <client> is the
 * ticker (else the name) of the matched client and is left out when the subject
 * already shows it. No subject → "from <sender>". Capped at 200 characters.
 */
export function dataUploadTitle(input: {
  subject: string | null
  senderName: string | null
  senderAddress: string | null
  match: ClientMatch | null
}): string {
  const subj = cleanSubject(input.subject)
  const label = input.match ? input.match.ticker || input.match.name?.trim() || null : null
  const shown =
    !!label &&
    (input.match?.ticker
      ? upperTokens(subj).has(label.toUpperCase())
      : subj.toLowerCase().includes(label.toLowerCase()))

  const parts = ["Data Upload"]
  if (label && !shown) parts.push(label)
  const sender = input.senderName?.trim() || input.senderAddress?.trim()
  parts.push(subj || (sender ? `from ${sender}` : "(no subject)"))

  const title = parts.join(" – ")
  return title.length > SUBJECT_MAX ? `${title.slice(0, SUBJECT_MAX - 1).trimEnd()}…` : title
}

/* ----------------------------------------------------------------------- due */

/** YYYY-MM-DD + n calendar days (pure date arithmetic, no time zone). */
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Today in US Eastern (YYYY-MM-DD), whatever the server's zone. */
export function easternToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now)
}

/** The due day for a task created at `now`: Eastern today + 7. */
export function dataUploadDueDay(now: Date = new Date()): string {
  return addDays(easternToday(now), DATA_UPLOAD_DUE_DAYS)
}

/* ----------------------------------------------------------------- watermark */

/**
 * The watermark after processing a batch (all ISO timestamps):
 *   - any message failed → the EARLIEST failed message's time, so the next poll
 *     reads it again (never earlier than the current watermark);
 *   - otherwise → the newest message's time;
 *   - no messages → unchanged.
 * Re-reading is safe: processed messages are deduped by internet_message_id.
 */
export function nextWatermark(
  current: string,
  processed: readonly { receivedAt: string; ok: boolean }[],
): string {
  if (!processed.length) return current
  const failed = processed.filter((p) => !p.ok).map((p) => Date.parse(p.receivedAt))
  const target = failed.length
    ? Math.min(...failed)
    : Math.max(...processed.map((p) => Date.parse(p.receivedAt)))
  // Never moves backwards: a failed message is at most WATERMARK_OVERLAP_MS
  // behind the current watermark (that is how it was read), so holding the
  // watermark still re-reads it next time.
  return new Date(Math.max(Date.parse(current), target)).toISOString()
}

/** Where the next Graph read starts: watermark − overlap. */
export function pollSince(watermark: string): string {
  return new Date(Date.parse(watermark) - WATERMARK_OVERLAP_MS).toISOString()
}

/* ------------------------------------------------------------------ complete */

export type CompleteTask = {
  origin: string | null
  stateLabel: string | null
  closedAt: string | null
  subtypeLabel: string | null
  createdByName: string | null
  /** tasks.bcs_account_id — the client. */
  clientId: string | null
}

/** The refusal when a mailbox Data Upload task has no client yet. */
export const CLIENT_REQUIRED_MESSAGE = "Set the client before closing this Data Upload task."

/** Created by the data-crm@ mailbox poll (the only Data Upload tasks these rules govern). */
export function isMailboxDataUpload(t: Pick<CompleteTask, "origin" | "subtypeLabel" | "createdByName">): boolean {
  return (
    t.origin === "dashboard" &&
    t.subtypeLabel === DATA_UPLOAD_TASK.subtypeLabel &&
    t.createdByName === DATA_UPLOAD_CREATED_BY
  )
}

/**
 * REQUIRED CLIENT BEFORE CLOSE: a mailbox Data Upload task can't be COMPLETED
 * without a client. Applies to mailbox-created tasks only (Dynamics-synced and
 * hand-made Data Upload tasks are unaffected), on every completion path —
 * Mark complete (/data-uploads), the CRM task card's Close, and Edit → Status:
 * Completed. Cancelling is NOT gated, so junk mail can be dismissed without a
 * client. null = allowed; otherwise the message.
 */
export function clientRequiredToClose(
  t: Pick<CompleteTask, "origin" | "subtypeLabel" | "createdByName" | "clientId">,
): string | null {
  return isMailboxDataUpload(t) && !t.clientId?.trim() ? CLIENT_REQUIRED_MESSAGE : null
}

/**
 * null = allowed; otherwise the user-facing reason. The PAGE gate (may this
 * person open /data-uploads?) is checked by the caller first — anyone who can
 * see the page may complete any open mailbox Data Upload task that has a client.
 */
export function decideComplete(
  t: CompleteTask,
  actor: { userId: string | null; impersonated: boolean },
): string | null {
  if (actor.impersonated) return "Exit “View as” before completing a task."
  if (!actor.userId) return "Your sign-in isn't linked to a CRM user, so you can't be set as the owner."
  if (!isMailboxDataUpload(t)) return "This isn't a mailbox Data Upload task."
  if (t.stateLabel !== "Open" || t.closedAt) return "This task is already complete."
  return clientRequiredToClose(t)
}

/**
 * Who may SET THE CLIENT on a mailbox Data Upload task from /data-uploads:
 * anyone who can open the page (checked by the caller), not in View as, while
 * the task is still open. null = allowed.
 */
export function decideSetClient(
  t: Omit<CompleteTask, "clientId">,
  actor: { impersonated: boolean },
): string | null {
  if (actor.impersonated) return "Exit “View as” before changing a task."
  if (!isMailboxDataUpload(t)) return "This isn't a mailbox Data Upload task."
  if (t.stateLabel !== "Open" || t.closedAt) return "This task is already complete."
  return null
}
