import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseProxy } from "@/lib/supabase/proxy"
import {
  canAccessRoute,
  VIEW_AS_COOKIE,
  VIEW_AS_USER_COOKIE,
} from "@/lib/access-control"
import { getRealRole } from "@/lib/user-role"
import { resolveEffective } from "@/lib/impersonation"
import { getAllowedRoutes } from "@/lib/page-access"

/**
 * Auth proxy. Runs before every page render (matcher below excludes
 * static assets and API routes that handle their own auth).
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie if it's about to expire so
 *      downstream RSCs see a valid session. `@supabase/ssr` does this
 *      automatically when we call `getUser()`.
 *   2. Redirect unauthenticated visits to /login. Public paths (/login,
 *      /auth/callback) are allowlisted.
 *
 * NOTE: This file is `proxy.ts` (Next.js 16 convention). In Next 15 and
 * earlier it would be `middleware.ts` and the function would be named
 * `middleware`. Same machinery, new name.
 */

const PUBLIC_PATHS = ["/login", "/auth/callback"]

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))
}

export async function proxy(request: NextRequest) {
  const { supabase, response } = getSupabaseProxy(request)

  // Calling getUser() validates the JWT against Supabase Auth and also
  // refreshes the cookie if needed (via the setAll handler in
  // getSupabaseProxy). Always call it before deciding what to do, even
  // for public paths, so signed-in users hitting /login still get their
  // session refreshed.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname, search } = request.nextUrl

  // Public paths: render as-is, but if the user is already signed in
  // and visiting /login, send them to /portfolio.
  if (isPublic(pathname)) {
    if (user && pathname === "/login") {
      const url = request.nextUrl.clone()
      url.pathname = "/portfolio"
      url.search = ""
      return NextResponse.redirect(url)
    }
    return response
  }

  // Protected path with no session → bounce to /login, preserving the
  // intended destination so we can return there post-login.
  if (!user) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.search = pathname !== "/" ? `?next=${encodeURIComponent(pathname + search)}` : ""
    return NextResponse.redirect(url)
  }

  // Authenticated. Enforce role-based access (deny-by-default). This is the
  // real security boundary — it runs server-side before any page renders, so
  // it also blocks users who type a restricted URL directly.
  //
  // We gate on the EFFECTIVE role, so a super-user using "View as" sees the app
  // exactly as the impersonated person/role does. resolveEffective honors the
  // view_as cookies ONLY when the REAL role is super_user, so they can't be
  // spoofed. (The proxy reads cookies off the request — no next/headers here.)
  const realRole = await getRealRole(user.email)
  const { effectiveRole: role } = await resolveEffective(
    realRole,
    request.cookies.get(VIEW_AS_USER_COOKIE)?.value,
    request.cookies.get(VIEW_AS_COOKIE)?.value,
  )
  // Load the role's allowed routes ONCE (small query; super_user short-circuits
  // to [] and is allowed everything by the canAccessRoute backstop).
  const allowedRoutes = await getAllowedRoutes(role)
  if (!canAccessRoute(role, pathname, allowedRoutes)) {
    const url = request.nextUrl.clone()
    url.search = ""
    // Land them on the first page their role CAN reach (allowedRoutes is ordered
    // by the page registry), else the always-allowed "request access" screen —
    // from which the View-as banner's Exit is still reachable. This replaces the
    // old fixed USER_HOME_ROUTE and can never redirect-loop.
    url.pathname = allowedRoutes[0] ?? "/no-access"
    return NextResponse.redirect(url)
  }

  return response
}

/**
 * Matcher: run proxy on everything EXCEPT
 *   - Next internals (_next/static, _next/image)
 *   - Public asset files at the URL root (favicon, robots, sitemap, etc.)
 *   - API routes (`/api/*`) — these handle their own auth. The sync routes in
 *     particular are called by Vercel Cron with a bearer token (no Supabase
 *     session), so the proxy must not redirect them to /login.
 */
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)$).*)",
  ],
}
