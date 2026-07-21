import { NextResponse } from "next/server"
import { requireSuperUser } from "@/lib/api-auth"
import { loadFeedbackOutstandingRows, loadFeedbackPipelineRows } from "@/app/feedback/load"
import { buildFeedbackEmailHtml } from "@/app/feedback/feedback-email-html"

/**
 * Preview-only endpoint for the Outstanding Feedback digest.
 *
 * A signed-in **super_user** can GET this to see the exact HTML the send route
 * would email (pipeline sections + outstanding list), rendered in the browser,
 * WITHOUT sending anything. Read-only: it loads the same live views and calls
 * the same builder as the test send, then returns the fragment as text/html.
 * Separate from the send route so that route's reserved GET (the future cron
 * path) is left untouched.
 */

export const dynamic = "force-dynamic"

const TIME_ZONE = "America/New_York"

function todayLabel(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date())
}

export async function GET() {
  const auth = await requireSuperUser()
  if (!auth.ok) return auth.response

  const { rows, error } = await loadFeedbackOutstandingRows()
  if (error) {
    return NextResponse.json({ error: `Could not load v_feedback_outstanding: ${error}` }, { status: 500 })
  }

  const { rows: pipelineRows, error: pipelineError } = await loadFeedbackPipelineRows()
  if (pipelineError) {
    return NextResponse.json({ error: `Could not load v_feedback_pipeline: ${pipelineError}` }, { status: 500 })
  }

  const html = buildFeedbackEmailHtml(rows, pipelineRows, todayLabel())
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
