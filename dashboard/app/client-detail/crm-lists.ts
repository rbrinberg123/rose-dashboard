import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Client Detail → the Events / Tasks block (two small, capped reads — ≤ 10 rows
 * + an exact count each) and the top card's Key Contacts strip. All off the
 * SAME list views the CRM pages use, filtered on the SAME client column each
 * page's "client" quick filter uses — so the counts match "View all" exactly:
 *   - Events   v_admin_events_all.client_account_id     (lib/events/filters.ts)
 *   - Tasks   v_admin_tasks_all.client_account_id      (lib/tasks/filters.ts)
 *   - Contacts v_admin_contacts_all.parent_customer_id  (lib/contacts/filters.ts),
 *     ACTIVE only (is_active — the same flag as state_label = 'Active'), ranked
 *     by keyContactRole below.
 *
 * SCOPING: the caller passes a client that has ALREADY passed the page's
 * Level-2 scope check, and only calls this for a super user — the three CRM
 * list pages and their record loaders are super-user only, so nobody else is
 * shown rows they could not open. Fail-soft: an error empties that one card.
 */

export const CRM_LIST_CAP = 10

export type ClientEventItem = {
  event_id: string
  event_title: string | null
  event_location: string | null
  event_dates: string | null
  meetings_start: string | null
  event_state_label: string | null
}

export type ClientTaskItem = {
  task_id: string
  subject: string | null
  task_type_label: string | null
  due_date: string | null
}

export type ClientContactItem = {
  contact_id: string
  full_name: string | null
  job_title: string | null
  /** CEO / CFO / COO / IR for the priority roles, else null. */
  role: KeyContactRole | null
}

/** Key Contacts priority order — these come first, in this order. */
export const KEY_CONTACT_ROLES = ["CEO", "CFO", "COO", "IR"] as const
export type KeyContactRole = (typeof KEY_CONTACT_ROLES)[number]

/**
 * A contact's priority ROLE. Two sources, structured first:
 *   1. contact_type_label (Dynamics "Contact Type": CEO / CFO / IRO / Other) —
 *      a clean pick list, but it has no COO and many contacts are Other/blank;
 *   2. otherwise keywords in the free-text job_title — whole-word CEO / CFO /
 *      COO / IR / IRO, or "Chief Executive / Financial / Operating",
 *      "Investor Relations". Assistants ("EA to the CFO", "Executive
 *      Assistant to the CEO") are never ranked as the officer.
 * Earlier roles win when a title names two ("President and CEO / CFO").
 */
export function keyContactRole(typeLabel: string | null, title: string | null): KeyContactRole | null {
  const type = (typeLabel ?? "").trim().toUpperCase()
  if (type === "CEO" || type === "CFO") return type
  if (type === "IRO") return "IR"
  const t = (title ?? "").trim()
  if (!t || /\b(assistant|EA)\b/i.test(t)) return null
  if (/\bCEO\b|chief executive/i.test(t)) return "CEO"
  if (/\bCFO\b|chief financial/i.test(t)) return "CFO"
  if (/\bCOO\b|chief operating/i.test(t)) return "COO"
  if (/\bIRO?\b|investor relations/i.test(t)) return "IR"
  return null
}

export type ClientCrmList<T> = { rows: T[]; total: number }

export type ClientCrmLists = {
  events: ClientCrmList<ClientEventItem>
  /** OPEN tasks only (state_label = 'Open'); completed / canceled live under View all. */
  tasks: ClientCrmList<ClientTaskItem>
  /** EVERY active contact, ranked: CEO → CFO → COO → IR, then alphabetical. */
  contacts: ClientCrmList<ClientContactItem>
}

export async function loadClientCrmLists(
  sb: SupabaseClient,
  accountId: string,
): Promise<ClientCrmLists> {
  const [eventsRes, tasksRes, contactsRes] = await Promise.all([
    // Most recent first: by meetings start, then by when the event was created.
    sb
      .from("v_admin_events_all")
      .select("event_id, event_title, event_location, event_dates, meetings_start, event_state_label", { count: "exact" })
      .eq("client_account_id", accountId)
      .order("meetings_start", { ascending: false, nullsFirst: false })
      .order("created_on", { ascending: false })
      .limit(CRM_LIST_CAP),
    // Open tasks, overdue first: ascending due date puts every overdue task
    // ahead of the rest; undated last.
    sb
      .from("v_admin_tasks_all")
      .select("task_id, subject, task_type_label, due_date", { count: "exact" })
      .eq("client_account_id", accountId)
      .eq("state_label", "Open")
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(CRM_LIST_CAP),
    // ALL active contacts (a client has a handful — capped generously), so
    // the ranking below sees every CEO / CFO / COO / IR.
    sb
      .from("v_admin_contacts_all")
      .select("contact_id, full_name, job_title, contact_type_label", { count: "exact" })
      .eq("parent_customer_id", accountId)
      .eq("is_active", true)
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(200),
  ])

  const list = <T,>(res: { data: unknown; error: unknown; count?: number | null }): ClientCrmList<T> =>
    res.error ? { rows: [], total: 0 } : { rows: (res.data ?? []) as T[], total: res.count ?? 0 }

  // Rank: priority roles first (CEO → CFO → COO → IR), then everyone else;
  // alphabetical within each (the query's order, kept by the stable sort).
  const rawContacts = list<{ contact_id: string; full_name: string | null; job_title: string | null; contact_type_label: string | null }>(contactsRes)
  const rank = (r: KeyContactRole | null) => (r ? KEY_CONTACT_ROLES.indexOf(r) : KEY_CONTACT_ROLES.length)
  const contacts: ClientCrmList<ClientContactItem> = {
    total: rawContacts.total,
    rows: rawContacts.rows
      .map((c) => ({
        contact_id: c.contact_id,
        full_name: c.full_name,
        job_title: c.job_title,
        role: keyContactRole(c.contact_type_label, c.job_title),
      }))
      .sort((a, b) => rank(a.role) - rank(b.role)),
  }

  return {
    events: list<ClientEventItem>(eventsRes),
    tasks: list<ClientTaskItem>(tasksRes),
    contacts,
  }
}
