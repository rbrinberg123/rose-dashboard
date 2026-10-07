"use client"

/**
 * "New itinerary" — two ways in:
 *   A. From CRM event: search the CRM events (upcoming first) → a PREVIEW of
 *      what will be created (days, the event's CRM meetings, the client's
 *      contacts), each tickable → Create.
 *   B. Blank: title, optional client, type, dates, meeting length.
 * Nothing is written until "Create itinerary". The server re-reads every id
 * (./actions.ts createItinerary). Times show on the Eastern clock — every new
 * day starts in Eastern; a day's city/zone is changed in the builder.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, Loader2, Plus, Search } from "lucide-react"
import { toast } from "sonner"

import { ClientCombobox } from "@/components/client-combobox"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SegmentedToggle } from "@/components/segmented-toggle"
import { STATUS_PILL_LIGHT, TEXT_MUTED } from "@/lib/design"
import {
  HOME_TZ,
  MAX_ITINERARY_DAYS,
  enumerateDates,
  formatDateRange,
  formatDay,
  formatTime,
  planCrmMeetings,
  todayHome,
} from "@/lib/events-planner/core"
import {
  DEFAULT_MEETING_MINUTES,
  type ContactOption,
  type CrmEventOption,
  type CrmEventPreview,
  type NewItineraryInput,
  type TypeOption,
} from "@/lib/events-planner/types"
import type { AccountOption } from "@/lib/types"
import {
  createItinerary,
  loadClientContactOptions,
  loadEventTypeOptions,
  loadPlannerClientOptions,
  previewCrmEvent,
  searchCrmEvents,
} from "./actions"

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"

type Mode = "crm" | "blank"

/** "Oct 6 – 8, 2026" from a CRM event's actual start/end, or its free-text dates. */
function eventDates(e: CrmEventOption): string {
  const s = e.event_start_actual?.slice(0, 10)
  const t = e.event_end_actual?.slice(0, 10)
  if (s && t && t >= s) return formatDateRange(s, t)
  if (s) return formatDateRange(s, s)
  return e.dates?.trim() || "No dates"
}

/* ------------------------------------------------------------ shared bits */

function SetupFields({
  title,
  setTitle,
  types,
  typeId,
  setTypeId,
  start,
  setStart,
  end,
  setEnd,
  minutes,
  setMinutes,
}: {
  title: string
  setTitle: (v: string) => void
  types: TypeOption[] | null
  typeId: string
  setTypeId: (v: string) => void
  start: string
  setStart: (v: string) => void
  end: string
  setEnd: (v: string) => void
  minutes: string
  setMinutes: (v: string) => void
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="ni-title">Title</Label>
        <Input id="ni-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Acme Corp — Boston & Chicago NDR" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="grid gap-1.5">
          <Label htmlFor="ni-type">Event type</Label>
          <select id="ni-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={SELECT_CLASS}>
            <option value="">{types ? "—" : "Loading…"}</option>
            {(types ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ni-start">Start date</Label>
          <Input id="ni-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ni-end">End date</Label>
          <Input id="ni-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ni-min">Meeting length</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id="ni-min"
              type="number"
              min={5}
              max={600}
              step={5}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
              className="w-20"
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>
        </div>
      </div>
      <div className="text-xs" style={{ color: TEXT_MUTED }}>
        Times are in Eastern (New York). A day in another city can be switched to that city&apos;s time zone in the
        builder; Eastern is always shown alongside.
      </div>
    </>
  )
}

function ContactsPicker({
  contacts,
  selected,
  setSelected,
  clientName,
}: {
  contacts: ContactOption[] | null
  selected: Set<string>
  setSelected: (s: Set<string>) => void
  clientName: string | null
}) {
  if (contacts == null) return <div className="text-sm text-muted-foreground">Loading contacts…</div>
  if (contacts.length === 0)
    return (
      <div className="text-sm text-muted-foreground">
        No CRM contacts at {clientName ?? "this client"}. Attendees can be added in the builder.
      </div>
    )
  const all = contacts.every((c) => selected.has(c.contact_id))
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          Added as client executives who get the full itinerary. {selected.size} of {contacts.length} selected.
        </span>
        <button
          type="button"
          className="text-xs underline"
          onClick={() => setSelected(all ? new Set() : new Set(contacts.map((c) => c.contact_id)))}
        >
          {all ? "Select none" : "Select all"}
        </button>
      </div>
      <div className="max-h-44 divide-y divide-border overflow-y-auto rounded-md border border-border">
        {contacts.map((c) => (
          <label key={c.contact_id} className="flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-muted/40">
            <Checkbox
              checked={selected.has(c.contact_id)}
              onCheckedChange={(on) => {
                const next = new Set(selected)
                if (on === true) next.add(c.contact_id)
                else next.delete(c.contact_id)
                setSelected(next)
              }}
            />
            <span className="min-w-0 flex-1 truncate">
              <span className="font-medium">{c.full_name ?? "(no name)"}</span>
              {c.job_title && <span className="text-muted-foreground"> · {c.job_title}</span>}
            </span>
            {c.email ? (
              <span className="truncate text-xs text-muted-foreground">{c.email}</span>
            ) : (
              <span className="flex items-center gap-1 text-xs" style={{ color: STATUS_PILL_LIGHT.watch.text }}>
                <AlertTriangle className="size-3" /> No email
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- the dialog */

function NewItineraryDialog({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const router = useRouter()
  const [mode, setMode] = React.useState<Mode>("crm")
  const [types, setTypes] = React.useState<TypeOption[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  // CRM search
  const [query, setQuery] = React.useState("")
  const [events, setEvents] = React.useState<CrmEventOption[] | null>(null)
  const [preview, setPreview] = React.useState<CrmEventPreview | null>(null)
  const [loadingPreview, setLoadingPreview] = React.useState<string | null>(null)

  // Shared setup fields
  const [title, setTitle] = React.useState("")
  const [typeId, setTypeId] = React.useState("")
  const [start, setStart] = React.useState(todayHome())
  const [end, setEnd] = React.useState(todayHome())
  const [minutes, setMinutes] = React.useState(String(DEFAULT_MEETING_MINUTES))
  const [pickedMeetings, setPickedMeetings] = React.useState<Set<string>>(new Set())
  const [pickedContacts, setPickedContacts] = React.useState<Set<string>>(new Set())

  // Blank: client + its contacts
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [clientId, setClientId] = React.useState<string | null>(null)
  const [blankContacts, setBlankContacts] = React.useState<ContactOption[] | null>(null)

  React.useEffect(() => {
    if (!open || types) return
    loadEventTypeOptions().then((r) => (r.ok ? setTypes(r.data) : setError(r.error)))
  }, [open, types])

  React.useEffect(() => {
    if (!open || mode !== "blank" || clients) return
    loadPlannerClientOptions().then((r) => (r.ok ? setClients(r.data) : setError(r.error)))
  }, [open, mode, clients])

  // Debounced CRM event search.
  React.useEffect(() => {
    if (!open || mode !== "crm" || preview) return
    let live = true
    const t = setTimeout(() => {
      searchCrmEvents(query).then((r) => {
        if (!live) return
        if (r.ok) setEvents(r.data)
        else setError(r.error)
      })
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [open, mode, query, preview])

  // Blank: picking a client loads its contacts (latest pick wins).
  const clientPick = React.useRef<string | null>(null)
  function pickClient(id: string | null) {
    setClientId(id)
    setPickedContacts(new Set())
    setBlankContacts(null)
    clientPick.current = id
    if (!id) return
    loadClientContactOptions(id).then((r) => {
      if (clientPick.current === id) setBlankContacts(r.ok ? r.data : [])
    })
  }

  const minutesNum = Math.round(Number(minutes))
  const minutesOk = Number.isFinite(minutesNum) && minutesNum >= 5 && minutesNum <= 600
  const dayCount = enumerateDates(start, end).length

  const plan = React.useMemo(
    () =>
      preview
        ? planCrmMeetings(preview.meetings, {
            startDate: start,
            endDate: end,
            meetingMinutes: minutesOk ? minutesNum : DEFAULT_MEETING_MINUTES,
          })
        : [],
    [preview, start, end, minutesOk, minutesNum],
  )
  const importable = plan.filter((p) => !p.problem)
  const chosenMeetings = importable.filter((p) => pickedMeetings.has(p.crmMeetingId))

  async function openPreview(e: CrmEventOption) {
    setError(null)
    setLoadingPreview(e.event_id)
    const r = await previewCrmEvent(e.event_id)
    setLoadingPreview(null)
    if (!r.ok) return setError(r.error)
    const p = r.data
    setPreview(p)
    setTitle(p.event.name?.trim() || "")
    setTypeId(p.eventTypeId ?? "")
    setStart(p.proposedStart)
    setEnd(p.proposedEnd)
    setMinutes(String(DEFAULT_MEETING_MINUTES))
    const initial = planCrmMeetings(p.meetings, {
      startDate: p.proposedStart,
      endDate: p.proposedEnd,
      meetingMinutes: DEFAULT_MEETING_MINUTES,
    })
    setPickedMeetings(new Set(initial.filter((m) => m.defaultSelected).map((m) => m.crmMeetingId)))
    setPickedContacts(new Set())
  }

  function validate(): string | null {
    if (!title.trim()) return "Enter a title."
    if (dayCount === 0) return "The end date must be on or after the start date."
    if (dayCount > MAX_ITINERARY_DAYS) return `An itinerary can be at most ${MAX_ITINERARY_DAYS} days.`
    if (!minutesOk) return "Meeting length must be 5–600 minutes."
    return null
  }

  function onCreate() {
    setError(null)
    const v = validate()
    if (v) return setError(v)
    const input: NewItineraryInput = {
      crmEventId: mode === "crm" ? preview?.event.event_id ?? null : null,
      title: title.trim(),
      subtitle: "",
      clientAccountId: mode === "crm" ? preview?.event.client_account_id ?? null : clientId,
      eventTypeId: typeId || null,
      startDate: start,
      endDate: end,
      defaultMeetingMinutes: minutesNum,
      importMeetingIds: mode === "crm" ? chosenMeetings.map((m) => m.crmMeetingId) : [],
      contactIds: [...pickedContacts],
    }
    startTransition(async () => {
      const r = await createItinerary(input)
      if (!r.ok) return setError(r.error)
      toast.success("Itinerary created")
      setOpen(false)
      router.push(`/admin/events/${r.data.id}`)
    })
  }

  /* ---- step bodies ---- */

  const crmPicker = (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search CRM events by name or client"
          className="pl-8"
        />
      </div>
      <div className="text-xs text-muted-foreground">
        {query.trim() ? "Upcoming first, then past." : "Upcoming and recent events. Type to search them all."}
      </div>
      <div className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
        {events == null ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading events…
          </div>
        ) : events.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">No CRM events match.</div>
        ) : (
          events.map((e) => (
            <button
              key={e.event_id}
              type="button"
              disabled={!!loadingPreview}
              onClick={() => openPreview(e)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted/40 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.name ?? "(unnamed event)"}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {e.client_account_name ?? "No client"}
                  {e.event_location ? ` · ${e.event_location}` : ""}
                  {e.event_state_label ? ` · ${e.event_state_label}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{eventDates(e)}</span>
              {loadingPreview === e.event_id && <Loader2 className="size-4 animate-spin" />}
            </button>
          ))
        )}
      </div>
    </div>
  )

  const byDay = new Map<string, typeof plan>()
  for (const p of plan) {
    const k = p.date ?? "—"
    byDay.set(k, [...(byDay.get(k) ?? []), p])
  }

  const crmPreview = preview && (
    <div className="grid gap-4">
      <button
        type="button"
        onClick={() => {
          setPreview(null)
          setError(null)
        }}
        className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Pick a different event
      </button>
      <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <div className="font-medium">{preview.event.name ?? "(unnamed event)"}</div>
        <div className="text-xs text-muted-foreground">
          {preview.event.client_account_name ?? "No client"} · {eventDates(preview.event)}
          {preview.event.event_type_label ? ` · CRM type: ${preview.event.event_type_label}` : ""}
        </div>
      </div>

      <SetupFields
        {...{ title, setTitle, types, typeId, setTypeId, start, setStart, end, setEnd, minutes, setMinutes }}
      />

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between">
          <Label>CRM meetings to import</Label>
          {importable.length > 0 && (
            <button
              type="button"
              className="text-xs underline"
              onClick={() =>
                setPickedMeetings(
                  chosenMeetings.length === importable.length
                    ? new Set()
                    : new Set(importable.map((m) => m.crmMeetingId)),
                )
              }
            >
              {chosenMeetings.length === importable.length ? "Select none" : "Select all"}
            </button>
          )}
        </div>
        {plan.length === 0 ? (
          <div className="text-sm text-muted-foreground">This event has no meetings in the CRM yet.</div>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-md border border-border">
            {[...byDay.entries()].map(([date, list]) => (
              <div key={date}>
                <div className="sticky top-0 bg-muted px-2.5 py-1 text-xs font-medium">
                  {date === "—" ? "No time" : formatDay(date)}
                </div>
                {list.map((m) => (
                  <label
                    key={m.crmMeetingId}
                    className={`flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-sm ${m.problem ? "opacity-60" : "cursor-pointer hover:bg-muted/40"}`}
                  >
                    <Checkbox
                      disabled={!!m.problem}
                      checked={!m.problem && pickedMeetings.has(m.crmMeetingId)}
                      onCheckedChange={(on) => {
                        const next = new Set(pickedMeetings)
                        if (on === true) next.add(m.crmMeetingId)
                        else next.delete(m.crmMeetingId)
                        setPickedMeetings(next)
                      }}
                    />
                    <span className="w-32 shrink-0 tabular-nums text-xs">
                      {m.startIso && m.endIso
                        ? `${formatTime(m.startIso, HOME_TZ)} – ${formatTime(m.endIso, HOME_TZ)}`
                        : "—"}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{m.title}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {m.meetingTypeName}
                        {m.city ? ` · ${m.city}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {m.problem ?? m.crmStatusLabel ?? ""}
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          The CRM doesn&apos;t record which contacts attend each meeting, so investors are added in the builder. CRM
          investor names are kept in each meeting&apos;s internal notes.
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label>Client contacts</Label>
        <ContactsPicker
          contacts={preview.contacts}
          selected={pickedContacts}
          setSelected={setPickedContacts}
          clientName={preview.event.client_account_name}
        />
      </div>
    </div>
  )

  const blankForm = (
    <div className="grid gap-4">
      <SetupFields
        {...{ title, setTitle, types, typeId, setTypeId, start, setStart, end, setEnd, minutes, setMinutes }}
      />
      <div className="grid gap-1.5">
        <Label>Client (optional)</Label>
        <ClientCombobox
          options={clients ?? []}
          value={clientId}
          onChange={pickClient}
          placeholder={clients ? "Select a client" : "Loading clients…"}
        />
      </div>
      {clientId && (
        <div className="grid gap-1.5">
          <Label>Client contacts</Label>
          <ContactsPicker
            contacts={blankContacts}
            selected={pickedContacts}
            setSelected={setPickedContacts}
            clientName={clients?.find((c) => c.account_id === clientId)?.name ?? null}
          />
        </div>
      )}
    </div>
  )

  const canCreate = mode === "blank" || !!preview
  const summary =
    dayCount > 0 && dayCount <= MAX_ITINERARY_DAYS
      ? [
          `${dayCount} day${dayCount === 1 ? "" : "s"}`,
          mode === "crm" ? `${chosenMeetings.length} meeting${chosenMeetings.length === 1 ? "" : "s"}` : null,
          `${pickedContacts.size} attendee${pickedContacts.size === 1 ? "" : "s"}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : null

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New itinerary</DialogTitle>
          <DialogDescription>
            Nothing is created until you click Create. The CRM is only read, never changed.
          </DialogDescription>
        </DialogHeader>

        <SegmentedToggle
          value={mode}
          onChange={(v) => {
            setMode(v as Mode)
            setError(null)
            setPickedContacts(new Set())
            if (v === "blank") {
              setPreview(null)
              setTitle("")
              setTypeId("")
              setStart(todayHome())
              setEnd(todayHome())
              setMinutes(String(DEFAULT_MEETING_MINUTES))
            }
          }}
          options={[
            { value: "crm", label: "From CRM event" },
            { value: "blank", label: "Blank" },
          ]}
        />

        <div className="max-h-[65vh] overflow-y-auto pr-1">
          {mode === "crm" ? (preview ? crmPreview : crmPicker) : blankForm}
        </div>

        {error && <div className="text-sm text-destructive">{error}</div>}

        {canCreate && (
          <DialogFooter className="items-center">
            {summary && <span className="mr-auto text-xs text-muted-foreground">Creates {summary}</span>}
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="button" onClick={onCreate} disabled={pending}>
              {pending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Creating…
                </>
              ) : (
                "Create itinerary"
              )}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The "New itinerary" button + a fresh dialog per open. */
export function NewItineraryButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  return (
    <>
      <Button
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      >
        <Plus className="size-4" /> New itinerary
      </Button>
      <NewItineraryDialog key={mount} open={open} setOpen={setOpen} />
    </>
  )
}
