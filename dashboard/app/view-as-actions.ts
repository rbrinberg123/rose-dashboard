"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { requireSuperUser } from "@/lib/api-auth"
import { VIEW_AS_COOKIE, VIEW_AS_USER_COOKIE, isViewAsRole } from "@/lib/access-control"

/**
 * Server Actions backing the super-user "View as role" testing mode.
 *
 * SECURITY: both actions authorize off the caller's REAL role
 * (requireSuperUser → getRealRole, a service-role DB lookup that ignores the
 * view_as cookie), NEVER the effective/impersonated role. So:
 *   - only a real super_user can ever set or clear a view_as cookie, and
 *   - a super who is currently viewing-as "User" (which can't reach Admin) can
 *     STILL exit from the always-present banner, because exit checks the real
 *     role — you can never lock yourself out.
 */

// Secure in production; relaxed in dev so the cookie works over http://localhost.
const SECURE = process.env.NODE_ENV === "production"

/**
 * Begin (or clear) impersonation. Reads the target role from the submitted
 * form. Selecting "super_user" is a no-op that clears the cookie (viewing as
 * your real self). After applying, redirect to "/" and let the proxy route the
 * impersonated role to wherever it is allowed to land.
 */
export async function setViewAsAction(formData: FormData) {
  const auth = await requireSuperUser()
  if (!auth.ok) return // silently ignore — not a real super-user

  const role = formData.get("role")
  if (typeof role !== "string" || !isViewAsRole(role)) return

  const cookieStore = await cookies()
  // The two modes are mutually exclusive — starting a ROLE view clears any
  // PERSON view.
  cookieStore.delete(VIEW_AS_USER_COOKIE)
  if (role === "super_user") {
    cookieStore.delete(VIEW_AS_COOKIE)
  } else {
    cookieStore.set(VIEW_AS_COOKIE, role, {
      httpOnly: true,
      secure: SECURE,
      sameSite: "lax",
      path: "/",
    })
  }

  revalidatePath("/", "layout")
  redirect("/")
}

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
