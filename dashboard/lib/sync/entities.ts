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
  mapEvent
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
  /** Map a raw Dynamics row to a mirror-table row. */
  map: (row: Record<string, unknown>, runStartedAt: string) => Record<string, unknown>
}

export const ENTITIES: EntityConfig[] = [
  { name: "accounts", entitySet: "accounts", table: "accounts", pk: "account_id", map: mapAccount },
  { name: "systemusers", entitySet: "systemusers", table: "users", pk: "user_id", map: mapSystemUser },
  { name: "meetings", entitySet: "bcs_meetings", table: "meetings", pk: "meeting_id", map: mapMeeting },
  { name: "touchpoints", entitySet: "phonecalls", table: "touchpoints", pk: "touchpoint_id", map: mapTouchpoint },
  { name: "client_notes", entitySet: "bcs_clientnotes", table: "client_notes", pk: "note_id", map: mapClientNote },
  { name: "contracts", entitySet: "bcs_contracts", table: "contracts", pk: "contract_id", map: mapContract },
  { name: "tasks", entitySet: "tasks", table: "tasks", pk: "task_id", map: mapTask },
  { name: "new_vacationrequest", entitySet: "new_vacationrequests", table: "new_vacationrequest", pk: "ooo_id", map: mapOOO },
  { name: "events", entitySet: "bcs_events", table: "events", pk: "event_id", map: mapEvent },
]
