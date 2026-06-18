// Shared "light-and-airy" design tokens — one source of truth for the canvas,
// the floating-card elevation, and the restrained palette. Pages and shared
// components draw from here so the system stays consistent.
//
// Visual only. No data/behaviour lives in this file.

import type { PillVariant } from "@/lib/gradients"

/** Soft off-white canvas the white cards float on. */
export const CANVAS = "#F4F6F9"

// ---- Text scale -----------------------------------------------------------
export const TEXT_PRIMARY = "#1A2233"
export const TEXT_SECONDARY = "#5B6472"
export const TEXT_MUTED = "#6B7280"
export const TEXT_TERTIARY = "#9AA1AD"

// ---- Brand + accents (used sparingly) -------------------------------------
export const BRAND_NAVY = "#1E2858"
export const BRAND_BLUE = "#0355A7"
export const TEAL = "#1C8C9C"
/** The one green, reserved for money. */
export const MONEY_GREEN = "#0E7C56"

/** 4px gradient accent strip down the left edge of header cards. */
export const ACCENT_STRIP = "linear-gradient(180deg, #1E2858, #0355A7, #1C8C9C)"
/** Navy→blue badge / logo chip. */
export const BADGE_GRADIENT = "linear-gradient(135deg, #1E2858, #0355A7)"

// ---- Floating surfaces ----------------------------------------------------
// Static white card: barely-there border + soft layered shadow. NO hover lift,
// because a lift implies the card is clickable. Use this for the vast majority
// of cards — KPI tiles, tables, content panels that just display info.
export const CARD_CLASS =
  "rounded-[14px] bg-white border border-[rgba(16,24,40,0.04)] " +
  "shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.05)]"

/** Same static surface, slightly tighter radius for the KPI tiles. */
export const KPI_CARD_CLASS =
  "rounded-[13px] bg-white border border-[rgba(16,24,40,0.04)] " +
  "shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_rgba(16,24,40,0.05)]"

// Interactive variant: the static card PLUS a 2px hover lift + stronger shadow.
// Use ONLY on cards that are genuine links / navigate somewhere, where the lift
// correctly signals "this is clickable" (e.g. the Activity section cards).
export const INTERACTIVE_CARD_CLASS =
  CARD_CLASS +
  " transition duration-150 hover:-translate-y-0.5 " +
  "hover:shadow-[0_2px_4px_rgba(16,24,40,0.05),0_12px_32px_rgba(16,24,40,0.09)]"

/** Clean white control (selector / button) styling for mastheads. */
export const CONTROL_STYLE = {
  background: "#FFFFFF",
  border: "1px solid #E6E9EF",
  color: TEXT_PRIMARY,
  borderRadius: 9,
  boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
} as const

/**
 * Status pill colors on a LIGHT background (the app is light now, so the
 * dark-gradient pill variants in lib/gradients no longer read). Keyed by the
 * same note-sentiment PillVariant so existing mapping logic is reused.
 */
export const STATUS_PILL_LIGHT: Record<
  PillVariant,
  { bg: string; text: string }
> = {
  new: { bg: "#EEF2FB", text: "#2D4A8A" },
  positive: { bg: "#E7F5EE", text: "#0E7C56" },
  watch: { bg: "#FCF4E6", text: "#92600B" },
  atRisk: { bg: "#FDECEC", text: "#B42318" },
  neutral: { bg: "#F1F3F7", text: "#5B6472" },
}

// ---- Client relationship-status flag colors ------------------------------
// THE single source of truth for the latest-client-note status flag colors.
// `bg` is the pill fill, `fg` the saturated text/segment color. Imported by the
// Portfolio Status column + filter legend (portfolio-table.tsx) AND the Client
// Statistics "Clients by Status" donut, so the two can never drift. NB Stable and
// Strong intentionally share one green here — change it in this one place to
// re-color both the pills and the donut at once.
export const NOTE_STATUS_PILL: Record<string, { bg: string; fg: string }> = {
  "At Risk": { bg: "#FED7D7", fg: "#C53030" },
  Lost: { bg: "#E5E7EB", fg: "#6B7280" },
  Stable: { bg: "#C6F6D5", fg: "#2D7A2D" },
  Strong: { bg: "#C6F6D5", fg: "#2D7A2D" },
  "New Client": { bg: "#E6E9F5", fg: "#1E2858" },
}
/** Fallback pill colors for an unrecognized / future status flag. */
export const NOTE_STATUS_PILL_FALLBACK = { bg: "#E5E7EB", fg: "#6B7280" }

// ---- Contract Days-Left pill colors --------------------------------------
// THE single source of truth for the contract days-to-expiry urgency colors:
// red < 30, amber 30-89, green >= 90, gray for terminated / no contract. `bg` is
// the pill fill, `fg` the saturated text/bar color. Imported by the Days-Left
// pill (contract-fields.tsx) AND the Client Statistics "Clients by Days Left"
// chart so they stay in lockstep.
export const DAYS_LEFT_PILL: Record<
  "red" | "amber" | "green" | "gray",
  { bg: string; fg: string }
> = {
  red: { bg: "#FED7D7", fg: "#C53030" },
  amber: { bg: "#FEEBC8", fg: "#B7791F" },
  green: { bg: "#C6F6D5", fg: "#2D7A2D" },
  gray: { bg: "#E5E7EB", fg: "#6B7280" },
}
