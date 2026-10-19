import { useCallback, useEffect, useRef, useState } from 'react';
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
import { StashDialog } from './components/ShelfStashView/StashDialog';
import { AddProjectModal, type CloneRequest } from './components/ProjectSidebar/AddProjectModal';
import { RemotesModal } from './components/RemotesModal';
import { PushDialog } from './components/PushDialog';
import { OperationBar } from './components/OperationBar';
import { TagDialog, type TagDraft } from './components/GitLogView/TagDialog';
import { RemotePickerDialog } from './components/GitLogView/RemotePickerDialog';
import { DiffChunk, FileChange, GitBranch, GitCommit, GitRepository, GitTag, RevisionFile, ShelfItem, StashItem } from './types/git';
import { CheckCircle2, AlertCircle, AlertTriangle, GitMerge, FolderGit2, Archive } from 'lucide-react';
import {
  addSavedRepo,
  abortOperation,
  appendGitignore,
  applyChunk,
  checkoutBranch,
  cherryPick,
  commitChanges,
  continueOperation,
  createBranch,
  createPatch,
  createShelf,
  createTag,
  deleteBranch,
  deleteRemoteTag,
  deleteShelf,
  deleteTag,
  deleteUnversioned,
  discardPaths,
  cloneRepo,
  fetchRemote,
  fetchRepo,
  inspectFile,
  isTauriEnvironment,
  listRemotes,
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
  pushTo,
  pushTag,
  rebaseOnto,
  repoState,
  updateLocalBranch,
  removeSavedRepo,
  renameBranch,
  resetTo,
  squashCommits,
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
  type PushTarget,
  type RepoOperationState,
  type SyncOutcome,
  type UpdateResponse,
} from './services/gitService';
import { askConfirm, isAskConfirmOpen } from './components/common/askConfirm';
import { askInput } from './components/common/askInput';
import { ConfirmHost } from './components/common/ConfirmHost';
import { ConfirmDialog, type ConfirmAction } from './components/common/ConfirmDialog';
import type { MessageKey } from './i18n';
import { useI18n } from './i18n/react';

/** 更新/推送被后端拦下时的确认框状态；等待用户选择期间操作锁已释放。 */
interface PendingConfirm {
  kind: 'update' | 'push';
  repoPath: string;
  outcome: SyncOutcome;
}

/** 远程会覆盖未提交改动时只提供贮藏。不贮藏再试必然失败，变基也不再单独给“仍然变基”。 */
const confirmActions = (
  pending: PendingConfirm | null,
  label: (key: MessageKey) => string,
): ConfirmAction[] => {
  if (!pending) return [];
  return [
    { value: 'stash', label: label('confirm.stashUpdate'), tone: 'primary', icon: <Archive className="w-3.5 h-3.5" /> },
  ];
};

export function App() {
  const { t } = useI18n();
  const [native, setNative] = useState(() => isTauriEnvironment());
  const [repositories, setRepositories] = useState<GitRepository[]>([]);
  const [activeRepoId, setActiveRepoId] = useState<string>(() => isTauriEnvironment() ? '' : 'repo-1');
  const activeRepo = repositories.find(r => r.id === activeRepoId) || repositories[0];

  const [activeTab, setActiveTab] = useState<ActiveTab>('commit');
  const [currentBranch, setCurrentBranch] = useState(activeRepo?.currentBranch || 'main');
  const [aheadCount, setAheadCount] = useState(0);
  const [behindCount, setBehindCount] = useState(0);
  const [currentUser, setCurrentUser] = useState(native ? '' : 'Li Chong');
  const [syncAction, setSyncAction] = useState<SyncAction | null>(null);
  const [shelveDraft, setShelveDraft] = useState<{ paths: string[]; count: number; includesUnstaged: boolean } | null>(null);
  const [stashDraft, setStashDraft] = useState<number | null>(null);
  const [stashFocus, setStashFocus] = useState(0);
  const [gitVersion, setGitVersion] = useState('Git');
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [tags, setTags] = useState<GitTag[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsHasMore, setCommitsHasMore] = useState(false);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [shelves, setShelves] = useState<ShelfItem[]>([]);
  const [stashes, setStashes] = useState<StashItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [isBranchesOpen, setIsBranchesOpen] = useState(false);
  const [isAddRepoOpen, setIsAddRepoOpen] = useState(false);
  const [isRemotesOpen, setIsRemotesOpen] = useState(false);
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
  const [operationState, setOperationState] = useState<RepoOperationState | null>(null);
  const [tagDraft, setTagDraft] = useState<TagDraft | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagError, setTagError] = useState('');
  /** 推送/删除远程标签时选中的远程；非空时弹出远程选择框。 */
  const [tagRemote, setTagRemote] = useState<{ mode: 'push' | 'delete'; name: string; remotes: string[] } | null>(null);
  const [diffTitle, setDiffTitle] = useState('');
  const [diffFiles, setDiffFiles] = useState<RevisionFile[]>([]);
  const diffLoader = useRef<(path: string, ignoreWhitespace: boolean) => Promise<DiffChunk[]>>(async () => []);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushSource, setPushSource] = useState<string | undefined>();
  const [pushError, setPushError] = useState('');
  const [pushRefreshKey, setPushRefreshKey] = useState(0);
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

  // 浏览器预览模式（非 Tauri）下才需要假数据，动态导入可让它不进入正式产物
  const mockChangesRef = useRef<FileChange[]>([]);

  useEffect(() => {
    if (!import.meta.env.DEV || isTauriEnvironment()) return;
    let alive = true;
    void import('./mock/gitData')
      .then(mock => {
        if (!alive) return;
        mockChangesRef.current = mock.mockCurrentChanges;
        setRepositories(mock.mockRepositories);
        setActiveRepoId(mock.mockRepositories[0]?.id ?? '');
        setCurrentBranch(mock.mockRepositories[0]?.currentBranch ?? 'main');
        setBranches(mock.mockBranches);
        setTags(mock.mockTags);
        setCommits(mock.mockCommits);
        setChanges(mock.mockCurrentChanges);
        setShelves(mock.mockShelves);
        setStashes(mock.mockStashes);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const applySnapshot = useCallback(async (repoPath: string) => {
    const snap = await loadRepoSnapshot(repoPath);
    setCurrentBranch(snap.currentBranch);
    setAheadCount(snap.aheadCount);
    setBehindCount(snap.behindCount);
    setGitVersion(snap.gitVersion || 'Git');
    setCurrentUser(snap.userName || '');
    setChanges(snap.changes);
    setCommits(snap.commits);
    setCommitsHasMore(Boolean(snap.commitsHasMore));
    setBranches(snap.branches);
    setTags(snap.tags ?? []);
    setStashes(snap.stashes);
    setShelves(snap.shelves);
    // 中断状态要跟快照一起刷新：继续/中止之后冲突横幅和动作条都得跟着变。
    setOperationState(await repoState(repoPath).catch(() => null));
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
      showToast(t('toast.previewNoWrite'), true);
      return false;
    }
    if (opLock.current) return false;
    opLock.current = true;
    setOpsLocked(true);
    setBusyLabel(t('common.busy'));
    try {
      const text = await action();
      showToast(text ? t('toast.withDetail', { label, detail: String(text).split('\n')[0] }) : label);
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
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    if (opLock.current) return;
    const repoPath = activeRepo.path;
    opLock.current = true;
    setOpsLocked(true);
    setSyncAction(kind);
    setBusyLabel(t('toast.connecting'));
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
    showToast(outcome.message || t('common.done'), failed);
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

  const openPush = useCallback((source?: string) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    setPushError('');
    setPushSource(source);
    setPushRefreshKey(key => key + 1);
    setPushOpen(true);
  }, [activeRepo, t]);

  const handlePush = useCallback(() => {
    openPush();
  }, [openPush]);

  const handleUpdateBranch = useCallback((name: string) => {
    if (name === currentBranch) {
      handleUpdate();
      return;
    }
    void guardNetwork('update', async (repoPath) => {
      const outcome = await updateLocalBranch(repoPath, name);
      await finishNetwork(repoPath, outcome);
    });
  }, [currentBranch, handleUpdate, guardNetwork, refresh]);

  const confirmPush = useCallback((target: PushTarget) => {
    setPushError('');
    void guardNetwork('push', async (repoPath) => {
      try {
        const outcome = await pushTo(
          repoPath,
          target.remote,
          target.branch,
          target.setUpstream,
          target.source,
          target.force,
        );
        if (outcome.status === 'ok' || outcome.status === 'up_to_date') {
          setPushOpen(false);
          await finishNetwork(repoPath, outcome);
          return;
        }
        applySyncCounts(repoPath, outcome);
        setPushError(outcome.message);
        // needs_force 不是失败：远程确实有本地没有的提交，对话框会据此放出强制推送开关。
        showToast(outcome.message || t('common.done'), outcome.status !== 'needs_force');
        acceptProgress.current = false;
        setBusyLabel(null);
        await refresh(repoPath);
      } catch (err) {
        const message = String(err);
        setPushError(message);
        showToast(message, true);
        await refresh(repoPath);
      }
    });
  }, [guardNetwork, refresh, t]);

  const cancelConfirm = useCallback(() => {
    setPendingConfirm(null);
    showToast(t('common.cancelled'));
  }, [t]);

  /**
   * 继续被中断的合并 / 变基 / 挑拣 / 还原。
   * 变基可能停在下一个冲突上，此时操作仍是 rebase，属于正常进展。
   */
  const handleContinueOperation = useCallback(() => {
    if (!activeRepo) return;
    const repoPath = activeRepo.path;
    void run(t('toast.operationContinued'), async () => {
      const next = await continueOperation(repoPath);
      setOperationState(next);
      // 变基停在下一个冲突上属于正常进展，不能当失败提示。
      if (next.operation !== 'none' && next.unmergedPaths.length > 0) {
        return t('app.operation.pending', { count: next.unmergedPaths.length });
      }
      return t('toast.operationContinued');
    });
  }, [activeRepo, run, t]);

  const handleAbortOperation = useCallback(() => {
    if (!activeRepo) return;
    const repoPath = activeRepo.path;
    void askConfirm({
      title: t('confirm.abortOperationTitle'),
      message: t('app.operation.abortConfirm'),
      confirmLabel: t('confirm.abortOperation'),
      tone: 'danger',
    }).then(ok => {
      if (!ok) return;
      void run(t('toast.operationAborted'), async () => {
        const next = await abortOperation(repoPath);
        setOperationState(next);
        return t('toast.operationAborted');
      });
    });
  }, [activeRepo, run, t]);

  const chooseConfirm = useCallback((value: string) => {
    const pending = pendingConfirm;
    if (!pending) return;
    setPendingConfirm(null);
    void guardNetwork('update', async (repoPath) => {
      const outcome = await updateRepo(repoPath, value as UpdateResponse);
      if (outcome.status === 'cancelled') {
        showToast(t('toast.updateCancelled'));
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
      showToast(text ? t('toast.fetchedDetail', { detail: text.split('\n')[0] }) : t('toast.fetched'));
      acceptProgress.current = false;
      setBusyLabel(null);
      await refresh(repoPath);
    });
  }, [guardNetwork, refresh]);

  const handleFetchRemote = useCallback((name: string) => {
    return guardNetwork('fetch', async (repoPath) => {
      const text = await fetchRemote(repoPath, name);
      showToast(text ? t('toast.fetchedDetail', { detail: text.split('\n')[0] }) : t('toast.remoteFetched', { name }));
      acceptProgress.current = false;
      setBusyLabel(null);
      await refresh(repoPath);
    });
  }, [guardNetwork, refresh]);

  const handleCloneRepo = async (request: CloneRequest) => {
    if (!isTauriEnvironment()) {
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    if (opLock.current) return;
    opLock.current = true;
    setOpsLocked(true);
    setBusyLabel(t('toast.cloning'));
    acceptProgress.current = true;
    try {
      await setWatchPaused(true);
      const path = await cloneRepo(request.url, request.parent, request.directory);
      const repo = await addSavedRepo(request.name, path);
      setRepositories(prev => [repo, ...prev.filter(item => item.id !== repo.id)]);
      setActiveRepoId(repo.id);
      setIsAddRepoOpen(false);
      showToast(t('toast.cloned', { name: repo.name }));
    } catch (err) {
      showToast(String(err), true);
    } finally {
      await setWatchPaused(false).catch(() => undefined);
      releaseOp();
    }
  };

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
      const preview = mockChangesRef.current;
      if (repo.id === 'repo-3') setChanges([]);
      else if (repo.id === 'repo-2') setChanges(preview.slice(0, 5));
      else setChanges(preview);
      showToast(t('toast.switchedProject', { name: repo.name }));
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
      showToast(t('toast.previewAdded', { name }));
      return;
    }
    try {
      const repo = await addSavedRepo(name, path);
      setRepositories(prev => [repo, ...prev.filter(item => item.id !== repo.id)]);
      setActiveRepoId(repo.id);
      showToast(t('toast.openedRepo', { name: repo.name }));
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
    showToast(t('toast.removedFromList'));
  };

  const handleToggleFavorite = async (repoId: string) => {
    if (!isTauriEnvironment()) {
      setRepositories(prev => prev.map(r => r.id === repoId ? { ...r, isFavorite: !r.isFavorite } : r));
      return;
    }
    setRepositories(await toggleFavoriteRepo(repoId));
  };

  const handleToggleFile = (file: FileChange, staged: boolean) => {
    void run(staged ? t('toast.staged') : t('toast.unstaged'), () =>
      staged ? stagePaths(activeRepo.path, [file.path]) : unstagePaths(activeRepo.path, [file.path])
    );
  };

  const handleBatch = (files: FileChange[], staged: boolean) => {
    const paths = files.map(f => f.path);
    void run(staged ? t('toast.stagedSelected') : t('toast.unstagedSelected'), () =>
      staged ? stagePaths(activeRepo.path, paths) : unstagePaths(activeRepo.path, paths)
    );
  };

  const handleChunk = (file: FileChange, chunkId: string) => {
    const chunk = file.chunks.find(c => c.id === chunkId);
    if (!chunk?.rawPatch) {
      showToast(t('toast.chunkNoPatch'), true);
      return;
    }
    void run(chunk.isStaged ? t('toast.chunkUnstaged') : t('toast.chunkStaged'), () =>
      applyChunk(activeRepo.path, chunk.rawPatch!, chunk.isStaged ? 'unstage' : 'stage')
    );
  };

  const handleRevertChunk = (file: FileChange, chunkId: string) => {
    const chunk = file.chunks.find(c => c.id === chunkId);
    if (!chunk?.rawPatch || !activeRepo) return;
    const repoPath = activeRepo.path;
    const patch = chunk.rawPatch;
    void askConfirm({
      title: t('confirm.discardChunkTitle'),
      message: t('toast.chunkDiscardConfirm'),
      confirmLabel: t('confirm.discard'),
      tone: 'danger',
    }).then(ok => {
      if (!ok) return;
      void run(t('toast.chunkRolledBack'), () => applyChunk(repoPath, patch, 'rollback'));
    });
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
      showToast(t('toast.previewNoCommitDiff'), true);
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

  const openConflictTab = useCallback(() => {
    setActiveTab('merge');
    const first = changes.find(file => file.status === 'conflict');
    if (first) void loadConflictFile(first.path);
  }, [changes, loadConflictFile]);

  const openTagDialog = useCallback((target: string, targetLabel: string) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    setTagError('');
    setTagDraft({ target, targetLabel });
  }, [activeRepo, t]);

  const confirmCreateTag = useCallback((name: string, message: string) => {
    const draft = tagDraft;
    if (!draft || !activeRepo) return;
    const repoPath = activeRepo.path;
    setTagBusy(true);
    setTagError('');
    void createTag(repoPath, name, draft.target, message || undefined)
      .then(async text => {
        setTagDraft(null);
        showToast(text || t('toast.tagCreated'));
        await refresh(repoPath);
      })
      .catch(err => setTagError(String(err)))
      .finally(() => setTagBusy(false));
  }, [activeRepo, tagDraft, refresh, t]);

  /** 推送标签：只有一个远程时也走选择框，保持推送到哪个远程可见。 */
  const openTagPush = useCallback((name: string) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    const repoPath = activeRepo.path;
    setTagError('');
    void listRemotes(repoPath)
      .then(list => {
        const names = list.remotes.map(remote => remote.name);
        if (names.length === 0) {
          showToast(t('toast.tagNoRemote'), true);
          return;
        }
        setTagRemote({ mode: 'push', name, remotes: names });
      })
      .catch(err => showToast(String(err), true));
  }, [activeRepo, t]);

  const runTagRemote = useCallback((remote: string) => {
    const target = tagRemote;
    if (!target || !activeRepo) return;
    const repoPath = activeRepo.path;
    setTagBusy(true);
    setTagError('');
    const action = target.mode === 'push'
      ? pushTag(repoPath, target.name, remote)
      : deleteRemoteTag(repoPath, target.name, remote);
    void action
      .then(async text => {
        setTagRemote(null);
        showToast(text || (target.mode === 'push' ? t('toast.tagPushed') : t('toast.tagRemoteDeleted')));
        await refresh(repoPath);
      })
      .catch(err => setTagError(String(err)))
      .finally(() => setTagBusy(false));
  }, [activeRepo, tagRemote, refresh, t]);

  const handleDeleteTag = useCallback((name: string) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    const repoPath = activeRepo.path;
    void askConfirm({
      title: t('tag.deleteConfirmTitle'),
      message: t('tag.deleteConfirm', { name }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    }).then(ok => {
      if (!ok) return;
      void run(t('toast.tagDeleted'), async () => {
        const text = await deleteTag(repoPath, name);
        return text || t('toast.tagDeleted');
      });
    });
  }, [activeRepo, run, t]);

  const handleDeleteRemoteTag = useCallback((name: string) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    const repoPath = activeRepo.path;
    void listRemotes(repoPath)
      .then(list => {
        const names = list.remotes.map(remote => remote.name);
        if (names.length === 0) {
          showToast(t('toast.tagNoRemote'), true);
          return;
        }
        // 删除远程标签是破坏性动作，先确认再选远程。
        void askConfirm({
          title: t('tag.deleteRemoteTitle'),
          message: t('tag.deleteRemoteHint', { name }),
          confirmLabel: t('tag.deleteRemote'),
          tone: 'danger',
        }).then(ok => {
          if (!ok) return;
          setTagError('');
          setTagRemote({ mode: 'delete', name, remotes: names });
        });
      })
      .catch(err => showToast(String(err), true));
  }, [activeRepo, t]);

  const handleDeleteBranch = async (branch: { name: string; isRemote?: boolean }, force = false) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast(t('toast.previewNoWrite'), true);
      return;
    }
    if (!force) {
      const warning = branch.isRemote
        ? t('toast.deleteRemoteBranch', { name: branch.name })
        : t('toast.deleteLocalBranch', { name: branch.name });
      const ok = await askConfirm({
        title: t('confirm.deleteBranchTitle'),
        message: warning,
        confirmLabel: t('common.delete'),
        tone: 'danger',
      });
      if (!ok) return;
    }
    try {
      const text = await deleteBranch(activeRepo.path, branch.name, Boolean(branch.isRemote), force);
      showToast(text || t('toast.branchDeleted'));
      await refresh(activeRepo.path);
    } catch (err) {
      const message = String(err);
      if (!force && !branch.isRemote && /not fully merged|not merged/i.test(message)) {
        const forceDelete = await askConfirm({
          title: t('confirm.forceDeleteTitle'),
          message: t('toast.forceDeleteBranch'),
          confirmLabel: t('confirm.forceDelete'),
          tone: 'danger',
        });
        if (forceDelete) await handleDeleteBranch(branch, true);
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
      showToast(t('toast.nothingToShelve'), true);
      return;
    }
    setShelveDraft({ paths: staged, count, includesUnstaged: staged.length === 0 });
  }, [changes]);

  const confirmShelve = (name: string) => {
    const draft = shelveDraft;
    setShelveDraft(null);
    if (!draft || !activeRepo) return;
    void run(t('toast.shelved'), async () => {
      await createShelf(activeRepo.path, name, draft.paths);
      setActiveTab('shelf');
      return t('toast.shelvedDetail');
    });
  };

  const openStash = useCallback(() => {
    if (changes.length === 0) {
      showToast(t('toast.nothingToStash'), true);
      return;
    }
    setStashDraft(changes.length);
  }, [changes.length, t]);

  const confirmStash = (message: string) => {
    setStashDraft(null);
    if (!activeRepo) return;
    void run(t('toast.stashed'), async () => {
      await stashSave(activeRepo.path, message);
      setStashFocus(token => token + 1);
      setActiveTab('shelf');
      return t('toast.stashedDetail');
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
      if (isAskConfirmOpen() || pendingConfirm) return;
      const overlayOpen = Boolean(shelveDraft) || stashDraft !== null || Boolean(diffTitle) || pushOpen || isAddRepoOpen || isBranchesOpen || isRemotesOpen;
      if (e.key === 'Escape') {
        if (shelveDraft) setShelveDraft(null);
        else if (stashDraft !== null) setStashDraft(null);
        else if (diffTitle) setDiffTitle('');
        else if (isRemotesOpen && !opsLocked) setIsRemotesOpen(false);
        else if (pushOpen && !opsLocked) setPushOpen(false);
        else if (isAddRepoOpen && !opsLocked) setIsAddRepoOpen(false);
        else if (isBranchesOpen) setIsBranchesOpen(false);
        else if (typingTarget(e.target)) (e.target as HTMLElement).blur();
        window.dispatchEvent(new Event('snailgit:dismiss'));
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
  }, [handlePush, handleUpdate, focusList, shelveDraft, stashDraft, diffTitle, pushOpen, isAddRepoOpen, isBranchesOpen, isRemotesOpen, opsLocked, pendingConfirm]);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-jb-bg text-jb-text-primary font-sans antialiased">
      <WindowResizeFrame />
      <Header
        currentRepoName={activeRepo?.name || (native ? t('header.noRepo') : 'snail-git')}
        currentRepoPath={activeRepo?.path || (native ? t('header.addRepoHint') : '')}
        repositories={repositories}
        activeRepoId={activeRepoId}
        onSelectRepo={handleSelectRepo}
        onAddRepoClick={() => setIsAddRepoOpen(true)}
        onToggleFavoriteRepo={(id) => { void handleToggleFavorite(id); }}
        onRemoveRepo={(id) => { void handleRemoveRepo(id); }}
        onRevealRepo={(repo) => {
          if (!isTauriEnvironment()) {
            showToast(t('toast.previewNoExplorer'), true);
            return;
          }
          void revealPath(repo.path).catch(err => showToast(String(err), true));
        }}
        currentBranch={currentBranch}
        activeMode={activeTab === 'commit' ? 'commit' : activeTab === 'shelf' ? 'shelf' : 'log'}
        onModeChange={(mode) => setActiveTab(mode)}
        changesCount={changes.filter(c => c.isStaged).length}
        onOpenBranches={() => setIsBranchesOpen(true)}
        onUpdateClick={handleUpdate}
        onPushClick={handlePush}
        onFetchClick={handleFetch}
        onOpenRemotes={activeRepo && native ? () => setIsRemotesOpen(true) : undefined}
        busyLabel={busyLabel}
        operationsLocked={opsLocked}
        hasConflict={changes.some(c => c.status === 'conflict')}
        onOpenMerge={openConflictTab}
        onRollbackClick={() => {
          if (!activeRepo || changes.length === 0) {
            showToast(t('toast.nothingToRollback'), true);
            return;
          }
          const repoPath = activeRepo.path;
          const paths = changes.map(file => file.path);
          void askConfirm({
            title: t('confirm.rollbackAllTitle'),
            message: t('toast.rollbackAllConfirm', { count: paths.length }),
            confirmLabel: t('confirm.rollback'),
            tone: 'danger',
            files: paths,
          }).then(ok => {
            if (ok) void run(t('toast.rolledBack'), () => discardPaths(repoPath, paths));
          });
        }}
        onShelfClick={() => setActiveTab('shelf')}
        aheadCount={aheadCount}
        behindCount={behindCount}
        syncAction={syncAction}
        shelfCount={shelves.length}
        stashCount={stashes.length}
        memoryMb={memoryMb}
      />

      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* 合并 / 变基 / 挑拣 / 还原停在半途时的继续与中止入口 */}
        {activeRepo && (
          <OperationBar
            state={operationState}
            busy={opsLocked}
            onContinue={handleContinueOperation}
            onAbort={handleAbortOperation}
            onOpenMerge={openConflictTab}
          />
        )}

        {/* 冲突检测全局警示条 */}
        {activeRepo && changes.some(file => file.status === 'conflict') && activeTab !== 'merge' && (
          <div className="h-8 bg-amber-500/15 border-b border-amber-500/30 px-3 flex items-center justify-between text-xs text-amber-200 shrink-0 z-10">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                {t('app.conflictBanner', { count: changes.filter(file => file.status === 'conflict').length })}
              </span>
            </div>
            <button
              onClick={openConflictTab}
              className="px-2.5 py-0.5 rounded bg-amber-500/30 hover:bg-amber-500/40 text-amber-200 border border-amber-500/50 font-medium transition-colors text-xs flex items-center space-x-1"
            >
              <GitMerge className="w-3 h-3 text-amber-300" />
              <span>{t('app.resolveNow')}</span>
            </button>
          </div>
        )}

        {!activeRepo && (
          <div className="flex-1 flex flex-col items-center justify-center text-sm text-[#8C9099] space-y-3">
            <FolderGit2 className="w-12 h-12 text-[#3574F0]/40 stroke-1" />
            <p>{t('app.noRepo')}</p>
            <button
              onClick={() => setIsAddRepoOpen(true)}
              className="px-3.5 py-1.5 rounded bg-[#3574F0] hover:bg-[#3574F0]/90 text-white font-medium text-xs transition-colors shadow-sm"
            >
              {t('app.addRepo')}
            </button>
          </div>
        )}

          {activeRepo && activeTab === 'log' && (
            <GitLogView
              repoPath={activeRepo.path}
              commits={commits}
              commitsHasMore={commitsHasMore}
              onOpenFileDiff={(commit, path) => {
                void openRevision(`${commit.shortHash} ${path}`, commit.hash, 'commit', path);
              }}
              onShowDiffWithLocal={(commit) => void openRevision(t('app.diffWithLocal', { hash: commit.shortHash }), commit.hash, 'worktree')}
              onParentMissing={(hash) => showToast(t('toast.parentMissing', { hash: hash.slice(0, 8) }), true)}
              onCheckout={(hash) => void run(t('toast.checkedOutCommit'), () => checkoutBranch(activeRepo.path, hash))}
              onCherryPick={(hash) => void run(t('toast.cherryPicked'), () => cherryPick(activeRepo.path, hash))}
              onRevert={(hash) => void run(t('toast.reverted'), () => revertCommit(activeRepo.path, hash))}
              onReset={(hash) => void run(t('toast.reset'), () => resetTo(activeRepo.path, hash))}
              onSquash={(hashes, message) => run(t('toast.squashed'), () => squashCommits(activeRepo.path, hashes, message))}
              currentBranch={currentBranch}
              currentUser={currentUser}
              branches={branches}
              tags={tags}
              onRefresh={() => void refresh(activeRepo.path)}
              refreshing={loading}
              onCheckoutBranch={(name) => void run(t('toast.checkedOut', { name }), () => checkoutBranch(activeRepo.path, name))}
              onMergeBranch={(name) => void run(t('toast.merged'), () => mergeBranch(activeRepo.path, name))}
              onRebaseBranch={(name) => void run(t('toast.rebased'), () => rebaseOnto(activeRepo.path, name))}
              onCompareBranch={(name) => void openRevision(t('app.compareRange', { name, current: currentBranch }), `${name}..HEAD`, 'range')}
              onCreateBranch={(hash) => {
                void askInput({
                  title: t('toast.branchPrompt'),
                  defaultValue: 'feature/',
                  confirmLabel: t('common.create'),
                  tone: 'primary',
                }).then(name => {
                  if (!name) return;
                  void run(t('toast.branchCreated'), () => createBranch(activeRepo.path, name, hash));
                });
              }}
              onUpdateBranch={handleUpdateBranch}
              onPushBranch={openPush}
              onRenameBranch={(oldName, newName) => run(t('toast.renamed'), () => renameBranch(activeRepo.path, oldName, newName))}
              onCreateTag={openTagDialog}
              onPushTag={openTagPush}
              onDeleteTag={handleDeleteTag}
              onDeleteRemoteTag={handleDeleteRemoteTag}
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
              onCommit={(msg, amend, andPush) => {
                // IDEA 的提交并推送会先落本地提交，再打开推送预览，而不是直接推。
                void (async () => {
                  const ok = await run(
                    andPush ? t('toast.committedThenPush') : t('toast.committed'),
                    () => commitChanges(activeRepo.path, msg, amend, false),
                  );
                  if (ok && andPush) {
                    setPushError('');
                    setPushRefreshKey(key => key + 1);
                    setPushOpen(true);
                  }
                })();
              }}
              onAddToGitignore={(path) => void run(t('toast.gitignore'), () => appendGitignore(activeRepo.path, path))}
              onDeleteUnversioned={(file) => void run(t('toast.fileDeleted'), () => deleteUnversioned(activeRepo.path, file.path))}
              onShelve={openShelve}
              onStash={openStash}
              onToggleFileStage={handleToggleFile}
              onBatchToggleStage={handleBatch}
              onToggleChunkStage={handleChunk}
              onRevertChunk={handleRevertChunk}
              onRollbackFile={(file) => {
                const repoPath = activeRepo.path;
                void askConfirm({
                  title: t('confirm.rollbackFileTitle'),
                  message: t('toast.rollbackFileConfirm', { path: file.path }),
                  confirmLabel: t('confirm.rollback'),
                  tone: 'danger',
                  files: [file.path],
                }).then(ok => {
                  if (ok) void run(t('toast.fileRolledBack'), () => discardPaths(repoPath, [file.path]));
                });
              }}
              onRefresh={() => void refresh()}
              onRequestDiff={requestDiff}
              onCreatePatch={() => {
                if (!activeRepo) return;
                const paths = changes.filter(file => file.isStaged).map(file => file.path);
                void run(t('toast.patch'), () => createPatch(activeRepo.path, paths.length ? paths : changes.map(file => file.path)));
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
              onSelectBranch={(name) => void run(t('toast.checkedOut', { name }), () => checkoutBranch(activeRepo.path, name))}
              onCreateBranch={(name) => void run(t('toast.branchCreated'), () => createBranch(activeRepo.path, name))}
              onMerge={(name) => void run(t('toast.merged'), () => mergeBranch(activeRepo.path, name))}
              onRebase={(name) => void run(t('toast.rebased'), () => rebaseOnto(activeRepo.path, name))}
              onCompare={(name) => void openRevision(t('app.compareRange', { name, current: currentBranch }), `${name}..HEAD`, 'range')}
              onDelete={(branch, force) => { void handleDeleteBranch(branch, force); }}
              onRename={(branch) => {
                void askInput({
                  title: t('toast.renamePrompt'),
                  defaultValue: branch.name,
                  confirmLabel: t('common.rename'),
                  tone: 'primary',
                }).then(name => {
                  if (!name || name === branch.name) return;
                  void run(t('toast.renamed'), () => renameBranch(activeRepo.path, branch.name, name));
                });
              }}
              onToggleFavorite={(branch) => void run(branch.isFavorite ? t('toast.unfavorited') : t('toast.favorited'), async () => {
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
              onUnshelve={(id) => void run(t('toast.unshelved'), () => unshelve(activeRepo.path, id))}
              onDeleteShelf={(id) => void run(t('toast.shelfDeleted'), () => deleteShelf(activeRepo.path, id))}
              onApplyStash={(stash: StashItem) => void run(t('toast.stashApplied'), () => stashApply(activeRepo.path, stash.index, false))}
              onPopStash={(stash) => void run(t('toast.stashPopped'), () => stashApply(activeRepo.path, stash.index, true))}
              onDropStash={(stash) => void run(t('toast.stashDropped'), () => stashDrop(activeRepo.path, stash.index))}
              onCreateStash={openStash}
              focusStashToken={stashFocus}
              onShowShelfDiff={(id) => {
                if (!isTauriEnvironment()) {
                  showToast(t('toast.previewNoShelfDiff'), true);
                  return;
                }
                void shelfPatchFiles(activeRepo.path, id).then(files => {
                  openDiff(t('app.shelfDiff', { id }), files, async (path) => files.find(file => file.path === path)?.chunks || []);
                }).catch(err => showToast(String(err), true));
              }}
              onShowStashDiff={(stash) => {
                if (!isTauriEnvironment()) {
                  showToast(t('toast.previewNoStashDiff'), true);
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
              operation={operationState?.operation ?? 'none'}
              operationPending={operationState?.unmergedPaths.length ?? 0}
              operationBusy={opsLocked}
              onContinueOperation={handleContinueOperation}
              onAbortOperation={handleAbortOperation}
              onSelectFile={(path) => { void loadConflictFile(path); }}
              onSave={(content) => {
                if (!conflictPath) return;
                const next = changes.find(file => file.status === 'conflict' && file.path !== conflictPath)?.path ?? '';
                void (async () => {
                  const ok = await run(t('toast.conflictResolved'), () => resolveConflict(activeRepo.path, conflictPath, content));
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
            <div className="absolute top-2 right-3 text-[11px] text-jb-text-muted">{t('toast.loadingGit')}</div>
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
          connected={native}
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
          void run(t('toast.checkedOut', { name }), () => checkoutBranch(activeRepo.path, name));
        }}
        onCreateBranch={(name) => void run(t('toast.branchCreated'), () => createBranch(activeRepo.path, name))}
        onMerge={(name) => void run(t('toast.merged'), () => mergeBranch(activeRepo.path, name))}
        onRebase={(name) => void run(t('toast.rebased'), () => rebaseOnto(activeRepo.path, name))}
        onCompare={(name) => {
          setIsBranchesOpen(false);
          void openRevision(t('app.compareRange', { name, current: currentBranch }), `${name}..HEAD`, 'range');
        }}
        onDelete={(branch, force) => { void handleDeleteBranch(branch, force); }}
        onRename={(branch) => {
          void askInput({
            title: t('toast.renamePrompt'),
            defaultValue: branch.name,
            confirmLabel: t('common.rename'),
            tone: 'primary',
          }).then(name => {
            if (!name || name === branch.name) return;
            void run(t('toast.renamed'), () => renameBranch(activeRepo.path, branch.name, name));
          });
        }}
        onToggleFavorite={(branch) => void run(branch.isFavorite ? t('toast.unfavorited') : t('toast.favorited'), async () => {
          await toggleFavoriteBranch(activeRepo.path, branch.name);
          return branch.name;
        })}
      />

      <AddProjectModal
        isOpen={isAddRepoOpen}
        onClose={() => {
          if (!opsLocked) setIsAddRepoOpen(false);
        }}
        onAdd={(name, path) => { void handleAddRepo(name, path); }}
        onClone={handleCloneRepo}
        onBrowse={pickDirectory}
        busy={opsLocked && isAddRepoOpen}
        busyLabel={busyLabel}
      />

      <PushDialog
        open={pushOpen && Boolean(activeRepo)}
        repoPath={activeRepo?.path || ''}
        refreshKey={pushRefreshKey}
        sourceBranch={pushSource}
        busy={opsLocked && syncAction === 'push'}
        error={pushError}
        onClose={() => {
          if (!opsLocked) setPushOpen(false);
        }}
        onPush={confirmPush}
        onOpenFile={(hash, path, shortHash) => {
          void openRevision(`${shortHash} ${path}`, hash, 'commit', path);
        }}
        onManageRemotes={() => setIsRemotesOpen(true)}
      />

      <RemotesModal
        isOpen={isRemotesOpen && Boolean(activeRepo)}
        repoPath={activeRepo?.path || ''}
        operationsLocked={opsLocked}
        onClose={() => {
          if (!opsLocked) setIsRemotesOpen(false);
        }}
        onFetch={handleFetchRemote}
        onChanged={() => {
          if (activeRepo) void refresh(activeRepo.path);
          setPushRefreshKey(key => key + 1);
        }}
      />

      <ShelveDialog
        open={shelveDraft !== null}
        fileCount={shelveDraft?.count ?? 0}
        hint={shelveDraft?.includesUnstaged
          ? t('app.shelveAll', { count: shelveDraft.count })
          : t('app.shelveStaged', { count: shelveDraft?.count ?? 0 })}
        onCancel={() => setShelveDraft(null)}
        onConfirm={confirmShelve}
      />

      <StashDialog
        open={stashDraft !== null}
        fileCount={stashDraft ?? 0}
        onCancel={() => setStashDraft(null)}
        onConfirm={confirmStash}
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

      <TagDialog
        open={tagDraft !== null}
        draft={tagDraft}
        busy={tagBusy}
        error={tagError}
        onCancel={() => {
          if (!tagBusy) setTagDraft(null);
        }}
        onConfirm={confirmCreateTag}
      />

      <RemotePickerDialog
        open={tagRemote !== null}
        title={tagRemote?.mode === 'delete' ? t('tag.deleteRemoteTitle') : t('tag.pushTitle')}
        hint={tagRemote
          ? (tagRemote.mode === 'delete'
            ? t('tag.deleteRemoteHint', { name: tagRemote.name })
            : t('tag.pushHint', { name: tagRemote.name }))
          : ''}
        confirmLabel={tagRemote?.mode === 'delete' ? t('tag.deleteRemote') : t('tag.push')}
        tone={tagRemote?.mode === 'delete' ? 'danger' : 'primary'}
        remotes={tagRemote?.remotes ?? []}
        busy={tagBusy}
        error={tagError}
        onCancel={() => {
          if (!tagBusy) setTagRemote(null);
        }}
        onConfirm={runTagRemote}
      />

      <ConfirmDialog
        open={Boolean(pendingConfirm)}
        title={pendingConfirm?.kind === 'push' ? t('confirm.pushTitle') : t('confirm.updateTitle')}
        message={pendingConfirm?.outcome.message || ''}
        files={pendingConfirm?.outcome.conflictingPaths}
        actions={confirmActions(pendingConfirm, t)}
        onChoose={chooseConfirm}
        onCancel={cancelConfirm}
      />
      <ConfirmHost />
    </div>
  );
}

export default App;
