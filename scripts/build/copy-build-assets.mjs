import { cp, mkdir } from 'node:fs/promises'

await mkdir('.build-ts/client', { recursive: true })
await cp('src/client/charter.css', '.build-ts/client/charter.css')
