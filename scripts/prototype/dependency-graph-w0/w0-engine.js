/**
 * W0 原型引擎：依赖关系图形视图的语义层 + 几何层 + 键盘模型。
 *
 * 对应设计稿 docs/design/charter-dependency-graph-v1.zh.md：
 *   §3.3 两层接口（buildRelationGraph / layoutRelationGraph）
 *   §3.5 复合控件键盘模型（←/→ 只沿 requires，[/] 走扁平 traversal）
 *   §3.7 em 几何与 200% 缩放契约（离散高度档位、纯函数行数、不做运行时测量）
 *   D5  可导航元素阈值与两级降级
 *   D18 默认焦点规则（依据 prerequisiteStatus，不用被掩盖的 executionDisplay）
 *
 * 纯函数、无副作用、不依赖 DOM/字体/DPR/容器宽度，因此可在 Node 下验收（verify.mjs）。
 * 浏览器侧（index.html + w0-page.js）只负责渲染与 DOM 级实测。
 */

/* ---------- 设计常量（§3.7 / D19 / D5） ----------
 * 两条硬不变式，违反则节点必然重叠：
 *   RANK_PITCH_EM > NODE_W_EM + 边间距
 *   ROW_PITCH_EM  > 最大节点高 + 行间距
 */
export const C = {
  NODE_PADDING_EM: 0.625,      // 左右内边距
  SUMMARY_EM: 0.78,            // 摘要字号（em）
  NODE_MIN_W_EM: 9,
  NODE_W_EM: 10,
  NODE_MAX_W_EM: 12,
  NODE_H_EM: { 1: 3, 2: 4.5 }, // 离散档位，由行数纯函数决定
  RANK_PITCH_EM: 12.5,         // = NODE_W_EM(10) + 边间距(2.5)
  ROW_PITCH_EM: 5.5,           // = 最大节点高(4.5) + 行间距(1)
  CANDIDATE_GAP_EM: 2.5,       // 执行拓扑底边到候选泳道
  HISTORY_GAP_EM: 2.5,           // 候选带底边到 history 带（§10.1）
  NAV_THRESHOLD: 60,           // D5：可导航元素上限
  MIN_TOUCH_PX: 44,            // D7
}
/** 每行可容纳的权重（CJK=1，拉丁/数字=0.5），由几何推导，不是魔数。 */
C.LINE_CAPACITY = Math.floor((C.NODE_W_EM - 2 * C.NODE_PADDING_EM) / C.SUMMARY_EM)

/* ---------- 样本数据：覆盖全部 executionDisplay、三类边与三态 ----------
 * 场景提供 committed 与 projected 两份 item 数组（对应 view.items 与
 * projectView(view, ops).items）。三态**由差集推导**，不接受外部声明，
 * 与 §3.3 的语义层契约一致。
 */
const D = (id, text, progress, requires = []) => ({
  kind: 'deliverable', id, text, review: 'accepted', lifecycle: 'current', progress, requires,
})
const P = (id, text, proposedRequires) => ({
  kind: 'deliverable', id, text, review: 'pending', lifecycle: 'current',
  progress: 'not-started', proposedRequires,
})
/** 已被替代的历史条目：两侧都 inactive → history 泳道的幽灵节点（§10.1） */
const S = (id, text, supersededBy) => ({
  kind: 'deliverable', id, text, review: 'accepted', lifecycle: 'superseded',
  progress: 'cancelled', requires: [], supersededBy,
})

const COMMITTED = [
  { ...D('item-gw', '搭建 API 网关并接入统一入口', 'done'), supersedes: 'item-gw-v1' },
  S('item-gw-v1', '搭建 API 网关（初版方案）', 'item-gw'),
  D('item-auth', '实现鉴权中间件，覆盖 token 校验、权限位与审计日志三条链路', 'in-progress', ['item-gw']),
  D('item-docs', '编写用户文档', 'not-started', ['item-gw']),
  D('item-it', '编写集成测试', 'in-progress', ['item-auth']),
  D('item-deploy', '部署到预发布环境', 'not-started', ['item-it', 'item-auth']),
  D('item-ops', '撰写运维手册', 'blocked', ['item-deploy']),
  P('p-limit', '增加限流策略', ['item-auth']),
  P('p-canary', '补充灰度发布方案与回滚步骤', ['p-limit', 'item-deploy']),
]

/**
 * projected：模拟一个已暂存的 Change Set ——
 *   ① item-docs 进度 not-started → in-progress（节点 staged-changed）
 *   ② item-deploy 新增前置 item-docs（边 staged-added）
 *   ③ item-deploy 移除前置 item-auth（边 staged-removed）
 * pending 提案保持不变，因此候选泳道与候选边仍然存在。
 */
const PROJECTED = COMMITTED.map((item) => {
  if (item.id === 'item-docs') return { ...item, progress: 'in-progress' }
  if (item.id === 'item-deploy') return { ...item, requires: ['item-it', 'item-docs'] }
  return item
})

/** 接受 p-limit 后的 projected：用于验证"提升"规则（候选边 → staged-added requires） */
const PROJECTED_ACCEPTED = [
  ...COMMITTED.filter((i) => i.id !== 'p-limit'),
  { ...COMMITTED.find((i) => i.id === 'p-limit'), review: 'accepted', requires: ['item-auth'], proposedRequires: undefined },
].map((item) => (item.id === 'item-deploy' ? { ...item, requires: ['item-it', 'item-docs'] } : item))

export const defaultScenario = () => ({ committed: COMMITTED, projected: PROJECTED, showSupersedes: true })
export const acceptScenario = () => ({ committed: COMMITTED, projected: PROJECTED_ACCEPTED, showSupersedes: true })

/**
 * 替代专项场景（§10.1）：同时覆盖
 *   ① 已提交的替代 + 链式替代（item-a1 → item-a0 → item-a，两个幽灵同列）
 *   ② 本次 staged 的 item.supersede（item-b 出局、item-a2 进入，两端都在执行泳道，**不**生成幽灵）
 */
export function supersedeScenario() {
  const a1 = S('item-a1', '最早的部署脚本', 'item-a0')
  const a0 = { ...S('item-a0', '初版部署脚本', 'item-a'), supersedes: 'item-a1' }
  const a = { ...D('item-a', '当前部署脚本', 'done'), supersedes: 'item-a0' }
  const b = D('item-b', '发布前检查清单', 'not-started', ['item-a'])
  const committed = [a1, a0, a, b]
  const projected = [
    a1, a0, a,
    { ...b, lifecycle: 'superseded', supersededBy: 'item-a2' },
    { ...D('item-a2', '发布前检查清单（重写版）', 'not-started', ['item-a']), supersedes: 'item-b' },
  ]
  return { committed, projected, showSupersedes: true }
}

/** 撤销替代：projected 中关系消失 → supersedes 边为 staged-removed，旧条目回到执行泳道 */
export function revokeScenario() {
  const committed = [
    { ...D('item-a', '当前部署脚本', 'done'), supersedes: 'item-a0' },
    S('item-a0', '初版部署脚本', 'item-a'),
  ]
  const projected = [D('item-a', '当前部署脚本', 'done'), D('item-a0', '初版部署脚本', 'not-started')]
  return { committed, projected, showSupersedes: true }
}

/** 不一致数据：替代关系成环 + 悬空引用，必须不崩溃、不死循环、输出确定 */
export function inconsistentSupersedeScenario() {
  const committed = [
    { ...D('item-a', '当前部署脚本', 'done'), supersedes: 'item-x' },
    { ...S('item-x', '历史条目 X', 'item-y'), supersedes: 'item-y' },
    { ...S('item-y', '历史条目 Y', 'item-x'), supersedes: 'item-x' },
    { ...D('item-dangling', '引用不存在条目的交付物', 'not-started'), supersedes: 'item-missing' },
  ]
  return { committed, projected: committed, showSupersedes: true }
}

/** 规模场景：spokes 条 requires + ghosts 条替代，用于验证 D5 三级降级的第一级 */
export function supersedeDenseScenario(spokes, ghosts) {
  const committed = [{ kind: 'deliverable', id: 'hub', text: '汇总交付物', review: 'accepted', lifecycle: 'current', progress: 'not-started', requires: [] }]
  for (let i = 0; i < spokes; i += 1) {
    const id = `spoke-${i}`
    committed.push({ kind: 'deliverable', id, text: `前置交付物 ${i}`, review: 'accepted', lifecycle: 'current', progress: 'not-started', requires: [] })
    committed[0].requires.push(id)
  }
  for (let i = 0; i < ghosts; i += 1) {
    const ghostId = `old-${i}`
    committed.push(S(ghostId, `已被替代的历史条目 ${i}`, 'hub'))
    committed[0].supersedes = committed[0].supersedes === undefined ? ghostId : committed[0].supersedes
    committed.push({ ...S(`${ghostId}-b`, `链上的历史条目 ${i}`, 'hub'), supersedes: ghostId })
  }
  // hub 只能声明一个 supersedes，其余幽灵通过 supersededBy 关联到 hub
  return { committed, projected: committed, showSupersedes: true }
}

/** 枢纽场景：一个交付物有 n 个前置，用于验证 ego 图也能触发 D5 降级 */
export function hubScenario(n) {
  const committed = [{ kind: 'deliverable', id: 'hub', text: '汇总交付物', review: 'accepted', lifecycle: 'current', progress: 'not-started', requires: [] }]
  for (let i = 0; i < n; i += 1) {
    const id = `spoke-${i}`
    committed.push({ kind: 'deliverable', id, text: `前置交付物 ${i}`, review: 'accepted', lifecycle: 'current', progress: 'not-started', requires: [] })
    committed[0].requires.push(id)
  }
  return { committed, projected: committed, showSupersedes: true }
}

/** 长链场景：验证 ego 裁剪与 D5 降级 */
export function chainScenario(n) {
  const committed = []
  for (let i = 0; i < n; i += 1) {
    committed.push({
      kind: 'deliverable', id: `chain-${i}`, text: `链上交付物 ${i}`, review: 'accepted',
      lifecycle: 'current', progress: 'not-started', requires: i === 0 ? [] : [`chain-${i - 1}`],
    })
  }
  return { committed, projected: committed, showSupersedes: true }
}

/* ---------- §6.5 派生状态（与 src/core/dependencies.ts 同规则） ---------- */
export function prerequisiteStatus(item, byId) {
  const prereqs = (item.requires || []).map((id) => byId.get(id)).filter(Boolean)
  if (prereqs.some((p) => p.progress === 'cancelled')) return 'dependency-conflict'
  if (prereqs.some((p) => p.progress !== 'done') && (item.progress === 'in-progress' || item.progress === 'done')) {
    return 'dependency-conflict'
  }
  if (prereqs.some((p) => p.progress !== 'done')) return 'waiting'
  return 'satisfied'
}

export function executionDisplay(item, byId) {
  const s = prerequisiteStatus(item, byId)
  if (item.progress === 'done' || item.progress === 'cancelled') return 'terminal'
  if (item.progress === 'blocked') return 'blocked'
  if (item.progress === 'in-progress') return 'in-progress'
  return s === 'satisfied' ? 'ready' : s
}

/* ---------- 拓扑：rank + 局部 key + 派生状态（与 core/dependencies.ts 同源规则） ---------- */
function topology(items) {
  const byId = new Map(items.map((i) => [i.id, i]))
  const rankOf = new Map()
  const place = (id, seen = new Set()) => {
    if (rankOf.has(id)) return rankOf.get(id)
    if (seen.has(id)) return 0 // 环由 core 的结构校验负责，原型不抛错
    seen.add(id)
    const requires = (byId.get(id)?.requires || []).filter((r) => byId.has(r))
    const rank = requires.length === 0 ? 0 : Math.max(...requires.map((r) => place(r, new Set(seen)))) + 1
    rankOf.set(id, rank)
    return rank
  }
  items.forEach((i) => place(i.id))

  const byRank = new Map()
  items.forEach((i) => {
    const r = rankOf.get(i.id)
    if (!byRank.has(r)) byRank.set(r, [])
    byRank.get(r).push(i)
  })
  const out = new Map()
  const ordered = []
  for (const rank of [...byRank.keys()].sort((a, b) => a - b)) {
    const rows = byRank.get(rank).slice().sort((a, b) => a.id.localeCompare(b.id))
    rows.forEach((item, order) => {
      out.set(item.id, {
        id: item.id, rank, order,
        progress: item.progress,
        executionDisplay: executionDisplay(item, byId),
        prerequisiteStatus: prerequisiteStatus(item, byId),
      })
      ordered.push(item.id)
    })
  }
  ordered.forEach((id, i) => { out.get(id).localKey = `D${i + 1}` })
  return { byId: out, ordered }
}

const isActive = (i) => i.kind === 'deliverable' && i.review === 'accepted' && i.lifecycle === 'current'
const isPending = (i) => i.kind === 'deliverable' && i.review === 'pending' && i.lifecycle === 'current'
const reqSet = (i) => new Set(i.requires || [])
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))

/* ---------- 语义层：buildRelationGraph（§3.3）
 * 三态全部由 committed ↔ projected 差集推导，不接受外部声明。
 */
export function buildModel(input) {
  const committed = input.committed || []
  const projected = input.projected || []
  const showSupersedes = input.showSupersedes !== false   // D11：v1 默认画替代边

  const commActive = committed.filter(isActive)
  const projActive = projected.filter(isActive)
  const commTopo = topology(commActive)
  const projTopo = topology(projActive)
  const commById = new Map(commActive.map((i) => [i.id, i]))
  const projById = new Map(projActive.map((i) => [i.id, i]))

  /* --- execution 泳道节点 --- */
  const nodes = []
  for (const id of new Set([...commActive.map((i) => i.id), ...projActive.map((i) => i.id)])) {
    const c = commById.get(id)
    const p = projById.get(id)
    let state = 'unchanged'
    if (!c && p) state = 'staged-added'
    else if (c && !p) state = 'staged-removed'
    else if (c && p && (!sameSet(reqSet(c), reqSet(p)) || c.progress !== p.progress)) state = 'staged-changed'
    const t = projTopo.byId.get(id) ?? commTopo.byId.get(id)
    const src = p ?? c
    nodes.push({
      id, lane: 'execution', localKey: t?.localKey, text: src.text,
      rank: t?.rank, order: t?.order ?? 0, progress: src.progress,
      executionDisplay: t?.executionDisplay, prerequisiteStatus: t?.prerequisiteStatus,
      state,
    })
  }

  /* --- candidate 泳道节点（D10：无 rank / 无 localKey / 无 executionDisplay） --- */
  const commPending = new Map(committed.filter(isPending).map((i) => [i.id, i]))
  const projPending = new Map(projected.filter(isPending).map((i) => [i.id, i]))
  const executionIds = new Set(nodes.map((n) => n.id))
  const referencedBy = new Set()
  for (const item of projPending.values()) for (const r of item.proposedRequires || []) referencedBy.add(r)
  const nextOrder = () => nodes.filter((n) => n.lane === 'candidate').length
  for (const [id, item] of projPending) {
    if (!(item.proposedRequires || []).length && !referencedBy.has(id)) continue // 孤立 pending 不进图
    const targets = (item.proposedRequires || []).map((t) => projTopo.byId.get(t)?.rank).filter((r) => r !== undefined)
    nodes.push({
      id, lane: 'candidate', localKey: undefined, text: item.text, rank: undefined, order: nextOrder(),
      groupRank: targets.length ? Math.max(...targets) : Number.MAX_SAFE_INTEGER,
      executionDisplay: undefined, prerequisiteStatus: undefined,
      state: commPending.has(id) ? 'unchanged' : 'staged-added',
    })
  }
  for (const [id, item] of commPending) {
    if (projPending.has(id) || executionIds.has(id)) continue // 被接受的提案已进入 execution 泳道
    nodes.push({
      id, lane: 'candidate', localKey: undefined, text: item.text, rank: undefined, order: nextOrder(),
      groupRank: Number.MAX_SAFE_INTEGER, executionDisplay: undefined, prerequisiteStatus: undefined,
      state: 'staged-removed',
    })
  }

  /* --- requires 边：三态由差集推导 --- */
  const edges = []
  const commPairs = new Set()
  for (const item of commActive) for (const from of item.requires || []) commPairs.add(`${from}→${item.id}`)
  const projPairs = new Set()
  for (const item of projActive) for (const from of item.requires || []) projPairs.add(`${from}→${item.id}`)
  for (const key of new Set([...commPairs, ...projPairs])) {
    const [from, to] = key.split('→')
    const inComm = commPairs.has(key)
    const inProj = projPairs.has(key)
    edges.push({
      from, to, kind: 'requires', editable: true,
      state: inComm && inProj ? 'committed' : inProj ? 'staged-added' : 'staged-removed',
    })
  }

  /* --- proposed 边：候选边只读但可导航（D9） --- */
  for (const item of projPending.values()) {
    for (const from of item.proposedRequires || []) {
      edges.push({ from, to: item.id, kind: 'proposed', state: 'committed', editable: false, targetProposalId: item.id })
    }
  }

  /* --- history 泳道 + supersedes 边（§10.1，D11：v1 一体实现） ---
   * 关系对 (old → new) 由两侧 item 的 supersedes / supersededBy 共同收集；
   * 幽灵节点 = 关系端点中"两侧都 inactive 且不在 visible 集合"的那些。
   * 本次 staged 的替代两端都在执行泳道（staged-removed / staged-added），因此不会成为幽灵。
   */
  const commAll = new Map(committed.map((i) => [i.id, i]))
  const projAll = new Map(projected.map((i) => [i.id, i]))
  const commActiveIds = new Set(commActive.map((i) => i.id))
  const projActiveIds = new Set(projActive.map((i) => i.id))
  const pairsOf = (items) => {
    const out = new Set()
    for (const i of items) {
      if (i.supersedes) out.add(`${i.supersedes}→${i.id}`)
      if (i.supersededBy) out.add(`${i.id}→${i.supersededBy}`)
    }
    return out
  }
  const commSupPairs = pairsOf(committed)
  const projSupPairs = pairsOf(projected)
  const supPairs = new Set([...commSupPairs, ...projSupPairs])
  const visibleIds = new Set(nodes.map((n) => n.id))

  if (showSupersedes) {
    const endpointIds = new Set()
    for (const key of supPairs) {
      const [from, to] = key.split('→')
      endpointIds.add(from)
      endpointIds.add(to)
    }
    const ghostIds = [...endpointIds]
      .filter((id) => !visibleIds.has(id))                 // ② 已在执行/候选泳道则不重复
      .filter((id) => !commActiveIds.has(id) && !projActiveIds.has(id))  // ① 两侧都 inactive
      .filter((id) => commAll.has(id) || projAll.has(id))  // 悬空引用：忽略而不崩溃
      .sort()                                              // 确定性：与 Map/Set 迭代序无关
    ghostIds.forEach((id, i) => {
      const item = projAll.get(id) ?? commAll.get(id)
      nodes.push({
        id, lane: 'history', ghost: true, localKey: undefined, text: item.text,
        rank: undefined, order: i, executionDisplay: undefined, prerequisiteStatus: undefined,
        state: 'unchanged',
      })
      visibleIds.add(id)
    })
  }

  for (const key of [...supPairs].sort()) {
    if (!showSupersedes) break
    const [from, to] = key.split('→')
    if (!visibleIds.has(from) || !visibleIds.has(to)) continue   // 端点不在集合内（含悬空引用）
    const inComm = commSupPairs.has(key)
    const inProj = projSupPairs.has(key)
    edges.push({
      from, to, kind: 'supersedes', editable: false,
      state: inComm && inProj ? 'committed' : inProj ? 'staged-added' : 'staged-removed',
    })
  }

  return {
    nodes, edges,
    navigables: nodes.length + edges.length,
    topoOrder: projTopo.ordered,
    committedTopoOrder: commTopo.ordered,
  }
}

/* ---------- D18 默认焦点规则 ---------- */
export function defaultFocus(model) {
  const exec = model.nodes.filter((n) => n.lane === 'execution')
  const byRankOrder = (arr) => arr.slice().sort((a, b) => ((a.rank ?? 999) - (b.rank ?? 999))
    || ((a.order ?? 0) - (b.order ?? 0)) || a.id.localeCompare(b.id))
  if (!exec.length) {
    const cand = model.nodes.filter((n) => n.lane === 'candidate')
    if (cand.length) return byRankOrder(cand)[0].id
    const hist = model.nodes.filter((n) => n.lane === 'history')
    return hist.length ? byRankOrder(hist)[0].id : undefined
  }
  // executionDisplay 会把冲突掩盖成 in-progress/blocked（core 的 UI 组合规则），
  // 因此必须依据 prerequisiteStatus 选择默认焦点。
  const conflict = byRankOrder(exec.filter((n) => n.prerequisiteStatus === 'dependency-conflict'
    || n.executionDisplay === 'dependency-conflict'))
  if (conflict.length) return conflict[0].id
  const waiting = byRankOrder(exec.filter((n) => n.executionDisplay === 'waiting'))
  if (waiting.length) return waiting[0].id
  return byRankOrder(exec)[0].id
}

/* ---------- 行数纯函数（§3.7；不做运行时测量） ---------- */
export function labelLines(text) {
  let weight = 0
  for (const ch of text) weight += /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/u.test(ch) ? 1 : 0.5
  return weight <= C.LINE_CAPACITY ? 1 : 2
}

/* ---------- 几何层：layoutRelationGraph（输出无量纲 em 倍数） ---------- */
export function layoutGraph(model, options = {}) {
  const depth = options.depth || 1
  const focusId = options.focusId !== undefined ? options.focusId : defaultFocus(model)

  // ego 裁剪（D2：永远是 ego 图，不存在全图模式）
  let visible = model.nodes
  let visibleEdges = model.edges
  if (focusId !== undefined) {
    const keep = new Set([focusId])
    let frontier = [focusId]
    for (let d = 0; d < depth; d += 1) {
      const next = []
      for (const id of frontier) {
        for (const e of model.edges) {
          if (e.from === id && !keep.has(e.to)) { keep.add(e.to); next.push(e.to) }
          if (e.to === id && !keep.has(e.from)) { keep.add(e.from); next.push(e.from) }
        }
      }
      frontier = next
    }
    visible = model.nodes.filter((n) => keep.has(n.id))
    visibleEdges = model.edges.filter((e) => keep.has(e.from) && keep.has(e.to))
  }

  // D5 三级降级（§3.5）：① 关 history 泳道 → ② 锁深度 1 → ③ 隐藏图形区
  if (options.supersedesHidden === true) {
    visible = visible.filter((n) => n.lane !== 'history')
    visibleEdges = visibleEdges.filter((e) => e.kind !== 'supersedes')
  }
  const navigables = visible.length + visibleEdges.length
  const hasHistory = visible.some((n) => n.lane === 'history')
  if (navigables > C.NAV_THRESHOLD && hasHistory && options.supersedesHidden !== true) {
    const inner = layoutGraph(model, { ...options, supersedesHidden: true })
    return { ...inner, degraded: { ...inner.degraded, supersedesHidden: true } }
  }
  if (navigables > C.NAV_THRESHOLD && depth > 1) {
    const inner = layoutGraph(model, { ...options, depth: 1 })
    return { ...inner, degraded: { ...inner.degraded, depthReduced: true } }
  }
  if (navigables > C.NAV_THRESHOLD) {
    return {
      nodes: [], edges: [], width: 0, height: 0, traversal: [], navigables,
      degraded: { supersedesHidden: options.supersedesHidden === true, depthReduced: false, hidden: true },
    }
  }

  const placed = []
  const rankRows = new Map()
  for (const n of visible.filter((x) => x.lane === 'execution')) {
    if (!rankRows.has(n.rank)) rankRows.set(n.rank, [])
    rankRows.get(n.rank).push(n)
  }
  let maxRows = 1
  for (const rows of rankRows.values()) maxRows = Math.max(maxRows, rows.length)

  const execMaxH = rankRows.size
    ? Math.max(...[...rankRows.values()].flat().map((n) => C.NODE_H_EM[labelLines(n.text)]))
    : C.NODE_H_EM[1]
  const executionHeight = (maxRows - 1) * C.ROW_PITCH_EM + execMaxH + C.CANDIDATE_GAP_EM

  const sortedRanks = [...rankRows.keys()].sort((a, b) => a - b)
  // ego 裁剪后必须重新基准化 rank，否则画布左侧留出大片空白
  const minRank = sortedRanks.length ? sortedRanks[0] : 0
  const maxCol = sortedRanks.length ? sortedRanks[sortedRanks.length - 1] - minRank : -1

  for (const rank of sortedRanks) {
    const rows = rankRows.get(rank).sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
    rows.forEach((n, i) => {
      const lines = labelLines(n.text)
      placed.push({
        ...n,
        col: rank - minRank,
        x: (rank - minRank) * C.RANK_PITCH_EM,
        y: i * C.ROW_PITCH_EM,
        w: C.NODE_W_EM,
        h: C.NODE_H_EM[lines],
        labelLines: lines,
      })
    })
  }

  // 候选泳道：按"基准化后的列"分组堆叠（按 groupRank 分组会在裁剪后重叠）
  const cand = visible.filter((x) => x.lane === 'candidate')
  const candCols = new Map()
  for (const n of cand) {
    const col = n.groupRank === Number.MAX_SAFE_INTEGER ? maxCol + 1 : Math.max(0, n.groupRank - minRank)
    if (!candCols.has(col)) candCols.set(col, [])
    candCols.get(col).push(n)
  }
  for (const [col, rows] of candCols) {
    rows.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
    rows.forEach((n, i) => {
      const lines = labelLines(n.text)
      placed.push({
        ...n,
        col,
        x: col * C.RANK_PITCH_EM,
        y: executionHeight + i * C.ROW_PITCH_EM, // executionHeight 已含 CANDIDATE_GAP_EM
        w: C.NODE_W_EM,
        h: C.NODE_H_EM[lines],
        labelLines: lines,
      })
    })
  }

  /* history 泳道：第三条带。列 = 沿 supersedes 链（visited 保护）能到达的最近执行节点列，
   * 无 active 对端时取 0；带内按 canonical order 堆叠。空带不占高度。 */
  const hist = visible.filter((x) => x.lane === 'history')
  let historyTop = 0
  if (hist.length) {
    const colById = new Map(placed.filter((n) => n.lane !== 'history').map((n) => [n.id, n.col]))
    const supEdges = visibleEdges.filter((e) => e.kind === 'supersedes')
    const colOf = (id) => {
      const seen = new Set([id])
      const queue = [id]
      while (queue.length) {
        const cur = queue.shift()
        for (const e of supEdges) {
          const next = e.from === cur ? e.to : e.to === cur ? e.from : undefined
          if (next === undefined || seen.has(next)) continue
          if (colById.has(next)) return colById.get(next)
          seen.add(next)
          queue.push(next)
        }
      }
      return 0     // 整条链都 inactive，或数据成环：确定性兜底
    }
    const candPlaced = placed.filter((n) => n.lane === 'candidate')
    historyTop = candPlaced.length
      ? Math.max(...candPlaced.map((n) => n.y + n.h)) + C.HISTORY_GAP_EM
      : executionHeight
    const histCols = new Map()
    for (const n of hist) {
      const col = colOf(n.id)
      if (!histCols.has(col)) histCols.set(col, [])
      histCols.get(col).push(n)
    }
    for (const [col, rows] of histCols) {
      rows.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
      rows.forEach((n, i) => {
        const lines = labelLines(n.text)
        placed.push({
          ...n,
          col,
          x: col * C.RANK_PITCH_EM,
          y: historyTop + i * C.ROW_PITCH_EM,
          w: C.NODE_W_EM,
          h: C.NODE_H_EM[lines],
          labelLines: lines,
        })
      })
    }
  }

  const byId = new Map(placed.map((n) => [n.id, n]))
  const edges = visibleEdges
    .filter((e) => byId.has(e.from) && byId.has(e.to))
    .map((e) => {
      const a = byId.get(e.from)
      const b = byId.get(e.to)
      const x1 = a.x + a.w
      const y1 = a.y + a.h / 2
      const x2 = b.x
      const y2 = b.y + b.h / 2
      const mx = (x1 + x2) / 2
      return {
        ...e,
        key: `e:${e.from}→${e.to}`,
        path: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
        labelAt: { x: mx, y: (y1 + y2) / 2 - 0.4 },
      }
    })

  /* traversal：拓扑序节点，节点后紧跟其出边（按目标 rank/order），最后候选泳道。
   * 这是 [/] 扁平遍历与 roving tabindex 的唯一顺序来源，必须是纯函数产物。 */
  const traversal = []
  const execNodes = placed.filter((n) => n.lane === 'execution')
    .sort((a, b) => (a.col - b.col) || (a.order - b.order) || a.id.localeCompare(b.id))
  const candNodes = placed.filter((n) => n.lane === 'candidate')
    .sort((a, b) => (a.col - b.col) || (a.order - b.order) || a.id.localeCompare(b.id))
  for (const n of execNodes) {
    traversal.push(n.id)
    edges.filter((e) => e.from === n.id)
      .sort((a, b) => {
        const ta = byId.get(a.to)
        const tb = byId.get(b.to)
        return ((ta.col ?? 999) - (tb.col ?? 999)) || ((ta.order ?? 999) - (tb.order ?? 999))
      })
      .forEach((e) => { if (!traversal.includes(e.key)) traversal.push(e.key) })
  }
  for (const n of candNodes) {
    if (!traversal.includes(n.id)) traversal.push(n.id)
    edges.filter((e) => e.from === n.id || (e.kind === 'proposed' && e.to === n.id))
      .forEach((e) => { if (!traversal.includes(e.key)) traversal.push(e.key) })
  }
  const histNodes = placed.filter((n) => n.lane === 'history')
    .sort((a, b) => (a.col - b.col) || (a.order - b.order) || a.id.localeCompare(b.id))
  for (const n of histNodes) {
    if (!traversal.includes(n.id)) traversal.push(n.id)
    edges.filter((e) => e.from === n.id || (e.kind === 'supersedes' && e.to === n.id))
      .forEach((e) => { if (!traversal.includes(e.key)) traversal.push(e.key) })
  }

  return {
    nodes: placed,
    edges,
    width: Math.max(0, ...placed.map((n) => n.x + n.w)),
    height: Math.max(0, ...placed.map((n) => n.y + n.h)),
    traversal,
    navigables,
    focusId,
    depth,
    degraded: { supersedesHidden: options.supersedesHidden === true, depthReduced: false, hidden: false },
  }
}

/* ---------- 键盘模型（§3.5）
 * ←/→ 只沿 requires 边（执行语义）；[/] 沿扁平 traversal（到达候选节点/候选边/替代边）。
 */
export function arrowTarget(layout, currentKey, key) {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  const edgeByKey = new Map(layout.edges.map((e) => [e.key, e]))
  const idx = layout.traversal.indexOf(currentKey)
  if (idx < 0) return null

  if (key === 'Home') return layout.traversal[0]
  if (key === 'End') return layout.traversal[layout.traversal.length - 1]
  if (key === 'BracketRight' || key === 'PageDown') return layout.traversal[(idx + 1) % layout.traversal.length]
  if (key === 'BracketLeft' || key === 'PageUp') {
    return layout.traversal[(idx - 1 + layout.traversal.length) % layout.traversal.length]
  }

  const isEdge = currentKey.startsWith('e:')
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    if (isEdge) {
      const e = edgeByKey.get(currentKey)
      // §3.5：←/→ 只沿 requires 边；候选边与替代边只能由 [/] 到达
      if (!e || e.kind !== 'requires') return null
      return key === 'ArrowRight' ? e.to : e.from
    }
    const node = byId.get(currentKey)
    if (!node) return null
    const wanted = (key === 'ArrowRight'
      ? layout.edges.filter((e) => e.kind === 'requires' && e.from === currentKey).map((e) => byId.get(e.to))
      : layout.edges.filter((e) => e.kind === 'requires' && e.to === currentKey).map((e) => byId.get(e.from))
    ).filter(Boolean)
    if (!wanted.length) return null
    const sorted = wanted.slice().sort((a, b) => {
      const ra = a.rank ?? a.col ?? 999
      const rb = b.rank ?? b.col ?? 999
      return (ra - rb) || ((a.order ?? 0) - (b.order ?? 0)) || a.id.localeCompare(b.id)
    })
    const col = (n) => n.col ?? n.rank ?? 999
    const curCol = col(node)
    const curOrder = node.order ?? 0
    if (key === 'ArrowRight') {
      const after = sorted.filter((c) => col(c) > curCol || (col(c) === curCol && (c.order ?? 0) > curOrder))
      return (after.length ? after[0] : sorted[0]).id
    }
    const before = sorted.filter((c) => col(c) < curCol || (col(c) === curCol && (c.order ?? 0) < curOrder)).reverse()
    return (before.length ? before[0] : sorted[sorted.length - 1]).id
  }

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const node = byId.get(isEdge ? edgeByKey.get(currentKey)?.to : currentKey)
    if (!node) return null
    const sameLane = layout.nodes
      .filter((n) => n.lane === node.lane
        && (node.lane === 'execution' ? n.col === node.col : n.col === node.col))
      .sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)) || a.id.localeCompare(b.id))
    if (sameLane.length < 2) return null
    const i = sameLane.findIndex((n) => n.id === node.id)
    const next = key === 'ArrowDown'
      ? sameLane[(i + 1) % sameLane.length]
      : sameLane[(i - 1 + sameLane.length) % sameLane.length]
    return next.id
  }
  return null
}

/* ---------- 几何自检：节点包围盒不得重叠 ---------- */
export function checkOverlap(layout) {
  const bad = []
  const ns = layout.nodes
  for (let i = 0; i < ns.length; i += 1) {
    for (let j = i + 1; j < ns.length; j += 1) {
      const a = ns[i]
      const b = ns[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        bad.push(`${a.id}(${a.x},${a.y},${a.w}x${a.h}) ↔ ${b.id}(${b.x},${b.y},${b.w}x${b.h})`)
      }
    }
  }
  return bad
}

export function determinismCheck(scenario) {
  const model = buildModel(scenario)
  const a = JSON.stringify(layoutGraph(model, { depth: 2 }))
  const b = JSON.stringify(layoutGraph(model, { depth: 2 }))
  return { identical: a === b, bytes: a.length }
}

/* 便于浏览器控制台与 classic script 场景取用 */
globalThis.W0 = {
  C, defaultScenario, acceptScenario, hubScenario, chainScenario,
  supersedeScenario, revokeScenario, inconsistentSupersedeScenario, supersedeDenseScenario,
  buildModel, layoutGraph, arrowTarget, labelLines, checkOverlap, defaultFocus,
  prerequisiteStatus, executionDisplay, determinismCheck,
}
