# 24 — Contract Management (Admin)

> **Status: built, local only.** Needs `sql/patches/2026-09-29_contracts_crm.sql` run in Supabase before the page loads. Then run `node scripts/verify-contracts.mjs` from `dashboard/`. **Super-user only.** No real contracts have been entered yet. Testing uses the **ZZ - Test Client (ZVZZT)** with **Test record** ticked.
>
> **Moved 2026-09-30:** first built as a CRM tab at `/contracts`. It now lives in the **Admin** section at **`/admin/contracts`**, reached from the **Contract Management** card on the Admin hub (`/admin`, the gear in the rail). It's no longer in the CRM nav or the CRM "+" menu. Only its location and navigation changed; the data, fence, form and actions are the same.

## What it does (plain language)

**Admin → Contract Management** (route **`/admin/contracts`**) lists every client contract in one table:

- the **Dynamics contracts** synced from `bcs_contract` (~392). These are read-only until cutover; and
- **contracts created in the dashboard**. These can be edited and deleted.

One client can have many contracts. Usually they run one after another as renewals, and they don't overlap.

It works like the CRM tables. You get saved views, column and filter editors, quick filters (Client / Scope / Status / Currency / Auto-Renew), an **Export to Excel** button, and a slide-in drawer for each record. **Add New Contract** on the page opens the form. It isn't in the CRM "+" menu.

Not to be confused with **Contracts → Contract Management** (`/contract-management`), the reporting page that shows one row per active client with its expiry. That page still reads only Dynamics contracts and is unchanged.

### How to use it
1. **Add New Contract.** Fill in the contract name and pick the client (a searchable list). Everything else is optional.
2. **Term End** and **Notice Date** fill themselves in as you type the start date, term length and notice days. You can't edit them, because the database calculates and stores them.
3. **Renewal Date** starts out equal to Term End. You can change it, and once you do it stops following Term End.
4. **Termination Date / Reason** are for when the contract *actually* ended, usually with status = Terminated. They aren't the same as Term End.
5. **Test record** is ticked by default. **Delete test contracts** removes every test contract you've created.

## Fields

Form field set = drawer field set (`CONTRACT_SECTIONS` in `lib/contracts/record.ts`).

| Field | Column (`public.contracts`) | Type | Notes |
|---|---|---|---|
| Contract Name | `contract_name` | text | required |
| Client | `account_id` → `accounts` | uuid FK | required; re-read server-side |
| Scope | `scope` | text, CHECK | dropdown, `CONTRACT_SCOPE` (**placeholder**) |
| Contract Status | `contract_status` | text, CHECK | dropdown, `CONTRACT_STATUS` (**placeholder**) |
| Referral Source | `referral_source` | text | free text |
| Start Date | `start_date` | date | |
| Term Length (months) | `term_length_months` | integer | 1–600 |
| **Term End** | `term_end` | date, **GENERATED** | `start_date + term_length_months months` |
| Termination Notice (days) | `termination_notice_days` | integer | 0–3650 |
| **Notice Date** | `notice_date` | date, **GENERATED** | `start_date + months − notice days` |
| Auto-Renew | `auto_renew` | boolean | existing mirror column, reused; the form defaults it to No |
| Renewal Date | `renewal_date` | date | form default = Term End, editable |
| Quarterly Retainer | `quarterly_retainer` | numeric | existing mirror column, reused; needs a currency |
| Currency | `currency` | text, CHECK | USD / GBP / EUR |
| Termination Date | `termination_date` | date | when it actually ended |
| Termination Reason | `termination_reason` | text | free text |
| Notes | `notes` | text | existing mirror column, reused |
| *(reserved)* | `contract_document` | text | **deferred**: the column exists, but there's no upload/download yet |

### The calculated columns
Both are `GENERATED ALWAYS … STORED` and computed from the **base** columns only. A generated column can't read another generated column, so `notice_date` repeats the term arithmetic itself. The patch uses `make_interval(months => …)` instead of the `(n || ' months')::interval` cast. That cast is only STABLE, and Postgres rejects any generation expression that isn't IMMUTABLE. The arithmetic is the same either way. Example: start 2026-01-01, 24 months, 90 days → **term_end 2028-01-01, notice_date 2027-10-03**. Month-end is clamped the way Postgres does it: Jan 31 + 1 month = Feb 28/29. The form's live preview (`previewTermEnd` / `previewNoticeDate` in `lib/contracts/create.ts`) mirrors this, but the stored value always comes from the database.

### The dropdown lists: one source of truth
`lib/contracts/create.ts` defines `CONTRACT_STATUS`, `CONTRACT_CURRENCY` and `CONTRACT_SCOPE`. The form, the server validation and the filters all import them. The database has a **CHECK constraint with the same values** (patch Part C). **To change a list:** edit the constant **and** its CHECK in the patch, then re-run Part C. If you skip the CHECK, saves are refused.
- Status (placeholder): Draft, Active, Renewed, Expired, Terminated
- Currency: USD, GBP, EUR
- Scope (**placeholder, the client will replace it**): Corporate Access, Investor Perception, Advisory Retainer, Project, Other

## How Dynamics contracts display
The Dynamics sync never writes the new columns, so they're NULL on synced rows. For **display only**, `v_admin_contracts_all` falls back to each field's Dynamics twin:

| View column | Dashboard column | Dynamics fallback |
|---|---|---|
| contract_name | contract_name | name |
| account_id / client_name | account_id | client_account_id / client_account_name |
| contract_status | contract_status | contract_status_label (Initial Term / Renewal Term / Terminated) |
| scope | scope | scope_label (e.g. "*Outreach Only") |
| start_date | start_date | contract_start_date |
| term_length_months | term_length_months | initial_term_length_label ("12 Months" → 12) |
| term_end | term_end | initial_term_end |
| termination_notice_days | termination_notice_days | termination_notice_days_label (numeric only; "N/A" → blank) |
| notice_date | notice_date | renewal_notice_date |
| renewal_date | renewal_date | contract_renewal_date |
| termination_date | termination_date | contract_termination_date |
| termination_reason | termination_reason | reason_for_termination_label |

So the Status and Scope filters also list the Dynamics labels. Dates are lifted to Eastern midnight, as they are on the other CRM views.

**Reporting is untouched.** Portfolio, Margin, `v_contract_management`, Client Statistics and Onboarding read only the Dynamics columns (`client_account_id`, `contract_start_date`, `state_code = 0` …). A dashboard contract doesn't set those, so **it doesn't reach any report** until a deliberate cutover step moves them onto the new columns.

## Views and tables
- **`v_admin_contracts_all`**: one row per contract, joined to `accounts` for the client name and ticker. It has every form field plus term_end, notice_date, origin, is_test, created_by, created_at, updated_at. No `_raw`.
- **`v_admin_contracts_filter_options`**: distinct client / scope / status / currency / auto-renew, read **from the view above**, so the dropdowns always match the list.
- **`contract_saved_views`**: the same shape and rules as `note_saved_views`. It's singular like the other `<entity>_saved_views` tables, although the brief said `contracts_saved_views`.
- Built-in views: **All contracts** (default, newest start first), **Upcoming notice dates**, **Upcoming renewals**, **Created in dashboard**.

## Ownership fence and permissions
The fence was **already** in place for contracts from `2026-09-23_origin_ownership_fence.sql`: `origin` / `is_test`, the `contracts_lock_origin` trigger, and the fenced `touch_synced_at`. It also has `hasOrigin: true` in `lib/sync/entities.ts`, so the deletion sweep and the approve-delete action only ever touch `origin = 'dynamics'` rows. This patch doesn't re-create any of that.

| Action | Who | Enforced where |
|---|---|---|
| See the Admin card / open the page | super_user | the card is on the Admin hub, which only super-users can open (no role is granted `/admin`); `/admin/contracts` is in `ADMIN_ONLY_ROUTES` (proxy), the same page gate as the other admin pages (`getEffectiveRole() === "super_user"` else `/no-access`), and every server action re-checks |
| Create | super_user, not in "View as" | `createContract` → `requireCrmWriter`; `origin='dashboard'` is always set server-side |
| Edit | same | `updateContract` → `updateDashboardRow`: re-read, then `UPDATE … WHERE contract_id AND origin='dashboard'`, which must hit exactly 1 row |
| Delete | same | `deleteContract`: `DELETE … WHERE contract_id AND origin='dashboard'`, which must hit exactly 1 row |
| Purge test rows | same | `purgeTestRows` (origin='dashboard' AND is_test) |
| Dynamics rows | nobody | refused by all of the above; the drawer shows "read-only until cutover" |

Every write is audited through `recordAudit`, and the actor is the real signed-in user. The page is super-user only, so the Financials field permission doesn't come into play here.

Purging a **test client** needs its dashboard contracts purged first, because `account_id` is a foreign key.

## Files
`app/admin/contracts/` (page, actions, contracts-view, contract-record-pane, new-contract-dialog) · `lib/contracts/` (create = constants, record, spec, filters) · `AdminContractRow` in `lib/types.ts` · `/admin/contracts` in `ADMIN_ONLY_ROUTES` (`lib/access-control.ts`) · Admin hub card in `app/admin/page.tsx` · `contract` entity label in `components/crm-add-new.tsx` (for the Add New button only; not in the CRM "+" menu) · `lib/page-registry.ts` · `scripts/verify-contracts.mjs`.

## Out of scope (this pass)
Contract document upload/download (the column is reserved), and the tab summary strip (upcoming notice/renewal dates, retainer totals).
