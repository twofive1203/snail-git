import React, { useEffect, useState, useMemo } from 'react';
import { GitBranch, GitCommit, GitTag } from '../../types/git';
import { SplitPane } from '../common/SplitPane';
import { FilterBar } from './FilterBar';
import { CommitGraph } from './CommitGraph';
import { CommitDetail } from './CommitDetail';
import { BranchPanel } from './BranchPanel';

interface GitLogViewProps {
  commits: GitCommit[];
  onOpenFileDiff: (commit: GitCommit, filePath: string) => void;
  onShowDiffWithLocal?: (commit: GitCommit) => void;
  onParentMissing?: (hash: string) => void;
  onCheckout?: (hash: string) => void;
  onCherryPick?: (hash: string) => void;
  onRevert?: (hash: string) => void;
  onReset?: (hash: string) => void;
  onCreateBranch?: (hash: string) => void;
  onCompareBranch?: (name: string) => void;
  onCheckoutBranch?: (name: string) => void;
  onMergeBranch?: (name: string) => void;
  onRebaseBranch?: (name: string) => void;
  branches?: GitBranch[];
  tags?: GitTag[];
  currentBranch?: string;
  currentUser?: string;
}

function decorationName(ref: string): string {
  return ref.replace(/^HEAD -> /, '').replace(/^tag: /, '').trim();
}

function pointsAtHead(ref: string): boolean {
  return ref === 'HEAD' || ref.startsWith('HEAD ->');
}

function commitIsRefTip(commit: GitCommit, selectedBranch: string): boolean {
  if (selectedBranch === 'Head') return commit.refs.some(pointsAtHead);
  return commit.refs.some(ref => decorationName(ref) === selectedBranch);
}

function findLoadedCommit(commits: GitCommit[], hash: string): GitCommit | undefined {
  return commits.find(commit =>
    commit.hash === hash ||
    commit.shortHash === hash ||
    commit.hash.startsWith(hash) ||
    hash.startsWith(commit.hash),
  );
}

// git 只把分支/tag 装饰标在尖端。筛选分支要沿 parents 收集可达提交，不能只留尖端那一条。
function hashesReachableFromRef(commits: GitCommit[], selectedBranch: string): Set<string> {
  const seen = new Set<string>();
  const stack = commits.filter(commit => commitIsRefTip(commit, selectedBranch));
  while (stack.length > 0) {
    const commit = stack.pop();
    if (!commit || seen.has(commit.hash)) continue;
    seen.add(commit.hash);
    for (const parent of commit.parents) {
      const resolved = findLoadedCommit(commits, parent);
      if (resolved && !seen.has(resolved.hash)) stack.push(resolved);
    }
  }
  return seen;
}

function matchesDate(date: string, range: string): boolean {
  if (range === 'All') return true;
  const parsed = Date.parse(date.replace(' ', 'T'));
  if (Number.isNaN(parsed)) return true;
  const now = Date.now();
  if (range === 'Today') {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return parsed >= start.getTime();
  }
  const days = range === 'Last 7 Days' ? 7 : range === 'Last 30 Days' ? 30 : 0;
  return days === 0 || now - parsed <= days * 86400000;
}

export const GitLogView: React.FC<GitLogViewProps> = ({
  commits,
  onOpenFileDiff,
  onShowDiffWithLocal,
  onParentMissing,
  onCheckout,
  onCherryPick,
  onRevert,
  onReset,
  onCreateBranch,
  onCompareBranch,
  onCheckoutBranch,
  onMergeBranch,
  onRebaseBranch,
  branches: branchList = [],
  tags = [],
  currentBranch = '',
  currentUser = '',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('All');
  const [selectedAuthor, setSelectedAuthor] = useState('All');
  const [selectedDate, setSelectedDate] = useState('All');
  const [pathQuery, setPathQuery] = useState('');
  const [selectedCommitHash, setSelectedCommitHash] = useState<string>(
    commits.length > 0 ? commits[0].hash : ''
  );
  const [focusToken, setFocusToken] = useState(0);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [branchesCollapsed, setBranchesCollapsed] = useState(() => {
    try {
      return localStorage.getItem('easygit.log.branchesCollapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('easygit.log.branchesCollapsed', branchesCollapsed ? '1' : '0');
    } catch {
      /* 浏览器禁止本地存储时，收起状态只在当前会话有效 */
    }
  }, [branchesCollapsed]);

  // 提取唯一分支列表和作者列表
  const branches = useMemo(() => {
    const list: string[] = [];
    commits.forEach(c => {
      c.refs.forEach(r => {
        const clean = r.replace('HEAD -> ', '').replace('tag: ', '');
        if (!list.includes(clean)) list.push(clean);
      });
    });
    return list;
  }, [commits]);

  const authors = useMemo(() => {
    return Array.from(new Set(commits.map(c => c.author)));
  }, [commits]);

  // 已加载提交上的 tag 装饰补进列表，避免旧后端还没返回 tags 时面板是空的。
  const panelTags = useMemo(() => {
    const merged = [...tags];
    const seen = new Set(merged.map(tag => tag.name));
    for (const commit of commits) {
      for (const ref of commit.refs) {
        if (!ref.startsWith('tag: ')) continue;
        const name = ref.slice('tag: '.length).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        merged.push({ name, hash: commit.shortHash, subject: commit.subject });
      }
    }
    return merged;
  }, [tags, commits]);

  // 综合过滤
  const filteredCommits = useMemo(() => {
    const onSelectedBranch = selectedBranch === 'All'
      ? null
      : hashesReachableFromRef(commits, selectedBranch);
    return commits.filter(commit => {
      // 搜索框匹配（message, hash, author）
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSubject = commit.subject.toLowerCase().includes(q);
        const matchHash = commit.hash.toLowerCase().includes(q);
        const matchAuthor = commit.author.toLowerCase().includes(q);
        if (!matchSubject && !matchHash && !matchAuthor) return false;
      }

      // 提交者匹配
      if (selectedAuthor !== 'All' && commit.author !== selectedAuthor) {
        return false;
      }

      if (onSelectedBranch && !onSelectedBranch.has(commit.hash)) return false;

      if (!matchesDate(commit.date, selectedDate)) return false;
      if (pathQuery.trim()) {
        const q = pathQuery.trim().toLowerCase();
        if (!commit.files.some(file => file.path.toLowerCase().includes(q))) return false;
      }

      return true;
    });
  }, [commits, searchQuery, selectedBranch, selectedAuthor, selectedDate, pathQuery]);

  const currentSelectedCommit = useMemo(() => {
    return commits.find(c => c.hash === selectedCommitHash) || (commits.length > 0 ? commits[0] : null);
  }, [commits, selectedCommitHash]);

  return (
    <div data-keyboard-root="log" tabIndex={-1} className="flex-1 flex flex-col h-full overflow-hidden bg-jb-bg focus:outline-none">
      <SplitPane
        orientation="horizontal"
        sized="start"
        defaultSize={420}
        defaultRatio={0.5}
        min={200}
        max={960}
        minOther={360}
        storageKey="easygit.log.branchWidth"
        lockedSize={branchesCollapsed ? 28 : undefined}
        className="flex-1 min-h-0"
        start={
          <BranchPanel
            collapsed={branchesCollapsed}
            onToggleCollapsed={() => setBranchesCollapsed(value => !value)}
            branches={branchList}
            tags={panelTags}
            currentBranch={currentBranch}
            selectedRef={selectedBranch}
            onSelectRef={setSelectedBranch}
            onCheckout={onCheckoutBranch ?? onCheckout}
            onCompare={onCompareBranch}
            onMerge={onMergeBranch}
            onRebase={onRebaseBranch}
          />
        }
        end={
        <div className="flex flex-col h-full min-h-0 min-w-0">
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedBranch={selectedBranch}
        onBranchChange={setSelectedBranch}
        selectedAuthor={selectedAuthor}
        onAuthorChange={setSelectedAuthor}
        selectedDate={selectedDate}
        onDateChange={setSelectedDate}
        pathQuery={pathQuery}
        onPathChange={setPathQuery}
        branches={branches}
        authors={authors}
        currentUser={currentUser}
      />

      <SplitPane
        orientation="vertical"
        sized="end"
        defaultSize={224}
        min={120}
        max={720}
        minOther={120}
        storageKey="easygit.log.detailHeight"
        lockedSize={detailCollapsed ? 28 : undefined}
        className="flex-1 min-h-0"
        start={
      <CommitGraph
        commits={filteredCommits}
        selectedHash={selectedCommitHash}
        focusToken={focusToken}
        onSelectCommit={(commit) => setSelectedCommitHash(commit.hash)}
        onViewDiff={(commit) => onShowDiffWithLocal?.(commit)}
        onCheckout={onCheckout}
        onCherryPick={onCherryPick}
        onRevert={onRevert}
        onReset={onReset}
        onCreateBranch={onCreateBranch}
        onCompareBranch={onCompareBranch}
        currentBranch={currentBranch}
      />
        }
        end={
      <CommitDetail
        commit={currentSelectedCommit}
        onCollapsedChange={setDetailCollapsed}
        onOpenFileDiff={(path) => {
          if (currentSelectedCommit) onOpenFileDiff(currentSelectedCommit, path);
        }}
        onSelectParent={(hash) => {
          const found = commits.find(commit => commit.hash === hash || commit.hash.startsWith(hash) || hash.startsWith(commit.hash));
          if (!found) {
            onParentMissing?.(hash);
            return;
          }
          const visible = filteredCommits.some(commit => commit.hash === found.hash);
          if (!visible) {
            setSearchQuery('');
            setSelectedBranch('All');
            setSelectedAuthor('All');
            setSelectedDate('All');
            setPathQuery('');
          }
          setSelectedCommitHash(found.hash);
          setFocusToken(token => token + 1);
        }}
      />
        }
      />
        </div>
        }
      />
    </div>
  );
};
