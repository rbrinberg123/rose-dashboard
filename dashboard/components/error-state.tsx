"use client"

import { AlertTriangle, RotateCw } from "lucide-react"
import { PageShell } from "@/components/page-shell"
import { Button } from "@/components/ui/button"

/**
 * Used by per-route error.tsx files. Renders a clear error card with a
 * "Try again" button (which calls Next.js's `reset` to retry the boundary).
 * In production we never show the underlying stack — only the message and
 * digest, so we can correlate with server logs without leaking internals.
 */
export function ErrorState({
  title,
  description,
  error,
  reset,
}: {
  title: string
  description?: string
  error: Error & { digest?: string }
  reset: () => void
}) {
  const isDev = process.env.NODE_ENV !== "production"

  return (
    <PageShell title={title} description={description}>
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-destructive">Something went wrong</div>
            <p className="mt-1 text-sm text-muted-foreground">
              We couldn&apos;t load this page. The issue has been recorded — please try again.
            </p>
            {isDev && error?.message ? (
              <pre className="mt-3 overflow-x-auto rounded-md border border-destructive/20 bg-background p-2 text-xs text-muted-foreground">
                {error.message}
              </pre>
            ) : null}
            {error?.digest ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Reference: <span className="font-mono">{error.digest}</span>
              </p>
            ) : null}
            <div className="mt-4 flex items-center gap-2">
              <Button variant="default" size="sm" onClick={() => reset()}>
                <RotateCw /> Try again
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
