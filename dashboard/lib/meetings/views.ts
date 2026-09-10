/**
 * Meetings' view layer — a BINDING over lib/table-views/, not an implementation.
 *
 * Everything real (config validation, default resolution, the URL round-trip)
 * lives in the shared modules; this file pins the Meetings spec to them so the
 * page's call sites stay short and entity-free. Events has the same shape in
 * lib/events/. If you are changing HOW a config is validated, change
 * lib/table-views/config.ts — not this file.
 */

import {
  builtinSavedViews as sharedBuiltinSavedViews,
  configsDiffer,
  decodeConfig as sharedDecodeConfig,
  encodeConfig,
  isBuiltinId,
  parseConfig as sharedParseConfig,
  resolveActiveView as sharedResolveActiveView,
} from "@/lib/table-views/config"
import {
  opsForField as sharedOpsForField,
  type SavedView,
  type ViewConfig,
} from "@/lib/table-views/types"
import { MEETINGS_SPEC } from "./spec"

export {
  BUILTIN_PREFIX,
  OP_LABELS,
  OPS_FOR_TYPE,
  TODAY_TOKEN,
  TOMORROW_TOKEN,
  VALUELESS_OPS,
  type BuiltinView,
  type FilterCondition,
  type FilterOp,
  type SavedView,
  type SavedViewScope,
  type SortDir,
  type ViewConfig,
  type ViewSort,
} from "@/lib/table-views/types"

export { configsDiffer, encodeConfig, isBuiltinId }
export { BUILTIN_VIEWS, DEFAULT_SORT, MEETINGS_SPEC } from "./spec"

export function parseConfig(input: unknown) {
  return sharedParseConfig(MEETINGS_SPEC, input)
}

export function decodeConfig(raw: string | null | undefined): ViewConfig | null {
  return sharedDecodeConfig(MEETINGS_SPEC, raw)
}

export function resolveActiveView(views: SavedView[], requestedId?: string | null): SavedView {
  return sharedResolveActiveView(MEETINGS_SPEC, views, requestedId)
}

export function builtinSavedViews(): SavedView[] {
  return sharedBuiltinSavedViews(MEETINGS_SPEC)
}

export function opsForField(field: string) {
  return sharedOpsForField(MEETINGS_SPEC, field)
}

/** Catalog order, used to keep a view's columns rendering in a stable order. */
export function orderedColumns(config: ViewConfig): string[] {
  return config.columns.filter((k) => MEETINGS_SPEC.getColumn(k) !== undefined)
}

/** Every column the catalog knows, for the picker's "available" list. */
export function allColumnKeys(): string[] {
  return MEETINGS_SPEC.catalog.map((c) => c.key)
}

/** The fallback view — what opens when nothing is defaulted. */
export const FALLBACK_VIEW =
  MEETINGS_SPEC.builtins.find((v) => v.isFallbackDefault) ?? MEETINGS_SPEC.builtins[0]
