import React, { useState, useMemo } from 'react';
import { GitCommit } from '../../types/git';
import { FilterBar } from './FilterBar';
import { CommitGraph } from './CommitGraph';
import { CommitDetail } from './CommitDetail';

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
  currentBranch?: string;
  currentUser?: string;
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

  // 综合过滤
  const filteredCommits = useMemo(() => {
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

      // 分支匹配
      if (selectedBranch !== 'All') {
        if (selectedBranch === 'Head') {
          if (!commit.refs.some(r => r.includes('HEAD'))) return false;
        } else {
          if (!commit.refs.some(r => r.includes(selectedBranch))) return false;
        }
      }

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

      <CommitDetail
        commit={currentSelectedCommit}
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
    </div>
  );
};
