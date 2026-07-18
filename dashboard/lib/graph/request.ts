/**
 * The single choke point for all Microsoft Graph HTTP traffic.
 *
 * Every Graph call in the app goes through `graphFetch`, which:
 *   - attaches a fresh app-only bearer token (see ./token.ts),
 *   - sends/receives JSON,
 *   - honours 429 throttling by waiting out the Retry-After header and
 *     retrying (Graph is aggressively throttled; getSchedule especially),
 *   - surfaces non-OK responses as errors carrying Graph's own error body.
 *
 * Keeping this here means feature functions (getSchedule, and whatever we add
 * later) never touch tokens, headers, or retry logic directly.
 */

import { getGraphAccessToken } from "./token"

const GRAPH_BASE = "https://graph.microsoft.com/v1.0"

/** How many times to wait out a 429 before giving up. */
const MAX_THROTTLE_RETRIES = 3

/** Fallback wait when a 429 arrives without a usable Retry-After header. */
const DEFAULT_RETRY_AFTER_SECONDS = 10

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** An error from Graph that preserves the HTTP status and raw response body. */
export class GraphError extends Error {
  readonly status: number
  readonly body: string
  constructor(status: number, body: string) {
    super(`Microsoft Graph returned ${status}: ${body}`)
    this.name = "GraphError"
    this.status = status
    this.body = body
  }
}

function retryAfterMs(res: Response): number {
  const header = res.headers.get("retry-after")
  if (header) {
    // Retry-After is either seconds (integer) or an HTTP date. Graph sends
    // seconds in practice; parse that and fall back to the default otherwise.
    const seconds = Number(header)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000
    }
  }
  return DEFAULT_RETRY_AFTER_SECONDS * 1000
}

/**
 * Perform a Graph request against `path` (e.g. "/users/{id}/calendar/getSchedule").
 *
 * `path` may be an absolute https URL or a path relative to the Graph v1.0
 * base. The body, if given, is JSON-serialised. Returns the parsed JSON
 * response typed as `T`.
 *
 * Throttling (429) is retried automatically up to MAX_THROTTLE_RETRIES,
 * respecting Retry-After. Any other non-OK status throws a GraphError.
 */
export async function graphFetch<T>(
  path: string,
  init: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const url = path.startsWith("https://") ? path : `${GRAPH_BASE}${path}`

  for (let attempt = 0; ; attempt++) {
    const token = await getGraphAccessToken()

    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })

    if (res.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
      await sleep(retryAfterMs(res))
      continue
    }

    if (!res.ok) {
      throw new GraphError(res.status, await res.text())
    }

    // 204/empty bodies are unusual for the calls we make, but guard anyway.
    const text = await res.text()
    return (text ? JSON.parse(text) : null) as T
  }
}
