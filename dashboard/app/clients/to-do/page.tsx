import type { Metadata } from "next"
import { PageShell } from "@/components/page-shell"
import { getSupabaseServer } from "@/lib/supabase"
import { getEffectiveIdentity } from "@/lib/effective-identity"
import { resolveClientScope } from "@/lib/access/data-scope"
import { NoClientsAssigned } from "@/components/scoped-empty"
import type {
  ClientTodoRow,
  ClientTodoTableRow,
  ClientTodoReportDetail,
  ClientTodoCollectionDetail,
  ClientTodoTouchDetail,
} from "@/lib/types"
import { loadConfirmedMeetingsByEvent } from "@/lib/event-meetings"
import { decideTodoLoad, visibleTodoRows } from "./todo-scope"
import { TodoTable } from "./todo-table"

// Always fetch fresh: the view recomputes every count and age on read, and the
// inline notes are written by other people while the page is open.
export const dynamic = "force-dynamic"

export const metadata: Metadata = { title: "To-Do List" }

export default async function ClientToDoPage() {
  const sb = getSupabaseServer()

  // Level-2 client scoping (Account Management), the same model Portfolio and
  // Client Detail use. The service-role key bypasses RLS, so THIS is the gate.
  const scope = await resolveClientScope(await getEffectiveIdentity())
  const load = decideTodoLoad(scope)
  if (load.mode === "deny") {
    return (
      <PageShell title="To-Do List" description="Clients on your account team">
        <NoClientsAssigned />
      </PageShell>
    )
  }

  let todoQuery = sb.from("v_client_todo").select("*").order("client_name", { ascending: true })
  if (load.mode === "filter") todoQuery = todoQuery.in("account_id", load.accountIds)
  const { data, error } = await todoQuery

  if (error) {
    return (
      <PageShell
        title="To-Do List"
        description="One row per active client — what needs doing"
      >
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <div className="font-medium text-destructive">Could not load v_client_todo</div>
          <div className="mt-1 text-muted-foreground">{error.message}</div>
          <div className="mt-2 text-muted-foreground">
            If this view has not been created yet, run{" "}
            <code className="rounded bg-muted px-1">sql/20_client_todo.sql</code> in the
            Supabase SQL editor.
          </div>
        </div>
      </PageShell>
    )
  }

  // Defence in depth: re-filter whatever came back against the same scope, so a
  // query that somehow returned out-of-scope rows still can't be rendered.
  const rows = visibleTodoRows((data ?? []) as ClientTodoRow[], scope)

  // Tooltip detail for the two Feedback figures. The counts themselves come from
  // the view (same two source views), so these lists can only agree with them.
  // Both reads are fail-soft: an error just leaves the tooltips listing nothing.
  const accountIds = rows.map((r) => r.account_id)
  let reportsQuery = sb
    .from("v_feedback_pipeline")
    .select("client_account_id, event_name, category")
  let collectionsQuery = sb
    .from("v_feedback_outstanding")
    .select("client_account_id, meeting_date, institution_name")
    .order("meeting_date", { ascending: false })
  if (load.mode === "filter") {
    reportsQuery = reportsQuery.in("client_account_id", accountIds)
    collectionsQuery = collectionsQuery.in("client_account_id", accountIds)
  }
  // Detail behind each row's Last Touch date. v_client_todo carries only the
  // date, so the touchpoint itself comes from the base table — the same table
  // Client Detail reads. Newest first; we pick one per client below.
  // Client Manager — the account manager (accounts.sales_lead_primary_name).
  // Not on v_client_todo, so it comes from one bulk read merged by account_id,
  // the same pattern Portfolio uses for its account-team columns. Restricted to
  // the visible accounts, so the filter's option list can only ever contain
  // managers of clients this viewer is already entitled to see.
  let managerQuery = sb.from("accounts").select("account_id, sales_lead_primary_name")
  if (load.mode === "filter") managerQuery = managerQuery.in("account_id", accountIds)

  // Client status flag for the Status pill. Same field and same view Portfolio's
  // "Status (latest note)" column reads, so the two pages can never disagree
  // about a client's status. v_client_todo doesn't carry it, so it is one bulk
  // read merged by account_id — the manager pattern directly above, and the same
  // scoping: restricted to the accounts this viewer is already entitled to see,
  // then re-checked against `allowed` on merge. Fail-soft, like the others: a
  // failed read just leaves every pill as an em dash.
  let statusQuery = sb
    .from("v_client_portfolio")
    .select("account_id, note_status, note_status_date")
  if (load.mode === "filter") statusQuery = statusQuery.in("account_id", accountIds)

  let touchQuery = sb
    .from("touchpoints")
    .select(
      "client_account_id, touchpoint_id, scheduled_start, subject, touchpoint_type_label, owner_name",
    )
    .not("client_account_id", "is", null)
    .not("scheduled_start", "is", null)
    .order("scheduled_start", { ascending: false })
    // ~1.1k rows firm-wide today; the explicit cap keeps us off the 1000-row
    // default without silently truncating a realistic result set.
    .limit(5000)
  if (load.mode === "filter") touchQuery = touchQuery.in("client_account_id", accountIds)

  const [reportsRes, collectionsRes, touchRes, managerRes, statusRes] =
    await Promise.all([
      reportsQuery,
      collectionsQuery,
      touchQuery,
      managerQuery,
      statusQuery,
    ])

  const allowed = new Set(accountIds)
  const reportsByClient: Record<string, ClientTodoReportDetail[]> = {}
  for (const r of (reportsRes.data ?? []) as ClientTodoReportDetail[]) {
    if (!r.client_account_id || !allowed.has(r.client_account_id)) continue
    ;(reportsByClient[r.client_account_id] ??= []).push(r)
  }
  const collectionsByClient: Record<string, ClientTodoCollectionDetail[]> = {}
  for (const c of (collectionsRes.data ?? []) as ClientTodoCollectionDetail[]) {
    if (!c.client_account_id || !allowed.has(c.client_account_id)) continue
    ;(collectionsByClient[c.client_account_id] ??= []).push(c)
  }

  // Pin each row's Last Touch tooltip to the EXACT touchpoint the cell's date
  // refers to: walking newest-first, the first one landing on or before that
  // Eastern day is it. Matching on the day (rather than just taking the newest
  // row) keeps the tooltip and the date from ever disagreeing — the view caps
  // last_touch_date at today, so a touchpoint scheduled later today is skipped
  // here too.
  const easternDay = (ts: string) =>
    new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/New_York" })
  const lastTouchByClient: Record<string, ClientTodoTouchDetail> = {}
  const lastTouchDayByClient = new Map(rows.map((r) => [r.account_id, r.last_touch_date]))
  for (const t of (touchRes.data ?? []) as ClientTodoTouchDetail[]) {
    const id = t.client_account_id
    if (!id || !allowed.has(id) || lastTouchByClient[id] || !t.scheduled_start) continue
    const day = lastTouchDayByClient.get(id)
    if (!day || easternDay(t.scheduled_start) > day) continue
    lastTouchByClient[id] = t
  }

  // Attach the client manager to each row. Fail-soft: a failed read just leaves
  // every row unassigned, so the filter offers only "All" rather than breaking.
  const managerByAccount = new Map(
    ((managerRes.data ?? []) as {
      account_id: string
      sales_lead_primary_name: string | null
    }[]).map((a) => [a.account_id, a.sales_lead_primary_name]),
  )
  const statusByAccount = new Map(
    ((statusRes.data ?? []) as {
      account_id: string
      note_status: string | null
      note_status_date: string | null
    }[])
      .filter((a) => allowed.has(a.account_id))
      .map((a) => [a.account_id, a]),
  )
  const tableRows: ClientTodoTableRow[] = rows.map((r) => ({
    ...r,
    client_manager_name: managerByAccount.get(r.account_id) ?? null,
    note_status: statusByAccount.get(r.account_id)?.note_status ?? null,
    note_status_date: statusByAccount.get(r.account_id)?.note_status_date ?? null,
  }))

  // Confirmed meetings for the events on screen, so clicking a row's event
  // cluster can open the shared detail pane. Same helper (and therefore the same
  // single query) Client Detail's Marketing Events block uses. Scoped implicitly:
  // the ids come from `rows`, which the client scope already filtered.
  const meetingsByEvent = await loadConfirmedMeetingsByEvent(
    rows.map((r) => r.next_event_id),
  )

  return (
    <PageShell
      title="To-Do List"
      description={`${rows.length.toLocaleString()} active clients`}
      hideHeader
      canvas
    >
      <TodoTable
        rows={tableRows}
        reportsByClient={reportsByClient}
        collectionsByClient={collectionsByClient}
        lastTouchByClient={lastTouchByClient}
        meetingsByEvent={meetingsByEvent}
      />
    </PageShell>
  )
}
