"use client"

/**
 * Admin → Events Planner list: every itinerary, with search + filters (status,
 * client, date range, mine). Filtering is in the browser — itineraries number in
 * the dozens, not thousands. "New itinerary" opens ./new-itinerary-dialog.tsx.
 */

import * as React from "react"
import Link from "next/link"
import { CalendarRange, Search } from "lucide-react"

import { ListTitleCard } from "@/components/page-masthead"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CARD_CLASS, TEXT_MUTED } from "@/lib/design"
import { formatDateRange } from "@/lib/events-planner/core"
import { ITINERARY_STATUSES, type ItineraryListRow } from "@/lib/events-planner/types"
import { NewItineraryButton } from "./new-itinerary-dialog"
import { ItineraryStatusPill } from "./status-pill"

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-white px-2.5 text-sm"

const UPDATED = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

export function ItinerariesView({
  rows,
  myUserId,
  readOnly,
}: {
  rows: ItineraryListRow[]
  myUserId: string | null
  readOnly: boolean
}) {
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("")
  const [client, setClient] = React.useState("")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [mine, setMine] = React.useState(false)

  const clients = React.useMemo(
    () => [...new Set(rows.map((r) => r.client_name).filter((c): c is string => !!c))].sort(),
    [rows],
  )

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (q && !`${r.title} ${r.client_name ?? ""}`.toLowerCase().includes(q)) return false
      if (status && r.status !== status) return false
      if (client && r.client_name !== client) return false
      // Date range: the itinerary overlaps [from, to].
      if (from && r.end_date < from) return false
      if (to && r.start_date > to) return false
      if (mine && (!myUserId || (r.created_by_id !== myUserId && r.organizer_user_id !== myUserId))) return false
      return true
    })
  }, [rows, query, status, client, from, to, mine, myUserId])

  const anyFilter = !!(query || status || client || from || to || mine)
  const clearAll = () => {
    setQuery("")
    setStatus("")
    setClient("")
    setFrom("")
    setTo("")
    setMine(false)
  }

  return (
    <div className="space-y-4">
      <ListTitleCard
        compact
        eyebrow="Admin"
        title="Events Planner"
        subtitle="Minute-by-minute itineraries built from CRM events — meetings, travel, hotels and meals."
        rightSlot={readOnly ? undefined : <NewItineraryButton />}
      />

      {/* ---- filters ---- */}
      <div className={`${CARD_CLASS} flex flex-wrap items-center gap-2 px-3 py-2.5`}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title or client"
            className="h-8 w-56 bg-white pl-8"
          />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={SELECT_CLASS} aria-label="Status">
          <option value="">All statuses</option>
          {ITINERARY_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={client} onChange={(e) => setClient(e.target.value)} className={SELECT_CLASS} aria-label="Client">
          <option value="">All clients</option>
          {clients.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          From
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36 bg-white" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          To
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36 bg-white" />
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          Mine
        </label>
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            Clear
          </Button>
        )}
        <span className="ml-auto text-xs" style={{ color: TEXT_MUTED }}>
          {filtered.length} of {rows.length}
        </span>
      </div>

      {/* ---- table / empty states ---- */}
      {rows.length === 0 ? (
        <div className={`${CARD_CLASS} flex flex-col items-center gap-3 px-6 py-14 text-center`}>
          <CalendarRange className="size-8 text-muted-foreground" />
          <div className="text-sm font-medium">No itineraries yet</div>
          <div className="max-w-md text-sm text-muted-foreground">
            Start one from a CRM event — its dates, client and meetings come across — or from a blank page.
          </div>
          {!readOnly && <NewItineraryButton />}
        </div>
      ) : filtered.length === 0 ? (
        <div className={`${CARD_CLASS} px-6 py-10 text-center text-sm text-muted-foreground`}>
          No itineraries match these filters.{" "}
          <button className="underline" onClick={clearAll}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className={`${CARD_CLASS} overflow-hidden`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Cities</TableHead>
                <TableHead className="text-right">Meetings</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead>Owner</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-72 font-medium">
                    <Link href={`/admin/events/${r.id}`} className="block truncate hover:underline">
                      {r.title}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{r.client_name ?? "—"}</TableCell>
                  <TableCell>{r.event_type_name ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateRange(r.start_date, r.end_date)}</TableCell>
                  <TableCell className="max-w-48 truncate">{r.cities ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.meeting_count}</TableCell>
                  <TableCell>
                    <ItineraryStatusPill status={r.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {UPDATED.format(new Date(r.updated_at))}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{r.organizer_name ?? r.created_by_name ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
