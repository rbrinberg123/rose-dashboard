"use client"

/**
 * "New Time Off" — the create form, reused in edit mode from the drawer — plus
 * the test-data purge button. Same shape as the CRM Add New forms
 * (app/notes/new-note-dialog.tsx).
 *
 * The HALF-DAY picker: once a range is chosen, every day in it is listed. Each
 * working day defaults to Full and can be switched to a half — AM or PM.
 * Weekends and NYSE holidays are listed greyed as "not counted" and get no day
 * row (lib/time-off-requests/model.ts). The running total is shown live; the
 * server re-derives it (public.time_off_set_days) — this number is a preview.
 *
 * Writes go through ./actions.ts, which holds the real gates. See
 * content/docs/23-time-off.md.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { AddNewButton, useQuickAddRequest } from "@/components/crm-add-new"
import { FormSection, SELECT_CLASS } from "@/components/crm-form-kit"
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
  NEW_TIME_OFF_TEST_DEFAULT,
  TIME_OFF_REQUEST_TYPES,
  buildDays,
  formatDays,
  rangeDays,
  totalDays,
  type TimeOffInput,
  type TimeOffPortion,
  type TimeOffRequestType,
} from "@/lib/time-off-requests/model"
import type { UserOption } from "@/lib/types"
import { cn } from "@/lib/utils"
import {
  countTestTimeOff,
  createTimeOffRequest,
  loadReviewingTeam,
  loadTimeOffForEdit,
  loadTimeOffUserOptions,
  purgeTestTimeOff,
  updateTimeOffRequest,
} from "./actions"

/** Today as YYYY-MM-DD in Eastern — every date here is Eastern. */
function todayEastern(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date())
}

function emptyForm(): TimeOffInput {
  const today = todayEastern()
  return {
    requestedById: null,
    requestType: "",
    startDate: today,
    endDate: today,
    portions: {},
    description: "",
    comments: "",
    isTest: NEW_TIME_OFF_TEST_DEFAULT,
  }
}

/** "Mon, Oct 12" for a YYYY-MM-DD, read as a calendar day (no zone shift). */
function dayLabel(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  })
}

const PORTION_LABEL: Record<TimeOffPortion, string> = { Full: "Full", AM: "½ AM", PM: "½ PM" }

/** The per-day list with a Full / ½ AM / ½ PM toggle on each working day. */
function DayPicker({
  start,
  end,
  portions,
  onChange,
}: {
  start: string
  end: string
  portions: Record<string, TimeOffPortion>
  onChange: (date: string, portion: TimeOffPortion) => void
}) {
  const days = rangeDays(start, end)
  if (days.length === 0) {
    return <div className="text-sm text-muted-foreground">Pick a start and end date.</div>
  }
  return (
    <div className="max-h-56 overflow-y-auto rounded-md border border-[#E4E9F4]">
      {days.map((d) => (
        <div
          key={d.date}
          className={cn(
            "flex items-center justify-between gap-2 border-b px-2.5 py-1 text-sm last:border-b-0",
            !d.counted && "bg-[#F7F8FA] text-muted-foreground",
          )}
        >
          <span className="tabular-nums">{dayLabel(d.date)}</span>
          {d.counted ? (
            <div className="flex gap-1" role="radiogroup" aria-label={`Portion for ${dayLabel(d.date)}`}>
              {(["Full", "AM", "PM"] as const).map((p) => {
                const active = (portions[d.date] ?? "Full") === p
                return (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => onChange(d.date, p)}
                    className={cn(
                      "h-6 rounded-md border px-2 text-[12px]",
                      active
                        ? "border-[#0355A7] bg-[#0355A7] text-white"
                        : "border-input bg-background hover:bg-muted",
                    )}
                  >
                    {PORTION_LABEL[p]}
                  </button>
                )
              })}
            </div>
          ) : (
            <span className="text-[12px]">
              {d.reason === "holiday" ? "Market holiday" : "Weekend"} — not counted
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * The form, for BOTH create and edit. `editId` set = edit mode: fields start
 * from `initial`, save goes through updateTimeOffRequest, and the Test toggle
 * is hidden (is_test is never editable). Mounted fresh per open.
 */
function TimeOffFormDialog({
  open,
  setOpen,
  initial,
  editId,
  onSaved,
}: {
  open: boolean
  setOpen: (o: boolean) => void
  initial: TimeOffInput | null
  editId: string | null
  onSaved: () => void
}) {
  const router = useRouter()
  const [form, setForm] = React.useState<TimeOffInput>(() => initial ?? emptyForm())
  const [users, setUsers] = React.useState<UserOption[] | null>(null)
  const [team, setTeam] = React.useState<{ person: string | null; names: string[] } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [pending, startTransition] = React.useTransition()

  React.useEffect(() => {
    if (!open || users) return
    loadTimeOffUserOptions().then((r) => (r.ok ? setUsers(r.data) : setError(r.error)))
  }, [open, users])

  // The reviewing team follows the chosen person, resolved live on the server.
  React.useEffect(() => {
    if (!open) return
    let live = true
    loadReviewingTeam(form.requestedById).then((r) => {
      if (live) setTeam({ person: form.requestedById, names: r.ok ? r.data : [] })
    })
    return () => {
      live = false
    }
  }, [open, form.requestedById])

  const days = buildDays(form.startDate, form.endDate, form.portions)
  const total = totalDays(days)

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!form.requestType) return setError("Pick a request type.")
    if (!form.startDate || !form.endDate) return setError("Enter the start and end dates.")
    if (form.endDate < form.startDate) return setError("The end date is before the start date.")
    if (days.length === 0) return setError("That range has no working days.")
    startTransition(async () => {
      const r = editId ? await updateTimeOffRequest(editId, form) : await createTimeOffRequest(form)
      if (!r.ok) {
        setError(r.error)
        return
      }
      toast.success(
        editId
          ? "Changes saved"
          : `${form.isTest ? "Test time off request" : "Time off request"} submitted — ${formatDays(r.data.totalDays)}, pending approval`,
      )
      setOpen(false)
      router.refresh()
      onSaved()
    })
  }

  const teamNames = team && team.person === form.requestedById ? team.names : null

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editId ? "Edit time off request" : "New time off request"}</DialogTitle>
          <DialogDescription>
            {editId
              ? "Super-user edit of a dashboard request. Changing dates or halves re-derives the days and total. Audited."
              : "Submitted as Pending. The person's reviewing team approves or denies it; approved requests show on Time Off and the OOO Summary."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid max-h-[72vh] gap-3 overflow-y-auto pr-1">
          <div className="grid gap-1.5">
            <Label>Requested by</Label>
            <UserCombobox
              options={users ?? []}
              value={form.requestedById}
              onChange={(v) => setForm((f) => ({ ...f, requestedById: v }))}
              placeholder={users ? "Me (default)" : "Loading people…"}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="to-type">Request type</Label>
            <select
              id="to-type"
              value={form.requestType}
              onChange={(e) =>
                setForm((f) => ({ ...f, requestType: e.target.value as TimeOffRequestType | "" }))
              }
              className={SELECT_CLASS}
            >
              <option value="">— Pick a type</option>
              {TIME_OFF_REQUEST_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="to-start">Start date (ET)</Label>
              <Input
                id="to-start"
                type="date"
                value={form.startDate}
                onChange={(e) => {
                  const v = e.target.value
                  // Keep the range valid: an end before the new start follows it.
                  setForm((f) => ({ ...f, startDate: v, endDate: !f.endDate || f.endDate < v ? v : f.endDate }))
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to-end">End date (ET)</Label>
              <Input
                id="to-end"
                type="date"
                value={form.endDate}
                min={form.startDate || undefined}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between">
              <Label>Days</Label>
              <span className="text-sm font-semibold tabular-nums">Total: {formatDays(total)}</span>
            </div>
            <DayPicker
              start={form.startDate}
              end={form.endDate}
              portions={form.portions}
              onChange={(date, portion) =>
                setForm((f) => ({ ...f, portions: { ...f.portions, [date]: portion } }))
              }
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Reviewing team</Label>
            <div className="rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2.5 py-1.5 text-sm">
              {teamNames === null ? (
                <span className="text-muted-foreground">Loading…</span>
              ) : teamNames.length === 0 ? (
                <span className="text-amber-800">
                  No reviewers assigned — nobody can approve this until one is set in Admin → Time Off
                  Reviewers.
                </span>
              ) : (
                teamNames.join(", ")
              )}
            </div>
          </div>

          <FormSection title="Details">
            <div className="grid gap-1.5">
              <Label htmlFor="to-desc">Description</Label>
              <Textarea
                id="to-desc"
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to-comments">Comments</Label>
              <Textarea
                id="to-comments"
                rows={2}
                value={form.comments}
                onChange={(e) => setForm((f) => ({ ...f, comments: e.target.value }))}
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
                  Marked TEST and removed by “Delete test requests”. It is NOT hidden — an approved
                  test request shows on the OOO Summary until it is deleted.
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
              ) : editId ? (
                "Save changes"
              ) : (
                "Submit request"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Delete test requests" — the shared purge button, bound to time_off_requests. */
export function PurgeTestTimeOffButton() {
  return <PurgeTestButton noun="requests" count={countTestTimeOff} purge={purgeTestTimeOff} />
}

/** "Add New Time Off" — the page button plus a fresh create form per open. */
export function NewTimeOffButton() {
  const [open, setOpen] = React.useState(false)
  const [mount, setMount] = React.useState(0)
  // The nav quick-add lands here with ?new=1 — open the same form.
  const quick = useQuickAddRequest()
  return (
    <>
      <AddNewButton
        entity="time_off"
        onClick={() => {
          setMount((m) => m + 1)
          setOpen(true)
        }}
      />
      <TimeOffFormDialog
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

/** Edit a dashboard request — opened from the drawer (super-user only). */
export function EditTimeOffDialog({
  id,
  onClose,
  onSaved,
}: {
  id: string | null
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const [loaded, setLoaded] = React.useState<{ id: string; input: TimeOffInput } | null>(null)

  React.useEffect(() => {
    if (!id) return
    let live = true
    loadTimeOffForEdit(id).then((r) => {
      if (!live) return
      if (r.ok) setLoaded({ id, input: r.data })
      else {
        toast.error("This request can't be edited", { description: r.error })
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
    <TimeOffFormDialog
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
