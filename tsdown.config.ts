import { defineConfig, type UserConfig } from 'tsdown'

const shared: UserConfig = {
  outDir: 'lib',
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  dts: false,
  clean: false,
  deps: {
    neverBundle: [/^@deepseek-ai\//, /^react(?:\/.*)?$/, /^node:/],
  },
}

/**
 * The Host entries may share chunks: Node resolves them from `lib/`.
 *
 * The browser entry must be one self-contained file. DSH serves a client
 * bundle as `${package}/client.js` and does not expose sibling chunk files, so
 * a shared/hashed chunk or a separate `import './client.css'` would 404 in the
 * browser. Build it in its own pass and inline the stylesheet afterwards.
 */
export default defineConfig([
  {
    ...shared,
    entry: {
      index: './.build-ts/index.js',
      remote: './.build-ts/remote.js',
      core: './.build-ts/core.js',
    },
    clean: true,
  },
  {
    ...shared,
    entry: {
      client: './.build-ts/client.js',
    },
    format: 'cjs',
    platform: 'browser',
    outExtensions: () => ({ js: '.js' }),
    banner: `window.__ModuleLoader__.load({
  id: 'dsh-charter',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
`,
    footer: `    return module.exports;
  }
});
`,
    css: {
      inject: true,
      splitting: false,
      fileName: 'client.css',
    },
    deps: {
      ...shared.deps,
      // The browser has no bare "zod" resolution; the client entry must carry
      // the wire schemas' validator with it.
      alwaysBundle: [/^zod$/],
      onlyBundle: false,
    },
  },
])
