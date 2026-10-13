import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { TabBar, ActiveTab } from './components/TabBar';
import { GitLogView } from './components/GitLogView';
import { CommitView } from './components/CommitView';
import { BranchesModal } from './components/BranchesModal';
import { ShelfStashView } from './components/ShelfStashView';
import { ThreeWayMergeModal } from './components/ThreeWayMergeModal';
import { StatusBar } from './components/StatusBar';
import { ProjectSidebar } from './components/ProjectSidebar';
import { FileChange, GitRepository, StashItem } from './types/git';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import {
  addSavedRepo,
  applyChunk,
  checkoutBranch,
  cherryPick,
  commitChanges,
  compareBranches,
  createBranch,
  createShelf,
  deleteShelf,
  discardPaths,
  isTauriEnvironment,
  listenGitChanged,
  loadFileDiff,
  loadRepoSnapshot,
  listSavedRepos,
  mergeBranch,
  pickDirectory,
  pullRepo,
  pushRepo,
  rebaseOnto,
  removeSavedRepo,
  repoSignature,
  resetTo,
  revertCommit,
  setWatchPath,
  stashSave,
  stagePaths,
  stashApply,
  stashDrop,
  toggleFavoriteRepo,
  unshelve,
  unstagePaths,
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
  const [gitVersion, setGitVersion] = useState(native ? 'Git' : 'Git 2.34.1');
  const [branches, setBranches] = useState(native ? [] : mockBranches);
  const [commits, setCommits] = useState(native ? [] : mockCommits);
  const [changes, setChanges] = useState<FileChange[]>(native ? [] : mockCurrentChanges);
  const [shelves, setShelves] = useState(native ? [] : mockShelves);
  const [stashes, setStashes] = useState(native ? [] : mockStashes);
  const [loading, setLoading] = useState(false);

  const [isBranchesOpen, setIsBranchesOpen] = useState(false);
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const refreshLock = useRef(false);
  const refreshAgain = useRef(false);
  const diffLock = useRef(new Set<string>());
  const lastSig = useRef('');

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

  const run = useCallback(async (label: string, action: () => Promise<string | void>) => {
    if (!isTauriEnvironment() || !activeRepo) {
      showToast('浏览器预览不会改动真实仓库，请用 pnpm tauri dev', true);
      return;
    }
    try {
      const text = await action();
      showToast(text ? `${label}：${text.split('\n')[0]}` : label);
      await refresh(activeRepo.path);
    } catch (err) {
      showToast(String(err), true);
      await refresh(activeRepo.path);
    }
  }, [activeRepo, refresh]);

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
    const timer = window.setInterval(() => {
      if (!activeRepo) return;
      void repoSignature(activeRepo.path).then(sig => {
        const key = `${activeRepo.path}:${sig}`;
        if (sig && key !== lastSig.current) {
          const first = lastSig.current === '';
          lastSig.current = key;
          if (!first) void refresh(activeRepo.path);
        }
      });
    }, 2000);
    return () => {
      stop = true;
      unlisten();
      window.clearInterval(timer);
    };
  }, [activeRepo?.path, refresh]);

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
      const repos = await listSavedRepos();
      setRepositories(repos);
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
    void loadFileDiff(activeRepo.path, file.path).then(chunks => {
      const additions = chunks.reduce((n, c) => n + c.lines.filter(l => l.type === 'added').length, 0);
      const deletions = chunks.reduce((n, c) => n + c.lines.filter(l => l.type === 'deleted').length, 0);
      setChanges(prev => prev.map(item => item.id === file.id
        ? { ...item, chunks, chunksLoaded: true, additions, deletions }
        : item));
    }).catch(err => {
      showToast(String(err), true);
      setChanges(prev => prev.map(item => item.id === file.id ? { ...item, chunksLoaded: true } : item));
    }).finally(() => diffLock.current.delete(file.id));
  }, [activeRepo]);

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
        if (activeRepo) void run('推送', () => pushRepo(activeRepo.path));
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveTab('commit');
      } else if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 't') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        if (activeRepo) void run('拉取', () => pullRepo(activeRepo.path));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeRepo, run]);

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
      />

      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <Header
          currentRepoName={activeRepo?.name || (native ? '未打开仓库' : 'easy-git')}
          currentRepoPath={activeRepo?.path || (native ? '从左侧添加一个本地 Git 仓库' : '')}
          currentBranch={currentBranch}
          onOpenBranches={() => setIsBranchesOpen(true)}
          onCommitClick={() => setActiveTab('commit')}
          onUpdateClick={() => activeRepo && void run('拉取', () => pullRepo(activeRepo.path))}
          onPushClick={() => activeRepo && void run('推送', () => pushRepo(activeRepo.path))}
          onShelfClick={() => setActiveTab('shelf')}
        />

        <TabBar
          activeTab={activeTab}
          onTabChange={(tab) => {
            if (tab === 'merge') setIsMergeModalOpen(true);
            else setActiveTab(tab);
          }}
          changesCount={changes.filter(c => c.isStaged).length}
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
              onOpenFileDiff={() => setActiveTab('commit')}
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
            />
          )}

          {activeRepo && activeTab === 'branches' && (
            <div className="flex-1 p-6 flex items-center justify-center">
              <button
                onClick={() => setIsBranchesOpen(true)}
                className="px-4 py-2 rounded bg-jb-blue text-white text-xs"
              >
                打开分支面板（当前 {branches.length} 个）
              </button>
            </div>
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
        onCompare={(name) => void run('对比', () => compareBranches(activeRepo.path, name))}
      />

      <ThreeWayMergeModal
        isOpen={isMergeModalOpen}
        onClose={() => setIsMergeModalOpen(false)}
        onResolved={() => showToast('冲突标记已处理。请在提交页确认文件后再提交。')}
      />

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
