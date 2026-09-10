"use client"

/**
 * The toolbar's quick-filter dropdowns — SHARED by every CRM table.
 *
 * Each entity declares which filters it wants (Meetings: Client / Host /
 * Feedback; Events: Client / Event State / Account Manager) and supplies a
 * loader; everything else — the typeahead, the loading states, the session cache
 * — is here.
 *
 * All of them narrow the query SERVER-SIDE: changing one pushes a URL param and
 * re-runs the page's query, exactly as switching views does. Nothing here
 * filters rows in the browser, so the count, the table and the Excel export all
 * see the same set.
 *
 * ── THE OPTIONS LOAD OFF THE CRITICAL PATH ─────────────────────────────────
 * The choices are fetched AFTER the table renders, not by the page loader.
 * Sourcing them can be slow, and none of it should stand between the user and a
 * table whose rows were ready in a quarter of a second. Fetched once per browser
 * session (the cache below), not once per render or per navigation.
 *
 * A native <select> cannot be populated at the moment it opens, so the fetch
 * runs on mount rather than on first click. Until it lands the controls are
 * disabled and say so.
 */

import * as React from "react"
import { Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import type { FilterOption } from "@/lib/table-views/query"
import { cn } from "@/lib/utils"

const CONTROL =
  "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"

/** One dropdown's declaration. `searchable` gives a typeahead instead of a select. */
export type QuickFilterDef = {
  /** The URL param and the values-map key. */
  key: string
  label: string
  allLabel: string
  /** Long lists (100+) need a typeahead; short ones are better as a native select. */
  searchable?: boolean
  width?: string
}

export type QuickFilterValues = Record<string, string | undefined>

/** Option lists keyed by filter key. */
export type QuickFilterOptions = Record<string, FilterOption[]>

/**
 * Session cache, keyed by entity.
 *
 * Module scope, so it survives the re-renders and remounts every view switch and
 * filter change causes. `inFlight` collapses concurrent callers onto one
 * request. Both reset on a full page load, which is the right staleness window
 * for a list that changes when the CRM gains a client.
 */
const cache = new Map<string, QuickFilterOptions>()
const inFlight = new Map<string, Promise<QuickFilterOptions>>()

function fetchOnce(
  cacheKey: string,
  load: () => Promise<QuickFilterOptions>,
): Promise<QuickFilterOptions> {
  const hit = cache.get(cacheKey)
  if (hit) return Promise.resolve(hit)
  const running = inFlight.get(cacheKey)
  if (running) return running
  const p = load()
    .then((next) => {
      cache.set(cacheKey, next)
      return next
    })
    .catch(() => ({}) as QuickFilterOptions)
    .finally(() => inFlight.delete(cacheKey))
  inFlight.set(cacheKey, p)
  return p
}

export function QuickFilterBar({
  cacheKey,
  filters,
  values,
  onChange,
  loadOptions,
  disabled,
}: {
  /** Distinguishes one entity's cached options from another's. */
  cacheKey: string
  filters: QuickFilterDef[]
  values: QuickFilterValues
  /** Hands back the FULL next set, so the caller pushes one URL. */
  onChange: (next: QuickFilterValues) => void
  loadOptions: () => Promise<QuickFilterOptions>
  disabled?: boolean
}) {
  // Starts from the cache so a second mount in the same session paints the real
  // lists immediately rather than flashing "Loading…".
  const [options, setOptions] = React.useState<QuickFilterOptions>(cache.get(cacheKey) ?? {})
  const [loading, setLoading] = React.useState(!cache.has(cacheKey))

  // The effect only kicks off the request; every setState is in a callback, not
  // in the effect body. `cancelled` drops a late response after unmount.
  React.useEffect(() => {
    if (cache.has(cacheKey)) return
    let cancelled = false
    fetchOnce(cacheKey, loadOptions).then((next) => {
      if (cancelled) return
      setOptions(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [cacheKey, loadOptions])

  const set = React.useCallback(
    (key: string, next: string | undefined) => onChange({ ...values, [key]: next }),
    [onChange, values],
  )

  return (
    <>
      {filters.map((f) =>
        f.searchable ? (
          <SearchableSelect
            key={f.key}
            def={f}
            options={options[f.key] ?? []}
            value={values[f.key]}
            onChange={(next) => set(f.key, next)}
            disabled={disabled}
            loading={loading}
          />
        ) : (
          <PlainSelect
            key={f.key}
            def={f}
            options={options[f.key] ?? []}
            value={values[f.key]}
            onChange={(next) => set(f.key, next)}
            disabled={disabled}
            loading={loading}
          />
        ),
      )}
    </>
  )
}

/** A native select, with "All …" as the clear option. */
function PlainSelect({
  def,
  options,
  value,
  onChange,
  disabled,
  loading,
}: {
  def: QuickFilterDef
  options: FilterOption[]
  value?: string
  onChange: (next: string | undefined) => void
  disabled?: boolean
  loading?: boolean
}) {
  const id = `qf-${def.key}`
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {def.label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled || loading || options.length === 0}
        onChange={(e) => onChange(e.target.value || undefined)}
        title={def.label}
        className={cn(CONTROL, "max-w-[180px]")}
      >
        {/* A URL can carry a filter whose option list has not arrived yet, so the
            selected value must still have something to sit on — otherwise the
            control silently snaps to "All". */}
        {loading && value && <option value={value}>{def.label}: applied</option>}
        <option value="">{loading ? `${def.label} — loading…` : def.allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count.toLocaleString()})
          </option>
        ))}
      </select>
    </>
  )
}

/**
 * A typeahead, for lists too long to scroll (Client is ~189).
 *
 * A plain input + listbox rather than a native select because a native one
 * cannot be searched. What it must not lose by being custom: Escape closes,
 * arrows move, Enter picks, blur closes, and the whole thing is labelled and
 * announced — hence the explicit roles and aria wiring.
 */
function SearchableSelect({
  def,
  options,
  value,
  onChange,
  disabled,
  loading,
}: {
  def: QuickFilterDef
  options: FilterOption[]
  value?: string
  onChange: (next: string | undefined) => void
  disabled?: boolean
  loading?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")
  const [active, setActive] = React.useState(0)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const listId = React.useId()
  const id = `qf-${def.key}`

  const selected = React.useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  )

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    // Every term must appear, so "fid man" finds "Fidelity Management".
    const terms = q ? q.split(/\s+/) : []
    const hits = terms.length
      ? options.filter((o) => terms.every((t) => o.label.toLowerCase().includes(t)))
      : options
    // Capped: the list is a picker, not a report, and hundreds of mounted rows in
    // a popover is wasted DOM. Typing narrows long before this.
    return hits.slice(0, 50)
  }, [options, query])

  // Close on an outside click. Pointerdown rather than click so the popover is
  // gone before a click on something behind it lands.
  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [open])

  const commit = React.useCallback(
    (next: string | undefined) => {
      onChange(next)
      setOpen(false)
      setQuery("")
    },
    [onChange],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false)
      return
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      if (!open) setOpen(true)
      setActive((i) => {
        const n = matches.length
        if (n === 0) return 0
        return e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n
      })
      return
    }
    if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault()
      commit(matches[active].value)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="sr-only">
        {def.label}
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled || loading || options.length === 0}
          // Shows the SELECTED option when closed and the search text while
          // typing, so the control always says what it is currently doing.
          // Before the options land there is no label for a value that came in on
          // the URL, so say "applied" rather than showing a blank box that reads
          // as "no filter".
          value={open ? query : (selected?.label ?? (loading && value ? `${def.label} applied` : ""))}
          placeholder={
            loading
              ? `${def.label} — loading…`
              : options.length === 0
                ? `${def.label} unavailable`
                : def.allLabel
          }
          onFocus={() => {
            setOpen(true)
            setActive(0)
          }}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="h-9 pl-8 pr-7"
          style={{ width: def.width ?? "190px" }}
        />
        {selected && !open && (
          <button
            type="button"
            onClick={() => commit(undefined)}
            aria-label={`Clear ${def.label} filter`}
            title={`Clear ${def.label} filter`}
            className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={def.label}
          className="absolute z-50 mt-1 max-h-[280px] w-[260px] overflow-y-auto rounded-md border bg-card p-1 shadow-lg"
        >
          {/* The clear option, always first and never filtered away. */}
          <li>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(undefined)}
              className={cn(
                "flex w-full cursor-pointer items-center rounded px-2 py-1 text-left text-[13px] hover:bg-muted/60",
                !value && "font-medium",
              )}
            >
              {def.allLabel}
            </button>
          </li>
          {matches.length === 0 && (
            <li className="px-2 py-1.5 text-[13px] text-muted-foreground">No match.</li>
          )}
          {matches.map((o, i) => (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                // Keeps focus in the input so blur does not close the list before
                // the click registers.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(o.value)}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-left text-[13px] hover:bg-muted/60",
                  i === active && "bg-muted/60",
                  o.value === value && "font-medium",
                )}
              >
                <span className="truncate" title={o.label}>
                  {o.label}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {o.count.toLocaleString()}
                </span>
              </button>
            </li>
          ))}
          {matches.length === 50 && (
            <li className="px-2 py-1 text-[11px] text-muted-foreground">
              Showing first 50 — keep typing to narrow.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
