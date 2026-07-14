import type { Metadata } from "next"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { signOutAction } from "@/app/auth/actions"
import { Button } from "@/components/ui/button"

/**
 * "Request access" landing page. Shown to a signed-in @roseandco.com user
 * who has no role in the user_roles table (deny-by-default), and as the
 * fallback destination for anyone the proxy blocks from a restricted route.
 *
 * Reachable by any authenticated user (ALWAYS_ALLOWED_ROUTES in
 * lib/access-control.ts) so there is no redirect loop.
 */

export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "Access needed" }

export default async function NoAccessPage() {
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? null

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 px-4 py-12">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-md bg-sidebar-primary text-base font-bold text-sidebar-primary-foreground">
          R
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Access needed</h1>
          <p className="text-sm text-muted-foreground">
            Your account doesn&apos;t have access to this dashboard yet. Please
            reach out to an administrator to get access.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          {email ? (
            <p>
              Signed in as{" "}
              <span className="font-medium text-foreground">{email}</span>
            </p>
          ) : null}
          <form action={signOutAction} className="mt-4">
            <Button type="submit" variant="outline" className="w-full">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
