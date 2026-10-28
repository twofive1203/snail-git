# 参与贡献

问题和拉取请求可以用中文或英文。

SnailGit 目前只在 Windows 上验证过。Linux / macOS 没有安装包，贡献时不要求这两个平台的检查通过。这是桌面应用，不是 npm 库，不要把包发布到 npm。`package.json` 保持 `"private": true`。

更细的依赖和命令链路约束见仓库根目录的 [AGENTS.md](AGENTS.md)。这里只写怎么在 Windows 上启动和检查。

## 环境

- Node.js 与 pnpm（锁文件是 pnpm 9）
- Rust stable（桌面端和 `test:rust`）
- 本机 Git

## 启动

```bash
pnpm install
pnpm dev
pnpm tauri dev
```

`pnpm dev` 只是浏览器预览，使用假数据，不能读写真实仓库。日常开发用 `pnpm tauri dev`。

## 检查

```bash
pnpm typecheck
pnpm lint
pnpm test:rust
```

分别是前端类型检查、前端 lint、Rust 测试（含 Git 行为测试）。没有前端测试运行器，不要为了贡献新加 vitest 或 jest。

`.github/workflows/windows-check.yml` 覆盖上面三条命令，并且只跑 Windows。仓库公开到 GitHub 之后，推送和拉取请求才会触发它。仓库还没公开时，这份工作流不会在远程执行。
