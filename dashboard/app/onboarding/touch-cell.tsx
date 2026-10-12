"use client"

/**
 * The Onboarding Call / Teach-in cells' click → the EXISTING touchpoint form or
 * drawer, through the client-scope-gated actions in ./actions.ts.
 *
 * The click branches on whether a touchpoint of that type EXISTS for the client
 * (findOnboardingTouch), not on whether the cell shows a date — a date can come
 * from the stored account column with no touchpoint behind it:
 *   - none           → Add New Touchpoint, pre-filled (client, type, subject;
 *                      Date left empty). Saved as origin='dashboard'; the view
 *                      then shows its date.
 *   - dashboard row  → the same form in edit mode.
 *   - Dynamics row   → the read-only touchpoint drawer ("Synced from Dynamics —
 *                      read-only until cutover").
 */

import * as React from "react"
import { toast } from "sonner"

import { EditTouchDialog, NewTouchForClientDialog, type TouchFormApi } from "@/app/touchpoints/new-touch-dialog"
import { TouchpointRecordPane } from "@/app/touchpoints/touchpoint-record-pane"
import type { TouchpointRecord } from "@/lib/touchpoints/record"
import {
  ONBOARDING_TOUCH_KINDS,
  ONBOARDING_TOUCH_TYPE_CODES,
  type OnboardingTouchKind,
} from "@/lib/onboarding/touch-link"
import {
  createOnboardingTouch,
  findOnboardingTouch,
  loadOnboardingTouchClients,
  loadOnboardingTouchContactOptions,
  loadOnboardingTouchContacts,
  loadOnboardingTouchForEdit,
  loadOnboardingTouchRecord,
  updateOnboardingTouch,
} from "./actions"

/** Module-level so the form's effects see a stable object. */
const ONBOARDING_TOUCH_API: TouchFormApi = {
  create: createOnboardingTouch,
  update: updateOnboardingTouch,
  loadClients: loadOnboardingTouchClients,
  loadContactOptions: loadOnboardingTouchContactOptions,
  loadForEdit: loadOnboardingTouchForEdit,
}

export type OnboardingTouchTarget = { accountId: string; kind: OnboardingTouchKind; nonce: number }

type Opened =
  | { mode: "create" }
  | { mode: "edit"; id: string }
  | { mode: "view"; record: TouchpointRecord | null; error: string | null }

export function OnboardingTouchHost({
  target,
  onClose,
}: {
  target: OnboardingTouchTarget | null
  onClose: () => void
}) {
  const [opened, setOpened] = React.useState<{ nonce: number; value: Opened } | null>(null)

  React.useEffect(() => {
    if (!target) return
    let live = true
    findOnboardingTouch({ accountId: target.accountId, kind: target.kind }).then(async (r) => {
      if (!live) return
      if (!r.ok) {
        toast.error("Couldn't open the touchpoint", { description: r.error })
        onClose()
        return
      }
      if (!r.data) return setOpened({ nonce: target.nonce, value: { mode: "create" } })
      if (r.data.origin === "dashboard") {
        return setOpened({ nonce: target.nonce, value: { mode: "edit", id: r.data.touchpointId } })
      }
      setOpened({ nonce: target.nonce, value: { mode: "view", record: null, error: null } })
      const rec = await loadOnboardingTouchRecord(r.data.touchpointId)
      if (!live) return
      setOpened({
        nonce: target.nonce,
        value: { mode: "view", record: rec.ok ? rec.data : null, error: rec.ok ? null : rec.error },
      })
    })
    return () => {
      live = false
    }
  }, [target, onClose])

  const current = target && opened?.nonce === target.nonce ? opened.value : null
  if (!target || !current) return null

  const kind = ONBOARDING_TOUCH_KINDS[target.kind]
  const close = () => {
    setOpened(null)
    onClose()
  }

  if (current.mode === "create") {
    return (
      <NewTouchForClientDialog
        key={target.nonce}
        clientAccountId={target.accountId}
        typeCode={kind.code}
        subject={kind.label}
        blankDate
        api={ONBOARDING_TOUCH_API}
        typeCodes={ONBOARDING_TOUCH_TYPE_CODES}
        onClose={close}
      />
    )
  }
  if (current.mode === "edit") {
    return (
      <EditTouchDialog
        key={target.nonce}
        id={current.id}
        api={ONBOARDING_TOUCH_API}
        typeCodes={ONBOARDING_TOUCH_TYPE_CODES}
        onClose={close}
        onSaved={close}
      />
    )
  }
  return (
    <TouchpointRecordPane
      record={current.record}
      loading={!current.record && !current.error}
      error={current.error}
      onClose={close}
      loadContacts={loadOnboardingTouchContacts}
    />
  )
}
