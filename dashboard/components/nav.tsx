"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Briefcase,
  Users,
  MessageSquare,
  CalendarClock,
  FileText,
  TrendingUp,
  Settings2,
  DollarSign,
  Receipt,
  PiggyBank,
  ShieldAlert,
  AlertTriangle,
  ClipboardList,
  Menu,
  LogOut,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { signOutAction } from "@/app/auth/actions"

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> }

const dashboards: NavItem[] = [
  { href: "/portfolio", label: "Client Portfolio", icon: Briefcase },
  { href: "/productivity", label: "Productivity", icon: Users },
  { href: "/feedback", label: "Feedback Discipline", icon: MessageSquare },
  { href: "/pipeline", label: "Pipeline (Next 30 Days)", icon: CalendarClock },
  { href: "/renewals", label: "Contract Renewals", icon: FileText },
  { href: "/margin", label: "Margin by Client", icon: TrendingUp },
]

const admin: NavItem[] = [
  { href: "/cost-assumptions", label: "Cost Assumptions", icon: Settings2 },
  { href: "/salary-schedule", label: "Salary Schedule", icon: DollarSign },
  { href: "/direct-costs", label: "Direct Costs", icon: Receipt },
  { href: "/quarterly-overhead", label: "Quarterly Overhead", icon: PiggyBank },
  { href: "/overhead-overrides", label: "Overhead Overrides", icon: ShieldAlert },
  { href: "/revenue-overrides", label: "Revenue Overrides", icon: ClipboardList },
  { href: "/exceptions", label: "Exception Report", icon: AlertTriangle },
]

function Section({
  title,
  items,
  current,
  onNavigate,
}: {
  title: string
  items: NavItem[]
  current: string
  onNavigate?: () => void
}) {
  return (
    <div className="px-3 py-2">
      <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <ul className="space-y-0.5">
        {items.map(({ href, label, icon: Icon }) => {
          const active = current === href || current.startsWith(href + "/")
          return (
            <li key={href}>
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium ring-1 ring-sidebar-border"
                    : "text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{label}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function NavContents({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <>
      <Section title="Dashboards" items={dashboards} current={pathname} onNavigate={onNavigate} />
      <div className="my-2 mx-3 border-t border-sidebar-border/60" />
      <Section title="Admin" items={admin} current={pathname} onNavigate={onNavigate} />
    </>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-7 items-center justify-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground text-sm font-bold">
        R
      </div>
      <span className="font-semibold text-sidebar-foreground">Rose &amp; Co.</span>
    </div>
  )
}

export function Sidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname() || "/"
  const [mobileOpen, setMobileOpen] = React.useState(false)

  // Close the mobile sheet on route change.
  React.useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  // Hide the entire shell on auth-flow pages so /login and /auth/callback
  // render edge-to-edge.
  if (pathname === "/login" || pathname.startsWith("/auth/")) {
    return null
  }

  return (
    <>
      {/* Mobile top bar — visible below md */}
      <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-sidebar-border bg-sidebar px-3 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Open navigation" />
            }
          >
            <Menu className="size-5" />
          </SheetTrigger>
          <SheetContent side="left" className="w-72 bg-sidebar p-0">
            <SheetHeader className="border-b border-sidebar-border">
              <SheetTitle className="flex items-center gap-2">
                <Brand />
              </SheetTitle>
            </SheetHeader>
            <nav className="flex-1 overflow-y-auto py-2">
              <NavContents pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            </nav>
            {userEmail ? (
              <div className="border-t border-sidebar-border p-3">
                <UserPanel email={userEmail} />
              </div>
            ) : null}
          </SheetContent>
        </Sheet>
        <Brand />
      </header>

      {/* Desktop sidebar — visible at md+ */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <Brand />
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <NavContents pathname={pathname} />
        </nav>
        {userEmail ? (
          <div className="border-t border-sidebar-border px-3 py-3">
            <UserPanel email={userEmail} />
          </div>
        ) : (
          <div className="border-t border-sidebar-border px-4 py-3 text-xs text-muted-foreground">
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
      <div className="px-2 text-xs text-muted-foreground" title={email}>
        Signed in as
        <div className="truncate text-sidebar-foreground">{email}</div>
      </div>
      <form action={signOutAction}>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-sidebar-foreground/80 hover:text-sidebar-foreground"
        >
          <LogOut className="size-4" />
          Sign out
        </Button>
      </form>
    </div>
  )
}
