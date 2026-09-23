import { STATUS_PILL_LIGHT } from "@/lib/design"

/**
 * "TEST" marker for dashboard-created test records (is_test = true). Amber, so
 * test data is obvious at a glance. A visual marker only — nothing filters on
 * is_test. Used by the Contacts and Notes lists and drawers.
 */
export function TestBadge() {
  return (
    <span
      title="Test record created in the dashboard — removed by “Delete test records”"
      className="inline-flex shrink-0 items-center rounded px-1.5 py-px text-[10px] font-bold tracking-wider"
      style={{ backgroundColor: STATUS_PILL_LIGHT.watch.bg, color: STATUS_PILL_LIGHT.watch.text }}
    >
      TEST
    </span>
  )
}
