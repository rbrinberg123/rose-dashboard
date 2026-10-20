/**
 * listInboxMessages — read a shared mailbox's Inbox via Microsoft Graph
 * (app-only).
 *
 * Wraps `GET /users/{mailbox}/mailFolders/Inbox/messages`, filtered to
 * `receivedDateTime ge {since}` and ordered OLDEST FIRST so a caller can
 * advance a watermark as it goes. Follows `@odata.nextLink` up to `maxPages`.
 *
 * Requires the `Mail.Read` application permission (admin-consented) AND the
 * mailbox to be inside the Graph app's Exchange Application Access Policy
 * scope. Outside it Graph returns 403 "Blocked by tenant configured AppOnly
 * AccessPolicy settings" — see content/docs/05-sync-and-integrations.md.
 *
 * Only metadata + the plain-text preview are selected; the full body is never
 * fetched.
 */

import { graphFetch } from "./request"

/** One Inbox message, as selected below. */
export type InboxMessage = {
  /** Graph id — changes if the message is moved to another folder. */
  id: string
  /** RFC 822 Message-ID — stable across moves; the dedup key. */
  internetMessageId: string | null
  conversationId: string | null
  subject: string | null
  from: { emailAddress?: { name?: string; address?: string } } | null
  receivedDateTime: string
  /** Opens the message in Outlook on the web (needs access to the mailbox). */
  webLink: string | null
  bodyPreview: string | null
  hasAttachments: boolean | null
}

const SELECT = [
  "id",
  "internetMessageId",
  "conversationId",
  "subject",
  "from",
  "receivedDateTime",
  "webLink",
  "bodyPreview",
  "hasAttachments",
].join(",")

const PAGE_SIZE = 50

/**
 * Every Inbox message received at or after `sinceIso`, oldest first. Stops after
 * `maxPages` pages (PAGE_SIZE each) — the remainder is picked up by the next
 * call once the caller's watermark has advanced.
 */
export async function listInboxMessages(
  mailbox: string,
  sinceIso: string,
  { maxPages = 10 }: { maxPages?: number } = {},
): Promise<{ messages: InboxMessage[]; truncated: boolean }> {
  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${sinceIso}`,
    $orderby: "receivedDateTime asc",
    $select: SELECT,
    $top: String(PAGE_SIZE),
  })
  let next: string | undefined =
    `/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages?${params.toString()}`

  const messages: InboxMessage[] = []
  for (let page = 0; next && page < maxPages; page++) {
    const res: { value: InboxMessage[]; "@odata.nextLink"?: string } = await graphFetch(next)
    messages.push(...(res.value ?? []))
    next = res["@odata.nextLink"]
  }
  return { messages, truncated: !!next }
}

/** Cap on the body text kept for matching — long quoted chains add noise, not signal. */
const BODY_TEXT_MAX = 20_000

/**
 * One message's body as PLAIN TEXT (Graph converts HTML when asked via the
 * Prefer header), capped at BODY_TEXT_MAX characters. Used for client matching
 * only; never stored.
 */
export async function getMessageBodyText(mailbox: string, messageId: string): Promise<string> {
  const res = await graphFetch<{ body?: { content?: string } }>(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}?$select=body`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } },
  )
  return (res?.body?.content ?? "").slice(0, BODY_TEXT_MAX)
}

/**
 * The FILE NAMES of a message's attachments — names only: `$select=name`
 * keeps Graph from returning contentBytes. Inline attachments (signature
 * logos, pasted images) are left out.
 */
export async function listAttachmentNames(mailbox: string, messageId: string): Promise<string[]> {
  const res = await graphFetch<{ value?: { name?: string | null; isInline?: boolean | null }[] }>(
    `/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments?$select=name,isInline`,
  )
  return (res?.value ?? [])
    .filter((a) => !a.isInline && a.name)
    .map((a) => a.name as string)
}
