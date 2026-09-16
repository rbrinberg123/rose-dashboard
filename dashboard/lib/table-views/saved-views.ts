import "server-only"

/**
 * Saved-view CRUD — THE APP'S ONLY WRITE PATH, shared by every CRM table.
 *
 * ══ SECURITY: READ THIS BEFORE CHANGING ANYTHING ═══════════════════════════
 *
 * This file is parameterised by entity precisely BECAUSE it is the security
 * boundary. Meetings and Events store their views in different tables, but a
 * second copy of these rules would be a second place for them to be wrong, and
 * the second copy is the one nobody re-reads. One implementation, two callers.
 *
 * Every query goes through `getSupabaseServer()`, the SERVICE-ROLE client, which
 * BYPASSES RLS. The tables do have RLS enabled with zero policies, but that
 * protects the OTHER door — a direct PostgREST request using the public anon key
 * — not this one. For the path the app actually uses, this file is the only
 * thing standing there, and a missing check here is a real hole that no database
 * policy will catch. The invariants:
 *
 *   1. IDENTITY IS RESOLVED SERVER-SIDE, NEVER PASSED IN.
 *      No function takes an owner id, a user id or an email. The caller comes
 *      from `getEffectiveIdentity()` and nothing else, so a hand-crafted request
 *      cannot claim to be someone else. The id is folded to its CANONICAL form
 *      (mirroring public.canonical_user_id) so a person with duplicate Dynamics
 *      records has one set of views, and validated as a uuid before it is ever
 *      interpolated into a PostgREST expression.
 *
 *   2. PERSONAL VIEWS ARE PRIVATE.
 *      The list query filters on `owner_user_id = <caller>`, so nobody else's
 *      row is ever FETCHED — it cannot leak through a later logging or
 *      serialisation mistake. Updates and deletes carry the same predicate in
 *      their OWN WHERE clause, not just in a prior SELECT, so a concurrent
 *      ownership change cannot be raced: the write matches zero rows and fails.
 *
 *   3. SYSTEM VIEWS ARE SUPER-USER WRITE.
 *      Readable by anyone who can open the page; created, edited, defaulted and
 *      deleted only by an effective `super_user`.
 *
 *   4. IMPERSONATION IS READ-ONLY.
 *      A super-user in "View as" mode READS the impersonated person's views —
 *      that is what the preview is for — but every mutation is refused.
 *
 *   5. CONFIGS ARE VALIDATED, NOT TRUSTED.
 *      Everything inbound goes through `parseConfig`, which admits only known
 *      column keys and a closed operator set.
 *
 * The database carries the same invariants as a third layer: CHECK constraints
 * pairing scope with owner, and partial unique indexes for "at most one personal
 * default per user" and "at most one system default".
 *
 * SCOPE NOTE: these tables hold display preferences only. Nothing in them can
 * change a CRM record — the mirror stays read-only.
 */

import { revalidatePath } from "next/cache"

import { getSupabaseServer } from "@/lib/supabase"
import { diffRows, recordAudit, snapshot } from "@/lib/audit"
import { getEffectiveIdentity, getEffectiveRole } from "@/lib/effective-identity"
import { describeError, fail, ok, type ActionResult } from "@/lib/actions"
import { builtinSavedViews, parseConfig } from "./config"
import type { EntitySpec, SavedView, SavedViewScope } from "./types"

type ViewRow = {
  id: string
  scope: SavedViewScope
  owner_user_id: string | null
  name: string
  config: unknown
  is_default: boolean
}

const SELECT = "id, scope, owner_user_id, name, config, is_default"

/**
 * A canonical user id must be a plain uuid.
 *
 * Checked because `listSavedViews` interpolates the id into a PostgREST `or()`
 * expression — the one place in this file where a value becomes query GRAMMAR
 * rather than a bound argument. An id that fails this degrades to system views
 * only rather than becoming a filter injection.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function safeUserId(id: string | null): string | null {
  return id && UUID_RE.test(id) ? id : null
}

export type Caller = {
  userId: string | null
  isSuperUser: boolean
  impersonated: boolean
}

/**
 * Fold a user id to its canonical identity, mirroring public.canonical_user_id.
 * Fails LOUD: if the lookup errors we do not know who the caller is, and
 * guessing would risk reading or writing the wrong person's rows.
 */
async function canonicalise(userId: string | null): Promise<{ id: string | null; error?: string }> {
  if (!userId) return { id: null }
  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from("user_id_aliases")
    .select("canonical_user_id")
    .eq("alias_user_id", userId)
    .maybeSingle()
  if (error) return { id: null, error: `Identity lookup failed: ${error.message}` }
  return { id: (data?.canonical_user_id as string | undefined) ?? userId }
}

/**
 * Resolve the caller, or refuse.
 *
 * These pages are super-user-only (ADMIN_ONLY_ROUTES), and this re-checks rather
 * than assuming the page gated it — a server action is its own entry point and
 * can be invoked directly. Role and identity resolve concurrently; neither feeds
 * the other, and the role is still checked before any table is touched.
 */
export async function requireCaller(): Promise<
  { ok: true; caller: Caller } | { ok: false; error: string }
> {
  const [role, identity] = await Promise.all([getEffectiveRole(), getEffectiveIdentity()])
  if (role !== "super_user") return { ok: false, error: "Not authorised." }

  const canon = await canonicalise(identity.userId)
  if (canon.error) return { ok: false, error: canon.error }

  return {
    ok: true,
    caller: {
      userId: safeUserId(canon.id),
      isSuperUser: role === "super_user",
      impersonated: identity.impersonated,
    },
  }
}

/** Mutations are refused while impersonating — invariant 4. */
function refuseIfImpersonating(caller: Caller): string | null {
  return caller.impersonated
    ? "Saved views cannot be changed while viewing as another user. Exit View as first."
    : null
}

/** Row → SavedView, dropping anything whose stored config no longer parses. */
function toSavedView(spec: EntitySpec, row: ViewRow, callerId: string | null): SavedView | null {
  const parsed = parseConfig(spec, row.config)
  if (!parsed.ok) return null
  return {
    id: row.id,
    scope: row.scope,
    name: row.name,
    config: parsed.config,
    isDefault: row.is_default,
    builtin: false,
    mine: row.scope === "personal" && !!callerId && row.owner_user_id === callerId,
  }
}

/**
 * Every view the caller may see: the built-ins, all system views, and the
 * caller's OWN personal views.
 *
 * The `.or()` is the privacy boundary, expressed as a query predicate rather
 * than a post-filter in JS: nobody else's personal row is ever fetched.
 */
export async function listSavedViews(spec: EntitySpec): Promise<ActionResult<SavedView[]>> {
  const auth = await requireCaller()
  if (!auth.ok) return fail(auth.error)
  const { caller } = auth

  const sb = getSupabaseServer()
  const ownerId = safeUserId(caller.userId)
  let q = sb.from(spec.savedViewsTable).select(SELECT)
  q = ownerId
    ? q.or(`scope.eq.system,and(scope.eq.personal,owner_user_id.eq.${ownerId})`)
    : q.eq("scope", "system")

  const { data, error } = await q
    .order("scope", { ascending: true })
    .order("name", { ascending: true })
  if (error) return fail(describeError(error))

  const rows = ((data ?? []) as ViewRow[])
    .map((r) => toSavedView(spec, r, caller.userId))
    .filter((v): v is SavedView => v !== null)

  return ok([...builtinSavedViews(spec), ...rows])
}

function validateName(name: unknown): { ok: true; name: string } | { ok: false; error: string } {
  if (typeof name !== "string") return { ok: false, error: "A view needs a name." }
  const trimmed = name.trim()
  if (!trimmed) return { ok: false, error: "A view needs a name." }
  if (trimmed.length > 80) return { ok: false, error: "Name is too long (80 characters max)." }
  return { ok: true, name: trimmed }
}

/**
 * Create a view. `scope` decides which rule applies: a personal view is forced
 * to the CALLER's own id (the argument cannot name an owner), and a system view
 * requires super_user.
 */
export async function createSavedView(
  spec: EntitySpec,
  input: { name: string; scope: SavedViewScope; config: unknown },
): Promise<ActionResult<{ id: string }>> {
  const auth = await requireCaller()
  if (!auth.ok) return fail(auth.error)
  const { caller } = auth

  const blocked = refuseIfImpersonating(caller)
  if (blocked) return fail(blocked)

  const named = validateName(input.name)
  if (!named.ok) return fail(named.error)

  const parsed = parseConfig(spec, input.config)
  if (!parsed.ok) return fail(parsed.error)

  if (input.scope !== "system" && input.scope !== "personal") return fail("Unknown view scope.")
  if (input.scope === "system" && !caller.isSuperUser) {
    return fail("Only a super-user can create a System view.")
  }
  if (input.scope === "personal" && !caller.userId) {
    return fail("Your login is not linked to a user record, so personal views cannot be saved.")
  }

  const sb = getSupabaseServer()
  const { data, error } = await sb
    .from(spec.savedViewsTable)
    .insert({
      scope: input.scope,
      // NEVER from the argument — invariant 1.
      owner_user_id: input.scope === "personal" ? caller.userId : null,
      name: named.name,
      config: parsed.config,
      is_default: false,
    })
    .select("id")
    .single()

  if (error) return fail(describeError(error))

  // AUDIT — see lib/audit.ts. `entity` is the concrete table, so a meetings
  // view and a notes view do not land in one undifferentiated pile.
  await recordAudit({
    action: "create",
    entity: spec.savedViewsTable,
    recordId: data.id as string,
    changes: snapshot({
      scope: input.scope,
      name: named.name,
      owner_user_id: input.scope === "personal" ? caller.userId : null,
      config: parsed.config,
    }),
    context: `/${spec.key}`,
  })

  revalidatePath(`/${spec.key}`)
  return ok({ id: data.id as string })
}

/**
 * Update a view's name and/or config.
 *
 * The ownership predicate is in the UPDATE's own WHERE clause. A personal view
 * belonging to someone else matches zero rows, which surfaces as "not found"
 * rather than as a silent no-op — and never as a successful write.
 */
export async function updateSavedView(
  spec: EntitySpec,
  input: { id: string; name?: string; config?: unknown },
): Promise<ActionResult> {
  const auth = await requireCaller()
  if (!auth.ok) return fail(auth.error)
  const { caller } = auth

  const blocked = refuseIfImpersonating(caller)
  if (blocked) return fail(blocked)
  if (!input.id) return fail("No view id.")

  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const named = validateName(input.name)
    if (!named.ok) return fail(named.error)
    patch.name = named.name
  }
  if (input.config !== undefined) {
    const parsed = parseConfig(spec, input.config)
    if (!parsed.ok) return fail(parsed.error)
    patch.config = parsed.config
  }
  if (Object.keys(patch).length === 0) return fail("Nothing to update.")

  const sb = getSupabaseServer()

  // Which rule applies depends on the row's scope, so read it first — but the
  // authorisation is re-applied in the write predicate below, so this read is
  // for routing, not for permission.
  const { data: existing, error: readErr } = await sb
    .from(spec.savedViewsTable)
    // name + config come along for the audit diff; scope/owner_user_id are what
    // the routing below needs.
    .select("scope, owner_user_id, name, config")
    .eq("id", input.id)
    .maybeSingle()
  if (readErr) return fail(describeError(readErr))
  if (!existing) return fail("View not found.")

  const scope = existing.scope as SavedViewScope
  if (scope === "system" && !caller.isSuperUser) {
    return fail("Only a super-user can edit a System view.")
  }

  let q = sb.from(spec.savedViewsTable).update(patch).eq("id", input.id)
  if (scope === "personal") {
    if (!caller.userId) return fail("Not authorised.")
    q = q.eq("owner_user_id", caller.userId) // the privacy boundary, in the WHERE
  } else {
    q = q.is("owner_user_id", null)
  }

  const { data, error } = await q.select("id")
  if (error) return fail(describeError(error))
  if (!data || data.length === 0) return fail("View not found, or not yours to edit.")

  // AUDIT — see lib/audit.ts.
  const changes = diffRows(existing, patch)
  if (changes) {
    await recordAudit({
      action: "update",
      entity: spec.savedViewsTable,
      recordId: input.id,
      changes,
      context: `/${spec.key}`,
    })
  }

  revalidatePath(`/${spec.key}`)
  return ok()
}

/**
 * Make a view the caller's default (or the system default).
 *
 * Two writes, because the DB enforces at most one default per user: clear the
 * caller's current default, then set the new one. Order matters — setting first
 * would trip the unique index. Passing `id: null` just clears.
 */
export async function setDefaultSavedView(
  spec: EntitySpec,
  input: { id: string | null; scope: SavedViewScope },
): Promise<ActionResult> {
  const auth = await requireCaller()
  if (!auth.ok) return fail(auth.error)
  const { caller } = auth

  const blocked = refuseIfImpersonating(caller)
  if (blocked) return fail(blocked)

  const sb = getSupabaseServer()
  const table = spec.savedViewsTable

  if (input.scope === "system") {
    if (!caller.isSuperUser) return fail("Only a super-user can set the System default.")
    const { error: clearErr } = await sb
      .from(table)
      .update({ is_default: false })
      .eq("scope", "system")
      .eq("is_default", true)
    if (clearErr) return fail(describeError(clearErr))

    if (input.id) {
      const { data, error } = await sb
        .from(table)
        .update({ is_default: true })
        .eq("id", input.id)
        .eq("scope", "system")
        .select("id")
      if (error) return fail(describeError(error))
      if (!data || data.length === 0) return fail("System view not found.")
    }

    // AUDIT — logged as one event on the ENTITY rather than per row: setting a
    // default clears the old one and sets the new one, and two entries would
    // read as two unrelated edits. `input.id` null means "no system default".
    await recordAudit({
      action: "update",
      entity: spec.savedViewsTable,
      recordId: input.id ?? null,
      changes: { system_default: { old: null, new: input.id ?? null } },
      context: `/${spec.key} · setDefault(system)`,
    })

    revalidatePath(`/${spec.key}`)
    return ok()
  }

  if (!caller.userId) {
    return fail("Your login is not linked to a user record, so a default cannot be saved.")
  }

  const { error: clearErr } = await sb
    .from(table)
    .update({ is_default: false })
    .eq("scope", "personal")
    .eq("owner_user_id", caller.userId)
    .eq("is_default", true)
  if (clearErr) return fail(describeError(clearErr))

  if (input.id) {
    const { data, error } = await sb
      .from(table)
      .update({ is_default: true })
      .eq("id", input.id)
      .eq("scope", "personal")
      .eq("owner_user_id", caller.userId) // the privacy boundary, in the WHERE
      .select("id")
    if (error) return fail(describeError(error))
    if (!data || data.length === 0) return fail("View not found, or not yours.")
  }

  // AUDIT — see the note on the system branch above.
  await recordAudit({
    action: "update",
    entity: spec.savedViewsTable,
    recordId: input.id ?? null,
    changes: {
      personal_default: { old: null, new: input.id ?? null },
      owner_user_id: caller.userId,
    },
    context: `/${spec.key} · setDefault(personal)`,
  })

  revalidatePath(`/${spec.key}`)
  return ok()
}

/** Delete a view. Same ownership predicate as update — see invariant 2. */
export async function deleteSavedView(
  spec: EntitySpec,
  input: { id: string },
): Promise<ActionResult> {
  const auth = await requireCaller()
  if (!auth.ok) return fail(auth.error)
  const { caller } = auth

  const blocked = refuseIfImpersonating(caller)
  if (blocked) return fail(blocked)
  if (!input.id) return fail("No view id.")

  const sb = getSupabaseServer()
  const { data: existing, error: readErr } = await sb
    .from(spec.savedViewsTable)
    // name/owner/config come along so the audit entry records WHAT was deleted.
    .select("scope, name, owner_user_id, is_default, config")
    .eq("id", input.id)
    .maybeSingle()
  if (readErr) return fail(describeError(readErr))
  if (!existing) return fail("View not found.")

  const scope = existing.scope as SavedViewScope
  if (scope === "system" && !caller.isSuperUser) {
    return fail("Only a super-user can delete a System view.")
  }

  let q = sb.from(spec.savedViewsTable).delete().eq("id", input.id)
  if (scope === "personal") {
    if (!caller.userId) return fail("Not authorised.")
    q = q.eq("owner_user_id", caller.userId)
  } else {
    q = q.is("owner_user_id", null)
  }

  const { data, error } = await q.select("id")
  if (error) return fail(describeError(error))
  if (!data || data.length === 0) return fail("View not found, or not yours to delete.")

  // AUDIT — see lib/audit.ts.
  await recordAudit({
    action: "delete",
    entity: spec.savedViewsTable,
    recordId: input.id,
    changes: snapshot(existing),
    context: `/${spec.key}`,
  })

  revalidatePath(`/${spec.key}`)
  return ok()
}
