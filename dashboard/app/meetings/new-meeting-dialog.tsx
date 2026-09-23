"use client"

/**
 * "Add New Meeting" — a LIVE dashboard create form, a near-copy of the other
 * new-*-dialog.tsx files — plus the meetings test-data purge button.
 *
 * Writes go through createMeeting / purgeTestMeetings in ./actions.ts (gate,
 * audit, re-reads via the shared lib/crm-write.ts). Every meeting it creates
 * is origin='dashboard'; "Test record" starts ON (NEW_MEETING_TEST_DEFAULT).
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, X } from "lucide-react"
import { toast } from "sonner"

import { AddNewButton, useQuickAddRequest } from "@/components/crm-add-new"
import { ClientCombobox } from "@/components/client-combobox"
import { PurgeTestButton } from "@/components/purge-test-button"
import { UserCombobox } from "@/components/user-combobox"
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
  MEETING_STATUS_OPTIONS,
  MEETING_TYPE_OPTIONS,
  NEW_MEETING_TEST_DEFAULT,
  type MeetingChoiceOptions,
  type NewMeetingInput,
} from "@/lib/meetings/create"
import type { AccountOption, UserOption } from "@/lib/types"
import { FormSection, SelectField, TextField, YesNo } from "@/components/crm-form-kit"
import {
  countTestMeetings,
  createMeeting,
  loadMeetingClientOptions,
  loadMeetingEventOptions,
  loadMeetingUserOptions,
  loadMeetingChoiceOptions,
  purgeTestMeetings,
  searchMeetingInstitutions,
} from "./actions"
import { loadMeetingForEdit, updateMeeting } from "./actions"

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
type EventOption = { event_id: string; name: string | null; event_state_label: string | null }
type Institution = { institution_id: string; institution_name: string }

/** Now, as an Eastern "YYYY-MM-DDTHH:mm" for the datetime-local input. */
function nowEasternLocal(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date())
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`
}

function emptyForm(): NewMeetingInput {
  return {
    clientAccountId: null,
    typeCode: MEETING_TYPE_OPTIONS[0].code, // Virtual
    statusCode: MEETING_STATUS_OPTIONS[0].code, // Confirmed
    start: nowEasternLocal(),
    eventId: "",
    institutionId: null,
    institutionName: null,
    investor: "",
    hostId: null,
    bookerId: null,
    generalNotes: "",
    cityName: null,
    stateRegionName: null,
    groupMeeting: false,
    hostedInHq: false,
    onBehalfOfId: null,
    host2Id: null,
    feedbackId: null,
    clientBooked: false,
    hostNotesCode: null,
    calendarCode: null,
    profileCode: null,
    feedbackStatusCode: null,
    feedbackBdaCode: null,
    fbReceivedDate: "",
    feedbackNotes: "",
    sent: false,
    confirm: false,
    driver: false,
    foodOrder: "",
    logisticsNotes: "",
    isTest: NEW_MEETING_TEST_DEFAULT,
  }
}

/**
 * The meeting form, for BOTH create and edit. `editId` set = edit mode: fields
 * start from `initial`, save goes through updateMeeting (the server refuses any
 * row that is not origin='dashboard'), and the Test toggle is hidden — is_test
 * is never editable. Mounted fresh per open (keyed by the caller).
 */
function MeetingFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewMeetingInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewMeetingInput>(() => initial ?? emptyForm())
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [users, setUsers] = React.useState<UserOption[] | null>(null)
  const [choices, setChoices] = React.useState<MeetingChoiceOptions | null>(null)
  const set = (p: Partial<NewMeetingInput>) => setForm((f) => ({ ...f, ...p }))
  const [events, setEvents] = React.useState<EventOption[]>([])
  const [instQuery, setInstQuery] = React.useState("")
  const [instResults, setInstResults] = React.useState<Institution[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open || clients) return
    loadMeetingClientOptions().then((r) => (r.ok ? setClients(r.data) : setError(r.error)))
    loadMeetingUserOptions().then((r) => (r.ok ? setUsers(r.data) : setError(r.error)))
    loadMeetingChoiceOptions().then((r) => (r.ok ? setChoices(r.data) : setError(r.error)))
  }, [open, clients])

  // The client's events, for the optional Event link.
  React.useEffect(() => {
    if (!form.clientAccountId) return
    let live = true
    loadMeetingEventOptions(form.clientAccountId).then((r) => {
      if (live) setEvents(r.ok ? r.data : [])
    })
    return () => {
      live = false
    }
  }, [form.clientAccountId])

  // Institution search, debounced.
  React.useEffect(() => {
    if (instQuery.trim().length < 2) return
    let live = true
    const t = setTimeout(() => {
      searchMeetingInstitutions(instQuery).then((r) => {
        if (live) setInstResults(r.ok ? r.data : [])
      })
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [instQuery])

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.clientAccountId) return setError("Pick a client.")
    if (!form.start) return setError("Enter the date and time.")
    startTransition(async () => {
      const r = editId ? await updateMeeting(editId, form) : await createMeeting(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success(editId ? "Changes saved" : form.isTest ? "Test meeting created" : "Meeting created")
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit meeting" : "Add new meeting"}</DialogTitle>
            <DialogDescription>
              {editId ? (
                "Editing a record created in the dashboard. Changes are saved directly and audited."
              ) : (
                <>
              Created directly in the dashboard (not in Dynamics). It appears on this page right away and flows
              everywhere a meeting does — Portfolio counts, Client Detail, Scheduler and the emails.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              <Label>Client</Label>
              <ClientCombobox
                options={clients ?? []}
                value={form.clientAccountId}
                onChange={(v) => setForm((f) => ({ ...f, clientAccountId: v, eventId: "" }))}
                placeholder={clients ? "Select a client" : "Loading clients…"}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nm-type">Type</Label>
                <select
                  id="nm-type"
                  value={form.typeCode}
                  onChange={(e) => setForm((f) => ({ ...f, typeCode: Number(e.target.value) }))}
                  className={SELECT_CLASS}
                >
                  {MEETING_TYPE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nm-status">Status</Label>
                <select
                  id="nm-status"
                  value={form.statusCode}
                  onChange={(e) => setForm((f) => ({ ...f, statusCode: Number(e.target.value) }))}
                  className={SELECT_CLASS}
                >
                  {MEETING_STATUS_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nm-start">Date &amp; time (ET)</Label>
                <Input
                  id="nm-start"
                  type="datetime-local"
                  value={form.start}
                  onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nm-event">Event (optional)</Label>
              <select
                id="nm-event"
                value={form.eventId ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, eventId: e.target.value }))}
                className={SELECT_CLASS}
                disabled={!form.clientAccountId}
              >
                <option value="">— none —</option>
                {events.map((ev) => (
                  <option key={ev.event_id} value={ev.event_id}>
                    {ev.name ?? ev.event_id}
                    {ev.event_state_label ? ` (${ev.event_state_label})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nm-inst">Institution</Label>
              {form.institutionId ? (
                <div className="flex h-8 items-center justify-between rounded-lg border border-input px-2.5 text-sm">
                  <span className="truncate">{form.institutionName}</span>
                  <button
                    type="button"
                    aria-label="Clear institution"
                    onClick={() => setForm((f) => ({ ...f, institutionId: null, institutionName: null }))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div className="grid gap-1">
                  <Input
                    id="nm-inst"
                    placeholder="Search institutions already in the CRM…"
                    value={instQuery}
                    onChange={(e) => setInstQuery(e.target.value)}
                  />
                  {instQuery.trim().length >= 2 && instResults.length > 0 && (
                    <div className="max-h-40 overflow-y-auto rounded-md border border-input">
                      {instResults.map((i) => (
                        <button
                          key={i.institution_id}
                          type="button"
                          onClick={() => {
                            setForm((f) => ({
                              ...f,
                              institutionId: i.institution_id,
                              institutionName: i.institution_name,
                            }))
                            setInstQuery("")
                            setInstResults([])
                          }}
                          className="block w-full truncate px-2.5 py-1 text-left text-sm hover:bg-accent"
                        >
                          {i.institution_name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nm-investor">Investor</Label>
              <Input
                id="nm-investor"
                value={form.investor ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, investor: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Host</Label>
                <UserCombobox
                  options={users ?? []}
                  value={form.hostId ?? null}
                  onChange={(v) => setForm((f) => ({ ...f, hostId: v }))}
                  placeholder="Pick the host"
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Booker</Label>
                <UserCombobox
                  options={users ?? []}
                  value={form.bookerId ?? null}
                  onChange={(v) => setForm((f) => ({ ...f, bookerId: v }))}
                  placeholder="Pick the booker"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nm-notes">General notes</Label>
              <Textarea
                id="nm-notes"
                rows={3}
                value={form.generalNotes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, generalNotes: e.target.value }))}
              />
            </div>

            <FormSection title="Overview — place & flags">
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  id="nm-cityName"
                  label="City"
                  value={form.cityName ?? ""}
                  onChange={(v) => set({ cityName: v || null })}
                  options={(choices?.cities ?? []).map((o) => ({ value: o.name, label: o.name }))}
                />
                <SelectField
                  id="nm-stateRegionName"
                  label="State / Region"
                  value={form.stateRegionName ?? ""}
                  onChange={(v) => set({ stateRegionName: v || null })}
                  options={(choices?.states ?? []).map((o) => ({ value: o.name, label: o.name }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <YesNo label="Group Meeting" checked={form.groupMeeting} onChange={(v) => set({ groupMeeting: v })} />
                <YesNo label="Hosted in HQ" checked={form.hostedInHq} onChange={(v) => set({ hostedInHq: v })} />
              </div>
            </FormSection>

            <FormSection title="Representatives">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Second Host</Label>
                  <UserCombobox
                    options={users ?? []}
                    value={form.host2Id ?? null}
                    onChange={(v) => set({ host2Id: v })}
                    placeholder="—"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>On Behalf Of</Label>
                  <UserCombobox
                    options={users ?? []}
                    value={form.onBehalfOfId ?? null}
                    onChange={(v) => set({ onBehalfOfId: v })}
                    placeholder="—"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Feedback</Label>
                  <UserCombobox
                    options={users ?? []}
                    value={form.feedbackId ?? null}
                    onChange={(v) => set({ feedbackId: v })}
                    placeholder="—"
                  />
                </div>
                <SelectField
                  id="nm-hostNotesCode"
                  label="Host Notes"
                  value={form.hostNotesCode ?? ""}
                  onChange={(v) => set({ hostNotesCode: v ? Number(v) : null })}
                  options={(choices?.hostNotes ?? []).map((o) => ({ value: o.code, label: o.label }))}
                />
              </div>
                <YesNo label="Client Booked" checked={form.clientBooked} onChange={(v) => set({ clientBooked: v })} />
            </FormSection>

            <FormSection title="Planning">
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  id="nm-calendarCode"
                  label="Calendar"
                  value={form.calendarCode ?? ""}
                  onChange={(v) => set({ calendarCode: v ? Number(v) : null })}
                  options={(choices?.calendar ?? []).map((o) => ({ value: o.code, label: o.label }))}
                />
                <SelectField
                  id="nm-profileCode"
                  label="Profile"
                  value={form.profileCode ?? ""}
                  onChange={(v) => set({ profileCode: v ? Number(v) : null })}
                  options={(choices?.profile ?? []).map((o) => ({ value: o.code, label: o.label }))}
                />
              </div>
            </FormSection>

            <FormSection title="Feedback">
              <SelectField
                id="nm-feedbackStatusCode"
                label="Feedback Status — closes feedback (drives Feedback Collection)"
                value={form.feedbackStatusCode ?? ""}
                onChange={(v) => {
                  const code = v ? Number(v) : null
                  // FB in BDA follows Feedback Status (they agree on ~99.5% of
                  // meetings) unless it was set to something else by hand.
                  setForm((f) => ({
                    ...f,
                    feedbackStatusCode: code,
                    ...(f.feedbackBdaCode == null || f.feedbackBdaCode === f.feedbackStatusCode
                      ? { feedbackBdaCode: code }
                      : null),
                  }))
                }}
                options={(choices?.feedbackStatus ?? []).map((o) => ({ value: o.code, label: o.label }))}
              />
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  id="nm-feedbackBdaCode"
                  label="FB in BDA (info only)"
                  value={form.feedbackBdaCode ?? ""}
                  onChange={(v) => set({ feedbackBdaCode: v ? Number(v) : null })}
                  options={(choices?.feedbackBda ?? []).map((o) => ({ value: o.code, label: o.label }))}
                />
                <TextField
                  id="nm-fbrec"
                  label="FB Rec'd (info only)"
                  type="date"
                  value={form.fbReceivedDate}
                  onChange={(v) => set({ fbReceivedDate: v })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="nm-fbnotes">Feedback Notes</Label>
                <Textarea
                  id="nm-fbnotes"
                  rows={2}
                  value={form.feedbackNotes ?? ""}
                  onChange={(e) => set({ feedbackNotes: e.target.value })}
                />
              </div>
            </FormSection>

            <FormSection title="Logistics · usually Live meetings">
              <div className="grid grid-cols-3 gap-2">
                <YesNo label="Sent" checked={form.sent} onChange={(v) => set({ sent: v })} />
                <YesNo label="Confirm" checked={form.confirm} onChange={(v) => set({ confirm: v })} />
                <YesNo label="Driver" checked={form.driver} onChange={(v) => set({ driver: v })} />
              </div>
              <TextField id="nm-food" label="Food Order" value={form.foodOrder} onChange={(v) => set({ foodOrder: v })} />
              <div className="grid gap-1.5">
                <Label htmlFor="nm-lognotes">Logistics Notes</Label>
                <Textarea
                  id="nm-lognotes"
                  rows={2}
                  value={form.logisticsNotes ?? ""}
                  onChange={(e) => set({ logisticsNotes: e.target.value })}
                />
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
                    Marked TEST and removed by “Delete test meetings”. It is NOT hidden anywhere — use the ZZ - Test
                    Client (ZVZZT) while we’re testing.
                  </span>
                </span>
              </label>
            )}

            {error && <div className="text-sm text-destructive">{error}</div>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Saving…
                  </>
                ) : (
                  editId ? "Save changes" : "Create meeting"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Delete test meetings" — the shared purge button, bound to meetings. */
export function PurgeTestMeetingsButton() {
  return <PurgeTestButton noun="meetings" count={countTestMeetings} purge={purgeTestMeetings} />
}

/** "Add New Meeting" — the page button plus a fresh create form per open. */
export function NewMeetingButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="meeting"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <MeetingFormDialog
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
 * Edit an existing meeting — opened from the record drawer. Loads the row via
 * loadMeetingForEdit, which refuses anything that is not origin='dashboard', so a
 * Dynamics record never reaches this form.
 */
export function EditMeetingDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewMeetingInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadMeetingForEdit(id).then((r) => {
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
    <MeetingFormDialog
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
