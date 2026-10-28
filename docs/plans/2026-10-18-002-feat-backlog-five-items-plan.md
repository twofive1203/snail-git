---
title: feat: 五项待补能力（中断收尾、Tag 写操作、输入弹窗、强制推送、Changelist 管理）
type: feat
status: done
last-updated: 2026-10-18
date: 2026-10-18
---

# feat: 五项待补能力

> 进度：§A–§E **全部已完成**。
> - §A：`repo_state` / `continue_operation` / `abort_operation` + 全局动作条。
> - §B：`create_tag` / `delete_tag` / `push_tag` / `delete_remote_tag` + 分支面板与提交右键入口。
> - §C：`askInput` + `InputDialog` + 共用 `dialogQueue`，7 处 `window.prompt` 已清零。
> - §D：`push_to` 新增 `force`（只发 `--force-with-lease`）+ `needs_force` 状态 + `PushPreview.needsForce`。
> - §E：Changelist 重命名/删除 + `DEFAULT_LIST`/`ALL_LISTS` 常量（存储值不变）。

## Overview

本文件是**已完成的实现记录**（立项时的待执行清单，§A–§E 已全部落地，见 `43268ca`）。当初这五项是排查“命令已注册但 UI 无入口 / UI 有入口但后端缺命令”后确认的真实缺口；现在保留全文用于追溯设计取舍与踩过的坑。

各节内的「现状」「Files」「Approach」「Test scenarios」是**开工前的快照与设计记录**，其中的行号与“缺失”描述不代表当前代码。判断实际行为一律看各节顶部的「状态」段和代码本身。

| 编号 | 能力 | 当时的缺口性质 | 难度 | 顺序 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| A | 合并 / 变基 / 挑拣的中止与继续 | 后端命令都没注册，UI 无入口 | 中 | 1 | ✅ 已完成 |
| B | Tag 新建 / 删除 / 推送 | 后端只有 `git tag` 只读列举 | 中 | 2 | ✅ 已完成 |
| C | 输入弹窗统一（替换 7 处 `window.prompt`） | 纯前端，无后端改动 | 小 | 3 | ✅ 已完成 |
| D | 强制推送（`--force-with-lease`） | 后端缺参数，UI 缺开关 | 中偏小 | 4 | ✅ 已完成 |
| E | Changelist 重命名 / 删除 | 纯前端 + localStorage | 小 | 5 | ✅ 已完成 |

---

## 0. 全局约束（每项都必须遵守）

- **Rust 命令链路四步齐全**（见根目录 `AGENTS.md` §4）：`git_ops.rs` 写 `pub fn` → `lib.rs` 加 `#[tauri::command]` 薄转发并登记进 `generate_handler![...]` → `gitService.ts` 加类型化封装 → 组件只调 `gitService.ts`。
- **git 参数一律数组**，禁止拼 shell 字符串、禁止 `cmd /c`；必须给显式超时（本地读写 `Duration::from_secs(...)`，网络 `NETWORK_TIMEOUT`）。
- **i18n 中英双表同时新增**：`src/i18n/messages.ts` 的 `zh` 与 `en` key 完全同名。JSX / `title` / `placeholder` / `aria-label` 里不得硬编码中英文。
- **不新增依赖**：无前端测试框架，Git 行为测试写在 `src-tauri/src/git_ops.rs` 底部 `#[cfg(test)]`，用 `pnpm test:rust` 跑。
- **文案分层**：Rust 侧错误是中文，前端直接展示，不要为后端错误造 i18n key。
- 每项完成后必须跑：`pnpm typecheck`、`pnpm lint`、`pnpm test:rust`。改到 Rust 还要 `pnpm lint:rust`。

---

## A. 合并 / 变基 / 挑拣的中止与继续

> 状态：**已实现**。后端 `repo_state` / `continue_operation` / `abort_operation` 已注册，前端入口在 `src/components/OperationBar.tsx`（全局动作条）与 `src/components/ThreeWayMergeModal.tsx` 底部动作区；状态在 `App.tsx` 的 `applySnapshot` 里随快照刷新。
> 实现取舍：`GIT_EDITOR`/`GIT_SEQUENCE_EDITOR` 取 `true`（让 git 接受默认提交信息）而不是 `false`（会直接失败）。

### 现状

- `merge --abort`、`rebase --abort`、`cherry-pick --abort` **只作为内部兜底出现**：`git_ops.rs:2829`（`abort_merge_if_any`）、`git_ops.rs:4396`、`git_ops.rs:4399`（`restore_squash_point`）。
- 三个命令都**没有注册成 `#[tauri::command]`**，`generate_handler!` 里也没有。
- 冲突解决后（`resolve_conflict` 只是 `git add` 该文件），**没有任何入口让用户完成合并提交或推进变基**。`commit_pending_merge` 是 `update_repo` 内部函数，前端调不到。
- 用户在变基冲突里只有一条出路：切到终端敲 `git rebase --continue`。

### 目标

用户在三方合并里把所有冲突标记为已解决后，能在应用内选择「继续」或「中止」，仓库回到确定状态。

### Requirements

- **R-A1** 能读出仓库当前的中断状态：合并中 / 变基中 / 挑拣中 / 还原中 / 无。
- **R-A2** 有冲突时提示继续会被 Git 拒绝，不能静默失败。
- **R-A3** 中止必须把工作区恢复到操作前，且不残留 `.git/MERGE_HEAD`、`rebase-merge` 等中间目录。
- **R-A4** 继续操作**不得打开编辑器**（无窗口进程里打开编辑器会挂死）。
- **R-A5** 无中断状态时，两个按钮不出现（而不是点了报错）。

### Files

- Modify: `src-tauri/src/git_ops.rs`（新增 `repo_state` / `continue_operation` / `abort_operation`）
- Modify: `src-tauri/src/lib.rs`（3 个薄转发 + `generate_handler!` 登记）
- Modify: `src/services/gitService.ts`（`RepoState` 类型 + 3 个封装，浏览器分支返回 `{ operation: 'none' }`）
- Modify: `src/App.tsx`（状态刷新时读 `repoState`，接线两个动作）
- Modify: `src/components/merge/MergeViewer.tsx` 或 `src/components/ThreeWayMergeModal.tsx`（底部动作区加「继续 / 中止」）
- Modify: `src/i18n/messages.ts`
- Test: `src-tauri/src/git_ops.rs`

### Approach

**状态探测**（不要用退出码猜，用 `rev-parse --git-path` 判断文件是否存在，仓库里已有这个模式：`merge_in_progress`、`rebase_in_progress`、`git_path_exists`）：

| 顺序 | 判定 | 依据 |
| :--- | :--- | :--- |
| 1 | rebase | `rebase-merge/` 或 `rebase-apply/` 存在 |
| 2 | merge | `MERGE_HEAD` 存在 |
| 3 | cherry-pick | `CHERRY_PICK_HEAD` 存在 |
| 4 | revert | `REVERT_HEAD` 存在 |
| 5 | none | 以上都无 |

同时返回 `unmergedPaths`（复用现成的 `unmerged_paths`），前端据此禁用「继续」。

**继续**：
- `rebase --continue`、`cherry-pick --continue`、`revert --continue` 都会走到 `git commit`，**会调编辑器**。下面草稿写的是 `GIT_EDITOR=false`。**未采用。** 实际取舍见本节顶部：`GIT_EDITOR` / `GIT_SEQUENCE_EDITOR` 取 `true`，让 git 接受默认提交信息；`false` 会直接失败。
- 合并的继续是 `git commit --no-edit --no-verify`（仓库已有 `commit_pending_merge` 实现，直接复用，不要重写）。但注意它遇到未解决冲突时返回 `"none"` 而不是报错——新命令要先把「还有冲突」变成明确错误，否则用户点继续没有任何反馈。
- 变基继续成功后可能还有下一个冲突，此时状态仍是 rebasing；返回里带上新状态，前端不当作失败。

**中止**：`merge --abort` / `rebase --abort` / `cherry-pick --abort` / `revert --abort`。中止后**重新探测一次状态**再返回，避免前端以为已经干净。

**超时**：本地操作 `Duration::from_secs(60)`（继续可能要写索引和提交）。

**UI**：只在 `operation !== 'none'` 时显示动作条。中止是破坏性动作，必须走现有 `askConfirm`（`src/components/common/askConfirm.ts`），不要用 `window.confirm`。

### Test scenarios

- Happy path: 制造合并冲突 → `repo_state` 返回 `merge` 且列出冲突文件 → 解决并 `git add` → 继续成功 → `repo_state` 返回 `none`。
- Happy path: 变基冲突 → 继续 → 后续提交全部重放完成，`repo_state` 返回 `none`，提交数正确。
- Edge case: 还有未解决冲突时调继续 → 返回错误且状态仍是 rebasing/merge，`.git` 中间目录不被破坏。
- Edge case: 无任何中断时调继续/中止 → 返回明确的「当前没有进行中的操作」，不执行任何 git 写操作。
- Error path: 中止后工作区回到操作前的内容（用 `status --porcelain` 对比）。
- Integration: 继续过程中编辑器没有被拉起（CI 里无 TTY，若误开编辑器会超时——用超时断言反向验证）。

### Verification

- 应用内制造一次合并冲突，全程不离开应用就能「解决 → 继续」和「解决一半 → 中止」两条路走通。

---

## B. Tag 的新建 / 删除 / 推送

> 状态：**已实现**。后端 `create_tag` / `delete_tag` / `push_tag` / `delete_remote_tag` 已注册；UI 入口为 `src/components/GitLogView/BranchPanel.tsx` 的标签分区「+」与标签右键菜单、`CommitGraph.tsx` 提交右键「新建标签」，对话框在 `TagDialog.tsx` 与 `RemotePickerDialog.tsx`。
> 实现取舍：推送/删除远程标签总是弹远程选择框（只有一个远程也弹），保证「推到哪个远程」可见；远程删除前先 `askConfirm` 再选远程。

### 现状

- `list_tags`（`git_ops.rs:1606`）只读列举，随 `load_snapshot` 一起返回，`BranchPanel` 的 `tags` 分组能显示。
- 右键 tag 的菜单（`BranchPanel.tsx:355-362`）只有 `showLog` / `checkout` / `compare`——`kind: 'tag'` 时 `merge`/`rebase`/`update`/`push`/`rename` 全部被 `menu.kind === 'branch'` 条件挡掉。
- **`git tag` 写操作在源码里只出现在测试**：`git_ops.rs:5740` `run_git(&path, &["tag", "v0.1.0"], ...)`。
- 没有任何推送 tag 的路径：`push_to` 的 refspec 固定是 `{local}:{branch}`。

### 目标

能在应用内创建轻量/附注 tag、删除本地 tag、推送 tag 到远程、删除远程 tag。

### Requirements

- **R-B1** 从分支面板顶部「新建标签」按钮，或提交右键菜单，在指定提交上创建 tag。
- **R-B2** 支持附注 tag（带说明），默认轻量 tag。
- **R-B3** 删除本地 tag 需二次确认。
- **R-B4** 推送 tag 到指定远程；删除远程 tag 需二次确认，且明确告知「会推送到远程」。
- **R-B5** tag 名非法（含空格、`~^:?*[\`、以 `-` 开头、`..`、`@{`）时前端/后端都拒绝，错误文案可读。
- **R-B6** 已存在的 tag 名不得静默覆盖。

### Files

- Modify: `src-tauri/src/git_ops.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/services/gitService.ts`
- Modify: `src/components/GitLogView/BranchPanel.tsx`（tag 行菜单 + 顶部新建按钮）
- Modify: `src/components/GitLogView/CommitGraph.tsx`（提交右键「新建标签…」）
- Modify: `src/components/GitLogView/index.tsx`、`src/App.tsx`（接线）
- Modify: `src/i18n/messages.ts`
- Test: `src-tauri/src/git_ops.rs`

### Approach

**命令设计**（4 个）：

| 命令 | git 调用 | 说明 |
| :--- | :--- | :--- |
| `create_tag(repo, name, target, message)` | 有 message：`tag -a <name> <target> -m <msg>`；无：`tag <name> <target>` | `target` 为提交 hash 或分支名 |
| `delete_tag(repo, name)` | `tag -d <name>` | 只删本地 |
| `push_tag(repo, name, remote)` | `push --progress <remote> refs/tags/<name>` | 网络，用 `NETWORK_TIMEOUT` + `NETWORK_STALL`，走 `run_git_streaming` 出进度 |
| `delete_remote_tag(repo, name, remote)` | `push --progress <remote> :refs/tags/<name>` | 同上，破坏性 |

**校验**：仓库已有 `validate_branch_name`（`git_ops.rs:4886`）和 `validate_push_branch`（`:3322`）。tag 名规则与分支名接近但**更严**（不能有 `~^:?*[\`、`..`、`@{`、首尾 `-`/`/`、空格）。新增 `validate_tag_name`，不要复用分支那套就完事。

**目标提交校验**：用现有 `validate_rev`（`git_ops.rs:4898`）或 `rev-parse --verify <target>^{commit}`，拒绝非法 rev 注入。

**已存在判断**：`rev-parse --verify refs/tags/<name>` 成功即存在 → 返回错误。不要依赖 `git tag` 的英文报错文本。

**附注 tag 前置条件**：`git tag -a` 需要 `user.name` / `user.email`。仓库已有 `configured_user_name`（`git_ops.rs:1742`）。未配置时给出明确中文错误，不要透传 git 的原始提示。

**UI**：
- `BranchPanel` 的 tag 行菜单加：`推送标签…`、`删除标签`（本地）、`删除远程标签`（仅当 `refs/remotes/<remote>/tags/...` 存在时才显示——若实现成本高，先只做本地删除 + 推送，远程删除放 Deferred）。
- 推送/删除远程需要一个远程选择。复用 `list_remotes`（已注册）拿远程名；只有一个远程时直接跳过选择。
- 菜单高度：`openMenu` 里 `BranchPanel.tsx:182` 的 `320 : 180` 是硬编码预留，tag 菜单项变多后要调，否则贴窗口底部会被裁切。

### Test scenarios

- Happy path: 在某提交上创建轻量 tag → `list_tags` 包含它且 `hash` 指向该提交。
- Happy path: 创建附注 tag（带说明）→ `subject` 字段等于说明文本，`hash` 是解引用后的提交 hash（`list_tags` 已经处理了 `%(*objectname:short)` 的 peeled 逻辑）。
- Happy path: 推送到本地 bare 远程夹具 → 远程出现该 tag ref。
- Edge case: 同名 tag 已存在 → 报错，原 tag 不动。
- Edge case: 未配置 `user.name` 时创建附注 tag → 明确中文错误，不产生半成品 ref。
- Error path: tag 名含 `~` / `..` / 空格 / 以 `-` 开头 → 拒绝，不执行 git。
- Error path: 删除不存在的 tag → 报错，不影响其他 ref。
- Integration: 删除本地 tag 后 `BranchPanel` 的 tags 分组立即少一项（依赖现有 `refresh` 链路）。

### Verification

- 从 UI 完成「创建 → 在分支面板看到 → 推送到远程 → 删除本地」全链路。

---

## C. 输入弹窗统一（替换 `window.prompt`）

> 状态：**已实现**。`src/components/common/dialogQueue.ts` 是确认/输入共用的队列，`askConfirm.ts` 与 `askInput.ts` 都是它的薄封装，`ConfirmHost.tsx` 同时承载两个弹窗。
> 注意：`isAskConfirmOpen()` 保留原名但已改为「任一弹窗打开」，`App.tsx` 的全局快捷键拦截不用改。
> 实现取舍：空值与校验失败时确认按钮禁用（不是点下后报错）；`validate` 只在非空时调用，空值统一提示 `common.inputRequired`。

### 现状

`d87d1b7` 已把 `window.confirm` 全部换成 `askConfirm`（`src/components/common/askConfirm.ts` + `ConfirmHost.tsx` + `ConfirmDialog.tsx`），但**输入类弹窗仍是原生 `prompt`**，风格与自绘对话框割裂，且原生 `prompt` 在 Tauri 无边框窗口里行为不一致（部分平台不阻塞、不能设默认值样式、不能 i18n 校验）。

7 处待替换：

| 文件:行 | 用途 | 现有 i18n key |
| :--- | :--- | :--- |
| `src/App.tsx:940` | 从提交新建分支 | `toast.branchPrompt` |
| `src/App.tsx:1028` | 重命名分支（分支弹窗） | `toast.renamePrompt` |
| `src/App.tsx:1141` | 重命名分支（侧边栏） | `toast.renamePrompt` |
| `src/components/BranchesModal.tsx:107` | 新建分支 | `branches.newPrompt` |
| `src/components/CommitView/ChangelistTree.tsx:603` | 新建 Changelist | `changes.newListPrompt` |
| `src/components/GitLogView/index.tsx:484` | 重命名分支（日志分支栏） | `toast.renamePrompt` |
| `src/components/ProjectSidebar/index.tsx:361` | 新建分支 | `branches.newPrompt` |

### 目标

所有输入类交互走同一个项目风格弹窗，`Esc` 只关当前弹窗，输入框自动聚焦并全选默认值。

### Requirements

- **R-C1** 新增 `askInput()`，API 风格与现有 `askConfirm()` 一致（Promise 化、队列化、挂载前调用会排队）。
- **R-C2** 支持 `title` / `message?` / `defaultValue` / `placeholder?` / `confirmLabel` / `tone?` / `validate?`。
- **R-C3** 空值或校验失败时确认按钮禁用，不返回空字符串。
- **R-C4** 取消 / `Esc` / 点遮罩 一律解析为 `null`（区分「取消」与「输入空串」）。
- **R-C5** 打开时输入框自动聚焦并全选 `defaultValue`，`Enter` 确认。
- **R-C6** 与 `askConfirm` 共用同一套排队机制，避免两个弹窗同时出现。

### Files

- Add: `src/components/common/askInput.ts`（队列 + 订阅，与 `askConfirm.ts` 同构）
- Add: `src/components/common/InputDialog.tsx`（UI，复用 `ConfirmDialog` 的遮罩/卡片/Esc 处理方式）
- Modify: `src/components/common/ConfirmHost.tsx` → 改成同时承载 confirm 和 input 的宿主（或新增 `DialogHost.tsx` 统一）
- Modify: `src/App.tsx`（`isAskConfirmOpen()` 的短路判断要同时覆盖 input 弹窗，见 `App.tsx:777` 附近的 Esc 处理与 `overlayOpen`）
- Modify: 上述 7 个调用点
- Modify: `src/i18n/messages.ts`（新增 `common.confirm` / `common.inputRequired` 之类通用 key）

### Approach

- **不要**把 input 塞进 `ConfirmDialog` 的 `message` 节点里——`ConfirmDialog` 的 `onChoose` 只回传 `value: string`，无法带回输入内容，硬塞会让它承担两种职责。新增独立组件，只复用视觉 token（`bg-jb-panel`、`border-jb-border`、`rounded-md`、`shadow-2xl`）。
- 队列可以抽成通用 `dialogQueue.ts`，两个 `ask*` 共用，避免两份重复的 `emit/subscribe/settle`。**注意**：`askConfirm.ts` 的 `isAskConfirmOpen()` 被 `App.tsx:777` 用于拦截全局快捷键，抽公共队列后这个函数必须仍然覆盖两种弹窗，否则输入弹窗开着时 `Ctrl+K` 会误触发。
- 校验：`validate` 返回 `string | null`（错误文案），空字符串也算错误。错误文案通过 `t()` 传入，不在这里硬编码。
- 调用点改法：`const name = await askInput({...}); if (!name) return;` —— 语义与现在 `prompt` 返回 `null` 一致，改动最小。

### Test scenarios

- Happy path: 重命名分支 → 弹窗预填旧名且全选 → 输入新名 → Enter → 后端收到新名。
- Happy path: 新建分支 → 预填 `feature/` → 直接回车 → 创建 `feature/`。
- Edge case: 清空输入 → 确认按钮禁用；按 Enter 无反应。
- Edge case: 点取消 / 按 Esc / 点遮罩 → 返回 `null`，不发请求（对照现有 `prompt` 的 `if (name)` 判断）。
- Edge case: 输入弹窗开着时按 `Ctrl+K` / `Alt+9` → 不切页签。
- Edge case: 输入弹窗开着时再触发一次 `askConfirm` → 排队，不叠加渲染。
- Integration: 7 个调用点全部替换后，`grep -rn "prompt(" src --include=*.tsx` 无结果。

### Verification

- 全仓库 `prompt(` 零命中；两处弹窗（confirm + input）不会同时出现；`Esc` 只关最上层。

---

## D. 强制推送（`--force-with-lease`）

> 状态：**已实现**。`push_to` 新增 `force: bool`（`lib.rs` 侧为 `Option<bool>`，缺省 false），`PushPreview.needs_force` 在两边分叉时置真，推送被非快进拒绝时返回 `status: "needs_force"`。
> 实现取舍：代码里**没有** `--force` 字面量；lease 过期时返回 `needs_force` 并提示先获取，**不自动降级**。`needs_force` 在 `App.tsx` 里按「不是失败」提示（不当成红色报错吞掉）。
> 未做：`push_repo`（顶栏推送）不增强制开关，仍保持原行为（需求 R-D4）。

### 现状

- `push_to`（`git_ops.rs:3663`）只拼普通 refspec `{local}:{branch}`，没有 force 参数。
- `push_repo`（`:3220`）同样没有。
- squash 完成后提示里明确写着「需要强制推送」（`git_ops.rs:4423`、i18n `squash.pushed`），但**应用里做不到**——squash 了已推送提交后，用户必须去终端。
- `PushDialog` 无相关开关。

### 目标

推送被拒绝且原因是「远端有新提交 / 非快进」时，用户能在推送对话框里显式勾选强制推送完成推送，且用 `--force-with-lease` 而不是 `--force`。

### Requirements

- **R-D1** 绝不使用 `--force`，只用 `--force-with-lease`（远程被他人更新时自动失败，不覆盖别人的提交）。
- **R-D2** 强制推送必须显式勾选，默认关闭，且勾选后按钮/文案要变成危险态。
- **R-D3** 预览里要能看出「本次推送会改写远程历史」（例如 `behind > 0` 或预览返回的非快进标记）。
- **R-D4** 顶栏「推送」不带源分支时的行为与现在完全一致（默认不强制）。
- **R-D5** 强制推送 tag 不在此项范围内（见 §B）。

### Files

- Modify: `src-tauri/src/git_ops.rs`（`push_to` 加 `force: bool`；`preview_push` 返回是否需要强制）
- Modify: `src-tauri/src/lib.rs`（命令签名同步）
- Modify: `src/services/gitService.ts`（`pushTo(..., force?)`、`previewPush` 返回值类型）
- Modify: `src/components/PushDialog.tsx`（勾选框 + 危险态）
- Modify: `src/App.tsx`（`confirmPush` 透传）
- Modify: `src/i18n/messages.ts`
- Test: `src-tauri/src/git_ops.rs`

### Approach

**后端**：`args.push(if force { "--force-with-lease" } else { ... })`，位置在 `push` 之后、remote 之前。参数仍是数组。

**需要强制判定的信号**（任选，不要靠解析英文报错）：
- 预览阶段：`ahead`/`behind` 已知，`behind > 0` 时普通推送一定被拒（除非快进可能）。
- 推送阶段：`finish_network` 失败且 stderr 命中 `non-fast-forward` / `[rejected]` / `fetch first` 时，返回一个可识别的状态（例如 `status: "needs_force"`），让 `PushDialog` 显示「远程有新提交，需要强制推送」并放出勾选框。

**这是本项最关键的设计点**：`SyncOutcome.status` 目前是自由字符串，前端 `gitService.ts:119` 的联合类型里有 `'ok' | 'up_to_date' | 'needs_confirm' | 'cancelled' | 'blocked' | string`。新增 `needs_force` 要同步进联合类型。

**安全**：`--force-with-lease` 默认依赖本地 remote-tracking ref。如果用户刚 `fetch` 过、本地 tracking 已是最新，lease 会放行——这是预期行为。但如果本地 tracking 过期，`--force-with-lease` 会失败，此时**不要自动降级成 `--force`**，直接报错让用户先获取。

**UI**：勾选框只在 `needs_force` 或 `behind > 0` 时出现（避免用户随手勾上）。勾选后按钮文案改成危险态，并在勾选时给一次说明文案（覆盖远程历史）。

### Test scenarios

- Happy path: 本地 squash 后远程有旧提交 → 普通推送被拒 → 带 `force=true` 推送成功 → 远程分支指向新的压缩提交。
- Happy path: 不传 `force` 时，行为与改前完全一致（回归断言）。
- Edge case: 远程被第三方推进后，本地 tracking 未刷新 → `--force-with-lease` 失败 → 返回明确错误，**不覆盖**远程。
- Edge case: 快进推送时 `force=true` 也成功（`--force-with-lease` 对快进无副作用）。
- Error path: `force=true` 但源分支不存在 → 校验失败，不发起网络请求。
- Integration: 顶栏推送（无 source）在 `needs_force` 时也显示勾选框；squash 完成后的提示文案与能力对齐（不再说「需要去终端强制推送」）。

### Verification

- squash 已推送的提交后，全程在应用内完成强制推送，远程历史正确被改写，且别人并发推送时不会被静默覆盖。

---

## E. Changelist 重命名 / 删除

> 状态：**已实现**。`ChangelistTree.tsx` 新增 `DEFAULT_LIST` / `ALL_LISTS` 常量（**存储值仍是 `更改` / `全部`**，老数据可继续读）、`remapAssignments` 迁移函数、下拉框 `__rename__` / `__delete__` 两个哨兵项。
> 实现取舍：删除后视图切到「全部」而不是默认列表（删除后用户通常想看全局）；默认列表与全部视图的两个新选项用 `<option disabled>` 挡住，同时在处理函数里再判一次。

### 现状

`src/components/CommitView/ChangelistTree.tsx`：

- 列表名存在 `localStorage` 的 `snailgit.changelists.<repoKey>`，结构 `{ names: string[], assignments: Record<path, name> }`（`:66-91`）。
- 下拉框（`:598-624`）只支持三种动作：切换、`__new__` 新建、`__move__` 把选中文件移到当前列表。
- **没有重命名，没有删除**。建错的列表永远删不掉，只能清 localStorage。
- 哨兵值是**中文字面量**：默认列表 `'更改'`、全部视图 `'全部'`（`:67`、`:69`、`:114`、`:115`、`:610`、`:618`）。这些是**状态值和持久化值**，不只是展示文案——违反 `AGENTS.md` §3 的 i18n 约定，但直接改值会让老用户的 localStorage 数据失配。

### 目标

能重命名、删除自定义 Changelist；删除时把其中文件归回默认列表；不破坏已有 localStorage 数据。

### Requirements

- **R-E1** 自定义列表可重命名，重命名后文件归属跟着改。
- **R-E2** 自定义列表可删除，其中文件归回默认列表；**默认列表不可删除、不可重命名**。
- **R-E3** 重命名/删除需二次确认（删除是破坏性的，走 `askConfirm`）。
- **R-E4** 重命名不得与其他列表重名，空名拒绝。
- **R-E5** 持久化 key 仍是 `snailgit.changelists.<repoKey>`，**已有数据必须能继续读**。
- **R-E6** 不再在 JSX 与比较逻辑里直接写 `'更改'` / `'全部'`，改为具名常量（值保持不变，仅提升可读性与集中管理）。

### Files

- Modify: `src/components/CommitView/ChangelistTree.tsx`
- Modify: `src/i18n/messages.ts`
- 依赖：§C 完成后再做（重命名/新建列表都需要 `askInput`；如果 §C 未做，本项先复用 `prompt` 并标注 TODO 到 §C）

### Approach

- **常量先行**：`const DEFAULT_LIST = '更改';` / `const ALL_LISTS = '全部';`，保持**存储值不变**（R-E5），只把散落的字面量换成常量。这样 i18n 展示仍走 `t('changes.default')` / `t('changes.all')`，状态比较用常量。
- **重命名**：`persistLists(names.map(n => n === old ? next : n), remap(assignments, old, next))`。同时若 `activeList === old` 则改成 `next`。
- **删除**：`persistLists(names.filter(n => n !== name), remap(assignments, name, DEFAULT_LIST))`。若 `activeList === name` 则回到 `DEFAULT_LIST`（或 `ALL_LISTS`，按当前行为选 `ALL_LISTS` 更符合直觉——删除后用户想看全局）。
- **入口**：下拉框里 `__new__` / `__move__` 旁边加 `__rename__` / `__delete__`。注意 `<select>` 的 `value` 是受控的，选中 `__rename__` 后必须立刻把 `activeList` 还原（现在是靠不 setState 实现的，见 `:614` 的 `setActiveList(e.target.value)` 只在最后一行——新加的两个分支必须在 `return` 前不改 `activeList`，否则下拉框会停在 `__rename__` 上）。
- **默认列表保护**：`__rename__` / `__delete__` 在 `activeList === DEFAULT_LIST || activeList === ALL_LISTS` 时禁用（`<option disabled>`）。
- **重名检查**：与 `changelistNames` 比对，重复则报错（用 toast 或 `askInput` 的 `validate`）。

### Test scenarios

- Happy path: 新建列表 `A` → 把 2 个文件移入 → 重命名为 `B` → 列表显示 `B`，两个文件仍在 `B` 下，localStorage 里 `assignments` 的值变成 `B`。
- Happy path: 删除列表 `B` → 列表消失，两个文件回到默认列表（`更改`）下可见。
- Edge case: 当前激活的是 `B`，删除 `B` → 自动切到全部视图，不显示空白。
- Edge case: 重命名为已存在的名字 → 拒绝并提示，不改任何数据。
- Edge case: 重命名为空串 → 拒绝。
- Edge case: 激活默认列表时，下拉框里重命名/删除不可选。
- Integration: 关闭应用重开（localStorage 仍在）→ 列表结构与文件归属不变；**改动前存的老数据（`names` 含 `'更改'`）能被正确读出**。

### Verification

- 建错的列表能删掉；删掉后文件不丢失；旧 localStorage 数据不失效。

---

## 系统级影响

- **交互图**：§A 触及冲突横幅、三方合并、提交框；§B 触及分支面板、提交右键菜单、远程列表；§C 触及全局弹窗宿主与所有全局快捷键的拦截判断；§D 触及推送对话框、`SyncOutcome` 状态枚举、状态栏；§E 只触及 Commit 页的列表控件。
- **错误传播**：全部沿用现有 toast（`App.tsx` 的 `run()`）。破坏性动作（中止、删 tag、删远程 tag、强制推送、删列表）必须走 `askConfirm`。
- **状态生命周期风险**：
  - §A 的中止/继续之后必须重新读快照，否则冲突横幅还挂着。
  - §C 改 `ConfirmHost` 会影响**所有**现有 `askConfirm` 调用点，回归面比看起来大。
  - §D 新增的 `needs_force` 状态不能让 `applySyncCounts` 误判成功。
- **API 表面一致性**：§B/§D 的 `push_tag` / `push_to` 与现有 `push_repo` 是并行入口，**不要合并**，避免顶栏推送语义被改写。
- **未改动的不变量**：`update_repo` 的脏工作区确认状态机、shelf 存储位置、托盘/单实例、`decorations:false` 自绘标题栏。

## 风险与依赖

| 风险 | 缓解 |
| :--- | :--- |
| §A 的 `--continue` 拉起编辑器导致进程挂死 | 实际用 `GIT_EDITOR=true`（接受默认说明）。草稿里的 `false` 会让 git 直接失败，不要改回去 |
| §A 把「还有冲突」当成 `"none"` 静默成功（`commit_pending_merge` 现有行为） | 新命令先判 `unmerged_paths`，非空即报错 |
| §B 复用分支名校验，漏掉 tag 特有的非法字符 | 独立 `validate_tag_name`，逐条列出禁用字符并加测试 |
| §B 附注 tag 缺 `user.name` 时透传 git 原始英文错误 | 先用 `configured_user_name` 预检，给中文错误 |
| §C 抽公共队列时破坏 `isAskConfirmOpen()`，导致弹窗开着时快捷键仍触发 | 抽完后该函数必须覆盖两种弹窗；加手工场景验证 |
| §D 误用 `--force` 覆盖他人提交 | 代码层禁止 `--force`；`--force-with-lease` 失败不自动降级 |
| §D 把「需要强制」当成普通失败吞掉 | 新增 `needs_force` 状态并同步进 TS 联合类型 |
| §E 改中文字面量导致老 localStorage 数据失配 | 存储值保持不变，只抽常量；保留读旧数据的兼容测试 |
| 任一项漏登记 `generate_handler!` | 运行期才报错，改完必须 `pnpm tauri dev` 实跑一次 |

## 执行顺序建议

1. **§A**（用户会撞上的死路，后端最独立）
2. **§B**（分支面板已列出 tag，缺写操作，收益直观）
3. **§C**（纯前端，为 §E 铺路，回归面大所以单独一次会话）
4. **§D**（依赖 §A/§B 完成后对 `SyncOutcome` 的改动沉淀）
5. **§E**（依赖 §C 的 `askInput`）

每项独立一个会话、独立一次提交。`§A` 与 `§B` 都改 `git_ops.rs`，若同一会话连续做，注意 `git_ops.rs` 底部的 `#[cfg(test)]` 模块要追加而不是覆盖。

## 验收标准（每项都必须过）

- `pnpm typecheck` 无错误
- `pnpm lint` 0 error（warning 不新增）
- `pnpm test:rust` 全绿
- 改到 Rust 时 `pnpm lint:rust` 无新告警
- `pnpm tauri dev` 里手动走一遍新增路径（命令漏登记只有运行期才会暴露）
- 新增文案在 `zh` 与 `en` 中 key 完全同名
- 无新增依赖（`package.json` / `Cargo.toml` 未变）

## 明确不做

- 不做交互式 rebase（reword / drop / reorder）——`pull.rebase=interactive` 目前是直接拒绝（`git_ops.rs:2551`），改成支持是独立大工程。
- 不做文件历史 / blame（`--follow`、`git blame` 全仓库零命中）。
- 不做行级暂存（现在只有块级 chunk）。
- 不做部分文件 stash（`stash_save` 固定 `stash push -u`，与 shelf 的按路径能力不对称）。
- 不做浅色主题、Settings 面板、macOS/Linux 打包。
- 不清洗仓库里既有的硬编码色值（`#1E1F22` 等），新代码用 `jb-*` 令牌即可。

## 相关代码索引

> 只写符号名，不写行号——行号会随任何改动漂移，符号名可用编辑器直接跳转。

- `src-tauri/src/git_ops.rs` — 全部 git 调用；相关符号：`merge_in_progress`、`rebase_in_progress`、`commit_pending_merge`、`abort_merge_if_any`、`restore_squash_point`、`list_tags`、`push_to`、`validate_branch_name`、`validate_push_branch`
- `src-tauri/src/lib.rs` — `generate_handler!` 宏；新增命令漏登记只会在运行期报错
- `src/services/gitService.ts` — `SyncOutcome`、`previewPush`、`pushTo`
- `src/components/common/askConfirm.ts` / `ConfirmDialog.tsx` / `ConfirmHost.tsx` / `dialogQueue.ts` — 弹窗基础设施
- `src/components/GitLogView/BranchPanel.tsx` — `MenuState`、`openMenu`、tag 菜单分区
- `src/components/CommitView/ChangelistTree.tsx` — `storageKey`、`persistLists`、列表下拉框
- `src/components/PushDialog.tsx` — 推送对话框
- `src/App.tsx` — `run`、`guardNetwork`、Esc/快捷键拦截、`applySnapshot`
