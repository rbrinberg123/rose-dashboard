import { redirect } from "next/navigation"

import { homeRouteFor } from "@/lib/access-control"
import { getEffectiveRole } from "@/lib/effective-identity"
import { getAllowedRoutes } from "@/lib/page-access"

export const dynamic = "force-dynamic"

/**
 * The app root ("/") — the default homepage. Renders nothing: every signed-in
 * user is sent to their home, which is MY DASHBOARD for anyone who may open it
 * (today, every user with a role), the same place sign-in lands them. Fallback
 * (homeRouteFor in lib/access-control.ts): Portfolio, the previous default, else
 * the first page the role can open, else /no-access — never a blocked screen.
 *
 * Uses the EFFECTIVE role, so "View as" lands on the impersonated person's home.
 * Signed-out visitors never reach here (proxy.ts sends them to /login).
 *
 * Client Statistics, which this route used to render, is unchanged at
 * /client-statistics (nav: Clients → Statistics). 2026-10-08.
 */
export default async function Home() {
  const role = await getEffectiveRole()
  const allowed = await getAllowedRoutes(role)
  redirect(homeRouteFor(role, allowed))
}
