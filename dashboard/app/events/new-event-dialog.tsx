"use client"

/**
 * "Add New Event" — a LIVE dashboard create form, a near-copy of the other
 * new-*-dialog.tsx files — plus the events test-data purge button.
 *
 * Writes go through createEvent / purgeTestEvents in ./actions.ts (gate, audit,
 * re-reads via the shared lib/crm-write.ts). Every event it creates is
 * origin='dashboard'; "Test record" starts ON (NEW_EVENT_TEST_DEFAULT).
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { AddNewButton, useQuickAddRequest } from "@/components/crm-add-new"
import { ClientCombobox } from "@/components/client-combobox"
import { PurgeTestButton } from "@/components/purge-test-button"
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
import { Textarea } from "@/components/ui/textarea"
import {
  EVENT_LEAD_OPTIONS,
  EVENT_URGENCY_OPTIONS,
  NEW_EVENT_TEST_DEFAULT,
  buildEventName,
  derivedMarketingLabel,
  validateEventRequired,
  type EventFieldErrors,
  type EventTaskDateKey,
  type EventTaskDates,
  type NewEventInput,
} from "@/lib/events/create"
import type { AccountOption } from "@/lib/types"
import { FieldError, FormSection, SelectField, TextField, YesNo } from "@/components/crm-form-kit"
import { RepresentativesPicker } from "./representatives-picker"
import {
  countTestEvents,
  createEvent,
  loadClientTaskDates,
  loadEventClientOptions,
  purgeTestEvents,
} from "./actions"
import { loadEventForEdit, updateEvent } from "./actions"

const EASTERN_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "numeric",
})

/** The red "required" asterisk after a label. */
function Req() {
  return (
    <span className="text-destructive" aria-label="required">
      *
    </span>
  )
}

/** A greyed, read-only field — for values the system derives, not the user. */
function ReadOnlyField({
  id,
  label,
  value,
  placeholder,
  title,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  title?: string
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        readOnly
        tabIndex={-1}
        aria-readonly="true"
        title={title}
        className="cursor-default bg-muted text-muted-foreground focus-visible:ring-0"
      />
    </div>
  )
}

function emptyForm(): NewEventInput {
  return {
    clientAccountId: null,
    dates: "",
    location: "",
    meetingsStart: "",
    meetingsEnd: "",
    slots: "",
    notes: "",
    tbc: false,
    mining: false,
    team: false,
    leadCodes: [],
    eventParameters: "",
    urgencyCode: null,
    launchWeek: "",
    targetingNotRequired: false,
    memoNotRequired: false,
    targetingUrl: "",
    profileLink: "",
    targetingNotes: "",
    launch: false,
    outreachComplete: false,
    paused: false,
    representatives: [],
    isTest: NEW_EVENT_TEST_DEFAULT,
  }
}

/**
 * The event form, for BOTH create and edit. `editId` set = edit mode: fields
 * start from `initial`, save goes through updateEvent (the server refuses any
 * row that is not origin='dashboard'), and the Test toggle is hidden — is_test
 * is never editable. Mounted fresh per open (keyed by the caller).
 */
function EventFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewEventInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewEventInput>(() => initial ?? emptyForm())
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const set = (p: Partial<NewEventInput>) => setForm((f) => ({ ...f, ...p }))
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open || clients) return
    // Active clients only; an edited event keeps its own client listed.
    loadEventClientOptions(initial?.clientAccountId ?? null).then((r) =>
      r.ok ? setClients(r.data) : setError(r.error),
    )
  }, [open, clients, initial])

  // The name is GENERATED (lib/events/create.ts buildEventName) and read-only
  // here; the server rebuilds it from the same raw fields on save.
  const pickedClient = clients?.find((c) => c.account_id === form.clientAccountId) ?? null
  const generatedName = pickedClient
    ? buildEventName(pickedClient.ticker_symbol?.trim() || pickedClient.name, form.location, form.dates)
    : ""

  // Last Data Upload / Memo Date / Targeting Date are LOOKED UP for the picked
  // client (its latest completed task of each sub-type) and shown read-only;
  // the server re-reads them on save.
  const [taskDates, setTaskDates] = React.useState<{ clientId: string; dates: EventTaskDates } | null>(null)
  React.useEffect(() => {
    const clientId = form.clientAccountId
    if (!open || !clientId) return
    let live = true
    loadClientTaskDates(clientId).then((r) => {
      if (live && r.ok) setTaskDates({ clientId, dates: r.data! })
    })
    return () => {
      live = false
    }
  }, [open, form.clientAccountId])
  function taskDateText(key: EventTaskDateKey, none: string): string {
    if (!form.clientAccountId) return ""
    if (taskDates?.clientId !== form.clientAccountId) return "Looking up…"
    const iso = taskDates.dates[key]
    return iso ? EASTERN_DAY.format(new Date(iso)) : none
  }

  // REQUIRED fields: shown once the user has tried to submit, then live.
  const [showErrors, setShowErrors] = React.useState(false)
  const fieldErrors: EventFieldErrors = showErrors ? validateEventRequired(form) : {}

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setShowErrors(true)
    if (Object.keys(validateEventRequired(form)).length) {
      return setError("Fill in the required fields marked below.")
    }
    startTransition(async () => {
      const r = editId ? await updateEvent(editId, form) : await createEvent(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success(editId ? "Changes saved" : form.isTest ? "Test event created" : "Event created")
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        {/* Large, multi-column: most of the screen on desktop, one scrolling
            column on small screens. Header and footer stay put; only the
            field area scrolls. */}
        <DialogContent className="flex max-h-[92vh] w-[96vw] flex-col gap-0 p-0 sm:max-w-[1280px]">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>{editId ? "Edit event" : "Add new event"}</DialogTitle>
            <DialogDescription>
              {editId ? (
                "Editing a record created in the dashboard. Changes are saved directly and audited."
              ) : (
                <>
              Created directly in the dashboard (not in Dynamics). It appears on this page right away and flows
              everywhere an event does.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-x-6 gap-y-4 overflow-y-auto px-5 py-4 lg:grid-cols-3">
              {/* ---- Column 1: the event itself ---- */}
              <div className="grid content-start gap-3">
                <div className="grid gap-1.5">
                  <Label>
                    Client <Req />
                  </Label>
                  <ClientCombobox
                    options={clients ?? []}
                    value={form.clientAccountId}
                    onChange={(v) => set({ clientAccountId: v })}
                    placeholder={clients ? "Select a client" : "Loading clients…"}
                    invalid={!!fieldErrors.clientAccountId}
                  />
                  <FieldError message={fieldErrors.clientAccountId} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor="ne-location">
                      Location <Req />
                    </Label>
                    <Input
                      id="ne-location"
                      placeholder="e.g. NYC, Virtual"
                      value={form.location ?? ""}
                      onChange={(e) => set({ location: e.target.value })}
                      aria-invalid={fieldErrors.location ? true : undefined}
                    />
                    <FieldError message={fieldErrors.location} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="ne-dates">Dates</Label>
                    <Input
                      id="ne-dates"
                      placeholder="e.g. 10/6, 10/7"
                      value={form.dates ?? ""}
                      onChange={(e) => set({ dates: e.target.value })}
                    />
                  </div>
                </div>

                <ReadOnlyField
                  id="ne-name"
                  label="Event name"
                  value={generatedName}
                  placeholder="Generated from client, location and dates"
                  title="Generated automatically: TICKER - Location - Dates"
                />

                <div className="grid grid-cols-3 gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="ne-start">Meetings start</Label>
                    <Input
                      id="ne-start"
                      type="date"
                      value={form.meetingsStart ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, meetingsStart: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="ne-end">Meetings end</Label>
                    <Input
                      id="ne-end"
                      type="date"
                      value={form.meetingsEnd ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, meetingsEnd: e.target.value }))}
                    />
                  </div>
                  <div className="grid content-start gap-1.5">
                    <Label htmlFor="ne-slots">
                      # of Slots <Req />
                    </Label>
                    <Input
                      id="ne-slots"
                      type="number"
                      min={0}
                      value={form.slots ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, slots: e.target.value }))}
                      aria-invalid={fieldErrors.slots ? true : undefined}
                    />
                    <FieldError message={fieldErrors.slots} />
                  </div>
                </div>

                <div className="grid gap-1.5">
                  <Label htmlFor="ne-notes">Event notes</Label>
                  <Textarea
                    id="ne-notes"
                    rows={5}
                    value={form.notes ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>

              {/* ---- Column 2: lifecycle + general ---- */}
              <div className="grid content-start gap-4">
                <FormSection title="Lifecycle">
                  <p className="text-xs text-muted-foreground">
                    The stage is computed — not picked. Launch → Live Outreach; Outreach Complete → Schedule Closed,
                    then Meetings Ongoing, Preparing Feedback and Complete follow the meetings and feedback reports.
                    Pause overrides everything until it is cleared.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    <YesNo label="Launch" checked={form.launch} onChange={(v) => set({ launch: v })} />
                    <YesNo label="Outreach Complete" checked={form.outreachComplete} onChange={(v) => set({ outreachComplete: v })} />
                    <YesNo label="Pause" checked={form.paused} onChange={(v) => set({ paused: v })} />
                  </div>
                  <ReadOnlyField
                    id="ne-marketing"
                    label="Marketing"
                    value={derivedMarketingLabel(form.launch, form.outreachComplete, form.paused)}
                    title="Derived from the stage: Marketing only while the event is in Live Outreach"
                  />
                </FormSection>

                <FormSection title="General">
                  {!editId && (
                    <p className="text-xs text-muted-foreground">
                      Account Manager, Logistics Coordinator and Feedback Report are copied from the client’s
                      account team when the event is created.
                    </p>
                  )}
                  <div className="grid gap-1.5">
                    <Label>Lead(s)</Label>
                    <div className="flex flex-wrap gap-3 text-sm">
                      {EVENT_LEAD_OPTIONS.map((o) => (
                        <YesNo
                          key={o.code}
                          label={o.label}
                          checked={form.leadCodes.includes(o.code)}
                          onChange={(on) =>
                            set({
                              leadCodes: on
                                ? [...new Set([...form.leadCodes, o.code])]
                                : form.leadCodes.filter((c) => c !== o.code),
                            })
                          }
                        />
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <YesNo label="TBC" checked={form.tbc} onChange={(v) => set({ tbc: v })} />
                    <YesNo label="Team?" checked={form.team} onChange={(v) => set({ team: v })} />
                    <YesNo
                      label="Mining — excluded from Live Outreach"
                      checked={form.mining}
                      onChange={(v) => set({ mining: v })}
                    />
                  </div>
                </FormSection>
              </div>

              {/* ---- Column 3: planning ---- */}
              <div className="grid content-start gap-4">
                <FormSection title="Planning">
                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      id="ne-params"
                      label="Event Parameters"
                      value={form.eventParameters}
                      onChange={(v) => set({ eventParameters: v })}
                    />
                    <SelectField
                      id="ne-urgency"
                      label={
                        <>
                          Urgency <Req />
                        </>
                      }
                      value={form.urgencyCode ?? ""}
                      onChange={(v) => set({ urgencyCode: v ? Number(v) : null })}
                      options={EVENT_URGENCY_OPTIONS.map((o) => ({ value: o.code, label: o.label }))}
                      error={fieldErrors.urgencyCode}
                    />
                    <TextField id="ne-launchWeek" label="Launch Week" type="date" value={form.launchWeek} onChange={(v) => set({ launchWeek: v })} />
                    <ReadOnlyField
                      id="ne-memoDate"
                      label="Memo Date"
                      value={taskDateText("memoDate", "No memo on record")}
                      title="The client's most recent completed Marketing Memo task — looked up, not typed"
                    />
                    <ReadOnlyField
                      id="ne-lastDataUpload"
                      label="Last Data Upload"
                      value={taskDateText("lastDataUpload", "No data upload on record")}
                      title="The client's most recent completed Data Upload task — looked up, not typed"
                    />
                    <ReadOnlyField
                      id="ne-targetingDate"
                      label="Targeting Date"
                      value={taskDateText("targetingDate", "No targeting on record")}
                      title="The client's most recent completed Targeting task — looked up, not typed"
                    />
                    <TextField id="ne-turl" label="Targeting URL" value={form.targetingUrl} onChange={(v) => set({ targetingUrl: v })} />
                    <TextField id="ne-plink" label="Profile Link" value={form.profileLink} onChange={(v) => set({ profileLink: v })} />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="ne-tnotes">Targeting Notes</Label>
                    <Textarea
                      id="ne-tnotes"
                      rows={3}
                      value={form.targetingNotes ?? ""}
                      onChange={(e) => set({ targetingNotes: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <YesNo label="Targeting Not Required" checked={form.targetingNotRequired} onChange={(v) => set({ targetingNotRequired: v })} />
                    <YesNo label="Memo Not Required" checked={form.memoNotRequired} onChange={(v) => set({ memoNotRequired: v })} />
                  </div>
                </FormSection>

                {!editId && (
                  <label className="flex items-start gap-2 rounded-md border border-[#F3E2BF] bg-[#FCF4E6] px-3 py-2 text-sm">
                    <Checkbox
                      checked={form.isTest}
                      onCheckedChange={(c) => setForm((f) => ({ ...f, isTest: c === true }))}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="font-medium">Test record</span>
                      <span className="block text-xs text-muted-foreground">
                        Marked TEST and removed by “Delete test events”. It is NOT hidden anywhere — use the ZZ - Test
                        Client (ZVZZT) while we’re testing.
                      </span>
                    </span>
                  </label>
                )}
              </div>

              {/* ---- Full width, at the bottom: company representatives ---- */}
              <div className="lg:col-span-3">
                <FormSection title="Company representatives">
                  <RepresentativesPicker
                    clientAccountId={form.clientAccountId}
                    value={form.representatives}
                    onChange={(representatives) => set({ representatives })}
                  />
                </FormSection>
              </div>
            </div>

            {error &&<div className="border-t px-5 py-2 text-sm text-destructive">{error}</div>}

            <DialogFooter className="mx-0 mb-0">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  editId ? "Save changes" : "Create event"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Delete test events" — the shared purge button, bound to events. */
export function PurgeTestEventsButton() {
  return <PurgeTestButton noun="events" count={countTestEvents} purge={purgeTestEvents} />
}

/** "Add New Event" — the page button plus a fresh create form per open. */
export function NewEventButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="event"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <EventFormDialog
        key={`${mount}${quick.requested ? "-q" : ""}`}
        open={open || quick.requested}
        setOpen={(o) => {
          setOpen(o)
          if (!o) quick.clear()
        }}
        initial={null}
        editId={null}
        onSaved={() => {}}
      />
    </>
  )
}

/**
 * Edit an existing event — opened from the record drawer. Loads the row via
 * loadEventForEdit, which refuses anything that is not origin='dashboard', so a
 * Dynamics record never reaches this form.
 */
export function EditEventDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewEventInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadEventForEdit(id).then((r) => {
      if (!live) return
      if (r.ok) setLoaded({ id, input: r.data })
      else {
        toast.error("This record can't be edited", { description: r.error })
        onClose()
      }
    })
    return () => {
      live = false
    }
  }, [id, onClose])

  const current = id && loaded?.id === id ? loaded : null
  if (!current) return null
  return (
    <EventFormDialog
      key={current.id}
      open
      setOpen={(o) => {
        if (!o) {
          setLoaded(null)
          onClose()
        }
      }}
      initial={current.input}
      editId={current.id}
      onSaved={() => {
        setLoaded(null)
        onSaved(current.id)
      }}
    />
  )
}
