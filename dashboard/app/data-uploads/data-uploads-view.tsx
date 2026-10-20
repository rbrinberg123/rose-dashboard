"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, ExternalLink, Loader2, Paperclip } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { BRAND_NAVY, CARD_CLASS, DEEP_TEAL, TEAL, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"
import { ClientCombobox } from "@/components/client-combobox"
import type { DataUploadRow } from "@/lib/data-upload/load"
import type { AccountOption } from "@/lib/types"
import { completeDataUploadTask, setDataUploadClient } from "./actions"

const DAY_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
})
const STAMP_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
})

const fmtDay = (iso: string | null) => (iso ? DAY_FMT.format(new Date(iso)) : "—")
const fmtStamp = (iso: string | null) => (iso ? `${STAMP_FMT.format(new Date(iso))} ET` : "—")

/** Due before today (Eastern)? Compared as YYYY-MM-DD strings. */
function isOverdue(iso: string | null): boolean {
  if (!iso) return false
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(d)
  return day(new Date(iso)) < day(new Date())
}

const sender = (r: DataUploadRow) => r.senderName || r.senderAddress || "—"

/** The hint under the Client field: how the poll picked it (data_crm_mail_messages.match_source). */
function matchHint(matchSource: string | null): string | null {
  if (!matchSource) return null
  const [kind, detail] = matchSource.split(":")
  if (kind === "ambiguous") return `Not auto-set: ${detail} clients matched the email — pick one.`
  if (kind === "none") return "Not auto-set: only the subject could be read."
  const how = { ticker: "ticker", name: "company name", sender_domain: "sender's email domain" }[kind]
  if (!how) return null
  const where = { subject: " in the subject", attachment: " in an attachment name", body: " in the email body" }[detail ?? ""] ?? ""
  return `Auto-matched by ${how}${where}.`
}

/** The required-client hint shared by the card and the server's refusal. */
const SET_CLIENT_HINT = "Set the client before closing."

/**
 * The open Data Upload list + the detail sheet. The card's Client is REQUIRED
 * before Mark complete (the server refuses without one — clientRequiredToClose);
 * auto-matched tasks arrive pre-filled. `editBlocked` / `completeBlocked` (View
 * as / no CRM user) disable the controls with their reason; the server refuses
 * those anyway. Completed tasks drop off on refresh; the row is hidden at once.
 */
export function DataUploadsView({
  rows,
  clientOptions,
  editBlocked,
  completeBlocked,
}: {
  rows: DataUploadRow[]
  clientOptions: AccountOption[]
  editBlocked: string | null
  completeBlocked: string | null
}) {
  const [openId, setOpenId] = React.useState<string | null>(null)
  // Optimistic hide, keyed to the rows it was made against (falls away on refresh).
  const [done, setDone] = React.useState<{ base: DataUploadRow[]; ids: Set<string> }>({ base: rows, ids: new Set() })
  const doneIds = done.base === rows ? done.ids : new Set<string>()
  // Optimistic client picks, keyed the same way.
  const [picked, setPicked] = React.useState<{ base: DataUploadRow[]; byTask: Map<string, { id: string; name: string }> }>({
    base: rows,
    byTask: new Map(),
  })
  const pickedByTask = picked.base === rows ? picked.byTask : new Map<string, { id: string; name: string }>()
  const visible = rows
    .filter((r) => !doneIds.has(r.taskId))
    .map((r) => {
      const p = pickedByTask.get(r.taskId)
      return p ? { ...r, clientId: p.id, clientName: p.name } : r
    })
  const open = visible.find((r) => r.taskId === openId) ?? null
  const setPick = (taskId: string, id: string, name: string) =>
    setPicked((cur) => {
      const byTask = new Map(cur.base === rows ? cur.byTask : [])
      byTask.set(taskId, { id, name })
      return { base: rows, byTask }
    })

  const markDone = (id: string) => {
    setDone((cur) => ({ base: rows, ids: new Set([...(cur.base === rows ? cur.ids : []), id]) }))
    setOpenId(null)
  }

  return (
    <>
      <div className={CARD_CLASS + " overflow-x-auto"}>
        <table className="w-full min-w-[720px] table-fixed text-[12.5px]">
          <colgroup>
            <col style={{ width: "44%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "18%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Task</th>
              <th className="px-3 py-2 text-left font-medium">Client</th>
              <th className="px-3 py-2 text-left font-medium">From</th>
              <th className="px-3 py-2 text-left font-medium">Received</th>
              <th className="px-3 py-2 text-left font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No open Data Upload tasks.
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr
                  key={r.taskId}
                  className="cursor-pointer border-t border-slate-100 hover:bg-[#F8FAFC]"
                  onClick={() => setOpenId(r.taskId)}
                >
                  <td className="truncate px-3 py-2 font-medium" style={{ color: BRAND_NAVY }} title={r.title}>
                    <button
                      type="button"
                      className="max-w-full truncate text-left hover:underline"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpenId(r.taskId)
                      }}
                    >
                      {r.title}
                    </button>
                    {r.isTest ? (
                      <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800">TEST</span>
                    ) : null}
                  </td>
                  <td className="truncate px-3 py-2" style={{ color: TEXT_PRIMARY }} title={r.clientName ?? undefined}>
                    {r.clientName ?? <span style={{ color: "#B42318" }}>Set client</span>}
                  </td>
                  <td className="truncate px-3 py-2" style={{ color: TEXT_PRIMARY }} title={r.senderAddress ?? undefined}>
                    {sender(r)}
                  </td>
                  <td className="truncate px-3 py-2 tabular-nums" style={{ color: TEXT_MUTED }}>
                    {fmtDay(r.receivedAt)}
                  </td>
                  <td
                    className="truncate px-3 py-2 tabular-nums"
                    style={{ color: isOverdue(r.due) ? "#B42318" : TEXT_MUTED }}
                    title={isOverdue(r.due) ? "Overdue" : undefined}
                  >
                    {fmtDay(r.due)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs" style={{ color: TEXT_MUTED }}>
        {visible.length.toLocaleString()} open · soonest due first. New email is picked up with the CRM sync (every 10
        minutes, weekdays).
      </p>

      <Sheet
        open={open !== null}
        onOpenChange={(o) => {
          if (!o) setOpenId(null)
        }}
      >
        <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="gap-1 border-b p-4 pr-12">
            <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: TEAL }}>
              Data Upload
            </div>
            <SheetTitle className="text-base leading-snug" style={{ color: BRAND_NAVY }}>
              {open?.title ?? "Task"}
            </SheetTitle>
            <SheetDescription>{open ? `Due ${fmtDay(open.due)} · unassigned` : null}</SheetDescription>
          </SheetHeader>

          {open ? (
            <div className="flex-1 overflow-y-auto p-4 text-sm">
              <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2">
                <Field
                  label={
                    <>
                      Client <span className="text-[#B42318]">*</span>
                    </>
                  }
                >
                  <ClientField
                    key={open.taskId}
                    row={open}
                    options={clientOptions}
                    blocked={editBlocked}
                    onPicked={(id, name) => setPick(open.taskId, id, name)}
                  />
                </Field>
                <Field label="Subject">{open.emailSubject || <span style={{ color: TEXT_MUTED }}>(no subject)</span>}</Field>
                <Field label="From">
                  {open.senderName ? <div>{open.senderName}</div> : null}
                  {open.senderAddress ? (
                    <div className="break-all text-[12px]" style={{ color: TEXT_MUTED }}>
                      {open.senderAddress}
                    </div>
                  ) : null}
                  {!open.senderName && !open.senderAddress ? "—" : null}
                </Field>
                <Field label="Received">{fmtStamp(open.receivedAt)}</Field>
                <Field label="Created">{fmtStamp(open.createdOn)}</Field>
                <Field label="Due">{fmtDay(open.due)}</Field>
              </dl>

              {open.bodyPreview ? (
                <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-3 text-[12.5px] whitespace-pre-wrap" style={{ color: TEXT_PRIMARY }}>
                  {open.bodyPreview}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                {open.webLink ? (
                  <a
                    href={open.webLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[12px] font-medium hover:bg-slate-50"
                    style={{ color: BRAND_NAVY }}
                  >
                    <ExternalLink className="size-3.5" /> Open email
                  </a>
                ) : null}
                {open.hasAttachments ? (
                  <span className="inline-flex items-center gap-1 text-[12px]" style={{ color: TEXT_MUTED }}>
                    <Paperclip className="size-3.5" /> Has attachments
                  </span>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11px]" style={{ color: TEXT_MUTED }}>
                Opens in Outlook on the web. You need access to the data-crm@ mailbox.
              </p>
            </div>
          ) : null}

          {open ? (
            <div className="border-t p-4">
              <CompleteButton
                key={open.taskId}
                taskId={open.taskId}
                blocked={completeBlocked ?? (open.clientId ? null : SET_CLIENT_HINT)}
                onDone={() => markDone(open.taskId)}
              />
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <dt className="pt-0.5 text-[12px]" style={{ color: TEXT_MUTED }}>
        {label}
      </dt>
      <dd className="min-w-0" style={{ color: TEXT_PRIMARY }}>
        {children}
      </dd>
    </>
  )
}

/**
 * The card's REQUIRED Client: a picker of active clients, pre-filled when the
 * poll auto-matched one (still changeable). A pick saves at once
 * (setDataUploadClient); on refusal the picker snaps back and a toast says why.
 */
function ClientField({
  row,
  options,
  blocked,
  onPicked,
}: {
  row: DataUploadRow
  options: AccountOption[]
  blocked: string | null
  onPicked: (id: string, name: string) => void
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const hint = matchHint(row.matchSource)

  function pick(next: string | null) {
    if (!next || next === row.clientId) return
    startTransition(async () => {
      const r = await setDataUploadClient(row.taskId, next)
      if (!r.ok) {
        toast.error("Could not set the client", { description: r.error })
        return
      }
      onPicked(next, r.data.name)
      toast.success("Client set", { description: r.data.name })
      router.refresh()
    })
  }

  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-1.5">
        <ClientCombobox
          className="h-8 text-[12.5px]"
          options={options}
          value={row.clientId}
          onChange={pick}
          placeholder="Select a client (required)"
          invalid={!row.clientId}
        />
        {pending ? <Loader2 className="size-3.5 shrink-0 animate-spin" style={{ color: TEXT_MUTED }} /> : null}
      </div>
      {blocked ? (
        <div className="text-[11px]" style={{ color: TEXT_MUTED }}>
          {blocked}
        </div>
      ) : null}
      {hint ? (
        <div className="text-[11px]" style={{ color: TEXT_MUTED }}>
          {hint}
        </div>
      ) : null}
      {row.clientId ? (
        <Link className="text-[11px] hover:underline" style={{ color: BRAND_NAVY }} href={`/client-detail?account_id=${row.clientId}`}>
          Open client
        </Link>
      ) : null}
    </div>
  )
}

/**
 * Mark complete — one click arms it, a second confirms (completing assigns the
 * task to you and closes it; there is no undo). Server re-checks everything.
 */
function CompleteButton({
  taskId,
  blocked,
  onDone,
}: {
  taskId: string
  blocked: string | null
  onDone: () => void
}) {
  const router = useRouter()
  const [armed, setArmed] = React.useState(false)
  const [pending, startTransition] = React.useTransition()

  function confirm() {
    startTransition(async () => {
      const r = await completeDataUploadTask(taskId)
      if (!r.ok) {
        setArmed(false)
        toast.error("Could not complete the task", { description: r.error })
        return
      }
      toast.success("Task completed", { description: "You're now its owner." })
      onDone()
      router.refresh()
    })
  }

  if (!armed) {
    return (
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 px-3 text-[12px] text-white"
          style={{ background: DEEP_TEAL }}
          onClick={() => setArmed(true)}
          disabled={!!blocked}
          title={blocked ?? undefined}
        >
          <Check className="size-3.5" /> Mark complete
        </Button>
        <span className="text-[11px]" style={{ color: TEXT_MUTED }}>
          {blocked ?? "Assigns the task to you and closes it."}
        </span>
      </div>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        type="button"
        size="sm"
        className="h-7 px-3 text-[12px] text-white"
        style={{ background: DEEP_TEAL }}
        onClick={confirm}
        disabled={pending}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Confirm complete
      </Button>
      <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setArmed(false)} disabled={pending}>
        Cancel
      </Button>
    </span>
  )
}
