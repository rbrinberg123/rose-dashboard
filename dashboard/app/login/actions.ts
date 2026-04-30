"use server"

import { headers } from "next/headers"
import { z } from "zod"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import {
  isAllowedEmail,
  ALLOWLIST_REJECTION_MESSAGE,
} from "@/lib/auth-allowlist"

export type LoginState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "error"; message: string }

// zod 4 prefers `z.email()` over `.email()` on a string schema. We still
// pipe through `.trim().toLowerCase()` so the allowlist comparison is
// case- and whitespace-insensitive.
const EmailSchema = z
  .preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
    z.email(),
  )

/**
 * Server Action: validate the email, check the allowlist, and ask
 * Supabase to send a magic link. The client form passes the previous
 * state via `useActionState`; we return a discriminated union so the
 * UI can render confirmation or an error.
 *
 * The redirect URL is built from the request's `Origin` header so
 * production, preview, and localhost all work without env-var fiddling.
 */
export async function sendMagicLink(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const raw = formData.get("email")
  if (typeof raw !== "string") {
    return { status: "error", message: "Please enter your email address." }
  }

  const parsed = EmailSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      status: "error",
      message: "That doesn't look like a valid email address.",
    }
  }
  const email = parsed.data

  if (!isAllowedEmail(email)) {
    // Don't disclose whether the address exists in the auth tenant.
    return { status: "error", message: ALLOWLIST_REJECTION_MESSAGE }
  }

  const h = await headers()
  // Vercel sets `x-forwarded-proto` + `x-forwarded-host`; locally we have
  // `host`. Origin header is set by browsers but missing for some clients.
  const origin =
    h.get("origin") ??
    `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`

  const supabase = await getSupabaseServerAuth()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      shouldCreateUser: true,
    },
  })

  if (error) {
    return {
      status: "error",
      message: `Could not send magic link: ${error.message}`,
    }
  }

  return { status: "sent", email }
}
