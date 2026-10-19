/**
 * SharePoint file upload via Microsoft Graph (app-only) — the CRMDocuments site.
 *
 * Same app registration, token and HTTP core as calendar and mail (./token.ts,
 * ./request.ts); no new auth path. Used by the Marketing Memo document upload
 * (app/tasks/memo-upload-actions.ts).
 *
 * PERMISSION: the Graph app needs WRITE on the CRMDocuments site. Recommended
 * grant: the `Sites.Selected` application permission (admin-consented) plus a
 * site-level write grant for this app on
 * https://rosecoglobal.sharepoint.com/sites/CRMDocuments (POST
 * /sites/{siteId}/permissions, or PnP Grant-PnPAzureADAppSitePermission). The
 * broader alternative is `Sites.ReadWrite.All` (every site in the tenant).
 * Without it every call here returns 403 — callers map that to a clear message.
 *
 * Uploads use the simple PUT …/content call, which is fine for the ≤ 4 MB files
 * the app accepts (Vercel caps a request body at ~4.5 MB anyway). Larger files
 * would need an upload session (createUploadSession) — not built.
 *
 * The file shows in SharePoint as modified by the app, not by the person; who
 * uploaded is recorded on the task instead.
 */

import { graphFetch, GraphError } from "./request"

/** The target site — https://rosecoglobal.sharepoint.com/sites/CRMDocuments. */
export const CRM_DOCUMENTS_SITE = {
  hostname: "rosecoglobal.sharepoint.com",
  path: "/sites/CRMDocuments",
} as const

/**
 * Folder inside the site's default Documents library ("" = the library root).
 * One place to change if memos should go into a subfolder later.
 */
export const CRM_DOCUMENTS_FOLDER = ""

/** The fields of a Graph driveItem we keep. */
export type UploadedDriveItem = { id: string; name: string; webUrl: string }

type DriveCache = { driveId: string }
let driveCache: DriveCache | null = null

/** Resolve the site's default document library (drive) id once per warm instance. */
async function crmDocumentsDriveId(): Promise<string> {
  if (driveCache) return driveCache.driveId
  const site = await graphFetch<{ id: string }>(
    `/sites/${CRM_DOCUMENTS_SITE.hostname}:${CRM_DOCUMENTS_SITE.path}?$select=id`,
  )
  const drive = await graphFetch<{ id: string }>(`/sites/${site.id}/drive?$select=id`)
  driveCache = { driveId: drive.id }
  return drive.id
}

const pick = (i: UploadedDriveItem): UploadedDriveItem => ({ id: i.id, name: i.name, webUrl: i.webUrl })

/**
 * Upload `bytes` to the CRMDocuments Documents library.
 *
 *   replaceItemId given  → new VERSION of that existing file (its name is kept).
 *                          If it was deleted in SharePoint (404), falls through
 *                          to a fresh upload by name.
 *   otherwise            → upload as `fileName`; if another file already has
 *                          that name, SharePoint keeps both and renames this one
 *                          ("name 1.docx") — never overwrites someone else's file.
 */
export async function uploadToCrmDocuments(input: {
  fileName: string
  bytes: ArrayBuffer
  contentType: string
  replaceItemId?: string | null
}): Promise<UploadedDriveItem> {
  const driveId = await crmDocumentsDriveId()
  const headers = { "Content-Type": input.contentType || "application/octet-stream" }

  if (input.replaceItemId) {
    try {
      const item = await graphFetch<UploadedDriveItem>(
        `/drives/${driveId}/items/${encodeURIComponent(input.replaceItemId)}/content`,
        { method: "PUT", rawBody: input.bytes, headers },
      )
      return pick(item)
    } catch (e) {
      if (!(e instanceof GraphError && e.status === 404)) throw e
    }
  }

  const path = [CRM_DOCUMENTS_FOLDER, input.fileName].filter(Boolean).map(encodeURIComponent).join("/")
  const item = await graphFetch<UploadedDriveItem>(
    `/drives/${driveId}/root:/${path}:/content?@microsoft.graph.conflictBehavior=rename`,
    { method: "PUT", rawBody: input.bytes, headers },
  )
  return pick(item)
}
