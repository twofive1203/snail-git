# EasyGit 设计规格说明书与 IDEA Git 功能调研深度报告

## 一、 项目背景与痛点定位

### 1.1 痛点：IntelliJ IDEA 的沉重开销
IntelliJ IDEA 的 Git 工具窗口（Version Control / Git Tool Window）在开发者圈子中被公认为交互体验、可视化直观度和生产力最高的 Git 客户端之一。然而，IDEA 本身是庞大的 Java / Kotlin 编写的 IDE：
- **内存吞噬严重**：启动后常规内存占用在 **2.5 GB ~ 4.5 GB** 之间，且伴随长时间的文件索引（Indexing）、语法检查和后台 JVM GC 开销。
- **冷启动迟缓**：如果开发者仅仅想要查看 Git Log、对比两分支差异、解决代码冲突或挑拣提交（Cherry-pick），启动一次 IDEA 需要等待数十秒。
- **轻量替代品痛点**：现有的轻量客户端中，GitKraken 资源占用同样偏大且商业收费，Sourcetree 界面老旧卡顿，VS Code 的 Git 体验相较于 IDEA 在双栏 Diff、Shelf（架藏）、3-Way Merge 冲突解决和拓扑图上存在明显差距。

### 1.2 EasyGit 的核心目标
- **极致轻量**：运行时常驻内存控制在 **40 MB ~ 80 MB**，毫秒级瞬间秒开。
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

| 模块 | IDEA 原型特性 | EasyGit 还原与设计重点 |
| :--- | :--- | :--- |
| **Git Log (Alt+9)** | 多彩色轨道拓扑图、Ref Badges (HEAD, Branch, Tag)、多维过滤 (Branch, User, Date, Path, Search)、双栏联动文件树与提交详情抽屉、右键快捷菜单 (Cherry-pick, Reset, Revert, Checkout Revision) | SVG 动态轨道计算、短 Hash 一键复制、全字段模糊搜索与多重过滤联动 |
| **Commit (Alt+0)** | Default Changelist、Unversioned Files、文件状态颜色 (M蓝色/A绿色/D删除/冲突红)、多选框勾选提交、提交前检查、Commit 与 Commit & Push 复合按钮 | 树状与扁平变更切换、行级复选框勾选、前缀药丸快速填充、Amend 复选框、支持直接架藏 |
| **Side-by-Side Diff** | 双栏代码比对、Word-level 差异内联高亮、Chunk 块箭头应用 `>>` 与单块丢弃 `x`、Next/Prev 差异跳转 (F7 / Shift+F7)、Ignore Whitespace 开关 | 统一栅格化对齐双栏视口、块级 Partial Commit 复选框、词法变动高亮、一键应用或回滚变更块 |
| **Branches Widget** | 右下角常驻状态栏按钮、快速过滤搜索框、New Branch、Recent / Local / Remote 分组、分支展开操作 (Checkout, Merge, Rebase, Compare, Delete) | 弹窗层支持全键盘过滤检索、当前分支绿色徽标指示、上推/下拉未同步数量展示 |
| **Shelf (架藏)** | 本地安全暂存区、不受 `git stash clear` 或 `git reset --hard` 破坏、支持不同分支自由恢复、命名与文件差异持久保存 | 独立 Shelved Changelists 管理面板、一键 Unshelve 恢复与清理 |
| **3-Way Merge** | 解决冲突时的三栏比对 (Yours / Result / Theirs)、“Apply All Non-Conflicting Changes” 智能合并、中间编辑栏实时保存并标记已解决 | 交互式三栏合并视窗、左右单边合并箭头、自动无冲突提取与一键标记解决 |

---

## 三、 EasyGit 技术架构演进路线

```
[前端表现层 (当前阶段)]
├── React 18 + TypeScript + Vite + Tailwind CSS
├── JetBrains New UI 主题配色体系
├── 模块化组件树 (GitLog, CommitDiff, Branches, Shelf, ThreeWayMerge)
└── 虚拟化列表与 SVG 拓扑网络图渲染引擎

                     │ (IPC / REST / WebSocket)
                     ▼
[桌面应用与运行时层 (后续阶段)]
├── 方案 A：Tauri 2.0 (Rust) —— 推荐首选方案
│   ├── 内存占用：~35MB
│   ├── 安装包体积：< 15MB
│   └── 跨平台：Windows (WebView2) / macOS (WebKit) / Linux
└── 方案 B：Go + Wails / Web 服务模式
    └── 内存占用：~45MB，支持局域网或云端开发机远程 Git 监控

                     │ (直接调用)
                     ▼
[Git 底层执行引擎]
├── 轻量异步进程执行器 (git CLI 命令池)
└── 配合 libgit2 (快速读取 packfile 与 tree 索引，避免全量重载)
```

---

## 四、 本次交付物包含的内容

1. **完整前端工程脚手架**：Vite 6 + React 18 + TypeScript + Tailwind CSS，配置完善，支持独立热重载开发与一键静态构建发布。
2. **主题设计规范**：复刻 JetBrains New UI 标准色值（`#1E1F22`, `#2B2D30`, `#3574F0`, `#59A869`, `#E35967` 等）。
3. **真实模拟数据源 (`src/mock/gitData.ts`)**：涵盖多分支并行拓扑、真实代码双栏修改 Diff、文件架藏列表与多条 Stash。
4. **核心交互界面与组件**：
   - `Header.tsx`：顶部工具栏与实时内存状态指示（48 MB vs IDEA 2.6 GB）
   - `GitLogView/`：带 SVG 贝塞尔多分支连线、多维过滤、变更文件树与详情抽屉
   - `CommitView/`：Default Changelist 树、Side-by-Side 双栏 Diff（含行内高亮与块级暂存控制器）、复合提交动作栏
   - `BranchesModal.tsx`：全功能分支弹窗，支持即时过滤与右键操作
   - `ShelfStashView/`：Shelf 与 Stash 分栏管理
   - `ThreeWayMergeModal.tsx`：经典三栏三方冲突解决器
   - `StatusBar.tsx`：底部状态栏
