"use client"

import { Plus } from "lucide-react"
import { toast } from "sonner"

import { RAIL_ACCENT_FILL } from "@/lib/design"
import { cn } from "@/lib/utils"

/* ---------------------------------------------------------------------------
 * "Add New" — PLACEHOLDER SCAFFOLDING FOR THE CRM CUTOVER
 *
 * Nothing here creates a record. There is no form, no Server Action, no DB
 * write, and no navigation. Every control routes through the single stub
 * `onAddNew(entity)` below, which shows a "coming soon" toast so a click reads
 * as deliberate rather than broken.
 *
 * WIRING IT UP LATER is meant to be a one-file change: replace the body of
 * `onAddNew` with a real dispatch (open a drawer, push to /meetings/new, call a
 * Server Action — whatever the cutover lands on). Both entry points — the
 * per-page "Add New X" button and the nav quick-add menu — already funnel
 * through it, so neither call site needs to change.
 *
 * GATING: super-user only, inherited rather than re-implemented.
 *   - The seven CRM pages each do `if (role !== "super_user") redirect("/no-access")`
 *     server-side before rendering, so an AddNewButton inside one can only ever
 *     reach a super-user.
 *   - The nav quick-add sits inside the nav's CRM block, which renders nothing
 *     at all unless `canSeeCrmNav` passes (super_user + canAccessRoute).
 *   Deliberately NOT a second role prop: a copy of the rule here could drift
 *   from the one that actually enforces it.
 *
 * WHERE THE NAV QUICK-ADD LIVES: `CrmQuickAdd` is in `components/nav.tsx`, not
 * here. It opens on hover using the rail's own `useFlyout` — the same mechanism,
 * delay and grace period as every other rail fly-out — and `useFlyout` is
 * nav-local. Importing it here would make nav.tsx ↔ crm-add-new.tsx circular,
 * since nav.tsx renders the quick-add. The stub and the labels stay here, so
 * both entry points still share one definition of what an entity is.
 * ------------------------------------------------------------------------ */

/** The seven CRM record types. "touch" and "client" are DISPLAY names; the route,
 *  table and view stay "touchpoints" / "accounts" (see CRM_NAV_ITEMS in
 *  lib/access-control.ts). */
export type CrmEntity =
  | "meeting"
  | "event"
  | "task"
  | "touch"
  | "note"
  | "contact"
  | "client"

/** Singular display name per entity. Exported so the nav quick-add menu in
 *  nav.tsx renders "New Meeting" from the same source as the page buttons. */
export const CRM_ENTITY_LABELS: Record<CrmEntity, string> = {
  meeting: "Meeting",
  event: "Event",
  task: "Task",
  touch: "Touch",
  note: "Note",
  contact: "Contact",
  client: "Client",
}

/** Menu order — matches the CRM nav rail top-to-bottom. */
export const QUICK_ADD_ORDER: readonly CrmEntity[] = [
  "client",
  "meeting",
  "event",
  "task",
  "touch",
  "note",
  "contact",
]

/**
 * THE STUB. Every "Add New" control in the app calls exactly this.
 *
 * Today: a toast, and nothing else. No write, no fetch, no route change.
 */
export function onAddNew(entity: CrmEntity) {
  const label = CRM_ENTITY_LABELS[entity]
  toast("Coming soon — record creation isn't enabled yet", {
    description: `"New ${label}" will create a ${label.toLowerCase()} here once the CRM cutover lands. Nothing was saved.`,
  })
}

/* ---------------------------------------------------------------------------
 * Per-page primary button — top-right of each CRM page's masthead.
 * ------------------------------------------------------------------------ */

/**
 * The prominent "+ Add New {Entity}" action, passed to ListTitleCard's
 * `rightSlot`. Solid brand blue→teal (RAIL_ACCENT_FILL) so it reads as THE
 * primary action on the page — every other control in these toolbars is an
 * outline or a ghost.
 */
export function AddNewButton({
  entity,
  className,
}: {
  entity: CrmEntity
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => onAddNew(entity)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-semibold text-white shadow-sm",
        "transition-opacity hover:opacity-90",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0355A7]/40 focus-visible:ring-offset-2",
        className,
      )}
      style={{ background: RAIL_ACCENT_FILL }}
    >
      <Plus className="size-4 shrink-0" aria-hidden="true" />
      Add New {CRM_ENTITY_LABELS[entity]}
    </button>
  )
}
