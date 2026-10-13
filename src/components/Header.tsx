import React from 'react';
import { 
  GitBranch, 
  ArrowDownToLine, 
  ArrowUpFromLine, 
  Check, 
  RotateCcw, 
  RefreshCw, 
  Clock, 
  FolderGit2, 
  Layers, 
  Sparkles,
  Cpu
} from 'lucide-react';

interface HeaderProps {
  currentRepoName?: string;
  currentRepoPath?: string;
  currentBranch: string;
  onOpenBranches: () => void;
  onCommitClick: () => void;
  onUpdateClick: () => void;
  onPushClick: () => void;
  onFetchClick: () => void;
  onRollbackClick: () => void;
  onShelfClick: () => void;
  aheadCount?: number;
  behindCount?: number;
  memoryMb?: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentRepoName = 'easy-git',
  currentRepoPath = 'D:/workspace/aiwork/easy-git',
  currentBranch,
  onOpenBranches,
  onCommitClick,
  onUpdateClick,
  onPushClick,
  onFetchClick,
  onRollbackClick,
  onShelfClick,
  aheadCount = 0,
  behindCount = 0,
  memoryMb,
}) => {
  return (
    <header className="h-11 bg-jb-panel border-b border-jb-border flex items-center justify-between px-3 select-none text-xs">
      {/* 左侧：Logo 与仓库路径 */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 text-jb-text-primary font-semibold tracking-wide">
          <div className="w-6 h-6 rounded bg-jb-blue/20 flex items-center justify-center text-jb-blue">
            <FolderGit2 className="w-4 h-4" />
          </div>
          <span className="text-sm font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-300 bg-clip-text text-transparent">
            EasyGit
          </span>
          <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-jb-bg text-jb-blue border border-jb-border">
            IDEA Style
          </span>
        </div>

        <div className="h-4 w-px bg-jb-border" />

        {/* 仓库信息 */}
        <div className="flex items-center space-x-1.5 text-jb-text-secondary hover:text-jb-text-primary cursor-pointer px-1.5 py-1 rounded hover:bg-jb-hover transition-colors">
          <span className="text-jb-text-muted">Repository:</span>
          <span className="font-mono text-jb-text-primary font-medium">{currentRepoName}</span>
          <span className="text-[11px] text-jb-text-muted">({currentRepoPath})</span>
        </div>
      </div>

      {/* 中间：经典 IDEA Git 常用操作工具栏 */}
      <div className="flex items-center space-x-1 bg-jb-bg/60 p-0.5 rounded-md border border-jb-border">
        {/* Update Project (Ctrl+T) */}
        <button 
          onClick={onUpdateClick}
          title="Update Project (Ctrl+T) - 拉取远程更新并合并/变基"
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-jb-hover text-jb-text-primary transition-colors"
        >
          <ArrowDownToLine className="w-3.5 h-3.5 text-jb-blue" />
          <span className="hidden sm:inline">Update</span>
        </button>

        {/* Commit... (Ctrl+K) */}
        <button 
          onClick={onCommitClick}
          title="Commit... (Ctrl+K) - 提交当前工作区变更"
          className="flex items-center space-x-1 px-2.5 py-1 rounded bg-jb-blue/20 hover:bg-jb-blue/30 text-jb-blue font-medium transition-colors border border-jb-blue/30"
        >
          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
          <span>Commit</span>
        </button>

        {/* Push... (Ctrl+Shift+K) */}
        <button 
          onClick={onPushClick}
          title="Push... (Ctrl+Shift+K) - 推送本地提交到远程分支"
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-jb-hover text-jb-text-primary transition-colors"
        >
          <ArrowUpFromLine className="w-3.5 h-3.5 text-indigo-400" />
          <span className="hidden sm:inline">Push</span>
        </button>

        <div className="h-3.5 w-px bg-jb-border my-auto mx-0.5" />

        {/* Fetch */}
        <button 
          onClick={onFetchClick}
          title="Fetch - 刷新所有远程分支状态"
          className="p-1.5 rounded hover:bg-jb-hover text-jb-text-secondary hover:text-jb-text-primary transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        <button 
          onClick={onRollbackClick}
          title="Rollback - 撤销全部工作区更改"
          className="p-1.5 rounded hover:bg-jb-hover text-jb-text-secondary hover:text-jb-text-primary transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Shelve */}
        <button 
          onClick={onShelfClick}
          title="Shelf / Stash - 架藏与暂存变更"
          className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-jb-hover text-jb-text-secondary hover:text-jb-text-primary transition-colors"
        >
          <Layers className="w-3.5 h-3.5 text-jb-orange" />
          <span className="hidden md:inline">Shelf</span>
        </button>
      </div>

      {/* 右侧：内存监控状态 & 分支切换入口小部件 */}
      <div className="flex items-center space-x-3">
        {/* 极致轻量内存指示（直击痛点） */}
        <div 
          className="hidden lg:flex items-center space-x-1.5 px-2 py-0.5 rounded bg-jb-bg border border-jb-border/70 text-[11px] text-jb-green font-mono"
          title="EasyGit 内存占用 vs 传统 IDEA (约 2.5GB-4GB)，内存占用仅为其 1/50"
        >
          <Cpu className="w-3 h-3 text-jb-green" />
          <span>Memory: {memoryMb && memoryMb > 0 ? `${memoryMb} MB` : '—'}</span>
        </div>

        {/* 分支小部件 */}
        <button
          onClick={onOpenBranches}
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-jb-bg hover:bg-jb-hover border border-jb-border text-jb-text-primary hover:border-jb-borderHover transition-all font-mono text-xs shadow-sm"
          title="点击打开 Git 分支管理面板"
        >
          <GitBranch className="w-3.5 h-3.5 text-jb-blue" />
          <span className="font-semibold text-blue-400">{currentBranch}</span>
          {(aheadCount > 0 || behindCount > 0) && (
            <span className="text-[10px] text-jb-text-muted bg-jb-panel px-1 py-0.2 rounded border border-jb-border font-mono">
              {aheadCount > 0 ? `↑${aheadCount}` : ''}{behindCount > 0 ? `↓${behindCount}` : ''}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
