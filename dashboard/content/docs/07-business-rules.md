# 07 — Business Rules

## What it does (plain language)

Some numbers on the dashboard follow rules that aren't obvious from the label. This is the glossary of those tricky definitions — what each one actually means and exactly where it's implemented, so you can check or change it with confidence.

Unless noted, SQL rules live in `sql/03_views.sql` (repo root) and UI rules in `dashboard/app/...`.

---

## Client status carry-forward — "last non-blank status wins"

When a client's **newest** note leaves the health status blank, it does **not** clear the flag — the most recent note that actually *set* a status carries forward. Notes are ranked `note_date DESC, modified_on DESC, created_on DESC`, but only over rows whose status text is non-blank, then normalized to one of five flags: **At Risk / Stable / Lost / New Client / Strong**.

- Authoritative implementation: `v_client_portfolio`, `recent_note` CTE (`sql/03_views.sql`). Filter: `WHERE note_status IS NOT NULL -- only notes that actually set a status`.
- Duplicated deliberately in `v_live_outreach` (`client_status_label`) to keep the meaning identical to Portfolio.
- **Contrast:** `v_client_detail_recent_note` shows the *literal* newest note (which *can* be blank) and does **not** carry forward — that's why Client Detail's "latest note" can differ from Portfolio's status pill.

---

## "Occurred" / "concluded" meeting

There are **two** definitions, by layer:

- **Data layer (feedback is now due):** a meeting has occurred when its **Eastern calendar date is strictly before Eastern today**. Used in `v_feedback_outstanding`: `(m.meeting_date AT TIME ZONE 'America/New_York')::date < (now() AT TIME ZONE 'America/New_York')::date`. Same basis drives `v_client_marketing_status`.
- **Planning UI (grace window):** a meeting flips to "occurred" once the clock is **≥ 1 hour past its start** — `OCCURRED_GRACE_MS = 60 * 60 * 1000` in `app/planning-v2/planning-v2-view.tsx`, so a same-day meeting turns an hour after it starts.
- `v_planning_events` carries an `is_past` flag on the **same Eastern basis** as the data layer above: `(meeting_date AT TIME ZONE 'America/New_York')::date < (now() AT TIME ZONE 'America/New_York')::date` (the event-list scope uses the same Eastern comparison). The Planning V2 UI marks occurred rows with a small clock symbol only — it no longer dims or recolors them.

> The productivity/statistics views do **not** apply an "occurred" filter — they simply count Confirmed meetings by date (see *Confirmed-only counts*).

---

## Live vs virtual

- **Meeting level (the main switch):** `meetings.is_in_person` — `true` = live/in-person, `false` = virtual. Derived at sync time from the meeting-type label being "Live". Used across all statistics/detail views, e.g. `v_meetings_monthly`: `COUNT(*) FILTER (WHERE m.is_in_person = false) AS virtual_count`.
- **Scheduler occupancy:** virtual meetings occupy `[start, start+60]`; in-person occupy `[start−45, start+60+45]` (a 45-minute travel buffer each side). Interval math is client-side in `app/scheduler/scheduler-view.tsx`.
- **Event level (free-text derived):** `v_live_outreach.event_mode` is inferred from the `event_location` text (`ILIKE '%virtual%'` / `'%live%'` → Virtual / Live / Hybrid), because the Dynamics `bcs_eventtype` option set is empty.

---

## New-client window

- **Primary rule:** a client is "new" if its **earliest contract started within the last 6 months** — `v_live_outreach.is_new_client = earliest_contract_start >= CURRENT_DATE - INTERVAL '6 months'`. Drives the Live Outreach priority tier and "New Client" badge.
- **Onboarding scope (different thing):** the Onboarding page is scoped by a **fixed cutoff**, `onboarding_start_date >= 2026-01-01`, not a rolling window (`v_client_onboarding`).
- **"New Client" health flag (different again):** one of the five manually-set note statuses (parsed from note text `LIKE 'new client%'`), not a computed window.

---

## Open slots / availability

- **Event slots (a real counter):** `v_live_outreach.slots_remaining = of_slots − <count of Confirmed meetings on the event>`. Can be 0 or negative (overbooked); the UI clamps the display. Note: the separate `meeting_slots_max` / `spaces_available` columns are inert placeholders (always NULL).
- **Scheduler host availability (interval math):** a host is free at instant *T* if *T* falls in no busy band; bands are built from each meeting's start + duration/travel buffers and merged. `isBusyAt` uses a half-open interval (`t >= b.start && t < b.end`), so a meeting ending exactly at *T* frees the host. Client-side in `scheduler-view.tsx`; the SQL view deliberately does **not** precompute occupancy.

---

## Ticker-suffix stripping

Exchange suffixes are stripped in the **UI only**, and only in one place: the Client Detail hero monogram splits the ticker on a **hyphen** and keeps the first segment (e.g. `"ADT-US" → "ADT"`) — `app/client-detail/client-detail-view.tsx`: `if (ticker) return ticker.split("-")[0]`.

Everywhere else the raw `ticker_symbol` (from `accounts.tickersymbol`) is passed through unchanged. Note the convention here is **hyphen-based** (`ALH-US`), not space-based — there is no `" US"`/space-split normalization anywhere in the repo.

---

## Feedback: outstanding vs pipeline

Two different concepts on two different grains — a frequent point of confusion.

| | `v_feedback_outstanding` | `v_feedback_pipeline` |
|--|--------------------------|------------------------|
| **Grain** | One row per **meeting** | One row per **Feedback task** |
| **Means** | "We still owe feedback **collection** on this meeting" | "The feedback **report** for this event is being written / reviewed" |
| **Included** | Concluded, Confirmed, hosted meetings whose feedback is incomplete (`feedback_status_label IS NULL` OR "Awaiting Additional") | Feedback tasks in an active state, split into **In Progress** vs **Pending Review** |
| **Key join** | Responsible person from `_raw->>'_bcs_feedback_value'` → host | `event_key = COALESCE(regarding_id, bcs_event_id)` pairs a Feedback task to its "Feedback Report Sent" task |
| **Page** | `/feedback` | `/feedback-manager` |

`v_feedback_manager` is the older per-event concept, **superseded** by `v_feedback_pipeline`.

---

## Confirmed-only counts

Nearly every meeting aggregation filters `meeting_status_label = 'Confirmed'` (60+ occurrences). The canonical definition, from `v_relationships`: *"'Meeting' = a Confirmed meeting (meeting_status_label = 'Confirmed')."* Representative filter (`v_client_detail_summary`): `WHERE m.meeting_status_label = 'Confirmed'`.

A few older/forward-looking views instead **exclude Cancelled** rather than requiring Confirmed — e.g. `v_pipeline_30d` (`meeting_status_label != 'Cancelled' OR ... IS NULL`) and `v_profiles_upcoming` (`COALESCE(meeting_status_label,'') <> 'Cancelled'`) — because an upcoming meeting may legitimately not be "Confirmed" yet.

---

## Planning logistics columns (Sent / Confirm / Food / Driver / Notes)

These are now **real mirror columns** (as of the 2026-07-27 patch), not placeholders — but only three of the five carry data:

- These five columns apply to **Live (in-person) meetings only**. On a **virtual** row the whole five-column block renders as one continuous **grayed-out diagonal-hatch band** (with the internal dividers dropped) so it reads at a glance as "not applicable" — no per-cell content.
- On a **Live** row: `sent`, `confirm`, `driver` are genuine Dynamics Yes/No booleans (`bcs_Sent` / `bcs_Confirm` / `bcs_Driver`), populated in ~170 rows. They render via `BoolCell` in `app/planning-v2/planning-v2-view.tsx` exactly like a stage cell — **green check** when done, **empty grey ring** when not. The Planning V2 header groups all five under a **"Live Meetings Only"** band, and the three Yes/No columns carry a per-column completion ratio pill computed over live meetings only.
- `food_order` (`bcs_FoodOrder`) and `logistics_notes` (`bcs_Notes`) exist as columns but are **empty in every source row so far**, so on Live rows those two cells render a dash. They are free-text (no ratio pill), shown as a single truncated line with the full value on hover.

Mapping: `mappers.ts` (`sent`/`confirm`/`food_order`/`driver`/`logistics_notes`). Migration: `sql/patches/2026-07-27_meeting_event_logistics_fields.sql`. Surfaced in `v_planning_events`; the older `/planning` page ignores these columns.

> This updates an earlier note that said the four logistics fields don't exist yet — three of them now do and are populated.
