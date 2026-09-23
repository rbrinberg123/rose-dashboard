/**
 * Shared definitions for "Add New Contact" — the first dashboard-authored
 * record type. Used by the form (app/contacts/new-contact-dialog.tsx) and the
 * server action (app/contacts/actions.ts createContact); kept out of the
 * "use server" file because that file may export only async functions.
 *
 * See content/docs/22-cutover-ownership-boundary.md.
 */

/**
 * Whether the form's "Test record" toggle starts ON.
 *
 * TEST PHASE: true, so every contact created while the write path is being
 * proven is marked is_test and can be purged in one click. Going live for real
 * = flip this to false. Nothing else changes.
 */
export const NEW_CONTACT_TEST_DEFAULT = true

/**
 * The Contact Type choices offered on the form — the Dynamics `bcs_contacttype`
 * option-set values actually in use (codes + labels read from the mirror,
 * 2026-09-23). 755860002 is also present in the data but Dynamics returns no
 * label for it, so it is not offered. Stored as text: contact_type_code is a
 * multi-select column (see sql/patches/2026-09-16_contacts_multiselect_fix.sql);
 * the form writes a single value.
 */
export const CONTACT_TYPE_OPTIONS = [
  { code: "755860000", label: "CEO" },
  { code: "755860001", label: "CFO" },
  { code: "755860004", label: "IRO" },
  { code: "755860003", label: "Other" },
] as const

export type NewContactInput = {
  firstName: string
  lastName: string
  jobTitle?: string
  /** accounts.account_id of the client; the name is re-read server-side. */
  clientAccountId?: string | null
  email?: string
  mobilePhone?: string
  directPhone?: string
  city?: string
  /** One of CONTACT_TYPE_OPTIONS[].code, or empty. */
  contactTypeCode?: string

  // ---- the rest of the drawer's editable fields ("form = drawer") ----
  street?: string
  /** One of CONTACT_INDUSTRY_OPTIONS[].code, or empty. */
  industryCode?: string
  /** Active (statecode 0) vs Inactive (1). */
  active: boolean
  irOnly: boolean
  poc: boolean
  doNotCall: boolean
  distributionList: boolean
  exEmployee: boolean
  /** YYYY-MM-DD */
  verifiedOn?: string
  previousCompany?: string
  tickerSymbol?: string
  /** users.user_id — blank = you. */
  ownerId?: string | null
  isTest: boolean
}

/**
 * Industry (bcs_industry) — ONLY the codes whose label Dynamics actually
 * returns in the mirror (2026-09-23). Most industry codes on live contacts come
 * back with no label, so they cannot be offered by name; an existing unlabelled
 * code is preserved on edit (see buildContactColumns).
 */
export const CONTACT_INDUSTRY_OPTIONS = [
  { code: "755860043", label: "Capital Goods" },
  { code: "755860044", label: "Commercial & Professional Services" },
  { code: "755860047", label: "Consumer Durables & Apparel" },
  { code: "755860052", label: "Health Care Equipment & Services" },
  { code: "755860128", label: "Paper & Forest Products" },
  { code: "755860062", label: "Real Estate Management & Development" },
] as const
