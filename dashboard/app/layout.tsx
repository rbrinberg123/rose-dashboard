import type { Metadata } from "next"
import { cookies, headers } from "next/headers"
import { Geist, Geist_Mono } from "next/font/google"
import { Sidebar } from "@/components/nav"
import { SectionNav } from "@/components/section-nav"
import { ViewAsBanner } from "@/components/view-as-banner"
import { TeamInitialsProvider } from "@/components/team-initials-context"
import { Toaster } from "@/components/ui/sonner"
import { loadTeamInitialsMap } from "@/lib/team-initials-directory"
import { loadCriticalAlertCount } from "@/app/clients/alerts/critical-count"
import { getSupabaseServerAuth } from "@/lib/supabase/server"
import { getRealRole } from "@/lib/user-role"
import { VIEW_AS_COOKIE, VIEW_AS_USER_COOKIE, viewAsLabel } from "@/lib/access-control"
import { resolveEffective } from "@/lib/impersonation"
import { getAllowedRoutes } from "@/lib/page-access"
import { SIDEBAR_COLLAPSED_COOKIE, isSidebarCollapsed } from "@/lib/sidebar"
import {
  IDENTITY_HEADER,
  decodeIdentityHeader,
  type ProxyIdentity,
} from "@/lib/identity-header"
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

/**
 * The pre-proxy-handoff resolution path, kept as the fallback for when the
 * identity header is missing or unparseable (see the note in the layout body).
 *
 * This is the ORIGINAL code, unchanged in behaviour: verify the JWT with
 * Supabase Auth, read the real role, apply "View as", load the allowed routes.
 * It costs one auth round trip and two queries, which is exactly what the
 * header exists to avoid — so this should essentially never run in practice.
 */
async function resolveIdentityLocally(
  cookieStore: Awaited<ReturnType<typeof cookies>>,
): Promise<ProxyIdentity> {
  const supabase = await getSupabaseServerAuth()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const email = user?.email ?? null
  const realRole = await getRealRole(email)
  const { effectiveRole, person, roleView } = await resolveEffective(
    realRole,
    cookieStore.get(VIEW_AS_USER_COOKIE)?.value,
    cookieStore.get(VIEW_AS_COOKIE)?.value,
  )
  return {
    email,
    realRole,
    effectiveRole,
    person,
    roleView,
    allowedRoutes: await getAllowedRoutes(effectiveRole),
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Identity comes from proxy.ts, which already resolved all four of these to
  // enforce access before this render started: the signed-in user, their real
  // role, the "View as" resolution, and the routes the effective role may reach.
  // It arrives on a server-only request header (see lib/identity-header.ts for
  // why that is safe and why a forged header cannot do better than no header).
  //
  // FALLBACK, NOT FAIL-CLOSED: if the header is absent or unparseable we resolve
  // it here exactly as before. That costs an auth call plus two queries, which
  // is the old behaviour — a decode failure must never look like "signed out".
  const headerStore = await headers()
  const forwarded = decodeIdentityHeader(headerStore.get(IDENTITY_HEADER))
  const cookieStore = await cookies()

  const resolved = forwarded ?? (await resolveIdentityLocally(cookieStore))
  const { email: userEmail, effectiveRole: role, person, roleView, allowedRoutes } = resolved

  // Remembered sidebar width. Reading it here (rather than in the client) means
  // the first paint already has the right width — no expand/collapse flash.
  const sidebarCollapsed = isSidebarCollapsed(
    cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value,
  )

  // Global account-team initials map — computed once here so same-initial people
  // (e.g. Katie Murphy / Kaila Migliazza) disambiguate to KMu / KMi consistently
  // on every avatar. Only for signed-in users; fail-soft to an empty map.
  //
  // The Alerts badge count rides along in the SAME batch rather than adding a
  // serial round trip to every page in the app. It is scoped to the EFFECTIVE
  // person (so "View as" previews their badge, not yours) and is given that
  // email directly — resolving identity inside it would undo the whole point of
  // the proxy header above, which exists to avoid a ~180 ms auth call per page.
  const effectiveEmail = person?.email ?? userEmail
  const [teamInitials, alertCount] = userEmail
    ? await Promise.all([loadTeamInitialsMap(), loadCriticalAlertCount(effectiveEmail)])
    : [{}, 0]

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
            <Sidebar
              userEmail={userEmail}
              role={role}
              allowedRoutes={allowedRoutes}
              defaultCollapsed={sidebarCollapsed}
              alertCount={alertCount}
            />
            <main className="flex-1 overflow-x-hidden">
              {/* Sectional nav strip — the ONE mount point. It renders itself
                  to null on any page that isn't a multi-page nav section, so
                  no page has to opt in or out. Remove this line + the import
                  to drop the feature entirely. */}
              <SectionNav role={role} allowedRoutes={allowedRoutes} />
              {children}
            </main>
          </div>
        </TeamInitialsProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
