import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { CharterRemoteService } from '../../lib/remote.js'

const ctx = new Context()
const service = new CharterRemoteService(ctx)
const markers = remoteMethods(service)
if (markers.map(marker => marker.method).join(',') !== 'watch,bootstrap,edit') {
  throw new Error(`unexpected Remote methods: ${markers.map(marker => marker.method).join(',')}`)
}
if (markers[0]?.mode !== 'stream') {
  throw new Error('charter/watch is not registered as a stream')
}

// DSH 0.2.1+ carries per-resource access declarations. DSH 0.2.0 has no such
// field; the Host's live-Session and lifecycle checks remain, but Gateway
// resource authorization is unavailable on that generation.
const resourceAware = markers.some(marker => marker.resources !== undefined)
if (resourceAware) {
  for (const marker of markers) {
    if (marker.resources?.session === undefined) {
      throw new Error(`charter/${marker.method} is missing the Session resource reader`)
    }
  }
} else {
  console.warn(
    'remote-smoke: this DSH generation has no @Remote resources; '
    + 'per-Peer Session authorization is unavailable (expected on 0.1.7/0.2.0).',
  )
}
await ctx.fiber.dispose()
