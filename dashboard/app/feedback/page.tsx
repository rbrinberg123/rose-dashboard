import { redirect } from "next/navigation"

// Feedback Collection was merged into the Feedback Report Pipeline page. This
// route now redirects to the Collection section of the merged page, preserving
// any query params (e.g. the Client Marketing Status deep link's ?client=<id>)
// and landing on the #collection anchor so existing links keep working.

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
  redirect(`/feedback-manager${query ? `?${query}` : ""}#collection`)
}
