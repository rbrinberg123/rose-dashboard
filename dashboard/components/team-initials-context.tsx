"use client"

import * as React from "react"

/**
 * A global, page-independent map of normalized person name → the initials to
 * display on account-team avatar circles (two letters, or three when that
 * person's initials collide with someone else in the full account-team
 * directory). Built once server-side (`lib/team-initials-directory.ts`) and
 * provided at the app root so a person renders identically on every page/team.
 *
 * Default is an empty map: consumers fall back to plain two-letter initials.
 */
const TeamInitialsContext = React.createContext<Record<string, string>>({})

export function TeamInitialsProvider({
  value,
  children,
}: {
  value: Record<string, string>
  children: React.ReactNode
}) {
  return (
    <TeamInitialsContext.Provider value={value}>
      {children}
    </TeamInitialsContext.Provider>
  )
}

export function useTeamInitials(): Record<string, string> {
  return React.useContext(TeamInitialsContext)
}
