import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { sha256Json } from '../core/digest.js'
import type { CharterValidity, CharterEvidence } from '../core/schemas.js'

export type ValidatorKind = 'workspace.path-exists' | 'workspace.file-digest' | 'workspace.file-contains'

export interface ValidatorSpec {
  readonly kind: ValidatorKind
  readonly path: string
  readonly expectedDigest?: string
  readonly contains?: string
}

export interface ValidatorRequest {
  readonly itemId: string
  readonly validator: ValidatorSpec
}

export interface ValidatorEvaluation {
  readonly itemId: string
  readonly validity: CharterValidity
  readonly evidence?: CharterEvidence
}

const TIMEOUT_MS = 2_000
const MAX_FILE_BYTES = 1_024 * 1_024
const MAX_TOTAL_BYTES = 8 * 1_024 * 1_024
const MAX_TOTAL_MS = 10_000
const VALIDATOR_ID = {
  'workspace.path-exists': 'workspace.path-exists',
  'workspace.file-digest': 'workspace.file-digest',
  'workspace.file-contains': 'workspace.file-contains',
} as const

function digestBytes(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function failure(
  itemId: string,
  validator: string,
  state: 'invalid' | 'unknown',
  inputDigest: `sha256:${string}`,
  nextRevision: number,
  reason: string,
  path: string,
): ValidatorEvaluation {
  return {
    itemId,
    validity: {
      state,
      validator,
      inputDigest,
      checkedAtRevision: nextRevision,
      reason,
    },
    evidence: {
      kind: 'workspace-file',
      path,
      projectionVersion: 1,
      digest: inputDigest,
      excerpt: reason,
    },
  }
}

async function resolveWorkspaceTarget(root: string, relativePath: string): Promise<string> {
  if (relativePath.length === 0 || relativePath.length > 1_024 || relativePath.includes('\0')) {
    throw new Error('EMPTY_PATH')
  }
  if (isAbsolute(relativePath)) throw new Error('ABSOLUTE_PATH')
  const lexical = resolve(root, relativePath)
  if (!isInside(root, lexical)) throw new Error('OUTSIDE_WORKSPACE')
  let realRoot: string
  try {
    realRoot = await fs.realpath(root)
  } catch {
    throw new Error('WORKSPACE_UNREADABLE')
  }
  let realTarget: string
  try {
    realTarget = await fs.realpath(lexical)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return lexical
    throw error
  }
  if (!isInside(realRoot, realTarget)) throw new Error('OUTSIDE_WORKSPACE')
  return realTarget
}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), TIMEOUT_MS)
  timer.unref?.()
  return work(controller.signal).finally(() => clearTimeout(timer))
}

async function readBounded(target: string, signal: AbortSignal): Promise<Buffer> {
  const stat = await fs.stat(target)
  if (stat.size > MAX_FILE_BYTES) throw new Error('file exceeds validator size limit')
  if (signal.aborted) throw new Error('TIMEOUT')
  const stream = createReadStream(target, { start: 0, end: Math.max(0, stat.size - 1) })
  const abort = (): void => { stream.destroy(new Error('TIMEOUT')) }
  signal.addEventListener('abort', abort, { once: true })
  const chunks: Buffer[] = []
  let total = 0
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buffer.length
      if (total > MAX_FILE_BYTES) throw new Error('file exceeds validator size limit')
      chunks.push(buffer)
      if (signal.aborted) throw new Error('TIMEOUT')
    }
  } finally {
    signal.removeEventListener('abort', abort)
  }
  return Buffer.concat(chunks)
}

export async function evaluateValidators(input: {
  readonly root: string | undefined
  readonly revision: number
  readonly requests: readonly ValidatorRequest[]
  readonly itemText: (itemId: string) => string | undefined
}): Promise<readonly ValidatorEvaluation[]> {
  const nextRevision = input.revision + 1
  const out: ValidatorEvaluation[] = []
  let totalBytes = 0
  const deadline = Date.now() + MAX_TOTAL_MS
  for (const request of input.requests) {
    const text = input.itemText(request.itemId)
    if (text === undefined) throw new Error(`item ${request.itemId} does not exist`)
    const inputDigest = sha256Json({
      version: 1,
      itemId: request.itemId,
      text,
      validator: request.validator,
    })
    const validator = VALIDATOR_ID[request.validator.kind]
    if (validator === undefined) throw new Error('UNKNOWN_VALIDATOR')
    if (Date.now() > deadline) {
      out.push(failure(
        request.itemId,
        validator,
        'unknown',
        inputDigest,
        nextRevision,
        'validator deadline exceeded',
        request.validator.path,
      ))
      continue
    }
    if (input.root === undefined) {
      out.push({
        itemId: request.itemId,
        validity: {
          state: 'unknown',
          validator,
          inputDigest,
          checkedAtRevision: nextRevision,
          reason: 'workspace root is unavailable',
        },
      })
      continue
    }
    let target: string
    try {
      target = await withTimeout(async () => resolveWorkspaceTarget(input.root!, request.validator.path))
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'workspace path is unreadable'
      out.push(failure(request.itemId, validator, 'unknown', inputDigest, nextRevision, reason, request.validator.path))
      continue
    }
    const evidencePath = target.startsWith(input.root)
      ? relative(input.root, target) || '.'
      : request.validator.path
    try {
      if (request.validator.kind === 'workspace.path-exists') {
        const stat = await withTimeout(async () => fs.stat(target))
        out.push({
          itemId: request.itemId,
          validity: {
            state: stat.isFile() || stat.isDirectory() ? 'valid' : 'invalid',
            validator,
            inputDigest,
            checkedAtRevision: nextRevision,
            resultDigest: sha256Json({ version: 1, exists: true, path: evidencePath }),
          },
          evidence: {
            kind: 'workspace-file',
            path: evidencePath,
            projectionVersion: 1,
            digest: sha256Json({ version: 1, exists: true, path: evidencePath }),
          },
        })
        continue
      }
      const bytes = await withTimeout(signal => readBounded(target, signal))
      totalBytes += bytes.length
      if (totalBytes > MAX_TOTAL_BYTES) {
        out.push(failure(
          request.itemId,
          validator,
          'unknown',
          inputDigest,
          nextRevision,
          'validator byte budget exceeded',
          evidencePath,
        ))
        continue
      }
      const actualDigest = digestBytes(bytes)
      if (request.validator.kind === 'workspace.file-digest') {
        const valid = request.validator.expectedDigest === actualDigest
        out.push({
          itemId: request.itemId,
          validity: {
            state: valid ? 'valid' : 'invalid',
            validator,
            inputDigest,
            checkedAtRevision: nextRevision,
            resultDigest: actualDigest,
            ...(valid ? {} : { reason: 'digest differs' }),
          },
          evidence: {
            kind: 'workspace-file',
            path: evidencePath,
            projectionVersion: 1,
            digest: actualDigest,
          },
        })
        continue
      }
      const expected = request.validator.contains ?? ''
      const textContent = bytes.toString('utf8')
      const valid = expected.length > 0 && textContent.includes(expected)
      out.push({
        itemId: request.itemId,
        validity: {
          state: valid ? 'valid' : 'invalid',
          validator,
          inputDigest,
          checkedAtRevision: nextRevision,
          resultDigest: actualDigest,
          ...(valid ? {} : { reason: 'expected text not found' }),
        },
        evidence: {
          kind: 'workspace-file',
          path: evidencePath,
          projectionVersion: 1,
          digest: actualDigest,
        },
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const reason = code === 'ENOENT'
        ? 'file is missing'
        : error instanceof Error ? error.message : 'file is unreadable'
      out.push(failure(
        request.itemId,
        validator,
        code === 'ENOENT' ? 'invalid' : 'unknown',
        inputDigest,
        nextRevision,
        reason,
        evidencePath,
      ))
    }
  }
  return out
}

export type EvidenceIntegrity = 'intact' | 'changed' | 'unavailable' | 'not-applicable'

/** Derive the read-time integrity of one persisted evidence binding. */
export async function evaluateEvidenceIntegrity(input: {
  readonly root: string | undefined
  readonly evidence: import('../core/schemas.js').CharterEvidence
}): Promise<EvidenceIntegrity> {
  if (input.evidence.kind !== 'workspace-file') return 'unavailable'
  if (input.root === undefined || input.evidence.path === undefined) return 'unavailable'
  try {
    const target = await withTimeout(async () => resolveWorkspaceTarget(input.root!, input.evidence.path!))
    const existsDigest = sha256Json({ version: 1, exists: true, path: input.evidence.path })
    if (input.evidence.digest === existsDigest) {
      await withTimeout(async () => fs.stat(target))
      return 'intact'
    }
    const bytes = await withTimeout(signal => readBounded(target, signal))
    return digestBytes(bytes) === input.evidence.digest ? 'intact' : 'changed'
  } catch {
    return 'unavailable'
  }
}
