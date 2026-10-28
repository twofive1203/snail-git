---
title: feat: 左侧分支栏默认折叠与更新推送重命名
type: feat
status: completed
date: 2026-08-14
---

# feat: 左侧分支栏默认折叠与更新推送重命名

> **已完成，不要按正文里的「现状」重做。** 重命名输入后来改为 `askInput`（见 `docs/plans/2026-10-18-002-feat-backlog-five-items-plan.md` §C），不要恢复 `window.prompt`。`list_branches` 返回的 `upstream` 至今仍是 `None`；非当前分支的上游由更新和推送命令自己解析，这不是待办。

## Overview

日志页左侧分支栏（`src/components/GitLogView/BranchPanel.tsx`）打开时远程和标签默认收起，本地分支保持展开。本地分支右键补上 IDEA 里已有、这里还没有的「更新」「推送…」「重命名…」。

更新和推送要作用在被右键的那条本地分支上，而不是永远作用在当前 HEAD。当前分支继续走现有的完整更新和推送预览。其他本地分支可以推送；更新只做获取加快进，分叉时明确失败，不检出、不碰工作区。

难度判断：折叠和重命名很小；推送任意本地分支是中等偏小，因为预览和推送已经存在，缺的是源分支参数。任意分支的完整合并/变基才是大改，本计划不做。

---

## Problem Frame

用户对照 IDEA 的分支树：本地分支应默认展开，远程和标签可以关上。右键至少要有更新、推送、重命名。

现在 `BranchPanel` 的分组初始状态是 HEAD、本地、远程、标签全部展开。右键只有「在日志中显示 / 检出 / 比较 / 合并 / 变基」。远程行的菜单已经接近 IDEA 第二张图，缺的是本地行上的三个动作。

现有 Git 命令不能直接套到非当前分支：

- `update_repo` 只集成当前检出分支的上游，并带工作区覆盖确认。
- `preview_push` / `push_to` 的源永远是当前分支，`branch` 参数是远程目标名。对另一条本地分支直接打开现有推送框，会预览并推送 HEAD 的提交。
- `rename_branch` 已经可以用 `git branch -m` 重命名任意本地分支。

---

## Requirements Trace

- R1. 打开日志分支栏时，本地分支分组展开；远程和标签分组默认关闭。搜索命中时仍能看到匹配项。
- R2. 本地分支右键提供更新、推送、重命名。远程分支和标签不出现这三项。
- R3. 当前分支的更新仍走现有更新项目流程，包括脏工作区确认、合并/变基和贮藏。
- R4. 非当前本地分支的更新只获取并快进该分支引用，不检出、不修改工作区或当前 HEAD。不能快进时失败并说明原因，引用保持不动。
- R5. 推送预览和真正推送的源是被右键的本地分支。顶栏「推送」不传源分支时，行为与现在一致。
- R6. 重命名使用现有重命名命令。取消或同名不发请求。若日志正在按旧名过滤，成功后改到新名。

---

## Scope Boundaries

- 不改顶栏更新、推送、获取的入口语义。
- 不给远程分支和标签加更新、推送、重命名。
- 不在本计划实现 IDEA 菜单里的其余项：从该分支新建、签出并变基、显示与工作树的差异、删除、收藏。
- 不把非当前分支检出后再合并/变基，也不做临时 worktree 来解决非当前分支冲突。
- 不持久化分组展开状态，不加 F2 重命名快捷键。
- 不改 `ProjectSidebar` 和 `BranchesModal` 的操作抽屉；它们已有重命名，本计划只补日志左侧栏。

### Deferred to Follow-Up Work

- 非当前分支已分叉时的合并/变基：需要检出或临时 worktree，以及冲突界面，单独做。
- IDEA 其余右键项，以及分组展开状态记忆。

---

## Context & Research

### Relevant Code and Patterns

- `src/components/GitLogView/BranchPanel.tsx`：分组状态 `open` 初始全为 `true`；搜索时 `sectionOpen` 会按匹配结果展开。单个远程组用 `openRemotes`，默认是空集合，组内分支本来就是收起的。右键菜单是面板内固定定位浮层。
- `src/components/GitLogView/index.tsx`：只在日志页挂载。已把检出、比较、合并、变基传给 `BranchPanel`。`selectedBranch` 是日志过滤状态，重命名后不会自动跟着变。
- `src/App.tsx`：`handleUpdate` 走 `updateRepo` 和 `pendingConfirm`；`handlePush` / `confirmPush` 打开 `PushDialog`。重命名在分支弹窗里用 `prompt` 加 `renameBranch`。`finishNetwork` 会把 `SyncOutcome.ahead/behind` 写进状态栏。
- `src-tauri/src/git_ops.rs`：`update_repo`、`preview_push`、`push_to`、`rename_branch`。`push_to` 的 refspec 是 `{当前分支}:{远程目标}`。`list_branches` 的 `upstream` 目前恒为空，ahead/behind 只填当前分支。非当前分支是否有上游应由更新/推送命令自己解析，不要依赖列表字段。
- `src/services/gitService.ts`：`previewPush(repoPath, remote?, branch?)` 的 `branch` 是远程目标，不是本地源。
- `src/i18n/messages.ts`：中英两套文案。可复用 `header.update`、`header.push`、`branches.rename`、`toast.renamePrompt`，分支栏专有说明另加 `logBranches.*`。
- 前端 `package.json` 没有测试运行器。Git 行为测试在 `src-tauri/src/git_ops.rs` 底部，已有本地 bare 远程夹具，例如 `preview_push_lists_commits_and_can_retarget`。

### Institutional Learnings

- 无 `docs/solutions/`。`docs/design-specification.md` 把分支操作放在 Branches Widget，不覆盖这次的日志左侧栏。

### External References

- 未做外部检索。仓库里已有更新、推送预览和重命名的直接实现，够决定边界。

---

## Key Technical Decisions

- 默认只关远程和标签，HEAD 与本地保持展开。HEAD 只有一行，收起没有收益。搜索仍沿用「有匹配就展开」，清空搜索后回到用户没手动打开过的默认关闭。
- 切换仓库时重置分组开关；同仓库刷新分支列表时不重置。日志页离开再进入会卸载组件，自然回到默认。不把展开状态写入本地存储。
- 当前分支「更新」直接调用现有 `handleUpdate`，不经过新命令。这样脏工作区确认、贮藏和合并/变基不会被重写。
- 非当前分支「更新」是新的窄命令：获取该分支上游所在远程，然后只用快进 refspec 移动 `refs/heads/<name>`。禁止 `+` 强制更新，禁止 checkout。没有上游时只刷新远程并说明未合并。已分叉、需要变基或不能快进时返回 `blocked`，分支引用不动。
- 非当前更新/推送的 `SyncOutcome.ahead/behind` 仍表示当前 HEAD，避免 `applySyncCounts` 把状态栏改成另一条分支的超前落后。被操作分支的差异只出现在提示文案和推送预览里。操作结束后照旧刷新快照。
- 推送增加可选本地源。省略时保持现在的「源是当前分支」。右键传入被点的本地分支后，预览范围、默认远程目标和 `push` refspec 都基于该源，而不是只把远程目标名预填成同名。推送框里的源在这次打开期间固定，用户仍可改远程和远程分支名。
- 分离头指针时，顶栏更新/推送维持现在的失败。右键其他本地分支仍允许推送和快进更新，因为这两条新路径不要求当前检出是分支。
- 重命名继续用系统 `prompt`，与 `BranchesModal` 一致，不新做对话框。
- 三个新菜单项之间加分隔，放在现有检出/比较/合并/变基之后。菜单底部空间按新增项加大，避免被窗口裁切。

---

## Open Questions

### Resolved During Planning

- 更新/推送是否只做当前分支：用户倾向对齐 IDEA，任意本地分支都要能操作。因此不采用「非当前分支禁用」方案。
- 非当前分支更新做到哪一步：做到快进。完整合并/变基会把难度从中等拉到大，因为必须动工作区或临时 worktree，还要接冲突界面。本计划明确不做。

### Deferred to Implementation

- 新命令和辅助函数的具体名字。
- 快进 refspec 用 `fetch` 写入还是先判断祖先再更新引用。约束是：非快进必须失败且不移动引用，不能使用强制更新。
- 提示文案的最终用词，只要中英都有，并且能区分「没有上游」「已是最新」「不能快进，请先检出」。

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

右键动作按行类型分流：

| 行 | 更新 | 推送 | 重命名 |
|---|---|---|---|
| 当前本地分支 | 现有更新项目 | 现有推送框，源为当前分支 | 现有重命名 |
| 其他本地分支 | 获取 + 快进该引用；不能快进则失败 | 推送框的源固定为该分支 | 现有重命名 |
| 远程分支、标签 | 不显示 | 不显示 | 不显示 |

非当前分支更新的结果：

| 情况 | 结果 |
|---|---|
| 无上游 | 可以获取远程，不移动该分支，提示未合并 |
| 上游是该分支的后代，或已相同 | 快进或报告已是最新；HEAD 和工作区不变 |
| 已分叉、落后但不是快进、或变基策略无法在未检出时执行 | `blocked`，引用不动，提示先检出 |
| 名字不是本地分支，或误把当前分支送进这条窄路径 | 拒绝，让当前分支继续走原更新 |

---

## Implementation Units

```mermaid
flowchart TB
  U1[U1 默认折叠]
  U2[U2 按源分支推送]
  U3[U3 非当前分支快进更新]
  U4[U4 右键接线]
  U2 --> U4
  U3 --> U4
```

- [x] U1. **默认收起远程和标签**

**Goal:** 打开分支栏时只展开 HEAD 和本地，远程与标签默认关闭，搜索和手动展开仍然可用。

**Requirements:** R1

**Dependencies:** None

**Files:**
- Modify: `src/components/GitLogView/BranchPanel.tsx`
- Modify: `src/components/GitLogView/index.tsx`
- Test: 无前端测试运行器，不新增测试框架

**Approach:**
- 分组初始状态改为 HEAD 和本地打开，远程和标签关闭。不要顺手把单个远程组默认展开。
- 给面板一个仓库标识。仓库变化时恢复默认分组，并清空已展开的远程组。同一次停留里的分支列表刷新不能把用户刚打开的分组关掉。
- 搜索展开逻辑保持现状：有匹配才临时展开，清空后回到当前开关状态。

**Patterns to follow:**
- `BranchPanel` 现有的 `sectionOpen` 和 `openRemotes`。
- `GitLogView` 已有的 `repoPath`。

**Test scenarios:**
- Happy path: 首次进入日志页，本地分支行可见，远程分组和标签分组的子行不可见，HEAD 行可见。
- Happy path: 点开远程后能看到远程名；远程组内分支仍默认收起，再点远程名才列出分支。标签同理。
- Edge case: 搜索词只命中某个远程分支或标签时，对应分组临时展开并显示匹配行；清空搜索后，若用户没有手动打开该分组，它回到关闭。
- Edge case: 同一仓库刷新分支后，用户已打开的远程分组保持打开。换成另一个仓库后，远程和标签回到关闭。
- Integration: 分支栏收起成窄条再展开，分组默认状态不丢；离开日志页再回来，回到默认关闭。

**Verification:**
- 不搜索时，第一眼只能看到 HEAD 和本地分支，看不到标签列表，也看不到展开后的远程分支。

---

- [x] U2. **按指定本地分支预览并推送**

**Goal:** 推送的提交来自被选中的本地分支；省略源分支时，顶栏推送与现在相同。

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `src-tauri/src/git_ops.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/gitService.ts`
- Modify: `src/components/PushDialog.tsx`
- Test: `src-tauri/src/git_ops.rs`

**Approach:**
- 为预览和推送增加可选本地源。空源保持现有路径，包括分离头指针时的现有失败。
- 有源时校验它是本地分支。预览的提交范围、ahead/behind、默认远程和默认目标来自该源的上游；没有上游时目标默认为该源同名，远程选择沿用现有 `choose_remote` 规则。
- 真正推送的 refspec 源是该本地分支，目标仍是对话框里的远程分支。设置上游时写到源分支，不改当前检出分支的上游。
- `SyncOutcome` 的计数继续描述当前 HEAD，避免状态栏被另一条分支污染。
- `PushDialog` 接受可选源。右键打开时源固定并让用户看见将推送哪条本地分支；顶栏打开时不传源。不要把源参数塞进现有的远程目标 `branch` 字段。

**Patterns to follow:**
- `preview_push_lists_commits_and_can_retarget` 的 bare 远程夹具。
- `push_to` 现有的远程名和分支名校验。新源也要拒绝含 `:` 等 refspec 元字符的名字。

**Test scenarios:**
- Happy path: 当前在 `main`，另有 `feature` 且比 `main` 多一个提交。预览源为 `feature` 时列出的是 `feature` 的提交，不是 HEAD 的全部提交。推送后远程出现 `feature`，当前分支仍是 `main`。
- Happy path: 不传源时，预览和推送仍以当前分支为源，现有「推到其他远程分支名不会改本地分支名」仍然成立。
- Edge case: 源分支已有上游时，默认远程和目标是它自己的上游，不是当前分支的上游。
- Edge case: 源分支没有上游时，预览仍能列出将新建的远程分支，且不会把当前分支的上游写成这个源。
- Error path: 源不是本地分支、远程不存在、或分支名含 refspec 分隔符时失败，不发起会移动错误引用的推送。
- Integration: 请求设置上游后，源分支跟踪新远程目标；当前分支原有上游不变。分离头指针时，带明确源的推送仍可预览该本地分支。

**Verification:**
- 右键非当前分支打开的预览，提交列表属于该分支。顶栏推送在不改调用的情况下与改前一致。

---

- [x] U3. **快进更新非当前本地分支**

**Goal:** 右键其他本地分支时，能安全地把它快进到已获取的上游，失败时不留下半更新状态。

**Requirements:** R3, R4

**Dependencies:** None

**Files:**
- Modify: `src-tauri/src/git_ops.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/gitService.ts`
- Test: `src-tauri/src/git_ops.rs`

**Approach:**
- 新增窄入口，不把分支名塞进 `update_repo`。当前分支的脏工作区状态机保持原样。
- 窄入口若发现目标就是当前分支，直接拒绝，由界面改走现有更新。这样不会出现两条更新语义。
- 解析该分支自己的上游，而不是 HEAD 的 `@{upstream}`。获取对应远程，进度和 prune 与现有项目更新保持同一类，避免右键更新和顶栏更新对远程跟踪引用的清理不一致。无上游时获取可以成功，但不得移动分支。
- 只有快进才移动 `refs/heads/<name>`。已分叉或不能快进时返回 `blocked` 和可理解的原因。不得 checkout，不得贮藏，不得改索引或工作区文件。
- 结果计数仍是当前 HEAD 的 ahead/behind。提示文案说明被操作的是哪条分支。

**Patterns to follow:**
- `update_repo` 的获取进度、网络暂停和远程选择。
- 现有更新测试里「不重叠的落后更新应快进」只覆盖当前分支；新测试要证明非当前路径不会移动 HEAD。

**Test scenarios:**
- Happy path: 当前在 `main`，`feature` 的上游比 `feature` 超前且可以快进。更新后 `feature` 指向上游，`main`、HEAD 和工作区文件不变。
- Happy path: `feature` 已经等于上游时，状态为已是最新，引用不变。
- Edge case: `feature` 没有上游时，分支尖端不变，结果说明已刷新但未合并。
- Error path: `feature` 与上游分叉时状态为 `blocked`，`feature` 和 HEAD 都停在原提交。
- Error path: 把当前分支名送进窄入口时拒绝，不重复执行一套合并。
- Integration: 工作区有未提交修改时，快进另一条分支仍然成功，未提交文件保持原样。

**Verification:**
- 非当前分支更新要么只快进该引用，要么完整失败。当前分支更新的确认弹窗和合并/变基路径没有被这条新命令接管。

---

- [x] U4. **把更新、推送、重命名接进本地分支右键**

**Goal:** 本地分支右键能触发上述三个动作，并把结果交回现有提示、确认和刷新流程。

**Requirements:** R2, R3, R5, R6

**Dependencies:** U2, U3

**Files:**
- Modify: `src/components/GitLogView/BranchPanel.tsx`
- Modify: `src/components/GitLogView/index.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/messages.ts`
- Test: 菜单接线无前端测试运行器；Git 语义由 U2、U3 的 Rust 测试覆盖

**Approach:**
- 只在本地分支菜单追加三项。远程和标签菜单保持现有五项。
- 当前分支的更新调用现有 `handleUpdate`。其他本地分支调用 U3，并走现有网络操作锁和进度提示。`blocked` 只提示，不打开工作区覆盖确认框。
- 推送调用现有打开推送框的路径，并带上 U2 的源。顶栏按钮继续不带源。推送框已经打开时再右键另一条分支，也要换成新源并重新预览，不能继续显示上一条分支的提交。预览环境没有 Tauri 时，沿用现有「不能写入」提示。
- 重命名沿用分支弹窗的 `prompt` 和 `run`。用户取消、输入空白或与旧名相同，不调用后端。成功后若日志过滤或面板选中的是旧名，改为新名。失败时过滤名不变。
- 中英文字案都加。菜单变高后，定位要仍落在窗口内。

**Patterns to follow:**
- `App.tsx` 里 `BranchesModal` 的 `onRename`。
- `handleUpdate`、`handlePush`、`guardNetwork` 和 `run` 的锁与提示。
- `BranchPanel` 现有 `MenuButton` 的禁用样式。

**Test scenarios:**
- Happy path: 右键当前本地分支，三项都可见。更新走现有确认流程；推送框显示的本地源是当前分支；重命名成功后分支列表和当前分支名变为新名。
- Happy path: 右键另一条本地分支，推送框的源是该分支而不是 HEAD。可以快进时更新成功，日志和分支列表刷新。
- Edge case: 右键远程分支或标签，菜单里没有更新、推送、重命名，原有检出、比较、合并、变基仍在。
- Edge case: 重命名对话框取消，或新名等于旧名，不出现重命名成功提示，选中过滤不变。
- Error path: 非当前分支不能快进时，出现失败提示，不弹出贮藏/覆盖确认，当前检出分支不变。
- Error path: 非 Tauri 预览里点这三项，只提示不能写入，不调用 Git。
- Integration: 日志过滤正停在被重命名的分支上时，成功后过滤跟着新名，而不是继续查询已不存在的旧名。顶栏推送仍不带源。

**Verification:**
- 本地行能完成三个动作；远程和标签行的菜单没有变长。当前分支的脏工作区更新确认仍然出现在原流程里。

---

## System-Wide Impact

- **Interaction graph:** 日志分支栏、顶栏更新/推送、`PushDialog`、状态栏 ahead/behind、日志分支过滤、仓库刷新。分支弹窗和项目侧栏不接这套新菜单。
- **Error propagation:** Git 失败继续用现有 toast。非当前更新的 `blocked` 是预期失败，不是需要确认的脏工作区冲突。
- **State lifecycle risks:** 推送或更新另一条分支时，不能把该分支的 ahead/behind 写进当前仓库状态栏。重命名失败不能先改过滤名。分组开关不能在普通刷新时丢失，也不能串到下一个仓库。
- **API surface parity:** 顶栏推送和更新是同一套命令的旧调用，必须保持旧参数语义。分支弹窗不要求同时出现这三个新动作。
- **Integration coverage:** Rust 测试覆盖 refspec 和快进边界。菜单与确认框的衔接靠 U4 的手工场景，因为没有前端测试运行器。
- **Unchanged invariants:** `update_repo` 的确认状态机、顶栏获取、远程分支检出/合并/变基、标签检出都不改。

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| 只预填远程分支名，预览仍读取 HEAD，推错提交 | 源分支是独立参数；测试要求预览提交属于源分支 |
| 非当前操作把状态栏计数改成另一条分支 | 结果计数保持 HEAD 语义，结束后刷新快照 |
| 快进实现使用强制 refspec，覆盖已分叉分支 | 禁止强制更新；分叉用例断言引用不变 |
| 新更新入口误走当前分支的合并状态机，或反过来 | 当前分支只走旧入口；窄入口拒绝当前分支 |
| 含 `/` 或中文的分支名在 refspec 中被拆错 | 参数走命令参数数组，不经 shell；拒绝 `:` 等元字符 |
| 菜单项变多后超出窗口 | 定位时按菜单高度钳制，不固定旧的 180 像素预留 |

---

## Documentation / Operational Notes

- 不新增用户文档。分支栏文案进 `src/i18n/messages.ts` 的中英表。
- 没有新的环境变量、权限或迁移。

---

## Sources & References

- Related code: `src/components/GitLogView/BranchPanel.tsx`
- Related code: `src/App.tsx`
- Related code: `src-tauri/src/git_ops.rs`
- Related code: `src/services/gitService.ts`
