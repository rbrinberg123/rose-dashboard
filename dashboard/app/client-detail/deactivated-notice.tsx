"use client"

/**
 * Client Detail for a DEACTIVATED client. Every Client Detail view filters to
 * active clients, so instead of falling back to another client (or erroring)
 * the page shows this: who/when/why, a Reactivate button for permissioned
 * viewers, and a way back to the Clients table, where the client stays listed
 * as Inactive.
 */

import Link from "next/link"
import { useRouter } from "next/navigation"
import { Ban } from "lucide-react"

import {
  ClientDeactivationControl,
  describeDeactivation,
} from "@/components/client-deactivation-control"
import type { ClientDeactivationState } from "@/lib/accounts/deactivation"
import { BRAND_BLUE, CARD_CLASS, TEXT_MUTED, TEXT_PRIMARY } from "@/lib/design"

export function DeactivatedClientNotice({ state }: { state: ClientDeactivationState }) {
  const router = useRouter()
  return (
    <div className={`${CARD_CLASS} max-w-[640px] p-6`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#F1F3F7]">
          <Ban className="size-4 text-[#5B6472]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold" style={{ color: TEXT_PRIMARY }}>
            {state.name ?? "This client"} is deactivated
          </div>
          <div className="mt-1 text-[13px]" style={{ color: TEXT_MUTED }}>
            {describeDeactivation(state)}
          </div>
          {state.reason && (
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-[#E4E9F4] bg-[#F4F6FB] px-2.5 py-1.5 text-[13px] text-[#1A2233]">
              {state.reason}
            </div>
          )}
          <p className="mt-3 text-[12px]" style={{ color: TEXT_MUTED }}>
            Deactivated clients are left out of Client Detail, Portfolio, the active counts and the
            Client pickers. Nothing was deleted: its events, meetings, contacts and tasks are
            unchanged, and reactivating it brings it back everywhere.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ClientDeactivationControl state={state} size="default" onDone={() => router.refresh()} />
            <Link href="/accounts" className="text-[13px] font-medium hover:underline" style={{ color: BRAND_BLUE }}>
              ← Back to Clients
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
