"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2,
  Landmark,
  Users,
  CalendarDays,
  FileText,
  Settings,
  Lock,
  Menu,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { canAccessRoute, type Role } from "@/lib/access-control"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { signOutAction } from "@/app/auth/actions"

type NavItem = { href: string; label: string }
type NavSection = {
  label: string
  icon: React.ComponentType<{ className?: string }>
  items: NavItem[]
}

const sections: NavSection[] = [
  {
    label: "Clients",
    icon: Building2,
    items: [
      { href: "/client-statistics", label: "Statistics" },
      { href: "/portfolio", label: "Portfolio" },
      { href: "/client-detail", label: "Detail" },
    ],
  },
  {
    label: "Institutions",
    icon: Landmark,
    items: [
      { href: "/institutions", label: "Directory" },
      { href: "/institution-detail", label: "Detail" },
      { href: "/institution-style", label: "Finder" },
    ],
  },
  {
    label: "Productivity",
    icon: Users,
    items: [
      { href: "/people-statistics", label: "Statistics" },
      { href: "/productivity", label: "Summary" },
      { href: "/productivity-detail", label: "Detail" },
      { href: "/capacity", label: "Capacity" },
    ],
  },
  {
    label: "Logistics",
    icon: CalendarDays,
    items: [
      // The original /planning page is hidden from the nav (route kept, unlinked);
      // "Planning" now points at the former Planning Lab (app/planning-v2).
      { href: "/planning-v2", label: "Planning" },
      { href: "/scheduler", label: "Host Calendar" },
      { href: "/client-marketing-status", label: "Marketing Status" },
      { href: "/live-outreach", label: "Live Outreach" },
      { href: "/profiles", label: "Profiles" },
      { href: "/feedback", label: "Feedback Collection" },
      { href: "/feedback-manager", label: "Feedback Report Pipeline" },
      { href: "/pipeline", label: "Upcoming Meetings" },
      { href: "/onboarding", label: "Onboarding" },
      { href: "/relationships", label: "Relationships" },
      { href: "/time-off", label: "Time Off" },
    ],
  },
  {
    label: "Contracts",
    icon: FileText,
    items: [{ href: "/contract-management", label: "Management" }],
  },
]

function Section({
  section,
  current,
  onNavigate,
}: {
  section: NavSection
  current: string
  onNavigate?: () => void
}) {
  const { label, icon: Icon, items } = section
  return (
    <div className="px-3 py-[5px]">
      {/* Non-clickable category label — static, no hover/navigation */}
      <div className="mb-[3px] flex items-center gap-2 px-2 text-[12px] font-medium uppercase tracking-wider text-[#9AA1AD]">
        <Icon className="size-[18px] shrink-0" />
        <span>{label}</span>
      </div>
      <ul className="space-y-0.5">
        {items.map(({ href, label: itemLabel }) => {
          const active = current === href || current.startsWith(href + "/")
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center rounded-md py-[3px] pl-6 pr-2 text-sm transition-colors",
                  active
                    ? "bg-[#EEF2FB] font-medium text-[#1E2858]"
                    : "text-[#5B6472] hover:bg-[#F4F6F9] hover:text-[#1E2858]",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-1 left-0 w-[3px] rounded-full"
                    style={{ background: "linear-gradient(180deg, #1E2858, #0355A7)" }}
                  />
                )}
                <span className="truncate">{itemLabel}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NavContents({
  pathname,
  role,
  onNavigate,
}: {
  pathname: string
  role: Role | null
  onNavigate?: () => void
}) {
  // Drive visibility off the SAME allow-list the proxy enforces with, so the
  // nav and the security gate can never disagree. Filter items the user can't
  // access, then drop any section left with no items (no empty headers).
  const visible = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessRoute(role, item.href)),
    }))
    .filter((section) => section.items.length > 0)

  return (
    <>
      {visible.map((section, i) => (
        <React.Fragment key={section.label}>
          {i > 0 ? <div className="mx-3 my-0.5 border-t border-[#EDEFF3]" /> : null}
          <Section section={section} current={pathname} onNavigate={onNavigate} />
        </React.Fragment>
      ))}
    </>
  )
}

/* Pinned, disabled admin row — muted, non-clickable, no navigation. */
function AdminRow() {
  return (
    <div
      aria-disabled="true"
      className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-[#9AA1AD]"
    >
      <Settings className="size-[18px] shrink-0" />
      <span className="flex-1 uppercase tracking-wider text-[12px] font-medium">Admin</span>
      <Lock className="size-3.5 shrink-0 opacity-70" />
    </div>
  )
}

function Brand() {
  return (
    /* Horizontal Rose & Co IQ lockup — navy on transparent, sits on the light sidebar. */
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src="/roseco-iq-logo_3.png"
      alt="Rose &amp; Co IQ Dashboards"
      className="h-auto w-full max-w-[160px] object-contain"
    />
  )
}

export function Sidebar({
  userEmail,
  role,
}: {
  userEmail?: string | null
  role?: Role | null
}) {
  const pathname = usePathname() || "/"
  const [mobileOpen, setMobileOpen] = React.useState(false)
  // Admin is super-user-only; gate it off the same allow-list as everything
  // else (checked against the real admin route).
  const showAdmin = canAccessRoute(role ?? null, "/admin/sync")

  // Close the mobile sheet on route change.
  React.useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Hide the entire shell on auth-flow pages so /login and /auth/callback
  // render edge-to-edge. The "/no-access" landing is also shell-less — a
  // role-less user has no nav items to show anyway.
  if (
    pathname === "/login" ||
    pathname === "/no-access" ||
    pathname.startsWith("/auth/")
  ) {
    return null
  }

  return (
    <>
      {/* Mobile top bar — visible below md */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-[#EDEFF3] bg-white px-3 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Open navigation" />
            }
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-white p-0">
            <SheetHeader className="border-b border-[#EDEFF3] bg-white">
              <SheetTitle className="flex items-center justify-center">
                <Brand />
              </SheetTitle>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto py-2">
              <NavContents
                pathname={pathname}
                role={role ?? null}
                onNavigate={() => setMobileOpen(false)}
              />
            </nav>
            {showAdmin ? (
              <div className="border-t border-[#EDEFF3] px-3 py-2">
                <AdminRow />
              </div>
            ) : null}
            {userEmail ? (
              <div className="border-t border-[#EDEFF3] p-3">
                <UserPanel email={userEmail} />
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rose-logo.png" alt="Rose &amp; Co." className="size-8 object-contain" />
      </header>

      {/* Desktop sidebar — visible at md+ */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-[#EDEFF3] bg-white md:sticky md:top-0 md:flex md:h-screen">
        {/* Logo header, faint bottom divider */}
        <div className="flex items-center justify-center border-b border-[#EDEFF3] bg-white px-4 pb-4 pt-5">
          <Brand />
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <NavContents pathname={pathname} role={role ?? null} />
        </nav>
        {showAdmin ? (
          <div className="border-t border-[#EDEFF3] px-3 py-2">
            <AdminRow />
          </div>
        ) : null}
        {userEmail ? (
          <div className="border-t border-[#EDEFF3] px-3 py-3">
            <UserPanel email={userEmail} />
          </div>
        ) : (
          <div className="border-t border-[#EDEFF3] px-4 py-3 text-xs text-[#9AA1AD]">
            v0.1 · Internal
          </div>
        )}
      </aside>
    </>
  )
}

function UserPanel({ email }: { email: string }) {
  return (
    <div className="space-y-2">
      <div className="px-2 text-xs text-[#9AA1AD]" title={email}>
        Signed in as
        <div className="truncate text-[#5B6472]">{email}</div>
      </div>
      <form action={signOutAction}>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-[#5B6472] hover:bg-[#F4F6F9] hover:text-[#1E2858]"
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </form>
    </div>
  )
}
