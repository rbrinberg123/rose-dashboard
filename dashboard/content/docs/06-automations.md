# 06 — Automations

## What it does (plain language)

A few jobs run on a schedule without anyone clicking anything. They're defined in `dashboard/vercel.json` and run on **Vercel Cron**. There are eight:

1. **Sync** — copy new Dynamics changes into Supabase (every 10 minutes, business hours, weekdays).
2. **Reconcile** — check for records deleted in Dynamics (nightly).
3. **AI client summaries** — regenerate the nightly client-summary text (nightly). Only *stale* clients, so after a prompt change you rewrite the whole book yourself: click **Refresh all AI summaries** in **Admin → Maintenance** (no command line needed), or run `npm run refresh-summaries`. See _One-time forced regenerate_ below.
4. **Live Outreach email** — send the outreach digest to the team (weekday mornings).
5. **Feedback email (Monday)** — the outstanding-feedback digest, Monday.
6. **Feedback email (Tue–Fri)** — same digest, rest of the week.
7. **Week Ahead email** — the upcoming Mon–Fri meetings digest, sent Friday afternoon.
8. **Time Off email** — the weekly team time-off digest (this week + the month ahead), sent Monday morning.

Vercel schedules everything in **UTC**, but the firm cares about **Eastern time**, which shifts an hour with daylight saving. The email jobs handle this cleverly: each is scheduled to fire **twice** (an hour apart) and a runtime check lets only the correct one through — so the email always lands at the same Eastern wall-clock time year-round, and a safety ledger guarantees it's sent **at most once per day**.

## Technical

### Cron inventory (`dashboard/vercel.json`)

Eastern effect assumes EDT (UTC−4) in summer, EST (UTC−5) in winter.

| Path | UTC schedule | Eastern effect | What it does |
|------|--------------|----------------|--------------|
| `/api/sync-dynamics` | `*/10 11-22 * * 1-5` | Every 10 min, ~7:00 AM–6:50 PM ET (EDT) / 6:00 AM–5:50 PM ET (EST), Mon–Fri | Incremental Dynamics → Supabase sync. Returns HTTP 207 if any entity errored. |
| `/api/reconcile-dynamics` | `0 5 * * *` | ~1:00 AM ET (EDT) / midnight ET (EST), daily | Deletion-reconciliation sweep (runs after the sync). |
| `/api/client-summary/refresh-all` | `0 8 * * *` | ~4:00 AM ET (EDT) / 3:00 AM ET (EST), daily | Nightly AI client-summary batch; regenerates only stale clients, paced to respect the Anthropic rate limit. Costs API money → must stay non-public. **The summary is shown to everyone**, so it never states retainer / fee amounts for anyone — the retainer is withheld from the model's input and the prompt forbids money figures (renewal **dates** are kept). See [01 — Access & Users → The Financials permission](01-access-and-users.md). Summaries cached before that change may still quote a figure until this batch regenerates them. |
| `/api/live-outreach/send-email` | `30 11,12 * * 1-5` | Net **7:30 AM ET, Mon–Fri**, year-round | Emails the "Non-Deal Roadshow Update" digest to `team@rosecoglobal.com`. |
| `/api/feedback/send-email` | `15 12,13 * * 1` | Net **Monday 8:15 AM ET** | "Outstanding Feedback" digest (Monday variant). |
| `/api/feedback/send-email` | `45 12,13 * * 2-5` | Net **Tue–Fri 8:45 AM ET** | Same digest, Tue–Fri (30 min later than Monday). |
| `/api/week-ahead/send-email` | `45 19,20 * * 5` | Net **Friday 3:45 PM ET**, year-round | Emails the "Week Ahead" upcoming-meetings digest (next Mon–Fri) to `kmigliazza@roseandco.com`. |
| `/api/time-off/send-email` | `0 12,13 * * 1` | Net **Monday 8:00 AM ET**, year-round | Emails the weekly "Time Off" digest (this week + the current month) to the four fixed `TIME_OFF_RECIPIENTS` (simon@, robert@, blair@, scott@ roseandco.com). |

The two feedback rows are the **same route** split by weekday so Monday goes out at 8:15 ET and Tue–Fri at 8:45 ET.

The **Time Off** digest is built from `v_time_off` (the same data as the `/time-off` page) and mirrors the same Outlook-safe builder + DST-safe gate + once-per-day ledger as the other emails. Its surface is the super-user **"Send Email" / "Send test email"** buttons in the `/time-off` page header (`ListTitleCard` `rightSlot`, super-user-only; the route also enforces `super_user`). The loader + builder live at `lib/time-off/{load.ts,email-html.ts}`, which roll `v_time_off` into two windows — the current Mon–Fri business week and the current calendar month — reusing the page's OOO/Remote typing and its per-day sort (OOO before Remote, then person). Recipients are the dedicated `TIME_OFF_RECIPIENTS` constant, deliberately separate from every other digest's recipient list. The `team` send delivers to all four in one message; the `test` send goes only to the typed address.

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

```ts
// time-off/send-email/route.ts — Time Off gate (Monday 8:00 AM ET)
const isMonday = now.weekday === 1
const inWindow = now.hour === 8
if (!isMonday || !inWindow) return NextResponse.json({ ok: true, skipped: "outside-send-window" })
```

The Time Off job fires at both `12:00` and `13:00` UTC on Mondays; the gate admits only the fire that lands at 8:00 AM ET (12:00 UTC = 8:00 EDT in summer; 13:00 UTC = 8:00 EST in winter).

### Once-per-day idempotency — `cron_send_log`

Second guard behind the time window. The `cron_send_log` table has a **primary key on `(job_key, sent_on)`**, so only the first insert for a given Eastern date succeeds; a duplicate delivery hits a unique violation and is told the day is already claimed. Logic in `dashboard/lib/live-outreach-send-log.ts`:

```ts
// claimDailySend — atomic, FAIL-CLOSED
const { error } = await sb.from("cron_send_log").insert({ job_key: jobKey, sent_on: sentOn })
if (!error) return { claimed: true }
if (error.code === "23505") return { claimed: false, reason: "already-sent-today" }
return { claimed: false, reason: `claim-error: ${error.message}` }   // ANY DB error → do NOT send
```

- Job keys: `live_outreach_digest`, `feedback_digest`, `week_ahead_digest`, and `time_off_digest`.
- **Fail-closed:** if the ledger can't be written for *any* reason, the route does not send (safer than risking a team-wide double-send).
- `releaseDailySend()` deletes the claim so a later retry can resend — called **only** when the send itself fails *after* a successful claim.

Each route's sequence: **gate → claim → (skip if not claimed) → send → release-on-failure.**

### Admin button — "Refresh all AI summaries" (super-user)

**Admin → Maintenance** has a **Refresh all AI summaries** button. It does exactly what the command below does, from the browser, so nobody has to touch a terminal or the cron secret.

- **Confirms first.** It is a paid action, so it asks — *"Regenerate ~108 client summaries? This calls the AI and may take a few minutes."* — with the live active-client count filled in. Nothing happens until you confirm.
- **Live progress.** A line under the button reads `Regenerating… 45 of 108 (0 failed)` and settles to `Done — 108 summaries regenerated.` (or a "finished with errors, run it again to retry" line).
- **One run at a time.** The button disables while running and a synchronous lock blocks a double-click or a second concurrent run.
- **Whatever environment you click it in.** It uses the prompt the *server* is running and writes to that server's Supabase — so clicking it on production refreshes production with the deployed prompt. The nightly cron is untouched.
- **Interruptible.** Closing the tab stops the run; clicking again resumes from where it stopped rather than starting over.

**How it works.** `dashboard/app/admin/refresh-summaries-card.tsx` drives the **existing** `/api/client-summary/refresh-all` route in small batches from the browser — the same `force=1` + `before=` + `limit=` loop as the CLI script — repeating until the response's `remaining` hits 0. It contains no generation logic: pacing, per-client backoff, and the resume window all come from the route. Short requests are what keep any single call clear of a serverless timeout. The loop's stopping rules (finished / no-forward-progress) are the pure, unit-tested `lib/client-summary-refresh.ts`.

**Auth.** The route now authorizes **either** the cron bearer token **or** a signed-in `super_user` session (`requireSuperUser()`, the same guard the email routes' manual sends use) — so the browser sends only its session cookie and `CRON_SECRET` never reaches the client. The server is the gate: rendering the button is not what authorizes it, and an unauthenticated `POST` to the route gets a 401.

### One-time forced regenerate from the command line — `npm run refresh-summaries`

The nightly cron only touches **stale** clients, so a change to the summary prompt reaches everyone slowly (and never reaches a client whose data hasn't moved). To rewrite the whole book at once — the case after the retainer/fee amounts were removed from the prompt — run:

```bash
npm run refresh-summaries
```

It is **manual only**. Nothing triggers it: no cron entry, no deploy hook, no build step. It fires when you run it.

> **⚠️ Sequencing.** The prompt used is whatever the **target server** is running, not what is in your working tree. `npm run refresh-summaries` targets `http://localhost:3000` (your local dev server → your local code), writing to whichever Supabase project `.env.local` points at. To run it against the deployed app instead, deploy the prompt change **first**, then:
>
> ```bash
> npm run refresh-summaries -- --url https://<your-app>.vercel.app
> ```
>
> Running it against a server still on the old prompt just re-bakes the old text in.

**What it does.** `dashboard/scripts/refresh-summaries.mjs` drives `/api/client-summary/refresh-all` in small batches with `force=1`, printing a line per pass:

```
pass  1 — 15 regenerated, 0 failed · 15/108 clients complete · 93 remaining · 58s
```

**Flags:** `--url <base>` target server · `--batch <n>` clients per request (default 15) · `--dry-run` regenerate exactly one client and stop · `--restart` ignore a saved campaign and begin fresh.

**Resumable.** The script stamps a campaign timestamp and passes it as `before=`; the route regenerates only clients whose `ai_summary_generated_at` is null or **older** than it. A client that succeeds gets a newer timestamp and drops out of the filter, so **re-running the same command after a crash, timeout, or Ctrl-C continues where it stopped** rather than starting over (and re-paying for work already done). The timestamp is saved in `dashboard/.refresh-summaries-state.json` (gitignored), reused automatically for 24 hours, and deleted when the campaign completes.

**Safe.** Writes are `UPDATE`s of `accounts.ai_summary` / `ai_summary_generated_at` — always **overwrite**, never append — so a re-run cannot duplicate or corrupt anything. Generation stays paced at 2 concurrent calls with a 2-second gap between chunks (~27 req/min), and each client now gets its own **exponential backoff** (5s → 15s → 45s) on a 429 / 529 / 5xx before being counted as failed. One client failing never stops the batch; failures are listed at the end and are picked up by simply re-running. If a whole pass fails, the script stops rather than looping, so a bad key or exhausted quota surfaces immediately.

**Raw endpoint**, if you'd rather not use the script:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET"   "http://localhost:3000/api/client-summary/refresh-all?force=1&before=2026-08-19T00:00:00Z&limit=15"
```

| Param | Meaning |
|---|---|
| `force=1` | Regenerate every active client, skipping the staleness check. Required for the two below. |
| `before=<ISO>` | Only clients whose summary is older than this instant — the resume window. Keep it **fixed** across retries. |
| `limit=<n>` | Cap this invocation; the response's `remaining` says how many are left. |

The response reports `active` / `eligible` / `attempted` / `skipped` / `succeeded` / `failed` / `remaining`. Loop while `remaining > 0`. Progress is also logged server-side (`[refresh-all] 30/108 done — 30 ok, 0 failed`).

### Authorization — `CRON_SECRET` bearer token

`/api/*` routes are excluded from the auth proxy, so each cron route checks its own bearer token and **fails closed** if the secret is unset:

```ts
const secret = process.env.CRON_SECRET
if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}
```

Vercel Cron injects this header automatically. The three data/AI routes also expose a **POST** behind the same bearer check for the admin "Run now" buttons (a server action adds the header server-side). The two email routes' POST instead requires a signed-in `super_user` (`requireSuperUser()`) for manual/test sends — that path is not part of the cron flow.

`/api/client-summary/refresh-all` accepts **either**: the bearer token (cron + the CLI script) **or** a signed-in `super_user` session, so the Admin → Maintenance button can call it straight from the browser with no token. The session check runs only when the header is absent, leaving the cron path a pure header comparison. The header half is the pure, unit-tested `hasCronBearer` (`dashboard/lib/cron-auth.ts`), which **fails closed** on an unset secret.

### On/off state

There is **no runtime feature-flag or "off until validated" gate** in the code — a cron is "on" purely by being present in `vercel.json`, and all eight entries are present there. The **Week Ahead** and **Time Off** entries are wired into `vercel.json` but should each be validated via a **test send** from their page header (Upcoming Meetings `/pipeline`, and `/time-off`) before their first live fire.

> **Deployment nuance:** what's committed in `vercel.json` locally is not necessarily what's live. These schedules only fire on the **production deployment**, so whether the email digests are actually sending depends on what has been deployed. The email digests were built to be validated before going live; the layered safeguards above (Eastern-window gate, fail-closed secret, once-per-day ledger) mean a stray fire cannot double-send. To truly stop a digest, remove/comment its entry in `vercel.json` (or rotate `CRON_SECRET`, which disables all seven). Confirm current behavior against the deployed Vercel project and the `cron_send_log` table.
