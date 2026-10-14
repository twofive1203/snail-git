import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { ActiveTab } from './components/TabBar';
import { GitLogView } from './components/GitLogView';
import type { SyncAction } from './components/Header';
import { CommitView } from './components/CommitView';
import { BranchesModal } from './components/BranchesModal';
import { ShelfStashView } from './components/ShelfStashView';
import { ThreeWayMergeModal } from './components/ThreeWayMergeModal';
import { DiffModal } from './components/DiffModal';
import { StatusBar } from './components/StatusBar';
import { WindowResizeFrame } from './components/WindowControls';
import { ShelveDialog } from './components/ShelfStashView/ShelveDialog';
import { AddProjectModal } from './components/ProjectSidebar/AddProjectModal';
import { DiffChunk, FileChange, GitRepository, RevisionFile, StashItem } from './types/git';
import { CheckCircle2, AlertCircle, AlertTriangle, GitMerge, FolderGit2, Archive, ArrowUp } from 'lucide-react';
import {
  addSavedRepo,
  appendGitignore,
  applyChunk,
  checkoutBranch,
  cherryPick,
  commitChanges,
  createBranch,
  createPatch,
  createShelf,
  deleteBranch,
  deleteShelf,
  deleteUnversioned,
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
  type UpdateResponse,
} from './services/gitService';
import {
  mockBranches,
  mockCommits,
  mockCurrentChanges,
  mockRepositories,
  mockShelves,
  mockStashes,
} from './mock/gitData';
import { ConfirmDialog, type ConfirmAction } from './components/common/ConfirmDialog';

/** 更新/推送被后端拦下时的确认框状态；等待用户选择期间操作锁已释放。 */
interface PendingConfirm {
  kind: 'update' | 'push';
  repoPath: string;
  outcome: SyncOutcome;
}

/** 远程会覆盖未提交改动时只提供贮藏。不贮藏再试必然失败，变基也不再单独给“仍然变基”。 */
const confirmActions = (pending: PendingConfirm | null): ConfirmAction[] => {
  if (!pending) return [];
  if (pending.kind === 'push') {
    return [{ value: 'continue', label: '确认并推送', tone: 'primary', icon: <ArrowUp className="w-3.5 h-3.5" /> }];
  }
  return [
    { value: 'stash', label: '贮藏后更新（推荐）', tone: 'primary', icon: <Archive className="w-3.5 h-3.5" /> },
  ];
};

export function App() {
  const [native, setNative] = useState(() => isTauriEnvironment());
  const [repositories, setRepositories] = useState<GitRepository[]>(() => isTauriEnvironment() ? [] : mockRepositories);
  const [activeRepoId, setActiveRepoId] = useState<string>(() => isTauriEnvironment() ? '' : 'repo-1');
  const activeRepo = repositories.find(r => r.id === activeRepoId) || repositories[0];

  const [activeTab, setActiveTab] = useState<ActiveTab>('commit');
  const [currentBranch, setCurrentBranch] = useState(activeRepo?.currentBranch || 'main');
  const [aheadCount, setAheadCount] = useState(0);
  const [behindCount, setBehindCount] = useState(0);
  const [currentUser, setCurrentUser] = useState(native ? '' : 'Li Chong');
  const [syncAction, setSyncAction] = useState<SyncAction | null>(null);
  const [shelveDraft, setShelveDraft] = useState<{ paths: string[]; count: number; includesUnstaged: boolean } | null>(null);
  const [gitVersion, setGitVersion] = useState(native ? 'Git' : '未连接 Git');
  const [branches, setBranches] = useState(native ? [] : mockBranches);
  const [commits, setCommits] = useState(native ? [] : mockCommits);
  const [changes, setChanges] = useState<FileChange[]>(native ? [] : mockCurrentChanges);
  const [shelves, setShelves] = useState(native ? [] : mockShelves);
  const [stashes, setStashes] = useState(native ? [] : mockStashes);
  const [loading, setLoading] = useState(false);

  const [isBranchesOpen, setIsBranchesOpen] = useState(false);
  const [isAddRepoOpen, setIsAddRepoOpen] = useState(false);
  const [memoryMb, setMemoryMb] = useState(0);
  const [fileEncoding, setFileEncoding] = useState('—');
  const [lineEnding, setLineEnding] = useState('—');
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [conflictPath, setConflictPath] = useState('');
  const [conflictOurs, setConflictOurs] = useState('');
  const [conflictTheirs, setConflictTheirs] = useState('');
  const [conflictBase, setConflictBase] = useState('');
  const [conflictWorking, setConflictWorking] = useState('');
  const [conflictLoading, setConflictLoading] = useState(false);
  const [conflictGen, setConflictGen] = useState(0);
  const [diffTitle, setDiffTitle] = useState('');
  const [diffFiles, setDiffFiles] = useState<RevisionFile[]>([]);
  const diffLoader = useRef<(path: string, ignoreWhitespace: boolean) => Promise<DiffChunk[]>>(async () => []);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
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
    setCurrentUser(snap.userName || '');
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
    setSyncAction(null);
  };

  const run = useCallback(async (label: string, action: () => Promise<string | void>) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast('浏览器预览不会改动真实仓库，请用 pnpm tauri dev', true);
      return false;
    }
    if (opLock.current) return false;
    opLock.current = true;
    setOpsLocked(true);
    setBusyLabel('正在执行…');
    try {
      const text = await action();
      showToast(text ? `${label}：${String(text).split('\n')[0]}` : label);
      setBusyLabel(null);
      await refresh(activeRepo.path);
      return true;
    } catch (err) {
      showToast(String(err), true);
      setBusyLabel(null);
      await refresh(activeRepo.path);
      return false;
    } finally {
      releaseOp();
    }
  }, [activeRepo, refresh]);

  const guardNetwork = useCallback(async (kind: SyncAction, action: (repoPath: string) => Promise<void>) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast('浏览器预览不会改动真实仓库，请用 pnpm tauri dev', true);
      return;
    }
    if (opLock.current) return;
    const repoPath = activeRepo.path;
    opLock.current = true;
    setOpsLocked(true);
    setSyncAction(kind);
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
    // blocked 表示这次操作根本没生效，不能拿成功图标糊弄用户。
    const failed = outcome.status === 'blocked' || outcome.status === 'failed';
    showToast(outcome.message || '完成', failed);
    acceptProgress.current = false;
    setBusyLabel(null);
    await refresh(repoPath);
  };

  const handleUpdate = useCallback(() => {
    void guardNetwork('update', async (repoPath) => {
      const outcome = await updateRepo(repoPath, 'probe');
      if (outcome.status === 'needs_confirm') {
        // 释放锁并把选择权交给弹窗：等待用户期间不阻塞其他操作。
        acceptProgress.current = false;
        setBusyLabel(null);
        setSyncAction(null);
        setPendingConfirm({ kind: 'update', repoPath, outcome });
        return;
      }
      await finishNetwork(repoPath, outcome);
    });
  }, [guardNetwork, refresh]);

  const handlePush = useCallback(() => {
    void guardNetwork('push', async (repoPath) => {
      const outcome = await pushRepo(repoPath, false);
      if (outcome.status === 'needs_confirm') {
        acceptProgress.current = false;
        setBusyLabel(null);
        setSyncAction(null);
        setPendingConfirm({ kind: 'push', repoPath, outcome });
        return;
      }
      await finishNetwork(repoPath, outcome);
    });
  }, [guardNetwork, refresh]);

  const cancelConfirm = useCallback(() => {
    setPendingConfirm(null);
    showToast('已取消');
  }, []);

  const chooseConfirm = useCallback((value: string) => {
    const pending = pendingConfirm;
    if (!pending) return;
    setPendingConfirm(null);
    if (pending.kind === 'push') {
      // 推进程的确认只有“继续”一种意思，其余选项都在弹窗里带 cancel。
      void guardNetwork('push', async (repoPath) => {
        const outcome = await pushRepo(repoPath, true);
        await finishNetwork(repoPath, outcome);
      });
      return;
    }
    void guardNetwork('update', async (repoPath) => {
      const outcome = await updateRepo(repoPath, value as UpdateResponse);
      if (outcome.status === 'cancelled') {
        showToast('已取消更新');
        await refresh(repoPath);
        return;
      }
      if (outcome.status === 'needs_confirm') {
        // 贮藏后若仍被挡住，再把选择权交回去。
        acceptProgress.current = false;
        setBusyLabel(null);
        setSyncAction(null);
        setPendingConfirm({ kind: 'update', repoPath, outcome });
        return;
      }
      // blocked：这次更新没生效，finishNetwork 会按失败提示。
      await finishNetwork(repoPath, outcome);
    });
  }, [pendingConfirm, guardNetwork, refresh]);

  const handleFetch = useCallback(() => {
    void guardNetwork('fetch', async (repoPath) => {
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
    setConflictLoading(true);
    try {
      const view = await loadConflict(activeRepo.path, path);
      setConflictOurs(view.ours);
      setConflictTheirs(view.theirs);
      setConflictBase(view.base);
      setConflictWorking(view.working);
      setConflictGen(gen => gen + 1);
    } catch (err) {
      showToast(String(err), true);
    } finally {
      setConflictLoading(false);
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

  const focusList = useCallback(() => {
    const selector = activeTab === 'commit'
      ? '[data-keyboard-root="commit"]'
      : activeTab === 'log'
        ? '[data-keyboard-root="log"]'
        : '[data-keyboard-root="shelf"]';
    document.querySelector<HTMLElement>(selector)?.focus();
  }, [activeTab]);

  const openShelve = useCallback(() => {
    const staged = changes.filter(file => file.isStaged).map(file => file.path);
    const count = staged.length || changes.length;
    if (count === 0) {
      showToast('没有可架藏的更改', true);
      return;
    }
    setShelveDraft({ paths: staged, count, includesUnstaged: staged.length === 0 });
  }, [changes]);

  const confirmShelve = (name: string) => {
    const draft = shelveDraft;
    setShelveDraft(null);
    if (!draft || !activeRepo) return;
    void run('已架藏', async () => {
      await createShelf(activeRepo.path, name, draft.paths);
      setActiveTab('shelf');
      return '变更已保存到本地 Shelf';
    });
  };

  useEffect(() => {
    const typingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      const overlayOpen = Boolean(shelveDraft) || Boolean(diffTitle) || isAddRepoOpen || isBranchesOpen;
      if (e.key === 'Escape') {
        if (shelveDraft) setShelveDraft(null);
        else if (diffTitle) setDiffTitle('');
        else if (isAddRepoOpen) setIsAddRepoOpen(false);
        else if (isBranchesOpen) setIsBranchesOpen(false);
        else if (typingTarget(e.target)) (e.target as HTMLElement).blur();
        window.dispatchEvent(new Event('easygit:dismiss'));
        e.preventDefault();
        focusList();
        return;
      }
      if (overlayOpen) return;
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
      } else if (e.ctrlKey && !e.shiftKey && (e.key.toLowerCase() === 'k' || code === 'KeyK')) {
        e.preventDefault();
        setActiveTab('commit');
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === 't' || code === 'KeyT')) {
        if (typingTarget(e.target)) return;
        e.preventDefault();
        handleUpdate();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePush, handleUpdate, focusList, shelveDraft, diffTitle, isAddRepoOpen, isBranchesOpen]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-jb-bg text-jb-text-primary font-sans antialiased">
      <WindowResizeFrame />
      <Header
        currentRepoName={activeRepo?.name || (native ? '未打开仓库' : 'easy-git')}
        currentRepoPath={activeRepo?.path || (native ? '点击添加一个本地 Git 仓库' : '')}
        repositories={repositories}
        activeRepoId={activeRepoId}
        onSelectRepo={handleSelectRepo}
        onAddRepoClick={() => setIsAddRepoOpen(true)}
        onToggleFavoriteRepo={(id) => { void handleToggleFavorite(id); }}
        onRemoveRepo={(id) => { void handleRemoveRepo(id); }}
        onRevealRepo={(repo) => {
          if (!isTauriEnvironment()) {
            showToast('浏览器预览不能打开资源管理器', true);
            return;
          }
          void revealPath(repo.path).catch(err => showToast(String(err), true));
        }}
        currentBranch={currentBranch}
        activeMode={activeTab === 'commit' ? 'commit' : 'log'}
        onModeChange={(mode) => setActiveTab(mode)}
        changesCount={changes.filter(c => c.isStaged).length}
        onOpenBranches={() => setIsBranchesOpen(true)}
        onUpdateClick={handleUpdate}
        onPushClick={handlePush}
        onFetchClick={handleFetch}
        busyLabel={busyLabel}
        operationsLocked={opsLocked}
        hasConflict={changes.some(c => c.status === 'conflict')}
        onOpenMerge={() => {
          setActiveTab('merge');
          const first = changes.find(file => file.status === 'conflict');
          if (first) void loadConflictFile(first.path);
        }}
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
        syncAction={syncAction}
        shelfCount={shelves.length}
        memoryMb={memoryMb}
      />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* 冲突检测全局警示条 */}
        {activeRepo && changes.some(file => file.status === 'conflict') && activeTab !== 'merge' && (
          <div className="h-8 bg-amber-500/15 border-b border-amber-500/30 px-3 flex items-center justify-between text-xs text-amber-200 shrink-0 z-10">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                检测到 <strong className="text-amber-300 font-mono">{changes.filter(file => file.status === 'conflict').length}</strong> 个文件存在合并冲突，需要解决冲突后才能继续操作。
              </span>
            </div>
            <button
              onClick={() => {
                setActiveTab('merge');
                const first = changes.find(file => file.status === 'conflict');
                if (first) void loadConflictFile(first.path);
              }}
              className="px-2.5 py-0.5 rounded bg-amber-500/30 hover:bg-amber-500/40 text-amber-200 border border-amber-500/50 font-medium transition-colors text-xs flex items-center space-x-1"
            >
              <GitMerge className="w-3 h-3 text-amber-300" />
              <span>立即解决冲突</span>
            </button>
          </div>
        )}

        {!activeRepo && (
          <div className="flex-1 flex flex-col items-center justify-center text-sm text-[#8C9099] space-y-3">
            <FolderGit2 className="w-12 h-12 text-[#3574F0]/40 stroke-1" />
            <p>当前未打开任何 Git 仓库</p>
            <button
              onClick={() => setIsAddRepoOpen(true)}
              className="px-3.5 py-1.5 rounded bg-[#3574F0] hover:bg-[#3574F0]/90 text-white font-medium text-xs transition-colors shadow-sm"
            >
              + 添加本地 Git 仓库
            </button>
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
              currentBranch={currentBranch}
              currentUser={currentUser}
              onCompareBranch={(name) => void openRevision(`Compare ${name} with ${currentBranch}`, `${name}..HEAD`, 'range')}
              onCreateBranch={(hash) => {
                const name = prompt('从该提交创建并检出分支：', 'feature/');
                if (name) void run('已创建分支', () => createBranch(activeRepo.path, name, hash));
              }}
            />
          )}

          {activeRepo && activeTab === 'commit' && (
            <CommitView
              changes={changes}
              lastCommitMessage={(() => {
                const head = commits.find(commit => commit.refs.some(ref => ref.includes('HEAD'))) ?? commits[0];
                if (!head) return '';
                const body = head.body?.trim();
                return body ? `${head.subject}\n\n${body}` : head.subject;
              })()}
              onCommit={(msg, amend, andPush) => void run(andPush ? '已提交并推送' : '已提交', () =>
                commitChanges(activeRepo.path, msg, amend, andPush)
              )}
              onAddToGitignore={(path) => void run('已加入 .gitignore', () => appendGitignore(activeRepo.path, path))}
              onDeleteUnversioned={(file) => void run('已删除文件', () => deleteUnversioned(activeRepo.path, file.path))}
              onShelve={openShelve}
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
              onCompare={(name) => void openRevision(`Compare ${name} with ${currentBranch}`, `${name}..HEAD`, 'range')}
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
            <div data-keyboard-root="shelf" tabIndex={-1} className="flex-1 flex flex-col min-h-0 focus:outline-none">
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
            </div>
          )}

          {activeRepo && activeTab === 'merge' && (
            <ThreeWayMergeModal
              embedded
              isOpen
              files={changes.filter(file => file.status === 'conflict').map(file => ({ path: file.path }))}
              activePath={conflictPath}
              base={conflictBase}
              ours={conflictOurs}
              theirs={conflictTheirs}
              working={conflictWorking}
              loading={conflictLoading}
              sessionKey={String(conflictGen)}
              onSelectFile={(path) => { void loadConflictFile(path); }}
              onSave={(content) => {
                if (!conflictPath) return;
                const next = changes.find(file => file.status === 'conflict' && file.path !== conflictPath)?.path ?? '';
                void (async () => {
                  const ok = await run('冲突已解决', () => resolveConflict(activeRepo.path, conflictPath, content));
                  if (!ok) return;
                  if (next) await loadConflictFile(next);
                  else {
                    setConflictPath('');
                    setConflictBase('');
                    setConflictOurs('');
                    setConflictTheirs('');
                    setConflictWorking('');
                  }
                })();
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
          void openRevision(`Compare ${name} with ${currentBranch}`, `${name}..HEAD`, 'range');
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

      <AddProjectModal
        isOpen={isAddRepoOpen}
        onClose={() => setIsAddRepoOpen(false)}
        onAdd={(name, path) => { void handleAddRepo(name, path); }}
        onBrowse={pickDirectory}
      />

      <ShelveDialog
        open={shelveDraft !== null}
        fileCount={shelveDraft?.count ?? 0}
        hint={shelveDraft?.includesUnstaged
          ? `没有已暂存文件，将架藏全部 ${shelveDraft.count} 个更改，并移出工作区。`
          : `将把已暂存的 ${shelveDraft?.count ?? 0} 个文件移入架藏，工作区对应改动会被移走。`}
        onCancel={() => setShelveDraft(null)}
        onConfirm={confirmShelve}
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

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.kind === 'push' ? '推送需要确认' : '更新需要确认'}
        message={pendingConfirm?.outcome.message || ''}
        files={pendingConfirm?.outcome.conflictingPaths}
        filesHint={pendingConfirm?.kind === 'push' ? '以下文件将写入上游配置' : undefined}
        actions={confirmActions(pendingConfirm)}
        onChoose={chooseConfirm}
        onCancel={cancelConfirm}
      />
    </div>
  );
}

export default App;
