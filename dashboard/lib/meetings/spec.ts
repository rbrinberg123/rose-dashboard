/**
 * The Meetings entity, bound to the shared table machinery in lib/table-views/.
 *
 * The built-in views live here rather than in views.ts because the spec needs
 * them and views.ts is now a thin binding layer over the shared implementation.
 */

import { BUILTIN_PREFIX, TODAY_TOKEN, TOMORROW_TOKEN } from "@/lib/table-views/types"
import type { BuiltinView, EntitySpec, ViewSort } from "@/lib/table-views/types"
import { ALWAYS_SELECT, COLUMN_CATALOG, DEFAULT_COLUMNS, getColumn } from "./columns"

/** Newest meeting first — the CRM view's own default. */
export const DEFAULT_SORT: ViewSort = { field: "meeting_date", dir: "desc" }

/**
 * The five presets the View dropdown carried before saved views existed, folded
 * in as read-only SYSTEM views.
 *
 * They are code, not rows: they always exist, cannot be deleted, and need no
 * seeding step, so the page works the moment the table patch is run and before
 * anyone has saved anything. A super-user who wants a shared view they can EDIT
 * saves a new system view; these stay put as the floor. Ids are prefixed so they
 * can never collide with a uuid from the table.
 */
export const BUILTIN_VIEWS: BuiltinView[] = [
  {
    id: `${BUILTIN_PREFIX}upcoming`,
    name: "Upcoming (today or later)",
    isFallbackDefault: true,
    config: {
      columns: DEFAULT_COLUMNS,
      filters: [{ field: "meeting_date", op: "after", value: TODAY_TOKEN }],
      sort: DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}today`,
    name: "Happening today",
    config: {
      columns: DEFAULT_COLUMNS,
      filters: [
        { field: "meeting_date", op: "after", value: TODAY_TOKEN },
        { field: "meeting_date", op: "before", value: TOMORROW_TOKEN },
      ],
      sort: DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}pending`,
    name: "Pending status",
    config: {
      columns: DEFAULT_COLUMNS,
      filters: [{ field: "meeting_status_label", op: "startsWith", value: "pending" }],
      sort: DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}upcoming_no_host`,
    name: "Upcoming, no host assigned",
    config: {
      columns: DEFAULT_COLUMNS,
      filters: [
        { field: "meeting_date", op: "after", value: TODAY_TOKEN },
        { field: "host_names", op: "isEmpty" },
      ],
      sort: DEFAULT_SORT,
    },
  },
  {
    id: `${BUILTIN_PREFIX}all`,
    name: "All meetings",
    config: { columns: DEFAULT_COLUMNS, filters: [], sort: DEFAULT_SORT },
  },
]

export const MEETINGS_SPEC: EntitySpec = {
  key: "meetings",
  viewName: "v_admin_meetings_all",
  idColumn: "meeting_id",
  alwaysSelect: ALWAYS_SELECT,
  getColumn,
  catalog: COLUMN_CATALOG,
  defaultSort: DEFAULT_SORT,
  builtins: BUILTIN_VIEWS,
  savedViewsTable: "meeting_saved_views",
  optionsView: "v_admin_meetings_filter_options",
}
