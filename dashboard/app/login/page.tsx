import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getRealRole } from "@/lib/user-role"
import { landingRouteFor } from "@/lib/access-control"
import { LoginForm } from "./login-form"
import { MicrosoftSignInButton } from "./microsoft-button"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage() {
  // If already signed in, skip straight to the role's landing page (My
  // Dashboard for those who may open it, else Portfolio — landingRouteFor in lib/access-control.ts).
  // Avoids ping-ponging between /login and the app for a fresh session cookie.
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect(landingRouteFor(await getRealRole(user.email ?? null)))

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-base font-bold">
            R
          </div>
          <h1 className="text-xl font-semibold">Rose &amp; Co. Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your @roseandco.com account — Microsoft, or a one-time email link.
          </p>
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-card p-6 shadow-sm">
          <MicrosoftSignInButton />

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <LoginForm />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Internal tool — access restricted to Rose &amp; Company staff.
        </p>
      </div>
    </div>
  )
}
