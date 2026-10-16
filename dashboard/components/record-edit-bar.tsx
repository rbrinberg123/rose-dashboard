"use client"

import { Loader2, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * The drawer's edit affordance, decided by the record's ORIGIN:
 *   - 'dashboard' → an Edit button (the dashboard owns this row)
 *   - 'dynamics'  → a quiet note saying WHY it can't be edited
 * This only hides a button. The real rule is enforced server-side in
 * updateDashboardRow (lib/crm-write.ts), which refuses any non-dashboard row.
 */
export function RecordEditBar({
  origin,
  onEdit,
  pending = false,
}: {
  origin: string | null | undefined
  onEdit?: () => void
  /** The edit form is opening: disabled with a spinner, so repeat clicks queue nothing. */
  pending?: boolean
}) {
  if (origin === "dashboard") {
    if (!onEdit) return null
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-6 px-2 text-[11px]"
        onClick={onEdit}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : <Pencil className="size-3" />} Edit
      </Button>
    )
  }
  if (origin === "dynamics") {
    return (
      <span className="text-[11px] text-muted-foreground" title="Records synced from Dynamics are read-only until the cutover.">
        Synced from Dynamics — read-only until cutover
      </span>
    )
  }
  return null
}
