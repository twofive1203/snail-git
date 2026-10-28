# SnailGit 协作约定（AI 必读）

本文件是仓库内唯一的 AI 写作约束。**代码、`package.json`、`Cargo.toml`、`tauri.conf.json` 是唯一事实标准**；`docs/` 下是历史规划文档，与代码冲突时一律以代码为准。

## 1. 技术栈与命令

- 前端：React 18 + TypeScript + Vite 6 + Tailwind CSS 3，包管理器 `pnpm`。
- 桌面端：Tauri 2（Rust，`src-tauri/`），**已是主路径**，不是未来计划。
- 常用命令：`pnpm dev`、`pnpm build`、`pnpm typecheck`、`pnpm lint`、`pnpm format`、`pnpm tauri dev`、`pnpm test:rust`、`pnpm lint:rust`。
- **没有前端测试运行器**（无 vitest/jest，`package.json` 无 test 脚本）。Git 行为测试写在 `src-tauri/src/git_ops.rs` 底部的 `#[cfg(test)]` 模块，用 `pnpm test:rust` 跑。不要引入前端测试框架。

## 2. 依赖极简（硬约束）

现有依赖只有 `react`、`react-dom`、`clsx`、`lucide-react`、`@tauri-apps/api` 与开发工具链。未经明确要求，**禁止新增**：

- `git2` / `libgit2`（Git 操作一律走 git CLI，见 §4）
- 异步运行时（`tokio` 等）、HTTP 服务框架（项目无 REST/WebSocket，只有 Tauri IPC）
- 状态管理库（redux/zustand/jotai）、UI 组件库（shadcn/antd/MUI）、虚拟滚动库、i18n 第三方库

## 3. 国际化（i18n）

- 所有界面文案必须走 `useI18n()` 的 `t()`：`import { useI18n } from '../../i18n/react'`。
- 文案表在 `src/i18n/messages.ts`，**中英双表必须同时新增**（`zh` 与 `en`，key 完全同名）。
- 禁止在 JSX、`title`、`placeholder`、`aria-label`、表格列头里写死中英文。
- Rust 侧返回的错误是中文文案（如 `Err("没有配置远程仓库".into())`），前端直接展示；后端没有 i18n 表，不要为后端错误造 key。

## 4. Rust 命令链路（新增能力必须四步齐全）

1. `src-tauri/src/git_ops.rs`：写 `pub fn`，用 `run_git` / `hidden_command` 调 git。
   - **参数一律用数组**（`&["status", "--porcelain=v1"]`），禁止拼 shell 字符串、禁止 `cmd /c`。
   - 必须给显式超时（本地读写 `Duration::from_secs(...)`，网络用 `NETWORK_TIMEOUT`）。
2. `src-tauri/src/lib.rs`：加 `#[tauri::command]` 薄转发，并登记进 `generate_handler![...]`；漏登记会运行期报错。
3. `src/services/gitService.ts`：加类型化封装，非 Tauri 环境走浏览器兜底分支。
4. 组件只调用 `gitService.ts`，不直接 `invoke`。

## 5. 样式

- 优先用 `tailwind.config.js` 的 `jb-*` 令牌（`jb-bg`、`jb-panel`、`jb-border`、`jb-blue`、`jb-green`、`jb-red`、`jb-text-primary` 等）。
- 代码中存在历史硬编码色值（`#1E1F22`、`#2B2D30`、`#393B40`、`#8C9099`、`#DFE1E5` 等），新代码不要扩散；改旧文件时不必顺手全量替换。
- 字体：`font-mono` = JetBrains Mono，`font-sans` = Inter；路径展示用 `${...} font-mono`。

## 6. 数据与持久化

- 前端 mock（`src/mock/gitData.ts`）**只在** `import.meta.env.DEV && !isTauriEnvironment()` 时动态 import，用于浏览器预览；正式路径与 Tauri 环境一律走真实 git。不要把 mock 直接静态 import 进组件。
- `localStorage` key 现状混用：`snailgit.*`（如 `snailgit.log.branchesCollapsed`、`snailgit.commitDetail.splitRatio`）与 `snail-git.locale`；新增请沿用所在模块已有前缀。
- Shelf（架藏）数据存放于 `writable_data_dir()/shelves/<repo_id>`，**不在 `.git` 内**，因此不受 `git stash clear` / `git reset --hard` 影响。不要改成 stash 实现。

## 7. 环境变量

本项目**没有自定义环境变量，也没有 `.env` / `.env.example`**，不要引入基于 env 的配置读取。`src-tauri` 内仅有两处内部用途：`PATH`（定位 `git.exe`）和 `LOCALAPPDATA`（用户数据目录）。

## 8. 平台

Windows 优先：git 可执行文件解析（避开 `git.cmd` 包装器）、子进程 `CREATE_NO_WINDOW`、托盘常驻（关窗只隐藏，真退出走托盘菜单）、单实例、NSIS 打包目标。跨平台代码改动需保留 `#[cfg(...)]` 分支。

## 9. 文档纪律

- `docs/design-specification.md`、`docs/ux-iteration-roadmap.md` 是**历史规划**，其中的任务已落地。与代码冲突时以代码为准，不要按旧施工步骤重做。
- `docs/plans/2026-08-14-001-feat-branch-panel-actions-plan.md`、`docs/plans/2026-10-18-002-feat-backlog-five-items-plan.md` 是**已完成**计划。2026-08-14 里「用系统 `prompt` 重命名」已被 `askInput` 取代，不要恢复 `window.prompt`。
- `docs/brainstorms/2026-10-27-oss-readiness-requirements.md` 与 `docs/plans/2026-10-27-001-feat-oss-readiness-plan.md` 是**未实现/待办**（协议、贡献说明、危险操作前展示命令）。不要当成已完成，也不要在未被要求时实现。
- 不要在文档里复制整段实现代码作为“示范”，写文件路径与约束即可（代码会漂移，文档不会自动同步）。
- 新增/修改文档时，只描述**当前代码真实支持**的能力；未实现的内容必须显式标注“未实现/待办”。
