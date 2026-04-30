import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseProxy } from "@/lib/supabase/proxy"

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

  return response
}

/**
 * Matcher: run proxy on everything EXCEPT
 *   - Next internals (_next/static, _next/image)
 *   - Public asset files at the URL root (favicon, robots, sitemap, etc.)
 *
 * API routes don't exist in this app today; if they're added later, add
 * `api` to the negative lookahead.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|map)$).*)",
  ],
}
