# SnailGit 🚀

> 极致轻量、内存占用 < 60MB 的开源 IntelliJ IDEA 风格 Git 管理工具。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF.svg)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB.svg)](https://reactjs.org/)
[![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.x-38B2AC.svg)](https://tailwindcss.com/)

---

## 💡 为什么做 SnailGit？

很多重度开发者极度喜爱 **IntelliJ IDEA 的 Git 交互与版本控制体系**（无可挑剔的 Git Log 拓扑图、便捷的行级 Partial Commit、顺手的双栏 Diff 比对、本地安全的 Shelf 架藏、以及强大的 3-Way Merge 冲突解决）。

然而，IDEA 作为一个重型 IDE，往往需要占用 **2.5 GB ~ 4 GB+** 的内存，并伴随着漫长的启动时间和频繁的索引构建。如果只是想快速查看 Git 历史、对比分支、提交代码或挑拣提交（Cherry-pick），启动 IDEA 极其沉重。

**SnailGit 的目标就是将 IDEA 的 Git 核心体验完全复刻并独立出来**，作为独立轻量桌面客户端（未来结合 Tauri）或本地 Web 服务运行，将常驻内存从几千兆压减至 **40MB~80MB**，秒级启动，手感丝滑。

---

## ✨ 核心特性（1:1 复刻 IDEA）

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
秒级唤起原生独立桌面应用窗口，常驻内存仅约 40MB~50MB，无缝调用本地 Git 执行器。

### 4. 构建发布桌面生产安装包 (.exe / .msi / .dmg / .deb)
```bash
pnpm tauri build
```

---

## 🗺️ 后续路线图 (Roadmap)

- [x] **Phase 1**：IDEA Git 功能深度调研与高保真交互前端原型
- [x] **Phase 2**：接入轻量 Native 宿主（Tauri 2.0 / Rust），搭建跨平台桌面端骨架与双模架构
- [x] **Phase 3**：真实 Git 数据流（状态、日志、diff、提交、分支、stash、shelf）与 `.git` 变化刷新
- [x] **Phase 4**：快捷键对齐 IDEA（Ctrl+K, Ctrl+T, Ctrl+Shift+K, Alt+9, Alt+0, F7/Shift+F7, Ctrl+Enter）
