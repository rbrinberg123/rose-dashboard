"use client"

import * as React from "react"
import { ArrowUp, Check, ChevronsUpDown, Search, Star } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { Candidate, HostPick } from "@/lib/host-suggestion"

// Small free / busy pill.
export function FreeBusyPill({ free }: { free: boolean }) {
  return free ? (
    <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
      free
    </span>
  ) : (
    <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
      busy
    </span>
  )
}

// The Host cell for an unassigned meeting. Collapsed, it shows the smart default
// (top free candidate) — name + free/busy pill + rationale + the amber bump
// note. The name is a dropdown: top-5 ranked candidates (free-first, ★ on the
// default, ✓ on the selection) plus "Search all hosts…" over the full roster.
// The "Assign {name}" button reflects the current selection (placeholder — no
// CRM write-back). Shared verbatim by the Pipeline and Scheduler pages.
export function HostSelectCell({
  pick,
  selectedId,
  roster,
  isHostFree,
  onSelect,
  variant = "stacked",
}: {
  pick: HostPick | undefined
  selectedId: string | null
  roster: { id: string; name: string }[]
  isHostFree: (hostId: string) => boolean
  onSelect: (hostId: string) => void
  // "stacked" (default, Pipeline): full-width dropdown, rationale/bump/Assign on
  // their own lines. "inline" (Scheduler Day view): content-width dropdown with
  // Assign on the same line and a single consolidated rationale·bump line below.
  variant?: "stacked" | "inline"
}) {
  const inline = variant === "inline"
  const [open, setOpen] = React.useState(false)
  const [searchMode, setSearchMode] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const candidates = React.useMemo(() => pick?.candidates ?? [], [pick])
  const candidateById = React.useMemo(() => {
    const m = new Map<string, Candidate>()
    for (const c of candidates) m.set(c.id, c)
    return m
  }, [candidates])
  const rosterNameById = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const h of roster) m.set(h.id, h.name)
    return m
  }, [roster])

  // Resolve the selected host's display info — from the candidate pool when it
  // has history, otherwise from the roster (no rationale; live availability).
  const selected: Candidate | null = selectedId
    ? candidateById.get(selectedId) ?? {
        id: selectedId,
        name: rosterNameById.get(selectedId) ?? "—",
        instCount: 0,
        clientCount: 0,
        l12m: 0,
        free: isHostFree(selectedId),
        rationale: null,
      }
    : null

  const top5 = candidates.slice(0, 5)

  const reset = () => {
    setSearchMode(false)
    setQuery("")
  }
  const pickHost = (id: string) => {
    onSelect(id)
    setOpen(false)
    reset()
  }

  const q = query.trim().toLowerCase()
  const filteredRoster = q
    ? roster.filter((h) => h.name.toLowerCase().includes(q))
    : roster

  return (
    <div className={cn("flex flex-col", inline ? "gap-1" : "gap-1.5")}>
      <div className={inline ? "flex items-center gap-2" : "contents"}>
        <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) reset()
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label="Select host"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-left text-sm hover:bg-slate-50",
                inline ? "max-w-[200px]" : "max-w-full",
              )}
            />
          }
        >
          {selected ? (
            <>
              <span className="truncate font-medium">{selected.name}</span>
              <FreeBusyPill free={selected.free} />
            </>
          ) : (
            <span className="truncate italic text-muted-foreground">
              No prior host — assign manually.
            </span>
          )}
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>

        <PopoverContent align="start" className="w-80 p-1.5">
          {!searchMode ? (
            <>
              {top5.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No suggested hosts — search all hosts.
                </p>
              ) : (
                <ul className="grid">
                  {top5.map((c, idx) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => pickHost(c.id)}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                          selectedId === c.id && "bg-muted",
                        )}
                      >
                        <span className="min-w-0">
                          <span className="flex items-center gap-1">
                            {idx === 0 && (
                              <Star
                                className="size-3 shrink-0 fill-amber-400 text-amber-400"
                                aria-label="Smart default"
                              />
                            )}
                            <span className="truncate text-sm font-medium">{c.name}</span>
                          </span>
                          {c.rationale && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {c.rationale}
                            </span>
                          )}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <FreeBusyPill free={c.free} />
                          {selectedId === c.id && <Check className="size-4" />}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => setSearchMode(true)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
              >
                <Search className="size-3.5 shrink-0" />
                Search all hosts…
              </button>
            </>
          ) : (
            <>
              <div className="relative mb-1.5">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name"
                  className="pl-8"
                  autoFocus
                />
              </div>
              <div className="max-h-72 overflow-y-auto">
                {filteredRoster.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                    No matches
                  </p>
                ) : (
                  <ul className="grid">
                    {filteredRoster.map((h) => {
                      const cand = candidateById.get(h.id)
                      const free = cand ? cand.free : isHostFree(h.id)
                      return (
                        <li key={h.id}>
                          <button
                            type="button"
                            onClick={() => pickHost(h.id)}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted",
                              selectedId === h.id && "bg-muted",
                            )}
                          >
                            <span className="min-w-0">
                              <span className="truncate text-sm">{h.name}</span>
                              {cand?.rationale && (
                                <span className="block truncate text-xs text-muted-foreground">
                                  {cand.rationale}
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-1.5">
                              <FreeBusyPill free={free} />
                              {selectedId === h.id && <Check className="size-4" />}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </>
          )}
        </PopoverContent>
        </Popover>

        {/* Inline (Scheduler): compact navy Assign on the same row as the
            dropdown. Placeholder only — read-only against the mirrored CRM. */}
        {inline && (
          <button
            type="button"
            className="shrink-0 rounded-md bg-[#1E2858] px-2 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            Assign
          </button>
        )}
      </div>

      {inline ? (
        // Consolidated rationale · bump on one line; bump portion in amber.
        (selected?.rationale || pick?.bumpNote) && (
          <div
            className="truncate text-xs text-muted-foreground"
            title={[
              selected?.rationale ?? undefined,
              pick?.bumpNote ? `↑ ${pick.bumpNote}` : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {selected?.rationale}
            {selected?.rationale && pick?.bumpNote ? " · " : null}
            {pick?.bumpNote && (
              <span style={{ color: "#854F0B" }}>
                <ArrowUp className="mb-0.5 inline size-3" /> {pick.bumpNote}
              </span>
            )}
          </div>
        )
      ) : (
        <>
          {selected?.rationale && (
            <div className="text-xs text-muted-foreground">{selected.rationale}</div>
          )}
          {pick?.bumpNote && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-amber-600">
              <ArrowUp className="size-3 shrink-0" />
              {pick.bumpNote}
            </div>
          )}
        </>
      )}

      {/* Stacked (Pipeline): full-label Assign on its own line below. Placeholder
          only — read-only against the mirrored CRM. */}
      {!inline && (
        <button
          type="button"
          className="w-fit rounded-md border border-border bg-card px-2 py-0.5 text-xs font-medium text-foreground hover:bg-slate-50"
        >
          {selected ? `Assign ${selected.name}` : "Assign host"}
        </button>
      )}
    </div>
  )
}
