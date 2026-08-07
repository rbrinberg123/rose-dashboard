import { redirect } from "next/navigation"

// Feedback Collection is now its own page at /feedback-collection. This legacy
// route redirects there, preserving any query params (e.g. the Client Marketing
// Status deep link's ?client=<id>) so existing links keep working.

export const dynamic = "force-dynamic"

export default async function FeedbackRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v))
    else if (value != null) qs.set(key, value)
  }
  const query = qs.toString()
  redirect(`/feedback-collection${query ? `?${query}` : ""}`)
}
