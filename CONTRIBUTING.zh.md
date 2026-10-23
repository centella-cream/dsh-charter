# 为 dsh-charter 贡献

[English](CONTRIBUTING.md) | 中文

感谢你改进 `dsh-charter`。项目刻意保持小而专注；最有价值的贡献是聚焦的 bug 报告、兼容性数据，以及不破坏
设计不变量的改动。

## 开始之前

先阅读[设计规格](docs/design/charter-design.zh.md)，重点确认：

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
