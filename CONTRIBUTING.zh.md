# 为 dsh-charter 贡献

[English](CONTRIBUTING.md) | 中文

感谢你改进 `dsh-charter`。项目刻意保持小而专注；最有价值的贡献是聚焦的 bug 报告、兼容性数据，以及不破坏
设计不变量的改动。

## 开始之前

先阅读[设计规格](docs/design/charter-design-v1.zh.md)，重点确认：

- 用户正文必须保持 **user role**；
- 模型不能获得写能力；
- 一次 Apply 就是一次 storage-domain 单记录原子更新；
- 溢出必须可见，绝不静默截断；
- 浏览器产物必须是单文件、自包含的 factory bundle。

如果改动涉及 Host 契约、prompt 边界、storage schema 或 client bundle 格式，请先开 issue 讨论兼容性和迁移
影响。

## 开发环境

下面的 `git clone` URL 只在公开仓库创建后有效；在此之前请直接使用已有的 checkout，跳过 clone 命令。

```bash
git clone https://github.com/centella-cream/dsh-charter.git
cd dsh-charter
npm install
npm run check
```

常用命令：

```bash
npm run typecheck
npm test
npm run build
npm run check
```

`npm run build` 同时运行 Remote 和 client smoke 检查。

## 分支流程（单维护者）

远程仓库只保留 `main`。每个改动的固定路径：

1. 从本地 `main` 创建本地非 `main` 分支；
2. 在分支上实现并跑完本地门禁；
3. 构建验收 tarball/profile，对精确构建做**本地人工验收**；
4. 只有验收确认后，才线性合入本地 `main`；
5. 只推送 `main`。`main` 的保护是不允许 force-push、删除和非线性合并，而不是 PR review 要求。

本地验收前不创建 release/tag，也不推送远端分支；验收结果写入发布验证记录。

外部贡献者仍可从 fork 提交 PR；维护者按同样的 main-only 策略在本地审查和合并。

## Pull request

一个好的 PR：

- 说明用户可见的问题和选择的取舍；
- 改动范围聚焦；
- 行为变化有新增或更新的测试；
- 代码注释和日志保持英文；
- 公共契约变化时同时更新中英文文档；
- 本地运行过 `npm run check`；
- 不增加第二套 Remote 编解码、第二套 session 协议或 system-role 注入路径。

UI 改动请附截图或短录屏，并验证明暗主题和窄容器。

### README 截图刷新

README 及其截图是发布证据，不是装饰图。每次用户可见能力或 Pane 布局变化、以及每个候选/发布构建前，
必须同时刷新 `README.md` 与 `README.zh.md`：

1. 在 **Web profile** 中安装或运行当前精确构建并截取真实 UI；不要制作 HTML mockup、手工拼图或复用旧版本图。
2. 使用合成演示会话。优先使用上一个已验收版本生效会话的契约内容（`0.3.3` 对应
   `为 dsh-charter 插件优化 GUI 设计` 的三条中文交付物 D1/D2/D3）；如果该会话仍在其他 Host 中 live、
   无法安全打开，则在合成会话中逐字重建其契约文本；绝不暴露用户的 live 契约。
3. README 语言必须与 **UI 和契约文本**一致：
   - 英文 README：英文 DSH locale + 英文契约内容。
   - 中文 README：中文 DSH locale + 上一个已验收演示的中文契约内容；
     不得在中文 README 中截英文契约。
4. DSH 外观设为 **跟随系统**；不要强制深色或浅色。系统主题变化后重新截取。UI 同时涉及明暗状态时另行
   验证明暗，但 README 图跟随系统主题。
5. 只裁剪产品区域：Pane 图只保留右侧 `.charter-root`（不含左侧导航、不含会话标题栏）；依赖图裁剪
   `.charter-graph` 并留少量 padding。正文说明截图为合成演示数据。
6. Pane 使用 1440px Web 视口、device scale factor 2；依赖图必要时使用更高视口以免裁切；版本 chip 必须是
   当前包版本。
7. 文件命名为 `docs/assets/charter-pane-<version>.png` / `.zh.png` 和
   `docs/assets/charter-graph-<version>.png` / `.zh.png`；不要覆盖历史版本图。
8. 校验中英文 README 的安装/更新/配置/兼容片段和链接、插件详情页 locale metadata、图片语言与内容；
   在 `docs/verification.md` 记录截图条件。

依赖图未变化时可选；包含时同样遵守裁剪和语言规则。

### 本机人工验收与 Desktop 热更新

本机验收必须由人工针对精确候选 artifact 执行。Desktop 必须通过 **Plugins** 的安装/更新流程和它的
重载/热更新动作完成；不得终止或向 Desktop App、Electron 进程或 Host 进程发信号，也不得直接修改
Desktop profile 来强行安装或让验收通过。Agent 可以准备 artifact 和安装步骤，在人工操作后只读核对版本、
日志并记录证据；候选未安装时，Desktop 门禁只能标记 **blocked**，不能视为通过。

测试需要创建 Session 时，记录创建过的 id，测试结束只删除自己创建的 Session；绝不删除用户或其他
无关 Session。

## Commit 风格

欢迎但不强制使用 Conventional 前缀：

```text
feat: add history draft review
fix: preserve draft on revision conflict
docs: clarify budget overflow
```

## 报告 bug

请包含：

- DSH 版本（`dsh --version`）；
- Node 版本；
- profile 类型（Web/Desktop）和操作系统；
- 该 Session 是否在当前进程中 live；
- 精确的 error code 或 UI 状态；
- 尽可能小的复现步骤。

不要粘贴 API key、凭据、完整私人对话或生产文件内容；请使用脱敏片段。

## 安全

疑似漏洞不要开公开 issue，请遵循 [SECURITY.md](SECURITY.md)。

## 许可证

提交贡献即表示你同意以 MIT License 授权该贡献。

文档变更必须遵循 [docs/README.md](docs/README.md)（命名、状态块和链接同步）。
