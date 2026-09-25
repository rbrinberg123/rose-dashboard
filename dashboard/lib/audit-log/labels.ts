/**
 * Turning the audit trail's internal vocabulary into something readable.
 *
 * `audit_log` stores what the code knows: `account_team_members`,
 * `"<uuid>|account_manager"`, `{"user_id":{"old":null,"new":"<uuid>"}}`. None of
 * that is a sentence. This module is the translation layer the viewer page uses
 * — entity names to labels, field keys to labels, uuids to people and clients,
 * and a whole `changes` blob down to one line.
 *
 * PURE. No I/O and no `@/` imports beyond types, so the formatting rules are
 * unit-testable and the same on the server and in the browser. Everything it
 * needs to resolve a uuid arrives as a plain lookup map.
 *
 * ── READ-ONLY, ALWAYS ──────────────────────────────────────────────────────
 * Nothing here writes. `audit_log` is append-only and the database blocks
 * mutation outright (see sql/patches/2026-09-15c_audit_log.sql); the viewer has
 * no write path of any kind.
 */

/* ------------------------------------------------------------------ types */

export type AuditAction = "create" | "update" | "delete"

/** One row of audit_log, as the list needs it. `changes` is NOT selected here. */
export type AuditListRow = {
  id: number
  occurred_at: string
  actor_email: string | null
  actor_user_id: string | null
  action: string
  entity: string
  record_id: string | null
  context: string | null
  /** A compact one-line rendering, built server-side. See `summarise`. */
  summary: string | null
  /** Who authored the audited record, built server-side. See `originOf`. */
  origin?: AuditOrigin
}

/** The full row, for the drawer. */
export type AuditRecord = AuditListRow & { changes: unknown }

/** uuid -> display name, for both people and accounts. */
export type NameLookup = Record<string, string>

export type ResolveContext = {
  people: NameLookup
  accounts: NameLookup
}

/* --------------------------------------------------------------- entities */

/**
 * Internal entity name -> what a person would call it.
 *
 * Anything not listed falls back to a title-cased version of the raw name, so a
 * new write surface that forgets to register here is still legible rather than
 * invisible.
 */
export const ENTITY_LABELS: Record<string, string> = {
  // Dashboard-owned
  account_team_members: "Account Team",
  account_status: "Client Status",
  client_todo_notes: "Client To-Do Note",
  time_off_requests: "Time Off Request",
  time_off_reviewers: "Time Off Reviewer",

  // Access control
  role_page_access: "Role → Page Access",
  role_data_permission: "Role → Data Permission",
  user_role_grants: "User Role",
  user_data_scopes: "User Data Scopes",

  // Saved views — one per CRM table
  meeting_saved_views: "Saved View · Meetings",
  event_saved_views: "Saved View · Events",
  task_saved_views: "Saved View · Tasks",
  touchpoint_saved_views: "Saved View · Touches",
  note_saved_views: "Saved View · Notes",

  // Financial
  cost_assumptions: "Cost Assumptions",
  client_direct_costs: "Direct Cost",
  revenue_overrides: "Revenue Override",
  overhead_overrides: "Overhead Override",
  overhead_periods: "Quarterly Overhead",
  salary_schedule: "Salary Schedule",

  // Admin / machinery a person acted on
  deletion_candidates: "Deletion Candidate",
  "accounts.ai_summary": "AI Client Summary",

  // CRM tables — the Dynamics mirror tables. They reach the audit log two ways:
  // a reconciliation hard-delete of a SYNCED row, and — since 2026-09-23 — the
  // dashboard's own Add New / test-purge writes (Contacts, Notes, Touches),
  // which create rows with origin='dashboard' in these same tables. So the
  // TABLE no longer says who owns the row; the per-entry origin badge does
  // (see originOf below). Plain names here, deliberately.
  accounts: "Account",
  contacts: "Contact",
  meetings: "Meeting",
  events: "Event",
  tasks: "Task",
  touchpoints: "Touch",
  client_notes: "Client Note",
  contracts: "Contract",
  users: "User",
  new_vacationrequest: "Time Off",
}

export function entityLabel(entity: string): string {
  return (
    ENTITY_LABELS[entity] ??
    entity.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

/** Every entity the viewer offers in its dropdown, in label order. */
export function entityOptions(): { value: string; label: string }[] {
  return Object.keys(ENTITY_LABELS)
    .map((value) => ({ value, label: entityLabel(value) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/* ----------------------------------------------------------------- fields */

/**
 * Field key -> label, for the drawer's old → new list and the one-line summary.
 *
 * Deliberately shallow: these are the keys that actually appear in `changes`
 * today. An unmapped key is title-cased rather than hidden.
 */
export const FIELD_LABELS: Record<string, string> = {
  user_id: "Person",
  owner_user_id: "Owner",
  is_active: "Active",
  allowed: "Allowed",
  role: "Role",
  route: "Route",
  key: "Permission",
  email: "Email",
  note: "Note",
  source: "Source",
  name: "Name",
  config: "View config",
  is_default: "Default",
  scope: "Scope",
  status: "Status",
  updated_by: "Updated by",
  changed_by: "Changed by",
  account_id: "Client",
  // Financial
  annual_salary: "Annual salary",
  annual_bonus: "Annual bonus",
  benefits_multiplier: "Benefits multiplier",
  effective_from: "Effective from",
  effective_to: "Effective to",
  amount: "Amount",
  category: "Category",
  description: "Description",
  cost_date: "Date",
  adjustment_amount: "Adjustment",
  reason: "Reason",
  period_year: "Year",
  period_quarter: "Quarter",
  fixed_amount: "Fixed amount",
  percent_of_total: "Percent of total",
  // Composite / bespoke shapes
  system_default: "System default",
  personal_default: "Personal default",
  raise: "New salary period",
  ended_previous_period: "Previous period ended",
  approved_via: "Approved via",
  candidate_id: "Candidate id",
  pk_column: "Key column",
  ai_summary_generated_at: "Generated at",
  model: "Model",
}

export function fieldLabel(key: string): string {
  return (
    FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
  )
}

/**
 * The account-team role slot, pulled out of a `<account_id>|<role>` record id,
 * so a summary can say "Account Manager" rather than repeating the uuid.
 */
const TEAM_ROLE_LABELS: Record<string, string> = {
  account_manager: "Account Manager",
  secondary_manager: "Secondary Manager",
  feedback_report: "Feedback Report",
  associate: "Associate",
  memo: "Memo",
  logistics: "Logistics Coordinator",
}

/* ------------------------------------------------------------ record ids */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The leading uuid of a record id, if it has one. */
function leadingUuid(recordId: string | null): string | null {
  if (!recordId) return null
  const head = recordId.split("|")[0]?.trim()
  return head && UUID.test(head) ? head : null
}

export type ResolvedRecord = {
  /** What to show. */
  label: string
  /** The client name, when the record turned out to be account-keyed. */
  clientName: string | null
  /** The role slot, for account-team records. */
  roleLabel: string | null
  /** The account id, so the viewer can link to the client. */
  accountId: string | null
}

/**
 * Make a record id readable.
 *
 * Several entities are account-keyed, in two shapes:
 *   account_status / client_todo_notes / accounts.ai_summary  -> the account id
 *   account_team_members                                      -> "<account_id>|<role>"
 * plus a reconciliation delete of an `accounts` mirror row, whose pk_value is
 * also an account id.
 *
 * Rather than listing which entities qualify — a list that would go stale the
 * next time a write surface is added — this just asks whether the id STARTS
 * with a uuid that happens to be a known account. A false positive would need a
 * non-account record whose id is an account's uuid, which cannot happen.
 */
export function resolveRecord(
  entity: string,
  recordId: string | null,
  ctx: ResolveContext,
): ResolvedRecord {
  const raw = recordId ?? "—"
  const uuid = leadingUuid(recordId)
  const clientName = uuid ? (ctx.accounts[uuid] ?? null) : null

  const tail = recordId?.includes("|") ? recordId.split("|")[1] : null
  const roleLabel = tail ? (TEAM_ROLE_LABELS[tail] ?? tail) : null

  if (clientName) {
    return {
      label: roleLabel ? `${clientName} · ${roleLabel}` : clientName,
      clientName,
      roleLabel,
      accountId: uuid,
    }
  }

  // A person-keyed record (user_role_grants is keyed by email) reads fine raw.
  return { label: raw, clientName: null, roleLabel, accountId: null }
}

/* ------------------------------------------------------------ the changes */

/** Is this a `{ old, new }` diff entry rather than a plain snapshot value? */
function isDiffEntry(v: unknown): v is { old: unknown; new: unknown } {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    ("old" in v || "new" in v) &&
    Object.keys(v).every((k) => k === "old" || k === "new")
  )
}

/**
 * Render one value for display.
 *
 * A uuid that is a known person or account becomes their name — which is what
 * turns `{"user_id":{"old":null,"new":"a8dce…"}}` into "— → Brian Smith".
 */
export function formatValue(v: unknown, ctx: ResolveContext): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "number") return String(v)
  if (typeof v === "string") {
    if (UUID.test(v)) return ctx.people[v] ?? ctx.accounts[v] ?? shortUuid(v)
    // An ISO timestamp is noise at full precision in a one-liner.
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10)
    return v.length > 80 ? v.slice(0, 77) + "…" : v
  }
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`
  // An object (a view config, a nested snapshot) — say so rather than dumping it.
  return "{…}"
}

function shortUuid(v: string): string {
  return v.slice(0, 8) + "…"
}

export type ChangeLine = { label: string; old: string | null; new: string | null }

/**
 * Flatten a `changes` blob into label / old / new lines for the drawer.
 *
 * Handles the three shapes the writers produce:
 *   update        { field: { old, new } }
 *   create/delete { field: value }                       -> old is null
 *   bespoke       a mix, e.g. recordRaise's
 *                 { raise: {...}, ended_previous_period: {...} }
 */
export function changeLines(changes: unknown, ctx: ResolveContext): ChangeLine[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return []
  const out: ChangeLine[] = []
  for (const [key, value] of Object.entries(changes as Record<string, unknown>)) {
    if (isDiffEntry(value)) {
      out.push({
        label: fieldLabel(key),
        old: formatValue(value.old, ctx),
        new: formatValue(value.new, ctx),
      })
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      // A nested snapshot (recordRaise). Flatten one level so it stays readable
      // rather than collapsing to "{…}".
      for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
        if (isDiffEntry(v2)) {
          out.push({
            label: `${fieldLabel(key)} · ${fieldLabel(k2)}`,
            old: formatValue(v2.old, ctx),
            new: formatValue(v2.new, ctx),
          })
        } else {
          out.push({
            label: `${fieldLabel(key)} · ${fieldLabel(k2)}`,
            old: null,
            new: formatValue(v2, ctx),
          })
        }
      }
    } else {
      out.push({ label: fieldLabel(key), old: null, new: formatValue(value, ctx) })
    }
  }
  return out
}

/**
 * One line for the list column: the first change, plus a count of the rest.
 *
 * For an account-team row the role comes from the record id, so the line reads
 * "Account Manager: — → Brian Smith" rather than the less useful
 * "Person: — → Brian Smith".
 *
 * Built SERVER-SIDE and shipped as a plain string, so the list query never has
 * to send the whole `changes` blob for every row — see the note in
 * app/admin/audit-log/page.tsx.
 */
export function summarise(
  entity: string,
  recordId: string | null,
  changes: unknown,
  ctx: ResolveContext,
): string | null {
  const lines = changeLines(changes, ctx)
  if (lines.length === 0) return null

  const { roleLabel } = resolveRecord(entity, recordId, ctx)
  const first = lines[0]
  // On an account-team row the single changing field is always the person, so
  // the role is the more informative label.
  const label =
    entity === "account_team_members" && roleLabel && lines.length === 1
      ? roleLabel
      : first.label

  const body =
    first.old === null ? `${label}: ${first.new}` : `${label}: ${first.old} → ${first.new}`

  return lines.length > 1 ? `${body}  (+${lines.length - 1} more)` : body
}

/* ----------------------------------------------------------------- origin */

/**
 * Who authored the AUDITED RECORD, read from the entry itself (not the table):
 *
 *   - the saved snapshot carries origin='dashboard' → a dashboard-authored row
 *     (Add New Contact / Note / Touch, or a test purge); `test` from is_test.
 *   - an edit of a dashboard row → its context says "dashboard row" [· test].
 *   - a reconciliation approve-delete (changes.approved_via) → a SYNCED row;
 *     the sweep and its approve-delete only ever act on origin='dynamics'.
 *   - anything else → null: dashboard-owned tables (account teams, client
 *     status, saved views, permissions, financials) get no badge.
 */
export type AuditOrigin = { source: "dashboard" | "dynamics"; test: boolean } | null

export function originOf(changes: unknown, context?: string | null): AuditOrigin {
  // An EDIT's changes are a field diff with no origin of its own; the edit
  // path (updateDashboardRow) marks its context "dashboard row" [· test].
  if (context && /· dashboard row/.test(context)) {
    return { source: "dashboard", test: /· dashboard row · test/.test(context) }
  }
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return null
  const c = changes as Record<string, unknown>
  if (c.origin === "dashboard") return { source: "dashboard", test: c.is_test === true }
  if (c.approved_via === "deletion-reconciliation") return { source: "dynamics", test: false }
  return null
}

/* ----------------------------------------------------------------- action */

/** Pill colours, keyed to the shared STATUS_PILL_LIGHT vocabulary. */
export const ACTION_PILL: Record<AuditAction, "positive" | "new" | "atRisk"> = {
  create: "positive",
  update: "new",
  delete: "atRisk",
}

export function actionLabel(action: string): string {
  return action.charAt(0).toUpperCase() + action.slice(1)
}

/**
 * The "view-as:someone@…" breadcrumb `recordAudit` writes into `context` when a
 * super-user was impersonating. Surfaced beside the actor, because an action
 * taken while impersonating is worth seeing at a glance.
 */
export function viewAsFrom(context: string | null): string | null {
  if (!context) return null
  const m = /view-as:([^\s·]+)/.exec(context)
  return m ? m[1] : null
}

/** The context with the view-as breadcrumb stripped — usually the page path. */
export function contextWithoutViewAs(context: string | null): string | null {
  if (!context) return null
  const rest = context
    .split("·")
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("view-as:"))
    .join(" · ")
  return rest || null
}
