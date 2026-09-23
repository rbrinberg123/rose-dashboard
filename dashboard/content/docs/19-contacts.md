# 19 — Contacts (CRM)

## What it does (plain language)

**Contacts** is the sixth CRM table, at `/contacts` in the CRM block at the bottom of the nav rail. It lists **the people at client companies** — the mirror of the Dynamics `contact` entity — with their job title, contact type, industry, the Yes/No flags the team keeps on them, and when they were last active.

It works exactly like Meetings, Events, Tasks, Touches and Notes: pick a saved view, narrow it with the dropdowns, add or remove columns, sort, search, export to Excel, and click any row to slide out the full record.

**It is read-only.** Nothing on this page creates, edits or deletes a contact — Dynamics is the system of record. The "Add New Contact" button is a placeholder, same as the other five.

**It is super-user only.** The page returns every contact at every client with no row scoping, and it is the only CRM table that is mostly *personal* data about people outside the firm — names, job titles, current and previous employers, and a do-not-call flag.

> **The table may be empty.** `public.contacts` is filled by the nightly sync, not by this page. Until the contacts sync has run, the page renders an empty state saying so. That is the expected first state, not a fault.

## Technical

### Files

| File | Role |
|------|------|
| `sql/23_contacts_table.sql` | The `public.contacts` mirror table (**run this first**). |
| `sql/patches/2026-09-16_admin_contacts.sql` | The two views, the extra indexes, and `contact_saved_views`. |
| `dashboard/app/contacts/page.tsx` | The gated loader. |
| `dashboard/app/contacts/contacts-view.tsx` | The virtualised table. |
| `dashboard/app/contacts/contact-record-pane.tsx` | The slide-in record drawer. |
| `dashboard/app/contacts/actions.ts` | Server actions — record fetch, export, saved views, filter options. |
| `dashboard/lib/contacts/record.ts` | Drawer field definitions + `ContactRecord`. |
| `dashboard/lib/contacts/spec.ts` | Column catalog, built-in views, `CONTACTS_SPEC`. |
| `dashboard/lib/contacts/filters.ts` | The ten quick filters. |

Everything else is shared: `lib/table-views/` (query, config, saved views, Excel) and `components/table-views/` (view switcher, column editor, filter editor, quick-filter bar). Nothing about filtering, paging, saved views or authorisation is written again for this page — see [05 — Sync & Integrations](05-sync-and-integrations.md) and the header of `lib/table-views/types.ts`.

### The views

**`v_admin_contacts_all`** — one row per contact, LEFT JOINed to `accounts` for the client link and ticker. Unscoped by design. It exposes display columns only and **never `_raw`**.

**`v_admin_contacts_filter_options`** — the usual `(kind, value, label, count)` shape, read straight off `public.contacts` so the dropdowns never scan the joined view. Ten kinds: `client`, `contact_type`, `industry`, `internal_assignment`, `lead_state`, `state`, and the four flags `ir_only` / `poc` / `do_not_call` / `distribution_list`.

The flag and state kinds come back as **text** — `"true"`/`"false"` and `"0"`/`"1"` — because the options view is one `UNION` and every branch must share a column type. `lib/contacts/filters.ts` converts them back to real booleans and integers before querying. Passing the string through would make PostgREST compare `boolean = 'true'`, which either errors or silently matches nothing.

### ⚠️ The client link is PROVISIONAL

A contact carries **two** candidate pointers at a client account, and which one is canonical **has not been decided**:

| Column(s) | Dynamics field | Dynamics label |
|---|---|---|
| `parent_customer_id` / `_name` / `_type` | `_parentcustomerid_value` | Company Name |
| `company_master_record_id` / `_name` | `_bcs_companymasterrecord_value` | Master Company Record |

**The page currently resolves the client through `parent_customer_id`**, and that choice is isolated inside a single `LEFT JOIN LATERAL` in the patch, marked with a banner comment. Switching to the Master Company Record is **one line**:

```sql
-- in sql/patches/2026-09-16_admin_contacts.sql
SELECT c.company_master_record_id AS account_key
```

Nothing else in the view changes, and nothing in the app changes at all: every downstream column reads `a.*`, and the app only ever sees `client_account_id` / `client_account_name` / `client_ticker` — the same three names every other admin view uses, which is what lets the shared ticker renderer work unchanged.

**`parentcustomerid` is polymorphic.** In Dynamics it points at *either* an account *or* a contact, so the join is guarded on `parent_customer_type = 'account'`. Without that guard, a contact whose parent is another contact could collide with an account id and surface the wrong client. When the parent is not a matched account the Client cell shows the parent's **name as plain text with no link** — that is correct, not a broken link.

**To decide which is canonical**, run the comparison query at the bottom of the patch once the sync has populated the table. Read it carefully: `public.accounts` holds only Rose's ~228 **client** accounts, so a contact at a non-client company fails to match by design and a low absolute match rate is expected. Both candidates are exposed as columns (`Parent Type` and `Master Company Record` are in the column picker under **Client**) precisely so they can be put on screen side by side while deciding.

### Contact info is now flattened (2026-09-16)

The first build of this table had **no email, phone or address columns at all** — the curated field set was classification-and-flags, so the CRM's contact directory held no way to actually contact anyone. A `_raw` audit found the data had been sitting there the whole time.

| Column | Dynamics field | Populated |
|---|---|---|
| `email` | `emailaddress1` | **~77%** |
| `mobile_phone` | `mobilephone` | ~17% |
| `direct_phone` | `telephone1` | ~12% |
| `city` | `address1_city` | ~34% |
| `street` | `address1_line1` | ~20% |

Note `address1_*` — on **contact** that is the primary address block, the opposite of **account**, where `address2_*` is the one that is maintained.

Also flattened: `owner_id`/`owner_name`, `created_by_id`/`_name`, `modified_by_id`/`_name`.

**Surfaced on the page:**
- **Email** and **City** are visible columns by default, under a **Contact Info** band. Mobile, Direct Line and Street are in the column picker.
- **City** is a searchable filter dropdown (free text from the CRM, so the list is long).
- The drawer has a **Contact Info** section (Email · Mobile · Direct Line · City · Street), and **Owner / Created By / Modified By** now sit in its System section.
- `email` and `city` are indexed (`idx_contacts_email`, `idx_contacts_city`).

> **Why Email is not immediately after Job Title.** Header bands must be runs of *adjacent* columns. Putting Email between Job Title and Contact Type would split Profile into two bands with the same label, which reads like a rendering bug — so Email and City sit immediately after the Profile block instead. To change that, move the two keys up in `CONTACT_DEFAULT_COLUMNS` and accept the repeated band label.

No re-sync was needed: `_raw` already held every value, so this was `ALTER TABLE` + a one-time backfill + a `mapContact` change. See [03 — Data Model](03-data-model.md#the-flatten-pass-2026-09-16).

### Flattened columns vs `_raw`

The mirror deliberately leaves some fields unflattened — the activity-pointer lookups (last appointment / email / phone / task activity), primary opportunity, segment id, the country lookup and `parent_contactid`. See `sql/23_contacts_table.sql` for the full split.

- **The list never selects `_raw`.** It is not on `v_admin_contacts_all` at all.
- **The drawer does**, in its own single-row query, straight off `public.contacts`. Nothing renders it today; it is fetched so that promoting one of those unflattened fields to a real field later needs no second fetch. A failure on that read is non-fatal — every rendered field came from the view query, so the drawer opens fine without it.

That asymmetry is the point: one row behind a super-user gate is fine; thousands of rows of unfiltered personal data crossing the wire for nothing is not.

### ⚠️ Two choice fields are MULTI-SELECT (this broke the sync — fixed 2026-09-16)

`contact_type`, `industry`, `internal_assignment`, `lead_state`, `state_for_address` and `last_activity_type` were modeled as standard single-select **option sets** (`_code` integer + `_label` text) without being able to read the entity metadata first — there were no Dynamics credentials on the machine where the mirror was written.

**Two of them are multi-select, and it failed 150 contacts outright:**

```
invalid input syntax for type integer: "755860001,755860005"
```

`run.ts` upserts each mapped row as a unit, so one rejected column loses the **entire** contact — name, email, client link and all. Those rows were simply absent from the mirror, not partially populated.

Dynamics returns a multi-select as **comma-joined codes** whose FormattedValue is **semicolon-joined labels**:

```
"755860001,755860004"  ->  "Robert Brinberg; Brian Smith"
```

| Field | Column | Type | Verdict |
|---|---|---|---|
| `bcs_internalassignment` | `internal_assignment_code` | **text** | **multi-select** — 38 of 131 populated `accounts` rows are comma-joined |
| `bcs_contacttype` | `contact_type_code` | **text** | **multi-select** — 60 of 561 populated `touchpoints` rows are comma-joined |
| `bcs_industrychoice` | `industry_code` | integer | single-select |
| `bcs_state` | `lead_state_code` | integer | single-select (unpopulated) |
| `bcs_stateforaddress` | `state_for_address_code` | integer | single-select |
| `bcs_lastactivitytype` | `last_activity_type_code` | integer | single-select |

The evidence could not come from `public.contacts` — the failing rows were precisely the ones missing from it. It came from the **same Dynamics fields on tables that sync cleanly**.

The fix follows an existing precedent: `touchpoints.contact_type_code` is already `text` live for exactly this reason. The `_code` column is widened (keeping the singular name), and `mapContact` uses `str()` so the comma-joined string passes through intact. `num()` would not have helped — it is a pass-through cast, not a conversion, so the string reached the integer column unchanged.

**Nothing downstream changed:** neither `_code` column is selected by `v_admin_contacts_all` or `v_admin_contacts_filter_options` (both read the `_label` columns, still text), and neither appears anywhere in the app.

> **Test any new choice field before modeling it as `integer`:**
> ```sql
> SELECT count(*) FROM public.contacts WHERE _raw ->> '<bcs_field>' LIKE '%,%';
> ```
> And note `accounts.bcs_internalassignment` is the **same multi-select field**, still unflattened — it must be `text` when the deferred accounts pass picks it up, or accounts will fail the same way. See [03 — Data Model](03-data-model.md#multi-select-option-sets).

### Saved views

`contact_saved_views`, identical in shape and rules to the other five. The app code is shared (`lib/table-views/saved-views.ts` enforces all six), so only the storage is duplicated.

**There is no seed row.** The default view, **"Active contacts"**, is a **built-in defined in code** at `lib/contacts/spec.ts` — like every other entity's presets. Built-ins always exist, cannot be edited or deleted, and need no seeding step that a fresh database could miss. The table holds only views people create themselves.

Two built-ins ship:

| View | Filter | Sort |
|---|---|---|
| **Active contacts** (default) | `is_active` is Yes | Last Activity, newest first |
| All contacts | none | Last Activity, newest first |

`is_active` is **computed in the view** as `state_code = 0` and re-evaluated on every query rather than frozen into a saved filter, so a contact deactivated in Dynamics leaves the default view on the next sync with no edit here. "All contacts" exists because without it there is no way to reach an inactive contact except by hand-editing the filter.

### Columns

**Default eleven:** Contact (name + initials avatar) · Client (ticker link) · Job Title · Contact Type · Industry · IR Only · PoC · Do Not Call · Lead State · Last Activity · Active.

Everything else is available-but-hidden in the column picker: First/Last Name, Parent Type, Master Company Record, Internal Assignment, State (Address), Distro, Ex-Employee, Last Activity Subject, Activity Type, Verified, Previous Company, Ticker, Is Active, the Dynamics status columns and Created/Modified.

The header **bands** are runs of adjacent columns, so the default column order is what decides where the rules fall: Contact | Client | Profile | Flags & State | Activity | Status. Lead State is grouped with the flags deliberately — in the default order it sits immediately after Do Not Call, and a band must be contiguous.

### Dates

`verified_on` is a plain `date` in the mirror and is **lifted to Eastern midnight by the view**, for the same reason `notes.note_date` is (see the trap 5 note in `sql/patches/2026-09-15_admin_notes.sql`): the shared filter grammar resolves every date filter to the UTC instant of an Eastern midnight, and comparing a bare `date` against that is four hours off, which would exclude the very day someone filtered for.

### Security

Three independent gates, and the data fetch happens after all of them:

1. `proxy.ts` runs `canAccessRoute` before the page renders; `/contacts` is in **`ADMIN_ONLY_ROUTES`** — super-user-only and **not** grantable through the Admin → Roles matrix.
2. `app/contacts/page.tsx` re-checks the **effective** role and redirects to `/no-access`, so the page is safe even if reached by a path that skips the proxy.
3. **Every server action in `actions.ts` re-checks independently.** A server action is its own entry point and can be invoked directly — the page gate does not protect it.

The role checked is the **effective** one, so a super-user using "View as" previews the denial exactly as the impersonated person would.

Neither `?view=` nor `?cfg=` is a security boundary: `listSavedViews` returns only views the caller may see, and a config can at most widen the result back to what "All contacts" already returns to the same super-user caller.

### No alias expansion

The five sibling pages expand an Owner filter across `public.canonical_user_id`, because two people in this CRM carry duplicate `systemuser` records. **Contacts has no person-valued filter at all** — the contact *is* the row, and none of the ten dropdowns is a systemuser — so there is no alias load and no expansion step. If an Owner filter is ever added here, copy `lib/notes/filters.ts` rather than filtering on the raw id.

### Backfill

The contacts **sync** is what fills the table; see [05 — Sync & Integrations](05-sync-and-integrations.md#entity-contacts-sync-only-added-2026-09-16) for the entity registration, the deletion-sweep opt-out, and the backfill SQL. In short: with no `sync_runs` row for `contacts`, the first run is automatically a full pull; to re-force one later,

```sql
update public.sync_runs set last_synced_at = null where entity_name = 'contacts';
```

### Deploy order

1. `sql/23_contacts_table.sql` — the mirror table.
2. `sql/patches/2026-09-16_admin_contacts.sql` — the views and saved-views table.
3. Ship the code.
4. Let the sync run, then check `/admin` for `sync_errors` on the `contacts` entity.
5. Run the client-link comparison query at the bottom of the patch and decide whether to switch the `LATERAL`.


---

## Create & edit (dashboard records)

**Add New Contact** and the drawer's **Edit** button (dashboard-created records only; Dynamics records stay read-only until cutover) use **one form that covers every field the drawer shows**, grouped the same way. That's the "form field set = drawer field set" principle; see [22 — Cutover](22-cutover-ownership-boundary.md). Created / modified by and on are display-only system fields. No field on this drawer is read from `_raw`, so **no columns needed flattening**.

**Editable:** name, job title, client, contact type, email, mobile, direct line, city, **street**, **industry**, **Active/Inactive**, the five **flags** (IR Only, PoC, Do Not Call, Distribution List, Ex-Employee), **verified on**, **previous company**, **ticker symbol**, **owner**.

**Display-only:**
- **Last Activity** subject, type and time: Dynamics maintains these from the contact's activities.
- **Lead State:** empty on every contact, so there's no known option list.

**Industry** offers only the codes Dynamics returns a label for. An existing unlabelled code is kept as-is on edit.
