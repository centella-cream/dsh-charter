import { readFile, rm, writeFile } from 'node:fs/promises'

/**
 * DSH serves a browser plugin as one `${package}/client.js` artifact. A
 * separate CSS import or a shared chunk would not be reachable from that URL,
 * and the factory-form bundle is a classic script, so a bare ESM CSS import
 * would fail outright.
 *
 * Remove that import and inject the stylesheet from inside the module factory.
 * The tagged <style> element is inserted once at materialization, so repeated
 * loads (including HMR) do not duplicate it.
 */
const jsPath = 'lib/client.js'
const cssPath = 'lib/client.css'
const plugin = 'dsh-charter'
const styleId = `${plugin}/charter.css`
const factoryMarker = '    var exports = module.exports;'

const [js, css] = await Promise.all([
  readFile(jsPath, 'utf8'),
  readFile(cssPath, 'utf8'),
])
const importPattern = /^import ['"]\.\/client\.css['"];?[ \t]*\r?\n?/mu
if (!importPattern.test(js)) {
  throw new Error(`${jsPath} does not import ./client.css; the client CSS layout changed`)
}
if (!js.includes(factoryMarker)) {
  throw new Error(`${jsPath} is missing the module factory; the client banner changed`)
}

const injection = `${factoryMarker}
    const __charterCss = ${JSON.stringify(css)};
    const __charterStyleSelector = 'style[data-plugin-css=${JSON.stringify(styleId)}]';
    if (typeof document !== 'undefined' && document.querySelector(__charterStyleSelector) === null) {
      const style = document.createElement('style');
      style.dataset.plugin = ${JSON.stringify(plugin)};
      style.dataset.pluginCss = ${JSON.stringify(styleId)};
      style.textContent = __charterCss;
      document.head.appendChild(style);
    }`

const withoutImport = js.replace(importPattern, '')
const next = withoutImport.replace(factoryMarker, injection)
if (next.includes('./client.css')) {
  throw new Error(`${jsPath} still references ./client.css after inlining`)
}
await writeFile(jsPath, next)
await rm(cssPath, { force: true })
