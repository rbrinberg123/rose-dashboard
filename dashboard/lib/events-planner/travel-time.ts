import "server-only"

/**
 * Travel-time estimates for the Events Planner.
 *
 * TravelTimeProvider is the seam: the builder asks "how long from A to B by
 * this mode?" and never knows who answers.
 *   - ManualProvider (default): no estimate — the coordinator types the time.
 *   - GoogleRoutesProvider: only when GOOGLE_MAPS_API_KEY is set (optional;
 *     Google Routes API, computeRoutes). Driving for car/taxi, walking for
 *     walk, transit for train. Flights are never estimated.
 * An estimate fills duration_minutes with duration_source='estimated'; any
 * manual edit afterwards flips it back to 'manual'.
 */

export type TravelQuery = {
  fromAddress: string
  toAddress: string
  mode: string
  /** Departure instant (ISO), so traffic-aware estimates can use it. */
  departAt: string | null
}

export interface TravelTimeProvider {
  readonly name: "manual" | "google"
  /** Can this provider estimate at all? */
  readonly available: boolean
  /** Minutes, or null when it can't estimate this trip. */
  estimate(q: TravelQuery): Promise<number | null>
}

export class ManualProvider implements TravelTimeProvider {
  readonly name = "manual" as const
  readonly available = false
  async estimate(): Promise<number | null> {
    return null
  }
}

const GOOGLE_MODE: Record<string, string | undefined> = {
  car_service: "DRIVE",
  taxi_rideshare: "DRIVE",
  walk: "WALK",
  train: "TRANSIT",
}

export class GoogleRoutesProvider implements TravelTimeProvider {
  readonly name = "google" as const
  readonly available = true
  constructor(private readonly apiKey: string) {}

  async estimate(q: TravelQuery): Promise<number | null> {
    const travelMode = GOOGLE_MODE[q.mode]
    if (!travelMode || !q.fromAddress.trim() || !q.toAddress.trim()) return null
    const body: Record<string, unknown> = {
      origin: { address: q.fromAddress },
      destination: { address: q.toAddress },
      travelMode,
    }
    // Traffic-aware only for driving, and only for a future departure.
    if (travelMode === "DRIVE") {
      body.routingPreference = "TRAFFIC_AWARE"
      if (q.departAt && Date.parse(q.departAt) > Date.now()) body.departureTime = new Date(q.departAt).toISOString()
    } else if (travelMode === "TRANSIT" && q.departAt && Date.parse(q.departAt) > Date.now()) {
      body.departureTime = new Date(q.departAt).toISOString()
    }
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        "X-Goog-FieldMask": "routes.duration",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    })
    if (!res.ok) throw new Error(`Google Routes ${res.status}`)
    const json = (await res.json()) as { routes?: { duration?: string }[] }
    const d = json.routes?.[0]?.duration // e.g. "1234s"
    const secs = d ? Number(d.replace(/s$/, "")) : NaN
    return Number.isFinite(secs) ? Math.max(1, Math.round(secs / 60)) : null
  }
}

/** The configured provider: Google when its key is set, otherwise manual. */
export function getTravelTimeProvider(): TravelTimeProvider {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim()
  return key ? new GoogleRoutesProvider(key) : new ManualProvider()
}
