"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"

import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import type { SyncResult } from "@/lib/sync/run"

/**
 * "Run sync now" — triggers the sync route on demand.
 *
 * This runs server-side (the page is already behind the auth proxy, so only
 * signed-in staff reach it). It POSTs to /api/sync-dynamics with the
 * `Authorization: Bearer ${CRON_SECRET}` header — the same header Vercel Cron
 * uses — so the secret is read from the environment here and never reaches the
 * browser.
 */
export async function triggerSync(): Promise<ActionResult<SyncResult>> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return fail("CRON_SECRET is not configured on the server.")
  }

  const h = await headers()
  const host = h.get("host")
  if (!host) return fail("Could not determine request host.")
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")

  try {
    const res = await fetch(`${proto}://${host}/api/sync-dynamics`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
    })

    const body = (await res.json().catch(() => null)) as
      | (SyncResult & { error?: string })
      | { error?: string }
      | null

    if (!res.ok && res.status !== 207) {
      return fail(body?.error ?? `Sync route returned ${res.status}`)
    }

    revalidatePath("/admin/sync")
    return ok(body as SyncResult)
  } catch (err) {
    return fail(describeError({ message: err instanceof Error ? err.message : String(err) }))
  }
}
