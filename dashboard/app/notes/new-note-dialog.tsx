"use client"

/**
 * "Add New Note" — the second LIVE dashboard create form, a near-copy of
 * app/contacts/new-contact-dialog.tsx — plus the notes test-data purge button.
 *
 * Writes go through createNote / purgeTestNotes in ./actions.ts, which hold the
 * real gate (super_user, not impersonating) and the audit call, via the shared
 * lib/crm-write.ts. Every note it creates is origin='dashboard'; the "Test
 * record" toggle starts ON (NEW_NOTE_TEST_DEFAULT in lib/notes/create.ts).
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
  NEW_NOTE_TEST_DEFAULT,
  NOTE_RISK_SUGGESTIONS,
  defaultReviewCycle,
  validateNoteRequired,
  type NewNoteInput,
  type NoteFieldErrors,
} from "@/lib/notes/create"
import type { AccountOption, UserOption } from "@/lib/types"
import { UserCombobox } from "@/components/user-combobox"
import { FieldError, FormSection } from "@/components/crm-form-kit"
import { countTestNotes, createNote, loadNoteClientOptions, loadNoteUserOptions, purgeTestNotes } from "./actions"
import { loadNoteForEdit, updateNote } from "./actions"

type TextField = "reviewCycle" | "primaryRiskDriver" | "actionStep" | "actionOwner" | "actionDeadline" | "noteDate"

/** The red "required" asterisk after a label (same as the other CRM forms). */
function Req() {
  return (
    <span className="text-destructive" aria-label="required">
      *
    </span>
  )
}

/** Today as YYYY-MM-DD in Eastern — every date on these pages is Eastern. */
function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())
}

function emptyForm(): NewNoteInput {
  const today = todayEastern()
  return {
    clientAccountId: null,
    noteDate: today,
    reviewCycle: defaultReviewCycle(today),
    body: "",
    primaryRiskDriver: "",
    actionStep: "",
    actionOwner: "",
    actionDeadline: "",
    ownerId: null,
    isTest: NEW_NOTE_TEST_DEFAULT,
  }
}

/**
 * The note form, for BOTH create and edit. `editId` set = edit mode: fields
 * start from `initial`, save goes through updateNote (the server refuses any
 * row that is not origin='dashboard'), and the Test toggle is hidden — is_test
 * is never editable. Mounted fresh per open (keyed by the caller).
 */
function NoteFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewNoteInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewNoteInput>(() => initial ?? emptyForm())
  // The review cycle follows the date until the user types their own.
  const [cycleEdited, setCycleEdited] = React.useState(editId != null)
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [users, setUsers] = React.useState<UserOption[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  // Load the pickers the first time the form opens. Clients: ACTIVE only (an
  // edited note keeps its own client). Owner: Rose & Co active personnel (an
  // edited note keeps its own owner, marked "(inactive)" if so).
  React.useEffect(() => {
    if (!open || clients) return
    loadNoteClientOptions(initial?.clientAccountId ?? null).then((r) => {
      if (r.ok) setClients(r.data)
      else setError(`Could not load clients: ${r.error}`)
    })
    loadNoteUserOptions([initial?.ownerId ?? null]).then((r) => (r.ok ? setUsers(r.data) : setError(r.error)))
  }, [open, clients, initial])

  // REQUIRED fields: shown once the user has tried to submit, then live.
  const [showErrors, setShowErrors] = React.useState(false)
  const fieldErrors: NoteFieldErrors = showErrors ? validateNoteRequired(form) : {}

  const set = (k: TextField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    if (k === "reviewCycle") setCycleEdited(true)
    setForm((f) => ({
      ...f,
      [k]: v,
      ...(k === "noteDate" && !cycleEdited ? { reviewCycle: defaultReviewCycle(v) } : null),
    }))
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setShowErrors(true)
    if (Object.keys(validateNoteRequired(form)).length) {
      return setError("Fill in the required fields marked below.")
    }
    startTransition(async () => {
      const r = editId ? await updateNote(editId, form) : await createNote(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      const client = clients?.find((c) => c.account_id === form.clientAccountId)?.name ?? "client"
      toast.success(editId ? "Changes saved" : form.isTest ? `Test note for ${client} created` : `Note for ${client} created`)
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  const field = (
    id: TextField,
    label: React.ReactNode,
    props?: React.ComponentProps<typeof Input>,
    error?: string,
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`nn-${id}`}>{label}</Label>
      <Input
        id={`nn-${id}`}
        value={(form[id] as string) ?? ""}
        onChange={set(id)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `nn-${id}-error` : undefined}
        {...props}
      />
      <FieldError id={`nn-${id}-error`} message={error} />
    </div>
  )

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editId ? "Edit note" : "Add new note"}</DialogTitle>
            <DialogDescription>
              {editId ? (
                "Editing a record created in the dashboard. Changes are saved directly and audited."
              ) : (
                <>
              Created directly in the dashboard (not in Dynamics). It appears on this page right away and
              flows everywhere a note does — My Portfolio, Client Detail, the AI summary and Live Outreach.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
            <div className="grid gap-1.5">
              <Label>
                Client <Req />
              </Label>
              <ClientCombobox
                options={clients ?? []}
                value={form.clientAccountId}
                onChange={(v) => setForm((f) => ({ ...f, clientAccountId: v }))}
                placeholder={clients ? "Select an active client" : "Loading clients…"}
                invalid={!!fieldErrors.clientAccountId}
              />
              <FieldError message={fieldErrors.clientAccountId} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {field("noteDate", <>Note date <Req /></>, { type: "date" }, fieldErrors.noteDate)}
              {/* The note's TITLE — a note has no title column; client_notes.name
                  holds the review cycle. */}
              {field("reviewCycle", <>Title (review cycle) <Req /></>, undefined, fieldErrors.reviewCycle)}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="nn-body">
                Note <Req />
              </Label>
              <Textarea
                id="nn-body"
                rows={5}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                aria-invalid={fieldErrors.body ? true : undefined}
                aria-describedby={fieldErrors.body ? "nn-body-error" : undefined}
              />
              <FieldError id="nn-body-error" message={fieldErrors.body} />
            </div>

            {/* The note "Status" field was removed 2026-10-15: a client's status is
                now its Client Health rating (lib/client-status.ts). status_text
                stays on the record as history, read-only. */}
            <div className="grid gap-3">
              {field("primaryRiskDriver", "Primary risk driver", { list: "nn-risk-options" })}
              <datalist id="nn-risk-options">
                {NOTE_RISK_SUGGESTIONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>

            {field("actionStep", "Action step")}
            <div className="grid grid-cols-2 gap-3">
              {field("actionOwner", "Action owner (initials)")}
              {field("actionDeadline", "Action deadline", { type: "date" })}
            </div>

            <FormSection title="People">
              <div className="grid gap-1.5">
                <Label>Owner</Label>
                <UserCombobox
                  options={users ?? []}
                  value={form.ownerId ?? null}
                  onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))}
                  placeholder="Me (default)"
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
                    Marked TEST and removed by “Delete test notes”. It is NOT hidden anywhere — use the ZZ - Test
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
                  editId ? "Save changes" : "Create note"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** "Delete test notes" — the shared purge button, bound to client_notes. */
export function PurgeTestNotesButton() {
  return <PurgeTestButton noun="notes" count={countTestNotes} purge={purgeTestNotes} />
}

/** "Add New Note" — the page button plus a fresh create form per open. */
export function NewNoteButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="note"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <NoteFormDialog
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
 * Edit an existing note — opened from the record drawer. Loads the row via
 * loadNoteForEdit, which refuses anything that is not origin='dashboard', so a
 * Dynamics record never reaches this form.
 */
export function EditNoteDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewNoteInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadNoteForEdit(id).then((r) => {
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
    <NoteFormDialog
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

/**
 * Client Detail's "+" quick-add — this same create form, opened with the
 * page's client pre-filled (still switchable in the picker, as on /notes).
 * Mounted only while open; closing (or saving) calls onClose.
 */
export function NewNoteForClientDialog({
  clientAccountId,
  onClose,
}: {
  clientAccountId: string
  onClose: () => void
}) {
  const [initial] = React.useState(() => ({ ...emptyForm(), clientAccountId }))
  return (
    <NoteFormDialog
      open
      setOpen={(o) => {
        if (!o) onClose()
      }}
      initial={initial}
      editId={null}
      onSaved={() => {}}
    />
  )
}
