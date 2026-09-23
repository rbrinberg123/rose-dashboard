# 16 — Notes (all CRM)

> **Status: built, SQL PENDING.** The page is at `/notes`, reached from the **CRM** block at the bottom of the main nav rail (super-user-only).
>
> **`sql/patches/2026-09-15_admin_notes.sql` has not been run yet.** Until it is, the page loads and gates correctly but shows "Could not load saved views" with the patch filename — it fails soft, it does not crash. The patch creates `v_admin_notes_all`, `v_admin_notes_filter_options`, `note_saved_views` and five indexes. The same objects are also in the base files (`sql/01_mirror_tables.sql`, `sql/02_rose_owned_tables.sql`, `sql/03_views.sql`).
>
> **Not yet pushed to any remote.** The application code is local-only.

> **"+ Add New Note" is a placeholder.** The button top-right of the masthead — and the matching entry in the nav's CRM quick-add menu — create nothing yet. No form, no write, no navigation: clicking shows a "Coming soon" toast. Both route through the single stub `onAddNew("note")` in `dashboard/components/crm-add-new.tsx`, staged for the CRM cutover. See [02 — Pages](02-pages.md#add-new-buttons-and-the-quick-add-menu--placeholders-not-wired-up).

## What it is

Every client-review note in the CRM, in one table — the fifth CRM feature, built on the same machinery as [12 — Meetings](12-meetings-all.md), [13 — Events](13-events.md), [14 — Tasks](14-tasks.md) and [15 — Touches](15-touches.md). Saved views, the column picker, the filter builder, quick-filter dropdowns, the detail drawer, the row cap and the Excel export are all the *same code*, parameterised per entity. See [Shared architecture](#shared-architecture).

`public.client_notes` mirrors the Dynamics **`bcs_clientnote`** entity: a monthly client-review record, one per client per cycle.

- **693 live rows**, `note_date` spanning **2026-02-04 to 2026-09-11** — the whole archive is about seven months old.
- **111 clients**, **9 review cycles** ("Client Review - Feb. 2026" … "Client Review September 2026"), **2 authors** (Grace Andonian 364, Robert Brinberg 329).
- **Status:** Stable 357 · At Risk 110 · New Client 21 · Lost 18 · Strong 3 · "At Risk." 2 · Pause 1 · unset 181.
- **No row scoping.** `v_admin_notes_all` is unscoped; every client's notes are returned to whoever loads the page.
- **View only.** Nothing is editable and nothing writes back — Dynamics is the system of record.

## Security

Identical to the other four CRM pages in mechanism, but this one deserves the most care. The others are records of *what happened*; this table is the firm's candid internal **assessment** of each relationship — "At Risk", the risk driver, what somebody still owes whom. Treat a leak here as worse than a leak of the meeting log.

Three independent gates:

1. **`lib/access-control.ts` `ADMIN_ONLY_ROUTES`** now holds `/meetings`, `/events`, `/tasks`, `/touchpoints` **and** `/notes` — super-user-only, and **not** grantable to another role through the Admin → Roles matrix. Checked *after* the super-user backstop and *before* the matrix lookup, so a stray `role_page_access` row cannot open it.
2. **`proxy.ts`** runs `canAccessRoute` before the page renders.
3. **`app/notes/page.tsx`** re-checks the **effective** role server-side before it builds any query — a page is not the only way in, so it does not assume the proxy ran.

Every server action in `app/notes/actions.ts` re-checks too, because a server action is its own entry point and can be invoked directly.

The nav entry is gated by `canSeeCrmNav`, which requires **both** `role === "super_user"` **and** `canAccessRoute`. For a non-super-user the whole CRM block is absent from the DOM — no item, no divider. Covered by `lib/nav-crm.test.ts`, which asserts the rule for every role in the system and for every item in the block, including a case where the matrix explicitly grants `/notes` and it is *still* denied.

**Verified:** unauthenticated `/notes` → `307` to `/login?next=%2Fnotes`, the same as `/touchpoints`.

## The seven list columns

| # | Column | Source (`v_admin_notes_all`) | Notes |
|---|--------|------------------------------|-------|
| 1 | **Client** | `client_account_name` + `accounts.ticker_symbol` | Shows the **ticker** (full name on hover), **links** to `/client-detail?account_id=…`. 668 of 693 rows resolve a ticker |
| 2 | **Date** | `note_date` | The review date. 96% populated |
| 3 | **Note** | `note_body` | **The row's handle** — one truncated line, hover for the full text, click to read it properly in the drawer |
| 4 | Status | `status_text` | Coloured pill — see [Status](#status-and-risk-driver-are-trimmed) |
| 5 | Risk Driver | `primary_risk_driver` | 20 distinct values after trimming. Empty on 54% of rows |
| 6 | Action Step | `action_step` | What was agreed. Only 29% of notes carry one |
| 7 | Owner | `owner_name` | Circle avatar. The note's author — see [Owner](#owner-is-a-real-person-but-had-no-name-column) |

**Available but hidden** (add via *Edit columns*): Review Cycle, Action Owner, Action Due, Created By, Modified By, Created, Modified, Note (raw), State, Sys Status, Last 12 Months and the raw ticker.

### Column groups

Six bands, in picker order: **Client · Note · Assessment · Action · People · System**. A band is a run of *adjacent* columns, so the default column order is what decides where the rules fall.

## Default view: Recent notes

`is_recent` — a rolling last-12-months window — **668 of 693** rows, sorted by date **descending**.

**Flagging the choice, because the obvious reading of it is wrong.** The brief asked for a recent-notes default and left the window to the data. The data is seven months old, so *every dated note is already inside a 12-month window* and the filter excludes nothing on recency grounds today.

It is still the right default, for a different reason: **25 of the 693 rows are empty shells** — no date, no client, no body, no review cycle. Incomplete records sitting in the CRM. Filtering on the date drops exactly those 25 and nothing else (verified: zero of the excluded rows carry a body, a client or a cycle), so the page opens on 668 rows of real content. **All notes** is one click away for anyone who wants the shells too.

When the archive passes a year the filter starts doing its literal job as well, with no code change — `is_recent` is computed in the view and re-evaluated on every query rather than frozen into a saved filter. (The shared filter grammar has no relative-date token; see [15 — Touches](15-touches.md#why-is_recent-and-not-a-date-filter) for the full reasoning.)

The other built-ins:

- **At Risk** — `status_text` *starts with* "At Risk" rather than equalling it, so the two `"At Risk."` typo rows are caught alongside the 110 clean ones. 112 rows.
- **Open actions** — notes with an action step (203 rows), sorted by **Action Due ascending**, and carrying its own column set: Action Owner and Action Due earn their place here and nowhere else.
- **All notes** — 693 rows, shells included.

## The detail drawer

Slides in from the right as a **sibling** of the list, never wrapping it, so opening a record cannot remount the table.

**On the other CRM tables the drawer is a detail view of a row you can already mostly read. Here it is the point of the page** — the row shows one truncated line, and the drawer is where a note is actually legible.

**Header:** the **client** as the headline (a note has no title of its own), then a Review Cycle pill and a Status pill.

**Six sections**, rendered from field definitions in `lib/notes/record.ts`, not from hand-written JSX:

| Section | Fields |
|---|---|
| **Note** | Review Cycle, Date, Note |
| **Assessment** | Status, Primary Risk Driver |
| **Action** | Action Step, Action Owner, Action Due |
| **Client** | Client (linked) |
| **People** | Owner, Created By, Modified By |
| **System** | Created On, Modified On, Note (flattened source) |

Note and Action Step are full-width and `whitespace-pre-wrap`, which is the entire reason the body is sourced from `_raw` — see below.

### Field-sourcing notes

Five things about this entity are not what the column names suggest. All are measured on the 693 live rows; the full write-up is in the patch header.

> **Updated 2026-09-16 — these are now real columns.** Everything below still describes where the data comes *from* in Dynamics and why, and all of it is still true. What changed is the plumbing: `note_body`, `owner_name`, `created_by_id`/`_name` and `modified_by_id`/`_name` are now **flattened columns on `public.client_notes`**, backfilled from `_raw` and written by `mapClientNote` on every sync. `v_admin_notes_all` reads those columns instead of extracting from `_raw` with `->>` at query time. The page renders identically — same data, sturdier source, and now indexable. See the flatten pass in [03 — Data Model](03-data-model.md#the-flatten-pass-2026-09-16).

#### The note body is better in `_raw` than in its own column

The mirror flattens `bcs_notestext` into `notes_text`, but Dynamics **also** carries `bcs_notes` — the same note with its **line breaks intact**. `notes_text` has them collapsed, so a note reads as a run-on paragraph with arbitrary wraps. The two differ on **435 of 693 rows**:

```
notes_text  "Status: Stable Overall Sentiment: All good; need to execute on
             new intro mtgs\nPrimary Risk Driver: Exectuon/Meeting Volume Key
             Points: - Need higher quality\nmtgs for May"

bcs_notes   "Status: Stable\nOverall Sentiment: All good; need to execute on
             new intro mtgs\nPrimary Risk Driver: Exectuon/Meeting Volume\nKey
             Points:\n- Need higher quality mtgs for May"
```

So `note_body = COALESCE(bcs_notes, notes_text)`. Measured, it comes from `bcs_notes` on **all 650** populated rows — the fallback has never fired, but it costs nothing and covers a row where Dynamics writes one and not the other.

The flattened `notes_text` is exposed as its own field ("Note (flattened source)", under System) so the difference is **visible rather than hidden** — if someone later decides the collapsed copy was right after all, they can see exactly what they would be choosing.

The list cell collapses newlines to `·` separators, because a raw `\n` inside a one-line truncated cell renders as a gap. That collapse is display-only and happens in the browser; the drawer and the Excel export both get the real text.

#### Owner is a real person, but had no name column

Unlike [Touches](15-touches.md#owner-is-a-team-not-a-person) — where owner is a per-account team — here `_ownerid_value@…lookuplogicalname` is **`"systemuser"`** on every row and the owner is genuinely the note's author.

The two owner ids **do not resolve against `public.users`**, so the name cannot be recovered by joining — it only exists in the `_ownerid_value@…FormattedValue` annotation. Until 2026-09-16 `mapClientNote` took only `owner_id`, and the view dug `owner_name`, `created_by_name` and `modified_by_name` out of `_raw` (100% populated, verified). **The mapper now takes all of them** via `lookupName(row, "_ownerid_value")` and friends, so they are ordinary columns and the view no longer touches `_raw`.

Created By is the same two people as Owner on every row; Modified By adds only "CRM Administration".

#### Status and risk driver are trimmed

Both are typed into Dynamics **with a trailing newline about half the time**, so the raw columns hold `"Stable"` and `"Stable\n"` as two different values. Untrimmed, `status_text` has 13 distinct values and `primary_risk_driver` 32 — **and every dropdown would show each choice twice, each returning part of the rows.**

`btrim` collapses them to **8 and 21**. The view trims, the filter-options view trims to match, and the filters compare trimmed-to-trimmed. *Neither side may drop the btrim independently* — that would silently return nothing.

**Not fixed:** `"At Risk."` (2 rows) stays distinct from `"At Risk"` after trimming. That is a real typo in the source, not whitespace, and silently merging it would be the view editing the CRM's data. The **At Risk** built-in view uses `startsWith` instead of `eq` so those two rows are not lost, and the status pill matches on the same prefix so they are coloured correctly.

#### Dates are `date`s, lifted to Eastern midnight

`note_date` and `action_deadline` are plain `date` columns — every other CRM table's dates are `timestamptz`. The shared filter grammar (`resolveDateValue` in `lib/table-views/query.ts`) resolves a date filter to the UTC instant of an **Eastern** midnight: "on or after 2026-09-15" becomes `2026-09-15T04:00:00Z`. Comparing a bare `date` against that casts the date to **UTC** midnight, four hours earlier — so a note dated the 15th would be excluded from "on or after the 15th".

Both columns are therefore converted to `timestamptz` at Eastern midnight in the view, which makes them behave exactly like the dates on the other four tables and round-trip correctly through the Eastern display formatter.

#### Constants, initials, and other things not to trust

- **`state_label` and `status_label` are both `"Active"`** on all 693 rows. Exposed, hidden by default. The status that carries meaning is `status_text`, a free-text Rose field.
- **`action_owner` is staff INITIALS** — "BM", "LW/RB", "BS/AC/RB", 25 distinct codes across the 136 rows that carry one. Shown verbatim and given **no avatar**: running "LW/RB" through an initials renderer would produce nonsense. There is nothing to resolve it against.
- **`name` is the review CYCLE, not a title** — 10 distinct values including two "Test" rows. Exposed as `review_cycle` and offered as a dropdown.
- **`action_deadline` has two 1931 dates** (Oddity Tech Ltd.) — obvious typos in the CRM, left alone.
- **Nothing is sourced from these `_raw` lookups**, all ~0% populated: `_bcs_acctmgr_value`, `_bcs_assoc_value`, `_bcs_log_value`, `_bcs_secmgr_value`, `_createdonbehalfby_value`, `overriddencreatedon`.

### Edit-ready, deliberately not editable

Every field comes from `NOTE_SECTIONS` in `lib/notes/record.ts` as `{ label, sourceKey, type }`, rather than hand-written markup per field. That is what makes turning this into a real editor a **localised** change: swap the read-only renderer for an input keyed off `type`, add form state, add a save action. The sections, labels and ordering do not move.

Do **not** add editing without the dashboard actually becoming the system of record. Today Dynamics is, and everything in this app is read-only.

## Saved views and filters

Identical to the other four, on the shared implementation in `lib/table-views/saved-views.ts` — **one** module enforces the rules for all five entities, so there is no second place for the authorisation to be wrong.

- **System views** — visible to everyone who can reach the page; only a super-user may create, rename or delete one.
- **Personal views** — per-login, visible only to their owner.
- **One default each**, enforced by partial unique indexes in the database (`note_saved_views_one_personal_default`, `..._one_system_default`).
- Resolution order when the page opens: explicit `?view=` → the caller's personal default → the system default → the built-in fallback (**Recent notes**).
- Writes are refused while impersonating; the UI hides the save controls rather than offering a doomed click.

### Quick filters

Five dropdowns — **Client · Status · Risk Driver · Owner · Review Cycle** — that sit *on top* of the active view's own filters and AND with them. They are deliberately **not** part of the view config: a saved view is a shape you return to, these are ad-hoc narrowing you apply and drop. They ride in their own URL params (`?client=`, `?status=`, `?risk=`, `?owner=`, `?cycle=`), so they stay shareable and stay server-side.

Their choices come from `v_admin_notes_filter_options`, where the distinct-ing is done in Postgres: **client 111 · status 7 · risk 20 · owner 2 · cycle 9**. Without the btrim, status alone would offer 12. The options are fetched by the **client after the table renders**: nothing on screen needs a dropdown's contents in order to paint a table.

**Owner is keyed by canonical user id**, as on the other pages, so a person with duplicate systemuser records is not split across two choices. With only two authors this is very nearly a no-op today — but it is the same code path as the other four pages, and the cost of getting it wrong later is silent under-reporting rather than an error.

## Performance

The same shape as the other four CRM tables:

- **The list query selects only the display columns** — the active view's columns plus `alwaysSelect`. **`_raw` is never selected**, by the list or the drawer: the view has already dug out everything that lives in it.
- **The drawer loads on demand.** That matters more here than elsewhere — a note *is* its body, averaging 256 characters and running to 1,465, and the record carries **two** copies of it (the line-broken one and the flattened one). Shipping both for every row would dominate the payload of a list that shows a truncated one-liner.
- **Distinct filter values come from a dedicated view**, not a scan.
- **The unfiltered load is capped** at `ROW_CAP` (2,000) with a "showing first N of M" notice. At 693 live rows the cap does not bite today; it is there for growth. The **Excel export is not capped** — it re-fetches uncapped, *with the quick filters re-applied*, so the file always matches the active view. It additionally forces `client_account_name`, `note_body`, `review_cycle`, `action_owner` and `action_deadline` into the sheet, since the table shows a ticker and a truncated line and the action fields are hidden on the default view.
- **Five new indexes.** `note_date DESC` for the default sort (the pre-existing `idx_client_notes_client` leads with `client_account_id` and cannot serve an unfiltered sort), `owner_id`, and **three expression indexes on `btrim(...)`** for status, risk driver and review cycle — a plain index on the raw column could not serve a filter on the trimmed value.
- **Row height is 30px**, matching Events and Touches. The Note cell is deliberately one truncated line rather than a wrapped excerpt: letting it wrap would make row height unpredictable and break the virtualisation, whose spacers assume a fixed `ROW_H`.

## Shared architecture

Nothing about filtering, validation, paging or authorisation is written again for Notes. The entity supplies a spec and a column catalog; everything else is the shared machinery:

| Piece | Where |
|---|---|
| Entity contract, field types, operators | `lib/table-views/types.ts` |
| Config validation + default resolution | `lib/table-views/config.ts` |
| Query builder, paging, row cap, filter options | `lib/table-views/query.ts` |
| Saved-view read/write + authorisation | `lib/table-views/saved-views.ts` |
| Excel export | `lib/table-views/excel.ts` |
| Column picker / filter builder / dropdowns / switcher | `components/table-views/*` |

## Where things live

| Concern | File |
|---|---|
| Route + server gate + list fetch | `dashboard/app/notes/page.tsx` |
| Server actions (record, export, views, options) | `dashboard/app/notes/actions.ts` |
| The table | `dashboard/app/notes/notes-view.tsx` |
| The detail drawer | `dashboard/app/notes/note-record-pane.tsx` |
| Field definitions (drawer **and** catalog source) | `dashboard/lib/notes/record.ts` |
| Column catalog, built-in views, `NOTES_SPEC` | `dashboard/lib/notes/spec.ts` |
| Quick filters + user alias groups | `dashboard/lib/notes/filters.ts` |
| Row type | `dashboard/lib/types.ts` (`AdminNoteRow`) |
| Route gating + nav item | `dashboard/lib/access-control.ts` |
| Nav icon (`StickyNote`) | `dashboard/components/nav.tsx` |
| SQL | `sql/patches/2026-09-15_admin_notes.sql` |


---

## Create & edit (dashboard records)

**Add New Note** and the drawer's **Edit** button (dashboard-created records only; Dynamics records stay read-only until cutover) use **one form that covers every field the drawer shows**, grouped the same way. That's the "form field set = drawer field set" principle; see [22 — Cutover](22-cutover-ownership-boundary.md). Created / modified by and on are display-only system fields. No field on this drawer is read from `_raw`, so **no columns needed flattening**.

**Editable:** client, date, review cycle, note, status, primary risk driver, action step, action owner, action due, and **owner** (the note's author; defaults to you).

**Display-only:** `notes_text` (Dynamics' collapsed copy of the body, derived on save) and the system fields.
