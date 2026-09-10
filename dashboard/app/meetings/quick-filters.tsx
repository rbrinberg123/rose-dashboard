"use client"

/**
 * The toolbar's Client / Host / Feedback dropdowns.
 *
 * All three narrow the query SERVER-SIDE: changing one pushes a URL param and
 * re-runs the page's query, exactly as switching views does. Nothing here
 * filters rows in the browser, so the count, the table and the Excel export all
 * see the same set.
 *
 * Client gets a typeahead because there are ~189 of them; Host and Feedback are
 * ~26 each, which a native <select> handles better than a custom popover — it
 * gets keyboard behaviour, mobile pickers and screen-reader support for free.
 * Two controls rather than one is a deliberate choice about list size, not an
 * inconsistency.
 *
 * ── THE OPTIONS LOAD OFF THE CRITICAL PATH ─────────────────────────────────
 * This component fetches its own choices AFTER the table has rendered, rather
 * than the page waiting for them. Sourcing them can be slow — when
 * v_admin_meetings_filter_options is missing the loader falls back to scanning
 * every row, ~4.6 s — and none of that should stand between the user and a table
 * whose rows were ready in a quarter of a second.
 *
 * Fetched once per browser session (module-level cache below), not once per
 * render or per navigation: switching views or applying a filter re-renders this
 * component, and the list of clients has not changed.
 *
 * Native <select> cannot be populated at the moment it opens, so this runs on
 * mount rather than on first click. Until it lands the controls are disabled and
 * say so, which is honest about the one thing that is briefly unavailable.
 */

import * as React from "react"
import { Search, X } from "lucide-react"

import { Input } from "@/components/ui/input"
import type { FilterOption, FilterOptions } from "@/lib/meetings/query"
import { cn } from "@/lib/utils"
import { loadMeetingFilterOptions } from "./actions"

const EMPTY: FilterOptions = { clients: [], hosts: [], feedback: [] }

/**
 * Session cache for the dropdown choices.
 *
 * Module scope, so it survives the re-renders and remounts that every view
 * switch and filter change causes — the alternative is re-running a possibly
 * multi-second query each time someone picks a host. `inFlight` collapses
 * concurrent callers onto one request. Both reset on a full page load, which is
 * the right staleness window for a list that changes when the CRM gains a
 * client.
 */
let cachedOptions: FilterOptions | null = null
let inFlight: Promise<FilterOptions> | null = null

function fetchOptionsOnce(): Promise<FilterOptions> {
  if (cachedOptions) return Promise.resolve(cachedOptions)
  if (inFlight) return inFlight
  inFlight = loadMeetingFilterOptions()
    .then((res) => {
      const next = res.ok ? res.data : EMPTY
      cachedOptions = next
      return next
    })
    .catch(() => EMPTY)
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

const CONTROL =
  "h-9 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-60"

export type QuickFilterValues = {
  client?: string
  host?: string
  feedback?: string
}

export function QuickFilterControls({
  values,
  onChange,
  disabled,
}: {
  values: QuickFilterValues
  /** Hands back the FULL next set, so the caller pushes one URL. */
  onChange: (next: QuickFilterValues) => void
  disabled?: boolean
}) {
  // Starts from the cache so a second mount in the same session paints the real
  // lists immediately rather than flashing "Loading…".
  const [options, setOptions] = React.useState<FilterOptions>(cachedOptions ?? EMPTY)
  const [loading, setLoading] = React.useState(cachedOptions === null)

  // The effect only kicks off the request; every setState is in a callback, not
  // in the effect body. `cancelled` drops a late response after unmount.
  React.useEffect(() => {
    if (cachedOptions) return
    let cancelled = false
    fetchOptionsOnce().then((next) => {
      if (cancelled) return
      setOptions(next)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const set = React.useCallback(
    (patch: QuickFilterValues) => onChange({ ...values, ...patch }),
    [onChange, values],
  )

  return (
    <>
      <ClientCombo
        options={options.clients}
        value={values.client}
        onChange={(client) => set({ client })}
        disabled={disabled}
        loading={loading}
      />
      <PlainSelect
        id="mtg-host"
        label="Host"
        allLabel="All hosts"
        options={options.hosts}
        value={values.host}
        onChange={(host) => set({ host })}
        disabled={disabled}
        loading={loading}
      />
      <PlainSelect
        id="mtg-fb"
        label="Feedback"
        allLabel="All feedback reps"
        options={options.feedback}
        value={values.feedback}
        onChange={(feedback) => set({ feedback })}
        disabled={disabled}
        loading={loading}
      />
    </>
  )
}

/** Host / Feedback: a native select, with "All …" as the clear option. */
function PlainSelect({
  id,
  label,
  allLabel,
  options,
  value,
  onChange,
  disabled,
  loading,
}: {
  id: string
  label: string
  allLabel: string
  options: FilterOption[]
  value?: string
  onChange: (next: string | undefined) => void
  disabled?: boolean
  loading?: boolean
}) {
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled || loading || options.length === 0}
        onChange={(e) => onChange(e.target.value || undefined)}
        title={label}
        className={cn(CONTROL, "max-w-[170px]")}
      >
        {/* A URL can carry a filter whose option list has not arrived yet, so the
            selected value must still have something to sit on — otherwise the
            control silently snaps to "All". */}
        {loading && value && <option value={value}>{label}: applied</option>}
        <option value="">{loading ? `${label} — loading…` : allLabel}</option>
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
 * Client: a typeahead over ~189 options.
 *
 * Built on a plain input + listbox rather than a native select because a native
 * one cannot be searched. What it must not lose by being custom: Escape closes,
 * arrows move, Enter picks, blur closes, and the whole thing is labelled and
 * announced — hence the explicit roles and aria wiring below.
 */
function ClientCombo({
  options,
  value,
  onChange,
  disabled,
  loading,
}: {
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
    // Capped: the list is a picker, not a report, and 189 mounted rows in a
    // popover is wasted DOM. Typing narrows to what you want long before this.
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
      <label htmlFor="mtg-client" className="sr-only">
        Client
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="mtg-client"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled || loading || options.length === 0}
          // Shows the SELECTED client when closed and the search text while
          // typing, so the control always says what it is currently doing.
          // Before the options land there is no label to show for a client that
          // came in on the URL, so say "applied" rather than showing a blank box
          // that reads as "no filter".
          value={open ? query : (selected?.label ?? (loading && value ? "Client applied" : ""))}
          placeholder={
            loading ? "Clients — loading…" : options.length === 0 ? "Clients unavailable" : "All clients"
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
          className="h-9 w-[190px] pl-8 pr-7"
        />
        {selected && !open && (
          <button
            type="button"
            onClick={() => commit(undefined)}
            aria-label="Clear client filter"
            title="Clear client filter"
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
          aria-label="Client"
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
              All clients
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
                // Keeps focus in the input so blur does not close the list
                // before the click registers.
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
