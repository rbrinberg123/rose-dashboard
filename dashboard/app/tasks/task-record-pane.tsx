"use client"

/**
 * The task-record drawer — the Tasks twin of app/events/event-record-pane.tsx.
 *
 * Slides in from the right as a SIBLING of the list, never wrapping it, so
 * opening a record cannot remount the table — which is what keeps the list's
 * scroll position and virtualisation window intact.
 *
 * ── RENDERED FROM FIELD DEFINITIONS, NOT JSX ───────────────────────────────
 * Every field comes from `TASK_SECTIONS` in lib/tasks/record.ts —
 * `{ label, sourceKey, type }` — rather than hand-written markup per field. That
 * is what makes turning this into a real editor a localised change: swap the
 * read-only renderer below for an input keyed off `type`, add form state, add a
 * save action. The sections, labels and ordering do not move.
 *
 * VIEW ONLY. Nothing here is editable and nothing writes back — Dynamics is the
 * system of record.
 */

import * as React from "react"
import Link from "next/link"
import { X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { BRAND_BLUE, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  TASK_SECTIONS,
  type TaskFieldDef,
  type TaskRecord,
} from "@/lib/tasks/record"
import { isPersonName } from "@/lib/tasks/spec"
import { cn } from "@/lib/utils"

/** Eastern, matching every other date on the page. */
const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "numeric",
  day: "numeric",
  year: "numeric",
})

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? String(iso) : EASTERN.format(d)
}

/**
 * Task-status pill colours, mapped onto the app's shared STATUS_PILL_LIGHT
 * buckets so a status reads the same here as it does anywhere else. The live
 * values are Not Started, In Progress, Completed and Canceled.
 */
export function taskStatusPill(status: string | null): { bg: string; text: string } {
  const s = (status ?? "").trim().toLowerCase()
  if (s === "completed") return STATUS_PILL_LIGHT.positive
  if (s === "in progress") return STATUS_PILL_LIGHT.new
  if (s === "not started") return STATUS_PILL_LIGHT.watch
  if (s === "canceled" || s === "cancelled") return STATUS_PILL_LIGHT.atRisk
  return STATUS_PILL_LIGHT.neutral
}

function Pill({ children, bg, text }: { children: React.ReactNode; bg: string; text: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: bg, color: text }}
    >
      {children}
    </span>
  )
}

/** The gradient underline every section header in the app carries. */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="mb-2">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#5B6472]">
        {title}
      </div>
      <div
        className="mt-1 h-[2px] w-full rounded-full"
        style={{ background: "linear-gradient(90deg, #1E2858, #0355A7, #1C8C9C)" }}
      />
    </div>
  )
}

/**
 * One field. An empty value renders a quiet em dash, never a blank box — a gap
 * in the CRM should read as a gap, not as a rendering failure.
 */
function Field({
  def,
  record,
  clientAccountId,
}: {
  def: TaskFieldDef
  record: TaskRecord
  clientAccountId: string | null
}) {
  const raw = record[def.sourceKey]
  const empty = raw === null || raw === undefined || raw === ""
  const fullWidth = def.type === "notes" || def.sourceKey === "subject"

  let body: React.ReactNode = "—"
  if (!empty) {
    switch (def.type) {
      case "date":
        body = formatDate(String(raw)) ?? "—"
        break
      case "toggle":
        body = raw === true ? "Yes" : raw === false ? "No" : "—"
        break
      case "person":
        // Only a real NAME gets an avatar. owner_name and its siblings also carry
        // two-letter staff codes and queue names — see isPersonName in
        // lib/tasks/spec.ts for why those are shown as plain text instead.
        body = isPersonName(String(raw)) ? (
          <span className="inline-flex items-center gap-2">
            <TeamAvatars
              members={[{ role: def.label, name: String(raw), bg: "#1E2858", fg: "#FFFFFF" }]}
            />
            <span>{String(raw)}</span>
          </span>
        ) : (
          String(raw)
        )
        break
      case "link":
        if (def.sourceKey === "client_account_name" && clientAccountId) {
          body = (
            <Link
              href={`/client-detail?account_id=${clientAccountId}`}
              className="font-medium hover:underline"
              style={{ color: BRAND_BLUE }}
            >
              {String(raw)}
            </Link>
          )
        } else {
          body = String(raw)
        }
        break
      default:
        body = String(raw)
    }
  }

  return (
    <div className={cn(fullWidth && "col-span-2")}>
      <div className="text-[11px] text-[#9AA1AD]">{def.label}</div>
      <div
        className={cn(
          "mt-0.5 rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2 py-1 text-[13px]",
          empty && "text-muted-foreground",
          fullWidth && "whitespace-pre-wrap",
        )}
      >
        {body}
      </div>
    </div>
  )
}

export function TaskRecordPane({
  record,
  loading,
  error,
  onClose,
}: {
  record: TaskRecord | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const open = loading || !!record || !!error
  if (!open) return null

  const statusPill = taskStatusPill(record?.status_label ?? null)
  // "Outreach · Marketing Memo" — the classification pair, as one line.
  const typeLine = [record?.task_type_label, record?.task_subtype_label]
    .filter((v) => v && String(v).trim())
    .join(" · ")

  return (
    <>
      {/* Scrim. Click anywhere off the panel to close. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Task record"
        className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">Task</div>
              {/* The Subject is the headline. It wraps to at most two lines
                  rather than truncating — a task subject carries the whole
                  point of the row, and half of one is not useful. */}
              <h2 className="line-clamp-2 text-[17px] font-semibold text-[#1A2233]">
                {record?.subject ?? (loading ? "Loading…" : "Task")}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {typeLine && (
                    <Pill bg={STATUS_PILL_LIGHT.neutral.bg} text={STATUS_PILL_LIGHT.neutral.text}>
                      {typeLine}
                    </Pill>
                  )}
                  <Pill bg={statusPill.bg} text={statusPill.text}>
                    {record.status_label ?? "No status"}
                  </Pill>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cursor-pointer text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {loading && !record && (
            <div className="py-10 text-center text-sm text-muted-foreground">Loading record…</div>
          )}
          {record &&
            TASK_SECTIONS.map((section) => (
              <section key={section.key} className="mb-6">
                <SectionHeader title={section.title} />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {section.fields.map((f) => (
                    <Field
                      key={String(f.sourceKey)}
                      def={f}
                      record={record}
                      clientAccountId={record.client_account_id}
                    />
                  ))}
                </div>
              </section>
            ))}

          {record && (
            <p className="pb-4 text-[11px] text-muted-foreground">
              View only — Dynamics is the system of record. Actual Start is empty on every live
              task today; the CRM does not currently write it.
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
