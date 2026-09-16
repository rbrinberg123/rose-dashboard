"use client"

/**
 * The note-record drawer — the Notes twin of
 * app/touchpoints/touchpoint-record-pane.tsx.
 *
 * Slides in from the right as a SIBLING of the list, never wrapping it, so
 * opening a record cannot remount the table — which is what keeps the list's
 * scroll position and virtualisation window intact.
 *
 * ── RENDERED FROM FIELD DEFINITIONS, NOT JSX ───────────────────────────────
 * Every field comes from `NOTE_SECTIONS` in lib/notes/record.ts —
 * `{ label, sourceKey, type }` — rather than hand-written markup per field. That
 * is what makes turning this into a real editor a localised change: swap the
 * read-only renderer below for an input keyed off `type`, add form state, add a
 * save action. The sections, labels and ordering do not move.
 *
 * ── THIS DRAWER IS THE POINT OF THE PAGE ───────────────────────────────────
 * On the other CRM tables the drawer is a detail view of a row you can already
 * mostly read. Here the row is a truncated one-liner and the drawer is where the
 * note is actually READ — which is why `note_body` is sourced from `_raw` (it
 * keeps its line breaks) and rendered whitespace-preserved and full width.
 *
 * VIEW ONLY. Nothing here is editable and nothing writes back — Dynamics is the
 * system of record.
 */

import * as React from "react"
import Link from "next/link"
import { X } from "lucide-react"

import { AccountTeamAvatars as TeamAvatars } from "@/components/account-team-avatars"
import { BRAND_BLUE, STATUS_PILL_LIGHT } from "@/lib/design"
import { NOTE_SECTIONS, type NoteFieldDef, type NoteRecord } from "@/lib/notes/record"
import { isPersonName, noteStatusKey } from "@/lib/notes/spec"
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
 * Client-status pill colours for `status_text`, mapped onto the app's shared
 * STATUS_PILL_LIGHT buckets so a status reads the same here as anywhere else.
 *
 * This is the one field on this entity where the colour carries the meaning —
 * it is the firm's own read on the relationship. Live values after trimming:
 * Stable 357 / At Risk 110 / New Client 21 / Lost 18 / Strong 3 / Pause 1.
 *
 * `startsWith("at risk")` rather than equality, so the two "At Risk." typo rows
 * are coloured like the 110 clean ones instead of falling through to neutral.
 */
export function noteStatusPill(status: string | null): { bg: string; text: string } {
  const s = noteStatusKey(status)
  if (s === "strong") return STATUS_PILL_LIGHT.positive
  if (s === "stable") return STATUS_PILL_LIGHT.positive
  if (s.startsWith("at risk")) return STATUS_PILL_LIGHT.atRisk
  if (s === "lost") return STATUS_PILL_LIGHT.atRisk
  if (s === "new client") return STATUS_PILL_LIGHT.new
  if (s === "pause") return STATUS_PILL_LIGHT.watch
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
  def: NoteFieldDef
  record: NoteRecord
  clientAccountId: string | null
}) {
  const raw = record[def.sourceKey]
  const empty = raw === null || raw === undefined || raw === ""
  // The body and the action step are the substance of a note; both get the full
  // width and keep their line breaks.
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
      case "person":
        // Every people value on this entity is a real full name — Grace Andonian
        // and Robert Brinberg author all 693 notes, and modified_by adds only
        // "CRM Administration". NOT used for action_owner, which is initials.
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
          // whitespace-pre-wrap is what makes the _raw-sourced body worth
          // sourcing: the note renders with the "Status: / Overall Sentiment: /
          // Primary Risk Driver: / Key Points:" structure the author typed.
          fullWidth && "whitespace-pre-wrap leading-relaxed",
        )}
      >
        {body}
      </div>
    </div>
  )
}

export function NoteRecordPane({
  record,
  loading,
  error,
  onClose,
}: {
  record: NoteRecord | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const open = loading || !!record || !!error
  if (!open) return null

  const statusPill = noteStatusPill(record?.status_text ?? null)

  return (
    <>
      {/* Scrim. Click anywhere off the panel to close. */}
      <div aria-hidden="true" onClick={onClose} className="fixed inset-0 z-40 bg-black/10" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Note record"
        className="fixed right-0 top-0 z-50 flex h-screen w-[560px] max-w-[94vw] flex-col border-l border-[#E5E8EC] bg-white shadow-2xl"
      >
        <header className="border-b border-[#E5E8EC] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] uppercase tracking-wider text-[#9AA1AD]">
                Client Review Note
              </div>
              {/* The CLIENT is the headline here, not a subject — a note has no
                  title of its own, only the review cycle it belongs to. */}
              <h2 className="line-clamp-2 text-[17px] font-semibold text-[#1A2233]">
                {record?.client_account_name ?? (loading ? "Loading…" : "Note")}
              </h2>
              {record && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {record.review_cycle && (
                    <Pill bg={STATUS_PILL_LIGHT.neutral.bg} text={STATUS_PILL_LIGHT.neutral.text}>
                      {record.review_cycle}
                    </Pill>
                  )}
                  <Pill bg={statusPill.bg} text={statusPill.text}>
                    {record.status_text ?? "No status"}
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
            NOTE_SECTIONS.map((section) => (
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
              View only — Dynamics is the system of record. The Note above is sourced from the
              CRM&apos;s line-broken copy; &ldquo;Note (flattened source)&rdquo; under System is the
              same text with its line breaks collapsed, shown so the difference is visible. Action
              Owner is staff initials, not a linked person.
            </p>
          )}
        </div>
      </aside>
    </>
  )
}
