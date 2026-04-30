"use server"

import { redirect } from "next/navigation"
import { getSupabaseServerAuth } from "@/lib/supabase/server"

/**
 * Server Action: clear the Supabase session cookies and bounce to /login.
 * Wired to the sign-out button in the sidebar.
 */
export async function signOutAction() {
  const supabase = await getSupabaseServerAuth()
  await supabase.auth.signOut()
  redirect("/login")
}
