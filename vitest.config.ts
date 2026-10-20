import { defineConfig } from 'vitest/config'

export default defineConfig({
  oxc: {
    // DSH Remote uses standard decorators. Lower them for the Node test
    // runtime instead of leaving decorator syntax in the Vite output.
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
  },
})
