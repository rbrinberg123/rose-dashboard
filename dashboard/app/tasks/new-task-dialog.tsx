"use client"

/**
 * "Add New Task" — a LIVE dashboard create form, a near-copy of the other
 * new-*-dialog.tsx files — plus the tasks test-data purge button.
 *
 * Writes go through createTask / purgeTestTasks in ./actions.ts (gate, audit,
 * re-reads via the shared lib/crm-write.ts). Every task it creates is
 * origin='dashboard'; "Test record" starts ON (NEW_TASK_TEST_DEFAULT).
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { CalendarClock, ListChecks, Loader2, Users, Workflow } from "lucide-react"
import { toast } from "sonner"

import { AddNewButton, useQuickAddRequest } from "@/components/crm-add-new"
import { ClientCombobox } from "@/components/client-combobox"
import { PurgeTestButton } from "@/components/purge-test-button"
import { UserCombobox } from "@/components/user-combobox"
import { FieldError, FormSection, SelectField, TextField, YesNo } from "@/components/crm-form-kit"
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
  NEW_TASK_TEST_DEFAULT,
  TASK_OUTREACH_STATUS_OPTIONS,
  TASK_PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
  TASK_TYPE_OPTIONS,
  validateTaskRequired,
  type NewTaskInput,
  type TaskFieldErrors,
} from "@/lib/tasks/create"
import type { AccountOption, UserOption } from "@/lib/types"
import {
  countTestTasks,
  createTask,
  loadTaskClientOptions,
  loadTaskEventOptions,
  loadTaskUserOptions,
  purgeTestTasks,
} from "./actions"
import { loadTaskForEdit, updateTask } from "./actions"

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
type EventOption = { event_id: string; name: string | null; event_state_label: string | null }

/** The red "required" asterisk after a label (same as the meeting/event forms). */
function Req() {
  return (
    <span className="text-destructive" aria-label="required">
      *
    </span>
  )
}

function emptyForm(): NewTaskInput {
  return {
    clientAccountId: null, // OPTIONAL
    subject: "", // REQUIRED
    description: "",
    typeCode: null, // REQUIRED — blank so it is a deliberate choice
    subtypeCode: null, // REQUIRED — picked from the chosen type's list
    priorityCode: null,
    statusKey: "not_started",
    dueDate: "",
    regarding: "client",
    ownerId: null,
    eventId: null,
    percentComplete: "",
    scheduledStart: "",
    actualStart: "",
    actualEnd: "",
    claimedById: null,
    currentAssignmentId: null,
    outreachStatusCode: null,
    drafting: false,
    draftComplete: false,
    reviewComplete: false,
    processed: false,
    feedbackReceived: false,
    feedbackReceivedDate: "",
    notified: false,
    isTest: NEW_TASK_TEST_DEFAULT,
  }
}

/**
 * The task form, for BOTH create and edit. `editId` set = edit mode: fields
 * start from `initial`, save goes through updateTask (the server refuses any
 * row that is not origin='dashboard'), and the Test toggle is hidden — is_test
 * is never editable. Mounted fresh per open (keyed by the caller).
 */
function TaskFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: NewTaskInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<NewTaskInput>(() => initial ?? emptyForm())
  const [clients, setClients] = React.useState<AccountOption[] | null>(null)
  const [users, setUsers] = React.useState<UserOption[] | null>(null)
  const [events, setEvents] = React.useState<EventOption[]>([])
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open || clients) return
    // Active clients only; an edited task (or a Client Detail quick-add) keeps its own client listed.
    loadTaskClientOptions(initial?.clientAccountId ?? null).then((r) => (r.ok ? setClients(r.data) : setError(r.error)))
    // Rose & Co active personnel; people already on this task stay listed
    // (marked "(inactive)") so an edit never loses them.
    loadTaskUserOptions([
      initial?.ownerId ?? null,
      initial?.claimedById ?? null,
      initial?.currentAssignmentId ?? null,
    ]).then((r) => (r.ok ? setUsers(r.data) : setError(r.error)))
  }, [open, clients, initial])

  // The client's events, for "Regarding".
  React.useEffect(() => {
    if (!form.clientAccountId) return
    let live = true
    loadTaskEventOptions(form.clientAccountId).then((r) => {
      if (live) setEvents(r.ok ? r.data : [])
    })
    return () => {
      live = false
    }
  }, [form.clientAccountId])

  const type = TASK_TYPE_OPTIONS.find((t) => t.code === form.typeCode) ?? null
  // No client → no events to offer (the effect above keeps the last client's).
  const clientEvents = form.clientAccountId ? events : []

  // REQUIRED fields: shown once the user has tried to submit, then live.
  const [showErrors, setShowErrors] = React.useState(false)
  const fieldErrors: TaskFieldErrors = showErrors ? validateTaskRequired(form) : {}

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setShowErrors(true)
    if (Object.keys(validateTaskRequired(form)).length) {
      return setError("Fill in the required fields marked below.")
    }
    startTransition(async () => {
      const r = editId ? await updateTask(editId, form) : await createTask(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success(editId ? "Changes saved" : form.isTest ? "Test task created" : "Task created")
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        {/* Large, multi-column (same treatment as the event and meeting forms):
            most of the screen on desktop, one scrolling column on small
            screens. Header and footer stay put; only the field area scrolls. */}
        <DialogContent className="flex max-h-[92vh] w-[96vw] flex-col gap-0 p-0 sm:max-w-[1080px]">
          <DialogHeader className="border-b px-5 py-3">
            <DialogTitle>{editId ? "Edit task" : "Add new task"}</DialogTitle>
            <DialogDescription>
              {editId ? (
                "Editing a record created in the dashboard. Changes are saved directly and audited."
              ) : (
                <>
              Created directly in the dashboard (not in Dynamics). It appears on this page right away and flows
              everywhere a task does.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 gap-x-4 gap-y-2.5 overflow-y-auto px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              {/* ---- Column 1: the task itself ---- */}
              <div className="grid min-w-0 content-start gap-2.5">
                <FormSection panel icon={ListChecks} title="Task">
                  <div className="grid gap-1.5">
                    <Label htmlFor="nk-subject">
                      Subject <Req />
                    </Label>
                    <Input
                      id="nk-subject"
                      value={form.subject}
                      onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                      aria-invalid={fieldErrors.subject ? true : undefined}
                      aria-describedby={fieldErrors.subject ? "nk-subject-error" : undefined}
                    />
                    <FieldError id="nk-subject-error" message={fieldErrors.subject} />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="nk-type">
                        Task type <Req />
                      </Label>
                      <select
                        id="nk-type"
                        value={form.typeCode ?? ""}
                        onChange={(e) => {
                          const t = TASK_TYPE_OPTIONS.find((x) => x.code === Number(e.target.value)) ?? null
                          // A new type clears the subtype — it must be picked from the new list.
                          setForm((f) => ({ ...f, typeCode: t?.code ?? null, subtypeCode: null }))
                        }}
                        aria-invalid={fieldErrors.typeCode ? true : undefined}
                        className={`${SELECT_CLASS} aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20`}
                      >
                        <option value="">Select a type</option>
                        {TASK_TYPE_OPTIONS.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                      <FieldError message={fieldErrors.typeCode} />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="nk-subtype">
                        Task subtype <Req />
                      </Label>
                      <select
                        id="nk-subtype"
                        value={form.subtypeCode ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, subtypeCode: e.target.value ? Number(e.target.value) : null }))
                        }
                        disabled={!type}
                        aria-invalid={fieldErrors.subtypeCode ? true : undefined}
                        className={`${SELECT_CLASS} aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20`}
                      >
                        <option value="">{type ? "Select a subtype" : "Pick a type first"}</option>
                        {(type?.subtypes ?? []).map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <FieldError message={fieldErrors.subtypeCode} />
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    {/* OPTIONAL (2026-10-12): a task may have no client. */}
                    <Label>Client</Label>
                    <ClientCombobox
                      options={clients ?? []}
                      value={form.clientAccountId}
                      onChange={(v) => setForm((f) => ({ ...f, clientAccountId: v, regarding: "client", eventId: null }))}
                      placeholder={clients ? "Select a client (optional)" : "Loading clients…"}
                    />
                  </div>

                  {/* minmax(0,1fr), not grid-cols-2's 1fr (= minmax(auto,1fr)): a
                      native select's min-content width is its LONGEST option, so a
                      long event name would otherwise widen the track past the
                      column. The selects are w-full + truncate so long text clips
                      with an ellipsis instead of widening the box. */}
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <div className="grid min-w-0 gap-1.5">
                      <Label htmlFor="nk-regarding">Regarding</Label>
                      <select
                        id="nk-regarding"
                        value={form.regarding}
                        onChange={(e) => setForm((f) => ({ ...f, regarding: e.target.value }))}
                        className={`${SELECT_CLASS} w-full min-w-0 truncate`}
                        disabled={!form.clientAccountId}
                      >
                        <option value="client">{form.clientAccountId ? "The client" : "— no client —"}</option>
                        {clientEvents.map((ev) => (
                          <option key={ev.event_id} value={ev.event_id}>
                            Event: {ev.name ?? ev.event_id}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* The shared SelectField takes no className, so the same
                        width constraint is applied to its select from here. */}
                    <div className="min-w-0 [&_select]:w-full [&_select]:min-w-0 [&_select]:truncate">
                      <SelectField
                        id="nk-event"
                        label="Event"
                        value={form.regarding !== "client" ? form.regarding : (form.eventId ?? "")}
                        onChange={(v) => setForm((f) => ({ ...f, eventId: v || null }))}
                        options={clientEvents.map((ev) => ({ value: ev.event_id, label: ev.name ?? ev.event_id }))}
                        empty="— none —"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="nk-priority">Priority</Label>
                      <select
                        id="nk-priority"
                        value={form.priorityCode ?? ""}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, priorityCode: e.target.value ? Number(e.target.value) : null }))
                        }
                        className={SELECT_CLASS}
                      >
                        <option value="">—</option>
                        {TASK_PRIORITY_OPTIONS.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="nk-status">Status</Label>
                      <select
                        id="nk-status"
                        value={form.statusKey}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, statusKey: e.target.value as NewTaskInput["statusKey"] }))
                        }
                        className={SELECT_CLASS}
                      >
                        {TASK_STATUS_OPTIONS.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.statusLabel}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="nk-due">Due date</Label>
                      <Input
                        id="nk-due"
                        type="date"
                        value={form.dueDate ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="nk-description">Description</Label>
                    <Textarea
                      id="nk-description"
                      rows={5}
                      value={form.description ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    />
                  </div>
                </FormSection>

                <FormSection panel quiet icon={CalendarClock} title="Dates & Progress">
                  <div className="grid grid-cols-2 gap-3">
                    <TextField
                      id="nk-sstart"
                      label="Scheduled Start"
                      type="date"
                      value={form.scheduledStart}
                      onChange={(v) => setForm((f) => ({ ...f, scheduledStart: v }))}
                    />
                    <TextField
                      id="nk-pct"
                      label="% Complete"
                      type="number"
                      min={0}
                      max={100}
                      value={form.percentComplete}
                      onChange={(v) => setForm((f) => ({ ...f, percentComplete: v }))}
                    />
                    <TextField
                      id="nk-astart"
                      label="Actual Start"
                      type="date"
                      value={form.actualStart}
                      onChange={(v) => setForm((f) => ({ ...f, actualStart: v }))}
                    />
                    <TextField
                      id="nk-aend"
                      label="Actual End"
                      type="date"
                      value={form.actualEnd}
                      onChange={(v) => setForm((f) => ({ ...f, actualEnd: v }))}
                    />
                  </div>
                </FormSection>
              </div>

              {/* ---- Column 2: people + workflow ---- */}
              <div className="grid min-w-0 content-start gap-2.5">
                {/* All three pickers: Rose & Co ACTIVE personnel (loadPersonnelOptions). */}
                <FormSection panel icon={Users} title="People">
                  <div className="grid gap-1.5">
                    <Label>Owner</Label>
                    <UserCombobox
                      options={users ?? []}
                      value={form.ownerId}
                      onChange={(v) => setForm((f) => ({ ...f, ownerId: v }))}
                      placeholder="Me (default)"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label>Claimed By</Label>
                      <UserCombobox
                        options={users ?? []}
                        value={form.claimedById ?? null}
                        onChange={(v) => setForm((f) => ({ ...f, claimedById: v }))}
                        placeholder="—"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Current Assignment</Label>
                      <UserCombobox
                        options={users ?? []}
                        value={form.currentAssignmentId ?? null}
                        onChange={(v) => setForm((f) => ({ ...f, currentAssignmentId: v }))}
                        placeholder="—"
                      />
                    </div>
                  </div>
                </FormSection>

                <FormSection panel quiet icon={Workflow} title="Workflow">
                  <SelectField
                    id="nk-outreach"
                    label="Outreach Task Status"
                    value={form.outreachStatusCode ?? ""}
                    onChange={(v) => setForm((f) => ({ ...f, outreachStatusCode: v ? Number(v) : null }))}
                    options={TASK_OUTREACH_STATUS_OPTIONS.map((o) => ({ value: o.code, label: o.label }))}
                  />
                  <TextField
                    id="nk-fbrec"
                    label="Feedback Received Date — drives the feedback pipeline (with Status = Open)"
                    type="date"
                    value={form.feedbackReceivedDate}
                    onChange={(v) => setForm((f) => ({ ...f, feedbackReceivedDate: v }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <YesNo label="Drafting" checked={form.drafting} onChange={(v) => setForm((f) => ({ ...f, drafting: v }))} />
                    <YesNo label="Draft Complete" checked={form.draftComplete} onChange={(v) => setForm((f) => ({ ...f, draftComplete: v }))} />
                    <YesNo label="Review Complete" checked={form.reviewComplete} onChange={(v) => setForm((f) => ({ ...f, reviewComplete: v }))} />
                    <YesNo label="Processed" checked={form.processed} onChange={(v) => setForm((f) => ({ ...f, processed: v }))} />
                    <YesNo
                      label="Feedback Received (legacy, info only)"
                      checked={form.feedbackReceived}
                      onChange={(v) => setForm((f) => ({ ...f, feedbackReceived: v }))}
                    />
                    <YesNo label="Notified" checked={form.notified} onChange={(v) => setForm((f) => ({ ...f, notified: v }))} />
                  </div>
                </FormSection>

                {!editId && (
                  <TestToggle
                    checked={form.isTest}
                    onChange={(c) => setForm((f) => ({ ...f, isTest: c }))}
                    noun="tasks"
                  />
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
                  editId ? "Save changes" : "Create task"
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

function TestToggle({
  checked,
  onChange,
  noun,
}: {
  checked: boolean
  onChange: (c: boolean) => void
  noun: string
}) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-[#F3E2BF] bg-[#FCF4E6] px-3 py-2 text-sm">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(c === true)} className="mt-0.5" />
      <span>
        <span className="font-medium">Test record</span>
        <span className="block text-xs text-muted-foreground">
          Marked TEST and removed by “Delete test {noun}”. It is NOT hidden anywhere — use the ZZ - Test Client
          (ZVZZT) while we’re testing.
        </span>
      </span>
    </label>
  )
}

/** "Delete test tasks" — the shared purge button, bound to tasks. */
export function PurgeTestTasksButton() {
  return <PurgeTestButton noun="tasks" count={countTestTasks} purge={purgeTestTasks} />
}

/** "Add New Task" — the page button plus a fresh create form per open. */
export function NewTaskButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="task"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <TaskFormDialog
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
 * Edit an existing task — opened from the record drawer. Loads the row via
 * loadTaskForEdit, which refuses anything that is not origin='dashboard', so a
 * Dynamics record never reaches this form.
 */
export function EditTaskDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: NewTaskInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadTaskForEdit(id).then((r) => {
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
    <TaskFormDialog
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
 * page's client pre-filled (still switchable in the picker, as on /tasks).
 * Mounted only while open; closing (or saving) calls onClose.
 */
export function NewTaskForClientDialog({
  clientAccountId,
  onClose,
}: {
  /** null = no client pre-filled (Onboarding's general quick-add). */
  clientAccountId: string | null
  onClose: () => void
}) {
  const [initial] = React.useState(() => ({ ...emptyForm(), clientAccountId }))
  return (
    <TaskFormDialog
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
