import React, { useState } from 'react';
import { GitBranch } from '../types/git';
import { 
  GitBranch as BranchIcon, 
  Search, 
  Plus, 
  Check, 
  GitMerge, 
  GitPullRequest, 
  Scissors, 
  Trash2, 
  Layers, 
  Star, 
  X,
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { useI18n } from '../i18n/react';

interface BranchesModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: GitBranch[];
  currentBranch: string;
  onSelectBranch: (branchName: string) => void;
  onCreateBranch?: (name: string) => void;
  onMerge?: (name: string) => void;
  onRebase?: (name: string) => void;
  onCompare?: (name: string) => void;
  onDelete?: (branch: GitBranch, force: boolean) => void;
  onRename?: (branch: GitBranch) => void;
  onToggleFavorite?: (branch: GitBranch) => void;
  embedded?: boolean;
}

export const BranchesModal: React.FC<BranchesModalProps> = ({
  isOpen,
  onClose,
  branches,
  currentBranch,
  onSelectBranch,
  onCreateBranch,
  onMerge,
  onRebase,
  onCompare,
  onDelete,
  onRename,
  onToggleFavorite,
  embedded = false,
}) => {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const [selectedBranchForAction, setSelectedBranchForAction] = useState<GitBranch | null>(null);

  if (!isOpen && !embedded) return null;

  const finish = () => {
    setSelectedBranchForAction(null);
    if (!embedded) onClose();
  };

  const filtered = branches.filter(b => b.name.toLowerCase().includes(search.toLowerCase()));
  const localBranches = filtered.filter(b => !b.isRemote);
  const remoteBranches = filtered.filter(b => b.isRemote);

  const handleCheckout = (name: string) => {
    onSelectBranch(name);
    finish();
  };

  return (
    <div className={embedded ? 'flex-1 flex flex-col h-full bg-jb-bg select-none text-xs' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px] select-none text-xs'}>
      <div className={embedded ? 'flex-1 flex flex-col overflow-hidden' : 'w-[420px] max-h-[580px] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150'}>
        {/* 顶部标题与搜索栏 */}
        <div className="p-3 border-b border-jb-border bg-jb-panel/95 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <BranchIcon className="w-4 h-4 text-jb-blue" />
              <span className="font-semibold text-sm text-jb-text-primary">{t('branches.title')}</span>
            </div>
            {!embedded && (
            <button 
              onClick={onClose}
              className="p-1 rounded hover:bg-jb-hover text-jb-text-muted hover:text-jb-text-primary"
            >
              <X className="w-4 h-4" />
            </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-jb-text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('branches.search')}
              className="w-full bg-jb-bg border border-jb-border rounded pl-8 pr-3 py-1.5 text-xs text-jb-text-primary placeholder-jb-text-muted focus:outline-none focus:border-jb-blue transition-colors"
            />
          </div>
        </div>

        {/* 快捷新建分支 */}
        <div className="px-3 py-2 border-b border-jb-border bg-jb-bg/40">
          <button 
            onClick={() => {
              const name = prompt(t('branches.newPrompt'), 'feature/');
              if (name) onCreateBranch?.(name);
            }}
            className="w-full flex items-center justify-center space-x-1.5 py-1.5 rounded bg-jb-blue/15 hover:bg-jb-blue/25 text-jb-blue border border-jb-blue/30 font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('branches.newFrom', { branch: currentBranch })}</span>
          </button>
        </div>

        {/* 分支分组列表 */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3">
          {/* 本地分支 */}
          <div>
            <div className="text-[11px] font-semibold text-jb-text-muted px-2 py-1 uppercase tracking-wider">
              {t('branches.local', { count: localBranches.length })}
            </div>
            <div className="space-y-0.5 mt-0.5">
              {localBranches.map(branch => {
                const isCurrent = branch.name === currentBranch;
                return (
                  <div
                    key={branch.name}
                    onClick={() => setSelectedBranchForAction(branch)}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded cursor-pointer transition-colors group ${
                      isCurrent 
                        ? 'bg-emerald-950/30 text-emerald-300 font-semibold border border-emerald-500/20' 
                        : 'hover:bg-jb-hover text-jb-text-primary'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      {isCurrent ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <BranchIcon className="w-3.5 h-3.5 text-jb-text-muted shrink-0" />
                      )}
                      <span className="font-mono truncate">{branch.name}</span>
                      {branch.isFavorite && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                    </div>

                    <div className="flex items-center space-x-1.5">
                      {branch.ahead ? (
                        <span className="text-[10px] text-jb-blue font-mono">↑{branch.ahead}</span>
                      ) : null}
                      {branch.behind ? (
                        <span className="text-[10px] text-jb-orange font-mono">↓{branch.behind}</span>
                      ) : null}
                      <ChevronRight className="w-3 h-3 text-jb-text-muted group-hover:text-jb-text-primary" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 远程分支 */}
          {remoteBranches.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-jb-text-muted px-2 py-1 uppercase tracking-wider">
                {t('branches.remote', { count: remoteBranches.length })}
              </div>
              <div className="space-y-0.5 mt-0.5">
                {remoteBranches.map(branch => (
                  <div
                    key={branch.name}
                    onClick={() => setSelectedBranchForAction(branch)}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded hover:bg-jb-hover cursor-pointer text-jb-text-secondary hover:text-jb-text-primary transition-colors group"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <BranchIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                      <span className="font-mono truncate">{branch.name}</span>
                    </div>
                    <ChevronRight className="w-3 h-3 text-jb-text-muted group-hover:text-jb-text-primary" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 选中具体分支后的右侧动作抽屉/弹层 */}
        {selectedBranchForAction && (
          <div className="p-3 border-t border-jb-border bg-jb-bg/95 space-y-1.5">
            <div className="flex items-center justify-between pb-1 mb-1 border-b border-jb-border/60">
              <span className="font-mono text-jb-text-primary font-semibold truncate">
                {selectedBranchForAction.name}
              </span>
              <button 
                onClick={() => setSelectedBranchForAction(null)}
                className="text-jb-text-muted hover:text-jb-text-primary text-[11px]"
              >
                {t('branches.cancel')}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                onClick={() => handleCheckout(selectedBranchForAction.name)}
                disabled={selectedBranchForAction.name === currentBranch}
                className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover border border-jb-border flex items-center space-x-1.5 text-jb-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Check className="w-3.5 h-3.5 text-jb-green" />
                <span>{t('branches.checkout')}</span>
              </button>

              <button
                onClick={() => {
                  onMerge?.(selectedBranchForAction.name);
                  finish();
                }}
                className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover border border-jb-border flex items-center space-x-1.5 text-jb-text-primary"
              >
                <GitMerge className="w-3.5 h-3.5 text-jb-blue" />
                <span>{t('branches.mergeInto', { branch: currentBranch })}</span>
              </button>

              <button
                onClick={() => {
                  onRebase?.(selectedBranchForAction.name);
                  finish();
                }}
                className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover border border-jb-border flex items-center space-x-1.5 text-jb-text-primary"
              >
                <GitPullRequest className="w-3.5 h-3.5 text-purple-400" />
                <span>{t('branches.rebaseOnto')}</span>
              </button>

              <button
                onClick={() => {
                  onCompare?.(selectedBranchForAction.name);
                  finish();
                }}
                disabled={selectedBranchForAction.name === currentBranch}
                title={t('branches.compareTitle')}
                className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover border border-jb-border flex items-center space-x-1.5 text-jb-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Layers className="w-3.5 h-3.5 text-amber-400" />
                <span>{t('branches.compare')}</span>
              </button>

              <button
                onClick={() => onRename?.(selectedBranchForAction)}
                disabled={selectedBranchForAction.isRemote}
                className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover border border-jb-border flex items-center space-x-1.5 text-jb-text-primary disabled:opacity-30"
              >
                <Scissors className="w-3.5 h-3.5 text-jb-text-muted" />
                <span>{t('branches.rename')}</span>
              </button>

              <button
                onClick={() => onToggleFavorite?.(selectedBranchForAction)}
                className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover border border-jb-border flex items-center space-x-1.5 text-jb-text-primary"
              >
                <Star className={`w-3.5 h-3.5 ${selectedBranchForAction.isFavorite ? 'text-amber-400 fill-amber-400' : 'text-jb-text-muted'}`} />
                <span>{selectedBranchForAction.isFavorite ? t('branches.unfavorite') : t('branches.favorite')}</span>
              </button>

              <button
                onClick={() => onDelete?.(selectedBranchForAction, false)}
                disabled={selectedBranchForAction.name === currentBranch}
                className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover border border-jb-border flex items-center space-x-1.5 text-rose-300 disabled:opacity-30"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{selectedBranchForAction.isRemote ? t('branches.deleteRemote') : t('branches.delete')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
