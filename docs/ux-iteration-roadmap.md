# EasyGit 产品体验优化与迭代开发规划文档 (UX Iteration Roadmap)

> **版本**：v1.0.0  
> **制定日期**：2025-02  
> **文档定位**：指导 EasyGit 从“可用原型”向“工业级轻量 Git 生产力工具”迈进的交互体验与界面工程迭代路线图。  
> **核心指标**：保持常驻内存 < 50MB、秒级启动、1:1 复刻 JetBrains IntelliJ IDEA 核心 Git 交互心智。

---

## 目录
- [一、 现状诊断与体验演进原则](#一-现状诊断与体验演进原则)
- [二、 迭代版本里程碑概览](#二-迭代版本里程碑概览)
- [三、 Sprint 1 (P0)：排版纠偏与关键信息透出 (首周交付)](#三-sprint-1-p0排版纠偏与关键信息透出-首周交付)
- [四、 Sprint 2 (P1)：Diff 体验革新与提交闭环 (第 2-3 周)](#四-sprint-2-p1diff-体验革新与提交闭环-第-2-3-周)
- [五、 Sprint 3 (P2)：桌面沉浸感与状态感知 (第 4 周)](#五-sprint-3-p2桌面沉浸感与状态感知-第-4-周)
- [六、 Sprint 4 (P3)：全键盘流与高级能力对齐 (第 5 周+)](#六-sprint-4-p3全键盘流与高级能力对齐-第-5-周)
- [七、 关键改动技术落地指南与代码规范](#七-关键改动技术落地指南与代码规范)
- [八、 验收标准 (Definition of Done)](#八-验收标准-definition-of-done)

---

## 一、 现状诊断与体验演进原则

### 1.1 现状诊断核心痛点
结合目前系统截屏，主要存在以下四类体验摩擦：
1. **关键语义遮蔽**：长路径被纯末尾截断（Ellipsis），开发者无法获知究竟改动了哪个文件（类名丢失）；长分支名挤压提交说明。
2. **布局边缘残缺**：Git Log 表格右侧 Commit 列头丢失、短哈希贴边截断，破坏界面的工整感。
3. **代码阅读割裂**：Side-by-Side Diff 在每个变更块上方插入贯穿全宽的横向控制条，高频修改时代码被大块隔断，破坏代码垂直阅读连贯流。
4. **双层顶栏冗余**：操作系统原生标题栏与应用内部 Header 叠加，浪费了 32px 纵向视野。

### 1.2 体验设计三原则
1. **保尾截中（Middle Truncate First）**：路径优先保证文件名与根目录可见，省略冗余的长包名；分支名设定上限并提供完整 Tooltip。
2. **装订线操作（Gutter-first Actions）**：代码 Diff 操作尽量归拢到行号侧边或中间装订线，不在正文行间强插断点横条。
3. **零认知迁移（Zero Mental Cost）**：快捷键、色彩语义（红增绿减蓝改）、列表层级全面对齐 IntelliJ IDEA。

---

## 二、 迭代版本里程碑概览

| 阶段 | 周期 | 核心主题 | 关键交付物 |
| :--- | :---: | :--- | :--- |
| **Sprint 1 (P0)** | 3-5 天 | **视觉纠偏与信息透出** | 表格右侧溢出修复、路径“保尾截中”组件、分支徽章紧凑化 |
| **Sprint 2 (P1)** | 1-2 周 | **Diff 与 Commit 交互革命** | 装订线悬浮操作块（去横栏化）、可拖拽 Splitter、Amend 智能回填、未跟踪文件忽略 |
| **Sprint 3 (P2)** | 1 周 | **桌面端沉浸感与状态透出** | Tauri CSD 无边框一体化标题栏、Ahead/Behind 上下行角标、筛选快捷预设 |
| **Sprint 4 (P3)** | 持续 | **全键盘流与高级能力** | IDEA 纯键盘快捷操作流、分支差异对比 (Compare With)、Shelf 管理闭环 |

---

## 三、 Sprint 1 (P0)：排版纠偏与关键信息透出 (首周交付)

### 任务 1.1：Git Log 表格表头对齐与 Commit 列修复
- **涉及组件**：`src/components/GitLogView/CommitGraph.tsx`
- **问题**：`thead` 的 `Commit` 列头被右侧边缘切除，且与内容单元格未固定对齐。
- **改造要点**：
  1. 为 `table` 添加 `table-fixed`，给各列设定严格的比例或固定像素宽：
     - `Graph`: 固定 `w-20` (80px)
     - `Commit`: 固定 `w-24` (96px)，靠右对齐
     - `Date`: 固定 `w-28` (112px)
     - `Author`: 固定 `w-32` (128px)
     - `Description`: 弹性宽度（自动填满剩余空间）
  2. 外层包裹容器配置 `overflow-x-auto`，并设定表格最小宽度 `min-w-[760px]`，保证小屏幕下不会压缩变形。
  3. 给短哈希单元格预留 8px 内边距，避免紧贴系统滚动条。

### 任务 1.2：全局文件路径“保尾截中”展示重构
- **涉及组件**：
  - `src/components/GitLogView/CommitDetail.tsx` (Changed Files 列表)
  - `src/components/CommitView/SideBySideDiff.tsx` (顶部路径)
  - `src/components/CommitView/ChangelistTree.tsx`
- **改造要点**：
  1. 封装通用路径展示组件 `<FilePathDisplay path={path} />`。
  2. 将路径拆解为两部分：`dir`（父级目录路径）与 `filename`（文件名）。
  3. 渲染样式规范：
     ```html
     <!-- 目录部分：浅灰弱化、支持收缩截断；文件名部分：高亮粗体、永远完整展示 -->
     <div className="flex items-center min-w-0 font-mono text-xs" title={path}>
       <span className="text-[#8C9099] truncate shrink min-w-0">{dir}/</span>
       <span className="text-[#DFE1E5] font-medium shrink-0">{filename}</span>
     </div>
     ```
  4. 根治“长包名吃掉关键类名”的痛点。

### 任务 1.3：长分支名与 Ref 徽章的紧凑折叠策略
- **涉及组件**：`src/components/GitLogView/CommitGraph.tsx`
- **改造要点**：
  1. 移除冗余字符串：如果是当前 HEAD 分支，不再直接输出字面量 `HEAD -> `，改用绿色实心小圆点 + 分支名。
  2. 限制单个 Ref Badge 最大宽度为 `max-w-[200px]`，配合 `truncate`。
  3. 鼠标悬停（Hover）在 Badge 上时，原生 Tooltip 或浮层展示完整引用名。
  4. 当同一提交存在多个 Tag 或远程分支时，超过 2 个的自动收纳为 `+N` 胶囊，点击展开。

---

## 四、 Sprint 2 (P1)：Diff 体验革新与提交闭环 (第 2-3 周)

### 任务 2.1：双栏 Diff 变更块装订线化（去横栏化，还原 IDEA 手感）
- **涉及组件**：`src/components/CommitView/SideBySideDiff.tsx`
- **问题**：每个变更块顶部的 `Unstaged Chunk @@...` 横条强行撕裂代码，长代码可读性差。
- **改造要点**：
  1. **取消跨栏横向大 Bar**：改将 Chunk 信息合并至第一行或作为行内低对比度行标记（Ghost Row）。
  2. **中缝装订线操作（Gutter Actions）**：
     - 在左右栏之间的分隔中缝（或右栏行号左侧），为每个变更块渲染悬浮操作区。
     - 鼠标悬浮在该变更块区域时，显示微型操作按钮：
       - `>>`（应用此块暂存，或勾选框）
       - `↶`（回滚丢弃此块变更）
  3. 恢复代码垂直视角的连续性，只有代码本身在流动。

### 2.2：提交详情抽屉（Commit Detail）引入左右可拖拽 Splitter
- **涉及组件**：`src/components/GitLogView/CommitDetail.tsx`、`src/components/GitLogView/index.tsx`
- **改造要点**：
  1. 去除 `w-full md:w-1/2` 固化比例。
  2. 引入 `SplitPane`（或纯 CSS + onMouseDown 拖拽计算实现）：
     - 默认左侧（提交说明与元数据）占 40%，右侧（Changed Files）占 60%。
     - 用户可自由左右拖动，宽度持久化记录到 `localStorage`。
  3. **父提交快速导航**：
     - 点击 `Parents: [55c3accc]` 蓝色标签，触发 `onSelectCommit(parentHash)`，并在 CommitGraph 中滚动定位至该提交行。

### 任务 2.3：Commit Action 交互打磨与智能规范
- **涉及组件**：`src/components/CommitView/CommitActionBox.tsx`
- **改造要点**：
  1. **Amend 智能回填**：
     - 当勾选 `Amend Commit` 复选框时，自动拉取上一次提交的 `message` 回填至输入框；取消勾选时还原原有输入内容。
  2. **字符数与规范提示**：
     - 提交输入框右下方增加实时计数器（如 `42 / 72`）。
     - 遵循 Git 50/72 黄金法则：首行超过 50 字符时计数显示为琥珀黄，超过 72 字符显示为轻度告警红。
  3. **前缀点击自动聚焦**：
     - 点击 `feat:` 等前缀胶囊后，不仅完成前缀替换，光标自动重新聚焦回 `textarea` 末尾，避免用户二次点击鼠标。

### 任务 2.4：未跟踪文件（Untracked）降噪与 Ignore 管理
- **涉及组件**：`src/components/CommitView/ChangelistTree.tsx`
- **改造要点**：
  1. 路径斜杠统一：将所有 Windows 反斜杠 `\` 统一过滤转换为 `/`。
  2. 未版本管理文件右键上下文菜单增加：
     - `添加到 .gitignore` (Add to .gitignore)：追加行到工作区 `.gitignore` 文件。
     - `删除文件` (Delete Unversioned File)：确认后物理删除。
  3. 已修改文件区分色彩：
     - Modified：蓝色（`#589DF6`）
     - Added/Untracked：绿色（`#59A869`）或橄榄灰
     - Conflict：醒目玫红（`#E35967`）

---

## 五、 Sprint 3 (P2)：桌面沉浸感与状态感知 (第 4 周)

### 任务 3.1：Tauri 自定义一体化标题栏（CSD, Client-Side Decoration）
- **涉及文件**：`src-tauri/tauri.conf.json`, `src/components/Header.tsx`, 新建 `src/components/WindowControls.tsx`
- **改造要点**：
  1. 修改 `tauri.conf.json`：`"decorations": false`（禁用 Windows 原生白底/黑底标题栏）。
  2. 在 Header 顶层容器添加 Tauri 拖拽属性 `data-tauri-drag-region`。
  3. 右上角实现与 Windows 11/10 风格一致的自定义窗口控制组件：
     - 最小化 (`appWindow.minimize()`)
     - 最大化 / 还原 (`appWindow.toggleMaximize()`)
     - 关闭 (`appWindow.close()`)
  4. **收益**：释放整整 **32px~36px** 的纵向代码显示区域，视觉无缝融合，质感飞跃。

### 任务 3.2：分支双向同步状态感知（Ahead / Behind Badges）
- **涉及组件**：`src/components/Header.tsx`, `src/components/StatusBar.tsx`
- **改造要点**：
  1. 引入并计算当前本地分支与上游 Tracking 分支的超前/落后状态：
     - `ahead`: 本地待推送提交数
     - `behind`: 远端待拉取提交数
  2. 在顶部工具栏与底部状态栏做显性提示：
     - `Update` 按钮旁出现角标：`↓3`（黄色）
     - `Push` 按钮旁出现角标：`↑2`（蓝色）
  3. 执行 Update/Push 时，对应图标替换为平滑旋转的 loading Spinner，操作中按钮置灰防重复提交。

### 任务 3.3：多维过滤栏的常用快捷预设（Quick Filters）
- **涉及组件**：`src/components/GitLogView/FilterBar.tsx`
- **改造要点**：
  1. 在筛选栏最左侧增设两个极高频点击的一键开关：
     - `[★ 仅看我的 (Me)]`：一键锁定 `User: 当前 Git 配置用户名`。
     - `[⑂ 当前分支 (Head)]`：一键锁定 `Branch: HEAD`。
  2. 支持一键重置当前所有过滤条件（Reset Filters）。

---

## 六、 Sprint 4 (P3)：全键盘流与高级能力对齐 (第 5 周+)

### 任务 4.1：IDEA 经典全键盘流无缝适配
- **快捷键对齐清单**：
  - `Alt + 9`：切换至 Git Log 视图（已支持）
  - `Alt + 0` / `Ctrl + K`：切换至 Commit & Diff 视图（对齐）
  - `Ctrl + T`：触发 Update Project（拉取）
  - `Ctrl + Shift + K`：触发 Push 对话框
  - `Space`（空格）：在 ChangelistTree 树中快速切换当前选中文件/文件夹的勾选状态
  - `F7` / `Shift + F7`：在双栏 Diff 中平滑跳转下一个 / 上一个差异块（已支持，强化滚动平滑度）
  - `Esc`：焦点从弹窗或输入框退出，快速回到列表
- **防冲突设计**：确保在输入框（input, textarea）内输入时不误触全局单键快捷指令。

### 任务 4.2：分支比对与架藏管理闭环
- **分支比对 (Compare With Current)**：
  - 在 Branches 浮窗或 Git Log 分支右键菜单中，点击 `Compare with Current`，列出两分支间全部差异文件树，支持双击查看双栏 Diff。
- **Shelf (架藏) 视图易用性**：
  - 点击底部/面板的 `Shelve Changes` 后，弹窗允许命名；在 Tab 栏或独立抽屉可一键查看已架藏清单并执行 `Unshelve` 与清理。

---

## 七、 关键改动技术落地指南与代码规范

### 7.1 文件路径“保尾截中”组件实现示范
```tsx
// src/components/common/FilePathDisplay.tsx
import React from 'react';

interface FilePathDisplayProps {
  path: string;
  className?: string;
}

export const FilePathDisplay: React.FC<FilePathDisplayProps> = ({ path, className = '' }) => {
  const normalized = path.replace(/\\/g, '/');
  const lastSlashIndex = normalized.lastIndexOf('/');
  
  if (lastSlashIndex === -1) {
    return <span className={`font-mono text-xs text-[#DFE1E5] font-medium ${className}`}>{normalized}</span>;
  }

  const dir = normalized.substring(0, lastSlashIndex + 1);
  const filename = normalized.substring(lastSlashIndex + 1);

  return (
    <div className={`flex items-center min-w-0 font-mono text-xs ${className}`} title={normalized}>
      <span className="text-[#8C9099] truncate shrink min-w-0">{dir}</span>
      <span className="text-[#DFE1E5] font-medium shrink-0 group-hover:text-white transition-colors">
        {filename}
      </span>
    </div>
  );
};
```

### 7.2 Commit 表格 fixed 布局规范示范
```tsx
// src/components/GitLogView/CommitGraph.tsx
<table className="w-full table-fixed border-collapse text-xs font-sans min-w-[760px]">
  <thead className="sticky top-0 bg-jb-panel/95 border-b border-jb-border z-10 text-jb-text-muted font-medium select-none shadow-sm">
    <tr>
      <th className="py-1.5 px-3 text-left font-normal w-20">Graph</th>
      <th className="py-1.5 px-2 text-left font-normal">Description</th>
      <th className="py-1.5 px-2 text-left font-normal w-32">Author</th>
      <th className="py-1.5 px-2 text-left font-normal w-28">Date</th>
      <th className="py-1.5 pr-4 text-right font-normal w-24">Commit</th>
    </tr>
  </thead>
  <tbody>
    {/* ... */}
  </tbody>
</table>
```

---

## 八、 验收标准 (Definition of Done)

每个 Sprint 提测前需通过以下可用性与视觉验收：

1. **界面像素级核查**：
   - [ ] 窗口缩小至 900x600 最小尺寸时，各主栏目无遮挡破坏，表头与内容列严丝合缝。
   - [ ] 任意长路径（> 80 字符）的文件，必须能在界面中清晰完整看到文件名后缀。
   - [ ] 分支名 > 30 字符时，能够合理截断并不遮挡 Commit Message。
2. **操作流畅度与心智检验**：
   - [ ] 勾选 Amend 时自动带出上一次提交内容，取消勾选时原草稿不丢失。
   - [ ] 双栏 Diff 在多 Chunk 时代码垂直排列不产生断层，行号对齐准确无漂移。
   - [ ] 常用 IDEA 快捷键无按键冲突且符合 Muscle Memory。
3. **系统性能基线守底**：
   - [ ] 常驻内存占用严格保持在 **< 60MB**。
   - [ ] 切换 10,000+ 级提交的大型仓库时，列表滚动帧率稳定在 60fps（虚拟滚动完备）。
