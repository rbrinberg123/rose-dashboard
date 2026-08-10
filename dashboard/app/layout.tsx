import type { Metadata } from "next"
import { cookies } from "next/headers"
import { Geist, Geist_Mono } from "next/font/google"
import { Sidebar } from "@/components/nav"
import { ViewAsBanner } from "@/components/view-as-banner"
import { TeamInitialsProvider } from "@/components/team-initials-context"
import { Toaster } from "@/components/ui/sonner"
import { loadTeamInitialsMap } from "@/lib/team-initials-directory"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getRealRole } from "@/lib/user-role"
import { VIEW_AS_COOKIE, VIEW_AS_USER_COOKIE, viewAsLabel } from "@/lib/access-control"
import { resolveEffective } from "@/lib/impersonation"
import { getAllowedRoutes } from "@/lib/page-access"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "Rose & Co. Dashboard",
    template: "%s · Rose & Co. Dashboard",
  },
  description: "Internal management dashboard for Rose & Company",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Fetch the signed-in user once at the layout boundary so the sidebar
  // can render their email + sign-out without each page repeating the
  // call. getUser() contacts Supabase Auth to verify the JWT, so this is
  // also our authenticity check (proxy.ts handles unauthenticated
  // redirects; the layout just reads the result).
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const userEmail = user?.email ?? null
  // Role drives which nav items the sidebar shows. The proxy does its own
  // lookup for enforcement; this one is only for the (cosmetic) nav.
  //
  // Gate the nav on the EFFECTIVE role so "View as" shrinks the sidebar to what
  // the impersonated person/role sees. We also keep the real role: the banner
  // (the always-present exit) shows only when impersonation is actually active.
  const realRole = await getRealRole(userEmail)
  const cookieStore = await cookies()
  const { effectiveRole: role, person, roleView } = await resolveEffective(
    realRole,
    cookieStore.get(VIEW_AS_USER_COOKIE)?.value,
    cookieStore.get(VIEW_AS_COOKIE)?.value,
  )
  // The routes the effective role may reach (from the Roles matrix). Passed to
  // the nav so it hides links the proxy would block — one query, same source.
  const allowedRoutes = await getAllowedRoutes(role)

  // Global account-team initials map — computed once here so same-initial people
  // (e.g. Katie Murphy / Kaila Migliazza) disambiguate to KMu / KMi consistently
  // on every avatar. Only for signed-in users; fail-soft to an empty map.
  const teamInitials = userEmail ? await loadTeamInitialsMap() : {}

  // Banner label: PERSON mode names the person + their real role ("No role" when
  // they have none); ROLE mode names the abstract role. Only super-users ever
  // impersonate, so `person`/`roleView` are already gated on the real role.
  const bannerLabel = person
    ? `Viewing as ${person.name} — ${person.role ? viewAsLabel(person.role) : "No role"}`
    : roleView
      ? `Viewing as ${viewAsLabel(roleView)} (role)`
      : null

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        {bannerLabel ? <ViewAsBanner label={bannerLabel} /> : null}
        <TeamInitialsProvider value={teamInitials}>
          <div className="flex min-h-screen flex-col md:flex-row">
            <Sidebar userEmail={userEmail} role={role} allowedRoutes={allowedRoutes} />
            <main className="flex-1 overflow-x-hidden">{children}</main>
          </div>
        </TeamInitialsProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
