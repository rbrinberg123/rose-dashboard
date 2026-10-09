"use client"

import * as React from "react"
import { Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { RAIL_ACCENT_FILL } from "@/lib/design"
import { NewEventForClientDialog } from "@/app/events/new-event-dialog"
import { NewTaskForClientDialog } from "@/app/tasks/new-task-dialog"
import { NewTouchForClientDialog } from "@/app/touchpoints/new-touch-dialog"
import { NewNoteForClientDialog } from "@/app/notes/new-note-dialog"
import { NewContactForClientDialog } from "@/app/contacts/new-contact-dialog"

type Kind = "event" | "task" | "touch" | "note" | "contact"

const ITEMS: { kind: Kind; label: string }[] = [
  { kind: "event", label: "New Event" },
  { kind: "task", label: "New Task" },
  { kind: "touch", label: "New Touch Point" },
  { kind: "note", label: "New Note" },
  { kind: "contact", label: "New Contact" },
]

/**
 * Client Detail masthead "+" — opens one of the five EXISTING CRM create forms
 * with this client pre-filled. Each form saves through its own server action
 * (requireCrmWriter: super_user, not in "View as"), then router.refresh()es,
 * so the page's Events / Tasks / Touchpoints / Key Contacts reflect the record.
 * The caller renders this only for super users (the same audience as the CRM
 * pages); the server gate is what actually enforces it.
 */
export function ClientQuickAdd({ accountId }: { accountId: string }) {
  const [kind, setKind] = React.useState<Kind | null>(null)
  const close = React.useCallback(() => setKind(null), [])

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          title="Quick add"
          className="inline-flex h-9 items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0355A7]/40 focus-visible:ring-offset-2"
          style={{ background: RAIL_ACCENT_FILL }}
        >
          Quick Add
          <Plus className="size-4 shrink-0" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {ITEMS.map((it) => (
            <DropdownMenuItem key={it.kind} onClick={() => setKind(it.kind)}>
              {it.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {kind === "event" && <NewEventForClientDialog clientAccountId={accountId} onClose={close} />}
      {kind === "task" && <NewTaskForClientDialog clientAccountId={accountId} onClose={close} />}
      {kind === "touch" && <NewTouchForClientDialog clientAccountId={accountId} onClose={close} />}
      {kind === "note" && <NewNoteForClientDialog clientAccountId={accountId} onClose={close} />}
      {kind === "contact" && <NewContactForClientDialog clientAccountId={accountId} onClose={close} />}
    </>
  )
}
