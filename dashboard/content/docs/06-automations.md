# 06 — Automations

## What it does (plain language)

A few jobs run on a schedule without anyone clicking anything. They're defined in `dashboard/vercel.json` and run on **Vercel Cron**. There are seven:

1. **Sync** — copy new Dynamics changes into Supabase (every 10 minutes, business hours, weekdays).
2. **Reconcile** — check for records deleted in Dynamics (nightly).
3. **AI client summaries** — regenerate the nightly client-summary text (nightly).
4. **Live Outreach email** — send the outreach digest to the team (weekday mornings).
5. **Feedback email (Monday)** — the outstanding-feedback digest, Monday.
6. **Feedback email (Tue–Fri)** — same digest, rest of the week.
7. **Week Ahead email** — the upcoming Mon–Fri meetings digest, sent Friday afternoon.

Vercel schedules everything in **UTC**, but the firm cares about **Eastern time**, which shifts an hour with daylight saving. The email jobs handle this cleverly: each is scheduled to fire **twice** (an hour apart) and a runtime check lets only the correct one through — so the email always lands at the same Eastern wall-clock time year-round, and a safety ledger guarantees it's sent **at most once per day**.

## Technical

### Cron inventory (`dashboard/vercel.json`)

Eastern effect assumes EDT (UTC−4) in summer, EST (UTC−5) in winter.

| Path | UTC schedule | Eastern effect | What it does |
|------|--------------|----------------|--------------|
| `/api/sync-dynamics` | `*/10 11-22 * * 1-5` | Every 10 min, ~7:00 AM–6:50 PM ET (EDT) / 6:00 AM–5:50 PM ET (EST), Mon–Fri | Incremental Dynamics → Supabase sync. Returns HTTP 207 if any entity errored. |
| `/api/reconcile-dynamics` | `0 5 * * *` | ~1:00 AM ET (EDT) / midnight ET (EST), daily | Deletion-reconciliation sweep (runs after the sync). |
| `/api/client-summary/refresh-all` | `0 8 * * *` | ~4:00 AM ET (EDT) / 3:00 AM ET (EST), daily | Nightly AI client-summary batch; regenerates only stale clients, paced to respect the Anthropic rate limit. Costs API money → must stay non-public. |
| `/api/live-outreach/send-email` | `30 11,12 * * 1-5` | Net **7:30 AM ET, Mon–Fri**, year-round | Emails the "Non-Deal Roadshow Update" digest to `team@rosecoglobal.com`. |
| `/api/feedback/send-email` | `15 12,13 * * 1` | Net **Monday 8:15 AM ET** | "Outstanding Feedback" digest (Monday variant). |
| `/api/feedback/send-email` | `45 12,13 * * 2-5` | Net **Tue–Fri 8:45 AM ET** | Same digest, Tue–Fri (30 min later than Monday). |
| `/api/week-ahead/send-email` | `45 19,20 * * 5` | Net **Friday 3:45 PM ET**, year-round | Emails the "Week Ahead" upcoming-meetings digest (next Mon–Fri) to `kmigliazza@roseandco.com`. |

The two feedback rows are the **same route** split by weekday so Monday goes out at 8:15 ET and Tue–Fri at 8:45 ET.

The **Week Ahead** digest is built from `v_planning_events` (Confirmed meetings for the coming Mon–Fri) and mirrors the same Outlook-safe builder + DST-safe gate + once-per-day ledger as the other two emails. It has **no dedicated page**; the only surface is the super-user **"Send Email" / "Send test email"** buttons in the header (top-right, `PageShell` `actions`) of the Upcoming Meetings page (`/pipeline`). The loader + builder live at `lib/week-ahead/{load.ts,email-html.ts}`. The window boundary (currently the upcoming Mon–Fri business week) lives in one commented constant (`WINDOW_LENGTH_DAYS`) in `lib/week-ahead/load.ts` so it can be switched to a rolling 7 calendar days later. The "In the New York office this week" banner and the week-grid pins are driven by the meeting field **`hosted_in_hq`** (Dynamics `bcs_HostedinHQ`), the authoritative office flag — not a city guess.

### Why two UTC fires per email job — DST-safe gating

UTC has no daylight saving; Eastern does. Firing at both `11:30` **and** `12:30` UTC covers 7:30 ET in both seasons (11:30 UTC = 7:30 EDT in summer; 12:30 UTC = 7:30 EST in winter). A runtime gate then admits **only** the fire that is actually inside the intended Eastern window, so exactly one send happens per day.

The gate is built from `easternNow()`, which formats `new Date()` through `Intl.DateTimeFormat` with `timeZone: "America/New_York"` and returns Eastern `{ weekday, hour, minute, date }`.

```ts
// live-outreach/send-email/route.ts — Live Outreach gate
const now = easternNow(new Date())
const isWeekday = now.weekday >= 1 && now.weekday <= 5
const inWindow = now.hour === 7 && now.minute >= 30
if (!isWeekday || !inWindow) return NextResponse.json({ ok: true, skipped: "outside-send-window" })
```

```ts
// feedback/send-email/route.ts — Feedback gate (different window by weekday)
if (wd === 1)               inWindow = now.hour === 8 && now.minute >= 15 && now.minute < 45  // Mon 8:15
else if (wd >= 2 && wd <= 5) inWindow = now.hour === 8 && now.minute >= 45                     // Tue–Fri 8:45
```

```ts
// week-ahead/send-email/route.ts — Week Ahead gate (Friday 3:45 PM ET)
const isFriday = now.weekday === 5
const inWindow = now.hour === 15 && now.minute >= 45
if (!isFriday || !inWindow) return NextResponse.json({ ok: true, skipped: "outside-send-window" })
```

The Week Ahead job fires at both `19:45` and `20:45` UTC; the gate admits only the fire that lands at 3:45 PM ET (19:45 UTC = 3:45 EDT in summer; 20:45 UTC = 3:45 EST in winter).

### Once-per-day idempotency — `cron_send_log`

Second guard behind the time window. The `cron_send_log` table has a **primary key on `(job_key, sent_on)`**, so only the first insert for a given Eastern date succeeds; a duplicate delivery hits a unique violation and is told the day is already claimed. Logic in `dashboard/lib/live-outreach-send-log.ts`:

```ts
// claimDailySend — atomic, FAIL-CLOSED
const { error } = await sb.from("cron_send_log").insert({ job_key: jobKey, sent_on: sentOn })
if (!error) return { claimed: true }
if (error.code === "23505") return { claimed: false, reason: "already-sent-today" }
return { claimed: false, reason: `claim-error: ${error.message}` }   // ANY DB error → do NOT send
```

- Job keys: `live_outreach_digest`, `feedback_digest`, and `week_ahead_digest`.
- **Fail-closed:** if the ledger can't be written for *any* reason, the route does not send (safer than risking a team-wide double-send).
- `releaseDailySend()` deletes the claim so a later retry can resend — called **only** when the send itself fails *after* a successful claim.

Each route's sequence: **gate → claim → (skip if not claimed) → send → release-on-failure.**

### Authorization — `CRON_SECRET` bearer token

`/api/*` routes are excluded from the auth proxy, so each cron route checks its own bearer token and **fails closed** if the secret is unset:

```ts
const secret = process.env.CRON_SECRET
if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
```

Vercel Cron injects this header automatically. The three data/AI routes also expose a **POST** behind the same bearer check for the admin "Run now" buttons (a server action adds the header server-side). The two email routes' POST instead requires a signed-in `super_user` (`requireSuperUser()`) for manual/test sends — that path is not part of the cron flow.

### On/off state

There is **no runtime feature-flag or "off until validated" gate** in the code — a cron is "on" purely by being present in `vercel.json`, and all seven entries are present there. The **Week Ahead** entry is wired into `vercel.json` but should be validated via a **test send** from the Upcoming Meetings (`/pipeline`) header before its first live Friday fire.

> **Deployment nuance:** what's committed in `vercel.json` locally is not necessarily what's live. These schedules only fire on the **production deployment**, so whether the two email digests are actually sending depends on what has been deployed. The email digests were built to be validated before going live; the layered safeguards above (Eastern-window gate, fail-closed secret, once-per-day ledger) mean a stray fire cannot double-send. To truly stop a digest, remove/comment its entry in `vercel.json` (or rotate `CRON_SECRET`, which disables all seven). Confirm current behavior against the deployed Vercel project and the `cron_send_log` table.
