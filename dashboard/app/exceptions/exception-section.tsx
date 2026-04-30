"use client"

import * as React from "react"
import { CheckCircle2, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Shell for one section on the Exception Report page. Collapsible card with
 * a header showing the rule name, a count badge (red if >0, green check
 * if 0), and an optional subtitle. Default open state mirrors the spec:
 * sections with issues open by default, clean sections collapsed.
 */
export function ExceptionSection({
  title,
  count,
  description,
  action,
  children,
}: {
  title: string
  count: number
  description?: React.ReactNode
  /** Action prompt rendered below the table. */
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const hasIssues = count > 0
  const [open, setOpen] = React.useState(hasIssues)

  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex flex-1 items-start gap-3 min-w-0">
          {open ? (
            <ChevronDown className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">{title}</h2>
              <CountBadge count={count} />
            </div>
            {description ? (
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
      </button>

      {open ? (
        <div className="border-t border-border">
          {hasIssues ? (
            <>
              <div className="overflow-x-auto">{children}</div>
              {action ? (
                <div className="border-t border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
                  {action}
                </div>
              ) : null}
            </>
          ) : (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              <CheckCircle2 className="mx-auto mb-1 size-5 text-emerald-600 dark:text-emerald-400" />
              No issues found.
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function CountBadge({ count }: { count: number }) {
  const tone =
    count === 0
      ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
      : "bg-rose-100 text-rose-900 dark:bg-rose-900/30 dark:text-rose-200"
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums",
        tone,
      )}
    >
      {count > 0 ? <AlertTriangle className="size-3" /> : <CheckCircle2 className="size-3" />}
      {count.toLocaleString()}
    </span>
  )
}
