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
import { landingRouteFor } from "@/lib/access-control"
import { perfTimer } from "@/lib/perf-log"
import {
  ANONYMOUS_IDENTITY,
  IDENTITY_HEADER,
  encodeIdentityHeader,
  type ProxyIdentity,
} from "@/lib/identity-header"

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

/**
 * Attach the resolved identity to the REQUEST headers so the root layout can
 * read it instead of re-querying auth + role + routes (see lib/identity-header.ts).
 *
 * `Headers.set` OVERWRITES, which is the security property that makes this safe:
 * a client-supplied `x-rose-identity` never survives. EVERY return path in
 * proxy() that renders a page must go through here — including the public /login
 * path, which passes ANONYMOUS_IDENTITY rather than skipping the call. Redirects
 * do not render the layout and so do not need it.
 *
 * `NextResponse.next({ request: { headers } })` makes the header visible to the
 * server render only. It is deliberately NOT `NextResponse.next({ headers })`,
 * which would expose it to the browser.
 *
 * The Supabase client may already have queued refreshed session cookies onto
 * `response`; those are copied across so a token refresh still reaches the
 * browser.
 */
function withIdentity(
  request: NextRequest,
  response: NextResponse,
  identity: ProxyIdentity,
): NextResponse {
  const headers = new Headers(request.headers)
  headers.set(IDENTITY_HEADER, encodeIdentityHeader(identity))
  const out = NextResponse.next({ request: { headers } })
  for (const cookie of response.cookies.getAll()) out.cookies.set(cookie)
  return out
}

export async function proxy(request: NextRequest) {
  const perf = perfTimer(`proxy ${request.nextUrl.pathname}`)
  const { supabase, response } = getSupabaseProxy(request)

  // getClaims() VERIFIES the session JWT's signature (and expiry) and also
  // refreshes the cookie if it is about to expire (via the setAll handler in
  // getSupabaseProxy). Always call it before deciding what to do, even for
  // public paths, so signed-in users hitting /login still get their session
  // refreshed.
  //
  // PERFORMANCE (2026-10-02): this replaced getUser(), which made a network
  // round trip to Supabase Auth on EVERY request (~230-310ms measured). This
  // project signs JWTs with an asymmetric ES256 key, so getClaims() verifies
  // locally against the cached public key set — Supabase's recommended
  // server-side check. Trade-off: a session revoked at the Auth server (sign-out
  // everywhere, deleted user) stays valid until its access token expires (≤1h).
  // Access itself is unaffected: the role is still read from user_role_grants
  // on every request below, so removing someone's role takes effect at once.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims
    ? { email: (claimsData.claims.email as string | undefined) ?? undefined }
    : null
  perf.step("auth.getClaims")

  const { pathname, search } = request.nextUrl

  // Public paths: render as-is, but if the user is already signed in
  // and visiting /login, send them to their landing page (landingRouteFor in lib/access-control.ts).
  if (isPublic(pathname)) {
    if (user && pathname === "/login") {
      const url = request.nextUrl.clone()
      url.pathname = landingRouteFor(await getRealRole(user.email))
      url.search = ""
      return NextResponse.redirect(url)
    }
    // /login renders the root layout, so it needs the header too — set to the
    // anonymous payload, which also overwrites any value the client sent.
    return withIdentity(request, response, ANONYMOUS_IDENTITY)
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
  perf.step("role lookup")
  const { effectiveRole: role, person, roleView } = await resolveEffective(
    realRole,
    request.cookies.get(VIEW_AS_USER_COOKIE)?.value,
    request.cookies.get(VIEW_AS_COOKIE)?.value,
  )
  perf.step("view-as resolve")
  // Load the role's allowed routes ONCE (small query; super_user short-circuits
  // to [] and is allowed everything by the canAccessRoute backstop).
  const allowedRoutes = await getAllowedRoutes(role)
  perf.step("allowed routes")
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

  // Allowed. Hand the layout everything we just resolved so it does not repeat
  // the auth call and the two role/route queries.
  return withIdentity(request, response, {
    email: user.email ?? null,
    realRole,
    effectiveRole: role,
    person,
    roleView,
    allowedRoutes,
  })
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
