# 25 — Client Health

## What it does (plain language)

**Clients → Client Health** (`/client-health`) gives a retention-risk read on every **active** client, one row each:

| Client | Note | Rating |
|--------|------|--------|

- **Rating** is one of **1 · Healthy** (green), **2 · Monitor** (amber), **3 · High risk** (red), or **Management / IR Change** (navy). The badge always shows the words, not just a colour.
- **Note** is a short, management-level explanation, usually 1–3 sentences.
- Both come from an AI model that reads the client's data and **all of its dated client notes**, most recent first, and applies Rose & Company's client-health framework. With no meaningful sign of risk, the rating is **1**.
- Ratings refresh **automatically every Monday morning**. **Refresh** in the header re-rates everyone right away, and the ↻ icon on a row re-rates just that client. **Last updated** shows when the newest AI rating was made.
- **Edit** (pencil) lets you override the rating and/or the note. An override is marked **Overridden** (hover to see who and when) and **is kept through every regeneration**. **Revert to AI** clears it.
- Filter by rating (or "Overridden" / "Not rated"), search by name, and **Excel** downloads the current view.

**Who can see it:** super-users only. Nobody else sees the nav item, and the route, the refresh API and the override actions all refuse them.

## Technical

### Files

| File | Role |
|------|------|
| `sql/patches/2026-10-01_client_health.sql` | Creates `public.client_health_assessments`. **Run in Supabase.** |
| `dashboard/lib/client-health-prompt.ts` | Pure: the framework constant (**stored verbatim**), the JSON output instruction, the structured-output schema, `parseHealthOutput` validation, the four ratings + labels. Tested by `client-health-prompt.test.ts`. |
| `dashboard/lib/client-health.ts` | Aggregation (`buildClientHealthContext`), classification + storage (`generateAndStoreClientHealth`), error recording, the active-client list. |
| `dashboard/app/api/client-health/refresh/route.ts` | The one route behind the cron, Refresh, Regenerate and progress polling: start / continue / status / single. |
| `dashboard/lib/ai-batch.ts` | **Shared** throttling with the AI summary: config constants, jittered backoff, concurrency-capped runner. Tested by `ai-batch.test.ts`. |
| `dashboard/lib/client-health-runs.ts` + `client-health-run-policy.ts` | The `client_health_runs` row: single-flight, lease/heartbeat, progress. The pure policy is tested by `client-health-run-policy.test.ts`. |
| `dashboard/app/client-health/{page.tsx,health-view.tsx,actions.ts}` | The page, the table UI, and the override / revert server actions. |
| `dashboard/lib/client-health-excel.ts` | Excel export (lazy ExcelJS, same pattern as Outreach Status). |

### Table: `client_health_assessments`

One current row per client (`account_id` unique, FK → `accounts`). It has two halves:

| Columns | Written by | Notes |
|---------|-----------|-------|
| `ai_rating`, `ai_note`, `ai_model`, `ai_generated_at`, `run_id`, `ai_error`, `ai_error_at`, `ai_error_run_id` | The refresh route only (`lib/client-health.ts`) | A regeneration upserts **only these columns**. On a failure, only `ai_error*` is written and the previous rating stays. |
| `override_rating`, `override_note`, `overridden_by`, `overridden_at` | The super-user override actions only (`app/client-health/actions.ts`) | Never touched by a regeneration. `overridden_by` is the real (not "View as") user's `users.user_id`. |

The **effective** rating / note is `override_*` when present, otherwise `ai_*`. A CHECK constraint on **both** rating columns allows only `'1'`, `'2'`, `'3'`, `'Management / IR Change'`. RLS is on with no policies (service role only). There is no separate history table. Each regeneration overwrites the AI half, the same as the AI client summary does, and `run_id` groups each run.

### Active clients

These are the same set the AI summary and Client Detail use: `v_client_detail_summary` (`accounts.state_label = 'Active'`), via `listActiveClientIds` in `lib/client-summary.ts`.

### What the model is fed (`buildClientHealthContext`)

A labelled plain-text payload per client, starting with today's date:

- **Client**: name, ticker, account status, latest note-status flag + its date, sector, region, market cap, client since (`v_client_portfolio`, `v_client_detail_summary`, `accounts`).
- **Account team**: manager, secondary, associate, logistics coordinator (`accounts`).
- **Contract**: every `contracts` row oldest-first (the first is labelled *Initial*, later ones *Renewal #n*). For each: status, start / initial term end / renewal / termination dates, termination reason, auto-renew, renew flag, renewal check-in / notice dates, quarterly retainer, and contract notes. Also the latest term end, days to renewal, and annualized retainer. **The retainer is included** because the page is super-user only.
- **Meeting activity**: lifetime / LTM / prior-12m / YTD / 90-day / next-3-months counts, last and next meeting, open event slots, institutions and investors met (LTM), intro vs follow-up counts, feedback rate, cancellations in the last 6 months, and last marketing event. After that: the last 20 confirmed meetings (date + institution + in-person/virtual), upcoming non-cancelled meetings with their status, and the client's marketing events with their stage.
- **Recent touchpoints**: the last 15, with descriptions clipped to 600 chars.
- **Client notes**: **ALL** of them, **most recent first**, each with its date, status, risk driver, author, and action step / owner / due date. Note bodies are clipped at 3,000 chars. This is the primary signal.

Rows flagged `is_test` are excluded from notes, touchpoints and meetings.

### Classification

- **Prompt**: `CLIENT_HEALTH_FRAMEWORK` (verbatim), then `CLIENT_HEALTH_OUTPUT_INSTRUCTION`, which asks for one JSON object per client: `{"rating","note"}`. The app builds the table itself.
- **Model**: `HEALTH_MODEL` in `lib/client-health.ts` (`claude-sonnet-5-5`), called through the same `@anthropic-ai/sdk` client and `ANTHROPIC_API_KEY` as the AI summary. Structured output (`output_config.format` = JSON schema with `rating` as an enum) enforces the shape.
- **Validation**: `parseHealthOutput` requires a rating that is exactly one of the four and a non-empty note. An invalid answer is **retried once**. A second invalid answer writes nothing to the AI columns and records `ai_error` instead.
- **Framework guard**: until the framework text replaces the placeholder in `lib/client-health-prompt.ts`, `isFrameworkConfigured()` is false. The route then returns **503** without calling the model, and the page shows an amber banner. Overrides still work.

### Refresh: cron, button, per-client

All three go through one route, `/api/client-health/refresh`.

**Auth.** Either the `CRON_SECRET` bearer token or a signed-in **super_user** session (`requireSuperUser`). Anything else gets 401/403. `?action=continue` (the self-chained next batch) accepts the bearer only.

| Request | Who | What it does |
|---------|-----|--------------|
| cron GET (bearer, no `action`) | Vercel Cron | Start-or-resume, trigger `cron` |
| `POST ?action=start` | Refresh button | Start a full run, or resume a stalled one |
| `GET ?action=status` | Page, every 3 s | Running (or latest) run + `done` / `failed` counts |
| `POST ?action=continue&run_id=` | The route itself | Next batch of a run |
| `POST ?account_id=` | Row ↻ | Re-rate one active client now (409 while a full run is alive) |

**Shared throttling.** All AI calls in both this feature and the AI client summary go through `lib/ai-batch.ts`. That file is the one place for the limits (`AI_BATCH_CONFIG`):

| Constant | Value | Meaning |
|----------|-------|---------|
| `BATCH_SIZE` | 10 | Clients per invocation (one self-chained batch) |
| `MAX_CONCURRENCY` | 2 | Paid calls in flight at once (both features) |
| `DELAY_MS_BETWEEN_CHUNKS` | 2 s | Gap between concurrency groups inside a batch (both features). Holds about 25 req/min. |
| `DELAY_MS_BETWEEN_BATCHES` | 5 s | Pause before a chained batch starts |
| `MAX_RETRIES` | 3 | Retries per client on 429 / 529 / 5xx / timeout. Exponential backoff with **jitter**, about 5 s, 15 s, then 45 s. |

A timeout or dropped connection is reported as 408 so that it counts as transient. The framework system prompt is sent with **prompt caching**, so after the first call each batch reads it from cache. That costs less, and cached input tokens don't count toward the tokens-per-minute limit.

**Run row and single-flight.** `client_health_runs` has one row per run.
- A partial unique index allows **at most one `running` row**. A second start while a run is alive returns `already_running`, whether it comes from the button, another tab or the cron, and the page simply shows that run's progress.
- `lease_until` is the per-batch lock. The batch holding it renews it, along with `heartbeat_at`, after every group of calls. It releases the lock when handing off, and the next batch claims it with a conditional UPDATE.
- The pure rules (`isRunAlive`, `decideStart`) are in `lib/client-health-run-policy.ts` and unit-tested.

**Execution (serverless-safe).**
1. A start creates the run and responds **202** immediately.
2. The work runs in Next's `after()`: one batch of up to 10 clients. Each client is **upserted the moment it finishes**, so a crash loses at most the calls in flight.
3. If clients remain, the batch releases its lease and POSTs `?action=continue` to itself with the bearer token. That call claims the lease, responds 202, and runs the next batch in its own `after()`.
4. Each batch also stops starting new calls after 200 s, well inside `maxDuration` (300 s).

The repo had no existing background-job or self-chaining pattern; the AI summary drives its batches from the browser instead. This chain is new, and it depends on `CRON_SECRET` being set, because the route uses it to call itself.

**Resume.** A client is *done* for run R when `run_id = R` (rated) or `ai_error_run_id = R` (tried and failed). `listPendingForRun` skips both, so a resumed run never redoes completed clients.
- If a chain link dies (timeout, crash, a lost self-call), the run's heartbeat lapses after `LEASE_MS` (6 min) and the run reads as **stale**.
- The next **Refresh** (shown as **Resume**) or cron watchdog fire then reclaims it and continues.
- Clients that failed in a run are not retried within it. Use the row ↻, or start a new run.

**Weekly cron** (`vercel.json`): `0 9 * * 1` is Monday 09:00 UTC, which is **4:00 AM EST / 5:00 AM EDT**. Vercel cron runs on UTC only.
- Watchdog fires at `30 9,10,11 * * 1` hit the same route. They do nothing while a run is alive (`already_running`), and also once this week's run has started (`up_to_date`: a cron start is skipped if any run started in the last 3 days). They only matter if the chain stalled, in which case they resume the run.
- A manual Refresh always starts a fresh full run when nothing is running.

**Page.**
- On load and while a run is alive, the page polls status and shows "Updating n/N…", with a note that it runs on the server and you can leave the page.
- When the run finishes, the table reloads.
- A stalled run shows a message, and the button becomes **Resume**.

### Overrides + audit

`saveHealthOverride(accountId, rating, note)` and `revertHealthOverride(accountId)` in `app/client-health/actions.ts`:

- **Gate**: `requireCrmWriter`, meaning effective super_user **and** not in "View as". Account ids are validated as uuids and must belong to an **active** client.
- **Writes**: `override_*` columns only. A blank rating means "keep the AI rating". A note identical to the AI note is not treated as an override.
- Every save and every revert calls `recordAudit` on entity `client_health_assessments`, with record id = `account_id` and a field diff, so they appear in **Admin → Audit Log**.

### Access control summary

| Layer | Where |
|-------|-------|
| Route gate | `/client-health` in `ADMIN_ONLY_ROUTES` (`lib/access-control.ts`), enforced by `proxy.ts`. It cannot be granted through the Roles matrix. |
| Nav | Clients → **Client Health** in `components/nav.tsx`. It is filtered by `canAccessRoute`, so only super-users see it. |
| Page | `getEffectiveRole() === 'super_user'` before any read, otherwise a redirect to `/no-access`. |
| API | Cron bearer or `requireSuperUser()`. |
| Actions | `requireCrmWriter()`. |

Every read and write uses the service-role client (RLS bypassed), so these server-side checks are the only access control.

### Go-live checklist

1. Run `sql/patches/2026-10-01_client_health.sql` in Supabase.
2. ~~Paste the framework~~ — done 2026-10-01 (`CLIENT_HEALTH_FRAMEWORK`, verbatim).
3. Deploy. The cron needs `CRON_SECRET` and `ANTHROPIC_API_KEY`, which are already set for the AI summary.
4. Open `/client-health`, click **Refresh**, and spot-check the ratings.
