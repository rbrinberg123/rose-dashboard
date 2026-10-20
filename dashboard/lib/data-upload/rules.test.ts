import { test } from "node:test"
import assert from "node:assert/strict"

import {
  DATA_UPLOAD_CREATED_BY,
  addDays,
  cleanSubject,
  dataUploadDueDay,
  dataUploadTitle,
  clientRequiredToClose,
  decideComplete,
  decideSetClient,
  domainOf,
  findClientCandidates,
  matchClient,
  nameFragments,
  nextWatermark,
  normalizeName,
  pollSince,
  tickerBase,
  type MatchAccount,
} from "./rules.ts"

const acct = (o: Partial<MatchAccount> & { account_id: string }): MatchAccount => ({
  name: null,
  ticker_symbol: null,
  website_url: null,
  email: null,
  ...o,
})

const ACCOUNTS: MatchAccount[] = [
  acct({ account_id: "acme", name: "Acme Corp.", ticker_symbol: "ACME", website_url: "https://www.acme.com" }),
  acct({ account_id: "acmebank", name: "Acme Bank, Inc.", ticker_symbol: "ACBK" }),
  acct({ account_id: "globex", name: "Globex Holdings plc", ticker_symbol: "GBX", email: "ir@globex.co.uk" }),
  // Tickers that are also everyday words — never matched as tickers.
  acct({ account_id: "on", name: "ON Semiconductor", ticker_symbol: "ON" }),
  acct({ account_id: "it", name: "Gartner", ticker_symbol: "IT" }),
]

/* ------------------------------------------------------------------ matching */

/** Subject-only input, the common case. */
const subj = (subject: string | null, senderAddress: string | null = null) => ({ subject, senderAddress })

test("ticker: an uppercase whole word in the subject", () => {
  assert.deepEqual(matchClient(subj("Q3 data for ACME"), ACCOUNTS), {
    accountId: "acme",
    name: "Acme Corp.",
    ticker: "ACME",
    source: "ticker",
    where: "subject",
  })
  // Case-sensitive: "acme" in lowercase is not a ticker (but is the name).
  assert.equal(matchClient(subj("files from acme corp"), ACCOUNTS)?.source, "name")
  // TICKERS are whole word only — never a partial match inside a longer word.
  assert.equal(matchClient(subj("XGBX list"), ACCOUNTS), null)
  assert.equal(matchClient(subj("GBXY list"), ACCOUNTS), null)
  // ...but NAMES are a substring from a word start (the agreed rule), so
  // "ACMEX" still reaches Acme Corp — through its name, not its ticker.
  assert.equal(matchClient(subj("ACMEX upload"), ACCOUNTS)?.source, "name")
})

test("ticker: stored BASE-CC tickers match the bare ticker (2026-10-19 regression)", () => {
  // ticker_symbol is stored "ADT-US" for almost every client; the email says "ADT".
  const real = [
    acct({ account_id: "adt", name: "ADT, Inc.", ticker_symbol: "ADT-US" }),
    acct({ account_id: "wds", name: "Woodside Energy", ticker_symbol: "WDS-AU" }),
    acct({ account_id: "or", name: "Osisko Gold Royalties", ticker_symbol: "OR-CA" }),
    acct({ account_id: "pypl", name: "PayPal", ticker_symbol: "PYPL" }),
  ]
  assert.deepEqual(matchClient(subj("test data upload for ADT"), real), {
    accountId: "adt",
    name: "ADT, Inc.",
    ticker: "ADT",
    source: "ticker",
    where: "subject",
  })
  assert.equal(matchClient(subj("WDS-AU holders"), real)?.accountId, "wds")
  assert.equal(matchClient(subj("PYPL file"), real)?.accountId, "pypl")
  // The base is still stopword-checked: "OR" is a word, not Osisko.
  assert.equal(matchClient(subj("this OR that"), real), null)
  // Title shows the base ticker, and omits it when the subject already has it.
  const adt = matchClient(subj("ADT"), real)
  assert.equal(dataUploadTitle({ subject: "holders file", senderName: null, senderAddress: null, match: adt }), "Data Upload – ADT – holders file")
  assert.equal(dataUploadTitle({ subject: "test data upload for ADT", senderName: null, senderAddress: null, match: adt }), "Data Upload – test data upload for ADT")
})

test("tickerBase drops a two-letter country suffix only", () => {
  assert.equal(tickerBase("ADT-US"), "ADT")
  assert.equal(tickerBase(" akrbp-no "), "AKRBP")
  assert.equal(tickerBase("ZVZZT"), "ZVZZT")
  assert.equal(tickerBase("BRK.B"), "BRK.B")
  assert.equal(tickerBase(""), null)
  assert.equal(tickerBase(null), null)
})

test("ticker stopwords never match as tickers", () => {
  assert.equal(matchClient(subj("Data ON the way, IT team"), ACCOUNTS), null)
  // ...but the company name still can.
  assert.equal(matchClient(subj("ON Semiconductor holdings file"), ACCOUNTS)?.accountId, "on")
})

test("name fragments: suffixes stripped, 4+ chars, never a generic word", () => {
  assert.deepEqual(nameFragments("Woodside Energy Group Ltd"), { full: "woodside energy", first: "woodside" })
  assert.deepEqual(nameFragments("ADT, Inc."), { full: null, first: null }) // too short: ticker only
  assert.deepEqual(nameFragments("First Quantum Minerals"), { full: "first quantum minerals", first: null }) // "first" is generic
  assert.deepEqual(nameFragments("Data Holdings LLC"), { full: null, first: null }) // "data" is generic
  assert.deepEqual(nameFragments("PayPal Holdings, Inc."), { full: "paypal", first: null })
})

test("name: case-insensitive, from a word start; possessives and the first word still match", () => {
  const real = [
    acct({ account_id: "wds", name: "Woodside Energy Group Ltd", ticker_symbol: "WDS-AU" }),
    acct({ account_id: "pypl", name: "PayPal Holdings, Inc.", ticker_symbol: "PYPL" }),
  ]
  assert.equal(matchClient(subj("woodside's register"), real)?.accountId, "wds")
  assert.equal(matchClient(subj("WOODSIDE ENERGY holders"), real)?.source, "name")
  assert.equal(matchClient(subj("paypal list"), real)?.accountId, "pypl")
  // Not from the middle of a word.
  assert.equal(matchClient(subj("epaypal list"), real), null)
})

test("name: a hit inside a longer client's hit doesn't count twice", () => {
  assert.equal(matchClient(subj("Upload – Acme Bank shareholder list"), ACCOUNTS)?.accountId, "acmebank")
  assert.equal(matchClient(subj("Acme shareholder list"), ACCOUNTS)?.accountId, "acme")
  assert.equal(matchClient(subj("RE: Globex data"), ACCOUNTS)?.accountId, "globex")
})

test("body and attachment names are searched too; subject is the best evidence", () => {
  const viaBody = matchClient({ subject: "Weekly file", bodyText: "Attached is the GBX register.", senderAddress: null }, ACCOUNTS)
  assert.deepEqual([viaBody?.accountId, viaBody?.source, viaBody?.where], ["globex", "ticker", "body"])
  const viaFile = matchClient({ subject: "Weekly file", attachmentNames: ["GBX_holders_2026-10.xlsx"], senderAddress: null }, ACCOUNTS)
  assert.deepEqual([viaFile?.accountId, viaFile?.where], ["globex", "attachment"])
  // "ACME.xlsx" yields the token ACME (the extension is split off).
  assert.equal(matchClient({ subject: "file", attachmentNames: ["ACME.xlsx"], senderAddress: null }, ACCOUNTS)?.accountId, "acme")
  // The same client in several places is still ONE client; the best place is reported.
  const both = matchClient({ subject: "Globex list", bodyText: "GBX holders", senderAddress: null }, ACCOUNTS)
  assert.deepEqual([both?.accountId, both?.where], ["globex", "subject"])
})

test("body: full names and tickers only — a first word alone is too weak in prose (2026-10-19 real-mail regression)", () => {
  const real = [
    acct({ account_id: "gwo", name: "Great-West Lifeco Inc.", ticker_symbol: "GWO-CA" }),
    acct({ account_id: "snx", name: "TD Synnex Corporation", ticker_symbol: "SNX-US" }),
    acct({ account_id: "wds", name: "Woodside Energy Group Ltd", ticker_symbol: "WDS-AU" }),
  ]
  // The real thread: "had a great weekend" must not count for Great-West Lifeco.
  const thread = {
    subject: "Re: 2027 Planning & Meeting History",
    bodyText: "Hope everyone had a great weekend. Could you upload the attached meeting history for SNX? Nate Friedel, Head of IR, TD SYNNEX",
    attachmentNames: ["SNX manual upload.xlsx"],
    senderAddress: "pbell@roseandco.com",
  }
  assert.deepEqual(
    (({ accountId, source, where }) => ({ accountId, source, where }))(matchClient(thread, real)!),
    { accountId: "snx", source: "ticker", where: "attachment" },
  )
  // A first word alone: counts in the subject, not in the body.
  assert.equal(matchClient({ subject: "Woodside file", senderAddress: null }, real)?.accountId, "wds")
  assert.equal(matchClient({ subject: "file", bodyText: "woodside sent it", senderAddress: null }, real), null)
  // The full name still counts in the body.
  assert.equal(matchClient({ subject: "file", bodyText: "from Woodside Energy", senderAddress: null }, real)?.accountId, "wds")
  // "Great" is generic even as a first word.
  assert.deepEqual(nameFragments("Great-West Lifeco Inc."), { full: "great west lifeco", first: null })
})

test("more than one distinct client anywhere → no match (never guess)", () => {
  assert.equal(matchClient({ subject: "ACME file", bodyText: "cc the GBX team", senderAddress: null }, ACCOUNTS), null)
  assert.equal(matchClient({ subject: "file", attachmentNames: ["ACME.xlsx", "GBX.xlsx"], senderAddress: null }, ACCOUNTS), null)
  const dup = [...ACCOUNTS, acct({ account_id: "gbx2", name: "Other", ticker_symbol: "GBX" })]
  assert.equal(matchClient(subj("GBX file"), dup), null)
  assert.equal(findClientCandidates(subj("GBX file"), dup).size, 2)
})

test("sender domain is the fallback only when the text names nobody", () => {
  assert.equal(matchClient(subj("Holdings file", "jane@acme.com"), ACCOUNTS)?.source, "sender_domain")
  assert.equal(matchClient(subj("Holdings file", "ir@GLOBEX.co.uk"), ACCOUNTS)?.accountId, "globex")
  assert.equal(matchClient(subj("Holdings file", "scott@roseandco.com"), ACCOUNTS), null)
  assert.equal(matchClient(subj("Holdings file", "someone@gmail.com"), ACCOUNTS), null)
  // The text wins over the sender.
  assert.equal(matchClient(subj("GBX file", "jane@acme.com"), ACCOUNTS)?.accountId, "globex")
})

test("no subject, no sender → no match", () => {
  assert.equal(matchClient(subj(null), ACCOUNTS), null)
  assert.equal(matchClient(subj("", ""), ACCOUNTS), null)
})

test("normalizeName / domainOf", () => {
  assert.equal(normalizeName("The Acme Group, Inc."), "acme")
  assert.equal(normalizeName("Smith & Wesson Holdings"), "smith and wesson")
  assert.equal(domainOf("https://www.Acme.com/about"), "acme.com")
  assert.equal(domainOf("acme.com"), "acme.com")
  assert.equal(domainOf("IR@Acme.com"), "acme.com")
  assert.equal(domainOf("localhost"), null)
  assert.equal(domainOf(null), null)
})

/* --------------------------------------------------------------------- title */

test("cleanSubject strips repeated reply / forward prefixes", () => {
  assert.equal(cleanSubject("RE: FW: Fwd:  Holdings   file "), "Holdings file")
  assert.equal(cleanSubject(null), "")
})

test("title: client label added only when the subject doesn't show it", () => {
  const acme = matchClient({ subject: "ACME", senderAddress: null }, ACCOUNTS)
  assert.equal(
    dataUploadTitle({ subject: "Shareholder list", senderName: null, senderAddress: null, match: acme }),
    "Data Upload – ACME – Shareholder list",
  )
  assert.equal(
    dataUploadTitle({ subject: "FW: ACME shareholder list", senderName: null, senderAddress: null, match: acme }),
    "Data Upload – ACME shareholder list",
  )
  const noTicker = { accountId: "x", name: "Initech", ticker: null, source: "name" as const, where: "subject" as const }
  assert.equal(
    dataUploadTitle({ subject: "initech holders", senderName: null, senderAddress: null, match: noTicker }),
    "Data Upload – initech holders",
  )
})

test("title fallbacks: no match, no subject", () => {
  assert.equal(
    dataUploadTitle({ subject: "Weekly file", senderName: "Jane", senderAddress: "j@x.com", match: null }),
    "Data Upload – Weekly file",
  )
  assert.equal(
    dataUploadTitle({ subject: "  ", senderName: null, senderAddress: "j@x.com", match: null }),
    "Data Upload – from j@x.com",
  )
  assert.equal(dataUploadTitle({ subject: null, senderName: null, senderAddress: null, match: null }), "Data Upload – (no subject)")
})

test("title is capped at 200 characters", () => {
  const t = dataUploadTitle({ subject: "x".repeat(400), senderName: null, senderAddress: null, match: null })
  assert.equal(t.length, 200)
  assert.ok(t.endsWith("…"))
})

/* ----------------------------------------------------------------------- due */

test("due = Eastern today + 7, across month ends and the UTC/Eastern day split", () => {
  assert.equal(addDays("2026-10-28", 7), "2026-11-04")
  assert.equal(addDays("2026-12-29", 7), "2027-01-05")
  // 02:00 UTC on Oct 20 is still Oct 19 in New York.
  assert.equal(dataUploadDueDay(new Date("2026-10-20T02:00:00Z")), "2026-10-26")
  assert.equal(dataUploadDueDay(new Date("2026-10-20T15:00:00Z")), "2026-10-27")
})

/* ----------------------------------------------------------------- watermark */

test("watermark advances to the newest message when all succeed", () => {
  const w = "2026-10-19T12:00:00.000Z"
  assert.equal(
    nextWatermark(w, [
      { receivedAt: "2026-10-19T12:05:00Z", ok: true },
      { receivedAt: "2026-10-19T12:09:00Z", ok: true },
    ]),
    "2026-10-19T12:09:00.000Z",
  )
  assert.equal(nextWatermark(w, []), w)
})

test("watermark holds at the earliest failure, never moving backwards", () => {
  const w = "2026-10-19T12:00:00.000Z"
  assert.equal(
    nextWatermark(w, [
      { receivedAt: "2026-10-19T12:05:00Z", ok: true },
      { receivedAt: "2026-10-19T12:07:00Z", ok: false },
      { receivedAt: "2026-10-19T12:09:00Z", ok: true },
    ]),
    "2026-10-19T12:07:00.000Z",
  )
  // A failure inside the overlap window (before the watermark) keeps the watermark.
  assert.equal(nextWatermark(w, [{ receivedAt: "2026-10-19T11:55:00Z", ok: false }]), w)
  // Overlapped messages older than the watermark never pull it back.
  assert.equal(nextWatermark(w, [{ receivedAt: "2026-10-19T11:55:00Z", ok: true }]), w)
})

test("pollSince reads 10 minutes behind the watermark", () => {
  assert.equal(pollSince("2026-10-19T12:00:00.000Z"), "2026-10-19T11:50:00.000Z")
})

/* ------------------------------------------------------------------ complete */

const task = (o: Partial<Parameters<typeof decideComplete>[0]> = {}) => ({
  origin: "dashboard",
  stateLabel: "Open",
  closedAt: null,
  subtypeLabel: "Data Upload",
  createdByName: DATA_UPLOAD_CREATED_BY,
  clientId: "acct-1",
  ...o,
})
const ME = { userId: "u1", impersonated: false }

test("anyone with a CRM user may complete an open mailbox Data Upload task", () => {
  assert.equal(decideComplete(task(), ME), null)
})

test("complete is refused in View as, without a CRM user, or once closed", () => {
  assert.match(decideComplete(task(), { userId: "u1", impersonated: true }) ?? "", /View as/)
  assert.match(decideComplete(task(), { userId: null, impersonated: false }) ?? "", /CRM user/)
  assert.match(decideComplete(task({ stateLabel: "Completed" }), ME) ?? "", /already complete/)
  assert.match(decideComplete(task({ closedAt: "2026-10-19T12:00:00Z" }), ME) ?? "", /already complete/)
})

test("complete only applies to mailbox-created Data Upload tasks", () => {
  assert.ok(decideComplete(task({ origin: "dynamics" }), ME))
  assert.ok(decideComplete(task({ subtypeLabel: "Marketing Memo" }), ME))
  assert.ok(decideComplete(task({ createdByName: "Someone" }), ME))
})

test("REQUIRED CLIENT: a mailbox Data Upload task can't be completed without a client", () => {
  assert.equal(decideComplete(task({ clientId: null }), ME), "Set the client before closing this Data Upload task.")
  assert.equal(decideComplete(task({ clientId: "  " }), ME), "Set the client before closing this Data Upload task.")
  assert.equal(decideComplete(task({ clientId: "acct-1" }), ME), null)
})

test("REQUIRED CLIENT applies to mailbox-created Data Upload tasks only", () => {
  const base = { origin: "dashboard", subtypeLabel: "Data Upload", createdByName: DATA_UPLOAD_CREATED_BY, clientId: null }
  assert.ok(clientRequiredToClose(base))
  assert.equal(clientRequiredToClose({ ...base, origin: "dynamics" }), null) // synced from Dynamics
  assert.equal(clientRequiredToClose({ ...base, createdByName: "Jane Smith" }), null) // made by hand
  assert.equal(clientRequiredToClose({ ...base, subtypeLabel: "Marketing Memo" }), null)
  assert.equal(clientRequiredToClose({ ...base, clientId: "acct-1" }), null)
})

test("set client: open mailbox Data Upload tasks only, never in View as", () => {
  const t = { origin: "dashboard", stateLabel: "Open", closedAt: null, subtypeLabel: "Data Upload", createdByName: DATA_UPLOAD_CREATED_BY }
  assert.equal(decideSetClient(t, { impersonated: false }), null)
  assert.match(decideSetClient(t, { impersonated: true }) ?? "", /View as/)
  assert.match(decideSetClient({ ...t, stateLabel: "Completed" }, { impersonated: false }) ?? "", /already complete/)
  assert.ok(decideSetClient({ ...t, origin: "dynamics" }, { impersonated: false }))
})
