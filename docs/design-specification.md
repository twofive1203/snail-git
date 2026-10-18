# SnailGit 设计规格说明书与 IDEA Git 功能调研深度报告

> ⚠️ **本文是立项期的调研 + 规划档案**。文中架构选型、内存数字、交付物清单反映的是原型阶段，**实际实现以代码为准**（对照表见各节标注）。当前 AI 写作约束见仓库根目录 `AGENTS.md`。

## 一、 项目背景与痛点定位

### 1.1 痛点：IntelliJ IDEA 的沉重开销
IntelliJ IDEA 的 Git 工具窗口（Version Control / Git Tool Window）在开发者圈子中被公认为交互体验、可视化直观度和生产力最高的 Git 客户端之一。然而，IDEA 本身是庞大的 Java / Kotlin 编写的 IDE：
- **内存吞噬严重**：启动后常规内存占用在 **2.5 GB ~ 4.5 GB** 之间，且伴随长时间的文件索引（Indexing）、语法检查和后台 JVM GC 开销。
- **冷启动迟缓**：如果开发者仅仅想要查看 Git Log、对比两分支差异、解决代码冲突或挑拣提交（Cherry-pick），启动一次 IDEA 需要等待数十秒。
- **轻量替代品痛点**：现有的轻量客户端中，GitKraken 资源占用同样偏大且商业收费，Sourcetree 界面老旧卡顿，VS Code 的 Git 体验相较于 IDEA 在双栏 Diff、Shelf（架藏）、3-Way Merge 冲突解决和拓扑图上存在明显差距。

### 1.2 SnailGit 的核心目标
- **极致轻量**：运行时常驻内存目标 **< 60MB**（界面状态栏展示真实进程 RSS），毫秒级瞬间秒开。
- **1:1 复刻 IDEA 核心手感**：
  1. JetBrains New UI 暗黑高质感视觉体系；
  2. 丝滑的多轨道彩色贝塞尔曲线 Git Log 拓扑图谱；
  3. Default Changelist 与 Unversioned Files 的变更树管理；
  4. 强大的 Side-by-Side 双栏 Diff 比较器，支持**行级/代码块级暂存 (Partial Commit / Chunk Staging)** 与即时回滚；
  5. IDEA 独家灵魂特性 **Shelf (架藏)** 与原生 Git Stash 双轨支持；
  6. **3-Way Merge (三方冲突解决器)**，支持一键智能应用非冲突变更与左右对比；
  7. 右下角快捷唤起 Branches 浮动小部件，支持即时搜索与分支操作。

---

## 二、 IntelliJ IDEA Git 功能深度调研分解

| 模块 | IDEA 原型特性 | SnailGit 还原与设计重点 |
| :--- | :--- | :--- |
| **Git Log (Alt+9)** | 多彩色轨道拓扑图、Ref Badges (HEAD, Branch, Tag)、多维过滤 (Branch, User, Date, Path, Search)、双栏联动文件树与提交详情抽屉、右键快捷菜单 (Cherry-pick, Reset, Revert, Checkout Revision) | SVG 动态轨道计算、短 Hash 一键复制、全字段模糊搜索与多重过滤联动 |
| **Commit (Alt+0)** | Default Changelist、Unversioned Files、文件状态颜色 (M蓝色/A绿色/D删除/冲突红)、多选框勾选提交、提交前检查、Commit 与 Commit & Push 复合按钮 | 树状与扁平变更切换、行级复选框勾选、前缀药丸快速填充、Amend 复选框、支持直接架藏 |
| **Side-by-Side Diff** | 双栏代码比对、Word-level 差异内联高亮、Chunk 块箭头应用 `>>` 与单块丢弃 `x`、Next/Prev 差异跳转 (F7 / Shift+F7)、Ignore Whitespace 开关 | 统一栅格化对齐双栏视口、块级 Partial Commit 复选框、词法变动高亮、一键应用或回滚变更块 |
| **Branches Widget** | 右下角常驻状态栏按钮、快速过滤搜索框、New Branch、Recent / Local / Remote 分组、分支展开操作 (Checkout, Merge, Rebase, Compare, Delete) | 弹窗层支持全键盘过滤检索、当前分支绿色徽标指示、上推/下拉未同步数量展示 |
| **Shelf (架藏)** | 本地安全暂存区、不受 `git stash clear` 或 `git reset --hard` 破坏、支持不同分支自由恢复、命名与文件差异持久保存 | 独立 Shelved Changelists 管理面板、一键 Unshelve 恢复与清理 |
| **3-Way Merge** | 解决冲突时的三栏比对 (Yours / Result / Theirs)、“Apply All Non-Conflicting Changes” 智能合并、中间编辑栏实时保存并标记已解决 | 交互式三栏合并视窗、左右单边合并箭头、自动无冲突提取与一键标记解决 |

---

## 三、 SnailGit 技术架构（现状，以代码为准）

立项时规划的“异步进程池 + libgit2”等方案**均未采用**，实际实现如下：

```
[前端表现层]  src/（React 18 + TypeScript + Vite 6 + Tailwind 3）
├── JetBrains New UI 配色：tailwind.config.js 的 jb-* 令牌（jb-bg/#1E1F22、jb-panel/#2B2D30、jb-blue/#3574F0 …）
├── 组件树：GitLogView / CommitView / ShelfStashView / BranchesModal / ThreeWayMergeModal / ProjectSidebar / common
├── SVG 拓扑：gitLogView/graphLayout.ts 计算轨道，CommitGraph.tsx 渲染；列表为分页加载 + 全量渲染，**无虚拟化**
└── i18n：src/i18n/messages.ts 中英双表 + useI18n().t()

                     │ Tauri IPC（invoke，唯一通道；无 REST / WebSocket）
                     ▼
[桌面运行时层]  src-tauri/（Tauri 2，已落地为主路径）
├── lib.rs：#[tauri::command] 薄转发 + generate_handler! 注册；托盘常驻、单实例、关窗仅隐藏
├── 窗口：tauri.conf.json decorations:false + WindowControls.tsx 自绘标题栏
├── 打包：仅 Windows NSIS 安装包（currentUser 模式）；无 macOS / Linux 打包目标
└── 依赖极简：tauri / tauri-plugin-single-instance / serde / serde_json（无 git2、无 tokio、无 HTTP 框架）

                     │ 直接调用
                     ▼
[Git 执行引擎]  src-tauri/src/git_ops.rs
├── std::process::Command 同步执行（hidden_command + CREATE_NO_WINDOW），参数一律数组，不经 shell
└── 显式超时：本地读写 Duration::from_secs(...)，网络 NETWORK_TIMEOUT + NETWORK_STALL
```

已讨论但**未采纳/未实现**的备选（不要按此实现）：

| 备选 | 当时理由 | 当前状态 |
| :--- | :--- | :--- |
| 异步进程池（tokio + 多命令并发） | 提升大仓库并发 | 未实现，实际是同步 Command + 超时 |
| libgit2 / git2 crate（直接读 packfile） | 避免全量重载 | 未实现，且禁止新增该依赖 |
| IPC / REST / WebSocket 多通道 | 支持远程开发机 | 未实现，只有 Tauri IPC |
| 方案 B：Go + Wails / Web 服务模式 | 更轻的运行时 | 未实现，仓库无 Go 代码 |

---

## 四、 本次交付物包含的内容

1. **完整前端工程脚手架**：Vite 6 + React 18 + TypeScript + Tailwind CSS，配置完善，支持独立热重载开发与一键静态构建发布。
2. **主题设计规范**：复刻 JetBrains New UI 标准色值（`#1E1F22`, `#2B2D30`, `#3574F0`, `#59A869`, `#E35967` 等）。
3. **浏览器预览兜底数据 (`src/mock/gitData.ts`)**：涵盖多分支并行拓扑、双栏修改 Diff、架藏与 Stash 列表。
   - **仅在浏览器预览下生效**：`App.tsx` 以 `import.meta.env.DEV && !isTauriEnvironment()` 条件动态 import，正式产物与 Tauri 环境全部走真实 git。
4. **核心交互界面与组件**：
   - `Header.tsx`：顶部工具栏与内存指示（每 8s 调 `process_memory_mb` 展示真实进程 RSS；浏览器预览下退化为 JS heap）
   - `GitLogView/`：带 SVG 贝塞尔多分支连线、多维过滤、变更文件树与详情抽屉
   - `CommitView/`：Default Changelist 树、Side-by-Side 双栏 Diff（含行内高亮与块级暂存控制器）、复合提交动作栏
   - `BranchesModal.tsx`：全功能分支弹窗，支持即时过滤与右键操作
   - `ShelfStashView/`：Shelf 与 Stash 分栏管理
   - `ThreeWayMergeModal.tsx`：经典三栏三方冲突解决器
   - `StatusBar.tsx`：底部状态栏
