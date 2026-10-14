import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { TabBar, ActiveTab } from './components/TabBar';
import { GitLogView } from './components/GitLogView';
import { CommitView } from './components/CommitView';
import { BranchesModal } from './components/BranchesModal';
import { ShelfStashView } from './components/ShelfStashView';
import { ThreeWayMergeModal } from './components/ThreeWayMergeModal';
import { DiffModal } from './components/DiffModal';
import { StatusBar } from './components/StatusBar';
import { ProjectSidebar } from './components/ProjectSidebar';
import { DiffChunk, FileChange, GitRepository, RevisionFile, StashItem } from './types/git';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import {
  addSavedRepo,
  applyChunk,
  checkoutBranch,
  cherryPick,
  commitChanges,
  createBranch,
  createPatch,
  createShelf,
  deleteBranch,
  deleteShelf,
  discardPaths,
  fetchRepo,
  inspectFile,
  isTauriEnvironment,
  listenGitChanged,
  listenGitProgress,
  loadConflict,
  loadFileDiff,
  loadRepoSnapshot,
  loadRevisionDiff,
  listRevisionFiles,
  listSavedRepos,
  mergeBranch,
  pickDirectory,
  processMemoryMb,
  pushRepo,
  rebaseOnto,
  removeSavedRepo,
  renameBranch,
  resetTo,
  resolveConflict,
  revealPath,
  revertCommit,
  setWatchPath,
  setWatchPaused,
  shelfPatchFiles,
  smartMergeConflict,
  stashPatchFiles,
  stashSave,
  stagePaths,
  stashApply,
  stashDrop,
  toggleFavoriteBranch,
  toggleFavoriteRepo,
  unshelve,
  unstagePaths,
  updateRepo,
  type SyncOutcome,
} from './services/gitService';
import {
  mockBranches,
  mockCommits,
  mockCurrentChanges,
  mockRepositories,
  mockShelves,
  mockStashes,
} from './mock/gitData';

export function App() {
  const [native, setNative] = useState(() => isTauriEnvironment());
  const [repositories, setRepositories] = useState<GitRepository[]>(() => isTauriEnvironment() ? [] : mockRepositories);
  const [activeRepoId, setActiveRepoId] = useState<string>(() => isTauriEnvironment() ? '' : 'repo-1');
  const activeRepo = repositories.find(r => r.id === activeRepoId) || repositories[0];

  const [activeTab, setActiveTab] = useState<ActiveTab>('commit');
  const [currentBranch, setCurrentBranch] = useState(activeRepo?.currentBranch || 'main');
  const [aheadCount, setAheadCount] = useState(0);
  const [behindCount, setBehindCount] = useState(0);
  const [gitVersion, setGitVersion] = useState(native ? 'Git' : '未连接 Git');
  const [branches, setBranches] = useState(native ? [] : mockBranches);
  const [commits, setCommits] = useState(native ? [] : mockCommits);
  const [changes, setChanges] = useState<FileChange[]>(native ? [] : mockCurrentChanges);
  const [shelves, setShelves] = useState(native ? [] : mockShelves);
  const [stashes, setStashes] = useState(native ? [] : mockStashes);
  const [loading, setLoading] = useState(false);

  const [isBranchesOpen, setIsBranchesOpen] = useState(false);
  const [memoryMb, setMemoryMb] = useState(0);
  const [fileEncoding, setFileEncoding] = useState('—');
  const [lineEnding, setLineEnding] = useState('—');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [conflictPath, setConflictPath] = useState('');
  const [conflictOurs, setConflictOurs] = useState('');
  const [conflictTheirs, setConflictTheirs] = useState('');
  const [conflictResult, setConflictResult] = useState('');
  const [diffTitle, setDiffTitle] = useState('');
  const [diffFiles, setDiffFiles] = useState<RevisionFile[]>([]);
  const diffLoader = useRef<(path: string, ignoreWhitespace: boolean) => Promise<DiffChunk[]>>(async () => []);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [opsLocked, setOpsLocked] = useState(false);
  const refreshLock = useRef(false);
  const refreshAgain = useRef(false);
  const diffLock = useRef(new Set<string>());
  const opLock = useRef(false);
  const acceptProgress = useRef(false);

  const showToast = (text: string, error = false) => {
    setToast({ text, error });
    setTimeout(() => setToast(null), error ? 5000 : 2800);
  };

  const applySnapshot = useCallback(async (repoPath: string) => {
    const snap = await loadRepoSnapshot(repoPath);
    setCurrentBranch(snap.currentBranch);
    setAheadCount(snap.aheadCount);
    setBehindCount(snap.behindCount);
    setGitVersion(snap.gitVersion || 'Git');
    setChanges(snap.changes);
    setCommits(snap.commits);
    setBranches(snap.branches);
    setStashes(snap.stashes);
    setShelves(snap.shelves);
    setRepositories(prev => prev.map(r => r.path === repoPath ? {
      ...r,
      currentBranch: snap.currentBranch,
      aheadCount: snap.aheadCount,
      behindCount: snap.behindCount,
      dirtyFilesCount: snap.dirtyFilesCount,
    } : r));
  }, []);

  const refresh = useCallback(async (repoPath?: string) => {
    const path = repoPath || activeRepo?.path;
    if (!isTauriEnvironment() || !path) return;
    if (refreshLock.current) {
      refreshAgain.current = true;
      return;
    }
    refreshLock.current = true;
    setLoading(true);
    try {
      await applySnapshot(path);
    } catch (err) {
      showToast(String(err), true);
    } finally {
      refreshLock.current = false;
      setLoading(false);
      if (refreshAgain.current) {
        refreshAgain.current = false;
        void refresh(path);
      }
    }
  }, [activeRepo?.path, applySnapshot]);

  const applySyncCounts = (repoPath: string, outcome: SyncOutcome) => {
    setAheadCount(outcome.ahead);
    setBehindCount(outcome.behind);
    setRepositories(prev => prev.map(repo => repo.path === repoPath ? {
      ...repo,
      aheadCount: outcome.ahead,
      behindCount: outcome.behind,
    } : repo));
  };

  const releaseOp = () => {
    acceptProgress.current = false;
    opLock.current = false;
    setOpsLocked(false);
    setBusyLabel(null);
  };

  const run = useCallback(async (label: string, action: () => Promise<string | void>) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast('浏览器预览不会改动真实仓库，请用 pnpm tauri dev', true);
      return;
    }
    if (opLock.current) return;
    opLock.current = true;
    setOpsLocked(true);
    setBusyLabel('正在执行…');
    try {
      const text = await action();
      showToast(text ? `${label}：${String(text).split('\n')[0]}` : label);
      setBusyLabel(null);
      await refresh(activeRepo.path);
    } catch (err) {
      showToast(String(err), true);
      setBusyLabel(null);
      await refresh(activeRepo.path);
    } finally {
      releaseOp();
    }
  }, [activeRepo, refresh]);

  const guardNetwork = useCallback(async (action: (repoPath: string) => Promise<void>) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast('浏览器预览不会改动真实仓库，请用 pnpm tauri dev', true);
      return;
    }
    if (opLock.current) return;
    const repoPath = activeRepo.path;
    opLock.current = true;
    setOpsLocked(true);
    setBusyLabel('正在连接远程，若弹出登录窗口请完成登录');
    acceptProgress.current = true;
    try {
      await setWatchPaused(true);
      await action(repoPath);
    } catch (err) {
      showToast(String(err), true);
      await refresh(repoPath);
    } finally {
      await setWatchPaused(false).catch(() => undefined);
      releaseOp();
    }
  }, [activeRepo, refresh]);

  const finishNetwork = async (repoPath: string, outcome: SyncOutcome) => {
    applySyncCounts(repoPath, outcome);
    showToast(outcome.message || '完成');
    acceptProgress.current = false;
    setBusyLabel(null);
    await refresh(repoPath);
  };

  const handleUpdate = useCallback(() => {
    void guardNetwork(async (repoPath) => {
      let outcome = await updateRepo(repoPath, false);
      if (outcome.status === 'needs_confirm') {
        acceptProgress.current = false;
        setBusyLabel(null);
        if (!window.confirm(outcome.message)) {
          applySyncCounts(repoPath, outcome);
          showToast('已取消更新');
          await refresh(repoPath);
          return;
        }
        acceptProgress.current = true;
        setBusyLabel('正在合并远程更新…');
        outcome = await updateRepo(repoPath, true);
      }
      await finishNetwork(repoPath, outcome);
    });
  }, [guardNetwork, refresh]);

  const handlePush = useCallback(() => {
    void guardNetwork(async (repoPath) => {
      let outcome = await pushRepo(repoPath, false);
      if (outcome.status === 'needs_confirm') {
        acceptProgress.current = false;
        setBusyLabel(null);
        if (!window.confirm(outcome.message)) {
          showToast('已取消推送');
          return;
        }
        acceptProgress.current = true;
        setBusyLabel(`正在推送到 ${outcome.remote}/${outcome.branch}…`);
        outcome = await pushRepo(repoPath, true);
      }
      await finishNetwork(repoPath, outcome);
    });
  }, [guardNetwork, refresh]);

  const handleFetch = useCallback(() => {
    void guardNetwork(async (repoPath) => {
      const text = await fetchRepo(repoPath);
      showToast(text ? `已刷新远程：${text.split('\n')[0]}` : '已刷新远程');
      acceptProgress.current = false;
      setBusyLabel(null);
      await refresh(repoPath);
    });
  }, [guardNetwork, refresh]);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    setNative(true);
    setBranches([]);
    setCommits([]);
    setChanges([]);
    setShelves([]);
    setStashes([]);
    void listSavedRepos().then(repos => {
      setRepositories(repos);
      setActiveRepoId(repos[0]?.id || '');
    }).catch(err => showToast(String(err), true));
  }, []);

  useEffect(() => {
    if (!isTauriEnvironment() || !activeRepo) return;
    void setWatchPath(activeRepo.path);
    void refresh(activeRepo.path);
  }, [native, activeRepo?.id]);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let stop = false;
    let unlisten = () => {};
    void listenGitChanged((path) => {
      if (!stop && activeRepo && path === activeRepo.path) void refresh(path);
    }).then(fn => { unlisten = fn; }).catch(() => undefined);
    return () => {
      stop = true;
      unlisten();
    };
  }, [activeRepo?.path, refresh]);

  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let stop = false;
    let unlisten = () => {};
    void listenGitProgress((event) => {
      if (stop || !acceptProgress.current) return;
      if (activeRepo && event.repoPath !== activeRepo.path) return;
      const line = event.line.trim();
      if (!line) return;
      setBusyLabel(line.length > 80 ? `${line.slice(0, 80)}…` : line);
    }).then(fn => { unlisten = fn; }).catch(() => undefined);
    return () => {
      stop = true;
      unlisten();
    };
  }, [activeRepo?.path]);

  const handleSelectRepo = (repo: GitRepository) => {
    setActiveRepoId(repo.id);
    setCurrentBranch(repo.currentBranch);
    if (!isTauriEnvironment()) {
      if (repo.id === 'repo-3') setChanges([]);
      else if (repo.id === 'repo-2') setChanges(mockCurrentChanges.slice(0, 5));
      else setChanges(mockCurrentChanges);
      showToast(`已切换至项目: ${repo.name}`);
    }
  };

  const handleAddRepo = async (name: string, path: string) => {
    if (!isTauriEnvironment()) {
      const repo: GitRepository = {
        id: `repo-${Date.now()}`,
        name,
        path,
        currentBranch: 'main',
        aheadCount: 0,
        behindCount: 0,
        dirtyFilesCount: 0,
        isFavorite: false,
        lastOpened: '刚刚',
      };
      setRepositories(prev => [repo, ...prev]);
      setActiveRepoId(repo.id);
      showToast(`预览模式已添加 ${name}，不会读取磁盘`);
      return;
    }
    try {
      const repo = await addSavedRepo(name, path);
      setRepositories(prev => [repo, ...prev.filter(item => item.id !== repo.id)]);
      setActiveRepoId(repo.id);
      showToast(`已打开仓库：${repo.name}`);
    } catch (err) {
      showToast(String(err), true);
    }
  };

  const handleRemoveRepo = async (repoId: string) => {
    if (!isTauriEnvironment()) {
      setRepositories(prev => prev.filter(r => r.id !== repoId));
      return;
    }
    const repos = await removeSavedRepo(repoId);
    setRepositories(repos);
    if (activeRepoId === repoId) setActiveRepoId(repos[0]?.id || '');
    showToast('已从列表移除，本地文件未删除');
  };

  const handleToggleFavorite = async (repoId: string) => {
    if (!isTauriEnvironment()) {
      setRepositories(prev => prev.map(r => r.id === repoId ? { ...r, isFavorite: !r.isFavorite } : r));
      return;
    }
    setRepositories(await toggleFavoriteRepo(repoId));
  };

  const handleToggleFile = (file: FileChange, staged: boolean) => {
    void run(staged ? '已暂存' : '已取消暂存', () =>
      staged ? stagePaths(activeRepo.path, [file.path]) : unstagePaths(activeRepo.path, [file.path])
    );
  };

  const handleBatch = (files: FileChange[], staged: boolean) => {
    const paths = files.map(f => f.path);
    void run(staged ? '已暂存所选文件' : '已取消暂存所选文件', () =>
      staged ? stagePaths(activeRepo.path, paths) : unstagePaths(activeRepo.path, paths)
    );
  };

  const handleChunk = (file: FileChange, chunkId: string) => {
    const chunk = file.chunks.find(c => c.id === chunkId);
    if (!chunk?.rawPatch) {
      showToast('这个差异块没有可应用的补丁', true);
      return;
    }
    void run(chunk.isStaged ? '已取消暂存该块' : '已暂存该块', () =>
      applyChunk(activeRepo.path, chunk.rawPatch!, chunk.isStaged ? 'unstage' : 'stage')
    );
  };

  const handleRevertChunk = (file: FileChange, chunkId: string) => {
    const chunk = file.chunks.find(c => c.id === chunkId);
    if (!chunk?.rawPatch) return;
    if (!confirm('丢弃这个代码块的修改？此操作不可用普通撤销恢复。')) return;
    void run('已回滚该代码块', () => applyChunk(activeRepo.path, chunk.rawPatch!, 'rollback'));
  };

  const requestDiff = useCallback((file: FileChange) => {
    if (!isTauriEnvironment() || !activeRepo || diffLock.current.has(file.id)) return;
    diffLock.current.add(file.id);
    void loadFileDiff(activeRepo.path, file.path, ignoreWhitespace).then(chunks => {
      const additions = chunks.reduce((n, c) => n + c.lines.filter(l => l.type === 'added').length, 0);
      const deletions = chunks.reduce((n, c) => n + c.lines.filter(l => l.type === 'deleted').length, 0);
      setChanges(prev => prev.map(item => item.id === file.id
        ? { ...item, chunks, chunksLoaded: true, additions, deletions }
        : item));
    }).catch(err => {
      showToast(String(err), true);
      setChanges(prev => prev.map(item => item.id === file.id ? { ...item, chunksLoaded: true } : item));
    }).finally(() => diffLock.current.delete(file.id));
  }, [activeRepo, ignoreWhitespace]);

  const openDiff = useCallback((title: string, files: RevisionFile[], loader: (path: string, ignoreWhitespace: boolean) => Promise<DiffChunk[]>) => {
    diffLoader.current = loader;
    setDiffFiles(files);
    setDiffTitle(title);
  }, []);

  const openRevision = useCallback(async (title: string, spec: string, mode: 'commit' | 'worktree' | 'range', onlyPath?: string) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast('浏览器预览没有真实提交差异', true);
      return;
    }
    try {
      const files = await listRevisionFiles(activeRepo.path, spec, mode);
      const shown = onlyPath ? files.filter(file => file.path === onlyPath) : files;
      const repoPath = activeRepo.path;
      openDiff(title, shown.length ? shown : files, (path, ignore) => loadRevisionDiff(repoPath, spec, path, mode, ignore));
    } catch (err) {
      showToast(String(err), true);
    }
  }, [activeRepo, openDiff]);

  const loadConflictFile = useCallback(async (path: string) => {
    if (!isTauriEnvironment() || !activeRepo || !path) return;
    setConflictPath(path);
    try {
      const view = await loadConflict(activeRepo.path, path);
      setConflictOurs(view.ours);
      setConflictTheirs(view.theirs);
      setConflictResult(view.working);
    } catch (err) {
      showToast(String(err), true);
    }
  }, [activeRepo]);

  const handleDeleteBranch = async (branch: { name: string; isRemote?: boolean }, force = false) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast('浏览器预览不会改动真实仓库，请用 pnpm tauri dev', true);
      return;
    }
    if (!force) {
      const warning = branch.isRemote
        ? `删除远程分支 ${branch.name}？这会推送删除，不能撤销。`
        : `删除本地分支 ${branch.name}？`;
      if (!confirm(warning)) return;
    }
    try {
      const text = await deleteBranch(activeRepo.path, branch.name, Boolean(branch.isRemote), force);
      showToast(text || '已删除分支');
      await refresh(activeRepo.path);
    } catch (err) {
      const message = String(err);
      if (!force && !branch.isRemote && /not fully merged|not merged/i.test(message)) {
        if (confirm('这个分支还没有完全合并。强制删除？')) {
          await handleDeleteBranch(branch, true);
        }
        return;
      }
      showToast(message, true);
    }
  };

  const handleSelectedFile = useCallback((file: FileChange | null) => {
    if (!isTauriEnvironment() || !activeRepo || !file) {
      setFileEncoding('—');
      setLineEnding('—');
      return;
    }
    void inspectFile(activeRepo.path, file.path).then(meta => {
      setFileEncoding(meta.encoding);
      setLineEnding(meta.lineEnding);
    }).catch(() => {
      setFileEncoding('—');
      setLineEnding('—');
    });
  }, [activeRepo]);

  useEffect(() => {
    if (!isTauriEnvironment()) {
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      if (heap) setMemoryMb(Math.max(1, Math.round(heap / 1048576)));
      return;
    }
    const tick = () => { void processMemoryMb().then(setMemoryMb).catch(() => undefined); };
    tick();
    const id = window.setInterval(tick, 8000);
    return () => window.clearInterval(id);
  }, [native]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const code = e.code;
      if (e.altKey && (e.key === '9' || code === 'Digit9')) {
        e.preventDefault();
        setActiveTab('log');
      } else if (e.altKey && (e.key === '0' || code === 'Digit0')) {
        e.preventDefault();
        setActiveTab('commit');
      } else if (e.ctrlKey && e.shiftKey && (e.key.toLowerCase() === 'k' || code === 'KeyK')) {
        e.preventDefault();
        handlePush();
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveTab('commit');
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        handleUpdate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePush, handleUpdate]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-jb-bg text-jb-text-primary font-sans antialiased">
      <ProjectSidebar
        repositories={repositories}
        activeRepoId={activeRepoId}
        onSelectRepo={handleSelectRepo}
        onAddRepo={(name, path) => { void handleAddRepo(name, path); }}
        onBrowse={pickDirectory}
        onRemoveRepo={(id) => { void handleRemoveRepo(id); }}
        onToggleFavorite={(id) => { void handleToggleFavorite(id); }}
        onRevealRepo={(repo) => {
          if (!isTauriEnvironment()) {
            showToast('浏览器预览不能打开资源管理器', true);
            return;
          }
          void revealPath(repo.path).catch(err => showToast(String(err), true));
        }}
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Header
          currentRepoName={activeRepo?.name || (native ? '未打开仓库' : 'easy-git')}
          currentRepoPath={activeRepo?.path || (native ? '从左侧添加一个本地 Git 仓库' : '')}
          currentBranch={currentBranch}
          onOpenBranches={() => setIsBranchesOpen(true)}
          onCommitClick={() => setActiveTab('commit')}
          onUpdateClick={handleUpdate}
          onPushClick={handlePush}
          onFetchClick={handleFetch}
          busyLabel={busyLabel}
          operationsLocked={opsLocked}
          onRollbackClick={() => {
            if (!activeRepo || changes.length === 0) {
              showToast('没有可回滚的更改', true);
              return;
            }
            if (confirm(`回滚全部 ${changes.length} 个更改到 HEAD？此操作不可用普通撤销恢复。`)) {
              void run('已回滚工作区', () => discardPaths(activeRepo.path, changes.map(file => file.path)));
            }
          }}
          onShelfClick={() => setActiveTab('shelf')}
          aheadCount={aheadCount}
          behindCount={behindCount}
          memoryMb={memoryMb}
        />

        <TabBar
          activeTab={activeTab}
          onTabChange={(tab) => {
            setActiveTab(tab);
            if (tab === 'merge') {
              const first = changes.find(file => file.status === 'conflict');
              if (first) void loadConflictFile(first.path);
            }
          }}
          changesCount={changes.filter(c => c.isStaged).length}
          gitVersion={gitVersion}
        />

        <main className="flex-1 flex overflow-hidden relative">
          {!activeRepo && (
            <div className="flex-1 flex items-center justify-center text-sm text-jb-text-muted">
              还没有仓库。点击左侧 + 添加一个本地 Git 目录。
            </div>
          )}

          {activeRepo && activeTab === 'log' && (
            <GitLogView
              commits={commits}
              onOpenFileDiff={(commit, path) => {
                void openRevision(`${commit.shortHash} ${path}`, commit.hash, 'commit', path);
              }}
              onShowDiffWithLocal={(commit) => void openRevision(`Diff with Local ${commit.shortHash}`, commit.hash, 'worktree')}
              onParentMissing={(hash) => showToast(`父提交 ${hash.slice(0, 8)} 不在当前加载的历史里`, true)}
              onCheckout={(hash) => void run('已检出该提交', () => checkoutBranch(activeRepo.path, hash))}
              onCherryPick={(hash) => void run('挑拣完成', () => cherryPick(activeRepo.path, hash))}
              onRevert={(hash) => void run('已还原该提交', () => revertCommit(activeRepo.path, hash))}
              onReset={(hash) => void run('已混合重置', () => resetTo(activeRepo.path, hash))}
              onCreateBranch={(hash) => {
                const name = prompt('从该提交创建并检出分支：', 'feature/');
                if (name) void run('已创建分支', () => createBranch(activeRepo.path, name, hash));
              }}
            />
          )}

          {activeRepo && activeTab === 'commit' && (
            <CommitView
              changes={changes}
              onCommit={(msg, amend, andPush) => void run(andPush ? '已提交并推送' : '已提交', () =>
                commitChanges(activeRepo.path, msg, amend, andPush)
              )}
              onShelve={() => {
                const name = prompt('架藏名称：', '') || '';
                const paths = changes.filter(c => c.isStaged).map(c => c.path);
                void run('已架藏', async () => {
                  await createShelf(activeRepo.path, name, paths);
                  return '变更已保存到本地 Shelf';
                });
              }}
              onToggleFileStage={handleToggleFile}
              onBatchToggleStage={handleBatch}
              onToggleAllStage={(staged) => handleBatch(changes, staged)}
              onToggleChunkStage={handleChunk}
              onRevertChunk={handleRevertChunk}
              onRollbackFile={(file) => {
                if (confirm(`回滚 ${file.path} 到 HEAD？`)) {
                  void run('已回滚文件', () => discardPaths(activeRepo.path, [file.path]));
                }
              }}
              onRefresh={() => void refresh()}
              onRequestDiff={requestDiff}
              onCreatePatch={() => {
                if (!activeRepo) return;
                const paths = changes.filter(file => file.isStaged).map(file => file.path);
                void run('补丁', () => createPatch(activeRepo.path, paths.length ? paths : changes.map(file => file.path)));
              }}
              repoKey={activeRepo.id}
              ignoreWhitespace={ignoreWhitespace}
              onIgnoreWhitespaceChange={(value) => {
                setIgnoreWhitespace(value);
                diffLock.current.clear();
                setChanges(prev => prev.map(file => ({ ...file, chunks: [], chunksLoaded: false })));
              }}
              onResolveConflict={(file) => {
                setActiveTab('merge');
                void loadConflictFile(file.path);
              }}
              onSelectedFileChange={handleSelectedFile}
            />
          )}

          {activeRepo && activeTab === 'branches' && (
            <BranchesModal
              embedded
              isOpen
              onClose={() => undefined}
              branches={branches}
              currentBranch={currentBranch}
              onSelectBranch={(name) => void run(`已检出 ${name}`, () => checkoutBranch(activeRepo.path, name))}
              onCreateBranch={(name) => void run('已创建分支', () => createBranch(activeRepo.path, name))}
              onMerge={(name) => void run('合并完成', () => mergeBranch(activeRepo.path, name))}
              onRebase={(name) => void run('变基完成', () => rebaseOnto(activeRepo.path, name))}
              onCompare={(name) => void openRevision(`Compare ${name} with ${currentBranch}`, `HEAD...${name}`, 'range')}
              onDelete={(branch, force) => { void handleDeleteBranch(branch, force); }}
              onRename={(branch) => {
                const name = prompt('新的分支名：', branch.name);
                if (name && name !== branch.name) void run('已重命名', () => renameBranch(activeRepo.path, branch.name, name));
              }}
              onToggleFavorite={(branch) => void run(branch.isFavorite ? '已取消收藏' : '已收藏分支', async () => {
                await toggleFavoriteBranch(activeRepo.path, branch.name);
                return branch.name;
              })}
            />
          )}

          {activeRepo && activeTab === 'shelf' && (
            <ShelfStashView
              shelves={shelves}
              stashes={stashes}
              onUnshelve={(id) => void run('已恢复架藏', () => unshelve(activeRepo.path, id))}
              onDeleteShelf={(id) => void run('已删除架藏', () => deleteShelf(activeRepo.path, id))}
              onApplyStash={(stash: StashItem) => void run('已应用贮藏', () => stashApply(activeRepo.path, stash.index, false))}
              onPopStash={(stash) => void run('已弹出贮藏', () => stashApply(activeRepo.path, stash.index, true))}
              onDropStash={(stash) => void run('已丢弃贮藏', () => stashDrop(activeRepo.path, stash.index))}
              onCreateStash={() => {
                const message = prompt('贮藏说明：', '') || 'EasyGit stash';
                void run('已贮藏', () => stashSave(activeRepo.path, message));
              }}
              onShowShelfDiff={(id) => {
                if (!isTauriEnvironment()) {
                  showToast('浏览器预览没有架藏差异', true);
                  return;
                }
                void shelfPatchFiles(activeRepo.path, id).then(files => {
                  openDiff(`Shelf ${id}`, files, async (path) => files.find(file => file.path === path)?.chunks || []);
                }).catch(err => showToast(String(err), true));
              }}
              onShowStashDiff={(stash) => {
                if (!isTauriEnvironment()) {
                  showToast('浏览器预览没有贮藏差异', true);
                  return;
                }
                void stashPatchFiles(activeRepo.path, stash.index).then(files => {
                  openDiff(stash.message, files, async (path) => files.find(file => file.path === path)?.chunks || []);
                }).catch(err => showToast(String(err), true));
              }}
            />
          )}

          {activeRepo && activeTab === 'merge' && (
            <ThreeWayMergeModal
              embedded
              isOpen
              files={changes.filter(file => file.status === 'conflict').map(file => ({ path: file.path }))}
              activePath={conflictPath}
              ours={conflictOurs}
              theirs={conflictTheirs}
              result={conflictResult}
              onSelectFile={(path) => { void loadConflictFile(path); }}
              onResultChange={setConflictResult}
              onAcceptLeft={() => setConflictResult(conflictOurs)}
              onAcceptRight={() => setConflictResult(conflictTheirs)}
              onSmartMerge={() => {
                if (!isTauriEnvironment() || !conflictPath) {
                  showToast('浏览器预览不能合并真实冲突', true);
                  return;
                }
                void smartMergeConflict(activeRepo.path, conflictPath).then(setConflictResult).catch(err => showToast(String(err), true));
              }}
              onSave={() => {
                if (!conflictPath) return;
                void run('冲突已解决', () => resolveConflict(activeRepo.path, conflictPath, conflictResult));
              }}
              onClose={() => setActiveTab('commit')}
            />
          )}

          {loading && (
            <div className="absolute top-2 right-3 text-[11px] text-jb-text-muted">正在读取 Git…</div>
          )}
        </main>

        <StatusBar
          currentBranch={currentBranch}
          onOpenBranches={() => setIsBranchesOpen(true)}
          stagedFilesCount={changes.filter(c => c.isStaged).length}
          dirtyFilesCount={changes.length}
          aheadCount={aheadCount}
          behindCount={behindCount}
          gitVersion={gitVersion}
          memoryMb={memoryMb}
          encoding={fileEncoding}
          lineEnding={lineEnding}
        />
      </div>

      <BranchesModal
        isOpen={isBranchesOpen}
        onClose={() => setIsBranchesOpen(false)}
        branches={branches}
        currentBranch={currentBranch}
        onSelectBranch={(name) => {
          void run(`已检出 ${name}`, () => checkoutBranch(activeRepo.path, name));
        }}
        onCreateBranch={(name) => void run('已创建分支', () => createBranch(activeRepo.path, name))}
        onMerge={(name) => void run('合并完成', () => mergeBranch(activeRepo.path, name))}
        onRebase={(name) => void run('变基完成', () => rebaseOnto(activeRepo.path, name))}
        onCompare={(name) => {
          setIsBranchesOpen(false);
          void openRevision(`Compare ${name} with ${currentBranch}`, `HEAD...${name}`, 'range');
        }}
        onDelete={(branch, force) => { void handleDeleteBranch(branch, force); }}
        onRename={(branch) => {
          const name = prompt('新的分支名：', branch.name);
          if (name && name !== branch.name) void run('已重命名', () => renameBranch(activeRepo.path, branch.name, name));
        }}
        onToggleFavorite={(branch) => void run(branch.isFavorite ? '已取消收藏' : '已收藏分支', async () => {
          await toggleFavoriteBranch(activeRepo.path, branch.name);
          return branch.name;
        })}
      />

      {diffTitle && (
        <DiffModal
          title={diffTitle}
          files={diffFiles}
          onLoad={(path, ignore) => diffLoader.current(path, ignore)}
          onClose={() => setDiffTitle('')}
        />
      )}

      {toast && (
        <div className="fixed bottom-10 right-6 z-50 bg-jb-panel border border-jb-blue/50 text-white px-4 py-2.5 rounded-lg shadow-2xl flex items-center space-x-2 text-xs max-w-md">
          {toast.error
            ? <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            : <CheckCircle2 className="w-4 h-4 text-jb-green shrink-0" />}
          <span className="font-medium break-all">{toast.text}</span>
        </div>
      )}
    </div>
  );
}

export default App;
