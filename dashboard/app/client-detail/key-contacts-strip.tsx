"use client"

import * as React from "react"
import Link from "next/link"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TEXT_MUTED, TEXT_PRIMARY, TEXT_TERTIARY } from "@/lib/design"
import { loadContactRecord } from "@/app/contacts/actions"
import { ContactRecordPane } from "@/app/contacts/contact-record-pane"
import type { ContactRecord } from "@/lib/contacts/record"
import type { ClientContactItem } from "./crm-lists"
import { initialsOf as sharedInitialsOf } from "@/lib/team-initials"

/**
 * Client Detail top card → "Key Contacts", directly under Account Team. The
 * client's ACTIVE contacts, already ranked server-side (crm-lists.ts:
 * CEO → CFO → COO → IR, then alphabetical). Up to VISIBLE compact chips, then
 * "+N more" (a popover listing the rest). Clicking any contact opens the
 * Contacts page's existing record pane (ContactRecordPane / loadContactRecord)
 * over the page — view-only; closing leaves the page where it was.
 */

const VISIBLE = 5
// Quiet on purpose — lighter than the Account Team row above: one muted
// graphite avatar for everyone, the role as small grey text, no blue at rest.
const AVATAR_BG = "#E9EDF2"
const AVATAR_FG = "#5B6472"
const AVATAR_CLASS =
  "flex size-[18px] shrink-0 items-center justify-center rounded-full text-[8px] font-semibold leading-none"

// The shared, suffix-aware initials ("Scott Grossman, CFA" → "SG").
function initialsOf(name: string | null): string {
  return sharedInitialsOf(name ?? "") || "?"
}

function Chip({ c, onOpen }: { c: ClientContactItem; onOpen: (id: string) => void }) {
  const tag = c.role ?? c.job_title
  return (
    <button
      type="button"
      onClick={() => onOpen(c.contact_id)}
      title={[c.full_name, c.job_title].filter(Boolean).join(" · ")}
      className="flex max-w-[200px] cursor-pointer items-center gap-1 rounded-full border border-[#EEF1F5] bg-white py-px pl-px pr-1.5 transition-colors hover:border-[#D5DBE7] hover:bg-[#F7F9FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9AA1AD]/40"
    >
      <span
        className={AVATAR_CLASS}
        style={{ backgroundColor: AVATAR_BG, color: AVATAR_FG }}
        aria-hidden="true"
      >
        {initialsOf(c.full_name)}
      </span>
      <span className="truncate text-[11px] font-medium" style={{ color: TEXT_PRIMARY }}>
        {c.full_name || "Unnamed contact"}
      </span>
      {tag &&
        (c.role ? (
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide" style={{ color: TEXT_TERTIARY }}>
            {c.role}
          </span>
        ) : (
          <span className="truncate text-[9.5px]" style={{ color: TEXT_TERTIARY }}>
            {tag}
          </span>
        ))}
    </button>
  )
}

export function KeyContactsStrip({ accountId, contacts }: { accountId: string; contacts: ClientContactItem[] }) {
  const [moreOpen, setMoreOpen] = React.useState(false)
  const [openId, setOpenId] = React.useState<string | null>(null)
  const [record, setRecord] = React.useState<ContactRecord | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!openId) return
    let cancelled = false
    loadContactRecord(openId).then((res) => {
      if (cancelled) return
      if (res.ok) setRecord(res.data ?? null)
      else setError(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [openId])

  const open = (id: string) => {
    setMoreOpen(false)
    setRecord(null)
    setError(null)
    setOpenId(id)
  }
  const close = () => {
    setOpenId(null)
    setRecord(null)
    setError(null)
  }

  const visible = contacts.slice(0, VISIBLE)
  const rest = contacts.slice(VISIBLE)

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="mr-2 shrink-0 text-[11px] font-semibold uppercase tracking-wide" style={{ color: TEXT_MUTED }}>
        Key Contacts
      </span>
      {contacts.length === 0 ? (
        <span className="text-xs" style={{ color: TEXT_TERTIARY }}>
          No active contacts on record.
        </span>
      ) : (
        <>
          {visible.map((c) => (
            <Chip key={c.contact_id} c={c} onOpen={open} />
          ))}
          {rest.length > 0 && (
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <PopoverTrigger
                render={
                  <button
                    type="button"
                    className="cursor-pointer rounded-full border border-dashed border-[#DDE3EA] px-1.5 py-px text-[10.5px] font-medium text-[#6B7280] transition-colors hover:border-[#C8D4E3] hover:text-[#0355A7]"
                  />
                }
              >
                +{rest.length} more
              </PopoverTrigger>
              <PopoverContent align="start" sideOffset={6} className="w-72 gap-0 p-1">
                <div className="max-h-[300px] overflow-y-auto">
                  {rest.map((c) => (
                    <button
                      key={c.contact_id}
                      type="button"
                      onClick={() => open(c.contact_id)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[#F7F9FC]"
                    >
                      <span
                        className={AVATAR_CLASS}
                        style={{ backgroundColor: AVATAR_BG, color: AVATAR_FG }}
                        aria-hidden="true"
                      >
                        {initialsOf(c.full_name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">
                        <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
                          {c.full_name || "Unnamed contact"}
                        </span>
                        {(c.role || c.job_title) && (
                          <span style={{ color: TEXT_TERTIARY }}> · {c.role ?? c.job_title}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
                <Link
                  href={`/contacts?client=${encodeURIComponent(accountId)}`}
                  className="mt-1 block border-t border-[#EEF2F7] px-2 pb-1 pt-1.5 text-[11px] font-medium text-[#6B7280] hover:text-[#0355A7] hover:underline"
                >
                  View all contacts →
                </Link>
              </PopoverContent>
            </Popover>
          )}
        </>
      )}

      <ContactRecordPane
        record={record}
        loading={openId !== null && record === null && error === null}
        error={error}
        onClose={close}
      />
    </div>
  )
}
