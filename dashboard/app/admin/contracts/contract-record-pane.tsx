"use client"

/**
 * The contract-record drawer — the Contracts twin of
 * app/notes/note-record-pane.tsx.
 *
 * Slides in from the right as a SIBLING of the list, never wrapping it, so
 * opening a record cannot remount the table.
 *
 * Every field comes from `CONTRACT_SECTIONS` in lib/contracts/record.ts — the
 * same list the form writes (form field set = drawer field set). Term End and
 * Notice Date are marked "calculated": the database computes them.
 *
 * VIEW ONLY for Dynamics rows. A dashboard-created row (origin='dashboard')
 * shows Edit (RecordEditBar → the Add New form in edit mode) and Delete; the
 * server refuses both for any Dynamics row.
 */

import * as React from "react"
import Link from "next/link"
import { Loader2, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { BRAND_BLUE, STATUS_PILL_LIGHT } from "@/lib/design"
import {
  CONTRACT_SECTIONS,
  formatRetainer,
  type ContractFieldDef,
  type ContractRecord,
} from "@/lib/contracts/record"
import { isPersonName } from "@/lib/contracts/spec"
import { TestBadge } from "@/components/test-badge"
import { RecordEditBar } from "@/components/record-edit-bar"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { deleteContract } from "./actions"

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

/** One field. An empty value renders a quiet em dash, never a blank box. */
function Field({ def, record }: { def: ContractFieldDef; record: ContractRecord }) {
  const raw = record[def.sourceKey]
  const empty = raw === null || raw === undefined || raw === ""
  const fullWidth = def.type === "notes"

  let body: React.ReactNode = "—"
  if (!empty) {
    switch (def.type) {
      case "date":
        body = formatDate(String(raw)) ?? "—"
        break
      case "toggle":
        body = raw === true ? "Yes" : raw === false ? "No" : "—"
        break
      case "money":
        body = formatRetainer(raw as number, record.currency) ?? "—"
        break
      case "person":
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
        body = record.account_id ? (
          <Link
            href={`/client-detail?account_id=${record.account_id}`}
            className="font-medium hover:underline"
            style={{ color: BRAND_BLUE }}
          >
            {String(raw)}
          </Link>
        ) : (
          String(raw)
        )
        break
      default:
        body = String(raw)
    }
  }

  return (
    <div className={cn(fullWidth && "col-span-2")}>
      <div className="text-[11px] text-[#9AA1AD]">
        {def.label}
        {def.calculated && <span className="ml-1 italic">(calculated)</span>}
      </div>
      <div
        className={cn(
          "mt-0.5 rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2 py-1 text-[13px]",
          empty && "text-muted-foreground",
          fullWidth && "whitespace-pre-wrap leading-relaxed",
        )}
      >
        {body}
      </div>
    </div>
  )
}

export function ContractRecordPane({
  record,
  loading,
  error,
  onClose,
  onEdit,
  onDeleted,
}: {
  record: ContractRecord | null
  loading: boolean
  error: string | null
  onClose: () => void
  /** Opens the edit form — shown only for origin='dashboard' records. */
  onEdit?: () => void
  /** Called after a successful delete. */
  onDeleted: () => void
}) {
  const [deleting, startDelete] = React.useTransition()
  const open = loading || !!record || !!error
  if (!open) return null

  function onDelete() {
    if (!record) return
    if (!window.confirm(`Permanently delete the contract “${record.contract_name ?? "untitled"}”?`)) return
    startDelete(async () => {
      const r = await deleteContract(record.contract_id)
      if (!r.ok) {
        toast.error("Could not delete", { description: r.error })
        return
      }
      toast.success("Contract deleted")
      onDeleted()
    })
  }

  return (
    <>
      {/* Scrim. Click anywhere off the panel to close. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Contract record"
        className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">
                Contract{record?.client_name ? ` · ${record.client_name}` : ""}
              </div>
              <h2 className="line-clamp-2 text-[17px] font-semibold text-[#1A2233]">
                {record?.contract_name ?? (loading ? "Loading…" : "Contract")}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {record.is_test && <TestBadge />}
                  <RecordEditBar origin={record.origin} onEdit={onEdit} />
                  {record.origin === "dashboard" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] text-destructive"
                      onClick={onDelete}
                      disabled={deleting}
                    >
                      {deleting ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                      Delete
                    </Button>
                  )}
                  {record.contract_status && (
                    <Pill bg={STATUS_PILL_LIGHT.neutral.bg} text={STATUS_PILL_LIGHT.neutral.text}>
                      {record.contract_status}
                    </Pill>
                  )}
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
            CONTRACT_SECTIONS.map((section) => (
              <section key={section.key} className="mb-6">
                <SectionHeader title={section.title} />
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  {section.fields.map((f) => (
                    <Field key={String(f.sourceKey)} def={f} record={record} />
                  ))}
                </div>
              </section>
            ))}

          {record && (
            <p className="pb-4 text-[11px] text-muted-foreground">
              Term End and Notice Date are calculated by the database from Start Date, Term Length
              and Termination Notice. Termination Date is when the contract actually ended.
              {record.origin !== "dashboard" &&
                " Synced from Dynamics: each field shows the Dynamics value, read-only until cutover."}
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
