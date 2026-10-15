import React, { useState, useRef, useEffect } from 'react';
import { 
  GitBranch, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  CheckSquare, 
  GitGraph, 
  RotateCcw, 
  RefreshCw, 
  Loader2,
  FolderGit2, 
  Layers, 
  Cpu, 
  ChevronDown, 
  MoreHorizontal, 
  AlertTriangle, 
  GitMerge,
  Cloud,
  Copy,
  ExternalLink,
  Plus,
  Search,
  Star,
  Trash2,
  Check
} from 'lucide-react';
import { GitRepository } from '../types/git';
import { WindowControls } from './WindowControls';
import { useI18n } from '../i18n/react';

export type SyncAction = 'update' | 'push' | 'fetch';

export type MainViewMode = 'log' | 'commit';

interface HeaderProps {
  currentRepoName?: string;
  currentRepoPath?: string;
  repositories?: GitRepository[];
  activeRepoId?: string;
  onSelectRepo?: (repo: GitRepository) => void;
  onAddRepoClick?: () => void;
  onToggleFavoriteRepo?: (repoId: string) => void;
  onRemoveRepo?: (repoId: string) => void;
  onRevealRepo?: (repo: GitRepository) => void;
  currentBranch: string;
  activeMode: MainViewMode;
  onModeChange: (mode: MainViewMode) => void;
  changesCount?: number;
  onOpenBranches: () => void;
  onUpdateClick: () => void;
  onPushClick: () => void;
  onFetchClick: () => void;
  onOpenRemotes?: () => void;
  onRollbackClick: () => void;
  onShelfClick: () => void;
  onOpenMerge?: () => void;
  hasConflict?: boolean;
  aheadCount?: number;
  behindCount?: number;
  syncAction?: SyncAction | null;
  shelfCount?: number;
  memoryMb?: number;
  busyLabel?: string | null;
  operationsLocked?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentRepoName = 'snail-git',
  currentRepoPath = '',
  repositories = [],
  activeRepoId = '',
  onSelectRepo,
  onAddRepoClick,
  onToggleFavoriteRepo,
  onRemoveRepo,
  onRevealRepo,
  currentBranch,
  activeMode,
  onModeChange,
  changesCount = 0,
  onOpenBranches,
  onUpdateClick,
  onPushClick,
  onFetchClick,
  onOpenRemotes,
  onRollbackClick,
  onShelfClick,
  onOpenMerge,
  hasConflict = false,
  aheadCount = 0,
  behindCount = 0,
  syncAction = null,
  shelfCount = 0,
  memoryMb,
  busyLabel,
  operationsLocked = false,
}) => {
  const { locale, setLocale, t } = useI18n();
  const [isRepoMenuOpen, setIsRepoMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');
  const repoMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (repoMenuRef.current && !repoMenuRef.current.contains(e.target as Node)) {
        setIsRepoMenuOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    const dismiss = () => {
      setIsRepoMenuOpen(false);
      setIsMoreMenuOpen(false);
    };
    window.addEventListener('snailgit:dismiss', dismiss);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('snailgit:dismiss', dismiss);
    };
  }, []);

  const lockClass = operationsLocked ? 'opacity-50 cursor-not-allowed pointer-events-none' : '';

  // 排序与过滤仓库
  const filteredRepos = repositories.filter(r => 
    r.name.toLowerCase().includes(repoSearch.toLowerCase()) ||
    r.path.toLowerCase().includes(repoSearch.toLowerCase())
  );
  const sortedRepos = [...filteredRepos].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return 0;
  });

  const handleCopy = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
  };

  return (
    <header
      data-tauri-drag-region="deep"
      className="h-11 bg-[#1E1F22] border-b border-[#303236] flex items-center justify-between pl-3 pr-0 select-none text-xs z-30 relative shadow-sm"
    >
      {/* ─── 左区：Logo + 仓库下拉切换器 + 分支快速胶囊 ─── */}
      <div className="flex items-center space-x-2.5 min-w-0">
        {/* Logo */}
        <div className="flex items-center space-x-1.5 shrink-0">
          <div className="w-6 h-6 rounded bg-[#3574F0]/15 flex items-center justify-center text-[#3574F0] border border-[#3574F0]/30 shadow-inner">
            <FolderGit2 className="w-3.5 h-3.5" />
          </div>
          <span className="font-bold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-sky-300 bg-clip-text text-transparent text-sm">
            SnailGit
          </span>
        </div>

        <div className="h-3.5 w-px bg-[#303236] shrink-0" />

        {/* 仓库下拉选择器 */}
        <div className="relative" ref={repoMenuRef}>
          <button
            onClick={() => setIsRepoMenuOpen(!isRepoMenuOpen)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[#2B2D30]/80 hover:bg-[#35373C] border border-[#393B40] text-[#DFE1E5] transition-all max-w-[220px] ${
              isRepoMenuOpen ? 'border-[#3574F0] ring-1 ring-[#3574F0]/30' : ''
            }`}
            title={t('header.currentProject', { name: currentRepoName, path: currentRepoPath })}
          >
            <FolderGit2 className="w-3.5 h-3.5 text-[#3574F0] shrink-0" />
            <span className="font-medium truncate font-mono text-[11px]">{currentRepoName}</span>
            <ChevronDown className={`w-3 h-3 text-[#9DA0A8] shrink-0 transition-transform ${isRepoMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* 仓库全功能下拉面板 */}
          {isRepoMenuOpen && (
            <div data-tauri-drag-region="false" className="absolute left-0 top-full mt-1.5 w-80 bg-[#1E1F22] border border-[#393B40] rounded-lg shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-100 overflow-hidden flex flex-col">
              {/* 搜索框 */}
              <div className="p-2 border-b border-[#303236] bg-[#2B2D30]/50">
                <div className="relative">
                  <Search className="w-3 h-3 text-[#6F737A] absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder={t('header.searchRepos')}
                    className="w-full bg-[#1E1F22] border border-[#393B40] rounded pl-6 pr-2 py-1 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]"
                  />
                </div>
              </div>

              {/* 仓库列表项 */}
              <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                {sortedRepos.map(repo => {
                  const isActive = repo.id === activeRepoId;
                  return (
                    <div
                      key={repo.id}
                      onClick={() => {
                        onSelectRepo?.(repo);
                        setIsRepoMenuOpen(false);
                      }}
                      className={`p-2 rounded-md cursor-pointer transition-all relative group flex flex-col text-xs border ${
                        isActive
                          ? 'bg-[#2E436E]/50 border-[#3574F0]/70 text-white'
                          : 'hover:bg-[#2B2D30] border-transparent text-[#DFE1E5]'
                      }`}
                    >
                      <div className="flex items-center justify-between min-w-0">
                        <div className="flex items-center space-x-1.5 min-w-0">
                          <FolderGit2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#3574F0]' : 'text-[#8C9099]'}`} />
                          <span className="font-semibold truncate">{repo.name}</span>
                          {repo.isFavorite && (
                            <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                          )}
                        </div>

                        {/* 快捷操作浮层 */}
                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleFavoriteRepo?.(repo.id);
                            }}
                            title={repo.isFavorite ? t('header.unfavorite') : t('header.favorite')}
                            className="p-0.5 hover:text-amber-400 text-[#8C9099]"
                          >
                            <Star className={`w-3 h-3 ${repo.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </button>
                          <button
                            onClick={(e) => handleCopy(repo.path, e)}
                            title={t('header.copyPath')}
                            className="p-0.5 hover:text-[#DFE1E5] text-[#8C9099]"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRevealRepo?.(repo);
                            }}
                            title={t('header.openDir')}
                            className="p-0.5 hover:text-[#DFE1E5] text-[#8C9099]"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(t('header.removeConfirm', { name: repo.name }))) {
                                onRemoveRepo?.(repo.id);
                              }
                            }}
                            title={t('header.remove')}
                            className="p-0.5 hover:text-rose-400 text-[#8C9099]"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div className="text-[10px] text-[#8C9099] truncate font-mono mt-0.5 pl-5" title={repo.path}>
                        {repo.path}
                      </div>

                      <div className="flex items-center justify-between mt-1 pl-5 text-[10px]">
                        <span className="text-[#589DF6] font-mono">{repo.currentBranch}</span>
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
                  );
                })}
              </div>

              {/* 底部：添加本地仓库按钮 */}
              <div className="p-2 border-t border-[#303236] bg-[#2B2D30]/60 flex items-center justify-between">
                <button
                  onClick={() => {
                    setIsRepoMenuOpen(false);
                    onAddRepoClick?.();
                  }}
                  className="w-full py-1.5 px-2 rounded bg-[#3574F0] hover:bg-[#3574F0]/90 text-white font-medium text-xs flex items-center justify-center space-x-1 transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{t('header.addRepo')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 分支选择器胶囊（移到左区仓库旁，紧贴上下文） */}
        <button
          onClick={onOpenBranches}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-[#2B2D30]/80 hover:bg-[#35373C] border border-[#393B40] text-[#DFE1E5] hover:border-[#4E5157] transition-all font-mono text-[11px] shadow-sm max-w-[200px]"
          title={t('header.openBranches')}
        >
          <GitBranch className="w-3.5 h-3.5 text-[#3574F0] shrink-0" />
          <span className="font-semibold text-blue-400 truncate">{currentBranch}</span>
          {(aheadCount > 0 || behindCount > 0) && (
            <span className="text-[10px] text-[#DFE1E5] bg-[#1E1F22] px-1 py-0.2 rounded border border-[#393B40] font-mono flex items-center space-x-0.5 shrink-0">
              {aheadCount > 0 && <span className="text-blue-400">↑{aheadCount}</span>}
              {behindCount > 0 && <span className="text-amber-400">↓{behindCount}</span>}
            </span>
          )}
          <ChevronDown className="w-3 h-3 text-[#8C9099] shrink-0" />
        </button>

        {/* 冲突全局状态快捷胶囊 */}
        {hasConflict && (
          <button
            onClick={onOpenMerge}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors animate-pulse text-[11px]"
            title={t('header.conflictTitle')}
          >
            <AlertTriangle className="w-3 h-3 text-amber-400" />
            <span className="font-semibold">{t('header.resolveConflict')}</span>
          </button>
        )}
      </div>

      {/* ─── 中区：核心双模式分段切换器 [ Log | Commit ] ─── */}
      <div className="flex items-center bg-[#2B2D30] p-0.5 rounded-lg border border-[#393B40] shadow-inner">
        <button
          onClick={() => onModeChange('log')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${
            activeMode === 'log'
              ? 'bg-[#3574F0] text-white shadow'
              : 'text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#35373C]/60'
          }`}
          title={t('header.gitLogTitle', { shortcut: 'Alt+9' })}
        >
          <GitGraph className="w-3.5 h-3.5" />
          <span>{t('header.gitLog')}</span>
          <span className={`text-[10px] font-mono ml-0.5 hidden sm:inline ${activeMode === 'log' ? 'text-blue-100' : 'text-[#6F737A]'}`}>
            Alt+9
          </span>
        </button>

        <button
          onClick={() => onModeChange('commit')}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all relative ${
            activeMode === 'commit'
              ? 'bg-[#3574F0] text-white shadow'
              : 'text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#35373C]/60'
          }`}
          title={t('header.commitDiffTitle', { shortcut: 'Alt+0' })}
        >
          <CheckSquare className="w-3.5 h-3.5" />
          <span>{t('header.commitDiff')}</span>
          {changesCount > 0 && (
            <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono leading-none ${
              activeMode === 'commit'
                ? 'bg-white text-[#3574F0] font-bold'
                : 'bg-[#3574F0]/20 text-[#3574F0] border border-[#3574F0]/40'
            }`}>
              {changesCount}
            </span>
          )}
          <span className={`text-[10px] font-mono ml-0.5 hidden sm:inline ${activeMode === 'commit' ? 'text-blue-100' : 'text-[#6F737A]'}`}>
            Alt+0
          </span>
        </button>
      </div>

      {/* ─── 右区：常用 Git 动作组、状态 ─── */}
      <div className="flex items-center shrink-0 h-11">
      <div className="flex items-center space-x-2 pr-1">
        {/* 常用 Git 操作组 */}
        <div className="flex items-center space-x-0.5 bg-[#2B2D30]/60 p-0.5 rounded border border-[#393B40]">
          {/* Update */}
          <button 
            onClick={onUpdateClick}
            disabled={operationsLocked}
            title={t('header.updateTitle', { shortcut: 'Ctrl+T' })}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded hover:bg-[#35373C] text-[#DFE1E5] transition-colors ${lockClass}`}
          >
            {syncAction === 'update' ? (
              <Loader2 className="w-3.5 h-3.5 text-[#3574F0] animate-spin" />
            ) : (
              <ArrowDownToLine className="w-3.5 h-3.5 text-[#3574F0]" />
            )}
            <span className="hidden xl:inline text-[11px] font-medium">{t('header.update')}</span>
            {behindCount > 0 && (
              <span className="px-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[10px] leading-4">
                ↓{behindCount}
              </span>
            )}
          </button>

          {/* Push */}
          <button 
            onClick={onPushClick}
            disabled={operationsLocked}
            title={t('header.pushTitle', { shortcut: 'Ctrl+Shift+K' })}
            className={`flex items-center space-x-1 px-2.5 py-1 rounded hover:bg-[#35373C] text-[#DFE1E5] transition-colors ${lockClass}`}
          >
            {syncAction === 'push' ? (
              <Loader2 className="w-3.5 h-3.5 text-indigo-300 animate-spin" />
            ) : (
              <ArrowUpFromLine className="w-3.5 h-3.5 text-indigo-400" />
            )}
            <span className="hidden xl:inline text-[11px] font-medium">{t('header.push')}</span>
            {aheadCount > 0 && (
              <span className="px-1 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 font-mono text-[10px] leading-4">
                ↑{aheadCount}
              </span>
            )}
          </button>

          {/* Fetch */}
          <button 
            onClick={onFetchClick}
            disabled={operationsLocked}
            title={t('header.fetchTitle')}
            className={`p-1.5 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5] transition-colors ${lockClass}`}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncAction === 'fetch' ? 'animate-spin text-[#3574F0]' : ''}`} />
          </button>

          {/* 更多动作下拉菜单 */}
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setIsMoreMenuOpen(!isMoreMenuOpen)}
              title={t('header.more')}
              className="p-1.5 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5] transition-colors"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {isMoreMenuOpen && (
              <div data-tauri-drag-region="false" className="absolute right-0 top-full mt-1.5 w-56 bg-[#2B2D30] border border-[#393B40] rounded-md shadow-2xl py-1 z-50 text-xs">
                <button
                  onClick={() => {
                    onShelfClick();
                    setIsMoreMenuOpen(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-[#DFE1E5] hover:bg-[#35373C] flex items-center space-x-2 transition-colors"
                >
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span className="flex-1 text-left">{t('header.shelf')}</span>
                  {shelfCount > 0 && (
                    <span className="px-1.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono text-[10px]">
                      {shelfCount}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => {
                    onOpenMerge?.();
                    setIsMoreMenuOpen(false);
                  }}
                  className="w-full px-3 py-1.5 text-left text-[#DFE1E5] hover:bg-[#35373C] flex items-center space-x-2 transition-colors"
                >
                  <GitMerge className="w-3.5 h-3.5 text-purple-400" />
                  <span>{t('header.merge')}</span>
                </button>

                <button
                  type="button"
                  disabled={!onOpenRemotes || operationsLocked}
                  onClick={() => {
                    onOpenRemotes?.();
                    setIsMoreMenuOpen(false);
                  }}
                  title={t('header.remotesTitle')}
                  className="w-full px-3 py-1.5 text-left text-[#DFE1E5] hover:bg-[#35373C] flex items-center space-x-2 transition-colors disabled:opacity-40"
                >
                  <Cloud className="w-3.5 h-3.5 text-sky-400" />
                  <span>{t('header.remotes')}</span>
                </button>

                <div className="my-1 border-t border-[#393B40]" />

                <button
                  onClick={() => {
                    onRollbackClick();
                    setIsMoreMenuOpen(false);
                  }}
                  disabled={operationsLocked}
                  className="w-full px-3 py-1.5 text-left text-rose-300 hover:bg-rose-950/30 flex items-center space-x-2 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                  <span>{t('header.rollbackAll')}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {busyLabel && (
          <span
            className="max-w-[140px] truncate px-1 text-[10px] text-amber-300 font-mono animate-pulse"
            title={busyLabel}
          >
            {busyLabel}
          </span>
        )}

        {memoryMb !== undefined && memoryMb > 0 && (
          <div
            className="hidden 2xl:flex items-center space-x-1 px-1.5 py-0.5 rounded bg-[#2B2D30] border border-[#393B40] text-[10px] text-emerald-400 font-mono"
            title={t('status.memory')}
          >
            <Cpu className="w-3 h-3 text-emerald-400" />
            <span>{memoryMb}MB</span>
          </div>
        )}
        <div
          role="group"
          aria-label={t('locale.switch')}
          className="flex items-center bg-[#2B2D30] p-0.5 rounded-lg border border-[#393B40] shadow-inner"
        >
          <button
            type="button"
            aria-pressed={locale === 'zh'}
            onClick={() => setLocale('zh')}
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
              locale === 'zh'
                ? 'bg-[#3574F0] text-white shadow'
                : 'text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#35373C]/60'
            }`}
          >
            中
          </button>
          <button
            type="button"
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
            className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
              locale === 'en'
                ? 'bg-[#3574F0] text-white shadow'
                : 'text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#35373C]/60'
            }`}
          >
            EN
          </button>
        </div>
      </div>
      <WindowControls />
      </div>
    </header>
  );
};
