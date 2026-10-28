import type { FileChange } from '../../types/git';
import type { SquashPreview } from '../../services/gitService';

/** 参数含空格或引号时加双引号。反斜杠保持原样，避免 Windows 路径被多转义一层。 */
export function quoteGitArg(value: string): string {
  // {} 也要引号：PowerShell 会把 stash@{0} 的花括号当成脚本块。
  if (value.length === 0 || /[\s"{}|&;<>^]/.test(value)) {
    return `"${value.replace(/"/g, '\\"')}"`;
  }
  return value;
}

/** 可粘贴的单条命令。仓库路径始终加引号。 */
export function formatGitCommand(repoPath: string, args: readonly string[]): string {
  const quotedRepo = `"${repoPath.replace(/"/g, '\\"')}"`;
  return ['git', '-C', quotedRepo, ...args.map(quoteGitArg)].join(' ');
}

/** 不是 git 命令的文件系统动作。路径含空格时加引号，方便和旁边的命令对齐。 */
export function filesystemAction(action: string, path: string): string {
  return `${action} ${quoteGitArg(path.replace(/\\/g, '/'))}`;
}

const RESTORE_TRACKED = ['restore', '--source=HEAD', '--worktree', '--staged', '--'] as const;

/**
 * 与 discard_paths 的三类分支对齐。
 * 未跟踪文件只写回收站，不写成 git clean。新增文件先取消暂存，再进回收站。
 * 重命名先恢复旧路径，再从索引去掉新路径，新路径进回收站。
 */
export function discardCommandLines(
  repoPath: string,
  files: readonly Pick<FileChange, 'path' | 'oldPath' | 'status'>[],
  recycleLabel: string,
): string[] {
  const lines: string[] = [];
  for (const file of files) {
    const rel = file.path.replace(/\\/g, '/');
    if (file.oldPath) {
      const oldRel = file.oldPath.replace(/\\/g, '/');
      lines.push(formatGitCommand(repoPath, [...RESTORE_TRACKED, oldRel]));
      lines.push(formatGitCommand(repoPath, ['rm', '--cached', '--ignore-unmatch', '--', rel]));
      lines.push(filesystemAction(recycleLabel, rel));
      continue;
    }
    if (file.status === 'untracked') {
      lines.push(filesystemAction(recycleLabel, rel));
      continue;
    }
    if (file.status === 'added') {
      lines.push(formatGitCommand(repoPath, ['restore', '--staged', '--', rel]));
      lines.push(filesystemAction(recycleLabel, rel));
      continue;
    }
    lines.push(formatGitCommand(repoPath, [...RESTORE_TRACKED, rel]));
  }
  return lines;
}

export function deleteBranchCommand(
  repoPath: string,
  branch: { name: string; isRemote?: boolean },
  force: boolean,
): string[] {
  if (branch.isRemote) {
    const slash = branch.name.indexOf('/');
    if (slash <= 0 || slash === branch.name.length - 1) return [];
    const remote = branch.name.slice(0, slash);
    const name = branch.name.slice(slash + 1);
    return [formatGitCommand(repoPath, ['push', remote, '--delete', name])];
  }
  return [formatGitCommand(repoPath, ['branch', force ? '-D' : '-d', '--', branch.name])];
}

export function chunkRollbackPreview(repoPath: string, patch: string): { commands: string[]; copyText: string } {
  const worktree = formatGitCommand(repoPath, ['apply', '-R', '--unidiff-zero']);
  const index = formatGitCommand(repoPath, ['apply', '--cached', '-R', '--unidiff-zero']);
  return {
    commands: [worktree, index],
    copyText: [worktree, patch, '', index, patch].join('\n'),
  };
}

const SQUASH_STASH_MESSAGE = 'snailgit-squash-autostash';
const SQUASH_WORK_BRANCH = 'snailgit-squash-work';
const SQUASH_TIP_BRANCH = 'snailgit-squash-tip';

/**
 * 按 squash_commits 当前会走的路径列出步骤。
 * 临时说明文件的路径要等执行时才生成，这里不编一个假路径。
 */
export function squashCommandLines(repoPath: string, preview: SquashPreview, message: string): string[] {
  const git = (args: readonly string[]) => formatGitCommand(repoPath, args);
  const lines: string[] = [];
  if (preview.hasLocalChanges) {
    lines.push(git(['stash', 'push', '--include-untracked', '-m', SQUASH_STASH_MESSAGE]));
  }
  const newest = preview.commits[preview.commits.length - 1]?.hash ?? '';
  if (preview.replayCount > 0) {
    lines.push('# 若上次中断留下同名临时分支，会先删掉；不存在则忽略');
    lines.push(git(['branch', '-D', SQUASH_WORK_BRANCH]));
    lines.push(git(['branch', '-D', SQUASH_TIP_BRANCH]));
    lines.push(git(['branch', '-f', SQUASH_TIP_BRANCH, 'HEAD']));
    lines.push(git(['switch', '-C', SQUASH_WORK_BRANCH, '--', newest]));
  }
  lines.push(git(['reset', '--soft', preview.oldestParent]));
  const commitArgs = ['commit', '--allow-empty', '-F', '临时说明文件 (执行时生成)'];
  if (preview.authorArg) commitArgs.push('--author', preview.authorArg);
  lines.push(git(commitArgs));
  if (preview.committedAt) {
    lines.push(`# GIT_AUTHOR_DATE=${preview.committedAt}`);
    lines.push(`# GIT_COMMITTER_DATE=${preview.committedAt}`);
  }
  lines.push('# 提交说明：');
  const body = message.trim();
  lines.push(body || '# （说明还是空的，确认按钮保持禁用）');
  if (preview.replayCount > 0) {
    lines.push(git(['rebase', '--onto', SQUASH_WORK_BRANCH, newest, SQUASH_TIP_BRANCH]));
    lines.push(git(['switch', '--', preview.branch]));
    lines.push(git(['reset', '--hard', SQUASH_TIP_BRANCH]));
    lines.push(git(['branch', '-D', SQUASH_WORK_BRANCH]));
    lines.push(git(['branch', '-D', SQUASH_TIP_BRANCH]));
  }
  if (preview.hasLocalChanges) {
    lines.push('# 成功后按新贮藏的哈希放回：stash apply --index，失败且工作区仍干净时再 stash apply，然后 stash drop');
  }
  return lines;
}
