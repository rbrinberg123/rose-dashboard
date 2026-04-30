"use client"

import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Header button for sortable columns. Used by all dashboard tables — pass the
 * column's `getIsSorted()` and `toggleSorting()` from TanStack.
 */
export function SortHeader({
  label,
  isSorted,
  onClick,
  align = "left",
}: {
  label: string
  isSorted: false | "asc" | "desc"
  onClick: () => void
  align?: "left" | "right"
}) {
  const Icon = isSorted === "asc" ? ArrowUp : isSorted === "desc" ? ArrowDown : ArrowUpDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground",
        align === "right" && "justify-end",
      )}
    >
      {align === "left" && <span>{label}</span>}
      <Icon className={cn("size-3 shrink-0", isSorted ? "text-foreground" : "text-muted-foreground/60")} />
      {align === "right" && <span>{label}</span>}
    </button>
  )
}
