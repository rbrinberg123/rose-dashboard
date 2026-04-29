# Rose & Company Management Dashboard — Design

## Purpose

A management dashboard for Rose & Company that surfaces:

1. Client portfolio overview (one row per client, health at a glance)
2. Analyst productivity (meetings booked/hosted per staff member by period)
3. Feedback discipline (% of meetings with feedback collected)
4. Pipeline / next 30 days (upcoming meetings by client and event)
5. Contract / ARR view (renewal calendar, total ARR, churn risk)
6. Margin by client (revenue minus attributed labor and direct costs minus allocated overhead)

Data flows: Dynamics 365 → nightly sync → Supabase → Next.js dashboard on Render.

---

## Architecture

```
┌─────────────────────┐
│   Dynamics 365      │  ← source of truth for CRM data
│   (Dataverse)       │
└──────────┬──────────┘
           │ nightly sync via Web API
           │ (incremental — modifiedon filter)
           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Supabase (Postgres)                    │
│                                                             │
│  ┌─────────────────────┐    ┌────────────────────────────┐  │
│  │   MIRROR SCHEMA     │    │   ROSE-OWNED SCHEMA        │  │
│  │   (read-only)       │    │   (read-write via admin UI)│  │
│  │                     │    │                            │  │
│  │   accounts          │    │   users                    │  │
│  │   meetings          │    │   salary_schedule          │  │
│  │   touchpoints       │    │   cost_assumptions         │  │
│  │   client_notes      │    │   client_direct_costs      │  │
│  │   contracts         │    │   overhead_periods         │  │
│  │                     │    │   overhead_overrides       │  │
│  │                     │    │   revenue_overrides        │  │
│  └─────────────────────┘    └────────────────────────────┘  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              COMPUTED VIEWS                         │    │
│  │                                                     │    │
│  │   v_meeting_costs            — per-meeting $        │    │
│  │   v_client_quarterly_pnl     — margin per client    │    │
│  │   v_client_portfolio         — one row per client   │    │
│  │   v_analyst_activity         — productivity         │    │
│  │   v_feedback_discipline      — feedback rates       │    │
│  │   v_pipeline_30d             — upcoming meetings    │    │
│  │   v_contract_renewals        — renewal calendar     │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ▲
                            │
              ┌─────────────┴─────────────┐
              │                           │
       ┌──────────────┐         ┌──────────────────┐
       │ Read views   │         │ Write to Rose-   │
       │ (dashboard)  │         │ owned tables     │
       │              │         │ (admin screens)  │
       └──────────────┘         └──────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │   Next.js dashboard         │
              │   on Render                 │
              │   (built with Claude Code)  │
              └─────────────────────────────┘
```

### Why this split

- **Mirror tables** never get hand-edited. They are overwritten by the sync job. If Dynamics changes, mirror changes; if mirror changes hand-edited, the next sync will revert it. Treat as read-only.
- **Rose-owned tables** are never touched by the sync job. They are entered through admin UI and persist forever.
- **Views** join across both schemas to produce dashboard-ready data.

This keeps two concerns separate: "what does the CRM say?" and "what business rules does Rose layer on top?"

---

## Mirror schema (synced from Dynamics)

These tables flatten the Dataverse JSON. Every `_xxx_value` lookup gets two columns: the GUID (for joins) and the resolved name (for display). Every picklist gets two columns: the integer code and the resolved label.

### `accounts`

The Rose client. The hub of the data model.

| column | type | source | notes |
|---|---|---|---|
| account_id | uuid PK | `accountid` | |
| name | text | `name` | |
| ticker_symbol | text | `tickersymbol` | |
| website_url | text | `websiteurl` | |
| email | text | `emailaddress1` | |
| city | text | `address2_city` | uses address2_* (more populated than address1) |
| state_province | text | `address2_stateorprovince` | |
| country | text | `address2_country` | |
| hq_country_id | uuid | `_bcs_hqcountry_value` | |
| hq_country_name | text | from FormattedValue | resolved |
| company_master_id | uuid | `_bcs_companymasterrecord_value` | |
| company_master_name | text | from FormattedValue | resolved |
| sector_code | int | `bcs_sector` | |
| sector_label | text | from FormattedValue | resolved |
| industry_option_code | int | `bcs_industryoption` | |
| industry_option_label | text | from FormattedValue | resolved |
| fs_industry | text | `bcs_fsindustry` | |
| fs_sector | text | `bcs_fssector` | |
| exchange_code | int | `bcs_exchange` | |
| exchange_label | text | from FormattedValue | resolved |
| client_status_code | int | `bcs_clientstatus` | |
| client_status_label | text | from FormattedValue | resolved |
| market_cap_b | numeric | `bcs_marketcapb` | billions |
| primary_contact_id | uuid | `_primarycontactid_value` | |
| primary_contact_name | text | from FormattedValue | |
| sales_lead_primary_id | uuid | `_bcs_salesleadprimary_value` | |
| sales_lead_primary_name | text | from FormattedValue | |
| associate_id | uuid | `_bcs_associate_value` | |
| associate_name | text | from FormattedValue | |
| targeting_id | uuid | `_bcs_targeting_value` | |
| targeting_name | text | from FormattedValue | |
| teaser_id | uuid | `_bcs_teaser_value` | |
| teaser_name | text | from FormattedValue | |
| logistics_coordinator_id | uuid | `_bcs_logisticscoordinator_value` | |
| logistics_coordinator_name | text | from FormattedValue | |
| feedback_report_id | uuid | `_bcs_feedbackreport_value` | |
| feedback_report_name | text | from FormattedValue | |
| secondary_manager_id | uuid | `_bcs_secondarymanager_value` | |
| secondary_manager_name | text | from FormattedValue | |
| owner_id | uuid | `_ownerid_value` | |
| owner_name | text | from FormattedValue | |
| last_touchpoint_date | timestamptz | `bcs_lasttouchpoint` | rollup pre-computed in Dynamics |
| next_touchpoint_date | timestamptz | `bcs_nexttouchpoint` | |
| last_event_date | timestamptz | `bcs_lastevent` | |
| next_event_date | timestamptz | `bcs_nextevent` | |
| ongoing_event_date | timestamptz | `bcs_ongoingevent` | |
| last_targeting_date | timestamptz | `bcs_lasttargetingdate` | |
| last_teaser_date | timestamptz | `bcs_lastteaserdate` | |
| last_review_date | timestamptz | derived from `bcs_dayssincelastreview` | |
| do_not_call | boolean | `bcs_donotcall` | |
| ir_only | boolean | `bcs_ironly` | |
| state_code | int | `statecode` | |
| state_label | text | from FormattedValue | "Active" / "Inactive" |
| status_code | int | `statuscode` | |
| status_label | text | from FormattedValue | |
| created_on | timestamptz | `createdon` | |
| modified_on | timestamptz | `modifiedon` | |
| _raw | jsonb | full row | for any field we missed; queryable later |

The `_raw` column is a safety net: if you later want a column we didn't model, it's queryable as `_raw->>'fieldname'` without re-running anything.

### `meetings`

The operational core. ~12,242 rows.

| column | type | source | notes |
|---|---|---|---|
| meeting_id | uuid PK | `bcs_meetingid` | |
| subject | text | `bcs_subject` | |
| meeting_date | timestamptz | `bcs_date` | |
| client_account_id | uuid | `_bcs_client_value` | FK → accounts |
| client_account_name | text | from FormattedValue | denormalized for fast display |
| institution_id | uuid | `_bcs_institution_value` | the investor firm |
| institution_name | text | from FormattedValue | resolved (we don't mirror institution table; this column is the data) |
| investor_text | text | `bcs_investor` | individual investor name as free-text |
| host_id | uuid | `_bcs_host_value` | FK → users |
| host_name | text | from FormattedValue | |
| booker_id | uuid | `_bcs_booker_value` | FK → users |
| booker_name | text | from FormattedValue | |
| meeting_type_code | int | `bcs_meetingtype` | drives the in-person/virtual flag |
| meeting_type_label | text | from FormattedValue | will determine `is_in_person` flag |
| is_in_person | boolean | derived | true if meeting_type_label matches in-person values; default false |
| meeting_status_code | int | `bcs_meetingstatus` | |
| meeting_status_label | text | from FormattedValue | "Active" / "Cancelled" / etc. |
| feedback_status_code | int | `bcs_feedbackstatus` | |
| feedback_status_label | text | from FormattedValue | "Closed - No Feedback" / "Closed - Feedback Received" / etc. |
| feedback_bda_code | int | `bcs_feedbackbda` | |
| feedback_bda_label | text | from FormattedValue | |
| group_meeting | boolean | `bcs_groupmeeting` | |
| client_booked | boolean | `bcs_clientbooked` | |
| rescheduled | boolean | `bcs_rescheduledmeeting` | |
| general_notes | text | `bcs_generalnotes` | |
| feedback_notes | text | `bcs_feedbacknotes` | |
| cancellation_notes | text | `bcs_cancellationnotes` | |
| city_id | uuid | `_bcs_city_value` | |
| state_region_id | uuid | `_bcs_stateregion_value` | |
| event_id | uuid | `_bcs_event_value` | (you said skip events table, but keep the ID for future use) |
| owner_id | uuid | `_ownerid_value` | |
| state_code | int | `statecode` | |
| state_label | text | from FormattedValue | |
| status_code | int | `statuscode` | |
| status_label | text | from FormattedValue | |
| created_on | timestamptz | `createdon` | |
| modified_on | timestamptz | `modifiedon` | |
| _raw | jsonb | full row | |

**The `is_in_person` derivation needs a value-mapping table.** When you upload the full meeting JSON, I'll inventory the distinct values of `bcs_meetingtype` (likely something like "In-Person" / "Phone" / "Virtual" / "Conference Call"). The flattener maps those to a boolean.

### `touchpoints`

877 rows. Phone calls relabeled as Touchpoints.

| column | type | source | notes |
|---|---|---|---|
| touchpoint_id | uuid PK | `activityid` | |
| subject | text | `subject` | |
| description | text | `description` | call notes |
| touchpoint_type_code | int | `bcs_type` | |
| touchpoint_type_label | text | from FormattedValue | |
| contact_type_code | int | `bcs_contacttype` | |
| contact_type_label | text | from FormattedValue | |
| client_account_id | uuid | `_bcs_client_value` | FK → accounts |
| client_account_name | text | from FormattedValue | |
| regarding_id | uuid | `_regardingobjectid_value` | usually duplicates client_account_id |
| direction_code | boolean | `directioncode` | true = outbound |
| scheduled_start | timestamptz | `scheduledstart` | use this; actualstart is empty |
| scheduled_end | timestamptz | `scheduledend` | |
| actual_duration_minutes | int | `actualdurationminutes` | |
| owner_id | uuid | `_ownerid_value` | |
| owner_name | text | from FormattedValue | |
| created_by_id | uuid | `_createdby_value` | |
| created_by_name | text | from FormattedValue | |
| state_code | int | `statecode` | |
| state_label | text | from FormattedValue | |
| status_code | int | `statuscode` | |
| status_label | text | from FormattedValue | |
| created_on | timestamptz | `createdon` | |
| modified_on | timestamptz | `modifiedon` | |
| _raw | jsonb | full row | |

### `client_notes`

177 rows. Periodic notes about client status.

| column | type | source | notes |
|---|---|---|---|
| note_id | uuid PK | `bcs_clientnoteid` | |
| name | text | `bcs_name` | "Client Review - March 2026" etc. |
| note_date | date | `bcs_date` | |
| notes_text | text | `bcs_notestext` | use plain-text version |
| status_text | text | `bcs_status` | "Stable" / etc. |
| primary_risk_driver | text | `bcs_primaryriskdriver` | |
| action_step | text | `bcs_actionstep` | |
| action_owner | text | `bcs_actionowner` | initials, e.g. "JV" |
| action_deadline | date | `bcs_actiondeadline` | |
| client_account_id | uuid | `_bcs_account_value` | FK → accounts |
| client_account_name | text | from FormattedValue | |
| owner_id | uuid | `_ownerid_value` | |
| state_code | int | `statecode` | |
| state_label | text | from FormattedValue | |
| status_code | int | `statuscode` | |
| status_label | text | from FormattedValue | |
| created_on | timestamptz | `createdon` | |
| modified_on | timestamptz | `modifiedon` | |
| _raw | jsonb | full row | |

### `contracts`

354 rows. The revenue source.

| column | type | source | notes |
|---|---|---|---|
| contract_id | uuid PK | `bcs_contractid` | |
| name | text | `bcs_name` | |
| client_account_id | uuid | `_bcs_client_value` | FK → accounts |
| client_account_name | text | from FormattedValue | |
| contract_start_date | date | `bcs_contractstartdate` | |
| contract_termination_date | date | `bcs_contractterminationdate` | |
| contract_renewal_date | date | `bcs_contractrenewaldate` | |
| initial_term_end | date | `bcs_initialtermend` | |
| initial_term_length_code | int | `bcs_initialtermlength` | |
| initial_term_length_label | text | from FormattedValue | |
| contract_status_code | int | `bcs_contractstatus` | |
| contract_status_label | text | from FormattedValue | |
| quarterly_retainer | numeric | `bcs_quarterlyretainer` | |
| quarterly_retainer_base | numeric | `bcs_quarterlyretainer_base` | base currency |
| contract_length_years | numeric | `bcs_contractlength` | |
| auto_renew | boolean | `bcs_autorenew` | |
| renew | boolean | `bcs_renew` | |
| renewal_check_in_date | date | `bcs_renewalcheckindate` | |
| renewal_notice_date | date | `bcs_renewalnoticedate` | |
| termination_notice_code | int | `bcs_terminationnotice` | |
| termination_notice_label | text | from FormattedValue | |
| termination_notice_days_code | int | `bcs_terminationnoticedays` | |
| termination_notice_days_label | text | from FormattedValue | |
| reason_for_termination_code | int | `bcs_reasonfortermination` | |
| reason_for_termination_label | text | from FormattedValue | |
| payment_terms_code | int | `bcs_paymentterms` | |
| payment_terms_label | text | from FormattedValue | |
| invoice_delivery_code | int | `bcs_invoicedelivery` | |
| invoice_delivery_label | text | from FormattedValue | |
| scope_code | int | `bcs_scope` | |
| scope_label | text | from FormattedValue | |
| services_agreement_code | int | `bcs_servicesagreement` | |
| services_agreement_label | text | from FormattedValue | |
| contract_url | text | `bcs_contracturl` | SharePoint link |
| notes | text | `bcs_notes` | |
| owner_id | uuid | `_ownerid_value` | |
| state_code | int | `statecode` | |
| state_label | text | from FormattedValue | |
| status_code | int | `statuscode` | |
| status_label | text | from FormattedValue | |
| created_on | timestamptz | `createdon` | |
| modified_on | timestamptz | `modifiedon` | |
| _raw | jsonb | full row | |

### `users`

A lookup table of Rose staff. Built up incrementally — every distinct `_*_value` GUID + FormattedValue pair from the synced data populates this. No separate sync against the systemuser entity needed.

| column | type | notes |
|---|---|---|
| user_id | uuid PK | the systemuser GUID |
| display_name | text | resolved name from FormattedValue |
| first_seen_at | timestamptz | when first encountered in sync |
| last_seen_at | timestamptz | most recent sync that referenced this user |
| is_active | boolean | manually maintained; defaults true |

This avoids needing a separate Dataverse export of `systemuser` records.

---

## Rose-owned schema (admin entry)

These tables are NEVER touched by the sync job. They persist forever and are managed through the admin UI.

### `salary_schedule`

One row per person per effective period. When someone gets a raise, you add a new row with the new effective_from date and update the previous row's effective_to.

| column | type | notes |
|---|---|---|
| id | bigint PK | |
| user_id | uuid | FK → users |
| effective_from | date | inclusive |
| effective_to | date | inclusive; NULL = currently active |
| annual_salary | numeric | |
| annual_bonus | numeric | |
| benefits_multiplier | numeric default 1.15 | per-row to allow future flexibility |
| notes | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Constraint: no overlapping periods per user. Enforced by trigger or check constraint.

Fully-loaded annual cost = `(annual_salary + annual_bonus) × benefits_multiplier`.

### `cost_assumptions`

A single-row table holding the cost-model parameters. Editable via admin UI.

| column | type | default | notes |
|---|---|---|---|
| id | int PK | 1 | always one row |
| work_hours_per_year | int | 2000 | salary divisor |
| booker_hours_per_meeting_base | numeric | 0.5 | virtual booker hours |
| host_hours_per_meeting_base | numeric | 1.5 | virtual host hours |
| in_person_multiplier | numeric | 2.0 | applied to both booker and host hours |
| updated_at | timestamptz | | |

You said 2× for in-person; defaults match. All editable.

### `client_direct_costs`

T&E, event fees, ad-hoc charges directly attributable to a client.

| column | type | notes |
|---|---|---|
| id | bigint PK | |
| client_account_id | uuid | FK → accounts |
| cost_date | date | when the cost was incurred |
| amount | numeric | dollars |
| category | text | enum: 'T&E', 'Event Fee', 'Sponsorship', 'External Research', 'Other' |
| description | text | |
| created_by_user_id | uuid | who entered it |
| created_at | timestamptz | |

### `overhead_periods`

The total overhead pot to allocate per quarter.

| column | type | notes |
|---|---|---|
| id | bigint PK | |
| period_year | int | e.g. 2026 |
| period_quarter | int | 1, 2, 3, 4 |
| total_overhead_amount | numeric | dollars |
| notes | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Unique constraint on (period_year, period_quarter).

### `overhead_overrides`

Direct allocations to specific clients for a quarter (the "advisory-only client" case). Either fixed dollars OR a percent — exactly one must be set.

| column | type | notes |
|---|---|---|
| id | bigint PK | |
| client_account_id | uuid | FK → accounts |
| period_year | int | |
| period_quarter | int | |
| fixed_amount | numeric | |
| percent_of_total | numeric | 0.0 to 1.0 |
| notes | text | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Constraint: `(fixed_amount IS NOT NULL) <> (percent_of_total IS NOT NULL)` — exactly one of the two.

Unique on (client_account_id, period_year, period_quarter) — one override per client per quarter.

### `revenue_overrides`

Optional manual adjustments to contract-derived revenue. Use cases: refunds, project fees not in a contract, billing accuracy fixes.

| column | type | notes |
|---|---|---|
| id | bigint PK | |
| client_account_id | uuid | FK → accounts |
| period_year | int | |
| period_quarter | int | |
| adjustment_amount | numeric | can be positive or negative |
| reason | text | |
| created_at | timestamptz | |

---

## Computed views

These views are SQL `CREATE VIEW` definitions. They're recomputed on every read — no materialization. At Rose's data scale that's fine; if performance becomes an issue we materialize later.

### `v_meeting_costs`

For every meeting, computes the labor cost using the salary schedule and cost assumptions in effect on the meeting date.

```
Logic:
  for each meeting m:
    booker_salary = lookup salary_schedule where user_id = m.booker_id
                    and m.meeting_date between effective_from and effective_to
    host_salary   = lookup salary_schedule where user_id = m.host_id
                    and m.meeting_date between effective_from and effective_to

    booker_loaded = (booker.annual_salary + booker.annual_bonus) * booker.benefits_multiplier
    host_loaded   = (host.annual_salary   + host.annual_bonus)   * host.benefits_multiplier

    booker_hourly = booker_loaded / cost_assumptions.work_hours_per_year
    host_hourly   = host_loaded   / cost_assumptions.work_hours_per_year

    multiplier = m.is_in_person ? cost_assumptions.in_person_multiplier : 1.0

    booker_cost = booker_hourly * cost_assumptions.booker_hours_per_meeting_base * multiplier
    host_cost   = host_hourly   * cost_assumptions.host_hours_per_meeting_base   * multiplier

    meeting_cost = booker_cost + host_cost

Output columns: meeting_id, meeting_date, client_account_id, client_account_name,
                booker_id, booker_name, host_id, host_name, is_in_person,
                booker_cost, host_cost, meeting_cost, period_year, period_quarter
```

Edge cases handled:
- If booker or host has no salary record covering the meeting date, that side contributes $0 and a flag column `has_missing_salary` is true. Surfaced as exception in admin UI.
- Cancelled meetings still incur cost (booker and host time was spent). Configurable later if you want to exclude.

### `v_client_quarterly_pnl`

The margin view. One row per client per quarter.

```
For each (client, year, quarter):
  revenue:
    sum of contract.quarterly_retainer for contracts active during the quarter
    + sum of revenue_overrides for that client/quarter

  meeting_labor_cost:
    sum of meeting_cost from v_meeting_costs for that client where
    period_year = quarter year and period_quarter = quarter

  direct_costs:
    sum of client_direct_costs.amount where cost_date is in that quarter

  overhead_share:
    if exists overhead_override for (client, year, quarter):
      if fixed_amount: use that
      if percent_of_total: percent * overhead_periods.total_overhead_amount
    else:
      remaining_overhead = overhead_periods.total_overhead_amount
                          - sum of all override allocations for that quarter
      total_meetings_no_override = sum of meetings for clients without override
      client_meetings = count of this client's meetings in quarter
      if client_meetings = 0:
        overhead_share = 0   ← surfaced in exception report
      else:
        overhead_share = remaining_overhead * (client_meetings / total_meetings_no_override)

  margin = revenue - meeting_labor_cost - direct_costs - overhead_share
  margin_pct = margin / revenue (NULL if revenue = 0)

Output columns: client_account_id, client_account_name, period_year, period_quarter,
                revenue, meeting_labor_cost, direct_costs, overhead_share,
                margin, margin_pct, has_missing_salary, has_no_overhead_alloc
```

This is the most complex view. The overhead allocation requires a CTE that computes the override total first, then applies the meeting-share formula to the remainder.

### `v_client_portfolio`

One row per client. Powers the portfolio overview dashboard.

```
For each account:
  account fields: id, name, ticker, status, sector, exchange,
                  hq_country_name, sales_lead_primary_name, associate_name

  most recent contract: contract_status_label, quarterly_retainer,
                        contract_renewal_date, days_to_renewal

  meetings_last_90d: count of meetings where meeting_date in last 90 days
  meetings_next_30d: count of meetings where meeting_date in next 30 days
  last_meeting_date: max(meeting_date)
  last_touchpoint_date: from accounts (already pre-computed in Dynamics)
  next_event_date: from accounts

  last_note_date: max(note_date) from client_notes
  last_note_status: status_text of most recent note
  last_note_risk: primary_risk_driver of most recent note

  current_quarter_revenue: from v_client_quarterly_pnl (current Q)
  current_quarter_margin: from v_client_quarterly_pnl (current Q)
  current_quarter_margin_pct: from v_client_quarterly_pnl (current Q)
```

### `v_analyst_activity`

Productivity by user by quarter.

```
For each (user, year, quarter):
  meetings_booked: count where booker_id = user
  meetings_hosted: count where host_id = user
  meetings_in_person_hosted: count where host_id = user and is_in_person
  meetings_virtual_hosted: count where host_id = user and not is_in_person
  meetings_cancelled_booked: count where booker_id = user and meeting_status = 'Cancelled'
  meetings_cancelled_hosted: count where host_id = user and meeting_status = 'Cancelled'
  feedback_collected_hosted: count of hosted meetings with feedback_status = 'Closed - Feedback Received'
  feedback_collection_rate: feedback_collected_hosted / (meetings_hosted - cancelled)

  total_labor_cost_attributed: sum of (booker_cost where booker_id = user)
                              + sum of (host_cost where host_id = user)
                              from v_meeting_costs in quarter
```

### `v_feedback_discipline`

% of meetings with feedback collected, broken down multiple ways.

```
Three roll-up axes — three separate queries, exposed as one view via UNION
or as three views. Probably cleaner as three:

v_feedback_by_client:
  client_account_id, client_account_name, period_year, period_quarter,
  total_meetings, meetings_with_feedback, feedback_rate

v_feedback_by_analyst:
  user_id, display_name (host), period_year, period_quarter,
  total_hosted, hosted_with_feedback, feedback_rate

v_feedback_overall:
  period_year, period_quarter,
  total_meetings, meetings_with_feedback, feedback_rate

"With feedback" defined as feedback_status_label NOT IN
  ('Closed - No Feedback', 'Open', null)
We'll confirm exact label values from the meeting JSON.
```

### `v_pipeline_30d`

Upcoming meetings in the next 30 days.

```
For each meeting where meeting_date between now and now + 30 days
  and state_label = 'Active'
  and meeting_status_label != 'Cancelled':

  meeting_id, meeting_date, client_account_name, institution_name,
  investor_text, host_name, booker_name, is_in_person, group_meeting,
  city_name (from city lookup if mirrored), days_until
```

### `v_contract_renewals`

Renewal calendar.

```
For each contract where state_label = 'Active'
  and contract_renewal_date is not null
  and contract_renewal_date >= now:

  contract_id, client_account_name, contract_renewal_date,
  days_to_renewal, quarterly_retainer, auto_renew, renew (intent flag),
  renewal_notice_date, days_to_notice
  ORDER BY contract_renewal_date asc
```

Plus a view of contracts with renewal_date in the past 30 days that need confirmation of status.

---

## Data flow: end to end

1. **Initial load (one-time, manual):** run `extract.py` to pull JSON from Dataverse, then run `load.py` to flatten and upsert into Supabase mirror tables.
2. **Admin entry (ongoing, manual):** Rose ops enters salaries, direct costs, overhead pots, overrides through the admin UI.
3. **Nightly sync (automated, Render cron):** runs `extract.py --incremental` (filters on `modifiedon > last_sync_time`), then `load.py` to upsert changes.
4. **Dashboard reads (real-time):** Next.js app reads from views; admin pages write to Rose-owned tables.

---

## Open questions

These are things I can't lock without data I don't have yet:

1. **Distinct values of `bcs_meetingtype`.** Need to inventory the full meeting JSON to know which labels mean "in-person" and which mean "virtual" or "phone." Determines the `is_in_person` flag mapping.
2. **Distinct values of `bcs_feedbackstatus`.** Need to confirm which labels count as "feedback collected." Drives the feedback discipline view.
3. **Whether Cancelled meetings should incur cost.** I've defaulted to "yes, time was still spent." Confirm or flip.
4. **Whether to mirror `bcs_city` and `bcs_stateregion`.** The meeting record has city/region lookups. If the dashboard needs to display "meeting in New York vs London" we need those tables. If you only care about virtual/in-person, skip them.

Address these once I see the full meeting data and we'll lock the schema.

---

## What this design does NOT include

Worth being explicit about scope so there's no surprise:

- **No event/conference table.** You said skip. Date fields on Account suffice.
- **No institution table.** Investor firm names are denormalized into `meetings.institution_name`. You don't get filterable lists of investors, but you can group by institution name in queries.
- **No contact-level data.** No mirror of the contact entity. The dashboard is at the account level.
- **No leads, opportunities, projects, or queues.** Only the five tables.
- **No row-level security on the dashboard.** All Rose users see all clients. Add later if needed.
- **No real-time sync.** Nightly only. If a meeting is booked at 2pm, it shows up in the dashboard the next morning.
- **No audit log on Rose-owned tables.** Edits overwrite previous values. Add `created_at`/`updated_at` and history table later if needed.

---

## Next steps

Assuming you sign off on this design:

1. I write the SQL DDL files (one per table), the view definitions, and the seed data (cost_assumptions defaults).
2. I write the Python flattener (`load.py`) that reads the JSON files and upserts into the mirror tables.
3. I write a brief admin-UI spec describing each screen Claude Code will need to build.
4. You create a GitHub repo, drop these files in, and point Claude Code at it. Claude Code handles the rest.

Total deliverable size: roughly 8 SQL files, 1 Python loader, 1 README, 1 admin-UI spec. Maybe 1500 lines of code total. None of it complex.
