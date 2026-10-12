"use client"

/**
 * "Add New Touchpoint" — the third LIVE dashboard create form, a near-copy of
 * app/notes/new-note-dialog.tsx — plus the touchpoints test-data purge button.
 *
 * DISPLAY NAME is "Touchpoint(s)" (2026-10-12; was "Touch(es)"). Everything
 * internal — the route, tables, file and symbol names (createTouch,
 * NewTouchButton, …) — is unchanged.
 *
 * Writes go through createTouch / purgeTestTouches in ./actions.ts, which hold
 * the real gate (super_user, not impersonating) and the audit call, via the
 * shared lib/crm-write.ts. Every touch it creates is origin='dashboard'; the
 * "Test record" toggle starts ON (NEW_TOUCH_TEST_DEFAULT in
 * lib/touchpoints/create.ts).
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { CalendarClock, Loader2, MessagesSquare } from "lucide-react"
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
  NEW_TOUCH_TEST_DEFAULT,
  TOUCH_CONTACT_TYPE_OPTIONS,
  TOUCH_STATUS_OPTIONS,
  TOUCH_TYPE_OPTIONS,
  validateTouchRequired,
  type NewTouchInput,
  type TouchFieldErrors,
} from "@/lib/touchpoints/create"
import type { AccountOption } from "@/lib/types"
import { FieldError, FormSection, SelectField } from "@/components/crm-form-kit"
// The event form's contact picker, in client-only mode (allowAll={false}).
import { RepresentativesPicker } from "@/app/events/representatives-picker"
import { countTestTouches, createTouch, loadTouchClientOptions, purgeTestTouches } from "./actions"
import { loadTouchForEdit, updateTouch } from "./actions"
import { loadEventContactOptions } from "@/app/events/actions"
import type { ActionResult } from "@/lib/actions"

/**
 * The server actions the form calls. Default = the Touchpoints tab's own
 * (super_user-gated). The Onboarding page's cells pass a client-scope-gated set
 * (app/onboarding/actions.ts) — the FORM is the same, only the gate differs.
 */
export type TouchFormApi = {
  create: (input: NewTouchInput) => Promise<ActionResult<{ touchpointId: string }>>
  update: (id: string, input: NewTouchInput) => Promise<ActionResult<{ changed: number }>>
  loadClients: (includeAccountId?: string | null) => Promise<ActionResult<AccountOption[]>>
  loadContactOptions: typeof loadEventContactOptions
  loadForEdit: (id: string) => Promise<ActionResult<NewTouchInput>>
}

const DEFAULT_API: TouchFormApi = {
  create: createTouch,
  update: updateTouch,
  loadClients: loadTouchClientOptions,
  loadContactOptions: loadEventContactOptions,
  loadForEdit: loadTouchForEdit,
}

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

/** The red "required" asterisk after a label (same as the meeting/event/task forms). */
function Req() {
  return (
    <span className="text-destructive" aria-label="required">
      *
    </span>
  )
}

function emptyForm(): NewTouchInput {
  return {
    clientAccountId: null, // REQUIRED
    subject: "", // REQUIRED
    description: "",
    typeCode: "", // REQUIRED — blank so it is a deliberate choice (was Virtual)
    contactTypeCodes: [], // REQUIRED — at least one
    contacts: [], // OPTIONAL, multi — the client's contacts (touchpoint_contacts)
    outgoing: true,
    start: nowEasternLocal(), // REQUIRED — starts at now, still editable
    durationMinutes: "30", // the Dynamics default on 98% of live touches
    statusKey: "open",
    isTest: NEW_TOUCH_TEST_DEFAULT,
  }
}

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"

/**
 * The touch form, for BOTH create and edit. `editId` set = edit mode: fields
 * start from `initial`, save goes through updateTouch (the server refuses any
 * row that is not origin='dashboard'), and the Test toggle is hidden — is_test
 * is never editable. Mounted fresh per open (keyed by the caller).
 */
function TouchFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
  api = DEFAULT_API,
  typeCodes,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewTouchInput | null
  editId: string | null
  onSaved: () => void
  api?: TouchFormApi
  /** Limit the Touchpoint type options (the Onboarding path: its two types). */
  typeCodes?: readonly string[]
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewTouchInput>(() => initial ?? emptyForm())
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  // Load the client list the first time the form opens: ACTIVE clients only;
  // an edited touchpoint (or a Client Detail quick-add) keeps its own client.
  React.useEffect(() => {
    if (!open || clients) return
    api.loadClients(initial?.clientAccountId ?? null).then((r) => {
      if (r.ok) setClients(r.data)
      else setError(`Could not load clients: ${r.error}`)
    })
  }, [open, clients, initial, api])

  const setText =
    (k: "subject" | "start" | "durationMinutes") => (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  function toggleContactType(code: string, on: boolean) {
    setForm((f) => ({
      ...f,
      contactTypeCodes: on
        ? [...new Set([...f.contactTypeCodes, code])]
        : f.contactTypeCodes.filter((c) => c !== code),
    }))
  }

  // REQUIRED fields: shown once the user has tried to submit, then live.
  const [showErrors, setShowErrors] = React.useState(false)
  const fieldErrors: TouchFieldErrors = showErrors ? validateTouchRequired(form) : {}
  const INVALID_SELECT = "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setShowErrors(true)
    if (Object.keys(validateTouchRequired(form)).length) {
      return setError("Fill in the required fields marked below.")
    }
    startTransition(async () => {
      const r = editId ? await api.update(editId, form) : await api.create(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const client = clients?.find((c) => c.account_id === form.clientAccountId)?.name ?? "client"
      toast.success(
        editId ? "Changes saved" : form.isTest ? `Test touchpoint for ${client} created` : `Touchpoint for ${client} created`,
      )
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        {/* Large, two-column (same treatment as the event, meeting and task
            forms): wide on desktop, one scrolling column on small screens.
            Header and footer stay put; only the field area scrolls. */}
        <DialogContent className="flex max-h-[92vh] w-[96vw] flex-col gap-0 p-0 sm:max-w-[960px]">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle>{editId ? "Edit Touchpoint" : "Add New Touchpoint"}</DialogTitle>
            <DialogDescription>
              {editId ? (
                "Editing a record created in the dashboard. Changes are saved directly and audited."
              ) : (
                <>
              Created directly in the dashboard (not in Dynamics). It appears on this page right away and
              flows everywhere a touchpoint does — including Client Detail and the AI summary.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-x-4 gap-y-2.5 overflow-y-auto px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {/* ---- Column 1: the touchpoint itself ---- */}
              <div className="grid min-w-0 content-start gap-2.5">
                <FormSection panel icon={MessagesSquare} title="Touchpoint">
                  <div className="grid gap-1.5">
                    <Label>
                      Client <Req />
                    </Label>
                    <ClientCombobox
                      options={clients ?? []}
                      value={form.clientAccountId}
                      // A different client = different contacts: clear the old picks.
                      onChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          clientAccountId: v,
                          contacts: v === f.clientAccountId ? f.contacts : [],
                        }))
                      }
                      placeholder={clients ? "Select a client" : "Loading clients…"}
                      invalid={!!fieldErrors.clientAccountId}
                    />
                    <FieldError message={fieldErrors.clientAccountId} />
                  </div>

                  {/* CLIENT CONTACT — multi, client-dependent (2026-10-12): the
                      picked client's contacts only; disabled until a client is
                      chosen. Saved to touchpoint_contacts. */}
                  <div className="grid min-w-0 gap-1.5">
                    <Label htmlFor="nt-contacts">Client Contact</Label>
                    <RepresentativesPicker
                      key={form.clientAccountId ?? "none"}
                      inputId="nt-contacts"
                      clientAccountId={form.clientAccountId}
                      allowAll={false}
                      loadOptions={api.loadContactOptions}
                      value={form.contacts ?? []}
                      onChange={(next) => setForm((f) => ({ ...f, contacts: next }))}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="nt-subject">
                      Subject <Req />
                    </Label>
                    <Input
                      id="nt-subject"
                      value={form.subject}
                      onChange={setText("subject")}
                      aria-invalid={fieldErrors.subject ? true : undefined}
                      aria-describedby={fieldErrors.subject ? "nt-subject-error" : undefined}
                    />
                    <FieldError id="nt-subject-error" message={fieldErrors.subject} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="nt-type">
                        Touchpoint type <Req />
                      </Label>
                      <select
                        id="nt-type"
                        value={form.typeCode}
                        onChange={(e) => setForm((f) => ({ ...f, typeCode: e.target.value }))}
                        aria-invalid={fieldErrors.typeCode ? true : undefined}
                        className={`${SELECT_CLASS} ${INVALID_SELECT}`}
                      >
                        <option value="">Select a type</option>
                        {TOUCH_TYPE_OPTIONS.filter((o) => !typeCodes || typeCodes.includes(o.code)).map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <FieldError message={fieldErrors.typeCode} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="nt-direction">Direction</Label>
                      <select
                        id="nt-direction"
                        value={form.outgoing ? "out" : "in"}
                        onChange={(e) => setForm((f) => ({ ...f, outgoing: e.target.value === "out" }))}
                        className={SELECT_CLASS}
                      >
                        <option value="out">Outgoing</option>
                        <option value="in">Incoming</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label id="nt-ctype-label">
                      Contact type <Req />
                    </Label>
                    <div
                      role="group"
                      aria-labelledby="nt-ctype-label"
                      aria-describedby={fieldErrors.contactTypeCodes ? "nt-ctype-error" : undefined}
                      className={
                        "flex flex-wrap gap-4 rounded-lg border px-2.5 py-2 text-sm " +
                        (fieldErrors.contactTypeCodes ? "border-destructive" : "border-transparent")
                      }
                    >
                      {TOUCH_CONTACT_TYPE_OPTIONS.map((o) => (
                        <label key={o.code} className="flex items-center gap-1.5">
                          <Checkbox
                            checked={form.contactTypeCodes.includes(o.code)}
                            onCheckedChange={(c) => toggleContactType(o.code, c === true)}
                          />
                          {o.label}
                        </label>
                      ))}
                    </div>
                    <FieldError id="nt-ctype-error" message={fieldErrors.contactTypeCodes} />
                  </div>
                </FormSection>
              </div>

              {/* ---- Column 2: when, status, notes ---- */}
              <div className="grid min-w-0 content-start gap-2.5">
                <FormSection panel icon={CalendarClock} title="When & Status">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="nt-start">
                        Date &amp; time (Eastern) <Req />
                      </Label>
                      <Input
                        id="nt-start"
                        type="datetime-local"
                        value={form.start}
                        onChange={setText("start")}
                        aria-invalid={fieldErrors.start ? true : undefined}
                        aria-describedby={fieldErrors.start ? "nt-start-error" : undefined}
                      />
                      <FieldError id="nt-start-error" message={fieldErrors.start} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="nt-duration">Duration (minutes)</Label>
                      <Input
                        id="nt-duration"
                        type="number"
                        min={0}
                        max={1440}
                        value={form.durationMinutes ?? ""}
                        onChange={setText("durationMinutes")}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <SelectField
                      id="nt-status"
                      label="Status"
                      value={form.statusKey}
                      onChange={(v) => setForm((f) => ({ ...f, statusKey: v as NewTouchInput["statusKey"] }))}
                      options={TOUCH_STATUS_OPTIONS.map((o) => ({ value: o.key, label: `${o.statusLabel} (${o.stateLabel})` }))}
                      empty={null}
                    />
                    <div className="grid gap-1.5">
                      <Label>Owner Team</Label>
                      <p className="flex h-8 items-center text-xs text-muted-foreground">
                        Set automatically — the client’s own Dynamics team.
                      </p>
                    </div>
                  </div>
                </FormSection>

                <div className="grid gap-1.5">
                  <Label htmlFor="nt-description">Description</Label>
                  <Textarea
                    id="nt-description"
                    rows={6}
                    value={form.description ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
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
                        Marked TEST and removed by “Delete test touchpoints”. It is NOT hidden anywhere — use the ZZ -
                        Test Client (ZVZZT) while we’re testing.
                      </span>
                    </span>
                  </label>
                )}
              </div>
            </div>

            {error && <div className="border-t px-5 py-2 text-sm text-destructive">{error}</div>}

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
                  editId ? "Save changes" : "Create Touchpoint"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Delete test touches" — the shared purge button, bound to touchpoints. */
export function PurgeTestTouchesButton() {
  return <PurgeTestButton noun="touchpoints" count={countTestTouches} purge={purgeTestTouches} />
}

/** "Add New Touch" — the page button plus a fresh create form per open. */
export function NewTouchButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="touch"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <TouchFormDialog
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
 * Edit an existing touch — opened from the record drawer. Loads the row via
 * loadTouchForEdit, which refuses anything that is not origin='dashboard', so a
 * Dynamics record never reaches this form.
 */
export function EditTouchDialog({
  id,
  onClose,
  onSaved,
  api = DEFAULT_API,
  typeCodes,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
  api?: TouchFormApi
  typeCodes?: readonly string[]
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewTouchInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    api.loadForEdit(id).then((r) => {
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
  }, [id, onClose, api])

  const current = id && loaded?.id === id ? loaded : null
  if (!current) return null
  return (
    <TouchFormDialog
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
      api={api}
      typeCodes={typeCodes}
      onSaved={() => {
        setLoaded(null)
        onSaved(current.id)
      }}
    />
  )
}

/**
 * Client Detail's "+" quick-add — this same create form, opened with the
 * page's client pre-filled (still switchable in the picker, as on /touchpoints).
 * Mounted only while open; closing (or saving) calls onClose.
 *
 * Also the Onboarding page's empty-cell create (2026-10-12): `typeCode` and
 * `subject` pre-fill those fields too, and the Date is left EMPTY for the user
 * to set (`blankDate`). Everything stays editable; the required-field rules
 * are unchanged.
 */
export function NewTouchForClientDialog({
  clientAccountId,
  onClose,
  typeCode,
  subject,
  blankDate = false,
  api,
  typeCodes,
}: {
  clientAccountId: string
  onClose: () => void
  typeCode?: string
  subject?: string
  blankDate?: boolean
  api?: TouchFormApi
  typeCodes?: readonly string[]
}) {
  const [initial] = React.useState(() => ({
    ...emptyForm(),
    clientAccountId,
    ...(typeCode ? { typeCode } : null),
    ...(subject ? { subject } : null),
    ...(blankDate ? { start: "" } : null),
  }))
  return (
    <TouchFormDialog
      open
      setOpen={(o) => {
        if (!o) onClose()
      }}
      initial={initial}
      editId={null}
      onSaved={() => {}}
      api={api}
      typeCodes={typeCodes}
    />
  )
}
