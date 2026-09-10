"use client"

/**
 * "Edit columns" — pick which catalog columns the table shows, and in what order.
 *
 * SHARED by every CRM table (Meetings, Events, …). The catalog arrives as a
 * prop, and each entity derives its own from the record drawer's field
 * definitions — so a panel always offers exactly the fields that entity's drawer
 * shows, and never a second list that could drift.
 *
 * Reordering is plain HTML5 drag-and-drop — no dependency, and it degrades to
 * the ▲/▼ buttons for anyone who cannot drag (keyboard, touch, screen reader).
 * The buttons are not a fallback afterthought: they are the accessible path.
 */

import * as React from "react"
import { GripVertical, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ColumnDef } from "@/lib/table-views/types"
import { cn } from "@/lib/utils"

export function ColumnEditor({
  columns,
  onApply,
  onClose,
  available,
  sections,
  getColumn,
}: {
  /** The active view's ordered column keys. */
  columns: string[]
  /** The entity's catalog, grouped for display. */
  sections: { section: string; columns: ColumnDef[] }[]
  getColumn: (key: string) => ColumnDef | undefined
  onApply: (next: string[]) => void
  onClose: () => void
  /**
   * Columns the deployed view actually has, probed server-side. Anything absent
   * is offered disabled with the reason, rather than silently missing — the
   * catalog is bigger than the view until the SQL patches are run. null = could
   * not tell, so nothing is disabled.
   */
  available: Set<string> | null
}) {
  const [draft, setDraft] = React.useState<string[]>(columns)
  const [dragKey, setDragKey] = React.useState<string | null>(null)

  const selected = new Set(draft)

  const toggle = React.useCallback((key: string) => {
    setDraft((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
  }, [])

  /** Move `key` by `delta` places, clamped. Used by the ▲/▼ buttons. */
  const move = React.useCallback((key: string, delta: number) => {
    setDraft((cur) => {
      const i = cur.indexOf(key)
      const j = i + delta
      if (i < 0 || j < 0 || j >= cur.length) return cur
      const next = [...cur]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }, [])

  /** Drop `dragKey` onto the slot currently held by `overKey`. */
  const dropOn = React.useCallback(
    (overKey: string) => {
      setDraft((cur) => {
        if (!dragKey || dragKey === overKey) return cur
        const from = cur.indexOf(dragKey)
        const to = cur.indexOf(overKey)
        if (from < 0 || to < 0) return cur
        const next = [...cur]
        next.splice(from, 1)
        next.splice(to, 0, dragKey)
        return next
      })
      setDragKey(null)
    },
    [dragKey],
  )

  return (
    <div className="w-[560px] max-w-[92vw] rounded-lg border bg-card p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Edit columns</div>
          <div className="text-xs text-muted-foreground">
            Same fields the record drawer shows. Drag to reorder, or use ▲ ▼.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* LEFT: the catalog, grouped exactly as the drawer's sections are. */}
        <div className="max-h-[420px] overflow-y-auto pr-1">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Available
          </div>
          {sections.map((s) => (
            <div key={s.section} className="mb-2">
              <div className="py-1 text-[11px] font-medium text-muted-foreground">{s.section}</div>
              {s.columns.map((c) => {
                // A column the deployed view does not have cannot be queried,
                // so it is disabled with the reason rather than silently absent.
                const unavailable = available !== null && !available.has(c.key)
                return (
                  <label
                    key={c.key}
                    title={
                      unavailable
                        ? `${c.label} — not in the database view yet; run the view-columns SQL patch`
                        : c.label
                    }
                    className={cn(
                      "flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-muted/50",
                      unavailable && "cursor-not-allowed opacity-40 hover:bg-transparent",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.key)}
                      disabled={unavailable}
                      onChange={() => toggle(c.key)}
                      className="cursor-pointer"
                    />
                    <span className="truncate">{c.label}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>

        {/* RIGHT: the chosen columns, in render order. */}
        <div className="max-h-[420px] overflow-y-auto pr-1">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Shown · in order ({draft.length})
          </div>
          {draft.length === 0 && (
            <div className="px-1 py-2 text-[13px] text-muted-foreground">
              Nothing selected — pick at least one column.
            </div>
          )}
          {draft.map((key, i) => {
            const col = getColumn(key)
            return (
              <div
                key={key}
                draggable
                onDragStart={() => setDragKey(key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropOn(key)}
                onDragEnd={() => setDragKey(null)}
                className={cn(
                  "mb-0.5 flex items-center gap-1 rounded border bg-background px-1 py-0.5 text-[13px]",
                  dragKey === key && "opacity-50",
                )}
              >
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-muted-foreground" />
                <span className="flex-1 truncate" title={col?.label ?? key}>
                  {col?.label ?? key}
                </span>
                <button
                  type="button"
                  onClick={() => move(key, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${col?.label ?? key} up`}
                  className="cursor-pointer px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ▲
                </button>
                <button
                  type="button"
                  onClick={() => move(key, 1)}
                  disabled={i === draft.length - 1}
                  aria-label={`Move ${col?.label ?? key} down`}
                  className="cursor-pointer px-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  ▼
                </button>
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-label={`Remove ${col?.label ?? key}`}
                  className="cursor-pointer px-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} className="cursor-pointer">
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={draft.length === 0}
          onClick={() => onApply(draft)}
          className="cursor-pointer"
        >
          Apply
        </Button>
      </div>
    </div>
  )
}
