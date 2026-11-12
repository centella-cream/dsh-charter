# 0.3.0 视觉语言冻结稿（mockups）

> **状态：** 冻结的视觉权威（0.3.0 GUI 重构，2026-11-12 评审通过，文档感方向）。
> **权威：** 规则条文由 [charter-gui-v1.zh.md](../charter-gui-v1.zh.md) §4.9（视觉语言）与 §5.7（依赖关系图）
> 持有；本目录是视觉基准稿。实现与稿不一致时，要么修实现，要么先修订稿与规则条文，不允许静默漂移。
> **边界：** 纯静态 HTML/CSS 参考稿，不是运行时代码，不进发布包；页面内容全部为合成演示数据。

## 查看方式

任意静态服务器即可（无构建步骤）；每个页面加 `?dark` 切换暗色：

```bash
npx --yes http-server docs/design/mockups -c-1 -p 8321
# http://127.0.0.1:8321/style-tile.html
```

## 文件

| 文件 | 内容 |
| --- | --- |
| `style-tile.html` | 视觉语言总览：字号阶、留白节奏、容器规则、行解剖与对齐、状态 chip、按钮/焦点、空态与 skeleton |
| `mockup-home-clean.html` | Workspace clean 首屏（850px）：页头 + 下划线 tabs + 目标/硬约束/交付物文档流 + 执行路径折叠 |
| `mockup-home-dirty.html` | 脏态（1440px）：吸顶操作条 + 暂存强调行 + Change Set 右栏（margin note 解剖） |
| `mockup-graph.html` | 执行路径展开态（850px）：依赖关系图卡片、节点/边状态语言、inspector、图例 |
| `mockup.css` | 视觉语言参考实现；W6 落地时按此合入 `src/client/charter.css` |
| `tokens.css` | 宿主 token 合约快照，提取自 `@deepseek-ai/dsh-client-ui-theme`（0.2.1-rc.2 全局安装） |

`tokens.css` 仅供 mockup 独立渲染；实现侧的 token 权威是
`scripts/verify/token-coverage.inventory.json` + `token-coverage.mjs` 门禁（覆盖全部声明 DSH 版本）。
