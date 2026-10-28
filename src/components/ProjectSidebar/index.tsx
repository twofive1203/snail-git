import React, { useState } from 'react';
import { GitRepository, GitBranch, ShelfItem, StashItem } from '../../types/git';
import { 
  FolderGit2, 
  Plus, 
  Search, 
  Trash2, 
  Star, 
  GitBranch as BranchIcon, 
  Check, 
  ExternalLink,
  Copy,
  Archive,
  PanelLeftClose,
  PanelLeft,
  X,
  GitMerge
} from 'lucide-react';
import { AddProjectModal } from './AddProjectModal';
import { askConfirm } from '../common/askConfirm';
import { formatGitCommand } from '../common/formatGitCommand';
import { askInput } from '../common/askInput';
import { useI18n } from '../../i18n/react';

export type SidebarTab = 'repos' | 'branches' | 'shelf';

interface ProjectSidebarProps {
  repositories: GitRepository[];
  activeRepoId: string;
  onSelectRepo: (repo: GitRepository) => void;
  onAddRepo: (name: string, path: string) => void;
  onBrowse?: () => Promise<string | null>;
  onRemoveRepo: (repoId: string) => void;
  onToggleFavorite: (repoId: string) => void;
  onRevealRepo?: (repo: GitRepository) => void;

  // 分支相关
  branches?: GitBranch[];
  currentBranch?: string;
  onSelectBranch?: (name: string) => void;
  onCreateBranch?: (name: string) => void;
  onMergeBranch?: (name: string) => void;
  onRebaseBranch?: (name: string) => void;
  onDeleteBranch?: (branch: GitBranch, force: boolean) => void;
  onRenameBranch?: (branch: GitBranch) => void;
  onToggleFavoriteBranch?: (branch: GitBranch) => void;

  // 架藏与贮藏相关
  shelves?: ShelfItem[];
  stashes?: StashItem[];
  onUnshelve?: (id: string) => void;
  onDeleteShelf?: (id: string) => void;
  onApplyStash?: (stash: StashItem) => void;
  onDropStash?: (stash: StashItem) => void;
  onCreateStash?: () => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  repositories,
  activeRepoId,
  onSelectRepo,
  onAddRepo,
  onBrowse,
  onRemoveRepo,
  onToggleFavorite,
  onRevealRepo,
  branches = [],
  currentBranch = 'main',
  onSelectBranch,
  onCreateBranch,
  onMergeBranch,
  onToggleFavoriteBranch,
  shelves = [],
  stashes = [],
  onUnshelve,
  onDeleteShelf,
  onApplyStash,
  onDropStash,
  onCreateStash,
}) => {
  const { t } = useI18n();
  const repoPath = repositories.find(repo => repo.id === activeRepoId)?.path ?? '';
  const [activeTab, setActiveTab] = useState<SidebarTab>('repos');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [repoSearchQuery, setRepoSearchQuery] = useState('');
  const [branchSearchQuery, setBranchSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // 切换活动栏 Tab
  const handleTabClick = (tab: SidebarTab) => {
    if (activeTab === tab) {
      // 点击当前 tab 则切换抽屉开关
      setIsDrawerOpen(!isDrawerOpen);
    } else {
      setActiveTab(tab);
      setIsDrawerOpen(true);
    }
  };

  // 仓库过滤与排序
  const filteredRepos = repositories.filter(r => 
    r.name.toLowerCase().includes(repoSearchQuery.toLowerCase()) ||
    r.path.toLowerCase().includes(repoSearchQuery.toLowerCase())
  );
  const sortedRepos = [...filteredRepos].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return 0;
  });

  // 分支过滤
  const filteredBranches = branches.filter(b => 
    b.name.toLowerCase().includes(branchSearchQuery.toLowerCase())
  );
  const localBranches = filteredBranches.filter(b => !b.isRemote);
  const remoteBranches = filteredBranches.filter(b => b.isRemote);

  const handleCopyPath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
  };

  const totalDirtyCount = repositories.reduce((acc, r) => acc + (r.dirtyFilesCount || 0), 0);

  return (
    <>
      <div className="flex h-full select-none z-20 shrink-0">
        {/* ─── 1. Activity Bar (极窄活动栏，宽度 42px) ─── */}
        <aside className="w-11 bg-[#18191B] border-r border-[#303236] flex flex-col items-center py-2 justify-between shrink-0">
          {/* 上部主功能图标 */}
          <div className="flex flex-col items-center space-y-2 w-full px-1">
            {/* Repositories 图标 */}
            <button
              onClick={() => handleTabClick('repos')}
              title={t('project.repos')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all relative ${
                isDrawerOpen && activeTab === 'repos'
                  ? 'bg-[#3574F0] text-white shadow-sm'
                  : 'text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#2B2D30]'
              }`}
            >
              <FolderGit2 className="w-4 h-4" />
              {totalDirtyCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-[#18191B]" />
              )}
            </button>

            {/* Branches 图标 */}
            <button
              onClick={() => handleTabClick('branches')}
              title={t('project.branches')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all relative ${
                isDrawerOpen && activeTab === 'branches'
                  ? 'bg-[#3574F0] text-white shadow-sm'
                  : 'text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#2B2D30]'
              }`}
            >
              <BranchIcon className="w-4 h-4" />
            </button>

            {/* Shelf & Stash 图标 */}
            <button
              onClick={() => handleTabClick('shelf')}
              title={t('project.shelf')}
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all relative ${
                isDrawerOpen && activeTab === 'shelf'
                  ? 'bg-[#3574F0] text-white shadow-sm'
                  : 'text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#2B2D30]'
              }`}
            >
              <Archive className="w-4 h-4" />
              {(shelves.length > 0 || stashes.length > 0) && (
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#3574F0]" />
              )}
            </button>
          </div>

          {/* 下部：展开/收起切换与加号 */}
          <div className="flex flex-col items-center space-y-2 w-full px-1">
            <button
              onClick={() => setIsAddModalOpen(true)}
              title={t('project.addRepo')}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#2B2D30] transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsDrawerOpen(!isDrawerOpen)}
              title={isDrawerOpen ? t('project.collapse') : t('project.expand')}
              className="w-8 h-8 rounded-md flex items-center justify-center text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#2B2D30] transition-colors"
            >
              {isDrawerOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
            </button>
          </div>
        </aside>

        {/* ─── 2. Drawer Panel (抽屉面板，展开时宽 280px) ─── */}
        {isDrawerOpen && (
          <div className="w-72 bg-[#1E1F22] border-r border-[#393B40] flex flex-col h-full animate-in slide-in-from-left-2 duration-150">
            {/* ─── 面板 A: 仓库列表 ─── */}
            {activeTab === 'repos' && (
              <>
                <div className="h-10 px-3 border-b border-[#393B40] flex items-center justify-between bg-[#2B2D30]/60">
                  <div className="flex items-center space-x-1.5">
                    <FolderGit2 className="w-3.5 h-3.5 text-[#3574F0]" />
                    <span className="font-semibold text-xs text-[#DFE1E5]">{t('project.repositories')}</span>
                    <span className="text-[10px] font-mono text-[#8C9099] bg-[#1E1F22] px-1.5 py-0.2 rounded-full border border-[#393B40]">
                      {repositories.length}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => setIsAddModalOpen(true)}
                      title={t('project.addFolder')}
                      className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setIsDrawerOpen(false)}
                      title={t('project.closeDrawer')}
                      className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 搜索 */}
                <div className="p-2 border-b border-[#393B40]/60">
                  <div className="relative">
                    <Search className="w-3 h-3 text-[#6F737A] absolute left-2 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={repoSearchQuery}
                      onChange={(e) => setRepoSearchQuery(e.target.value)}
                      placeholder={t('project.searchRepos')}
                      className="w-full bg-[#2B2D30] border border-[#393B40] rounded pl-6 pr-2 py-1 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]"
                    />
                  </div>
                </div>

                {/* 仓库列表项 */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                  {sortedRepos.map((repo) => {
                    const isActive = repo.id === activeRepoId;
                    return (
                      <div
                        key={repo.id}
                        onClick={() => onSelectRepo(repo)}
                        className={`p-2 rounded-md cursor-pointer transition-all relative group border text-xs ${
                          isActive
                            ? 'bg-[#2E436E]/60 border-[#3574F0]/80 shadow-sm'
                            : 'hover:bg-[#2B2D30] border-transparent hover:border-[#393B40]/80'
                        }`}
                      >
                        <div className="flex items-center justify-between min-w-0">
                          <div className="flex items-center space-x-1.5 min-w-0">
                            <FolderGit2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#3574F0]' : 'text-[#8C9099]'}`} />
                            <span className={`font-semibold truncate ${isActive ? 'text-white' : 'text-[#DFE1E5]'}`}>
                              {repo.name}
                            </span>
                            {repo.isFavorite && (
                              <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                            )}
                          </div>

                          <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFavorite(repo.id);
                              }}
                              title={repo.isFavorite ? t('header.unfavorite') : t('header.favorite')}
                              className="p-1 rounded hover:bg-[#35373C] text-[#8C9099] hover:text-amber-400"
                            >
                              <Star className={`w-3 h-3 ${repo.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                            </button>
                            <button
                              onClick={(e) => handleCopyPath(repo.path, e)}
                              title={t('header.copyPath')}
                              className="p-1 rounded hover:bg-[#35373C] text-[#8C9099] hover:text-[#DFE1E5]"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRevealRepo?.(repo);
                              }}
                              title={t('project.reveal')}
                              className="p-1 rounded hover:bg-[#35373C] text-[#8C9099] hover:text-[#DFE1E5]"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const repoId = repo.id;
                                void askConfirm({
                                  title: t('confirm.removeRepoTitle'),
                                  message: t('project.removeConfirm', { name: repo.name }),
                                  confirmLabel: t('confirm.remove'),
                                }).then(ok => {
                                  if (ok) onRemoveRepo(repoId);
                                });
                              }}
                              title={t('project.remove')}
                              className="p-1 rounded hover:bg-[#35373C] text-[#8C9099] hover:text-rose-400"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        <div className="text-[10px] text-[#6F737A] font-mono truncate mt-0.5 pl-5" title={repo.path}>
                          {repo.path}
                        </div>

                        <div className="flex items-center justify-between mt-1.5 pl-5 text-[10px]">
                          <div className="flex items-center space-x-1 font-mono text-[#8C9099]">
                            <BranchIcon className="w-3 h-3 text-[#3574F0] shrink-0" />
                            <span className="truncate max-w-[110px] text-[#589DF6]">{repo.currentBranch}</span>
                            {repo.aheadCount ? (
                              <span className="text-[#3574F0]">↑{repo.aheadCount}</span>
                            ) : null}
                          </div>

                          <div className="flex items-center space-x-1 shrink-0 font-mono">
                            {repo.dirtyFilesCount > 0 ? (
                              <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[9px] font-semibold">
                                ● {repo.dirtyFilesCount}
                              </span>
                            ) : (
                              <span className="text-emerald-400 flex items-center space-x-0.5 text-[9px]">
                                <Check className="w-2.5 h-2.5" />
                                <span>{t('common.clean')}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ─── 面板 B: 分支树 ─── */}
            {activeTab === 'branches' && (
              <>
                <div className="h-10 px-3 border-b border-[#393B40] flex items-center justify-between bg-[#2B2D30]/60">
                  <div className="flex items-center space-x-1.5">
                    <BranchIcon className="w-3.5 h-3.5 text-[#3574F0]" />
                    <span className="font-semibold text-xs text-[#DFE1E5]">{t('project.branchesTitle')}</span>
                    <span className="text-[10px] font-mono text-[#8C9099] bg-[#1E1F22] px-1.5 py-0.2 rounded-full border border-[#393B40]">
                      {branches.length}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => {
                        void askInput({
                          title: t('branches.newPrompt'),
                          defaultValue: 'feature/',
                          confirmLabel: t('common.create'),
                          tone: 'primary',
                        }).then(name => {
                          if (name) onCreateBranch?.(name);
                        });
                      }}
                      title={t('project.newBranch')}
                      className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setIsDrawerOpen(false)}
                      title={t('project.closeDrawer')}
                      className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="p-2 border-b border-[#393B40]/60">
                  <div className="relative">
                    <Search className="w-3 h-3 text-[#6F737A] absolute left-2 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={branchSearchQuery}
                      onChange={(e) => setBranchSearchQuery(e.target.value)}
                      placeholder={t('project.searchBranches')}
                      className="w-full bg-[#2B2D30] border border-[#393B40] rounded pl-6 pr-2 py-1 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-3 text-xs">
                  {/* 本地分支 */}
                  <div>
                    <div className="text-[11px] font-semibold text-[#8C9099] uppercase tracking-wider mb-1 px-1">
                      {t('branches.local', { count: localBranches.length })}
                    </div>
                    <div className="space-y-0.5">
                      {localBranches.map((b) => {
                        const isCurrent = b.name === currentBranch;
                        return (
                          <div
                            key={b.name}
                            onClick={() => onSelectBranch?.(b.name)}
                            className={`px-2 py-1.5 rounded flex items-center justify-between group cursor-pointer transition-colors ${
                              isCurrent
                                ? 'bg-[#3574F0]/20 text-[#3574F0] font-semibold'
                                : 'hover:bg-[#2B2D30] text-[#DFE1E5]'
                            }`}
                          >
                            <div className="flex items-center space-x-1.5 min-w-0">
                              <BranchIcon className={`w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-[#3574F0]' : 'text-[#8C9099]'}`} />
                              <span className="truncate">{b.name}</span>
                              {isCurrent && (
                                <span className="text-[10px] text-emerald-400 font-mono shrink-0 font-normal">
                                  (HEAD)
                                </span>
                              )}
                            </div>

                            <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleFavoriteBranch?.(b);
                                }}
                                className="p-0.5 text-[#8C9099] hover:text-amber-400"
                                title={t('project.favorite')}
                              >
                                <Star className={`w-3 h-3 ${b.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const branchName = b.name;
                                  void askConfirm({
                                    title: t('confirm.mergeTitle'),
                                    message: t('project.mergeConfirm', { name: branchName, current: currentBranch }),
                                    confirmLabel: t('confirm.merge'),
                                    tone: 'primary',
                                  }).then(ok => {
                                    if (ok) onMergeBranch?.(branchName);
                                  });
                                }}
                                className="p-0.5 text-[#8C9099] hover:text-[#DFE1E5]"
                                title={t('project.mergeInto')}
                              >
                                <GitMerge className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 远程分支 */}
                  {remoteBranches.length > 0 && (
                    <div>
                      <div className="text-[11px] font-semibold text-[#8C9099] uppercase tracking-wider mb-1 px-1">
                        {t('branches.remote', { count: remoteBranches.length })}
                      </div>
                      <div className="space-y-0.5">
                        {remoteBranches.map((b) => (
                          <div
                            key={b.name}
                            onClick={() => onSelectBranch?.(b.name)}
                            className="px-2 py-1.5 rounded flex items-center justify-between group cursor-pointer hover:bg-[#2B2D30] text-[#9DA0A8] hover:text-[#DFE1E5] transition-colors"
                          >
                            <div className="flex items-center space-x-1.5 min-w-0">
                              <BranchIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                              <span className="truncate">{b.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ─── 面板 C: Shelf & Stash ─── */}
            {activeTab === 'shelf' && (
              <>
                <div className="h-10 px-3 border-b border-[#393B40] flex items-center justify-between bg-[#2B2D30]/60">
                  <div className="flex items-center space-x-1.5">
                    <Archive className="w-3.5 h-3.5 text-amber-400" />
                    <span className="font-semibold text-xs text-[#DFE1E5]">{t('header.shelf')}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <button
                      onClick={() => onCreateStash?.()}
                      title={t('project.quickStash')}
                      className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setIsDrawerOpen(false)}
                      title={t('project.closeDrawer')}
                      className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 space-y-3 text-xs">
                  {/* Shelves */}
                  <div>
                    <div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-1 px-1 flex items-center justify-between">
                      <span>{t('project.shelves', { count: shelves.length })}</span>
                    </div>
                    {shelves.length === 0 ? (
                      <div className="text-[11px] text-[#6F737A] px-2 py-1">{t('project.noShelves')}</div>
                    ) : (
                      <div className="space-y-1">
                        {shelves.map((s) => (
                          <div
                            key={s.id}
                            className="p-2 rounded bg-[#2B2D30]/60 border border-[#393B40] space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-[#DFE1E5] truncate">{s.name || t('project.unnamedShelf')}</span>
                              <div className="flex items-center space-x-1">
                                <button
                                  onClick={() => onUnshelve?.(s.id)}
                                  className="text-[10px] text-[#3574F0] hover:underline"
                                  title={t('project.restoreShelf')}
                                >
                                  {t('project.restore')}
                                </button>
                                <button
                                  onClick={() => onDeleteShelf?.(s.id)}
                                  className="text-[10px] text-rose-400 hover:underline ml-1"
                                  title={t('project.deleteShelf')}
                                >
                                  {t('common.delete')}
                                </button>
                              </div>
                            </div>
                            <div className="text-[10px] text-[#8C9099] flex items-center justify-between">
                              <span>{t('common.files', { count: s.files?.length || 0 })}</span>
                              <span>{s.date}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Stashes */}
                  <div>
                    <div className="text-[11px] font-semibold text-[#3574F0] uppercase tracking-wider mb-1 px-1 flex items-center justify-between">
                      <span>{t('project.stashes', { count: stashes.length })}</span>
                    </div>
                    {stashes.length === 0 ? (
                      <div className="text-[11px] text-[#6F737A] px-2 py-1">{t('project.noStashes')}</div>
                    ) : (
                      <div className="space-y-1">
                        {stashes.map((st) => (
                          <div
                            key={st.id}
                            className="p-2 rounded bg-[#2B2D30]/60 border border-[#393B40] space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-[#DFE1E5] truncate font-mono text-[11px]">
                                stash@&#123;{st.index}&#125;: {st.message}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[10px] pt-0.5">
                              <span className="text-[#8C9099]">{st.date}</span>
                              <div className="flex items-center space-x-1.5">
                                <button
                                  onClick={() => onApplyStash?.(st)}
                                  className="text-[#3574F0] hover:underline"
                                  title={t('project.applyStash')}
                                >
                                  {t('project.apply')}
                                </button>
                                <button
                                  onClick={() => {
                                    const name = st.message || `stash@{${st.index}}`;
                                    const stash = st;
                                    void askConfirm({
                                      title: t('confirm.dropStashTitle'),
                                      message: t('shelf.dropConfirm', { name }),
                                      confirmLabel: t('confirm.drop'),
                                      tone: 'danger',
                                      commands: repoPath
                                        ? [formatGitCommand(repoPath, ['stash', 'drop', `stash@{${stash.index}}`])]
                                        : undefined,
                                    }).then(ok => {
                                      if (ok) onDropStash?.(stash);
                                    });
                                  }}
                                  className="text-rose-400 hover:underline"
                                  title={t('project.dropStash')}
                                >
                                  {t('project.drop')}
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 添加项目弹窗 */}
      <AddProjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={onAddRepo}
        onBrowse={onBrowse}
      />
    </>
  );
};
