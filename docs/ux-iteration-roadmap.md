# SnailGit 产品体验优化记录

> **版本**：v1.1（2025-02 路线图的归档）
> **文档定位**：记录从原型到当前桌面应用做过的体验改动。不是待办清单。
> **核心指标**：常驻内存目标 < 60MB（以状态栏 RSS 为准，不保证始终低于该数）、对齐 JetBrains IDEA 的核心 Git 交互。不是 IDEA 的完整复刻。

> 文中 Sprint 的施工步骤（固定 80px 拓扑列、`min-w-[760px]`、`appWindow.*`、把 Diff 色写成「红增绿减」）与现行代码冲突，已删除。不要按那些步骤重做。仍有效的约束在文末。

### 落地状态（以代码为准）

| 原章节 | 状态 | 现存实现 |
| :--- | :--- | :--- |
| 路径「保尾截中」 | ✅ 已落地 | `src/components/common/FilePathDisplay.tsx`。CommitDetail、SideBySideDiff、ChangelistTree、三方合并和推送预览都在用 |
| 表格表头与列宽 | ✅ 已落地 | `src/components/GitLogView/CommitGraph.tsx`：`colgroup` 固定像素列 + `graphWidth` 动态拓扑列 + i18n 列头 |
| Diff 装订线化（去横栏） | ✅ 已落地 | `src/components/CommitView/SideBySideDiff.tsx`：中缝 `@@` 标记、行块悬浮操作，无跨栏横条 |
| 提交详情可拖拽 Splitter | ✅ 已落地 | `src/components/common/SplitPane.tsx`；`CommitDetail.tsx` 持久化 `snailgit.commitDetail.splitRatio` |
| Amend 回填 / 50-72 计数 / 前缀聚焦 | ✅ 已落地 | `src/components/CommitView/CommitActionBox.tsx` |
| 未跟踪文件降噪与 Ignore 管理 | ✅ 已落地 | `appendGitignore` / `deleteUnversioned`（`gitService.ts`、`App.tsx` 接线） |
| Tauri 无边框标题栏 | ✅ 已落地 | `tauri.conf.json` `decorations: false` + `src/components/WindowControls.tsx` |
| Ahead / Behind 角标 | ✅ 已落地 | `Header.tsx` / `StatusBar.tsx` 的 `aheadCount` / `behindCount` |
| 过滤栏快捷预设（Me / Head / Reset） | ✅ 已落地 | `src/components/GitLogView/FilterBar.tsx` |
| 快捷键 | ✅ 已落地 | `Alt+9` / `Alt+0` / `Ctrl+K` / `Ctrl+T` / `Ctrl+Shift+K` / `Esc` 在 `src/App.tsx`；`F7` / `Shift+F7` 在 `SideBySideDiff.tsx`；`Ctrl+Enter` 在 `CommitActionBox.tsx`；空格勾选在 `ChangelistTree.tsx`。`F7`、空格和 `Ctrl+T` 会避开输入框；`Alt+9` / `Ctrl+K` 没有这层判断 |
| 分支比较与 Shelf | ✅ 已落地 | `compare_branches`：差异文件列表，双击开双栏 Diff。Shelf 可命名、恢复、删除，见 `src/components/ShelfStashView/` |
| 「10,000+ 提交虚拟滚动 60fps」 | ❌ 未实现 | 每页 200 条，最多加载 2 万条（`LOG_PAGE_SIZE` / `LOG_FETCH_CAP`），已加载行整页渲染。项目无虚拟化库 |

内存数字由 `App.tsx` 每 8 秒调用 `process_memory_mb`，显示在 `Header.tsx` 和 `StatusBar.tsx`。浏览器预览没有该命令时退化为 JS heap。

---

## 当时要解决的问题（2025-02，均已按上表落地）

1. 长路径被末尾截断，文件名丢失。
2. Git Log 表头和短哈希被右侧裁切。
3. 双栏 Diff 用横条把每个变更块隔开。
4. 系统标题栏和应用顶栏叠了两层。

之后补上的是可拖拽提交详情、Amend 回填、未跟踪文件忽略、Ahead/Behind、过滤预设、IDEA 快捷键、分支比较和 Shelf 闭环。

仍适用的三条原则：

1. **保尾截中**：目录可收缩，文件名保持完整。
2. **装订线操作**：Diff 操作放在行号或中缝，不在正文里插横条。
3. **色彩**：新增为绿、删除为玫红、修改为蓝。不要按「红增绿减」重做。

---

## 仍有效的约束

### 文件路径组件

只用 `src/components/common/FilePathDisplay.tsx`，不要再建第二套。

- props 为 `path`、`className?`、`filenameClassName?`。`filenameClassName` 必须保留，调用方用它传状态色。
- 内部先把 `\` 统一成 `/`。目录段可截断，文件名段不截断。`title` 挂完整路径。
- 没有目录段时输出单个 `span`。

### Commit 表格列宽

以 `src/components/GitLogView/CommitGraph.tsx` 为准：

- 表格是 `w-full table-fixed`。最小宽度走 `tableMinWidth` 的 `style`，不是 `min-w-[760px]`。
- `<colgroup>`：Graph 列用 `graphWidth`（按轨道数计算，**不得固定 80px**），Description 弹性，Author 128px，Date 112px，Commit 96px 且右对齐。
- 列头必须走 i18n：`graph.column.graph` / `description` / `author` / `date` / `commit`。禁止硬编码中英文。

---

## 验收口径

已满足、不必再开任务：

- 长路径能看到完整文件名。
- 勾选 Amend 会带出上一次提交说明，取消勾选不丢草稿。
- 多块 Diff 不再被横条隔断。
- 上表列出的快捷键可用。只有 `F7`、空格和 `Ctrl+T` 会避开输入框。

未实现，不要写成已具备：

- 常驻内存严格小于 60MB。这只是目标，界面显示的是实测 RSS。
- 一万条以上提交的虚拟滚动或 60fps 承诺。当前是分页加载加整页渲染。
