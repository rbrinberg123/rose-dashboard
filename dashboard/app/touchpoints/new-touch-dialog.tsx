"use client"

/**
 * "Add New Touch" — the third LIVE dashboard create form, a near-copy of
 * app/notes/new-note-dialog.tsx — plus the touches test-data purge button.
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
  NEW_TOUCH_TEST_DEFAULT,
  TOUCH_CONTACT_TYPE_OPTIONS,
  TOUCH_STATUS_OPTIONS,
  TOUCH_TYPE_OPTIONS,
  type NewTouchInput,
} from "@/lib/touchpoints/create"
import type { AccountOption } from "@/lib/types"
import { SelectField } from "@/components/crm-form-kit"
import { countTestTouches, createTouch, loadTouchClientOptions, purgeTestTouches } from "./actions"
import { loadTouchForEdit, updateTouch } from "./actions"

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

function emptyForm(): NewTouchInput {
  return {
    clientAccountId: null,
    subject: "",
    description: "",
    typeCode: TOUCH_TYPE_OPTIONS[0].code, // Virtual — 83% of live touches
    contactTypeCodes: [],
    outgoing: true,
    start: nowEasternLocal(),
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
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewTouchInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewTouchInput>(() => initial ?? emptyForm())
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  // Load the client list the first time the form opens.
  React.useEffect(() => {
    if (!open || clients) return
    loadTouchClientOptions().then((r) => {
      if (r.ok) setClients(r.data)
      else setError(`Could not load clients: ${r.error}`)
    })
  }, [open, clients])

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

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.clientAccountId) return setError("Pick a client.")
    if (!form.subject.trim()) return setError("Enter a subject.")
    if (!form.start) return setError("Enter the date and time.")
    startTransition(async () => {
      const r = editId ? await updateTouch(editId, form) : await createTouch(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const client = clients?.find((c) => c.account_id === form.clientAccountId)?.name ?? "client"
      toast.success(editId ? "Changes saved" : form.isTest ? `Test touch for ${client} created` : `Touch for ${client} created`)
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
            <DialogTitle>{editId ? "Edit touch" : "Add new touch"}</DialogTitle>
            <DialogDescription>
              {editId ? (
                "Editing a record created in the dashboard. Changes are saved directly and audited."
              ) : (
                <>
              Created directly in the dashboard (not in Dynamics). It appears on this page right away and
              flows everywhere a touch does — including Client Detail and the AI summary.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Client</Label>
              <ClientCombobox
                options={clients ?? []}
                value={form.clientAccountId}
                onChange={(v) => setForm((f) => ({ ...f, clientAccountId: v }))}
                placeholder={clients ? "Select a client" : "Loading clients…"}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nt-subject">Subject</Label>
              <Input id="nt-subject" value={form.subject} onChange={setText("subject")} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nt-type">Touch type</Label>
                <select
                  id="nt-type"
                  value={form.typeCode}
                  onChange={(e) => setForm((f) => ({ ...f, typeCode: e.target.value }))}
                  className={SELECT_CLASS}
                >
                  {TOUCH_TYPE_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="nt-start">Date &amp; time (Eastern)</Label>
                <Input id="nt-start" type="datetime-local" value={form.start} onChange={setText("start")} />
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

            <div className="grid gap-1.5">
              <Label>Contact type</Label>
              <div className="flex flex-wrap gap-4 text-sm">
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
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nt-description">Description</Label>
              <Textarea
                id="nt-description"
                rows={4}
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
                    Marked TEST and removed by “Delete test touches”. It is NOT hidden anywhere — use the ZZ -
                    Test Client (ZVZZT) while we’re testing.
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
                  editId ? "Save changes" : "Create touch"
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
  return <PurgeTestButton noun="touches" count={countTestTouches} purge={purgeTestTouches} />
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
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewTouchInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadTouchForEdit(id).then((r) => {
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
      onSaved={() => {
        setLoaded(null)
        onSaved(current.id)
      }}
    />
  )
}
