/* W0-1 / W0-2 / W0-3 浏览器实测：渲染 + 自检。
 * 只负责必须真实浏览器才能测的部分；纯函数契约见 verify.mjs。
 */
import {
  C, buildModel, layoutGraph, arrowTarget, labelLines, checkOverlap, defaultFocus, defaultScenario,
} from './w0-engine.js'

const results = (window.__W0__ = { w1: null, w2: null, w3: null })
const model = buildModel(defaultScenario())
const baseLayout = layoutGraph(model, { depth: 2 })

/* ---------- 小工具 ---------- */
const el = (tag, attrs, kids) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') n.className = v
    else if (k === 'text') n.textContent = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null) n.setAttribute(k, v)
  }
  for (const c of [].concat(kids || [])) if (c) n.appendChild(c)
  return n
}
const line = (ok, label, detail) => `${ok ? '[PASS]' : '[FAIL]'} ${label}${detail ? ` — ${detail}` : ''}`
const bar = (hostId, label, options, current, onPick) => {
  const host = document.getElementById(hostId)
  host.innerHTML = ''
  host.appendChild(el('span', { text: `${label}：`, style: 'color:#777' }))
  for (const o of options) {
    host.appendChild(el('button', {
      type: 'button', text: o.label, 'aria-pressed': String(o.value === current),
      onclick: () => onPick(o.value),
    }))
  }
}

/* ---------- 语义列表（权威操作面，始终存在） ---------- */
function buildList() {
  const ul = el('ul', { class: 'dep-list' })
  const byId = new Map(model.nodes.map((n) => [n.id, n]))
  for (const n of model.nodes.filter((x) => x.lane === 'execution')) {
    const requires = model.edges
      .filter((e) => e.kind === 'requires' && e.to === n.id && e.state !== 'staged-removed')
      .map((e) => byId.get(e.from)?.localKey)
      .filter(Boolean)
    const conflict = n.prerequisiteStatus === 'dependency-conflict'
    const sel = el('select', {
      class: 'dep__select', multiple: 'multiple', size: '3', 'aria-label': `${n.localKey} 的前置交付物`,
    }, model.nodes.filter((x) => x.lane === 'execution' && x.id !== n.id)
      .map((x) => el('option', { value: x.id, text: `${x.localKey} ${x.text}` })))
    for (const key of requires) {
      const target = model.nodes.find((x) => x.localKey === key)
      const opt = target && sel.querySelector(`option[value="${target.id}"]`)
      if (opt) opt.selected = true
    }
    ul.appendChild(el('li', { class: `dep${conflict ? ' is-dependency-conflict' : ''}` }, [
      el('span', { class: 'dep__key', text: n.localKey }),
      el('span', { class: 'dep__text', text: n.text }),
      el('span', {
        class: 'dep__status',
        text: n.executionDisplay + (conflict && n.executionDisplay !== 'dependency-conflict' ? ' · 前置冲突' : ''),
      }),
      el('span', { class: 'dep__requires', text: requires.length ? `依赖 ${requires.join(', ')}` : '依赖 —' }),
      sel,
    ]))
  }
  return ul
}

/* ---------- 图形部件：SVG 画几何 + HTML 承载文本（单一 transform 容器） ---------- */
function buildGraphWidget(layout, opts = {}) {
  const U = 16 // 渲染层把无量纲 layout units 乘以 1em
  const wrap = el('div', { class: 'graphwrap', id: `${opts.prefix}-wrap` })
  const tr = el('div', { class: 'graphtransform', id: `${opts.prefix}-tr`, style: `width:${(layout.width + 2) * U}px;height:${(layout.height + 2) * U}px` })
  const svgNS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNS, 'svg')
  svg.setAttribute('width', (layout.width + 2) * U)
  svg.setAttribute('height', (layout.height + 2) * U)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const labels = el('div', { style: 'position:absolute;left:0;top:0;width:100%;height:100%' })
  const byId = new Map(layout.nodes.map((n) => [n.id, n]))

  for (const e of layout.edges) {
    const a = byId.get(e.from)
    const b = byId.get(e.to)
    if (!a || !b) continue
    const g = document.createElementNS(svgNS, 'g')
    g.setAttribute('data-nav', e.key)
    const staged = e.kind === 'supersedes'
      ? (e.state === 'staged-added' ? '（本次替代）' : e.state === 'staged-removed' ? '（本次撤销替代）' : '')
      : (e.state === 'staged-added' ? '（本次新增）' : e.state === 'staged-removed' ? '（本次删除）' : '')
    const aria = e.kind === 'proposed'
      ? `${b.text} 的候选前置 ${a.text}，回车查看提案`
      : e.kind === 'supersedes'
        ? `${a.text} 被 ${b.text} 替代${staged}`
        : `${b.text} 依赖 ${a.text}${staged}`
    if (!opts.compact) {
      g.setAttribute('role', e.kind === 'proposed' ? 'link' : 'button')
      g.setAttribute('tabindex', '-1')
      g.setAttribute('aria-label', aria)
    }
    const hit = document.createElementNS(svgNS, 'path')
    hit.setAttribute('d', e.path); hit.setAttribute('class', 'edge-hit')
    const p = document.createElementNS(svgNS, 'path')
    p.setAttribute('d', e.path); p.setAttribute('class', 'edge')
    p.setAttribute('data-kind', e.kind); p.setAttribute('data-state', e.state)
    g.append(hit, p)
    svg.appendChild(g)
  }

  for (const n of layout.nodes) {
    if (!opts.compact) {
      const r = document.createElementNS(svgNS, 'rect')
      r.setAttribute('x', n.x * U); r.setAttribute('y', n.y * U)
      r.setAttribute('width', n.w * U); r.setAttribute('height', Math.max(n.h * U, C.MIN_TOUCH_PX))
      r.setAttribute('rx', 7); r.setAttribute('fill', 'transparent'); r.setAttribute('stroke', 'transparent')
      r.setAttribute('data-box', n.id)
      svg.appendChild(r)
    }
    const name = n.lane === 'execution'
      ? `${n.localKey} · ${n.text} · ${n.executionDisplay}`
      : n.lane === 'history'
        ? `已替代 · ${n.text} · 不在执行序`
        : `候选提案 · ${n.text} · 未进入执行序`
    const box = el('div', {
      class: 'nlabel',
      'data-nav': n.id, 'data-node-box': n.id,
      'data-state': n.lane === 'execution' ? n.executionDisplay : n.lane === 'history' ? 'history' : 'candidate',
      'data-lane': n.lane, 'data-staged': n.state,
      style: `left:${n.x * U}px;top:${n.y * U}px;width:${n.w * U}px;min-height:${Math.max(n.h * U, C.MIN_TOUCH_PX)}px`,
    }, [
      el('span', { class: 'k', text: n.lane === 'execution' ? n.localKey : n.lane === 'history' ? '已替代' : '候选' }),
      el('span', { class: 't', text: n.text }),
      el('span', {
        class: 's',
        text: n.lane === 'execution'
          ? n.executionDisplay + (n.prerequisiteStatus === 'dependency-conflict' && n.executionDisplay !== 'dependency-conflict' ? ' · 前置冲突' : '')
          : n.lane === 'history' ? '不在执行序' : '未进入执行序',
      }),
    ])
    if (!opts.compact) {
      box.setAttribute('role', 'button')
      box.setAttribute('tabindex', '-1')
      box.setAttribute('aria-label', name)
    }
    labels.appendChild(box)
  }
  tr.append(svg, labels)
  wrap.appendChild(tr)
  return wrap
}

/* =====================================================================
 * W0-1 两栏可用性
 * ===================================================================== */
function renderTwoCol(widthPx) {
  const host = document.getElementById('w1host')
  host.innerHTML = ''
  const shell = el('div', { style: `width:${widthPx}px;max-width:100%` })
  const card = el('div', { class: 'card' })
  const two = el('div', { class: 'twocol' })
  const graph = el('div', {})
  graph.appendChild(buildGraphWidget(layoutGraph(model, { depth: 1 }), { compact: true, prefix: 'w1' }))
  const list = el('div', {})
  list.appendChild(buildList())
  two.append(graph, list)
  card.appendChild(two)
  shell.appendChild(card)
  host.appendChild(shell)
  return { two, graph, list }
}

function runW1() {
  const widths = [860, 900, 1000, 1100, 1200]
  const rows = []
  let recommended = null
  const rootFs = parseFloat(getComputedStyle(document.body).fontSize)
  for (const w of widths) {
    const { graph, list } = renderTwoCol(w)
    const listRect = list.getBoundingClientRect()
    const graphRect = graph.getBoundingClientRect()
    const listScrollOverflow = list.scrollWidth - list.clientWidth
    const rowOverflow = [...list.querySelectorAll('.dep')].filter((r) => r.scrollWidth - r.clientWidth > 1).length
    const sel = list.querySelector('.dep__select')
    const selH = sel ? sel.getBoundingClientRect().height : 0
    const ok = listScrollOverflow <= 1 && rowOverflow === 0
      && listRect.width >= 20 * rootFs && selH >= C.MIN_TOUCH_PX && graphRect.width >= 20 * rootFs
    if (ok && recommended === null) recommended = w
    rows.push({
      width: w, ok, listPx: Math.round(listRect.width), listEm: +(listRect.width / rootFs).toFixed(2),
      graphPx: Math.round(graphRect.width), listScrollOverflow, rowOverflow, selectHeightPx: Math.round(selH),
    })
  }
  results.w1 = { rows, recommendedBreakpoint: recommended, rootFontSize: rootFs, minListEm: 20 }
  document.getElementById('w1report').textContent = [
    `根字号 ${rootFs}px；列表最小可用宽度要求 20em = ${Math.round(20 * rootFs)}px；触控下限 ${C.MIN_TOUCH_PX}px`,
    '',
    '宽度    结果  列表宽           图形宽   列表横向溢出  溢出行  select高',
    ...rows.map((r) => `${String(r.width).padEnd(7)} ${r.ok ? 'PASS ' : 'FAIL '} ${`${r.listPx}px/${r.listEm}em`.padEnd(16)} ${`${r.graphPx}px`.padEnd(8)} ${String(r.listScrollOverflow).padEnd(13)} ${String(r.rowOverflow).padEnd(7)} ${r.selectHeightPx}px`),
    '',
    recommended === null
      ? line(false, '没有任何测试宽度同时满足全部条件', '回退顺序：压缩列表行 → 上下堆叠 → 降低图形区权重（§0.2）')
      : line(true, '建议断点', `容器 ≥ ${recommended}px 用两栏；低于该值改上下堆叠`),
  ].join('\n')
  renderTwoCol(recommended || 1100)
}

/* =====================================================================
 * W0-2 缩放 / 溢出 / 两层对齐
 * ===================================================================== */
function runW2(zoom) {
  const host = document.getElementById('w2host')
  host.innerHTML = ''
  host.style.fontSize = `${16 * zoom}px` // em 几何随根字号同比放大
  const layout = layoutGraph(model, { depth: 2 })
  host.appendChild(buildGraphWidget(layout, { prefix: 'w2' }))

  const probe = document.getElementById('probe')
  probe.style.width = `${(C.NODE_W_EM - 2 * C.NODE_PADDING_EM) * 16 * zoom}px`
  probe.style.fontSize = `${C.SUMMARY_EM * 16 * zoom}px`
  probe.style.lineHeight = '1.5'
  probe.style.whiteSpace = 'normal'
  probe.style.fontFamily = getComputedStyle(document.body).fontFamily

  const actualLines = (text) => {
    probe.textContent = text
    const lh = parseFloat(getComputedStyle(probe).lineHeight)
    return Math.max(1, Math.round(probe.getBoundingClientRect().height / lh))
  }

  const mismatch = []
  const overflow = []
  const misaligned = []
  const overlap = []
  const touch = []
  const boxes = []
  for (const n of layout.nodes) {
    const label = host.querySelector(`[data-node-box="${n.id}"]`)
    const expected = labelLines(n.text)
    const actual = actualLines(n.text)
    if (actual !== expected) mismatch.push(`${n.id}: 纯函数 ${expected} 行 / 实测 ${actual} 行`)
    if (label.scrollHeight - label.clientHeight > 1) overflow.push(`${n.id}: scrollH ${label.scrollHeight} > clientH ${label.clientHeight}`)
    const lr = label.getBoundingClientRect()
    boxes.push({ id: n.id, x: lr.left, y: lr.top, w: lr.width, h: lr.height })
    if (lr.height < C.MIN_TOUCH_PX * zoom - 0.5) touch.push(`${n.id}: 高 ${lr.height.toFixed(1)}px < ${C.MIN_TOUCH_PX * zoom}px`)
    const rect = host.querySelector(`svg rect[data-box="${n.id}"]`)
    if (rect) {
      const rr = rect.getBoundingClientRect()
      const d = Math.max(Math.abs(rr.left - lr.left), Math.abs(rr.top - lr.top), Math.abs(rr.width - lr.width), Math.abs(rr.height - lr.height))
      if (d > 1.5) misaligned.push(`${n.id}: SVG↔标签层偏差 ${d.toFixed(2)}px`)
    }
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]; const b = boxes[j]
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap.push(`${a.id} ↔ ${b.id}`)
    }
  }
  results.w2 = { zoom, mismatch, overflow, misaligned, overlap, touch, engineOverlap: checkOverlap(layout) }
  document.getElementById('w2report').textContent = [
    `文本缩放 ${Math.round(zoom * 100)}%（图形区根字号 ${(16 * zoom).toFixed(1)}px；LINE_CAPACITY=${C.LINE_CAPACITY}）`,
    line(mismatch.length === 0, 'labelLines 纯函数与真实渲染行数一致', mismatch.join(' | ') || `${layout.nodes.length} 个节点全部一致`),
    line(overflow.length === 0, '标签未溢出节点盒（2 行夹取生效）', overflow.join(' | ') || '无溢出'),
    line(misaligned.length === 0, 'SVG 节点框与 HTML 标签层对齐（单一 transform）', misaligned.join(' | ') || '偏差 ≤1.5px'),
    line(overlap.length === 0 && results.w2.engineOverlap.length === 0, '渲染后节点无重叠',
      overlap.concat(results.w2.engineOverlap).join(' | ') || '无重叠'),
    line(touch.length === 0, `节点高度 ≥ ${C.MIN_TOUCH_PX}px（按缩放折算）`, touch.join(' | ') || '全部达标'),
    '',
    '注：本节用"放大根字号"模拟文本缩放。真实浏览器 200% 缩放还会影响 px 边框与 min-height，',
    '    需按页尾人工清单第 1 条复验；forced colors / reduced motion / 屏幕阅读器同样只能人工验。',
  ].join('\n')
}

/* =====================================================================
 * W0-3 复合控件键盘模型
 * ===================================================================== */
const KEYMAP = {
  '[': 'BracketRight', ']': 'BracketLeft', PageDown: 'PageDown', PageUp: 'PageUp',
  ArrowRight: 'ArrowRight', ArrowLeft: 'ArrowLeft', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown',
  Home: 'Home', End: 'End',
}

function buildComposite(layout) {
  const card = document.getElementById('w3card')
  card.innerHTML = ''
  const skip = el('a', { class: 'skip', href: '#w3list', id: 'w3skip', text: '跳到依赖列表' })
  const keyhelp = el('p', {
    class: 'keyhelp', id: 'w3keyhelp',
    text: '图形区键位：← → 沿依赖边；↑ ↓ 同层；[ ] 遍历全部（含候选节点与候选边）；Home/End 首末；Enter 详情；Delete 删除依赖边；Esc 退出到"跳到依赖列表"。',
  })
  const live = el('div', { class: 'sr-live', 'aria-live': 'polite', id: 'w3live' })
  const group = el('div', {
    role: 'group', 'aria-label': '依赖关系图', 'aria-describedby': 'w3keyhelp', tabindex: '0', id: 'w3group',
  })
  group.appendChild(buildGraphWidget(layout, { prefix: 'w3' }))
  const listWrap = el('div', { id: 'w3list', tabindex: '-1' })
  listWrap.appendChild(buildList())
  card.append(skip, keyhelp, group, live, listWrap,
    el('div', { class: 'legend', text: '图例：实线=已提交依赖，虚线=候选（随提案接受生效），蓝色=本次新增，红色删除线=本次删除，虚线框=本次修改' }))

  const navs = [...card.querySelectorAll('[data-nav]')]
  let current = defaultFocus(model)
  const setCurrent = (key, announce) => {
    for (const n of navs) {
      const on = n.getAttribute('data-nav') === key
      n.setAttribute('tabindex', on ? '0' : '-1')
      n.classList.toggle('is-current', on)
      if (on && announce) {
        const label = n.getAttribute('aria-label')
        if (label) document.getElementById('w3live').textContent = label
      }
    }
    current = key
  }
  setCurrent(current, false)
  group.addEventListener('focus', () => {
    if (document.activeElement !== group) return
    const target = card.querySelector(`[data-nav="${current}"]`)
    if (target) target.focus()
  })
  group.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); document.getElementById('w3skip').focus(); return }
    if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); return }
    const mapped = KEYMAP[ev.key] || (ev.key === '[' ? 'BracketRight' : ev.key === ']' ? 'BracketLeft' : null)
    if (!mapped) return
    const next = arrowTarget(layout, current, mapped)
    if (next === null) return
    ev.preventDefault()
    setCurrent(next, true)
    card.querySelector(`[data-nav="${next}"]`)?.focus()
  })
  for (const n of navs) n.addEventListener('focus', () => setCurrent(n.getAttribute('data-nav'), false))
  return { card, group, navs, setCurrent, get current() { return current } }
}

function runW3() {
  const layout = layoutGraph(model, { depth: 2 })
  const c = buildComposite(layout)
  const rep = []

  const order = [...c.card.querySelectorAll('a[href], button, select, input, [tabindex]')]
    .filter((n) => !n.disabled && parseInt(n.getAttribute('tabindex') ?? '0', 10) >= 0)
  const skipIdx = order.indexOf(c.card.querySelector('#w3skip'))
  const listIdx = order.findIndex((n) => n.closest('#w3list'))
  const graphStops = order.slice(skipIdx, listIdx).filter((n) => n.closest('#w3group'))
  rep.push(line(graphStops.length === 1, '图形区内 Tab 停靠数 = 1（复合控件）',
    `实测 ${graphStops.length} 个`))
  rep.push(line(listIdx - skipIdx <= 2, '从 skip 链接到语义列表 ≤2 次 Tab', `实测 ${listIdx - skipIdx} 次`))

  const zeros = c.navs.filter((n) => n.getAttribute('tabindex') === '0')
  rep.push(line(zeros.length === 1, 'roving tabindex：图内恒有且仅有 1 个 tabindex=0', `实测 ${zeros.length} 个`))

  const visited = new Set()
  let key = layout.traversal[0]
  for (let i = 0; i < layout.traversal.length * 2; i += 1) {
    visited.add(key)
    const next = arrowTarget(layout, key, 'BracketRight')
    if (next === null || next === key) break
    key = next
  }
  rep.push(line(visited.size === layout.traversal.length, '[/] 遍历覆盖全部可导航元素（含候选边）',
    `${visited.size}/${layout.traversal.length}`))

  const byId = new Map(layout.nodes.map((n) => [n.id, n]))
  const kindOf = (a, b) => (layout.edges.find((e) => e.from === a && e.to === b) || {}).kind
  const bad = []
  for (const n of layout.nodes) {
    const r = arrowTarget(layout, n.id, 'ArrowRight')
    if (r && kindOf(n.id, r) !== 'requires') bad.push(`${n.id}→${r}`)
    const l = arrowTarget(layout, n.id, 'ArrowLeft')
    if (l && kindOf(l, n.id) !== 'requires') bad.push(`${n.id}←${l}`)
  }
  rep.push(line(bad.length === 0, '←/→ 只沿 requires 边', bad.join(' | ') || '全部正确'))

  const candEdgeEl = c.card.querySelector(`[data-nav="${layout.edges.find((e) => e.kind === 'proposed')?.key}"]`)
  rep.push(line(candEdgeEl !== null && layout.traversal.includes(candEdgeEl.getAttribute('data-nav')),
    '候选边在遍历序内（可导航 ≠ 可编辑）', candEdgeEl?.getAttribute('aria-label')?.slice(0, 40) ?? '未找到'))

  const supEdge = layout.edges.find((e) => e.kind === 'supersedes')
  const supEdgeEl = supEdge ? c.card.querySelector(`[data-nav="${supEdge.key}"]`) : null
  rep.push(line(supEdge === undefined || (supEdgeEl !== null && layout.traversal.includes(supEdge.key) && supEdgeEl.getAttribute('role') === 'button'),
    '替代边在遍历序内且只读（§10.1）',
    supEdge === undefined ? '当前 ego 内无替代边' : supEdgeEl?.getAttribute('aria-label')?.slice(0, 40) ?? '未找到'))
  const ghostNodes = layout.nodes.filter((n) => n.lane === 'history')
  const ghostEls = ghostNodes.map((n) => c.card.querySelector(`[data-nav="${n.id}"]`)).filter(Boolean)
  rep.push(line(ghostNodes.every((n) => layout.traversal.includes(n.id)) && ghostEls.length === ghostNodes.length
    && ghostEls.every((el2) => el2.getAttribute('data-lane') === 'history'),
    '幽灵节点可导航且标注为 history 泳道（§10.1）',
    ghostNodes.length ? ghostNodes.map((n) => n.id).join(', ') : '当前 ego 内无幽灵节点'))

  c.group.focus()
  c.card.querySelector(`[data-nav="${c.current}"]`)?.focus()
  c.card.querySelector(`[data-nav="${c.current}"]`)
    ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const escOk = document.activeElement?.id === 'w3skip'
  rep.push(line(escOk, 'Esc 把焦点送到 skip 链接', `当前焦点 ${document.activeElement?.id || document.activeElement?.tagName}`))

  const edgeEl = c.card.querySelector('[data-nav^="e:"]')
  edgeEl?.focus()
  const svgFocus = document.activeElement === edgeEl
  rep.push(line(svgFocus, 'SVG 内 <g> 可获得 DOM 焦点',
    svgFocus ? '可以' : '不支持：需改用 SVG <a> 或 foreignObject（键位语义不变）'))

  results.w3 = {
    graphTabStops: graphStops.length, skipToList: listIdx - skipIdx, rovingZeros: zeros.length,
    coverage: `${visited.size}/${layout.traversal.length}`, arrowViolations: bad,
    candidateEdgeNavigable: Boolean(candEdgeEl), escOk, svgGroupFocusable: svgFocus,
    supersedesEdgeNavigable: supEdge === undefined ? null : Boolean(supEdgeEl),
    ghostNodes: ghostNodes.map((n) => n.id), ghostNavigable: ghostNodes.every((n) => layout.traversal.includes(n.id)),
    lanes: [...new Set(layout.nodes.map((n) => n.lane))],
    navigables: layout.traversal.length,
  }
  document.getElementById('w3report').textContent = `${rep.join('\n')}\n\n提示：屏幕阅读器播报、真实文本缩放、forced colors 见页尾人工清单。`
  c.setCurrent(defaultFocus(model), false)
}

/* ---------- 运行 ---------- */
const WIDTHS = [860, 900, 1000, 1100, 1200].map((w) => ({ label: `${w}px`, value: w }))
const ZOOMS = [{ label: '100%', value: 1 }, { label: '150%', value: 1.5 }, { label: '200%', value: 2 }]
let w1width = 1100
let w2zoom = 2
const renderW1Bar = () => bar('w1bar', '容器宽度', WIDTHS, w1width, (v) => { w1width = v; renderW1Bar(); runW1(); renderTwoCol(v) })
const renderW2Bar = () => bar('w2bar', '文本缩放', ZOOMS, w2zoom, (v) => { w2zoom = v; renderW2Bar(); runW2(v) })
renderW1Bar()
renderW2Bar()
bar('w3bar', '键盘自检', [{ label: '重新运行', value: 1 }], 1, () => runW3())

runW1()
renderTwoCol(1100)
runW2(1)
runW2(2)
runW3()

results.summary = {
  w1_recommendedBreakpoint: results.w1.recommendedBreakpoint,
  w1_rows: results.w1.rows,
  w2_at200: {
    mismatch: results.w2.mismatch.length, overflow: results.w2.overflow.length,
    misaligned: results.w2.misaligned.length, overlap: results.w2.overlap.length, touch: results.w2.touch.length,
  },
  w3: results.w3,
  constants: { NODE_W_EM: C.NODE_W_EM, RANK_PITCH_EM: C.RANK_PITCH_EM, ROW_PITCH_EM: C.ROW_PITCH_EM, LINE_CAPACITY: C.LINE_CAPACITY, NAV_THRESHOLD: C.NAV_THRESHOLD },
}
console.log('W0 RESULTS', JSON.stringify(results.summary, null, 2))
