"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { bulkUpdateProfileStage, type BulkProfileStageRequest } from "@/app/meetings/actions"
import { PROFILE_ADVANCE_ORDER } from "@/lib/meetings/create"
import type { ProfileUpcomingRow } from "@/lib/types"

/**
 * BULK PROFILE STAGE on the Profiles board (2026-10-20). Stage ONLY — there is
 * no field picker here, by design.
 *
 *   - Selection: a checkbox per card, a select-all per week column, and a
 *     "Select all visible" on the action row. Select-all always means the
 *     cards VISIBLE under the current filters; actions apply only to selected
 *     cards that are still visible.
 *   - Action: "Set stage to ▾" (one of PROFILE_ADVANCE_ORDER) — the bulk
 *     "Advance selected" was removed 2026-10-20; the drawer keeps its
 *     per-meeting advance. A light inline confirm, then bulkUpdateProfileStage —
 *     which re-checks Edit level, row scope and the origin fence server-side
 *     and silently skips anything ineligible (e.g. Dynamics meetings).
 */

type Selection = {
  selected: ReadonlySet<string>
  setMany: (ids: string[], on: boolean) => void
}

const SelectionContext = React.createContext<Selection | null>(null)

export const ProfileSelectionProvider = SelectionContext.Provider

const BOX_CLASS = "size-3.5 shrink-0 cursor-pointer accent-[#1E2858]"

/** One card's checkbox. Clicks never reach the card (which opens the drawer). */
export function RowSelectBox({ id, label }: { id: string; label: string }) {
  const sel = React.useContext(SelectionContext)
  if (!sel) return null
  return (
    <input
      type="checkbox"
      aria-label={`Select ${label}`}
      checked={sel.selected.has(id)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => sel.setMany([id], e.target.checked)}
      className={BOX_CLASS}
    />
  )
}

/** Select-all for a group of (visible) cards — checked / mixed / clear. */
export function SelectAllBox({ ids, label }: { ids: string[]; label: string }) {
  const sel = React.useContext(SelectionContext)
  const ref = React.useRef<HTMLInputElement>(null)
  const count = sel ? ids.filter((id) => sel.selected.has(id)).length : 0
  const all = ids.length > 0 && count === ids.length
  React.useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all
  }, [count, all])
  if (!sel) return null
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      title={label}
      disabled={ids.length === 0}
      checked={all}
      onChange={() => sel.setMany(ids, !all)}
      className={BOX_CLASS + " disabled:cursor-not-allowed disabled:opacity-40"}
    />
  )
}

type Pending = { kind: "set"; stage: string }

/** The action row: Select all visible, and — with ≥1 selected — the bulk actions. */
export function BulkStageBar({
  visibleRows,
  onDone,
}: {
  /** The cards currently visible under the board's filters. */
  visibleRows: ProfileUpcomingRow[]
  /** After a successful apply — clears the selection. */
  onDone: () => void
}) {
  const sel = React.useContext(SelectionContext)
  const router = useRouter()
  const [pending, setPending] = React.useState<Pending | null>(null)
  const [busy, startTransition] = React.useTransition()

  if (!sel) return null
  const chosen = visibleRows.filter((r) => sel.selected.has(r.meeting_id))
  const n = chosen.length
  const plural = (k: number) => `${k} meeting${k === 1 ? "" : "s"}`

  function apply(p: Pending) {
    const req: BulkProfileStageRequest = { mode: "set", stage: p.stage }
    startTransition(async () => {
      const res = await bulkUpdateProfileStage(
        chosen.map((r) => r.meeting_id),
        req,
      )
      setPending(null)
      if (!res.ok) {
        toast.error("Couldn't update profile stages", { description: res.error })
        return
      }
      const { updated, skipped } = res.data
      toast.success(`Updated ${plural(updated)}${skipped ? ` · skipped ${skipped}` : ""}`, {
        description: skipped
          ? "Skipped meetings are synced from Dynamics (read-only until cutover), not editable by you, or had nothing to change."
          : undefined,
      })
      onDone()
      router.refresh()
    })
  }

  return (
    <div className="mb-3 flex min-h-9 flex-wrap items-center gap-2">
      <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[#9AA1AD]">
        <SelectAllBox ids={visibleRows.map((r) => r.meeting_id)} label="Select all visible meetings" />
        Select all visible
      </label>

      {n > 0 && (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md bg-card px-2 py-1"
          style={{ border: "0.5px solid var(--border)" }}
        >
          <span className="text-[13px] font-semibold tabular-nums text-[#1E2858] dark:text-white">
            {n} selected
          </span>

          {pending ? (
            <>
              <span className="text-[13px]">
                {`Set ${plural(n)} to ${pending.stage}?`}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => apply(pending)}
                className="h-8 cursor-pointer rounded-md bg-[#1E2858] px-2.5 text-[12px] font-medium text-white transition-colors hover:bg-[#0355A7] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? "Applying…" : "Confirm"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending(null)}
                className="h-8 cursor-pointer rounded-md px-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <select
                aria-label="Set stage to"
                value=""
                onChange={(e) => {
                  if (e.target.value) setPending({ kind: "set", stage: e.target.value })
                }}
                className="h-8 rounded-md border border-input bg-background px-2.5 text-[13px]"
              >
                <option value="">Set stage to…</option>
                {PROFILE_ADVANCE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onDone}
                className="h-8 cursor-pointer rounded-md px-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
