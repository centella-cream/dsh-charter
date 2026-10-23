export interface PackArtifactInfo {
  readonly filename: string
  readonly name?: string
  readonly version?: string
  readonly [key: string]: unknown
}

export function parsePackOutput(packOutput: string): PackArtifactInfo

export function parseSumsDigest(sums: string, filename: string): string

export function verifyArtifactDigest(
  artifact: string,
  sumsFile: string,
): { readonly actual: string; readonly expected: string }

export function parseArgs(argv: readonly string[]): {
  readonly artifact: string | undefined
  readonly sha256: string | undefined
}
