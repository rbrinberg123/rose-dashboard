"""
load.py — Loads Dataverse JSON exports into Supabase.

Run this after exporting JSON via dataverse_export.py and after creating the
Supabase schema via the SQL files in /sql.

Usage:
    pip install -r requirements.txt
    cp .env.example .env  # then fill in your Supabase connection string
    python load.py [--exports-dir ../dataverse_exports]

The loader:
  1. Reads the five JSON files (account, bcs_clientnote, bcs_contract,
     phonecall, bcs_meeting).
  2. Builds the users table by collecting every (user_id, display_name)
     pair from any *_value lookup that resolves to systemuser.
  3. Flattens FormattedValue annotations into clean *_label / *_name columns.
  4. Upserts each row into the corresponding Supabase table.

The loader is idempotent — running it twice produces the same result. Each
table is upserted on its primary key, so existing rows are updated and new
rows are inserted.
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import execute_values, Json
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)

load_dotenv()


# -----------------------------------------------------------------------------
# Helpers for reading Dataverse JSON
# -----------------------------------------------------------------------------

FMT = "@OData.Community.Display.V1.FormattedValue"
LOOKUP_TYPE = "@Microsoft.Dynamics.CRM.lookuplogicalname"


def fv(row: dict, field: str) -> Optional[str]:
    """Return the FormattedValue annotation for a field, or None."""
    return row.get(f"{field}{FMT}")


def lookup_id(row: dict, field: str) -> Optional[str]:
    """Return the GUID stored in a _xxx_value lookup field."""
    return row.get(field)


def lookup_name(row: dict, field: str) -> Optional[str]:
    """Return the resolved name from a _xxx_value lookup field."""
    return row.get(f"{field}{FMT}")


def lookup_target(row: dict, field: str) -> Optional[str]:
    """Return the entity logical name that a _xxx_value lookup points at."""
    return row.get(f"{field}{LOOKUP_TYPE}")


def parse_dt(value: Optional[str]) -> Optional[datetime]:
    """Parse an ISO datetime string from Dataverse. Tolerates Zs."""
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


# -----------------------------------------------------------------------------
# Users — built incrementally from any systemuser lookup encountered
# -----------------------------------------------------------------------------

def collect_users(rows: List[dict], extra_lookup_fields: List[str] = None) -> Dict[str, str]:
    """
    Walk every row and collect (user_id, display_name) for ANY lookup field
    that resolves to systemuser. Captures users even if their FormattedValue
    is missing (deactivated users) by using '<Unknown User>' as the name.
    """
    users: Dict[str, str] = {}
    for row in rows:
        for key in row.keys():
            if not (key.startswith("_") and key.endswith("_value")):
                continue
            target_key = f"{key}@Microsoft.Dynamics.CRM.lookuplogicalname"
            if row.get(target_key) != "systemuser":
                continue
            uid = row.get(key)
            if not uid:
                continue
            name = row.get(f"{key}@OData.Community.Display.V1.FormattedValue") or "<Unknown User>"
            # Don't overwrite a real name with a fallback; only set if not already set or upgrading from fallback
            existing = users.get(uid)
            if existing is None or existing == "<Unknown User>":
                users[uid] = name
    return users

# -----------------------------------------------------------------------------
# Row mappers — one per table
# -----------------------------------------------------------------------------

def map_account(row: dict) -> dict:
    """Map a Dataverse account record to the accounts table schema."""
    # Compute last_review_date from days_since_last_review (best effort)
    days = row.get("bcs_dayssincelastreview")
    last_review_date = None
    if isinstance(days, int) and days > 0:
        from datetime import date, timedelta
        last_review_date = date.today() - timedelta(days=days)

    return {
        "account_id": row["accountid"],
        "name": row.get("name"),
        "ticker_symbol": row.get("tickersymbol"),
        "website_url": row.get("websiteurl"),
        "email": row.get("emailaddress1"),
        "city": row.get("address2_city"),
        "state_province": row.get("address2_stateorprovince"),
        "country": row.get("address2_country"),

        "hq_country_id": lookup_id(row, "_bcs_hqcountry_value"),
        "hq_country_name": lookup_name(row, "_bcs_hqcountry_value"),
        "company_master_id": lookup_id(row, "_bcs_companymasterrecord_value"),
        "company_master_name": lookup_name(row, "_bcs_companymasterrecord_value"),

        "sector_code": row.get("bcs_sector"),
        "sector_label": fv(row, "bcs_sector"),
        "industry_option_code": row.get("bcs_industryoption"),
        "industry_option_label": fv(row, "bcs_industryoption"),
        "fs_industry": row.get("bcs_fsindustry"),
        "fs_sector": row.get("bcs_fssector"),
        "exchange_code": row.get("bcs_exchange"),
        "exchange_label": fv(row, "bcs_exchange"),

        "client_status_code": row.get("bcs_clientstatus"),
        "client_status_label": fv(row, "bcs_clientstatus"),

        "market_cap_b": row.get("bcs_marketcapb"),

        "primary_contact_id": lookup_id(row, "_primarycontactid_value"),
        "primary_contact_name": lookup_name(row, "_primarycontactid_value"),
        "sales_lead_primary_id": lookup_id(row, "_bcs_salesleadprimary_value"),
        "sales_lead_primary_name": lookup_name(row, "_bcs_salesleadprimary_value"),
        "associate_id": lookup_id(row, "_bcs_associate_value"),
        "associate_name": lookup_name(row, "_bcs_associate_value"),
        "targeting_id": lookup_id(row, "_bcs_targeting_value"),
        "targeting_name": lookup_name(row, "_bcs_targeting_value"),
        "teaser_id": lookup_id(row, "_bcs_teaser_value"),
        "teaser_name": lookup_name(row, "_bcs_teaser_value"),
        "logistics_coordinator_id": lookup_id(row, "_bcs_logisticscoordinator_value"),
        "logistics_coordinator_name": lookup_name(row, "_bcs_logisticscoordinator_value"),
        "feedback_report_id": lookup_id(row, "_bcs_feedbackreport_value"),
        "feedback_report_name": lookup_name(row, "_bcs_feedbackreport_value"),
        "secondary_manager_id": lookup_id(row, "_bcs_secondarymanager_value"),
        "secondary_manager_name": lookup_name(row, "_bcs_secondarymanager_value"),
        "owner_id": lookup_id(row, "_ownerid_value"),
        "owner_name": lookup_name(row, "_ownerid_value"),

        "last_touchpoint_date": parse_dt(row.get("bcs_lasttouchpoint")),
        "next_touchpoint_date": parse_dt(row.get("bcs_nexttouchpoint")),
        "last_event_date": parse_dt(row.get("bcs_lastevent")),
        "next_event_date": parse_dt(row.get("bcs_nextevent")),
        "ongoing_event_date": parse_dt(row.get("bcs_ongoingevent")),
        "last_targeting_date": parse_dt(row.get("bcs_lasttargetingdate")),
        "last_teaser_date": parse_dt(row.get("bcs_lastteaserdate")),
        "days_since_last_review": row.get("bcs_dayssincelastreview"),

        "do_not_call": row.get("bcs_donotcall"),
        "ir_only": row.get("bcs_ironly"),

        "state_code": row.get("statecode"),
        "state_label": fv(row, "statecode"),
        "status_code": row.get("statuscode"),
        "status_label": fv(row, "statuscode"),
        "created_on": parse_dt(row.get("createdon")),
        "modified_on": parse_dt(row.get("modifiedon")),

        "_raw": Json(row),
    }


def map_meeting(row: dict) -> dict:
    """Map a Dataverse bcs_meeting record."""
    meeting_type_label = fv(row, "bcs_meetingtype")
    is_in_person = (meeting_type_label == "Live")

    return {
        "meeting_id": row["bcs_meetingid"],
        "meeting_date": parse_dt(row.get("bcs_date")),

        "client_account_id": lookup_id(row, "_bcs_client_value"),
        "client_account_name": lookup_name(row, "_bcs_client_value"),

        "institution_id": lookup_id(row, "_bcs_institution_value"),
        "institution_name": lookup_name(row, "_bcs_institution_value"),
        "investor_text": row.get("bcs_investor"),

        "host_id": lookup_id(row, "_bcs_host_value"),
        "host_name": lookup_name(row, "_bcs_host_value"),
        "booker_id": lookup_id(row, "_bcs_booker_value"),
        "booker_name": lookup_name(row, "_bcs_booker_value"),

        "meeting_type_code": row.get("bcs_meetingtype"),
        "meeting_type_label": meeting_type_label,
        "is_in_person": is_in_person,

        "meeting_status_code": row.get("bcs_meetingstatus"),
        "meeting_status_label": fv(row, "bcs_meetingstatus"),

        "feedback_status_code": row.get("bcs_feedbackstatus"),
        "feedback_status_label": fv(row, "bcs_feedbackstatus"),
        "feedback_bda_code": row.get("bcs_feedbackbda"),
        "feedback_bda_label": fv(row, "bcs_feedbackbda"),

        "group_meeting": row.get("bcs_groupmeeting"),
        "client_booked": row.get("bcs_clientbooked"),
        "rescheduled": row.get("bcs_rescheduledmeeting"),

        "general_notes": row.get("bcs_generalnotes"),
        "feedback_notes": row.get("bcs_feedbacknotes"),
        "cancellation_notes": row.get("bcs_cancellationnotes"),

        "city_id": lookup_id(row, "_bcs_city_value"),
        "state_region_id": lookup_id(row, "_bcs_stateregion_value"),
        "event_id": lookup_id(row, "_bcs_event_value"),

        "calendar_code": row.get("bcs_calendar"),
        "calendar_label": fv(row, "bcs_calendar"),
        "profile_code": row.get("bcs_profile"),
        "profile_label": fv(row, "bcs_profile"),
        "host_notes_code": row.get("bcs_hostnotes"),
        "host_notes_label": fv(row, "bcs_hostnotes"),

        "owner_id": lookup_id(row, "_ownerid_value"),
        "state_code": row.get("statecode"),
        "state_label": fv(row, "statecode"),
        "status_code": row.get("statuscode"),
        "status_label": fv(row, "statuscode"),
        "created_on": parse_dt(row.get("createdon")),
        "modified_on": parse_dt(row.get("modifiedon")),

        "_raw": Json(row),
    }


def map_touchpoint(row: dict) -> dict:
    """Map a Dataverse phonecall record."""
    return {
        "touchpoint_id": row["activityid"],
        "subject": row.get("subject"),
        "description": row.get("description"),

        "touchpoint_type_code": row.get("bcs_type"),
        "touchpoint_type_label": fv(row, "bcs_type"),
        "contact_type_code": row.get("bcs_contacttype"),
        "contact_type_label": fv(row, "bcs_contacttype"),

        "client_account_id": lookup_id(row, "_bcs_client_value"),
        "client_account_name": lookup_name(row, "_bcs_client_value"),
        "regarding_id": lookup_id(row, "_regardingobjectid_value"),

        "direction_code": row.get("directioncode"),

        "scheduled_start": parse_dt(row.get("scheduledstart")),
        "scheduled_end": parse_dt(row.get("scheduledend")),
        "actual_duration_minutes": row.get("actualdurationminutes"),

        "owner_id": lookup_id(row, "_ownerid_value"),
        "owner_name": lookup_name(row, "_ownerid_value"),
        "created_by_id": lookup_id(row, "_createdby_value"),
        "created_by_name": lookup_name(row, "_createdby_value"),

        "state_code": row.get("statecode"),
        "state_label": fv(row, "statecode"),
        "status_code": row.get("statuscode"),
        "status_label": fv(row, "statuscode"),

        "created_on": parse_dt(row.get("createdon")),
        "modified_on": parse_dt(row.get("modifiedon")),

        "_raw": Json(row),
    }


def map_client_note(row: dict) -> dict:
    """Map a Dataverse bcs_clientnote record."""
    return {
        "note_id": row["bcs_clientnoteid"],
        "name": row.get("bcs_name"),
        "note_date": parse_dt(row.get("bcs_date")),

        "notes_text": row.get("bcs_notestext"),
        "status_text": row.get("bcs_status"),
        "primary_risk_driver": row.get("bcs_primaryriskdriver"),

        "action_step": row.get("bcs_actionstep"),
        "action_owner": row.get("bcs_actionowner"),
        "action_deadline": parse_dt(row.get("bcs_actiondeadline")),

        "client_account_id": lookup_id(row, "_bcs_account_value"),
        "client_account_name": lookup_name(row, "_bcs_account_value"),

        "owner_id": lookup_id(row, "_ownerid_value"),

        "state_code": row.get("statecode"),
        "state_label": fv(row, "statecode"),
        "status_code": row.get("statuscode"),
        "status_label": fv(row, "statuscode"),

        "created_on": parse_dt(row.get("createdon")),
        "modified_on": parse_dt(row.get("modifiedon")),

        "_raw": Json(row),
    }


def map_contract(row: dict) -> dict:
    """Map a Dataverse bcs_contract record."""
    return {
        "contract_id": row["bcs_contractid"],
        "name": row.get("bcs_name"),

        "client_account_id": lookup_id(row, "_bcs_client_value"),
        "client_account_name": lookup_name(row, "_bcs_client_value"),

        "contract_start_date": parse_dt(row.get("bcs_contractstartdate")),
        "contract_termination_date": parse_dt(row.get("bcs_contractterminationdate")),
        "contract_renewal_date": parse_dt(row.get("bcs_contractrenewaldate")),
        "initial_term_end": parse_dt(row.get("bcs_initialtermend")),

        "initial_term_length_code": row.get("bcs_initialtermlength"),
        "initial_term_length_label": fv(row, "bcs_initialtermlength"),

        "contract_status_code": row.get("bcs_contractstatus"),
        "contract_status_label": fv(row, "bcs_contractstatus"),

        "quarterly_retainer": row.get("bcs_quarterlyretainer"),
        "quarterly_retainer_base": row.get("bcs_quarterlyretainer_base"),
        "contract_length_years": row.get("bcs_contractlength"),

        "auto_renew": row.get("bcs_autorenew"),
        "renew": row.get("bcs_renew"),
        "renewal_check_in_date": parse_dt(row.get("bcs_renewalcheckindate")),
        "renewal_notice_date": parse_dt(row.get("bcs_renewalnoticedate")),

        "termination_notice_code": row.get("bcs_terminationnotice"),
        "termination_notice_label": fv(row, "bcs_terminationnotice"),
        "termination_notice_days_code": row.get("bcs_terminationnoticedays"),
        "termination_notice_days_label": fv(row, "bcs_terminationnoticedays"),
        "reason_for_termination_code": row.get("bcs_reasonfortermination"),
        "reason_for_termination_label": fv(row, "bcs_reasonfortermination"),

        "payment_terms_code": row.get("bcs_paymentterms"),
        "payment_terms_label": fv(row, "bcs_paymentterms"),
        "invoice_delivery_code": row.get("bcs_invoicedelivery"),
        "invoice_delivery_label": fv(row, "bcs_invoicedelivery"),

        "scope_code": row.get("bcs_scope"),
        "scope_label": fv(row, "bcs_scope"),
        "services_agreement_code": row.get("bcs_servicesagreement"),
        "services_agreement_label": fv(row, "bcs_servicesagreement"),

        "contract_url": row.get("bcs_contracturl"),
        "notes": row.get("bcs_notes"),

        "owner_id": lookup_id(row, "_ownerid_value"),

        "state_code": row.get("statecode"),
        "state_label": fv(row, "statecode"),
        "status_code": row.get("statuscode"),
        "status_label": fv(row, "statuscode"),

        "created_on": parse_dt(row.get("createdon")),
        "modified_on": parse_dt(row.get("modifiedon")),

        "_raw": Json(row),
    }


# -----------------------------------------------------------------------------
# Bulk upsert
# -----------------------------------------------------------------------------

def upsert(conn, table: str, rows: List[dict], pk: str):
    """Bulk upsert rows into table on the primary key."""
    if not rows:
        log.warning(f"No rows to upsert into {table}")
        return

    columns = list(rows[0].keys())
    values = [tuple(r[c] for c in columns) for r in rows]

    update_clause = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in columns if c != pk
    )

    sql = f"""
        INSERT INTO public.{table} ({', '.join(columns)})
        VALUES %s
        ON CONFLICT ({pk}) DO UPDATE SET {update_clause};
    """

    with conn.cursor() as cur:
        execute_values(cur, sql, values, page_size=500)
    conn.commit()
    log.info(f"  Upserted {len(rows)} rows into {table}")


def upsert_users(conn, users: Dict[str, str]):
    """Upsert the users table — preserves existing first_seen_at."""
    if not users:
        return

    sql = """
        INSERT INTO public.users (user_id, display_name, first_seen_at, last_seen_at)
        VALUES %s
        ON CONFLICT (user_id) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            last_seen_at = EXCLUDED.last_seen_at;
    """
    now = datetime.utcnow()
    values = [(uid, name, now, now) for uid, name in users.items()]

    with conn.cursor() as cur:
        execute_values(cur, sql, values, page_size=500)
    conn.commit()
    log.info(f"  Upserted {len(users)} users")


# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------

def load_json(path: Path) -> List[dict]:
    log.info(f"Reading {path.name}...")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    log.info(f"  {len(data)} rows")
    return data


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--exports-dir",
        default="../dataverse_exports",
        help="Directory containing the JSON exports",
    )
    args = parser.parse_args()

    exports_dir = Path(args.exports_dir).resolve()
    if not exports_dir.is_dir():
        log.error(f"Exports directory not found: {exports_dir}")
        sys.exit(1)
    log.info(f"Reading exports from {exports_dir}")

    db_url = os.getenv("SUPABASE_DB_URL")
    if not db_url:
        log.error("SUPABASE_DB_URL not set in environment / .env")
        sys.exit(1)

    log.info("Connecting to Supabase...")
    conn = psycopg2.connect(db_url)

    # Load all five files
    accounts_raw = load_json(exports_dir / "account.json")
    notes_raw = load_json(exports_dir / "bcs_clientnote.json")
    contracts_raw = load_json(exports_dir / "bcs_contract.json")
    touchpoints_raw = load_json(exports_dir / "phonecall.json")
    meetings_raw = load_json(exports_dir / "bcs_meeting.json")

    # -------- Build the users table from every systemuser lookup encountered
    log.info("\nCollecting users from all lookup fields...")
    user_lookup_fields = [
        # Account
        "_bcs_associate_value", "_bcs_salesleadprimary_value",
        "_bcs_targeting_value", "_bcs_teaser_value",
        "_bcs_logisticscoordinator_value", "_bcs_feedbackreport_value",
        "_bcs_secondarymanager_value", "_bcs_feedbackteam_value",
        "_ownerid_value", "_createdby_value", "_modifiedby_value",
        "_owninguser_value",
        # Meeting
        "_bcs_host_value", "_bcs_booker_value", "_bcs_alias_value",
        # Notes
        "_bcs_account_value", "_bcs_acctmgr_value", "_bcs_assoc_value",
        "_bcs_log_value", "_bcs_secmgr_value",
        # Contract
        "_bcs_client_value",
    ]
    all_users: Dict[str, str] = {}
    for ds in [accounts_raw, notes_raw, contracts_raw, touchpoints_raw, meetings_raw]:
        all_users.update(collect_users(ds, user_lookup_fields))
    log.info(f"  Found {len(all_users)} unique users")
    upsert_users(conn, all_users)

    # -------- Map and upsert each table
    log.info("\nLoading accounts...")
    upsert(conn, "accounts", [map_account(r) for r in accounts_raw], "account_id")

    log.info("\nLoading client_notes...")
    upsert(conn, "client_notes", [map_client_note(r) for r in notes_raw], "note_id")

    log.info("\nLoading contracts...")
    upsert(conn, "contracts", [map_contract(r) for r in contracts_raw], "contract_id")

    log.info("\nLoading touchpoints...")
    upsert(conn, "touchpoints", [map_touchpoint(r) for r in touchpoints_raw], "touchpoint_id")

    log.info("\nLoading meetings...")
    upsert(conn, "meetings", [map_meeting(r) for r in meetings_raw], "meeting_id")

    conn.close()
    log.info("\nDone.")


if __name__ == "__main__":
    main()
