/**
 * PURE cron bearer-token check — no I/O, unit-testable.
 *
 * `/api/*` is excluded from the auth proxy, so each cron route is its own
 * security boundary. This is the header half of that check; a route may layer a
 * session check alongside it (see /api/client-summary/refresh-all, which also
 * accepts a signed-in super_user so the Admin button needs no token).
 */

/**
 * Does this request carry the cron bearer token?
 *
 * FAILS CLOSED: an unset/blank secret rejects everything, rather than leaving a
 * paid endpoint open when the environment is misconfigured.
 */
export function hasCronBearer(
  authorization: string | null | undefined,
  secret: string | undefined | null,
): boolean {
  if (!secret) return false
  return authorization === `Bearer ${secret}`
}
