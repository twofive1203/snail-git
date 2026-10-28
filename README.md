# SnailGit

> A lightweight IntelliJ IDEA-style Git client. MIT License. Verified on Windows only (NSIS installer). Not a GitHub or GitLab pull-request client. The log loads 200 commits per page and stops at 20,000.

中文说明如下。Linux 与 macOS 尚未支持，欢迎贡献。没有这两个平台的安装包或下载入口。

# SnailGit 🚀

> 面向 Windows 的轻量 IntelliJ IDEA 风格 Git 客户端，采用 [MIT License](LICENSE)。常驻内存以状态栏里的进程 RSS 为准，目标 < 60MB，不保证任何仓库都低于该数。日志每页 200 条，继续加载最多到 2 万条后停止；已加载的行整页渲染，没有虚拟滚动，不保证大仓库丝滑。

[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF.svg)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB.svg)](https://reactjs.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.x-38B2AC.svg)](https://tailwindcss.com/)

---

## 💡 为什么做 SnailGit？

很多重度开发者极度喜爱 **IntelliJ IDEA 的 Git 交互与版本控制体系**（无可挑剔的 Git Log 拓扑图、便捷的行级 Partial Commit、顺手的双栏 Diff 比对、本地安全的 Shelf 架藏、以及强大的 3-Way Merge 冲突解决）。

然而，IDEA 作为一个重型 IDE，往往需要占用 **2.5 GB ~ 4 GB+** 的内存，并伴随着漫长的启动时间和频繁的索引构建。如果只是想快速查看 Git 历史、对比分支、提交代码或挑拣提交（Cherry-pick），启动 IDEA 极其沉重。

**SnailGit 把 IDEA 里常用的 Git 操作做成独立桌面应用**，主路径是已落地的 **Tauri 2**。它不是 IDEA 的完整复刻，也没有 blame、交互式 rebase、GitHub/GitLab PR 客户端。常驻内存目标 **< 60MB**，以窗口状态栏的真实进程 RSS 为准，不保证任何仓库都低于该数。

> 浏览器模式（`pnpm dev`）仅是开发预览：非 Tauri 环境下使用 `src/mock/gitData.ts` 假数据，不可读写真实仓库。AI 协作约束见 [AGENTS.md](AGENTS.md)。
>
> 协议是根目录的 [MIT License](LICENSE)。这是桌面应用，不是 npm 库，`package.json` 保持 `"private": true`。贡献、Windows 启动和现有检查见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## ✨ 已实现的核心能力

0. **多项目仓库管理侧边栏 (Repositories Sidebar)**
   - 最左侧常驻项目列表，支持展开/折叠双模式（紧凑图标模式 vs 完整列表模式）
   - **添加本地 Git 项目**：支持输入路径或浏览添加，提供快捷示例导入
   - **平滑一键切换**：点击项目立即切换主界面的当前仓库、分支与变更状态
   - **项目管理操作**：支持收藏置顶（Star）、从 SnailGit 列表安全移除（无损本地磁盘文件）
   - **实时状态感知**：卡片上即时呈现未暂存变更数量指示（如 `● 13`）与未同步推送数量（如 `↑1`）

1. **Git Log 历史拓扑图 (Alt+9)**
   - 多轨道贝塞尔曲线 SVG 彩色拓扑图谱，清晰展示分叉与合并
   - 包含 Branch / Tag 徽章（黄色 Tag、绿色 HEAD、蓝色远程分支）
   - 多维过滤器：按 Branch、User、Date、Paths 和全文字段快速过滤
   - 提交详情抽屉与变更文件树（A/M/D 状态与行数增减联动）
   - 经典右键菜单：Cherry-pick, Checkout Revision, Create Branch, Revert, Reset to Here

2. **Commit 面板与双栏 Diff 比较器 (Alt+0)**
   - **Default Changelist 与 Unversioned Files** 分组树，支持勾选/取消勾选待提交项
   - **Side-by-Side 双栏 Diff**：
     - 左栏 HEAD 版本 vs 右栏工作区版本
     - 细粒度单词级 (Word-level) 高亮
     - **行级/代码块级暂存 (Partial Commit / Chunk Staging)**：独立勾选具体代码块提交，支持 `>>` 应用块与 `x` 回滚块
   - Commit Message 快速输入，带常见前缀建议（`feat:`, `fix:`, `refactor:`, `perf:`, `chore:`）
   - `Amend commit` 快速修补开关与复合提交按钮（Commit / Commit and Push...）

3. **Branches 分支管理弹出层 (Git Widget)**
   - 右下角与顶部一键弹出 IDEA 风格悬浮窗
   - 快速模糊搜索、Recent / Local / Remote 分支分组
   - 一键执行 Checkout、Merge into Current、Rebase onto Selected、Compare with Current

4. **Shelf (架藏) & Stash (贮藏)**
   - 完整还原 IDEA 独家实用的 Shelf 功能（保存在本地安全区，不受跨分支切换或误删 stash 影响）
   - 支持独立 Unshelve 恢复与清理
   - 原生 Git Stash 堆栈查看、Apply、Pop 与 Drop

5. **3-Way Merge (三方冲突解决器)**
   - 经典三栏视图：Yours (本地) | Result (最终合成代码) | Theirs (远程)
   - 支持“Apply All Non-Conflicting Changes”一键智能合并
   - 支持单侧 Accept Left / Accept Right 以及中栏实时编辑

---

## 🛠️ 本地启动与构建

### 1. 安装前端与桌面端依赖
```bash
pnpm install
```

### 2. 方式 A：启动 Web 模式（浏览器快速预览）
```bash
pnpm run dev
```
启动后在浏览器中打开 `http://localhost:60606` 即可交互体验原型。

### 3. 方式 B：启动 Tauri 2.0 原生桌面应用（推荐）
```bash
pnpm tauri dev
```
唤起原生桌面窗口，调用本机 Git。顶栏和底部状态栏都会显示进程 RSS（`App.tsx` 每 8 秒调一次 `process_memory_mb`）。目标 < 60MB，以界面读数为准。

### 4. 构建 Windows 安装包（NSIS）
```bash
pnpm tauri build
```

`src-tauri/tauri.conf.json` 当前只配置了 Windows NSIS 目标（`bundle.targets: ["nsis"]`，`currentUser` 安装模式），产出 `.exe` 安装器。macOS / Linux 未支持，也没有对应打包目标或下载入口，欢迎贡献。

`.github/workflows/windows-check.yml` 只在 Windows 上跑现有的类型检查、前端 lint 和 Rust 测试。仓库公开到 GitHub 之后它才会在远程执行；现在还没有挂上远程检查，本仓库不据此声称检查已经在跑。

## 界面截图

下面三张都还没有 Windows 实机图。**截图待补**。不要用生成图或浏览器 mock 填这三处。

1. 日志拓扑：截图待补
2. 提交与双栏 diff：截图待补
3. Shelf 或三方合并：截图待补

---

## 📦 当前已实现能力（维护时的对照表）

以下能力已在代码中落地，为避免重复实现，改动前请先看对应文件/命令：

| 能力 | 入口 |
| :--- | :--- |
| 中英文切换（zh 默认） | `src/i18n/messages.ts`、`useI18n()`；持久化 key `snail-git.locale` |
| 托盘常驻 + 单实例（关窗仅隐藏，真退出走托盘菜单） | `src-tauri/src/lib.rs`（`tray-icon`、`tauri-plugin-single-instance`） |
| 自绘无边框标题栏 | `tauri.conf.json` `decorations: false`、`src/components/WindowControls.tsx` |
| 多仓库侧边栏 / 收藏 / 移除 | `src/components/ProjectSidebar/` |
| 克隆仓库、远程管理（增删改 URL） | `clone_repo`、`list_remotes` / `add_remote` / `rename_remote` / `set_remote_url` / `remove_remote`，界面 `src/components/RemotesModal.tsx` |
| Squash 合并提交 | `preview_squash` / `squash_commits`，界面 `src/components/GitLogView/SquashDialog.tsx` |
| 分支比较 | `compare_branches`，命令行与提交对话框 |
| 生成补丁 | `create_patch` |
| 三方冲突解决 | `load_conflict` / `resolve_conflict` / `smart_merge_conflict`，界面 `src/components/merge/` |
| 文件编码/换行检测 | `inspect_file`（状态栏展示） |
| 仓库变化自动刷新 | `set_watch_path` / `set_watch_paused` + `lib.rs` 的 `watch_loop` |
| 合并 / 变基 / 挑拣的中止与继续 | `repo_state` / `continue_operation` / `abort_operation`，界面 `src/components/OperationBar.tsx` |
| Tag 新建 / 删除 / 推送 / 删除远程 | `create_tag` / `delete_tag` / `push_tag` / `delete_remote_tag`，界面 `src/components/GitLogView/TagDialog.tsx`、`RemotePickerDialog.tsx` |
| 强制推送（仅 `--force-with-lease`） | `push_to` 的 `force` 参数 + `preview_push` 的 `needsForce`，界面 `src/components/PushDialog.tsx`；代码中不使用 `--force` |
| 自绘输入 / 确认弹窗（无原生 `prompt` / `confirm`） | `src/components/common/askInput.ts` / `askConfirm.ts` / `dialogQueue.ts` / `InputDialog.tsx` / `ConfirmHost.tsx` |
| Changelist 重命名 / 删除 | `src/components/CommitView/ChangelistTree.tsx`（`localStorage` key `snailgit.changelists.<repoKey>`，存储值保持 `更改` / `全部`） |
| 日志分页 | `src-tauri/src/git_ops.rs` 的 `LOG_PAGE_SIZE = 200`、`LOG_FETCH_CAP = 20_000`；继续加载到上限后停止。已加载的行整页渲染，**没有虚拟滚动** |

工程约定（i18n、依赖白名单、Rust 命令链路、无前端测试框架等）见 [AGENTS.md](AGENTS.md)。

---

## 🗺️ 后续路线图 (Roadmap)

- [x] **Phase 1**：IDEA Git 功能深度调研与高保真交互前端原型
- [x] **Phase 2**：接入轻量 Native 宿主（Tauri 2.0 / Rust），搭建跨平台桌面端骨架与双模架构
- [x] **Phase 3**：真实 Git 数据流（状态、日志、diff、提交、分支、stash、shelf）与 `.git` 变化刷新
- [x] **Phase 4**：快捷键对齐 IDEA（Ctrl+K, Ctrl+T, Ctrl+Shift+K, Alt+9, Alt+0, F7/Shift+F7, Ctrl+Enter）
