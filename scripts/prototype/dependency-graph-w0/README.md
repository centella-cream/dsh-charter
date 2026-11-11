# W0 原型 — 依赖关系图形视图

设计稿：[`docs/design/charter-dependency-graph-v1.zh.md`](../../../docs/design/charter-dependency-graph-v1.zh.md)
（状态 `Proposed`，未实现、非权威）。

本目录是**一次性验证原型**，不是产品代码：

- 不在 `package.json` 的 `files` 白名单内 → 不进 npm tarball；
- 不在 `tsconfig.json` 的 `include` 内 → 不参与 typecheck/build；
- 不在 vitest 的 `include`（`tests/**/*.spec.{ts,tsx}`）内 → 不进测试套件与测试计数；
- 放在受版本控制的目录（而不是 `.tmp/`），是为了让 W0 结论**可复现**：`.tmp/` 是易失的本地暂存区。

## 跑 W0-0（纯函数契约，无需浏览器）

```bash
node scripts/prototype/dependency-graph-w0/verify.mjs
```

41 项断言，覆盖设计稿中所有可脱离 DOM 判定的条款：§3.7 几何不变式与零重叠、§3.3 布局确定性、
三态差集与"提升"规则、§3.5 键盘目标解析（`←/→` 只沿 requires、`[`/`]` 覆盖率、`↑/↓` 不跨列）、
D5 **三级**降级（关 history 带 → 锁深度 → 隐藏）、D10 候选泳道语义、D13 三态、D18 默认焦点、D2 ego 裁剪，
以及 §10.1 的替代边与 history 泳道（幽灵节点只读、staged 替代不生成幽灵、链式替代同列、成环/悬空不崩溃）。
失败时退出码非 0。

## 跑 W0-1 / W0-2 / W0-3（需真实浏览器）

```bash
python3 -m http.server 8124 --directory scripts/prototype/dependency-graph-w0
# 打开 http://127.0.0.1:8124/index.html
```

页面每节自带 `[PASS]/[FAIL]` 报告，汇总结果也在 `window.__W0__`（控制台可直接复制 JSON）：

| 节 | 验证内容 |
| --- | --- |
| W0-1 | 860/900/1000/1100/1200px 下"图形区 + 常驻列表"两栏可用性，输出建议断点 |
| W0-2 | 100%/150%/200% 文本缩放下：`labelLines` 纯函数 vs 真实渲染行数、标签溢出、SVG↔标签层对齐、渲染后重叠、触控高度 |
| W0-3 | 复合控件 DOM 合同：图形区 Tab 停靠数、skip 链接到列表的 Tab 次数、roving tabindex 唯一性、遍历覆盖率、`←/→` 语义、`Esc` 出口、SVG `<g>` 可聚焦性 |

页尾「人工验证清单」6 条（真实文本缩放、forced colors、reduced motion、屏幕阅读器播报、触屏命中区、
缩放+窄容器组合）**只能人工做**，原型不替代。

## 文件

| 文件 | 作用 |
| --- | --- |
| `w0-engine.js` | 语义层 `buildModel`（committed ↔ projected 差集 → 三态）+ 几何层 `layoutGraph`（em、确定性）+ 键盘模型 `arrowTarget` + `checkOverlap`。浏览器与 Node 双用 |
| `verify.mjs` | W0-0 验收脚本（Node） |
| `index.html` | W0-1/2/3 页面结构与样式（token、em 几何、forced-colors、reduced-motion） |
| `w0-page.js` | W0-1/2/3 的渲染与自检逻辑 |

## 实测结论写回哪里

结果写回设计稿 §3.10，并据此定稿 D5 阈值、§3.7 几何常量、§3.1 断点。
原型本身不是交付物，W1 会用 TypeScript 重写并纳入 `tests/`。
