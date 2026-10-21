import { charterError } from './errors.js'
import {
  charterEditRequestSchema,
  type CharterEditRequest,
  type CharterOp,
  type NewItemInput,
} from './schemas.js'

const UNSAFE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true
      index += 1
      continue
    }
    if (code >= 0xDC00 && code <= 0xDFFF) return true
  }
  return false
}

export function normalizeUserText(input: string, field: string): string {
  const value = input.replace(/\r\n?/gu, '\n').normalize('NFC').trim()
  if (value.length === 0) {
    throw charterError('INVALID_ARGUMENT', `${field} must not be empty`)
  }
  if (UNSAFE_CONTROL.test(value)) {
    throw charterError('INVALID_ARGUMENT', `${field} contains unsupported control characters`)
  }
  if (hasUnpairedSurrogate(value)) {
    throw charterError('INVALID_ARGUMENT', `${field} contains invalid Unicode`)
  }
  return value
}

function normalizeNewItem(input: NewItemInput): NewItemInput {
  return input.kind === 'invariant'
    ? {
        clientRef: input.clientRef,
        kind: 'invariant',
        text: normalizeUserText(input.text, `item ${input.clientRef}`),
        order: input.order,
      }
    : {
        clientRef: input.clientRef,
        kind: 'deliverable',
        text: normalizeUserText(input.text, `item ${input.clientRef}`),
        order: input.order,
        progress: input.progress,
      }
}

function normalizeOp(op: CharterOp): CharterOp {
  switch (op.type) {
    case 'objective.initialize':
      return { type: op.type, text: normalizeUserText(op.text, 'objective') }
    case 'objective.redirect':
      return {
        type: op.type,
        text: normalizeUserText(op.text, 'objective'),
        reason: normalizeUserText(op.reason, 'redirect reason'),
      }
    case 'item.add':
    case 'item.propose':
      return { type: op.type, item: normalizeNewItem(op.item) }
    case 'item.edit': {
      if (op.text === undefined && op.order === undefined) {
        throw charterError('INVALID_ARGUMENT', `item.edit for ${op.itemId} has no changes`)
      }
      return {
        type: op.type,
        itemId: op.itemId,
        ...(op.text === undefined ? {} : { text: normalizeUserText(op.text, `item ${op.itemId}`) }),
        ...(op.order === undefined ? {} : { order: op.order }),
      }
    }
    case 'item.supersede':
      return {
        type: op.type,
        itemId: op.itemId,
        replacement: normalizeNewItem(op.replacement),
      }
    case 'item.accept':
    case 'item.reject':
    case 'item.archive':
    case 'item.restore':
    case 'item.purge':
    case 'deliverable.progress':
    case 'item.verification.set':
      return op
  }
}

export function normalizeEditRequest(input: unknown): CharterEditRequest {
  const parsed = charterEditRequestSchema.safeParse(input)
  if (!parsed.success) {
    throw charterError('INVALID_ARGUMENT', `invalid charter edit request: ${parsed.error.message}`)
  }
  return {
    sessionId: parsed.data.sessionId,
    mutationId: parsed.data.mutationId,
    baseRevision: parsed.data.baseRevision,
    ops: parsed.data.ops.map(normalizeOp),
  }
}

export function clientRefsOf(ops: readonly CharterOp[]): readonly string[] {
  const refs: string[] = []
  for (const op of ops) {
    if (op.type === 'item.add') refs.push(op.item.clientRef)
    // A history-import overflow candidate keeps its own clientRef: the Host
    // must mint an id for it exactly like for an active item, otherwise the
    // atomic batch fails with INVALID_REFERENCE.
    if (op.type === 'item.propose') refs.push(op.item.clientRef)
    if (op.type === 'item.supersede') refs.push(op.replacement.clientRef)
  }
  const unique = new Set(refs)
  if (unique.size !== refs.length) {
    throw charterError('INVALID_ARGUMENT', 'clientRef values must be unique within one edit')
  }
  return refs
}
