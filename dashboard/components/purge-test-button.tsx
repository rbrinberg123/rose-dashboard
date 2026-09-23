"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { Loader2, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import type { ActionResult } from "@/lib/actions"

/**
 * "Delete test {noun}" — removes every dashboard-created TEST row of one entity
 * (origin='dashboard' AND is_test=true, enforced server-side in
 * lib/crm-write.ts purgeTestRows). Confirms with the live count first; never
 * touches Dynamics rows or real dashboard rows.
 */
export function PurgeTestButton({
  noun,
  count,
  purge,
}: {
  /** Plural, lower-case: "contacts", "notes". */
  noun: string
  count: () => Promise<ActionResult<number>>
  purge: () => Promise<ActionResult<{ deleted: number }>>
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()

  function onClick() {
    startTransition(async () => {
      const c = await count()
      if (!c.ok) {
        toast.error(`Could not count test ${noun}`, { description: c.error })
        return
      }
      if (c.data === 0) {
        toast(`No test ${noun} to delete`)
        return
      }
      if (!window.confirm(`Permanently delete ${c.data} test ${noun} created in the dashboard?`)) return
      const r = await purge()
      if (!r.ok) {
        toast.error(`Could not delete test ${noun}`, { description: r.error })
        return
      }
      toast.success(`Deleted ${r.data.deleted} test ${noun}`)
      router.refresh()
    })
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      Delete test {noun}
    </Button>
  )
}
