# 29 — Client status (= the Client Health rating)

## What it does (plain language)

Since 2026-10-15, a client has **one status everywhere**: its **Client Health rating**. That's the final rating shown on the Client Health page. A super user's override wins; otherwise it's the AI's rating.

| Status | Colour | Meaning |
|---|---|---|
| **High Risk** | red | most urgent |
| **Monitor** | amber | |
| **Management / IR Change** | yellow-amber (lemon fill, olive-gold text) | one combined category; same family as Monitor but a distinct shade — `MANAGEMENT_IR_STYLE` in `lib/client-status.ts` |
| **Healthy** | green | |
| **No Rating** | grey / em dash | not rated yet |

Lists that sort or group by status use this order (most urgent first), with No Rating always last. **No numbers are shown anywhere.** The old "1 · / 2 · / 3 ·" prefixes are gone, though the database still stores the codes `"1"` / `"2"` / `"3"`.

**Where you see it:**
- **Portfolio:** the Status column, its filter, severity sort, colour key and printed report.
- **Client Statistics:** the "Clients by Status" donut. Clicking a slice or legend row opens Portfolio filtered to it.
- **Outreach Status** (`/clients/to-do`): the Status column, sort and Excel export.
- **Client Detail:** the status pill beside the client's name.
- **Client Health:** the badges, the override picker, filters and the Excel export.
- **Live Outreach (page and daily email):** the red **"High Priority"** flag looks exactly as before. It now means *either* the event's **Urgency = High**, *or* the client's rating is **High Risk**. The sort puts those clients next, after High-urgency events and ahead of new clients. The **New Client** flag is unchanged (a contract started in the last 6 months).

**Who sees what.** The rating **label** is now visible to anyone who can open those pages, not just super users. The **reasoning** (the AI note and any override note) stays on the super-user-only Client Health page and is never sent to the other pages.

**What was retired.** Status used to come from the **latest client note's "Status" field** (At Risk / Lost / New Client / Stable / Strong):
- The views no longer compute it.
- The note form no longer has a Status field.
- Client Detail no longer guesses a status from the note text.

Old notes keep their recorded status as **history**. It's still visible, read-only, in the Notes table and record pane, and the "At Risk" saved view on Notes still filters that history.

## Technical

**Source.** `COALESCE(client_health_assessments.override_rating, ai_rating)`, exposed as **`health_rating`** on:
- `v_client_portfolio` (Portfolio, Outreach Status, the donut)
- `v_live_outreach` (page, email, summary)

Client Detail reads `client_health_assessments` directly for its one client, selecting the two rating columns only. Patch: `sql/patches/2026-10-15_client_status_from_health.sql`.
- `health_rating` is **appended** to both views. The old `note_status` / `note_status_date` / `client_status_label` columns stay in place (so no `DROP` was needed) but are now always `NULL` and unread.
- `v_client_stats_by_status` buckets by `health_rating`, in Client Health order. `bucket` is the code, or `'No Rating'`.
- Nothing was dropped and no data changed. `client_notes.status_text` and `v_client_detail_recent_note` are untouched.

**The shared module — `lib/client-status.ts`** (browser-safe). Everything reads it, Client Health included. It is built from the Client Health constants in `lib/client-health-order.ts`:
- `CLIENT_STATUS_ORDER` = `FIRM_CATEGORY_ORDER`
- labels = `FIRM_CATEGORY_LABEL`, which are number-free; `HEALTH_RATING_LABEL` in the prompt module matches them, and `client-health-order.test.ts` pins that
- `clientStatusLabel`, `clientStatusStyle` / `CLIENT_STATUS_STYLE`, `clientStatusVariant`, `clientStatusRank`, `NO_RATING_LABEL`, the `NO_RATING` filter sentinel and `HIGH_RISK`
- colours on the shared `STATUS_PILL_LIGHT` palette (this was `RATING_STYLE` on the Client Health page)

It deliberately does not import `lib/client-health-prompt.ts`, which carries the AI framework text. The pill and legend are `components/client-status.tsx` (`ClientStatusPill`, `ClientStatusLegend`). They replace the deleted `components/note-status.tsx` and the removed `NOTE_STATUS_PILL` palette.

**URL change.** Portfolio's status filter is now `?health=<code>`, or `?health=__none__` for No Rating (was `?note_status=`).

**Live Outreach.** `priorityFlagKind` (`app/live-outreach/priority-flag.ts`, shared by the page, email and summary) returns `"high"` for `urgency === "High"` → else `is_new_client` → `"new"` → else `health_rating === HIGH_RISK` → `"high"`. `priorityTier` in `load.ts` uses the same High Risk test for tier 2.

**AI input.** The Client Health context no longer includes "Latest client-note status flag" or its date (`lib/client-health.ts`). Each individual note in the notes history still shows its recorded status.

**Notes.** `NOTE_STATUS_OPTIONS` and the `statusText` input were removed (`lib/notes/create.ts`, `app/notes/new-note-dialog.tsx`, `app/notes/actions.ts`). A new dashboard note leaves `status_text` NULL, and editing a note leaves it unchanged.

**Untouched:**
- My Dashboard and its critical count: it never read status. It only uses the `STATUS_PILL_LIGHT.atRisk` colour token, which keeps its name.
- `accounts.client_status_label` (Current / Past, an unrelated CRM field).
- `is_new_client`.
