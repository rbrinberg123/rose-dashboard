"use client"

/**
 * "Edit filters" — build `field · operator · value` conditions, combined with AND.
 *
 * SHARED by every CRM table. Each entity's built-in presets are expressed as
 * exactly these conditions, so there is one filter mechanism per entity rather
 * than a preset path plus a filter path.
 *
 * Conditions APPLY SERVER-SIDE. Nothing here filters rows in the browser —
 * pressing Apply re-runs the query (lib/meetings/query.ts). The operator list
 * per field comes from the field's type in the column catalog, so a toggle
 * offers Yes/No and a date offers before/on-or-after.
 */

import * as React from "react"
import { Plus, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  OP_LABELS,
  TODAY_TOKEN,
  VALUELESS_OPS,
  type ColumnDef,
  type FilterCondition,
  type FilterOp,
} from "@/lib/table-views/types"

const SELECT_CLASS = "h-8 rounded-md border border-input bg-background px-2 text-xs"

export function FilterEditor({
  filters,
  onApply,
  onClose,
  available,
  catalog,
  getColumn,
  opsForField,
}: {
  filters: FilterCondition[]
  /** Every column this entity knows. */
  catalog: ColumnDef[]
  getColumn: (key: string) => ColumnDef | undefined
  /** Operators valid for a field, per the entity's catalog. */
  opsForField: (field: string) => FilterOp[]
  onApply: (next: FilterCondition[]) => void
  onClose: () => void
  /** Columns the deployed view actually has — see the ColumnEditor's note. */
  available: Set<string> | null
}) {
  const [draft, setDraft] = React.useState<FilterCondition[]>(filters)

  // A column the deployed view does not have cannot be filtered on either, so it
  // is left out of the field list rather than offered and then quietly skipped.
  const fields = React.useMemo(
    () => catalog.filter((c) => available === null || available.has(c.key)),
    [available, catalog],
  )

  const add = React.useCallback(() => {
    const first = fields[0]
    if (!first) return
    setDraft((cur) => [...cur, { field: first.key, op: opsForField(first.key)[0], value: "" }])
  }, [fields, opsForField])

  const update = React.useCallback((i: number, patch: Partial<FilterCondition>) => {
    setDraft((cur) =>
      cur.map((c, j) => {
        if (j !== i) return c
        const next = { ...c, ...patch }
        // Changing the FIELD can invalidate the operator (a date's "is on or
        // after" means nothing on a toggle), so snap to the new type's first
        // operator whenever the current one is no longer offered.
        if (patch.field && !opsForField(next.field).includes(next.op)) {
          next.op = opsForField(next.field)[0]
        }
        return next
      }),
    )
  }, [opsForField])

  const remove = React.useCallback((i: number) => {
    setDraft((cur) => cur.filter((_, j) => j !== i))
  }, [])

  /** A value-carrying condition with an empty value would be rejected server-side. */
  const incomplete = draft.some(
    (c) => !VALUELESS_OPS.has(c.op) && !(c.value ?? "").trim(),
  )

  return (
    <div className="w-[620px] max-w-[92vw] rounded-lg border bg-card p-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Edit filters</div>
          <div className="text-xs text-muted-foreground">
            All conditions must match (AND). Applied in the database, not the browser.
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

      <div className="max-h-[380px] space-y-2 overflow-y-auto">
        {draft.length === 0 && (
          <div className="py-2 text-[13px] text-muted-foreground">
            No conditions — the view shows every meeting.
          </div>
        )}

        {draft.map((c, i) => {
          const col = getColumn(c.field)
          const ops = opsForField(c.field)
          const valueless = VALUELESS_OPS.has(c.op)
          const isDate = col?.type === "date"
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] text-muted-foreground">
                {i === 0 ? "Where" : "and"}
              </span>

              <select
                value={c.field}
                onChange={(e) => update(i, { field: e.target.value })}
                aria-label="Field"
                className={`${SELECT_CLASS} min-w-0 flex-1`}
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.section} · {f.label}
                  </option>
                ))}
              </select>

              <select
                value={c.op}
                onChange={(e) => update(i, { op: e.target.value as FilterOp })}
                aria-label="Operator"
                className={`${SELECT_CLASS} w-[120px] shrink-0`}
              >
                {ops.map((op) => (
                  <option key={op} value={op}>
                    {OP_LABELS[op]}
                  </option>
                ))}
              </select>

              {valueless ? (
                <span className="w-[150px] shrink-0" />
              ) : (
                <Input
                  // A date condition gets a real date picker; `$today` still
                  // works as a typed value for a rolling view, which is what the
                  // built-in "Upcoming" uses.
                  type={isDate && c.value !== TODAY_TOKEN ? "date" : "text"}
                  value={c.value ?? ""}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={isDate ? TODAY_TOKEN : "value"}
                  aria-label="Value"
                  className="h-8 w-[150px] shrink-0 text-xs"
                />
              )}

              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove condition"
                className="shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          className="cursor-pointer"
        >
          <Plus /> Add condition
        </Button>
        <div className="flex items-center gap-2">
          {incomplete && (
            <span className="text-[11px] text-muted-foreground">Every condition needs a value</span>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className="cursor-pointer">
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={incomplete}
            onClick={() => onApply(draft)}
            className="cursor-pointer"
          >
            Apply
          </Button>
        </div>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        Dates are Eastern calendar days. <code>{TODAY_TOKEN}</code> means “today, whenever the view
        is opened” — that is how the built-in Upcoming view stays rolling.
      </div>
    </div>
  )
}
