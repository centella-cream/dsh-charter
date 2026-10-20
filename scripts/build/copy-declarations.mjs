import { cp, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const source = '.build-ts'
const target = 'lib'

async function copyDeclarations(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const sourcePath = join(directory, entry.name)
    if (entry.isDirectory()) {
      await copyDeclarations(sourcePath)
      continue
    }
    if (!entry.name.endsWith('.d.ts') && !entry.name.endsWith('.d.ts.map')) continue
    const destination = join(target, sourcePath.slice(source.length + 1))
    await mkdir(dirname(destination), { recursive: true })
    await cp(sourcePath, destination)
  }
}

await mkdir(target, { recursive: true })
await copyDeclarations(source)
