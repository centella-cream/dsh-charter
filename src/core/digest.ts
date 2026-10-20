import { createHash } from 'node:crypto'

export type Sha256Digest = `sha256:${string}`

export function sha256Text(value: string): Sha256Digest {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`
}

export function sha256Json(value: unknown): Sha256Digest {
  return sha256Text(JSON.stringify(value))
}
