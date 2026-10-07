# 25 — Client Health

## What it does (plain language)

**Clients → Client Health** (`/client-health`) gives a retention-risk read on every **active** client, one row each:

| Rating | Client | Note |
|--------|--------|------|

- **Rating** is one of **1 · Healthy** (green), **2 · Monitor** (amber), **3 · High risk** (red), or **Management / IR Change** (navy). The badge always shows the words, not just a colour.
- **Note** is a short, management-level explanation, usually 1–3 sentences.
- **Firm order (the default view).** The page opens in the firm-standard order that everyone shares, as labelled sections in a fixed order: **High risk → Monitor → Management / IR Change → Healthy**, then **Not rated**. A client's section comes from the rating you see, so an override counts. Within each section, clients follow a **manual ranking that super-users set by dragging**. It is one order for the whole firm, not per person. See [Firm order](#firm-order) below.
- **Column sorting** is a temporary alternative view. Click any header to sort, and click again to reverse it; an arrow marks the active column. Rating sorts by the same risk order as the sections (High risk → Monitor → Management / IR Change → Healthy), and Client and Note sort alphabetically. Unrated clients and empty notes always sort to the bottom. While sorted by a column, the drag handles are hidden; the **Firm order** button returns to the default view.
- Both come from an AI model that reads the client's data and **all of its dated client notes**, most recent first, and applies Rose & Company's client-health framework. With no meaningful sign of risk, the rating is **1**.
- Ratings refresh **automatically every Monday morning**. **Refresh** in the header re-rates everyone right away, and the ↻ icon on a row re-rates just that client. **Last updated** shows when the newest AI rating was made.
- **Edit** (pencil) lets you override the rating and/or the note. An override is marked **Overridden** (hover to see who and when) and **is kept through every regeneration**. **Revert to AI** clears it.
- **An override is a strong opinion, not a permanent lock.** Every weekly (or manual) re-rating tells the AI about your override and asks it to weight it heavily. The AI still records its own current view, but **your override stays what the page shows**. If the AI's view moves away from yours, or new client notes / contract changes arrive after you last looked, the client is flagged **Needs review**. Nothing changes until a person decides. See [Override lifecycle](#override-lifecycle) below.
- Filter by rating (or "Overridden" / "Not rated" / "Needs review"), search by name, and **Excel** downloads the current view. The **Needs review (n)** button next to the filter jumps straight to flagged clients.

**Who can see it:** super-users only. Nobody else sees the nav item, and the route, the refresh API and the override actions all refuse them.

## Technical

### Files

| File | Role |
|------|------|
| `sql/patches/2026-10-01_client_health.sql` | Creates `public.client_health_assessments`. **Run in Supabase.** |
| `sql/patches/2026-10-07c_client_health_override_lifecycle.sql` | Adds the override-lifecycle columns (`override_mode`, `review_*`, `override_reviewed_at`) and baselines existing overrides. **Run in Supabase after the 2026-10-01 patch.** |
| `sql/patches/2026-10-07d_client_health_manual_rank.sql` | Adds `manual_rank` (the shared firm-order rank). **Run in Supabase after the 2026-10-07c patch.** |
| `dashboard/lib/client-health-order.ts` | Pure: the fixed category order + labels, the firm-order comparator, the category-change rule, and the within-category move. Tested by `client-health-order.test.ts`. |
| `dashboard/lib/client-health-review.ts` | Pure: the "Needs review" decision (`decideReview`) and the Prefer / Pin modes. Tested by `client-health-review.test.ts`. |
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
| `override_rating`, `override_note`, `overridden_by`, `overridden_at`, `override_mode` | The super-user override actions only (`app/client-health/actions.ts`) | Never touched by a regeneration. `overridden_by` is the real (not "View as") user's `users.user_id`. `override_mode` is `prefer` (default) or `pin`. |
| `override_reviewed_at`, `review_baseline_ai_rating` | The override actions only | The **review baseline**: when a human last looked, and what the AI said then. |
| `manual_rank` | `reorderHealthCategory` sets it; the regeneration and the override save / revert actions clear it | The shared firm-order position, 1..n within the client's category. NULL means not yet placed. See [Firm order](#firm-order). |
| `review_suggested`, `review_reason`, `review_flagged_at` | **Raised** by a regeneration, **cleared** only by the override actions | The open "Needs review" flag. `review_reason` is `divergence` or `new_evidence`. |

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

- **Human override** (only when one is active, in either mode): `buildOverrideContextBlock` in `lib/client-health-prompt.ts` appends a block at the very end of the payload. It gives the override's date, reviewer, rating and note (plus the date it was last reaffirmed, if later). It tells the model to treat the override as strong, recent human evidence, to diverge only if clearly newer information contradicts it and say why if it does, and still to return its own best rating and note.

### Classification

- **Prompt**: `CLIENT_HEALTH_FRAMEWORK` (verbatim), then `CLIENT_HEALTH_OUTPUT_INSTRUCTION`, which asks for one JSON object per client: `{"rating","note"}`. The app builds the table itself. The override block goes in the **per-client message, not this system prompt**: the system prompt is identical for every client and prompt-cached, and a per-client override there would break the cache.
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

`saveHealthOverride(accountId, rating, note, mode)`, `keepHealthOverride(accountId)` and `revertHealthOverride(accountId)` in `app/client-health/actions.ts`:

- **Gate**: `requireCrmWriter`, meaning effective super_user **and** not in "View as". Account ids are validated as uuids and must belong to an **active** client.
- **Writes**: `override_*` and `review_*` columns only, never `ai_*`. A blank rating means "keep the AI rating". A note identical to the AI note is not treated as an override.
- Every save, keep and revert calls `recordAudit` on entity `client_health_assessments`, with record id = `account_id` and a field diff, so they appear in **Admin → Audit Log**. The context names the action: `Override`, `Override · Pin` / `Override · Prefer` (a mode change), `Needs review · Keep`, `Needs review · Update`, `Needs review · Revert to AI`, or `Revert to AI`.

### Override lifecycle

An override is a **strong human prior**, not a permanent lock.

**1. Override as AI context.** Every regeneration (weekly cron, Refresh, row ↻) reads the client's override first. If one is active, in either mode, it is added to the model input (see *What the model is fed*).

**2. The shadow re-score.** The model's fresh rating and note are stored in `ai_*`, exactly as for any other client. `override_*` is never written, and the page keeps showing the override. The AI's view is the "shadow" a reviewer compares against.

**3. Needs review.** After storing the fresh `ai_*`, `updateReviewFlag` (`lib/client-health.ts`) applies `decideReview` (`lib/client-health-review.ts`) to **Prefer** overrides only:

| Reason | When | Shown as |
|--------|------|----------|
| `divergence` | The override has a **rating**, the fresh AI rating differs from it, **and** it also differs from `review_baseline_ai_rating`. That last test means a divergence someone already acknowledged with Keep doesn't re-flag while it stays the same. | The loud signal, "**AI now disagrees**". Red with ↑ when the AI reads **more** risk than the override, amber with ↓ when it reads less. Sorted first in the Needs-review view. |
| `new_evidence` | A client note **created** after `override_reviewed_at`, or a contract row created or edited after it. It uses the created date rather than `note_date`, so a back-dated note entered late still counts. Test rows are excluded. Any new note counts; the trigger is deliberately not narrowed yet. | The quiet signal, "**New activity since your override**", for example "2 new client notes and 1 contract change since the override was last reviewed". |

- Divergence wins when both apply. If the AI later disagrees, an open `new_evidence` flag is **upgraded** to `divergence` and keeps its original `review_flagged_at`. Otherwise an open flag is never rewritten.
- **Flags are sticky.** A regeneration only raises or upgrades a flag. A flag is never cleared automatically, even if the AI later comes back into line with the override; only a person resolves it.
- **Note-only overrides** have no rating to diverge from, so new evidence is their only review path.
- The flag update only applies if the baseline and mode haven't changed since the run read them. A Keep, Pin or Revert that lands while a run is in flight therefore wins.
- Flagging is best-effort. If the evidence query fails, the AI rating is still stored, a warning is logged, and the next run re-evaluates against the same baseline.

**4. Resolving a flag** (buttons on the row; every action is audited):

| Action | Effect |
|--------|--------|
| **Keep** | Reaffirms the override as-is. Clears the flag, and sets `override_reviewed_at` to now and `review_baseline_ai_rating` to the current AI rating. |
| **Update override** | Opens the editor. Saving writes a new override, clears the flag and re-baselines the same way. Any save from the editor does this. |
| **Revert to AI** | Clears the override and all review state, so the AI rating shows again. |

**Review-dedupe baseline.** `override_reviewed_at` and `review_baseline_ai_rating` are what stop the same unchanged situation from nagging.
- They are set when an override is saved. The baseline is the AI rating at that moment, since the reviewer has just disagreed with it.
- They are reset on every Keep, Update and mode change.
- New evidence means "since `override_reviewed_at`". Divergence means "differs from both the override and `review_baseline_ai_rating`".

So after Keep, a client only flags again if the AI's view **moves** or newer notes / contract changes arrive.

**5. Prefer vs Pin** (the **Stickiness** toggle in the editor):

| Mode | Behaviour |
|------|-----------|
| **Prefer** (default) | As above: the AI can challenge the override by raising a Needs-review flag. |
| **Pin** | A hard lock. Never flagged, so new evidence never forces a review. The AI still re-rates the client, with the override as context. The row shows a small **AI currently: X** line under the note (hover for the AI note), so a pinned override is never fully blind, and a **Pinned** tag next to **Overridden**. |

Switching **Prefer → Pin** clears any open flag **and** re-baselines (`override_reviewed_at` = now, `review_baseline_ai_rating` = the current AI rating). That way, switching back to Prefer later doesn't immediately re-flag the old divergence. Switching back to Prefer re-baselines too, and every mode change is audited.

**Page surface.**
- A **Needs review (n)** button sits beside the rating filter, and the filter has a matching "Needs review" option. Either one shows only flagged clients.
- Flagged clients are ordered: AI disagrees toward more risk, then AI disagrees toward less risk, then new activity. Within each group the usual sort applies.
- Each flagged row shows the override and the AI's current rating side by side, the AI's current note, the reason, and Keep / Update override / Revert to AI.
- There is **no app-wide nav notification yet**. The count could be raised to the nav or an Alerts item later.

**Not included yet.** Automatic aging is intentionally left out: an override that goes a long time without review doesn't soften to advisory. Add it if overrides turn out to go stale.

**Existing overrides.** For overrides that already exist, the 2026-10-07c patch sets `override_reviewed_at` to `overridden_at` and `review_baseline_ai_rating` to the current AI rating. The first run after the patch therefore flags only clients whose AI view moves, or that have had notes / contract changes since the override was made.

### Firm order

The default view of the page is a two-level sort that the whole firm shares.

**1. Fixed category order (not sortable).** The category is the client's **effective** rating: the override if there is one, otherwise the AI's. This fits the override lifecycle: a Prefer or Pin override decides the category.

| Order | Stored rating | Section |
|-------|---------------|---------|
| 1 | `'3'` | High risk |
| 2 | `'2'` | Monitor |
| 3 | `'Management / IR Change'` | Management / IR Change |
| 4 | `'1'` | Healthy |
| last | none | Not rated (never ranked, no dragging) |

The Rating column sort (`ratingSeverity` in `lib/client-health-prompt.ts`) and the "AI reads more / less risk" arrows in Needs review use this same order. A test checks the two agree.

**2. Shared manual rank within the category.** `manual_rank` is a single value per client on `client_health_assessments`, with no per-user table, so every viewer sees the same order. The page sorts in `lib/client-health-order.ts` (`compareFirmOrder`), equivalent to:

```sql
ORDER BY category_order(COALESCE(override_rating, ai_rating)),
         manual_rank ASC NULLS LAST,
         client_name ASC
```

The page still loads clients A→Z and sorts in the browser, as before.

**Reordering (drag-and-drop).**
- Each row in Firm order has a **grip handle** (⋮⋮). Drag a row by its grip, and drop it on another row **in the same section**. Rows in other sections don't accept the drop, because a client's section is set by its rating, never by dragging.
- **▲ / ▼** buttons appear on hover or keyboard focus to move a row one place, for keyboard and touch users. This reuses the browser's built-in drag-and-drop, the same pattern as the column editor (`components/table-views/column-editor.tsx`), with no extra library.
- Dragging is only available in **Firm order with no search and no filter**, apart from a single-rating filter, which still shows a whole section. Otherwise only part of a section might be visible, and renumbering it would be wrong. When dragging is off, a hint next to the filters says why.
- On drop, the new order shows immediately (optimistic), and the `reorderHealthCategory(category, orderedIds, movedId)` server action saves it, followed by a toast and a page refresh. If the save fails, the order snaps back and an error toast appears.

**The reorder action** (`app/client-health/actions.ts`):
- **Gate**: `requireCrmWriter`, meaning a super-user who is **not** in "View as".
- The server re-works out the section's current members: active clients whose effective rating is that category. If the list sent from the browser doesn't contain exactly those clients, it rejects with "refresh and try again". That covers a stale page and any attempt to move a client across sections.
- It then **renumbers the whole section 1..n**, writing only the rows whose rank changes. Sections are small, and full renumbering avoids fractional ranks drifting over time.
- **Audit**: one `recordAudit` row per drop, for the client that was moved. It records the `manual_rank` change, and the context reads e.g. `/client-health · Firm order · High risk: moved #5 → #2`. The audit log records who did it. Clients that shift as a side effect are not audited individually.

**Who can reorder.** The whole page is super-user only (`ADMIN_ONLY_ROUTES`). A super-user in **View as** sees the same firm order **read-only**: no grip or ▲▼ (`canReorder` is false), and the server action refuses them.

**Changing category, and new clients.** A client whose effective rating moves it to a **different section** has its `manual_rank` cleared (NULL). It drops to the bottom of the new section, A→Z among other unplaced clients, until someone drags it into place. Its old position is not carried over. This happens:
- in the regeneration, when the new AI rating changes the effective rating (clients with no override, or with a note-only override);
- in the override **save / Update** and **Revert to AI** actions, when they change the effective rating.

A **new client** has no rank either, so it also starts at the bottom of its section. When a section has some ranked clients, an unplaced one shows a dashed **Not placed** tag. While nobody has ranked a section yet, the tag is hidden and the section is simply A→Z.

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

1. Run `sql/patches/2026-10-01_client_health.sql` in Supabase, then `sql/patches/2026-10-07c_client_health_override_lifecycle.sql`, then `sql/patches/2026-10-07d_client_health_manual_rank.sql`.
2. ~~Paste the framework~~ — done 2026-10-01 (`CLIENT_HEALTH_FRAMEWORK`, verbatim).
3. Deploy. The cron needs `CRON_SECRET` and `ANTHROPIC_API_KEY`, which are already set for the AI summary.
4. Open `/client-health`, click **Refresh**, and spot-check the ratings.
