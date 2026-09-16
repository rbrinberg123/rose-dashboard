/**
 * The entities synced from Dynamics, in the order they run.
 *
 * `entitySet` is the Web API entity SET name (plural), which is what the URL
 * path uses. These mirror loader/load.py's source entities exactly:
 *   account        → accounts
 *   bcs_meeting    → bcs_meetings    → meetings table
 *   phonecall      → phonecalls      → touchpoints table
 *   bcs_clientnote → bcs_clientnotes → client_notes table
 *   bcs_contract   → bcs_contracts   → contracts table
 *   systemuser     → systemusers     → users table
 *
 * `table` is the Supabase mirror table; `pk` is its primary-key column (the
 * upsert conflict target).
 *
 * To add a new entity in the future: add a mapper in ./mappers.ts and append
 * one entry here. The run loop, status endpoint, and admin page are all
 * data-driven from this list — nothing else needs to change.
 */

import {
  mapAccount,
  mapClientNote,
  mapContract,
  mapMeeting,
  mapSystemUser,
  mapTouchpoint,
  mapTask,
  mapOOO,
  mapEvent,
  mapContact
} from "./mappers"

export type EntityConfig = {
  /** Logical name used as the sync_runs key and in the UI. */
  name: string
  /** Web API entity set (plural) for the URL path. */
  entitySet: string
  /** Supabase mirror table. */
  table: string
  /** Primary-key column / upsert conflict target. */
  pk: string
  /**
   * Dynamics id attribute name for this entity set (e.g. `accountid`,
   * `bcs_meetingid`). Used by the deletion-reconciliation sweep to pull the
   * full set of live primary keys ($select={idField}). This is the Dynamics
   * source key that the mirror `pk` column is populated from.
   */
  idField: string
  /** Map a raw Dynamics row to a mirror-table row. */
  map: (row: Record<string, unknown>, runStartedAt: string) => Record<string, unknown>
  /**
   * Opt this entity OUT of the nightly deletion-reconciliation sweep
   * (./reconcile.ts). The sweep does a FULL primary-key pull from Dynamics for
   * every entity, every day — cheap for small entities, wasteful for large
   * ones. Set this where the cost outweighs the benefit of detecting a hard
   * delete promptly; the trade-off is that a deleted row lingers in the mirror
   * until someone reconciles it by hand.
   *
   * Opted-out entities are skipped entirely (not reported as a "skip"), so the
   * sweep's skipped counter keeps meaning "something went wrong".
   */
  skipDeletionSweep?: boolean
}

export const ENTITIES: EntityConfig[] = [
  { name: "accounts", entitySet: "accounts", table: "accounts", pk: "account_id", idField: "accountid", map: mapAccount },
  { name: "systemusers", entitySet: "systemusers", table: "users", pk: "user_id", idField: "systemuserid", map: mapSystemUser },
  { name: "meetings", entitySet: "bcs_meetings", table: "meetings", pk: "meeting_id", idField: "bcs_meetingid", map: mapMeeting },
  { name: "touchpoints", entitySet: "phonecalls", table: "touchpoints", pk: "touchpoint_id", idField: "activityid", map: mapTouchpoint },
  { name: "client_notes", entitySet: "bcs_clientnotes", table: "client_notes", pk: "note_id", idField: "bcs_clientnoteid", map: mapClientNote },
  { name: "contracts", entitySet: "bcs_contracts", table: "contracts", pk: "contract_id", idField: "bcs_contractid", map: mapContract },
  { name: "tasks", entitySet: "tasks", table: "tasks", pk: "task_id", idField: "activityid", map: mapTask },
  { name: "new_vacationrequest", entitySet: "new_vacationrequests", table: "new_vacationrequest", pk: "ooo_id", idField: "new_vacationrequestid", map: mapOOO },
  { name: "events", entitySet: "bcs_events", table: "events", pk: "event_id", idField: "bcs_eventid", map: mapEvent },
  // Contacts opt out of the deletion sweep: it is expected to be the largest
  // entity after meetings, and a full daily ID pull is not worth it for a
  // low-stakes stale row. See EntityConfig.skipDeletionSweep.
  { name: "contacts", entitySet: "contacts", table: "contacts", pk: "contact_id", idField: "contactid", map: mapContact, skipDeletionSweep: true },
]
