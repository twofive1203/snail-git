import React, { useState, useMemo } from 'react';
import { GitCommit } from '../../types/git';
import { FilterBar } from './FilterBar';
import { CommitGraph } from './CommitGraph';
import { CommitDetail } from './CommitDetail';

interface GitLogViewProps {
  commits: GitCommit[];
  onOpenFileDiff: (filePath: string) => void;
  onCheckout?: (hash: string) => void;
  onCherryPick?: (hash: string) => void;
  onRevert?: (hash: string) => void;
  onReset?: (hash: string) => void;
  onCreateBranch?: (hash: string) => void;
}

export const GitLogView: React.FC<GitLogViewProps> = ({
  commits,
  onOpenFileDiff,
  onCheckout,
  onCherryPick,
  onRevert,
  onReset,
  onCreateBranch,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('All');
  const [selectedAuthor, setSelectedAuthor] = useState('All');
  const [selectedCommitHash, setSelectedCommitHash] = useState<string>(
    commits.length > 0 ? commits[0].hash : ''
  );

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

      return true;
    });
  }, [commits, searchQuery, selectedBranch, selectedAuthor]);

  const currentSelectedCommit = useMemo(() => {
    return commits.find(c => c.hash === selectedCommitHash) || (commits.length > 0 ? commits[0] : null);
  }, [commits, selectedCommitHash]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-jb-bg">
      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedBranch={selectedBranch}
        onBranchChange={setSelectedBranch}
        selectedAuthor={selectedAuthor}
        onAuthorChange={setSelectedAuthor}
        branches={branches}
        authors={authors}
      />

      <CommitGraph
        commits={filteredCommits}
        selectedHash={selectedCommitHash}
        onSelectCommit={(commit) => setSelectedCommitHash(commit.hash)}
        onViewDiff={(commit) => {
          if (commit.files.length > 0) {
            onOpenFileDiff(commit.files[0].path);
          }
        }}
        onCheckout={onCheckout}
        onCherryPick={onCherryPick}
        onRevert={onRevert}
        onReset={onReset}
        onCreateBranch={onCreateBranch}
      />

      <CommitDetail
        commit={currentSelectedCommit}
        onOpenFileDiff={onOpenFileDiff}
      />
    </div>
  );
};
