"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { AccountOption } from "@/lib/types"

/**
 * Simple searchable picker for accounts. Uses a Popover with a filter input
 * and a virtualization-free scrollable list — fine for the current scale
 * (~hundreds of accounts).
 */
export function ClientCombobox({
  options,
  value,
  onChange,
  placeholder = "Select a client",
  emptyHint = "No matches",
  className,
  invalid,
}: {
  options: AccountOption[]
  value: string | null
  onChange: (next: string | null) => void
  placeholder?: string
  emptyHint?: string
  className?: string
  invalid?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState("")

  const selected = options.find((o) => o.account_id === value) ?? null

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options
    const q = query.toLowerCase()
    return options.filter(
      (o) =>
        (o.name ?? "").toLowerCase().includes(q) ||
        (o.ticker_symbol ?? "").toLowerCase().includes(q),
    )
  }, [options, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid}
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
              invalid && "aria-invalid:border-destructive",
              className,
            )}
          />
        }
      >
        <span className="truncate">
          {selected ? (
            <>
              {selected.name}
              {selected.ticker_symbol ? (
                <span className="ml-2 text-xs text-muted-foreground">{selected.ticker_symbol}</span>
              ) : null}
            </>
          ) : (
            placeholder
          )}
        </span>
        <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-72 max-w-md p-2" align="start">
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or ticker"
            className="pl-8"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyHint}</p>
          ) : (
            <ul className="grid">
              {filtered.slice(0, 200).map((o) => {
                const isSelected = o.account_id === value
                return (
                  <li key={o.account_id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(o.account_id)
                        setOpen(false)
                        setQuery("")
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                        isSelected && "bg-muted",
                      )}
                    >
                      <span className="min-w-0 truncate">
                        {o.name}
                        {o.ticker_symbol ? (
                          <span className="ml-2 text-xs text-muted-foreground">{o.ticker_symbol}</span>
                        ) : null}
                      </span>
                      {isSelected ? <Check className="size-4 shrink-0" /> : null}
                    </button>
                  </li>
                )
              })}
              {filtered.length > 200 ? (
                <li className="px-2 py-2 text-xs text-muted-foreground">
                  Showing first 200 — refine your search to narrow.
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
