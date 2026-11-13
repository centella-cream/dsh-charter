#!/usr/bin/env node
/**
 * UI metrics for the 0.3.0 all-section GUI refactor.
 *
 * Baseline: 2026-11-12, `main` @ `433bdce` (client source `f9d93c0`).
 * Plan: docs/design/charter-gui-v1.zh.md §8.2; contract: DESIGN.md §5.
 *
 * Usage:
 *   node scripts/verify/ui-metrics.mjs                 # report only, exit 0
 *   node scripts/verify/ui-metrics.mjs --gate=css      # W1: CSS metrics
 *   node scripts/verify/ui-metrics.mjs --gate=ia       # W2: CSS + IA metrics
 *   node scripts/verify/ui-metrics.mjs --gate=final    # W4: all metrics
 *   node scripts/verify/ui-metrics.mjs --json          # machine-readable
 *
 * The metrics are source-tree checks, not rendered-UI evidence. Screenshot,
 * scroll-ownership, accessibility and theme evidence stay manual/local gates.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CSS_PATH = resolve(ROOT, 'src/client/charter.css')
const TSX_PATH = resolve(ROOT, 'src/client/CharterPane.tsx')
const PAGE_PATHS = [
  TSX_PATH,
  resolve(ROOT, 'src/client/WorkspacePage.tsx'),
  resolve(ROOT, 'src/client/ReviewCenterPage.tsx'),
  resolve(ROOT, 'src/client/DiagnosticsPage.tsx'),
]
const ROUTING_PATH = resolve(ROOT, 'src/client/section-routing.ts')

const PHASES = { css: 1, ia: 2, final: 3 }
const CONTROL_PHASES = new Set(['css', 'ia', 'final'])

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const gateArg = args.find(arg => arg.startsWith('--gate='))
const gate = gateArg === undefined ? null : gateArg.slice('--gate='.length)
if (gate !== null && !CONTROL_PHASES.has(gate)) {
  console.error(`ui-metrics: unknown --gate=${gate} (expected css | ia | final)`)
  process.exit(2)
}

const css = readFileSync(CSS_PATH, 'utf8')
const tsx = readFileSync(TSX_PATH, 'utf8')
const pages = PAGE_PATHS.map(path => readFileSync(path, 'utf8'))
const paneSources = pages.join('\n')
const routing = readFileSync(ROUTING_PATH, 'utf8')

function unique(values) {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function matches(text, pattern) {
  return [...text.matchAll(pattern)].map(match => match[1])
}

/**
 * Compatibility literals are allowed only inside an explicitly marked block:
 *   /* charter-token-compat:begin *\/ ... /* charter-token-compat:end *\/
 * They are counted separately from scattered color literals.
 */
const COMPAT_RE = /\/\*\s*charter-token-compat:begin[\s\S]*?charter-token-compat:end\s*\*\//g
const compatBlocks = [...css.matchAll(COMPAT_RE)].map(match => match[0])
let cssOutsideCompat = css
for (const block of compatBlocks) cssOutsideCompat = cssOutsideCompat.split(block).join('')
const cssNoComments = cssOutsideCompat.replace(/\/\*[\s\S]*?\*\//g, '')

function countColorLiterals(text) {
  const hex = (text.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length
  const rgb = (text.match(/\brgba?\([^)]*\)/g) ?? []).length
  return { hex, rgb, total: hex + rgb }
}

const outsideColors = countColorLiterals(cssNoComments)
const compatColors = compatBlocks.reduce((total, block) => {
  const count = countColorLiterals(block)
  return { hex: total.hex + count.hex, rgb: total.rgb + count.rgb, total: total.total + count.total }
}, { hex: 0, rgb: 0, total: 0 })

const fontSizes = unique(matches(cssNoComments, /font-size\s*:\s*([^;}]+)/g))
const dynamicFontSizes = fontSizes.filter(value => value.includes('--dsh-content-font-size') || value.includes('--dsw-font-markdown'))
const uiFontSizes = fontSizes.filter(value => !dynamicFontSizes.includes(value))
const fontWeights = unique(matches(cssNoComments, /font-weight\s*:\s*([^;}]+)/g))
const radii = unique(matches(cssNoComments, /border-radius\s*:\s*([^;}]+)/g))
const shadows = unique(matches(cssNoComments, /box-shadow\s*:\s*([^;}]+)/g))
const paddings = unique(matches(cssNoComments, /(?:^|[;{\s])padding(?:-(?:top|right|bottom|left|inline|block))?\s*:\s*([^;}]+)/gm))
const gaps = unique(matches(cssNoComments, /(?:^|[;{\s])(?:row-|column-)?gap\s*:\s*([^;}]+)/gm))
const important = (cssNoComments.match(/!important/g) ?? []).length
const hostVars = [...new Set([...cssNoComments.matchAll(/var\((--(?:dsw|ds|dsh)-[a-z0-9-]+)/g)].map(match => match[1]))].sort()

const radiusAllowedRe = /^(?:var\(--dsw-radius-(?:sm|md|lg|panel)\)|999px|50%|0|inherit)$/
const radiusDisallowed = radii.filter(value => !radiusAllowedRe.test(value))
const radiusNonPill = radii.filter(value => !['999px', '50%', '0', 'inherit'].includes(value))
const radiusNonPillExceptPanel = radiusNonPill.filter(value => !value.includes('--dsw-radius-panel'))
const shadowAllowedRe = /^(?:var\(--dsw-(?:elevation|shadow)-[a-z0-9-]+\)|none)$/
const shadowDisallowed = shadows.filter(value => !shadowAllowedRe.test(value))

const objectivePanelCount = (paneSources.match(/charter-card charter-objective/g) ?? []).length
const goSectionNavigates = tsx.includes('const goSection') && routing.includes('scrollIntoView') && routing.includes('SECTION_ANCHOR')
const legacyOverviewMarkup = (tsx.match(/charter-overview-grid|charter-statcard|charter-budgetcard/g) ?? []).length
const dirtyOnlyActionBar = tsx.includes('const showActionBar') && tsx.includes('{showActionBar && (')

function metric(id, label, value, target, phase, pass, detail = []) {
  return { id, label, value, target, phase, pass, detail }
}

const edgeHitPathRule = /\.charter-graph__edgehit-path\s*\{([^}]*)\}/u.exec(cssNoComments)?.[1] ?? ''
const edgeHitPathIsScaled = /vector-effect\s*:\s*non-scaling-stroke/u.test(edgeHitPathRule)
const edgeHitPathWidth = /stroke-width\s*:\s*44(?:px)?\b/u.test(edgeHitPathRule)

const metrics = [
  metric('graph-hit-path', 'graph edge hit path is 44 CSS px', edgeHitPathIsScaled && edgeHitPathWidth ? '44px' : 'scaled/missing', '44px + non-scaling-stroke', 'css', edgeHitPathIsScaled && edgeHitPathWidth, [edgeHitPathRule.trim()]),
  metric('ui-font-sizes', 'UI font-size values', uiFontSizes.length, '≤ 7', 'css',
    uiFontSizes.length <= 7, uiFontSizes),
  metric('font-weights', 'font-weight values', fontWeights.length, '≤ 3', 'css',
    fontWeights.length <= 3, fontWeights),
  metric('radius-disallowed', 'non-token border-radius values', radiusDisallowed.length, '0', 'css',
    radiusDisallowed.length === 0, radiusDisallowed),
  metric('radius-non-pill', 'non-pill radius values', radiusNonPillExceptPanel.length, '≤ 3 (panel is a W5 exception)', 'css',
    radiusNonPillExceptPanel.length <= 3, radiusNonPill),
  metric('shadow-disallowed', 'non-token box-shadow values', shadowDisallowed.length, '0', 'css',
    shadowDisallowed.length === 0, shadowDisallowed),
  metric('color-literals', 'color literals outside compat block', outsideColors.total, '0', 'css',
    outsideColors.total === 0, [`hex=${outsideColors.hex}`, `rgb=${outsideColors.rgb}`]),
  metric('compat-literals', 'compat-block color literals', compatColors.total, '≤ 12', 'css',
    compatColors.total <= 12, [`blocks=${compatBlocks.length}`]),
  metric('padding-values', 'padding values (incl. longhand)', paddings.length, '≤ 12', 'css',
    paddings.length <= 12, paddings),
  metric('gap-values', 'gap values', gaps.length, '≤ 8', 'css',
    gaps.length <= 8, gaps),
  metric('important', '!important declarations', important, '0', 'css',
    important === 0, []),
  metric('objective-panels', 'legacy objective card markup', objectivePanelCount, '0', 'ia',
    objectivePanelCount === 0, []),
  metric('go-section-navigation', 'goSection scrolls/focuses target', goSectionNavigates ? 'yes' : 'no', 'yes', 'ia',
    goSectionNavigates, []),
  metric('legacy-overview-markup', 'legacy overview/stat/budget markup', legacyOverviewMarkup, '0', 'ia',
    legacyOverviewMarkup === 0, []),
  metric('dirty-only-actionbar', 'action bar rendered only when dirty', dirtyOnlyActionBar ? 'yes' : 'no', 'yes', 'ia',
    dirtyOnlyActionBar, []),
]

const gatePhase = gate === null ? null : PHASES[gate]
const failures = metrics.filter(item => (gatePhase === null ? false : PHASES[item.phase] <= gatePhase && !item.pass))
const passed = failures.length === 0

if (asJson) {
  console.log(JSON.stringify({
    gate,
    passed,
    phases: PHASES,
    source: { css: 'src/client/charter.css', tsx: 'src/client/CharterPane.tsx' },
    hostVars,
    compatBlocks: compatBlocks.length,
    metrics,
  }, null, 2))
} else {
  console.log('dsh-charter UI metrics — 0.3.0 all-section GUI refactor')
  console.log(`source: ${CSS_PATH.replace(`${ROOT}/`, '')} + ${PAGE_PATHS.map(path => path.replace(`${ROOT}/`, '')).join(' + ')}`)
  console.log(`gate: ${gate ?? 'none (report only)'}${gatePhase === null ? '' : ` | phases ≤ ${gate}`}`)
  console.log('')
  const rows = metrics.map(item => ({
    metric: item.label,
    value: String(item.value),
    target: item.target,
    phase: item.phase,
    result: item.pass ? 'PASS' : 'FAIL',
  }))
  const widths = {
    metric: Math.max(...rows.map(row => row.metric.length)),
    value: Math.max(...rows.map(row => row.value.length), 5),
    target: Math.max(...rows.map(row => row.target.length), 6),
    phase: 5,
  }
  const line = row => `  ${row.metric.padEnd(widths.metric)}  ${row.value.padStart(widths.value)}  ${row.target.padEnd(widths.target)}  ${row.phase.padEnd(widths.phase)}  ${row.result}`
  console.log(line({ metric: 'metric', value: 'value', target: 'target', phase: 'phase', result: 'result' }))
  console.log(`  ${'-'.repeat(widths.metric)}  ${'-'.repeat(widths.value)}  ${'-'.repeat(widths.target)}  ${'-'.repeat(widths.phase)}  ------`)
  for (const row of rows) console.log(line(row))
  console.log('')
  console.log(`host variables used: ${hostVars.length}`)
  console.log(`compat blocks: ${compatBlocks.length} | compat literals: ${compatColors.total}`)
  if (failures.length > 0) {
    console.log('')
    console.log(`FAIL: ${failures.length} metric(s) outside target`)
    for (const item of failures) {
      console.log(`  - ${item.label}: ${item.value} (target ${item.target})${item.detail.length > 0 ? ` — ${item.detail.slice(0, 8).join(', ')}` : ''}`)
    }
  } else {
    console.log('')
    console.log(gate === null ? 'PASS: report generated (no gate)' : `PASS: all ${gate} metrics within target`)
  }
}

if (gatePhase !== null && !passed) process.exit(1)
