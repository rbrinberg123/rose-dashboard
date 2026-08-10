import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { decideAuthCallback } from "@/lib/auth-callback"
import { isAllowedSessionEmail } from "@/lib/auth-allowlist"

/**
 * Auth callback for BOTH sign-in methods — magic link and Microsoft/Entra SSO.
 * Each redirects here with an authorization `code`, which we exchange for a
 * session (written to cookies by @supabase/ssr). `exchangeCodeForSession`
 * handles both the magic-link and the OAuth authorization-code (PKCE) flows,
 * so no separate OAuth handling is needed.
 *
 * Once a session exists, the domain guard (`decideAuthCallback`) re-checks the
 * verified email: a non-`@roseandco.com` account is signed out and sent to
 * `/no-access`. On success we bounce to the requested page (default
 * `/portfolio`); a missing code or a failed exchange returns to `/login`.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next")

  if (!code) {
    const decision = decideAuthCallback({ hasCode: false, next })
    return NextResponse.redirect(`${origin}${decision.redirectTo}`)
  }

  const supabase = await getSupabaseServerAuth()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  const decision = decideAuthCallback({
    hasCode: true,
    exchangeError: error?.message ?? null,
    sessionEmailAllowed: isAllowedSessionEmail(data.user?.email),
    next,
  })

  if (decision.action === "reject") {
    // Non-Rose email somehow got a session — kill it (defense in depth).
    await supabase.auth.signOut()
  }

  return NextResponse.redirect(`${origin}${decision.redirectTo}`)
}
