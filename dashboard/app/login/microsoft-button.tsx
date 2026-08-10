"use client"

import * as React from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { getSupabaseBrowser } from "@/lib/supabase/browser"

/** The Microsoft four-square logo (brand-standard for "Sign in with Microsoft"). */
function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" className="size-4">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  )
}

/**
 * "Sign in with Microsoft" — starts the Entra (Azure) OAuth flow via Supabase.
 * The provider is configured entirely in the Supabase dashboard (single-tenant);
 * no client secret lives in this repo. On success the browser is redirected to
 * Microsoft and comes back through `/auth/callback` (see `app/auth/callback`).
 *
 * The magic-link form remains available below this button as a fallback.
 */
export function MicrosoftSignInButton() {
  const [pending, setPending] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  async function handleClick() {
    setError(null)
    setPending(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "azure",
        options: {
          // Same callback route the magic link uses; derived from the current
          // origin so localhost / preview / production all work unchanged.
          redirectTo: `${window.location.origin}/auth/callback`,
          scopes: "email openid profile",
        },
      })
      if (oauthError) {
        setError(oauthError.message)
        setPending(false)
      }
      // On success the browser navigates away to Microsoft — leave the
      // spinner up; there is no further UI to render here.
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not start Microsoft sign-in.",
      )
      setPending(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleClick}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <MicrosoftLogo />
        )}
        Sign in with Microsoft
      </Button>

      {error ? (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  )
}
