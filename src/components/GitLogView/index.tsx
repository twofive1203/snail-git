import React, { useEffect, useState, useMemo, useRef } from 'react';
import { GitBranch, GitCommit, GitTag } from '../../types/git';
import { SplitPane } from '../common/SplitPane';
import { FilterBar } from './FilterBar';
import { CommitGraph } from './CommitGraph';
import { CommitDetail } from './CommitDetail';
import { BranchPanel } from './BranchPanel';
import { isTauriEnvironment, loadCommitFiles, loadCommitLog } from '../../services/gitService';
import { useI18n } from '../../i18n/react';

interface GitLogViewProps {
  repoPath?: string;
  commits: GitCommit[];
  commitsHasMore?: boolean;
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
  onUpdateBranch?: (name: string) => void;
  onPushBranch?: (name: string) => void;
  onRenameBranch?: (oldName: string, newName: string) => Promise<boolean>;
  branches?: GitBranch[];
  tags?: GitTag[];
  currentBranch?: string;
  currentUser?: string;
}

interface HistoryQuery {
  branch: string;
  author: string;
  date: string;
  path: string;
  search: string;
}

function appendCommits(current: GitCommit[], incoming: GitCommit[]): GitCommit[] {
  if (incoming.length === 0) return current;
  const seen = new Set(current.map(commit => commit.hash));
  const extra = incoming.filter(commit => !seen.has(commit.hash));
  return extra.length === 0 ? current : [...current, ...extra];
}

function historyQueryKey(query: HistoryQuery): string {
  return JSON.stringify(query);
}

function errorText(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message: unknown }).message || '');
    if (message.trim()) return message;
  }
  return fallback;
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
  repoPath = '',
  commits,
  commitsHasMore = false,
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
  onUpdateBranch,
  onPushBranch,
  onRenameBranch,
  branches: branchList = [],
  tags = [],
  currentBranch = '',
  currentUser = '',
}) => {
  const { t } = useI18n();
  const native = isTauriEnvironment();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('All');
  const [selectedAuthor, setSelectedAuthor] = useState('All');
  const [selectedDate, setSelectedDate] = useState('All');
  const [pathQuery, setPathQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [debouncedPath, setDebouncedPath] = useState('');
  const [selectedCommitHash, setSelectedCommitHash] = useState<string>(
    commits.length > 0 ? commits[0].hash : ''
  );
  const [focusToken, setFocusToken] = useState(0);
  const [detailCollapsed, setDetailCollapsed] = useState(false);
  const [branchesCollapsed, setBranchesCollapsed] = useState(() => {
    try {
      return localStorage.getItem('snailgit.log.branchesCollapsed') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('snailgit.log.branchesCollapsed', branchesCollapsed ? '1' : '0');
    } catch {
      /* 浏览器禁止本地存储时，收起状态只在当前会话有效 */
    }
  }, [branchesCollapsed]);

  const [extraCommits, setExtraCommits] = useState<GitCommit[]>([]);
  const [browseHasMore, setBrowseHasMore] = useState(commitsHasMore);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [queryCommits, setQueryCommits] = useState<GitCommit[]>([]);
  const [queryHasMore, setQueryHasMore] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryError, setQueryError] = useState('');
  const [queryReadyKey, setQueryReadyKey] = useState('');
  const [fileCache, setFileCache] = useState<Record<string, GitCommit['files']>>({});
  const [filesLoadingHash, setFilesLoadingHash] = useState('');
  const [filesError, setFilesError] = useState('');
  const requestSeq = useRef(0);
  const loadingRef = useRef(false);
  const browseHeadRef = useRef('');
  const exhaustedRef = useRef(false);
  const repoRef = useRef(repoPath);
  const retainedCommit = useRef<GitCommit | null>(null);
  repoRef.current = repoPath;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setDebouncedPath(pathQuery.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery, pathQuery]);

  const browseCommits = useMemo(
    () => appendCommits(commits, extraCommits),
    [commits, extraCommits],
  );

  useEffect(() => {
    exhaustedRef.current = false;
    browseHeadRef.current = '';
    setExtraCommits([]);
    setQueryCommits([]);
    setQueryHasMore(false);
    setQueryReadyKey('');
    setQueryError('');
    setFileCache({});
    setFilesError('');
  }, [repoPath]);

  useEffect(() => {
    const head = commits[0]?.hash ?? '';
    const headChanged = browseHeadRef.current !== head;
    browseHeadRef.current = head;
    if (headChanged) {
      exhaustedRef.current = false;
      setExtraCommits([]);
      setBrowseHasMore(commitsHasMore);
      setFileCache({});
      setQueryError('');
      return;
    }
    setExtraCommits(prev => prev.filter(commit => !commits.some(item => item.hash === commit.hash)));
    if (!exhaustedRef.current) setBrowseHasMore(commitsHasMore);
  }, [commits, commitsHasMore]);

  const historyQuery = useMemo<HistoryQuery>(() => ({
    branch: selectedBranch,
    author: selectedAuthor,
    date: selectedDate,
    path: debouncedPath,
    search: debouncedSearch,
  }), [selectedBranch, selectedAuthor, selectedDate, debouncedPath, debouncedSearch]);
  const queryActive = historyQuery.branch !== 'All'
    || historyQuery.author !== 'All'
    || historyQuery.date !== 'All'
    || historyQuery.path !== ''
    || historyQuery.search !== '';
  const activeKey = historyQueryKey(historyQuery);

  useEffect(() => {
    if (!native || !repoPath || !queryActive) {
      setQueryLoading(false);
      if (!queryActive) setQueryError('');
      return;
    }
    const seq = ++requestSeq.current;
    const pathAtStart = repoPath;
    setQueryLoading(true);
    setQueryError('');
    loadCommitLog(repoPath, { ...historyQuery, skip: 0 })
      .then(page => {
        if (seq !== requestSeq.current || repoRef.current !== pathAtStart) return;
        setQueryCommits(page.commits);
        setQueryHasMore(page.hasMore);
        setQueryReadyKey(activeKey);
      })
      .catch(err => {
        if (seq !== requestSeq.current || repoRef.current !== pathAtStart) return;
        setQueryError(errorText(err, t('log.loadFailed')));
      })
      .finally(() => {
        if (seq === requestSeq.current) setQueryLoading(false);
      });
  }, [native, repoPath, queryActive, activeKey, historyQuery, t]);

  // 提取唯一分支列表和作者列表。继续加载后，下拉项跟着已加载历史变。
  const branches = useMemo(() => {
    const list: string[] = [];
    browseCommits.forEach(c => {
      c.refs.forEach(r => {
        const clean = r.replace('HEAD -> ', '').replace('tag: ', '');
        if (!list.includes(clean)) list.push(clean);
      });
    });
    return list;
  }, [browseCommits]);

  const authors = useMemo(() => {
    return Array.from(new Set(browseCommits.map(c => c.author)));
  }, [browseCommits]);

  // 已加载提交上的 tag 装饰补进列表，避免旧后端还没返回 tags 时面板是空的。
  const panelTags = useMemo(() => {
    const merged = [...tags];
    const seen = new Set(merged.map(tag => tag.name));
    for (const commit of browseCommits) {
      for (const ref of commit.refs) {
        if (!ref.startsWith('tag: ')) continue;
        const name = ref.slice('tag: '.length).trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        merged.push({ name, hash: commit.shortHash, subject: commit.subject });
      }
    }
    return merged;
  }, [tags, browseCommits]);

  // 浏览器预览没有 Git，只能在样本数据里过滤。桌面端有筛选时改走后端查询。
  const previewCommits = useMemo(() => {
    const onSelectedBranch = selectedBranch === 'All'
      ? null
      : hashesReachableFromRef(commits, selectedBranch);
    return commits.filter(commit => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchSubject = commit.subject.toLowerCase().includes(q);
        const matchHash = commit.hash.toLowerCase().includes(q);
        const matchAuthor = commit.author.toLowerCase().includes(q);
        if (!matchSubject && !matchHash && !matchAuthor) return false;
      }
      if (selectedAuthor !== 'All' && commit.author !== selectedAuthor) return false;
      if (onSelectedBranch && !onSelectedBranch.has(commit.hash)) return false;
      if (!matchesDate(commit.date, selectedDate)) return false;
      if (pathQuery.trim()) {
        const q = pathQuery.trim().toLowerCase();
        if (!commit.files.some(file => file.path.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [commits, searchQuery, selectedBranch, selectedAuthor, selectedDate, pathQuery]);

  const displayedCommits = !native
    ? previewCommits
    : !queryActive
      ? browseCommits
      : queryReadyKey === activeKey
        ? queryCommits
        : queryLoading && queryReadyKey
          ? queryCommits
          : queryLoading
            ? browseCommits
            : queryError
              ? []
              : browseCommits;

  const currentSelectedCommit = useMemo(() => {
    const found = displayedCommits.find(commit => commit.hash === selectedCommitHash)
      || browseCommits.find(commit => commit.hash === selectedCommitHash)
      || retainedCommit.current;
    if (found) retainedCommit.current = found;
    const base = found || displayedCommits[0] || null;
    if (!base) return null;
    const files = fileCache[base.hash];
    return files ? { ...base, files } : base;
  }, [displayedCommits, browseCommits, selectedCommitHash, fileCache]);

  useEffect(() => {
    const hash = currentSelectedCommit?.hash;
    setFilesError('');
    if (!native || !repoPath || !hash) return;
    if ((currentSelectedCommit?.files.length ?? 0) > 0 || fileCache[hash]) return;
    let cancelled = false;
    setFilesLoadingHash(hash);
    setFilesError('');
    loadCommitFiles(repoPath, hash)
      .then(files => {
        if (cancelled) return;
        setFileCache(prev => ({ ...prev, [hash]: files }));
      })
      .catch(err => {
        if (!cancelled) setFilesError(errorText(err, t('detail.filesFailed')));
      })
      .finally(() => {
        if (!cancelled) setFilesLoadingHash(current => current === hash ? '' : current);
      });
    return () => {
      cancelled = true;
    };
  }, [native, repoPath, currentSelectedCommit, fileCache, t]);

  const listLoading = queryActive ? queryLoading : browseLoading;
  const canLoadMore = native && (queryActive
    ? queryReadyKey === activeKey && queryHasMore && !queryLoading
    : browseHasMore && !browseLoading);
  const listNote = queryActive
    ? queryReadyKey === activeKey
      ? queryHasMore
        ? t('log.matchPage', { count: displayedCommits.length })
        : displayedCommits.length === 0 && !queryLoading
          ? t('log.empty')
          : ''
      : ''
    : browseHasMore
      ? t('log.latestPage', { count: browseCommits.length })
      : '';

  const loadMore = () => {
    if (!native || !repoPath || listLoading || loadingRef.current) return;
    loadingRef.current = true;
    const pathAtStart = repoPath;
    const release = () => {
      if (repoRef.current === pathAtStart) loadingRef.current = false;
    };
    if (queryActive) {
      if (queryReadyKey !== activeKey || !queryHasMore) {
        release();
        return;
      }
      const seq = ++requestSeq.current;
      setQueryLoading(true);
      setQueryError('');
      loadCommitLog(repoPath, { ...historyQuery, skip: queryCommits.length })
        .then(page => {
          if (seq !== requestSeq.current || repoRef.current !== pathAtStart) return;
          setQueryCommits(prev => appendCommits(prev, page.commits));
          setQueryHasMore(page.hasMore);
          setQueryReadyKey(activeKey);
        })
        .catch(err => {
          if (seq !== requestSeq.current || repoRef.current !== pathAtStart) return;
          setQueryError(errorText(err, t('log.loadFailed')));
        })
        .finally(() => {
          if (seq === requestSeq.current) setQueryLoading(false);
          release();
        });
      return;
    }
    if (!browseHasMore) {
      release();
      return;
    }
    setBrowseLoading(true);
    setQueryError('');
    loadCommitLog(repoPath, { skip: browseCommits.length })
      .then(page => {
        if (repoRef.current !== pathAtStart) return;
        const known = new Set(commits.map(commit => commit.hash));
        setExtraCommits(prev => appendCommits(prev, page.commits.filter(commit => !known.has(commit.hash))));
        setBrowseHasMore(page.hasMore);
        exhaustedRef.current = !page.hasMore;
      })
      .catch(err => {
        if (repoRef.current === pathAtStart) setQueryError(errorText(err, t('log.loadFailed')));
      })
      .finally(() => {
        if (repoRef.current === pathAtStart) setBrowseLoading(false);
        release();
      });
  };

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
        storageKey="snailgit.log.branchWidth"
        lockedSize={branchesCollapsed ? 28 : undefined}
        className="flex-1 min-h-0"
        start={
          <BranchPanel
            repoKey={repoPath}
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
            onUpdate={onUpdateBranch}
            onPush={onPushBranch}
            onRename={onRenameBranch ? (name) => {
              const next = prompt(t('toast.renamePrompt'), name);
              if (!next || next === name) return;
              void onRenameBranch(name, next).then(ok => {
                if (ok) setSelectedBranch(prev => prev === name ? next : prev);
              });
            } : undefined}
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
        storageKey="snailgit.log.detailHeight"
        lockedSize={detailCollapsed ? 28 : undefined}
        className="flex-1 min-h-0"
        start={
      <CommitGraph
        commits={displayedCommits}
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
        listNote={listNote}
        listLoading={listLoading}
        listError={queryError}
        hasMore={canLoadMore}
        onLoadMore={loadMore}
      />
        }
        end={
      <CommitDetail
        commit={currentSelectedCommit}
        filesLoading={filesLoadingHash === currentSelectedCommit?.hash}
        filesError={filesError}
        onCollapsedChange={setDetailCollapsed}
        onOpenFileDiff={(path) => {
          if (currentSelectedCommit) onOpenFileDiff(currentSelectedCommit, path);
        }}
        onSelectParent={(hash) => {
          const found = browseCommits.find(commit => commit.hash === hash || commit.hash.startsWith(hash) || hash.startsWith(commit.hash))
            || displayedCommits.find(commit => commit.hash === hash || commit.hash.startsWith(hash) || hash.startsWith(commit.hash));
          if (!found) {
            onParentMissing?.(hash);
            return;
          }
          const visible = displayedCommits.some(commit => commit.hash === found.hash);
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
