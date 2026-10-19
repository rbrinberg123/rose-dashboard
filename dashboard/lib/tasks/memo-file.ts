/**
 * PURE rules for the Marketing Memo DOCUMENT upload (task drawer → SharePoint).
 * No I/O — shared by the drawer control (task-record-pane.tsx) and the server
 * action (app/tasks/memo-upload-actions.ts), which re-checks everything.
 *
 * See content/docs/14-tasks.md → "Marketing Memo document".
 */

/** The task sub-type that carries the upload. */
export const MEMO_SUBTYPE_LABEL = "Marketing Memo"

/** Word only. The uploaded file keeps ITS extension (a .doc renamed .docx won't open). */
export const MEMO_FILE_EXTENSIONS = [".doc", ".docx"] as const
export type MemoFileExtension = (typeof MEMO_FILE_EXTENSIONS)[number]

/** The file input's accept list. */
export const MEMO_FILE_ACCEPT =
  ".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/** 4 MB — under Vercel's ~4.5 MB request cap (next.config.ts allows the multipart overhead). */
export const MEMO_FILE_MAX_BYTES = 4 * 1024 * 1024

/** Content-Type sent to SharePoint per extension. */
export const MEMO_FILE_CONTENT_TYPE: Record<MemoFileExtension, string> = {
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

/** The extension of `name` if it is an accepted Word type, else null. */
export function memoFileExtension(name: string | null | undefined): MemoFileExtension | null {
  const m = /\.[^.]+$/.exec((name ?? "").trim().toLowerCase())
  const ext = m?.[0] as MemoFileExtension | undefined
  return ext && (MEMO_FILE_EXTENSIONS as readonly string[]).includes(ext) ? ext : null
}

/** null = acceptable; otherwise the reason to show. */
export function validateMemoFile(file: { name: string; size: number }): string | null {
  if (!memoFileExtension(file.name)) return "Upload a Word document (.doc or .docx)."
  if (!(file.size > 0)) return "That file is empty."
  if (file.size > MEMO_FILE_MAX_BYTES) return "That file is over 4 MB — the upload limit."
  return null
}

/** Longest file-name stem kept (SharePoint allows 400 for the whole path). */
const MAX_STEM = 200

/**
 * The SharePoint file name: the TASK NAME (subject), made legal, plus the
 * uploaded file's extension. Replaces SharePoint's illegal characters
 * " * : < > ? / \ | (and # %, control characters) with "-", collapses runs of
 * spaces and dashes, drops a leading "~$" and trailing dots / spaces.
 */
export function memoFileName(subject: string | null | undefined, ext: MemoFileExtension): string {
  let stem = (subject ?? "")
    .replace(/[\u0000-\u001f"*:<>?/\\|#%]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/-{2,}/g, "-")
    .replace(/^~\$/, "")
    .trim()
  if (stem.length > MAX_STEM) stem = stem.slice(0, MAX_STEM)
  stem = stem.replace(/[.\s]+$/, "").replace(/^[.\s]+/, "")
  return (stem || "Marketing Memo") + ext
}

/** May this viewer upload? Owner of the task, or a super user — never in View as. */
export function canUploadMemo(
  task: { subtypeLabel: string | null; ownerId: string | null },
  viewer: { myIds: ReadonlySet<string>; isAdmin: boolean; impersonated: boolean },
): string | null {
  if (task.subtypeLabel !== MEMO_SUBTYPE_LABEL) return "Only Marketing Memo tasks take a document."
  if (viewer.impersonated) return "Uploads are off while viewing as someone else."
  const isOwner = !!task.ownerId && viewer.myIds.has(task.ownerId)
  if (!isOwner && !viewer.isAdmin) return "Only the task's owner or a super user can upload the memo."
  return null
}

/**
 * The message for a failed SharePoint call, from its HTTP status (null = not a
 * Graph HTTP error). 401/403 almost always mean the site permission hasn't been
 * granted to the Graph app yet.
 */
export function memoUploadErrorMessage(status: number | null, detail: string): string {
  if (status === 401 || status === 403) {
    return "SharePoint upload isn't enabled yet: the dashboard's Graph app needs write access to the CRMDocuments site (Sites.Selected). Ask an admin to grant it."
  }
  if (status === 404) return "The CRMDocuments SharePoint site or its Documents library wasn't found."
  if (status === 409 || status === 423) return "The existing document is locked or checked out in SharePoint — close it there and try again."
  if (status === 413) return "That file is too large for SharePoint's simple upload."
  if (status != null && status >= 500) return "SharePoint is unavailable right now — try again in a minute."
  return `The upload failed: ${detail}`
}
