"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireSuperUser } from "@/lib/api-auth"
import { VIEW_AS_COOKIE, VIEW_AS_USER_COOKIE } from "@/lib/access-control"

/**
 * Server Actions backing the super-user "View as" testing mode.
 *
 * ENTRY POINT: the per-person "View as" button on each /admin/users row
 * (setViewAsUserAction). The Admin hub's abstract role dropdown was removed on
 * 2026-09-16 — see the note further down.
 * EXIT: the sticky banner in the root layout (exitViewAsAction).
 *
 * SECURITY: both actions authorize off the caller's REAL role
 * (requireSuperUser → getRealRole, a service-role DB lookup that ignores the
 * view_as cookies), NEVER the effective/impersonated role. So:
 *   - only a real super_user can ever set or clear a view_as cookie, and
 *   - a super who is currently viewing as someone who can't reach Admin can
 *     STILL exit from the always-present banner, because exit checks the real
 *     role — you can never lock yourself out.
 */

// Secure in production; relaxed in dev so the cookie works over http://localhost.
const SECURE = process.env.NODE_ENV === "production"

/*
 * NO setViewAsAction HERE ANY MORE.
 *
 * ROLE view ("view as Logistics", the abstract role preview) was started by a
 * dropdown at the top of the Admin hub. That control was removed on 2026-09-16
 * — the per-person "View as" on /admin/users covers testing better, because it
 * previews a real person's role AND their data scope. Its handler went with it;
 * nothing else ever called it.
 *
 * The role-view READ path is deliberately still intact: resolveEffective() in
 * lib/impersonation.ts still honours a VIEW_AS_COOKIE, the root-layout banner
 * still labels it, and exitViewAsAction below still clears it. That is what
 * retires a STALE cookie left in someone's browser from before the removal —
 * they see the banner on every page and can exit normally. Deleting the read
 * path instead would have stranded those cookies as an invisible role
 * downgrade.
 *
 * So: nothing can START a role view any more, and anything already in one can
 * still get out.
 */

/**
 * Begin PERSON impersonation — view the app as one specific @roseandco.com
 * user. Reads the target email from the submitted form (posted from an
 * /admin/users row). Validates the domain server-side; storing the email is
 * enough — the effective role + name + id are resolved server-side from that
 * email (see lib/impersonation.ts). Clears any ROLE view first (mutually
 * exclusive), then redirects into the impersonated view.
 */
export async function setViewAsUserAction(formData: FormData) {
  const auth = await requireSuperUser()
  if (!auth.ok) return // silently ignore — not a real super-user

  const email = formData.get("email")
  if (typeof email !== "string") return
  const normalized = email.trim().toLowerCase()
  if (!normalized.endsWith("@roseandco.com")) return

  const cookieStore = await cookies()
  cookieStore.delete(VIEW_AS_COOKIE)
  cookieStore.set(VIEW_AS_USER_COOKIE, normalized, {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
  })

  revalidatePath("/", "layout")
  redirect("/")
}

/**
 * Exit impersonation from the banner. Authorized off the REAL role so it works
 * even while viewing as a person/role that can't reach Admin. Clears BOTH the
 * person and role cookies and returns to the Admin hub (the super-user's
 * natural home for these controls).
 */
export async function exitViewAsAction() {
  const auth = await requireSuperUser()
  if (!auth.ok) return

  const cookieStore = await cookies()
  cookieStore.delete(VIEW_AS_USER_COOKIE)
  cookieStore.delete(VIEW_AS_COOKIE)

  revalidatePath("/", "layout")
  redirect("/admin")
}
