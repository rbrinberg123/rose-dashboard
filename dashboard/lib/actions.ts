/**
 * Common return shape for server actions in the admin pages. Discriminated by
 * `ok` so client code can reliably narrow on it for toast messaging.
 *
 * Server actions never throw to the client — they return ActionResult and
 * the client decides how to surface success/failure.
 */

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export function ok<T>(data?: T): ActionResult<T> {
  return { ok: true, data: data as T }
}

export function fail(error: string): ActionResult<never> {
  return { ok: false, error }
}

/**
 * Translate a Supabase error message into something safe to render. Supabase
 * error objects sometimes have `details` or `hint` populated and the raw
 * `message` is fine for an internal admin tool.
 */
export function describeError(err: { message?: string; details?: string; hint?: string } | null): string {
  if (!err) return "Unknown error"
  const parts = [err.message, err.details, err.hint].filter(Boolean)
  return parts.join(" — ") || "Unknown error"
}
