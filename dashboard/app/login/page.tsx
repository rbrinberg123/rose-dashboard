import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { LoginForm } from "./login-form"

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage() {
  // If already signed in, skip straight to the dashboard. Avoids
  // ping-ponging between /login and /portfolio for users with a fresh
  // session cookie.
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect("/portfolio")

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-base font-bold">
            R
          </div>
          <h1 className="text-xl font-semibold">Rose &amp; Co. Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Sign in with your @roseandco.com email. We&apos;ll send you a one-time link.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <LoginForm />
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Internal tool — access restricted to Rose &amp; Company staff.
        </p>
      </div>
    </div>
  )
}
