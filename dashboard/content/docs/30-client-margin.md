# 30 — Client Margin (Phase 1: known client hours)

## What it does (plain language)

**Client Margin** (`/client-margin`) adds up the hours the firm *knowably* spends on each active client over a time window. Phase 1 is **hours only**: there are no cost, revenue or margin columns yet. Those come in the next phase, once the hours have been sanity-checked against total firm capacity.

Each row is one **active client**. It shows:
- **Total hours.**
- The five categories that make up the total: **Booking**, **Hosting**, **Feedback collection**, **Report prep** and **Client management**.
- Meetings in the window (virtual / live). Hover to see held vs cancelled.
- **Client since.** Hover to see which field the date came from.
- An amber **"Less than one year"** flag for newer clients.

A **Grand total** row sits at the bottom. Every numeric column sorts; the default sort is total hours, high → low.

**Controls (top right):**
- **Time window.** Trailing 12 months (default), trailing 6 or 3 months, year to date, or the prior calendar year. It is held in the URL as `?window=12m|6m|3m|ytd|py`.
- **"Count booking hours on cancelled meetings"** (on by default). Turning it off removes cancelled meetings entirely. The KPI strip always shows **both** totals, with and without them.

**Who can open it.** Strict **super users** only; admins can't. It is registered in `HIDDEN_PAGE_REGISTRY` (`lib/access-control.ts`), which takes it off the nav and makes it super-user only. It is reached from **Admin → Hidden Pages**. The page also re-checks `isStrictSuperUser` before reading any data. It is read-only.

## The hours model

These rates apply per client, over the window. They live as constants in `HOURS` in `lib/client-margin/hours.ts`.

| Category | Rule | Hours |
|---|---|---|
| Booking | every meeting dated in the window (Confirmed, Pending, TBR **and Cancelled**) | virtual **1.0** · live **1.5** |
| Hosting | every **held** meeting | virtual **1.5** · live **3.0** |
| Feedback collection | every **held** meeting | **1.0** |
| Report preparation | every **completed** feedback report | **1.0** |
| Client management | 3.0 h per month as a client inside the window | **36** for a full year |

- **Held** means `meeting_status_label = 'Confirmed'` and the meeting date has already passed. TBR and Pending meetings count booking hours only.
- **Cancelled meetings (default).** Booking hours **count**, because the effort was spent. Hosting and feedback hours **do not**. **Confirmed by the user 2026-10-15.** Both totals are still shown for reference.
- **Client management pro-rate.** Months = (days as a client inside the window) × 12 / 365. For a full trailing year that is 12 months → 36 h. A client who started 6 months ago gets about 18 h. A client whose start date is in the future gets 0.
- **"Less than one year"** is measured from **today**, not from the window: the client's start date is within the last 365 days, or no start date is recorded.

## Field mappings

| Question | Field used | Notes |
|---|---|---|
| Active clients | `v_client_detail_summary` (the app-wide active set: `accounts.state_label = 'Active'`) | Test accounts (`accounts.is_test`) are dropped. |
| Virtual vs live | `meetings.is_in_person` (true = live) / `meetings.meeting_type_label` ('Live' / 'Virtual') | The two always agree. 2,307 old meetings have no type; **none fall in the trailing year**. Any blank type is counted at the virtual rate, and the page notes how many. |
| Cancelled / held | `meetings.meeting_status_label` ('Confirmed' / 'Pending' / 'TBR' / 'Cancelled') | Same rule as every other view (Productivity, Portfolio). **Ambiguity:** `meetings.cancelled_label` (Outlook / All / iPlanner Cancelled) is also set on ~70 Confirmed or TBR meetings in the last year. Those are **not** treated as cancelled here: the status field wins. |
| Meeting → client | `meetings.client_account_id` (direct) | Set on every meeting but 4. Where a meeting has an event, `events.client_account_id` agrees in 3,945 of 3,950 cases. The 5 that disagree follow the direct field. |
| Meeting date / window | `meetings.meeting_date` within [window start, window end) | Future-dated bookings are outside a trailing window. |
| Feedback reports | `tasks` with `bcs_task_subtype_label = 'Feedback'`, `state_label = 'Completed'`, client = `tasks.bcs_account_id`, dated by `actual_end` (fallback `modified_on`) | Covers Dynamics **and** dashboard reports. `bcs_account_id` is set on all 1,004 feedback tasks, and every completed one has an `actual_end`. Open and Canceled tasks are not counted. |
| Client start date | `accounts.original_start_date` (Dynamics `bcs_originalstartdate`) → else the earliest `contracts.contract_start_date` → else the first meeting (`client_since`) | **Ambiguities:** Gold Royalty's original start is 2026-11-15 (future) but its first meeting was 2023. On 4 clients (Agnico Eagle, OR Royalties, Danaher, Methanex), the original start and the earliest contract start are more than 90 days apart. |
| Test data | `meetings.is_test`, `tasks.is_test`, `accounts.is_test` | All excluded. |

## Where the code is

- `lib/client-margin/hours.ts` holds the pure model: the rates, the window options and `computeClientHours`. It has no imports, so tests and scripts run the same arithmetic. It is tested in `hours.test.ts`.
- `lib/client-margin/load.ts` is the server-only loader. It runs paged Supabase reads (no SQL view or patch needed) and resolves the start date.
- `app/client-margin/page.tsx` runs the gate and reads the window.
- `app/client-margin/client-margin-view.tsx` renders the table, sorting, toggle and totals.

## Next phase

Cost and margin will put a cost rate on these hours, using the existing cost-assumptions and salary data.

Decisions confirmed 2026-10-15:
- Cancelled meetings **keep** their booking hours (no hosting or feedback hours).
- Feedback collection counts **every held meeting**, whether or not feedback came in (`feedback_status_label` is not used).

Still open:
- Which start date wins for the four clients that disagree, and for Gold Royalty (future-dated original start).
