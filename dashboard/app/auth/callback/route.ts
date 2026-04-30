import { NextResponse, type NextRequest } from "next/server"
import { getSupabaseServerAuth } from "@/lib/supabase/server"

/**
 * Magic-link callback. Supabase redirects the user here after they click
 * the link in their email, with a `code` query param. We exchange that
 * code for a session (which @supabase/ssr writes to cookies) and bounce
 * to /portfolio.
 *
 * If `code` is missing or the exchange fails, we redirect back to /login
 * with a flag so the form can show an error.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  // Optional `next` param so we can later send users back to the page
  // that bounced them through /login. For now we always go to /portfolio.
  const next = searchParams.get("next") ?? "/portfolio"

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`)
  }

  const supabase = await getSupabaseServerAuth()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}
