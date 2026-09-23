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
  EVENT_FEEDBACK_TEAMS,
  EVENT_LEAD_OPTIONS,
  EVENT_MARKETING_OPTIONS,
  EVENT_STATE_OPTIONS,
  EVENT_URGENCY_OPTIONS,
  NEW_EVENT_TEST_DEFAULT,
  type NewEventInput,
} from "@/lib/events/create"
import type { AccountOption, UserOption } from "@/lib/types"
import { UserCombobox } from "@/components/user-combobox"
import { FormSection, SelectField, TextField, YesNo } from "@/components/crm-form-kit"
import { countTestEvents, createEvent, loadEventClientOptions, loadEventUserOptions, purgeTestEvents } from "./actions"
import { loadEventForEdit, updateEvent } from "./actions"

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"

function emptyForm(): NewEventInput {
  return {
    clientAccountId: null,
    name: "",
    stateCode: EVENT_STATE_OPTIONS[0].code, // Pre-Launch
    marketingCode: EVENT_MARKETING_OPTIONS[0].code, // Marketing
    dates: "",
    location: "",
    meetingsStart: "",
    meetingsEnd: "",
    slots: "",
    notes: "",
    tbc: false,
    mining: false,
    team: false,
    accountManagerId: null,
    logisticsCoordinatorId: null,
    feedbackReportId: null,
    feedbackTeamId: null,
    leadCodes: [],
    eventParameters: "",
    urgencyCode: null,
    launchWeek: "",
    memoDate: "",
    lastDataUpload: "",
    shareholderReportReceived: "",
    targetingDate: "",
    targetingNotRequired: false,
    memoNotRequired: false,
    targetingUrl: "",
    profileLink: "",
    targetingNotes: "",
    launch: false,
    outreachComplete: false,
    isTest: NEW_EVENT_TEST_DEFAULT,
  }
}

/** Dynamics' naming: "TICKER -  Place - dates". */
function suggestName(ticker: string | null, location: string, dates: string): string {
  return [ticker ?? "", location.trim(), dates.trim()].filter(Boolean).join(" - ")
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
  // The name follows client / location / dates until the user types their own.
  const [nameEdited, setNameEdited] = React.useState(initial != null)
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [users, setUsers] = React.useState<UserOption[] | null>(null)
  const set = (p: Partial<NewEventInput>) => setForm((f) => ({ ...f, ...p }))
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open || clients) return
    loadEventClientOptions().then((r) => (r.ok ? setClients(r.data) : setError(r.error)))
    loadEventUserOptions().then((r) => (r.ok ? setUsers(r.data) : setError(r.error)))
  }, [open, clients])

  /** Update fields; re-suggest the name unless the user has edited it. */
  function patch(p: Partial<NewEventInput>) {
    setForm((f) => {
      const next = { ...f, ...p }
      if (!nameEdited) {
        const ticker = clients?.find((c) => c.account_id === next.clientAccountId)?.ticker_symbol ?? null
        next.name = suggestName(ticker, next.location ?? "", next.dates ?? "")
      }
      return next
    })
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.clientAccountId) return setError("Pick a client.")
    if (!form.name.trim()) return setError("Enter the event name.")
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

  const isLiveOutreach =
    EVENT_STATE_OPTIONS.find((s) => s.code === form.stateCode)?.label === "Live Outreach"

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
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

          <form onSubmit={onSubmit} className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              <Label>Client</Label>
              <ClientCombobox
                options={clients ?? []}
                value={form.clientAccountId}
                onChange={(v) => patch({ clientAccountId: v })}
                placeholder={clients ? "Select a client" : "Loading clients…"}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ne-location">Location</Label>
                <Input
                  id="ne-location"
                  placeholder="e.g. NYC, Virtual"
                  value={form.location ?? ""}
                  onChange={(e) => patch({ location: e.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ne-dates">Dates</Label>
                <Input
                  id="ne-dates"
                  placeholder="e.g. 10/6, 10/7"
                  value={form.dates ?? ""}
                  onChange={(e) => patch({ dates: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ne-name">Event name</Label>
              <Input
                id="ne-name"
                value={form.name}
                onChange={(e) => {
                  setNameEdited(true)
                  setForm((f) => ({ ...f, name: e.target.value }))
                }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ne-state">Stage</Label>
                <select
                  id="ne-state"
                  value={form.stateCode}
                  onChange={(e) => setForm((f) => ({ ...f, stateCode: Number(e.target.value) }))}
                  className={SELECT_CLASS}
                >
                  {EVENT_STATE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ne-marketing">Marketing</Label>
                <select
                  id="ne-marketing"
                  value={form.marketingCode}
                  onChange={(e) => setForm((f) => ({ ...f, marketingCode: Number(e.target.value) }))}
                  className={SELECT_CLASS}
                >
                  {EVENT_MARKETING_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {isLiveOutreach && (
              <div className="text-xs text-[#92600B]">
                “Live Outreach” puts this event on the Live Outreach page and in its daily email.
              </div>
            )}

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
              <div className="grid gap-1.5">
                <Label htmlFor="ne-slots">Slots</Label>
                <Input
                  id="ne-slots"
                  type="number"
                  min={0}
                  value={form.slots ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, slots: e.target.value }))}
                />
              </div>
            </div>

            <FormSection title="General">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Account Manager</Label>
                  <UserCombobox
                    options={users ?? []}
                    value={form.accountManagerId ?? null}
                    onChange={(v) => set({ accountManagerId: v })}
                    placeholder="—"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Logistics Coordinator</Label>
                  <UserCombobox
                    options={users ?? []}
                    value={form.logisticsCoordinatorId ?? null}
                    onChange={(v) => set({ logisticsCoordinatorId: v })}
                    placeholder="—"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Feedback Report</Label>
                  <UserCombobox
                    options={users ?? []}
                    value={form.feedbackReportId ?? null}
                    onChange={(v) => set({ feedbackReportId: v })}
                    placeholder="—"
                  />
                </div>
                <SelectField
                  id="ne-fbteam"
                  label="Feedback Team"
                  value={form.feedbackTeamId ?? ""}
                  onChange={(v) => set({ feedbackTeamId: v || null })}
                  options={EVENT_FEEDBACK_TEAMS.map((t) => ({ value: t.id, label: t.name }))}
                />
              </div>
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
                  label="Urgency"
                  value={form.urgencyCode ?? ""}
                  onChange={(v) => set({ urgencyCode: v ? Number(v) : null })}
                  options={EVENT_URGENCY_OPTIONS.map((o) => ({ value: o.code, label: o.label }))}
                />
                <TextField id="ne-launchWeek" label="Launch Week" type="date" value={form.launchWeek} onChange={(v) => set({ launchWeek: v })} />
                <TextField id="ne-memoDate" label="Memo Date" type="date" value={form.memoDate} onChange={(v) => set({ memoDate: v })} />
                <TextField id="ne-lastDataUpload" label="Last Data Upload" type="date" value={form.lastDataUpload} onChange={(v) => set({ lastDataUpload: v })} />
                <TextField id="ne-shareholderReportReceived" label="Shareholder Report Received" type="date" value={form.shareholderReportReceived} onChange={(v) => set({ shareholderReportReceived: v })} />
                <TextField id="ne-targetingDate" label="Targeting Date" type="date" value={form.targetingDate} onChange={(v) => set({ targetingDate: v })} />
                <TextField id="ne-turl" label="Targeting URL" value={form.targetingUrl} onChange={(v) => set({ targetingUrl: v })} />
                <TextField id="ne-plink" label="Profile Link" value={form.profileLink} onChange={(v) => set({ profileLink: v })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ne-tnotes">Targeting Notes</Label>
                <Textarea
                  id="ne-tnotes"
                  rows={2}
                  value={form.targetingNotes ?? ""}
                  onChange={(e) => set({ targetingNotes: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <YesNo label="Targeting Not Required" checked={form.targetingNotRequired} onChange={(v) => set({ targetingNotRequired: v })} />
                <YesNo label="Memo Not Required" checked={form.memoNotRequired} onChange={(v) => set({ memoNotRequired: v })} />
                <YesNo label="Launch" checked={form.launch} onChange={(v) => set({ launch: v })} />
                <YesNo label="Outreach Complete" checked={form.outreachComplete} onChange={(v) => set({ outreachComplete: v })} />
              </div>
            </FormSection>

            <div className="grid gap-1.5">
              <Label htmlFor="ne-notes">Event notes</Label>
              <Textarea
                id="ne-notes"
                rows={3}
                value={form.notes ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

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
