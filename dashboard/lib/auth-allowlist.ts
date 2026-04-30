/**
 * Email allowlist for auth.
 *
 * Only addresses that match one of the rules below can request a magic
 * link. The check runs on the server (in the login Server Action) — the
 * client-side validation is a courtesy; the server is the gate.
 *
 * To allow a new domain or one-off address, add it below.
 */

const ALLOWED_DOMAINS: readonly string[] = [
  "roseandco.com",
]

const ALLOWED_EMAILS: readonly string[] = [
  // Add specific addresses here, e.g. "external-collaborator@gmail.com"
]

/**
 * Returns true if the given email is permitted to log in.
 * Comparison is case-insensitive and trims surrounding whitespace.
 */
export function isAllowedEmail(rawEmail: string): boolean {
  const email = rawEmail.trim().toLowerCase()
  if (!email || !email.includes("@")) return false

  // Exact-match individual exceptions first.
  if (ALLOWED_EMAILS.some((e) => e.toLowerCase() === email)) return true

  // Then domain match.
  const at = email.lastIndexOf("@")
  const domain = email.slice(at + 1)
  return ALLOWED_DOMAINS.some((d) => d.toLowerCase() === domain)
}

/** Human-readable rejection message used by the login form. */
export const ALLOWLIST_REJECTION_MESSAGE =
  "Access restricted to Rose & Company staff."
