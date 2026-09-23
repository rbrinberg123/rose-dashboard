# 22 — Cutover: the ownership boundary

## What it is (plain language)

Today almost every row in the CRM tables was copied in from Dynamics. The plan is for the dashboard to start **creating its own records** in those same tables, and eventually to replace Dynamics as the CRM.

Before the dashboard writes a single row, the Dynamics sync has to be unable to damage those rows. The **ownership boundary** (or "fence") does that: each row is labelled with **who owns it**, and the sync machinery only touches rows that came from Dynamics.

> **This fence is the prerequisite for any dashboard write.** It adds no "Add new" button and writes no records itself. It only makes future dashboard writes safe.

Why it's needed: the nightly **deletion sweep** flags any row it can't find in Dynamics as "deleted in Dynamics". A dashboard-created row is *never* in Dynamics, so without the fence every dashboard row would appear on **Admin → Reconciliation** every night, and one "Approve" would permanently delete it.

---

## The two new columns

Added to the 8 tables the dashboard will write to: **accounts, contacts, meetings, tasks, touchpoints, client_notes, events, contracts**.

| Column | Values | Default | Meaning |
|---|---|---|---|
| `origin` | `'dynamics'` \| `'dashboard'` | `'dynamics'` | Who owns the row. Every existing row, and every row the sync inserts, is `'dynamics'`. Dashboard writes must set `'dashboard'` explicitly. |
| `is_test` | `true` \| `false` | `false` | Test data, separate from ownership. Lets test records be marked from the very first dashboard write. Views don't filter on it yet. |

Not on `users` or `new_vacationrequest`. The dashboard doesn't write those, so they have no fence (see `hasOrigin` below).

## What the fence does

1. **The sync never sets `origin`.** The mappers (`lib/sync/mappers.ts`) are unchanged. A sync insert gets the `'dynamics'` default, and a sync update leaves `origin` alone.
2. **Origin is locked.** A `BEFORE UPDATE` trigger (`<table>_lock_origin` → `public.lock_origin()`) forces `NEW.origin := OLD.origin`. No update can change a row's owner, including a sync upsert on a colliding id (which is vanishingly unlikely anyway, since dashboard ids are random `gen_random_uuid()` values).
3. **`_synced_at` skips dashboard rows.** The shared `touch_synced_at()` trigger function now stamps `_synced_at` only when the row is **not** `'dashboard'`. A dashboard row keeps the value it was inserted with, and "last synced" is never claimed for a row Dynamics never sent. Dashboard writes should track their own edit time in `modified_on`. The function reads origin via `to_jsonb(NEW)->>'origin'`, so tables without the column (`new_vacationrequest`) behave exactly as before.
4. **The deletion sweep ignores dashboard rows.** `lib/sync/reconcile.ts` `fetchMirrorPks` reads only `origin = 'dynamics'` keys for entities with `hasOrigin`, so dashboard rows are never flagged.
5. **Approve-delete refuses dashboard rows.** `app/admin/reconciliation/actions.ts` `deleteOne` (used by both single and bulk approve) adds `origin = 'dynamics'` to the delete. If nothing is removed, the candidate is **not** marked deleted. The admin gets "Not deleted: no Dynamics-origin row…", a warning is logged, and the candidate stays pending to be cleared with **Keep**.

### `hasOrigin` vs `skipDeletionSweep`

Both live on `EntityConfig` in `lib/sync/entities.ts`:

- **`skipDeletionSweep`** is **table-level**: the entity is never swept at all (contacts today).
- **`hasOrigin`** is **row-level**: the entity is still swept for its Dynamics rows, and its dashboard rows are excluded. It must be `true` exactly on the tables that have the `origin` column. Setting it on a table without the column makes that entity's sweep error and skip.

---

## Technical

| Piece | Where |
|---|---|
| Columns, lock trigger, `touch_synced_at()` change, check queries | `sql/patches/2026-09-23_origin_ownership_fence.sql` |
| `hasOrigin` flag (8 entities) | `lib/sync/entities.ts` |
| Sweep filter | `lib/sync/reconcile.ts` → `fetchMirrorPks` |
| Delete guard | `app/admin/reconciliation/actions.ts` → `deleteOne` |

**Rollout order.** The SQL must run **before** the code ships, because the code filters on a column that must already exist.

1. Run the SQL patch in Supabase.
2. Run the patch's "Check it" queries. Every table should be 100% `origin='dynamics'`, `is_test=false`, and there should be 8 `_lock_origin` triggers.
3. Deploy the code (sweep filter + delete guard).
4. Run the patch's third check query once: the reconciliation queue has no pending candidate pointing at a dashboard row.

**Gotchas**

- **Re-running old SQL reverts the `_synced_at` change.** `touch_synced_at()` is also defined in `sql/01_mirror_tables.sql` and `sql/patches/2026-09-09_feedback_received_and_synced_at.sql`. Re-running either restores the old body, so re-run Part C of the fence patch afterwards.
- **Trigger order matters.** Postgres fires same-timing triggers in name order, so `_lock_origin` runs before `_touch_synced_at`, and the synced-at check sees the locked origin.
- **Changing a row's owner on purpose** (e.g. "adopting" a Dynamics row at cutover) is blocked by the lock trigger. It needs an explicit, audited migration that disables the trigger for that statement.
- **Dashboard inserts will still need:** a fresh `gen_random_uuid()` pk, `origin='dashboard'`, `_raw` (`'{}'` for contacts, where it is `NOT NULL`), valid `users(user_id)` foreign keys, and a `recordAudit` call ([18 — Audit Trail](18-audit-trail.md)). Many views pull fields out of `_raw`, so dashboard rows will show blanks there until those views read flattened columns.
- **Contacts DELETE works.** The repo DDL grants only INSERT/UPDATE/SELECT, but in the live database service_role can delete contacts: a no-match probe on 2026-09-23 returned 204, via Supabase's default privileges. The test purge relies on this.

---

## Contacts: the first dashboard-authored records

**Contacts is the first entity the dashboard creates itself.** The **Add New Contact** button on CRM → Contacts opens a form, and saving it writes a row straight into `public.contacts`. It shows up in the list immediately, with no wait for a sync. **Every other CRM "Add New" button is still inert** (the "coming soon" stub in `components/crm-add-new.tsx`), and so is **New Contact** in the nav quick-add menu.

### What the form collects
First/last name, job title, **client** (picked from existing accounts), contact type (CEO / CFO / IRO / Other), email, mobile phone, direct phone, city, and a **Test record** toggle.

### What gets written (`createContact` in `app/contacts/actions.ts`)
| Column | Value |
|---|---|
| `contact_id` | a fresh random uuid, never a Dynamics id |
| `origin` | `'dashboard'`, so the sync, the deletion sweep and approve-delete all leave it alone |
| `is_test` | from the toggle |
| `_raw` | `{}` (the column is `NOT NULL`, and there is no Dynamics payload) |
| `full_name` | first + last |
| `parent_customer_id / _name / _type` | the chosen account; the name is re-read from `accounts` on the server, and the type is `'account'` |
| `contact_type_code / _label` | the chosen type |
| `state_code / status_code` | `0` / `1` (Active), so it appears in the default "Active contacts" view |
| `created_on = modified_on` | now |
| `created_by_* / modified_by_*` | the signed-in user |

Constraints on `public.contacts` (checked live 2026-09-23): `contact_id`, `_raw`, `_synced_at`, `origin` and `is_test` are the only NOT NULL columns. The only CHECK is on `origin`. There are **no foreign keys**, so the action itself checks that the chosen client exists.

**Security.** The action requires an effective role of `super_user` and **refuses while in "View as"**. It checks this itself, not just the page. Every create calls `recordAudit` (action `create`, entity `contacts`, actor = the real user).

### The Test record toggle
It starts **on** during the test phase, so every contact created now is `is_test = true` and shows an amber **TEST** badge next to the name in the list and in the record drawer. Test contacts are **not** hidden from the Contacts page, on purpose. Nothing else in the app reads contacts (no emails, Alerts, Portfolio or client summaries), so no firm-wide exclusion is needed.

**Going live for real:** set `NEW_CONTACT_TEST_DEFAULT = false` in `lib/contacts/create.ts`. That's the only change.

### Cleaning up test data
The **Delete test contacts** button (next to Add New Contact) shows how many there are, asks for confirmation, and then deletes `WHERE origin = 'dashboard' AND is_test = true`. It can never match a Dynamics row or a real dashboard contact. Same gate as create (super_user, not impersonating), with one audit `delete` entry per removed row. The manual SQL equivalent is:

```sql
DELETE FROM public.contacts WHERE origin = 'dashboard' AND is_test = true
RETURNING contact_id, full_name;
```

This delete is **not** blocked by the ownership fence. The fence only restricts the reconciliation sweep and its approve-delete.

### Why the fence protects these rows
- **Sync:** it upserts only on Dynamics ids, and a random uuid never matches one. If one ever did, the lock trigger keeps `origin = 'dashboard'`.
- **Deletion sweep:** contacts are excluded from the sweep entirely (`skipDeletionSweep`), **and** the sweep reads only `origin = 'dynamics'` rows (`hasOrigin`). A dashboard contact is never flagged.
- **Approve-delete:** it deletes only `origin = 'dynamics'` rows, so it cannot remove a dashboard contact.
- **`_synced_at`:** set once when the row is created and never updated afterwards, because the trigger skips dashboard rows.

### Files
`app/contacts/new-contact-dialog.tsx` (form + purge button) · `app/contacts/actions.ts` (`createContact`, `countTestContacts`, `purgeTestContacts`, `loadContactClientOptions`) · `lib/contacts/create.ts` (test default, contact-type options) · `sql/patches/2026-09-23b_contacts_dashboard_writes.sql` (adds `origin` and `is_test` to `v_admin_contacts_all` for the list badge).

---

## Notes: the second live entity, and the first one the sweep covers

**Add New Note** on CRM → Notes is live, built on the same plumbing as Add New Contact. Notes matters more than Contacts as a test: **`client_notes` is swept nightly** (no `skipDeletionSweep`), so a dashboard note is the first real test of the ownership fence under reconciliation. Contacts are never swept, so they couldn't test it.

### Shared write plumbing
Both entities now go through one set of helpers, so the rules can't drift:

| Piece | Where |
|---|---|
| Write gate (super_user **and** not in "View as"), client re-read, `origin='dashboard'` + `_raw={}` stamp, audited purge | `lib/crm-write.ts` |
| TEST badge | `components/test-badge.tsx` |
| "Delete test {records}" button | `components/purge-test-button.tsx` |
| Live "Add New" hook | `AddNewButton`'s `onClick` prop (`components/crm-add-new.tsx`) |

Every other CRM "Add New" button (meetings, events, tasks, touches, clients), plus the whole nav quick-add menu, is still the inert "coming soon" stub.

### What the form collects and writes (`createNote` in `app/notes/actions.ts`)
- **Client** (required), **note date** (defaults to today, Eastern), **review cycle** (`name`, e.g. "Client Review September 2026"; it follows the date unless you edit it), and the **note** itself.
- **Status**: Stable / At Risk / New Client / Lost / Strong, or blank, which means "no change" (the Portfolio flag carries the last non-blank status forward).
- **Primary risk driver**: free text, with the common values suggested.
- **Action step**, **owner** (initials) and **deadline**.
- **Test record** toggle, on by default (`NEW_NOTE_TEST_DEFAULT` in `lib/notes/create.ts`).

Written: a fresh random `note_id`, `origin='dashboard'`, `is_test`, `_raw={}`, `note_body` (line breaks kept) plus `notes_text` (Dynamics' collapsed copy), client id and name re-read on the server, owner / created_by / modified_by set to the signed-in user, state Active, and `created_on = modified_on = now`. Each create gets one `recordAudit` entry.

Constraints (checked live 2026-09-23): `note_id` is the only required column with no default. `_raw` is optional here, but set to `{}` anyway. The one enforced foreign key is `client_account_id` → `accounts`. The repo DDL also says `owner_id` → `users`, which isn't enforced live; the value is the caller's own `users.user_id`, so it would pass either way.

### Test data flows through everywhere, on purpose
There are **no surface-level exclusions.** A note written here, test or not, reaches the Notes page, the **Portfolio health flag**, **Client Detail's latest note**, the **AI client summary** and the **Live Outreach email**, exactly like a Dynamics note. `is_test` only marks a row for cleanup and shows the badge; nothing filters on it. Test data stays contained because **all testing uses the "ZZ - Test Client" (ticker ZVZZT)**, a real Dynamics client (`origin='dynamics'`) that dashboard test notes attach to.

The list's TEST badge needs `sql/patches/2026-09-23c_notes_dashboard_writes.sql`, which adds `origin` and `is_test` to `v_admin_notes_all` and filters nothing. The drawer badge reads the table directly.

### Cleaning up
**Delete test notes** (next to Add New Note) runs `DELETE FROM client_notes WHERE origin = 'dashboard' AND is_test = true`. It's gated, and each removed row is audited. The manual SQL equivalent is at the bottom of the 23c patch.

### Why the sweep can't flag a dashboard note
The sweep reads mirror keys **only for `origin = 'dynamics'`** rows (`fetchMirrorPks`, gated by `hasOrigin`), so a dashboard note never reaches the `missing` list and never lands in `deletion_candidates`. If one somehow did, **approve-delete** only deletes `origin = 'dynamics'` rows, so it would remove nothing and leave the candidate pending for **Keep**.

---

## Touches: the third live entity, and the second one the sweep covers

**Add New Touch** on CRM → Touches (`/touchpoints`) is live, using the same shared plumbing (`lib/crm-write.ts`, `components/test-badge.tsx`, `components/purge-test-button.tsx`). `touchpoints` is **swept nightly**, so the origin fence applies here exactly as it does for Notes: the sweep reads only `origin = 'dynamics'` keys, and approve-delete only deletes `origin = 'dynamics'` rows. A dashboard touch can never be flagged or removed by reconciliation.

**Live now:** Contacts, Notes and Touches. **Still inert:** Meetings, Events, Tasks, Clients, and the whole nav quick-add menu.

### What the form collects and writes (`createTouch` in `app/touchpoints/actions.ts`)
- **Client** (required), **subject** (required), **touch type** (Virtual / In-Person / Email / Social / Onboarding Call / Teach-in; defaults to Virtual), **direction** (Outgoing by default, as on every live touch), **date & time** (Eastern, defaults to now), **duration** (defaults to 30 min, the Dynamics default), **contact type** (any of CEO / CFO / IRO / Other), **description**, and the **Test record** toggle (on by default; `NEW_TOUCH_TEST_DEFAULT` in `lib/touchpoints/create.ts`).
- Written: a fresh random `touchpoint_id`, `origin='dashboard'`, `is_test`, `_raw={}`, and the type code + label.
- **Contact type** is multi-select in Dynamics, so it's stored the same way the sync stores it: codes comma-joined (`"755860001,755860002"`), labels semicolon-joined (`"CFO; IRO"`).
- **Client and links:** client id and name are re-read on the server, and `regarding_id` is set to the client, as on 97% of Dynamics touches.
- **Dates:** `scheduled_start` is converted from Eastern to UTC, correctly across daylight-saving changes, and `scheduled_end = start + duration`.
- **State and people:** state is Open (as on 96% of live rows), created_by / modified_by are the signed-in user, and `created_on = modified_on = now`. Each create gets one audit entry.
- **Owner is left empty on purpose.** On touches the Dynamics owner is a per-client **team** named after the account, never a person, and there's no team to point at.

Constraints (checked live 2026-09-23): `touchpoint_id` is the only required column with no default, and `client_account_id` → `accounts` is the only enforced foreign key. The repo DDL's `owner_id` / `created_by_id` → `users` links aren't enforced live. Type and contact-type codes are **text** columns live, though the repo DDL says `int`.

### Test data flows through everywhere
There are no exclusions. A dashboard touch, test or not, shows on the Touches page, in **Client Detail's recent touchpoints** and in the **AI client summary**, just like a Dynamics touch. `is_test` is a cleanup marker and badge only. **Containment is by using the "ZZ - Test Client" (ZVZZT).**

The list's TEST badge needs `sql/patches/2026-09-23d_touchpoints_dashboard_writes.sql` (adds `origin` and `is_test` to `v_admin_touchpoints_all`, filters nothing). **Delete test touches** runs `DELETE FROM touchpoints WHERE origin = 'dashboard' AND is_test = true`, gated and audited per row. The manual SQL equivalent is at the bottom of the 23d patch.

---

## Tasks, Meetings and Events: live, and all swept

**Add New Task**, **Add New Meeting** and **Add New Event** are live, on the same shared plumbing as Contacts, Notes and Touches: `lib/crm-write.ts` (write gate, re-reads, ownership stamp, audited purge), the TEST badge, and the "Delete test {records}" button. All three tables are **swept nightly**, so the origin fence applies: the sweep reads only `origin = 'dynamics'` keys, and approve-delete only removes `origin = 'dynamics'` rows.

**Live now:** Contacts, Notes, Touches, Tasks, Meetings, Events. **Still inert:** **Add New Client**, which will be done last, plus the whole nav quick-add menu.

**Proven live, 2026-09-23:** a test note was created on ZVZZT at 15:28 UTC. The live sweep at 15:30 UTC checked 668 notes (every note except that one) and flagged none. That confirms the fence under a real reconciliation run, not just a replay.

### What each form writes

| | Task (`createTask`) | Meeting (`createMeeting`) | Event (`createEvent`) |
|---|---|---|---|
| Required on the form | client, subject, type + sub-type, status | client, type (Live/Virtual), status, date & time | client, name, stage, marketing state |
| Also on the form | Rose priority (High/Medium), due date, **regarding** (the client or one of its events), owner (defaults to you), description | event (one of the client's own), institution, investor, host, booker, general notes | dates (free text), location, meetings start/end, slots, notes |
| Shape | `bcs_account` = client; `regarding` = client (`account`) or event (`bcs_event`); due date = `scheduled_end`; stock priority "Normal" (as on every live task) | `is_in_person` = type is Live; owner = booker (or you); state Active | name suggested as Dynamics does ("TICKER - Place - dates"); `client_ticker` copied from the account; state Active |

Every row: a fresh random id, `origin='dashboard'`, `is_test` from the toggle (on by default via `NEW_TASK/MEETING/EVENT_TEST_DEFAULT`), `created_by` / `modified_by` = you, `created_on = modified_on = now`, and one audit `create` entry (Dashboard + TEST badge in the Audit Log).

### Constraints and links (checked live 2026-09-23)
- **Tasks:** only `task_id` is required, and there are **no foreign keys**. Client, event and owner are re-read and validated in the action; the event must belong to the client.
- **Meetings:** `meeting_id` is required, and `is_in_person` is set from the type. Enforced foreign keys: **client → accounts** and **feedback → users** (feedback is left empty). Host and booker are users (not enforced live, but re-read). **Institutions are not a synced table.** They're Dynamics accounts outside the mirror, so the institution must be one already seen on a meeting (searched from `meetings`). The event must belong to the client.
- **Events:** only `event_id` is required, and there are **no foreign keys**. `of_slots` is the capacity; `slots_remaining` is computed by the view from confirmed meetings.

### `_raw` on dashboard meetings
Several views still read a **meeting's event name out of `_raw`** instead of a column: `v_planning_events` (Scheduler, Planning, the Week Ahead email) and `v_profiles_upcoming`. So a dashboard meeting linked to an event gets exactly that key, `_raw = {"_bcs_event_value": id, "_bcs_event_value@OData.Community.Display.V1.FormattedValue": name}`, so it shows its event there like a synced meeting. Otherwise `_raw` stays `{}`.
- Other meeting fields those views take from `_raw` (second host, on-behalf-of, city/state names, feedback-received) aren't on the form, so they're blank for dashboard meetings, as they are for many synced ones.
- Events' only `_raw` read is Live Outreach's `bcs_mining`; missing counts as "not mining", which is correct.
- Tasks have none.

### List badges without a view patch
The Tasks, Meetings and Events list views are large and much-patched, so they were **not** rewritten to carry `is_test`. Each page instead reads the small set of test ids straight from the table (`testRowIds`) and marks those rows (`markTestRows`). **No SQL patch is needed for these three.** The drawer badges read `is_test` from the table too.

### Test data flows through everywhere
There are no exclusions. A test meeting on ZVZZT counts on Portfolio (meetings, Intro/F-U), shows on Client Detail, Scheduler and Planning, and reaches the Week Ahead and Outstanding Feedback emails. A test event in the **"Live Outreach"** stage reaches the Live Outreach page **and its daily email** (the form warns when that stage is picked). Containment is by using the **ZZ - Test Client (ZVZZT)**, which already has six Dynamics events a test meeting or task can link to.

---

## Editing: dashboard records only

**A CRM record is editable in its detail drawer only if the dashboard created it (`origin = 'dashboard'`).** Records synced from Dynamics stay **read-only until cutover**, because Dynamics is still their system of record and the next sync would overwrite any local change. This applies to Contacts, Notes, Touches, Tasks, Meetings and Events. Clients come later.

### What you see
- **A dashboard record** (e.g. a ZVZZT test note) shows an **Edit** button in the drawer header. It opens that entity's **Add New form in edit mode**: same fields, pre-filled, with **Save changes / Cancel**. The Test toggle isn't shown, because `is_test` can't be edited. After a save, the list refreshes and the drawer reopens showing the new values.
- **A Dynamics record** shows no Edit button, just a quiet **"Synced from Dynamics — read-only until cutover"** note.

### The rule is enforced on the server, not by the button
The app reads and writes with the service-role key, which **bypasses RLS**, so the server action is the only gate. Every entity's `update<Entity>` goes through one shared function, `updateDashboardRow` in `lib/crm-write.ts`:
1. **Gate:** effective role `super_user`, and not in "View as".
2. **Same validation as create:** the input goes through the entity's own builder (`build<Entity>Columns`), the same one `create<Entity>` uses. An edit can't write anything a create couldn't: clients, events, owners, hosts and bookers are re-read, and dates and option codes are validated.
3. **Protected columns:** the patch may never contain the primary key, `origin`, `is_test`, `_raw`, `_synced_at`, `created_on` or `created_by_*`.
4. **Re-read:** the row is re-read. Missing → refused. `origin <> 'dashboard'` → refused with *"This record is synced from Dynamics and is read-only until cutover."*
5. **Guarded write:** the UPDATE filters on **the pk AND `origin = 'dashboard'`** and must report **exactly one** row changed; otherwise it's refused, never silently ignored. A crafted request to edit a Dynamics record fails at both step 4 and step 5.
6. **What changes:** only the edited display columns, plus `modified_on = now()` and `modified_by_*` = you. Saving with no changes writes nothing.
7. **Audit:** one `update` entry with the **before → after diff** of the changed fields; the actor is the real signed-in user. Its context says "dashboard row" (plus "test" for test data), so the Audit Log shows the **Dashboard** (and **TEST**) badge on edits too.

The edit form's loader (`load<Entity>ForEdit` → `loadDashboardRowForEdit`) also refuses Dynamics rows, so one can't even be loaded into an editor.

### What an edit never touches
- **`origin` can't change.** The update never sends it, and the origin-lock trigger would reset it anyway.
- **`is_test` can't change.** It's never in the patch.
- **`_synced_at` is untouched** for dashboard rows: the fenced `touch_synced_at()` skips them.
- **One internal exception:** a meeting's `_raw` event-name keys are rewritten server-side when its event changes, so Scheduler, Planning and the Week Ahead email follow the new event. `_raw` is never shown on or edited from the form.

Verified 2026-09-23, directly against the database:
- The exact guarded UPDATE aimed at a real Dynamics note changed **0 rows** and left it unchanged.
- An attempt to set a test note's `origin` to `'dynamics'` left it `'dashboard'`, with `is_test` and `_synced_at` unchanged.

### Where it lives
| Piece | Where |
|---|---|
| Guarded update, edit loader, date helpers | `lib/crm-write.ts` (`updateDashboardRow`, `loadDashboardRowForEdit`) |
| Per-entity builder / load-for-edit / update | `app/<entity>/actions.ts` (`build*Columns`, `load*ForEdit`, `update*`) |
| Create-or-edit form + `Edit*Dialog` | `app/<entity>/new-*-dialog.tsx` |
| Edit button / read-only note | `components/record-edit-bar.tsx`, in each `*-record-pane.tsx` |
| Audit origin badge for edits | `originOf(changes, context)` in `lib/audit-log/labels.ts` |


---

## Form field set = drawer field set

For **Contacts, Notes, Touches, Tasks and Events**, the Add New form and the drawer's Edit form now expose **every field the drawer shows**, grouped like the drawer. Nothing appears read-only in the drawer that can't also be created or edited, apart from system fields (created/modified by and on) and fields Dynamics derives. **Meetings** is handled separately; **Clients** is still pending.

- **No columns were flattened.** None of these five drawers reads a field from `_raw` (checked against each `v_admin_<entity>_all` view), so this pass added form fields only. There is no SQL and no view change.
- **Everything goes through the same plumbing:** each entity's `build<Entity>Columns` validates every field (option codes, dates, and people re-read from `users`), and edits still go through the origin-guarded `updateDashboardRow`.
- **Display-only by design:**
  - Contact Last Activity (Dynamics-maintained).
  - Contact Lead State (no values exist).
  - Note `notes_text` (derived from the body).
  - Touch Scheduled End (start + duration).
  - Touch Owner Team (derived from the client's Dynamics team).
  - Task State and Regarding Type (derived).
- **Partial option lists:** Contact Industry and Event Lead(s) offer only the codes Dynamics returns labels for. Existing unlabelled values are preserved on edit.
- Per-entity detail is in docs 13 (Events), 14 (Tasks), 15 (Touches), 16 (Notes) and 19 (Contacts).


### Meetings: full drawer field set (2026-09-23)
Meetings now follows the same "form field set = drawer field set" rule. **Five columns were flattened** from `_raw` in `sql/patches/2026-09-23e_meetings_flatten_full_fields.sql`: `city_name`, `state_region_name`, `on_behalf_of_id/_name`, `host2_id/_name` and `fb_received_date`. `v_admin_meetings_all` was rewritten faithfully to read them, and `mapMeeting` writes them.
- **Run the patch before deploying the code**, or the meetings sync breaks.
- **On Behalf Of, Second Host and FB Rec'd had no data in Dynamics** (their keys are absent from every payload), so they exist now for dashboard meetings to own.
- **Drawer fix:** Created By / Modified By read the provenance columns, and are no longer blank on dashboard meetings.
- **`_raw` compatibility keys:** a dashboard meeting's `_raw` now also carries the **feedback assignee**, so Outstanding Feedback sees it.

Details are in [12 — Meetings](12-meetings-all.md). **Clients** is the one entity still pending.

### Two downstream drivers now settable (2026-09-23)
- **Tasks → Feedback Received Date** (`crdfa_feedback_received_date`): already a real column, now on the task drawer and form. It decides the feedback pipeline's Open bucket. The old "Feedback Received" checkbox is relabelled **legacy, info only**. No SQL.
- **Events → Mining** (`bcs_mining`): **flattened** into `events.mining` (patch 23f), settable on the event form. `v_live_outreach` reads the column, falling back to `_raw`, to exclude mining events from Live Outreach. **Run the patch before the code deploys.**

Still a separate decision, not done: Portfolio's **Last Note** date comes from Dynamics' stored `accounts.last_touchpoint_date`, so dashboard-created touches and notes don't move it.

## Clients: the seventh and last live entity (2026-09-23)
**Add New Client** and edit are live, so **every CRM entity is now dashboard-authorable** (only the nav quick-add menu is still a stub). It's the same plumbing: the origin guard on edit, audit, the TEST badge, and purge.
- **Columns:** patch **23g** flattens the intrinsic client-record fields and fixes the address to show the **primary (`address1`) block**, falling back to `address2`. It rewrites `v_admin_accounts_all`, and `v_live_outreach`'s `div_yield`.
- **Behaviour driver surfaced:** **Active/Inactive** (`state_label`) gates Portfolio and the client stats views.
- **Deferred:** the **account team** assignment is not set by the form. It's a separate source-of-truth decision, and until it's made, dashboard clients are invisible to client-scoped users.

Full detail is in [20 — Clients](20-clients.md).

### The nav's quick-add "+" menu opens the live forms (2026-09-23)
Each item in the CRM **"+" quick-add menu** (New Client, Meeting, Event, Task, Touch, Note, Contact) now opens that entity's **live create form**. That's the same form, server action and gates as the page's **Add New** button. The "coming soon" toast is no longer used anywhere.
- **How:** the item goes to the entity's page with `?new=1` (`addNewHref` in `components/crm-add-new.tsx`). The page's `New<Entity>Button` sees it (`useQuickAddRequest`) and opens its form. Closing the form removes the parameter. It also works when you're already on that page.
- **New Client is live too**, because the Clients create form has shipped. It needs `sql/patches/2026-09-23g_accounts_full_fields.sql` run first.
- **Gating is unchanged:** the menu only renders for users who can see the CRM nav, the pages redirect non-super-users, and every create action re-checks `super_user` on the server.
