/**
 * Microsoft Graph app-only auth (OAuth2 client-credentials flow).
 *
 * This mirrors the pattern already used for Dynamics in lib/sync/dynamics.ts:
 * mint a bearer token from Azure AD and cache it in module memory for its
 * advertised lifetime, refreshing a minute early. No token ever lives in an
 * env var.
 *
 * Two things differ from the Dynamics client on purpose:
 *   - The scope is Graph's `.default` (https://graph.microsoft.com/.default),
 *     so the token's audience is Graph, not Dynamics. Because the audience
 *     differs, this module keeps its OWN cache — the two tokens are not
 *     interchangeable and must never share storage.
 *   - It uses the same Azure app registration (AZURE_TENANT_ID / _CLIENT_ID /
 *     _CLIENT_SECRET). That app has application permission
 *     `Calendars.ReadBasic.All` (admin-consented) for Graph.
 *
 * Self-contained by design (see lib/graph/index.ts) so the Graph integration
 * can be extended without reaching into the sync code.
 */

/** App-only scope. `.default` tells Azure AD to grant all admin-consented
 *  application permissions on the app registration. */
const GRAPH_SCOPE = "https://graph.microsoft.com/.default"

const MAX_ATTEMPTS = 3

/** Refresh this many seconds before the real expiry so we never present a
 *  token that lapses mid-request. */
const EXPIRY_SKEW_SECONDS = 60

type TokenCache = { token: string; expiresAt: number }
let tokenCache: TokenCache | null = null

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) {
    throw new Error(
      `Missing ${name}. Set it in dashboard/.env.local (local) and in the Vercel project settings (production).`,
    )
  }
  return v
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Run `fn`, retrying up to MAX_ATTEMPTS times with exponential backoff
 * (1s, 2s) so a transient network blip or 5xx from the token endpoint doesn't
 * fail the caller.
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 2 ** (attempt - 1))
      }
    }
  }
  throw new Error(
    `${label} failed after ${MAX_ATTEMPTS} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  )
}

/**
 * Return a valid Graph access token, minting a new one if the cache is empty
 * or about to expire. Cached in module memory, so within a warm serverless
 * instance we reuse it for its full ~1h lifetime instead of hitting the token
 * endpoint on every Graph call.
 */
export async function getGraphAccessToken(): Promise<string> {
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token
  }

  const tenant = requireEnv("AZURE_TENANT_ID")
  const clientId = requireEnv("AZURE_CLIENT_ID")
  const clientSecret = requireEnv("AZURE_CLIENT_SECRET")

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: GRAPH_SCOPE,
  })

  const parsed = await withRetry("Graph OAuth token request", async () => {
    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
    )
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`token endpoint returned ${res.status}: ${text}`)
    }
    return (await res.json()) as { access_token: string; expires_in: number }
  })

  tokenCache = {
    token: parsed.access_token,
    expiresAt: now + (parsed.expires_in - EXPIRY_SKEW_SECONDS) * 1000,
  }
  return parsed.access_token
}

/** Test seam — drop the cached token. Handy in dev; unused in prod. */
export function clearGraphTokenCache(): void {
  tokenCache = null
}
