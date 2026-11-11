/**
 * W0-0 验收：依赖关系图形视图的纯函数契约（无需浏览器）。
 *
 *   node scripts/prototype/dependency-graph-w0/verify.mjs
 *
 * 覆盖设计稿 docs/design/charter-dependency-graph-v1.zh.md 中所有可在 Node 下判定的条款：
 * §3.3 两层接口、§3.4 候选泳道与三类边、§3.5 键盘目标解析、§3.7 em 几何与行数档位、
 * D5 降级、D10 候选节点语义、D13 三态、D18 默认焦点。
 *
 * DOM 级合同（Tab 停靠数、roving tabindex、SVG <g> 可聚焦性、200% 文本缩放溢出、
 * 两栏可用性）不在本脚本范围，见 index.html 的 W0-1/W0-2/W0-3 与页尾人工清单。
 */
import {
  C, buildModel, layoutGraph, arrowTarget, labelLines, checkOverlap, defaultFocus,
  determinismCheck, defaultScenario, acceptScenario, hubScenario, chainScenario,
  supersedeScenario, revokeScenario, inconsistentSupersedeScenario, supersedeDenseScenario,
} from './w0-engine.js'

let pass = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`[PASS] ${name}${detail ? ` — ${detail}` : ''}`) } else {
    failures.push(name); console.log(`[FAIL] ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const scenario = defaultScenario()
const model = buildModel(scenario)
const layout = layoutGraph(model, { depth: 2 })
const byId = new Map(layout.nodes.map((n) => [n.id, n]))
const edgeByKey = new Map(layout.edges.map((e) => [e.key, e]))

/* ---------- §3.7 几何不变式 ---------- */
check('§3.7 RANK_PITCH > NODE_W（横向不重叠）', C.RANK_PITCH_EM > C.NODE_W_EM,
  `${C.RANK_PITCH_EM}em > ${C.NODE_W_EM}em`)
check('§3.7 ROW_PITCH > 最大节点高（纵向不重叠）', C.ROW_PITCH_EM > Math.max(...Object.values(C.NODE_H_EM)),
  `${C.ROW_PITCH_EM}em > ${Math.max(...Object.values(C.NODE_H_EM))}em`)
check('§3.7 LINE_CAPACITY 由几何推导',
  C.LINE_CAPACITY === Math.floor((C.NODE_W_EM - 2 * C.NODE_PADDING_EM) / C.SUMMARY_EM),
  `floor((${C.NODE_W_EM} − 2×${C.NODE_PADDING_EM}) / ${C.SUMMARY_EM}) = ${C.LINE_CAPACITY}`)
check('§3.7 节点高度只有两个离散档位',
  layout.nodes.every((n) => [3, 4.5].includes(n.h)) && layout.nodes.every((n) => n.h === C.NODE_H_EM[n.labelLines]),
  [...new Set(layout.nodes.map((n) => `${n.labelLines}行→${n.h}em`))].join(', '))
check('§3.7 labelLines 是纯函数（同输入同输出）',
  layout.nodes.every((n) => labelLines(n.text) === n.labelLines))

/* ---------- 几何正确性：多焦点 × 多深度 ---------- */
const focusIds = [undefined, ...model.nodes.map((n) => n.id)]
let overlapTotal = 0
let rebaseFail = []
const combos = []
for (const depth of [1, 2]) {
  for (const focus of focusIds) {
    const L = layoutGraph(model, { focusId: focus, depth })
    combos.push({ depth, focus, L })
    overlapTotal += checkOverlap(L).length
    if (L.nodes.length && Math.min(...L.nodes.map((n) => n.x)) !== 0) rebaseFail.push(`${focus ?? '默认'}/d${depth}`)
  }
}
check('§3.7 全部 focus×depth 组合零节点重叠', overlapTotal === 0,
  `${combos.length} 组组合，重叠 ${overlapTotal} 处`)
check('§3.7 ego 裁剪后 rank 重新基准化（minX = 0）', rebaseFail.length === 0,
  rebaseFail.length ? `未基准化：${rebaseFail.join(', ')}` : `${combos.length} 组组合 minX 均为 0`)

/* ---------- 画布尺寸（文档写定的数值） ---------- */
const d1 = layoutGraph(model, { depth: 1 })
const d2 = layoutGraph(model, { depth: 2 })
const expectD1 = 2 * C.RANK_PITCH_EM + C.NODE_W_EM
const expectD2 = 4 * C.RANK_PITCH_EM + C.NODE_W_EM
check('§3.7 depth1 画布宽 = 3 列 = 35em（≈560px，初始视图可容纳）', d1.width === expectD1,
  `${d1.width}em ≈ ${d1.width * 16}px`)
check('§3.7 depth2 画布宽 = 5 列 = 60em（≈960px，需平移）', d2.width === expectD2,
  `${d2.width}em ≈ ${d2.width * 16}px`)

/* ---------- 确定性 ---------- */
const det = determinismCheck(scenario)
check('§3.3 布局确定性（两次输出字节一致）', det.identical, `${det.bytes} 字节`)

/* ---------- D18 默认焦点 ---------- */
const focusNode = byId.get(defaultFocus(model)) ?? model.nodes.find((n) => n.id === defaultFocus(model))
check('D18 默认焦点命中被 executionDisplay 掩盖的冲突节点',
  defaultFocus(model) === 'item-it' && focusNode?.prerequisiteStatus === 'dependency-conflict'
  && focusNode?.executionDisplay === 'in-progress',
  `defaultFocus=${defaultFocus(model)}（executionDisplay=${focusNode?.executionDisplay}, prerequisiteStatus=${focusNode?.prerequisiteStatus}）`)

/* ---------- D10 候选泳道语义 ---------- */
const candNodes = layout.nodes.filter((n) => n.lane === 'candidate')
const execNodes = layout.nodes.filter((n) => n.lane === 'execution')
check('D10 候选节点无 localKey / 无 rank / 无 executionDisplay',
  candNodes.length > 0 && candNodes.every((n) => n.localKey === undefined && n.rank === undefined
    && n.executionDisplay === undefined && n.prerequisiteStatus === undefined),
  candNodes.map((n) => n.id).join(', '))
check('D10 执行泳道节点均有 D<n> 且与拓扑序同源',
  execNodes.every((n) => /^D\d+$/u.test(n.localKey)) && execNodes.length === model.topoOrder.filter((id) => layout.nodes.some((n) => n.id === id)).length,
  execNodes.map((n) => `${n.localKey}=${n.id}`).join(', '))
check('§3.4 候选泳道位于执行拓扑下方',
  Math.min(...candNodes.map((n) => n.y)) > Math.max(...execNodes.map((n) => n.y + n.h)),
  `候选 minY=${Math.min(...candNodes.map((n) => n.y))}em > 执行 maxY=${Math.max(...execNodes.map((n) => n.y + n.h))}em`)

/* ---------- §3.4 三类边与 D13 三态 ---------- */
check('§3.4 requires 边可编辑、proposed 边只读',
  layout.edges.filter((e) => e.kind === 'requires').every((e) => e.editable)
  && layout.edges.filter((e) => e.kind === 'proposed').every((e) => !e.editable && e.targetProposalId))
check('D13 节点三态由 committed↔projected 差集推导（非外部声明）',
  layout.nodes.find((n) => n.id === 'item-docs')?.state === 'staged-changed'
  && layout.nodes.find((n) => n.id === 'item-deploy')?.state === 'staged-changed'
  && layout.nodes.filter((n) => n.state === 'unchanged').length >= 4,
  layout.nodes.filter((n) => n.lane === 'execution').map((n) => `${n.id}:${n.state}`).join(', '))
check('D13 边三态由 requires 集合差集推导（同时存在 added / removed / committed）',
  layout.edges.some((e) => e.kind === 'requires' && e.state === 'staged-added')
  && layout.edges.some((e) => e.kind === 'requires' && e.state === 'staged-removed')
  && layout.edges.some((e) => e.kind === 'requires' && e.state === 'committed'),
  layout.edges.filter((e) => e.kind === 'requires').map((e) => `${e.from}→${e.to}:${e.state}`).join(', '))
check('§3.3 "提升"规则：接受候选提案后，候选节点入执行泳道并获得 D<n>，候选边变 staged-added 的 requires', (() => {
  const accepted = buildModel(acceptScenario())
  const L = layoutGraph(accepted, { focusId: 'p-limit', depth: 1 })
  const node = L.nodes.find((n) => n.id === 'p-limit')
  const promoted = L.edges.find((e) => e.from === 'item-auth' && e.to === 'p-limit')
  return node?.lane === 'execution' && node?.state === 'staged-added' && /^D\d+$/u.test(node.localKey ?? '')
    && promoted?.kind === 'requires' && promoted?.state === 'staged-added'
    && L.edges.every((e) => !(e.kind === 'proposed' && e.to === 'p-limit'))
})(), '候选边消失 + 实线新增边出现 + 节点获得局部 key')

/* ---------- §3.5 键盘模型 ---------- */
check('§3.5 ←/→ 只沿 requires 边（候选边不混入）', (() => {
  const bad = []
  for (const n of layout.nodes) {
    const r = arrowTarget(layout, n.id, 'ArrowRight')
    if (r && edgeByKey.get(`e:${n.id}→${r}`)?.kind !== 'requires') bad.push(`${n.id}→${r}`)
    const l = arrowTarget(layout, n.id, 'ArrowLeft')
    if (l && edgeByKey.get(`e:${l}→${n.id}`)?.kind !== 'requires') bad.push(`${n.id}←${l}`)
  }
  return bad.length === 0 || bad.join(',')
})())
check('§3.5 [/] 扁平遍历覆盖全部可导航元素（含候选节点与候选边）', (() => {
  const visited = new Set()
  let key = layout.traversal[0]
  for (let i = 0; i < layout.traversal.length * 2; i += 1) {
    visited.add(key)
    const next = arrowTarget(layout, key, 'BracketRight')
    if (next === null || next === key) break
    key = next
  }
  const missing = layout.traversal.filter((t) => !visited.has(t))
  return missing.length === 0 && visited.size === layout.traversal.length
    || `覆盖 ${visited.size}/${layout.traversal.length}，缺失 ${missing.join(',')}`
})(), `${layout.traversal.length}/${layout.navigables} 可导航元素`)
check('§3.5 traversal 与 navigables 一致且无重复',
  new Set(layout.traversal).size === layout.traversal.length
  && layout.traversal.length === layout.nodes.length + layout.edges.length,
  `traversal ${layout.traversal.length} = 节点 ${layout.nodes.length} + 边 ${layout.edges.length}`)
check('§3.5 ↑/↓ 只在同列同泳道内移动', (() => {
  const bad = []
  for (const n of layout.nodes) {
    for (const key of ['ArrowUp', 'ArrowDown']) {
      const t = arrowTarget(layout, n.id, key)
      if (t === null) continue
      const target = byId.get(t)
      if (!target || target.lane !== n.lane || target.col !== n.col) bad.push(`${n.id}-${key}->${t}`)
    }
  }
  return bad.length === 0 || bad.join(',')
})())
check('§3.5 候选边可被方向键到达（可导航 ≠ 可编辑）', (() => {
  const proposedKeys = layout.edges.filter((e) => e.kind === 'proposed').map((e) => e.key)
  return proposedKeys.every((k) => layout.traversal.includes(k))
})(), layout.edges.filter((e) => e.kind === 'proposed').map((e) => e.key).join(', '))
check('§3.5 Home/End 落在 traversal 首末',
  arrowTarget(layout, layout.traversal[3], 'Home') === layout.traversal[0]
  && arrowTarget(layout, layout.traversal[0], 'End') === layout.traversal[layout.traversal.length - 1])

/* ---------- D2 / D5 规模与降级 ---------- */
const hub20 = layoutGraph(buildModel(hubScenario(20)), { focusId: 'hub', depth: 2 })
const hub40 = layoutGraph(buildModel(hubScenario(40)), { focusId: 'hub', depth: 2 })
check('D5 阈值内不降级（枢纽 20 前置 = 41 可导航）',
  hub20.degraded.hidden === false && hub20.degraded.depthReduced === false, `navigables=${hub20.navigables}`)
check('D5 超阈值两级降级（枢纽 40 前置 = 81 可导航 → 锁深度后仍超 → 隐藏）',
  hub40.degraded.depthReduced === true && hub40.degraded.hidden === true, `navigables=${hub40.navigables}`)
const chain = buildModel(chainScenario(70))
const chainEgo = layoutGraph(chain, { focusId: 'chain-35', depth: 1 })
check('D2 长链场景下 ego 裁剪把规模压到常数级',
  chainEgo.nodes.length <= 3 && chainEgo.navigables <= 6 && chainEgo.degraded.hidden === false,
  `70 节点长链，ego1 = ${chainEgo.nodes.length} 节点 / ${chainEgo.navigables} 可导航`)
check('D2 不存在全图模式（未给 focusId 时也按 D18 裁剪）',
  layoutGraph(chain, { depth: 2 }).nodes.length <= 5,
  `70 节点长链，默认焦点裁剪后 = ${layoutGraph(chain, { depth: 2 }).nodes.length} 节点`)

/* ---------- §10.1 替代边与 history 泳道（v1 一体实现） ---------- */
const supModel = buildModel(supersedeScenario())
const supLayout = layoutGraph(supModel, { focusId: 'item-a', depth: 2 })
const supById = new Map(supLayout.nodes.map((n) => [n.id, n]))
const ghosts = supLayout.nodes.filter((n) => n.lane === 'history')

check('§10.1-1 已提交的替代产生只读幽灵节点（无 localKey / 无 rank / ghost）',
  ghosts.length > 0 && ghosts.every((n) => n.ghost === true && n.localKey === undefined && n.rank === undefined
    && n.executionDisplay === undefined && n.prerequisiteStatus === undefined),
  ghosts.map((n) => n.id).join(', '))
check('§10.1-1 supersedes 边只读，且可被 [/] 到达',
  supLayout.edges.filter((e) => e.kind === 'supersedes').length > 0
  && supLayout.edges.filter((e) => e.kind === 'supersedes').every((e) => e.editable === false && supLayout.traversal.includes(e.key))
  && ghosts.every((g) => supLayout.traversal.includes(g.id)),
  supLayout.edges.filter((e) => e.kind === 'supersedes').map((e) => `${e.from}→${e.to}:${e.state}`).join(', '))
check('§10.1-1 history 带在候选带之下（无候选带时在执行带之下）', (() => {
  const cand = supLayout.nodes.filter((n) => n.lane === 'candidate')
  const exec = supLayout.nodes.filter((n) => n.lane === 'execution')
  const floor = cand.length
    ? Math.max(...cand.map((n) => n.y + n.h))
    : Math.max(...exec.map((n) => n.y + n.h))
  return ghosts.length > 0 && Math.min(...ghosts.map((n) => n.y)) > floor
    || `history minY=${Math.min(...ghosts.map((n) => n.y))} ≤ 上带底边 ${floor}`
})())
check('§10.1-2 本次 staged 的替代两端都留在执行泳道，不生成幽灵', (() => {
  const b = supById.get('item-b')
  const a2 = supById.get('item-a2')
  const edge = supLayout.edges.find((e) => e.kind === 'supersedes' && e.from === 'item-b' && e.to === 'item-a2')
  return b?.lane === 'execution' && b?.state === 'staged-removed'
    && a2?.lane === 'execution' && a2?.state === 'staged-added'
    && edge?.state === 'staged-added'
    && !supLayout.nodes.some((n) => n.ghost && n.id === 'item-b')
    || `item-b=${b?.lane}/${b?.state}, item-a2=${a2?.lane}/${a2?.state}, edge=${edge?.state}`
})())
check('§10.1-3 撤销替代 → supersedes 边为 staged-removed，旧条目回到执行泳道', (() => {
  const m = buildModel(revokeScenario())
  const L = layoutGraph(m, { focusId: 'item-a', depth: 1 })
  const edge = L.edges.find((e) => e.kind === 'supersedes')
  const a0 = L.nodes.find((n) => n.id === 'item-a0')
  return edge?.state === 'staged-removed' && a0?.lane === 'execution' && a0?.state === 'staged-added'
    && !L.nodes.some((n) => n.ghost)
    || `edge=${edge?.state}, item-a0=${a0?.lane}/${a0?.state}`
})())
check('§10.1-4 链式替代的两个幽灵与最近的执行节点同列', (() => {
  const a = supById.get('item-a')
  const a0 = supById.get('item-a0')
  const a1 = supById.get('item-a1')
  return a !== undefined && a0 !== undefined && a1 !== undefined
    && a0.col === a.col && a1.col === a.col && a0.x === a.x && a1.x === a.x
    || `col: item-a=${a?.col}, item-a0=${a0?.col}, item-a1=${a1?.col}`
})(), `item-a1 → item-a0 → item-a 同列 col=${supById.get('item-a')?.col}`)
check('§10.1-5 不一致数据（替代成环 + 悬空引用）不崩溃且输出确定', (() => {
  const sc = inconsistentSupersedeScenario()
  const m = buildModel(sc)
  const L1 = layoutGraph(m, { focusId: 'item-a', depth: 2 })
  const L2 = layoutGraph(m, { focusId: 'item-a', depth: 2 })
  const ids = L1.nodes.map((n) => n.id)
  return JSON.stringify(L1) === JSON.stringify(L2)
    && ids.includes('item-x') && ids.includes('item-y') && !ids.includes('item-missing')
    && L1.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))
    && checkOverlap(L1).length === 0
    || `nodes=${ids.join(',')}, overlaps=${checkOverlap(L1).length}`
})())
check('§10.1-6 showSupersedes:false 时模型不含 history 节点与 supersedes 边', (() => {
  const off = buildModel({ ...supersedeScenario(), showSupersedes: false })
  return off.nodes.every((n) => n.lane !== 'history') && off.edges.every((e) => e.kind !== 'supersedes')
    && off.navigables < supModel.navigables
    || `off navigables=${off.navigables}, on navigables=${supModel.navigables}`
})(), `关=${buildModel({ ...supersedeScenario(), showSupersedes: false }).navigables} / 开=${supModel.navigables} 可导航`)
check('§10.1-7 D5 第一级降级：先关 history 泳道，而不是先锁深度或隐藏', (() => {
  const L = layoutGraph(buildModel(supersedeDenseScenario(20, 20)), { focusId: 'hub', depth: 2 })
  return L.degraded.supersedesHidden === true && L.degraded.depthReduced === false && L.degraded.hidden === false
    && L.nodes.every((n) => n.lane !== 'history') && L.edges.every((e) => e.kind !== 'supersedes')
    || JSON.stringify(L.degraded)
})(), `降级后 navigables=${layoutGraph(buildModel(supersedeDenseScenario(20, 20)), { focusId: 'hub', depth: 2 }).navigables}`)
check('§10.1-8 D12：只有 supersedes 边时图形区仍启用', (() => {
  const m = buildModel(revokeScenario())
  return m.edges.length > 0 && m.edges.every((e) => e.kind === 'supersedes' || e.kind === 'requires')
    && m.edges.some((e) => e.kind === 'supersedes')
})())
check('§3.5 ←/→ 不沿 supersedes 边移动（只沿 requires）', (() => {
  const bad = []
  for (const e of supLayout.edges.filter((x) => x.kind !== 'requires')) {
    if (arrowTarget(supLayout, e.key, 'ArrowRight') !== null) bad.push(`→${e.key}`)
    if (arrowTarget(supLayout, e.key, 'ArrowLeft') !== null) bad.push(`←${e.key}`)
  }
  for (const g of ghosts) {
    const r = arrowTarget(supLayout, g.id, 'ArrowRight')
    const l = arrowTarget(supLayout, g.id, 'ArrowLeft')
    if (r !== null) bad.push(`ghost→${r}`)
    if (l !== null) bad.push(`ghost←${l}`)
  }
  return bad.length === 0 || bad.join(',')
})())
check('§10.1 替代场景 traversal 完整且无重复（节点 + 边）',
  new Set(supLayout.traversal).size === supLayout.traversal.length
  && supLayout.traversal.length === supLayout.nodes.length + supLayout.edges.length,
  `traversal ${supLayout.traversal.length} = 节点 ${supLayout.nodes.length} + 边 ${supLayout.edges.length}`)
check('§10.1 替代场景全部 focus×depth 组合零重叠且重新基准化', (() => {
  let overlaps = 0
  let unbased = []
  for (const depth of [1, 2]) {
    for (const focus of [undefined, ...supModel.nodes.map((n) => n.id)]) {
      const L = layoutGraph(supModel, { focusId: focus, depth })
      overlaps += checkOverlap(L).length
      if (L.nodes.length && Math.min(...L.nodes.map((n) => n.x)) !== 0) unbased.push(`${focus ?? '默认'}/d${depth}`)
    }
  }
  return overlaps === 0 && unbased.length === 0 || `重叠 ${overlaps} 处；未基准化 ${unbased.join(',')}`
})())

console.log('')
console.log(failures.length === 0
  ? `W0-0 全部通过：${pass} 项`
  : `W0-0 失败 ${failures.length} 项：${failures.join(' | ')}（通过 ${pass} 项）`)
process.exit(failures.length === 0 ? 0 : 1)
