"use client"

import * as React from "react"

// Smooth-scrolls the merged Feedback page to the `#collection` section. Used by
// the header's "Jump to Feedback Collection" button and the clickable
// "Need Feedback" KPI tile. A button (not an <a href="#collection">) so the
// scroll is smooth and the URL hash isn't pushed on every click.
export function ScrollToCollection({
  className,
  title,
  children,
}: {
  className?: string
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() =>
        document
          .getElementById("collection")
          ?.scrollIntoView({ behavior: "smooth", block: "start" })
      }
      className={className}
    >
      {children}
    </button>
  )
}
