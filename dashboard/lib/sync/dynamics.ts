/**
 * Dynamics 365 Web API client for the nightly sync.
 *
 * Responsibilities:
 *   - OAuth2 client-credentials auth. No bearer tokens live in env vars; we
 *     mint a fresh one from Azure AD and cache it in module memory for its
 *     advertised lifetime (typically 1h), refreshing a minute early.
 *   - Paged reads of an entity set, following @odata.nextLink to exhaustion.
 *   - Retry with exponential backoff for transient network / auth / throttle
 *     failures.
 *
 * This is the TypeScript port of the HTTP half of loader/load.py's upstream
 * (the original export step). The mapping half lives in ./mappers.ts.
 */

const API_VERSION = "v9.2"

/** Annotations we need so the mappers can read FormattedValue + lookup type. */
const INCLUDE_ANNOTATIONS = 'odata.include-annotations="*"'

/** Dynamics returns at most 5000 rows/page regardless; be explicit. */
const PAGE_SIZE = 5000

const MAX_ATTEMPTS = 3

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

/** Strip any trailing slash so we can concatenate paths predictably. */
function dynamicsBaseUrl(): string {
  return requireEnv("DYNAMICS_BASE_URL").replace(/\/+$/, "")
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Run `fn`, retrying up to MAX_ATTEMPTS times with exponential backoff
 * (1s, 2s, 4s). Used for the token request and each page fetch so a blip in
 * the network or a 429/503 from Dynamics doesn't fail the whole entity.
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
 * Return a valid access token, minting a new one if the cache is empty or
 * about to expire. The token is cached in module memory, so within a single
 * serverless invocation (and across invocations that reuse the same warm
 * instance) we reuse it for its full lifetime.
 */
export async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token
  }

  const tenant = requireEnv("AZURE_TENANT_ID")
  const clientId = requireEnv("AZURE_CLIENT_ID")
  const clientSecret = requireEnv("AZURE_CLIENT_SECRET")
  const scope = `${dynamicsBaseUrl()}/.default`

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  })

  const token = await withRetry("OAuth token request", async () => {
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

  // Refresh 60s before the real expiry to avoid using a token mid-flight as
  // it lapses.
  tokenCache = {
    token: token.access_token,
    expiresAt: now + (token.expires_in - 60) * 1000,
  }
  return token.access_token
}

/** Test seam — drop the cached token (used by nothing in prod; handy in dev). */
export function clearTokenCache(): void {
  tokenCache = null
}

type DynamicsPage = {
  value: Record<string, unknown>[]
  "@odata.nextLink"?: string
}

/**
 * Fetch every row of an entity set, following server-driven paging.
 *
 * @param entitySet  Web API entity set name, e.g. "accounts", "bcs_meetings".
 * @param modifiedSince  When set, only rows with `modifiedon gt {iso}` are
 *   returned (incremental pull). When null, a full pull.
 */
export async function fetchAll(
  entitySet: string,
  modifiedSince: string | null,
): Promise<Record<string, unknown>[]> {
  const base = dynamicsBaseUrl()

  let url: string | undefined = `${base}/api/data/${API_VERSION}/${entitySet}`
  if (modifiedSince) {
    const filter = encodeURIComponent(`modifiedon gt ${modifiedSince}`)
    url += `?$filter=${filter}`
  }

  const rows: Record<string, unknown>[] = []

  while (url) {
    const nextLink: string | undefined = await withRetry(
      `fetch ${entitySet}`,
      async () => {
        const token = await getAccessToken()
        const res = await fetch(url as string, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
            "OData-Version": "4.0",
            "OData-MaxVersion": "4.0",
            Prefer: `${INCLUDE_ANNOTATIONS},odata.maxpagesize=${PAGE_SIZE}`,
          },
        })
        if (res.status === 401) {
          // Token may have been revoked early; clear and let retry re-mint.
          clearTokenCache()
          throw new Error("401 Unauthorized from Dynamics")
        }
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`Dynamics returned ${res.status}: ${text}`)
        }
        const page = (await res.json()) as DynamicsPage
        rows.push(...page.value)
        return page["@odata.nextLink"]
      },
    )
    url = nextLink
  }

  return rows
}
