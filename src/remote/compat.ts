import { Remote } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Compatibility wrapper for the DSH `@Remote` decorator.
 *
 * DSH 0.2.1 added per-resource access declarations (`resources`). DSH 0.1.7
 * and 0.2.0 reject any decorator options other than `{ mode: "stream" }`, so
 * a plugin built with the newer options would fail to load at
 * class-definition time. Try the modern form first and fall back to the legacy
 * form when the runtime refuses the newer option set.
 *
 * On 0.1.7/0.2.0 the Gateway has no resource-scoped authorization. The Host
 * still verifies that the target Session is live and that the record belongs to
 * that Session lifecycle, but per-Peer resource authorization is only available
 * on 0.2.1 and later. See docs/design/compatibility.zh.md.
 */
export type CompatResourceReader = (...args: never[]) => string | readonly string[] | undefined

export interface CompatRemoteOptions {
  readonly mode?: 'stream'
  readonly resources?: Readonly<Record<string, CompatResourceReader>>
}

export type CompatMethodDecorator = <
  This extends object,
  Args extends unknown[],
  Result,
>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void

type ModernRemoteFactory = (options: CompatRemoteOptions) => CompatMethodDecorator
type LegacyStreamFactory = (options: { readonly mode: 'stream' }) => CompatMethodDecorator

/**
 * Build the decorator factory around any `Remote` implementation.
 *
 * Exported for tests: a fake implementation can stand in for either DSH API
 * generation without installing that DSH version.
 */
export function createRemoteMethodFactory(
  remote: unknown,
): (options: CompatRemoteOptions) => CompatMethodDecorator {
  const modern = remote as ModernRemoteFactory
  const legacyStream = remote as LegacyStreamFactory
  const legacyDirect = remote as unknown as CompatMethodDecorator

  return options => {
    if (options.mode !== undefined || options.resources !== undefined) {
      try {
        return modern(options)
      } catch {
        // DSH 0.1.7/0.2.0 reject unknown decorator options. Fall through.
      }
    }
    if (options.mode === 'stream') return legacyStream({ mode: 'stream' })
    return legacyDirect
  }
}

export const remoteMethod = createRemoteMethodFactory(Remote as unknown)
