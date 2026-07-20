/**
 * sendMail — send a single HTML email via Microsoft Graph (app-only).
 *
 * Wraps `POST /users/{sender}/sendMail`. Runs AS the shared dashboards@ mailbox
 * — the ONLY mailbox the Graph app's Application Access Policy permits Mail.Send
 * for, so the sender is fixed here (not a caller-supplied argument) and sending
 * as anyone else would 403.
 *
 * SINGLE SEND by contract: one call sends ONE message to every recipient in a
 * single `toRecipients` array. It never loops and never sends per-recipient —
 * pass all recipients at once and Graph delivers one email.
 *
 * Graph returns `202 Accepted` with an EMPTY body on success (graphFetch already
 * tolerates empty bodies and returns null). Failures surface as a GraphError
 * carrying Graph's own status + error body; a 403 almost always means the
 * Application Access Policy rejected the sender mailbox (or the Mail.Send
 * application permission isn't admin-consented).
 *
 * Requires the `Mail.Send` application permission (admin-consented), scoped by
 * an Application Access Policy to the dashboards@ mailbox.
 */

import { graphFetch } from "./request"

/**
 * The shared service mailbox all dashboard email is sent AS. Fixed by the Graph
 * app's Application Access Policy: Mail.Send is scoped to ONLY this mailbox, so
 * sending as any other address returns 403.
 */
export const MAIL_SENDER = "dashboards@roseandco.com"

export type SendMailOptions = {
  /** One or more recipient addresses. All are delivered in a single message. */
  recipients: string[]
  /** Email subject line. */
  subject: string
  /** Full HTML body (sent with contentType "HTML"). */
  html: string
}

/**
 * Send exactly one HTML email as `MAIL_SENDER` to all `recipients` in a single
 * Graph call. Resolves on success (Graph 202); throws GraphError on failure.
 */
export async function sendMail(opts: SendMailOptions): Promise<void> {
  const { recipients, subject, html } = opts

  if (recipients.length === 0) {
    throw new Error("sendMail: `recipients` is empty — pass at least one address.")
  }

  const path = `/users/${encodeURIComponent(MAIL_SENDER)}/sendMail`

  // ONE message, ONE call: every recipient goes in a single toRecipients array.
  // Do not loop / do not send per-recipient — that would deliver N emails.
  await graphFetch<null>(path, {
    method: "POST",
    body: {
      message: {
        subject,
        body: { contentType: "HTML", content: html },
        toRecipients: recipients.map((address) => ({
          emailAddress: { address },
        })),
      },
      // Keep a copy in dashboards@'s Sent Items for auditability.
      saveToSentItems: true,
    },
  })
}
