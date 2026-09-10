import type { Role, ViewAsRole } from "@/lib/access-control"
import type { PersonView } from "@/lib/impersonation"

/**
 * The proxy → layout identity handoff.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * proxy.ts already resolves the caller on every request: it validates the JWT,
 * reads their real role, applies "View as", and loads the role's allowed
 * routes — because it must, to enforce access before anything renders. The root
 * layout then needed exactly the same four answers to draw the nav, and used to
 * throw the proxy's work away and re-query all of it (~1 auth call + 2 DB reads,
 * ~300 ms, on every page). Now the proxy hands its result forward.
 *
 * Next.js's documented way to pass data from the proxy to the app is a REQUEST
 * header set via `NextResponse.next({ request: { headers } })` — server-side
 * only, never sent to the browser (that would be `NextResponse.next({ headers })`,
 * which we deliberately do not use).
 *
 * ── SECURITY ───────────────────────────────────────────────────────────────
 * This header is a TRUSTED channel in exactly one direction: proxy → server
 * render. It is safe only because of three properties, and changing any one of
 * them breaks it:
 *
 *   1. The proxy OVERWRITES the header on every request it handles, using
 *      `Headers.set` (not `append`, and never "only if absent"). A client that
 *      sends its own `x-rose-identity: {"realRole":"super_user"}` has that value
 *      discarded and replaced with the server's own finding. Every code path in
 *      proxy.ts that returns a rendering response sets it — including the public
 *      /login path, where it is set to the ANONYMOUS payload rather than left
 *      alone.
 *
 *   2. Nothing that can render the root layout escapes the proxy matcher. The
 *      matcher excludes only /api, _next internals and static file extensions,
 *      none of which render a layout, and the app has no dynamic or catch-all
 *      routes that could be coaxed into matching one of those shapes.
 *
 *   3. The reader FAILS SAFE, not open. A missing, malformed or unparseable
 *      header returns null, and the layout then resolves identity itself exactly
 *      as it did before — see app/layout.tsx. A forged header therefore cannot
 *      do better than "no header at all", which costs a few queries, not access.
 *
 * The header is NOT an authorization decision in its own right: proxy.ts has
 * already enforced canAccessRoute before this value is ever produced, and every
 * page that guards itself (e.g. /meetings, /events) re-checks the role through
 * getEffectiveRole. This only saves the nav from re-deriving what was just
 * computed; it never grants anything.
 *
 * This module imports no `next/headers`, so proxy.ts can use it directly.
 */

export const IDENTITY_HEADER = "x-rose-identity"

/** Everything the root layout needs, as resolved once by the proxy. */
export type ProxyIdentity = {
  email: string | null
  realRole: Role | null
  effectiveRole: ViewAsRole | null
  person: PersonView | null
  roleView: ViewAsRole | null
  allowedRoutes: string[]
}

/** The payload for a request with no signed-in user (e.g. /login). */
export const ANONYMOUS_IDENTITY: ProxyIdentity = {
  email: null,
  realRole: null,
  effectiveRole: null,
  person: null,
  roleView: null,
  allowedRoutes: [],
}

/**
 * Encode for transport. Header values must be latin-1, but display names can be
 * any UTF-8, so the JSON is UTF-8 encoded then base64'd rather than passed raw.
 * Uses btoa/TextEncoder (available in both the edge and Node runtimes) rather
 * than Buffer, which the edge runtime does not provide.
 */
export function encodeIdentityHeader(identity: ProxyIdentity): string {
  const bytes = new TextEncoder().encode(JSON.stringify(identity))
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * Decode a header value produced by encodeIdentityHeader.
 *
 * Returns null for anything it does not fully trust — absent, not base64, not
 * JSON, or not the right shape. Callers MUST treat null as "resolve it yourself"
 * rather than "no access": this is a performance shortcut, and a failure to
 * decode should cost latency, never correctness.
 */
export function decodeIdentityHeader(raw: string | null | undefined): ProxyIdentity | null {
  if (!raw) return null
  try {
    const binary = atob(raw)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!parsed || typeof parsed !== "object") return null
    const p = parsed as Record<string, unknown>
    // Shape check. Anything unexpected → null → the layout resolves it itself.
    if (!("email" in p) || !("effectiveRole" in p)) return null
    if (!Array.isArray(p.allowedRoutes)) return null
    return {
      email: typeof p.email === "string" ? p.email : null,
      realRole: (p.realRole ?? null) as Role | null,
      effectiveRole: (p.effectiveRole ?? null) as ViewAsRole | null,
      person: (p.person ?? null) as PersonView | null,
      roleView: (p.roleView ?? null) as ViewAsRole | null,
      allowedRoutes: p.allowedRoutes.filter((r): r is string => typeof r === "string"),
    }
  } catch {
    return null
  }
}
