/**
 * Shared definitions for "Add New Client" — the seventh and last dashboard-
 * authored CRM entity (public.accounts, swept nightly). Used by
 * app/accounts/new-client-dialog.tsx and createClient / updateClient in
 * app/accounts/actions.ts; kept out of the "use server" file.
 *
 * SCOPE: the account's OWN fields. The ACCOUNT TEAM (manager / secondary /
 * associate / feedback / logistics / targeting / teaser) is deliberately NOT
 * set here — its source of truth (CRM staff fields vs account_team_members) is
 * a separate, deferred decision. Dynamics rollups (last/next touch & event,
 * days since review, last targeting/teaser, current project) stay display-only.
 *
 * See content/docs/22-cutover-ownership-boundary.md and 20-clients.md.
 */

/** Whether the form's "Test record" toggle starts ON. TEST PHASE: true. */
export const NEW_CLIENT_TEST_DEFAULT = true

/** One choice option (code + label), from the distinct values on accounts. */
export type ClientChoice = { code: number; label: string }
/** One lookup option (id + name), from the distinct values on accounts. */
export type ClientLookup = { id: string; name: string }

/**
 * Option lists for the client form's dropdowns — the DISTINCT values already
 * on accounts (Dynamics option-set metadata is not reachable from here, and
 * countries / master-company records are not synced tables).
 */
export type ClientChoiceOptions = {
  clientStatus: ClientChoice[]
  sector: ClientChoice[]
  industry: ClientChoice[]
  exchange: ClientChoice[]
  secondaryExchange: ClientChoice[]
  hqState: ClientChoice[]
  reportingFrequency: ClientChoice[]
  hqCountry: ClientLookup[]
  companyMaster: ClientLookup[]
}

/** The 12 Yes/No flags already on the drawer (column name → label). */
export const CLIENT_FLAGS = [
  ["do_not_call", "Do Not Call"],
  ["ir_only", "IR Only"],
  ["calendar", "Calendar"],
  ["calendar_confirmed", "Calendar Confirmed"],
  ["distro", "Distro"],
  ["bda_peers", "BDA Peers"],
  ["meeting_history_received", "Mtg History Received"],
  ["mgmt_review", "Mgmt Review"],
  ["recurring_call_scheduled", "Recurring Call"],
  ["report", "Report"],
  ["rep_short_interest", "Rep Short Interest"],
  ["sh_report", "SH Report"],
] as const

/** The four flags flattened 2026-09-23g (column name → label). */
export const CLIENT_PROFILE_FLAGS = [
  ["estimates", "Estimates"],
  ["include_admin", "Include Admin"],
  ["exclude_from_distribution", "Exclude from Distribution"],
  ["contact_ir_only", "Contact IR Only"],
] as const

/** Manually-entered engagement dates (column name → label). Rollups are NOT here. */
export const CLIENT_DATES = [
  ["original_start_date", "Original Start"],
  ["onboarding_call", "Onboarding Call"],
  ["teach_in", "Teach-In"],
  ["teach_in_date", "Teach-In Date"],
  ["last_data_upload", "Last Data Upload"],
  ["shareholder_report_received_date", "SH Report Received"],
] as const

export type ClientFlagKey =
  | (typeof CLIENT_FLAGS)[number][0]
  | (typeof CLIENT_PROFILE_FLAGS)[number][0]
export type ClientDateKey = (typeof CLIENT_DATES)[number][0]

export type NewClientInput = {
  // Overview
  name: string
  tickerSymbol?: string
  /**
   * Active / Inactive (statecode). DRIVES VISIBILITY: Portfolio and the client
   * statistics / onboarding / contract / productivity views only include
   * accounts with state_label = 'Active'.
   */
  active: boolean
  clientStatusCode?: number | null
  sectorCode?: number | null
  industryCode?: number | null
  exchangeCode?: number | null
  hqCountryId?: string | null
  /** $B, as text from the input. */
  marketCapB?: string
  websiteUrl?: string
  email?: string
  ipreoTicker?: string
  companyMasterId?: string | null
  // Primary address (address1_*) + phone
  street?: string
  city?: string
  stateProvince?: string
  postalCode?: string
  country?: string
  phone?: string
  // Account links (NOT the account team)
  primaryContactId?: string | null
  currentEventId?: string | null
  // Engagement dates, YYYY-MM-DD
  dates: Partial<Record<ClientDateKey, string>>
  // Flags (12 existing + 4 profile)
  flags: Partial<Record<ClientFlagKey, boolean>>
  // Profile & preferences
  secondaryExchangeCode?: number | null
  hqStateCode?: number | null
  reportingFrequencyCode?: number | null
  divYield?: string
  meetingSlotMinutes?: string
  meetingPlatformPref?: string
  timezoneCode?: string
  // Notes
  onboardingNotes?: string
  peers?: string
  dietaryRestrictions?: string
  additionalNotes?: string
  targetingParameters?: string
  // System
  ownerId?: string | null
  isTest: boolean
}
