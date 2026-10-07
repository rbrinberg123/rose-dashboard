"use client"

/**
 * COMPANY REPRESENTATIVES on the event form — ONE compact typeahead field.
 *
 * Added reps render as small inline chips (name + ×) that wrap horizontally,
 * with the search input sitting in the same box, so the section is a single
 * input-height row until it holds many people. Results open in a dropdown
 * UNDER the field (Base UI Combobox, portalled — so it never stretches or
 * scrolls the form). Backspace in an empty field removes the last chip.
 *
 * Contacts come from the Contacts CRM table (loadEventContactOptions): by
 * default the event CLIENT's own contacts, searched by name; the small "All
 * contacts" toggle widens it to every active contact (name or company).
 * Nothing is saved here — the list rides on the form and createEvent /
 * updateEvent write it to event_contacts (sql/patches/2026-10-07g),
 * server-side gated and audited.
 */

import * as React from "react"
import { Combobox } from "@base-ui/react/combobox"
import { Search, X } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
import type { EventRepresentative } from "@/lib/events/create"
import { cn } from "@/lib/utils"
import { loadEventContactOptions, type EventContactOption } from "./actions"

function toRep(c: EventContactOption): EventRepresentative {
  const detail = [c.job_title, c.parent_customer_name].map((s) => (s ?? "").trim()).filter(Boolean).join(" · ")
  return { contactId: c.contact_id, name: c.full_name ?? "(no name)", detail: detail || null }
}

export function RepresentativesPicker({
  clientAccountId,
  value,
  onChange,
}: {
  clientAccountId: string | null
  value: EventRepresentative[]
  onChange: (next: EventRepresentative[]) => void
}) {
  const [all, setAll] = React.useState(false)
  const [loaded, setLoaded] = React.useState<{ key: string; items: EventRepresentative[] } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const anchorRef = React.useRef<HTMLDivElement>(null)
  const key = all ? "all" : (clientAccountId ?? "")

  // Load the candidate contacts for the current scope (client / all).
  React.useEffect(() => {
    if (loaded?.key === key || (!all && !clientAccountId)) return
    let live = true
    loadEventContactOptions({ clientAccountId, all }).then((r) => {
      if (!live) return
      if (r.ok) {
        setLoaded({ key, items: (r.data ?? []).map(toRep) })
        setError(null)
      } else setError(r.error)
    })
    return () => {
      live = false
    }
  }, [key, all, clientAccountId, loaded?.key])

  const ready = loaded?.key === key
  // Items = the scope's contacts, plus anything already chosen (so chips for
  // reps from another client still resolve).
  const items = React.useMemo(() => {
    const base = ready ? loaded!.items : []
    const ids = new Set(base.map((i) => i.contactId))
    return [...base, ...value.filter((v) => !ids.has(v.contactId))]
  }, [ready, loaded, value])

  const emptyText = error
    ? error
    : !all && !clientAccountId
      ? "Pick the client first — or tick All contacts."
      : !ready
        ? "Loading contacts…"
        : all
          ? "No matching contacts."
          : "No matching contacts at this client — try All contacts."

  return (
    <div className="flex items-start gap-3">
      <Combobox.Root
        multiple
        items={items}
        value={value}
        onValueChange={(next) => onChange(next as EventRepresentative[])}
        itemToStringLabel={(r: EventRepresentative) => r.name}
        itemToStringValue={(r: EventRepresentative) => r.contactId}
        isItemEqualToValue={(a: EventRepresentative, b: EventRepresentative) => a.contactId === b.contactId}
        filter={(r: EventRepresentative, query: string) => {
          const q = query.trim().toLowerCase()
          if (!q) return true
          return r.name.toLowerCase().includes(q) || (all && (r.detail ?? "").toLowerCase().includes(q))
        }}
        limit={100}
      >
        <Combobox.Chips
          ref={anchorRef}
          className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-lg border border-input bg-transparent px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
        >
          <Search className="mx-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <Combobox.Value>
            {(selected: EventRepresentative[]) => (
              <>
                {selected.map((r) => (
                  <Combobox.Chip
                    key={r.contactId}
                    title={r.detail ? `${r.name} — ${r.detail}` : r.name}
                    className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-full bg-[#EEF2FB] pl-2 pr-1 text-[12px] font-medium text-[#2D4A8A] outline-none data-[highlighted]:ring-2 data-[highlighted]:ring-ring/50"
                  >
                    <span className="truncate">{r.name}</span>
                    <Combobox.ChipRemove
                      aria-label={`Remove ${r.name}`}
                      className="flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-full hover:bg-[#2D4A8A]/15"
                    >
                      <X className="size-3" />
                    </Combobox.ChipRemove>
                  </Combobox.Chip>
                ))}
                <Combobox.Input
                  placeholder={selected.length ? "Add another…" : all ? "Search all contacts…" : "Add existing contact — search by name…"}
                  className="h-6 min-w-[160px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
                />
              </>
            )}
          </Combobox.Value>
        </Combobox.Chips>

        <Combobox.Portal>
          <Combobox.Positioner anchor={anchorRef} sideOffset={4} align="start" className="isolate z-50">
            <Combobox.Popup className="max-h-64 w-(--anchor-width) min-w-72 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <Combobox.Empty className="px-2 py-3 text-center text-xs text-muted-foreground empty:hidden">
                {emptyText}
              </Combobox.Empty>
              <Combobox.List>
                {(r: EventRepresentative) => (
                  <Combobox.Item
                    key={r.contactId}
                    value={r}
                    className={cn(
                      "flex cursor-pointer flex-col rounded-md px-2 py-1 outline-none select-none",
                      "data-[highlighted]:bg-muted data-[selected]:hidden",
                    )}
                  >
                    <span className="text-[13px]">{r.name}</span>
                    {r.detail && <span className="text-[11px] text-muted-foreground">{r.detail}</span>}
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>

      <label className="flex h-8 shrink-0 items-center gap-1.5 text-xs text-muted-foreground" title="Search every active contact, not just this client's">
        <Checkbox checked={all} onCheckedChange={(c) => setAll(c === true)} />
        All contacts
      </label>
    </div>
  )
}
