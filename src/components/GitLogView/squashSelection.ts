import { GitCommit } from '../../types/git';

export type SquashIssue = 'need-more' | 'gap' | 'merge' | 'root' | 'missing';

/** 用已加载提交的父指针做预检。真正能不能压，仍以后端的一等父历史为准。 */
export function inspectSquashSelection(commits: GitCommit[], selected: string[]): SquashIssue | null {
  const unique = [...new Set(selected.filter(Boolean))];
  if (unique.length < 2) return 'need-more';
  const byHash = new Map(commits.map(commit => [commit.hash, commit]));
  if (unique.some(hash => !byHash.has(hash))) return 'missing';

  const selectedSet = new Set(unique);
  for (const hash of unique) {
    if (byHash.get(hash)!.parents.length > 1) return 'merge';
  }

  const isParentOfSelected = new Set<string>();
  for (const hash of unique) {
    const parent = byHash.get(hash)!.parents[0];
    if (parent && selectedSet.has(parent)) isParentOfSelected.add(parent);
  }
  const newest = unique.filter(hash => !isParentOfSelected.has(hash));
  if (newest.length !== 1) return 'gap';

  const seen = new Set<string>();
  let current = byHash.get(newest[0]);
  while (current && selectedSet.has(current.hash)) {
    if (seen.has(current.hash)) return 'gap';
    seen.add(current.hash);
    if (current.parents.length > 1) return 'merge';
    const parent = current.parents[0];
    if (!parent) return seen.size === unique.length ? 'root' : 'gap';
    if (!selectedSet.has(parent)) break;
    const next = byHash.get(parent);
    if (!next) return 'missing';
    current = next;
  }
  if (seen.size !== unique.length) return 'gap';
  return null;
}
