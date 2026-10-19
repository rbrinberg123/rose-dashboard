import { test } from "node:test"
import assert from "node:assert/strict"

import {
  MEMO_FILE_MAX_BYTES,
  canUploadMemo,
  memoFileExtension,
  memoFileName,
  memoUploadErrorMessage,
  validateMemoFile,
} from "./memo-file.ts"

test("only .doc / .docx are accepted, case-insensitive", () => {
  assert.equal(memoFileExtension("Memo.DOCX"), ".docx")
  assert.equal(memoFileExtension("memo.doc"), ".doc")
  assert.equal(memoFileExtension("memo.pdf"), null)
  assert.equal(memoFileExtension("memo"), null)
  assert.equal(memoFileExtension("memo.docx.exe"), null)
})

test("validateMemoFile: type, empty and the 4 MB cap", () => {
  assert.equal(validateMemoFile({ name: "a.docx", size: 1000 }), null)
  assert.match(validateMemoFile({ name: "a.pdf", size: 1000 }) ?? "", /Word/)
  assert.match(validateMemoFile({ name: "a.docx", size: 0 }) ?? "", /empty/)
  assert.equal(validateMemoFile({ name: "a.docx", size: MEMO_FILE_MAX_BYTES }), null)
  assert.match(validateMemoFile({ name: "a.docx", size: MEMO_FILE_MAX_BYTES + 1 }) ?? "", /4 MB/)
})

test("file name = the task name, sanitized, with the upload's own extension", () => {
  assert.equal(
    memoFileName("Marketing Memo – ZVZZT - Boston - 10/6, 10/7", ".docx"),
    "Marketing Memo – ZVZZT - Boston - 10-6, 10-7.docx",
  )
  assert.equal(memoFileName('a*b:c<d>e?f"g\\h|i', ".doc"), "a-b-c-d-e-f-g-h-i.doc")
  assert.equal(memoFileName("  spaced   out.  ", ".docx"), "spaced out.docx")
  assert.equal(memoFileName("~$lock", ".docx"), "lock.docx")
  assert.equal(memoFileName("100% #1", ".docx"), "100- -1.docx")
})

test("file name falls back when the subject is blank or all illegal", () => {
  assert.equal(memoFileName(null, ".docx"), "Marketing Memo.docx")
  assert.equal(memoFileName("...", ".docx"), "Marketing Memo.docx")
})

test("file name stem is capped", () => {
  const n = memoFileName("x".repeat(500), ".docx")
  assert.equal(n.length, 200 + ".docx".length)
})

test("canUploadMemo: owner or super user, Marketing Memo only, never in View as", () => {
  const memo = { subtypeLabel: "Marketing Memo", ownerId: "u1" }
  const owner = { myIds: new Set(["u1"]), isAdmin: false, impersonated: false }
  const other = { myIds: new Set(["u2"]), isAdmin: false, impersonated: false }
  const admin = { myIds: new Set(["u2"]), isAdmin: true, impersonated: false }
  assert.equal(canUploadMemo(memo, owner), null)
  assert.equal(canUploadMemo(memo, admin), null)
  assert.match(canUploadMemo(memo, other) ?? "", /owner/)
  assert.match(canUploadMemo({ ...memo, ownerId: null }, other) ?? "", /owner/)
  assert.match(canUploadMemo(memo, { ...admin, impersonated: true }) ?? "", /viewing as/)
  assert.match(canUploadMemo({ subtypeLabel: "Targeting", ownerId: "u1" }, owner) ?? "", /Marketing Memo/)
})

test("a 403 from Graph names the missing SharePoint grant", () => {
  assert.match(memoUploadErrorMessage(403, "Access denied"), /Sites\.Selected/)
  assert.match(memoUploadErrorMessage(401, ""), /isn't enabled yet/)
  assert.match(memoUploadErrorMessage(404, ""), /wasn't found/)
  assert.match(memoUploadErrorMessage(null, "boom"), /boom/)
})
