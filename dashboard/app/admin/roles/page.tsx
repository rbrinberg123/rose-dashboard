import type { Metadata } from "next"
import Link from "next/link"

import { PageShell } from "@/components/page-shell"
import { buttonVariants } from "@/components/ui/button"
import { getSupabaseServer } from "@/lib/supabase"
import { RolesView } from "./roles-view"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Roles" }

/*
 * Admin → Roles — LIVE.
 *
 * Renders a pages × roles matrix (rows from lib/page-registry, columns the
 * assignable roles) and lets a super-user set, per role, which pages that role
 * may access. It writes public.role_page_access — the live page-access source
 * that getAllowedRoutes/canAccessRoute read (proxy, nav, and API guards).
 * Default deny: a page is allowed for a role only when its box is checked.
 * super_user is a hard backstop (always everything) and is never written here.
 *
 * The route lives under /admin, gated by this same matrix.
 */

type AccessRow = { role: string; route: string; allowed: boolean }

/** Read staged rules; guard the table not existing yet (DDL run manually). */
async function loadGrants(
  sb: ReturnType<typeof getSupabaseServer>,
): Promise<{ grants: Record<string, boolean>; missingTable: boolean }> {
  const { data, error } = await sb.from("role_page_access").select("role, route, allowed")
  if (error) {
    // 42P01 = undefined_table. Treat "table not created yet" as an empty,
    // non-fatal state so the matrix still renders with the seeded defaults.
    const missingTable = error.code === "42P01" || /does not exist/i.test(error.message)
    return { grants: {}, missingTable }
  }
  const grants: Record<string, boolean> = {}
  for (const g of (data ?? []) as AccessRow[]) {
    grants[`${g.role}|${g.route}`] = g.allowed
  }
  return { grants, missingTable: false }
}

export default async function RolesPage() {
  const sb = getSupabaseServer()
  const { grants, missingTable } = await loadGrants(sb)

  return (
    <PageShell
      title="Roles"
      description="Live — this matrix controls which pages each role can access."
    >
      <div className="mb-4">
        <Link
          href="/admin"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          ← Back
        </Link>
      </div>
      <RolesView grants={grants} missingTable={missingTable} />
    </PageShell>
  )
}
