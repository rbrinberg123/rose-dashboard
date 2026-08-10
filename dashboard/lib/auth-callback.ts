/**
 * Pure decision logic for the auth callback (`app/auth/callback/route.ts`).
 *
 * Both sign-in methods use the same authorization-code exchange:
 * - Magic link → Supabase redirects to `/auth/callback?code=…`.
 * - Microsoft/Entra SSO → the OAuth provider redirects to `/auth/callback?code=…`.
 *
 * So a single callback covers both. The route performs the I/O (exchange the
 * code for a session, run the domain guard, sign out) and delegates the
 * branching to this function. It has NO Next/Supabase/relative imports, so it
 * stays a testable leaf (`npm test`) and never drags server code into the
 * runner.
 *
 * The domain guard (defense in depth) is applied by the route via
 * `isAllowedSessionEmail` (lib/auth-allowlist) and passed in as
 * `sessionEmailAllowed`: once a verified session exists, a non-`@roseandco.com`
 * address is signed out and routed to `/no-access` instead of continuing.
 */

export type CallbackDecision =
  | { action: "continue"; redirectTo: string }
  | { action: "reject"; signOut: true; redirectTo: string }
  | { action: "error"; redirectTo: string }

/** Default landing page after a successful sign-in. */
const DEFAULT_NEXT = "/portfolio"

/** Only honor a relative, same-origin `next` — never an absolute/off-site URL. */
function safeNext(next: string | null | undefined): string {
  if (typeof next !== "string") return DEFAULT_NEXT
  // Must be a path on this app: starts with a single "/", not "//" (which the
  // browser treats as a protocol-relative absolute URL) and not "/\".
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_NEXT
  }
  return next
}

export function decideAuthCallback(params: {
  hasCode: boolean
  exchangeError?: string | null
  /** Result of the domain guard on the verified session email (route-computed). */
  sessionEmailAllowed?: boolean
  next?: string | null
}): CallbackDecision {
  if (!params.hasCode) {
    return { action: "error", redirectTo: "/login?error=missing_code" }
  }

  if (params.exchangeError) {
    return {
      action: "error",
      redirectTo: `/login?error=${encodeURIComponent(params.exchangeError)}`,
    }
  }

  // Session established — enforce the domain guard.
  if (!params.sessionEmailAllowed) {
    return { action: "reject", signOut: true, redirectTo: "/no-access" }
  }

  return { action: "continue", redirectTo: safeNext(params.next) }
}
