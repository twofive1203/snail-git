import React from 'react';
import { GitBranch, HardDrive, CheckCircle2, Zap } from 'lucide-react';

interface StatusBarProps {
  currentBranch: string;
  onOpenBranches: () => void;
  stagedFilesCount: number;
  dirtyFilesCount?: number;
  aheadCount?: number;
  behindCount?: number;
  gitVersion?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  currentBranch,
  onOpenBranches,
  stagedFilesCount,
  dirtyFilesCount = 0,
  aheadCount = 0,
  behindCount = 0,
  gitVersion = 'Git',
}) => {
  return (
    <footer className="h-6 bg-jb-panel border-t border-jb-border flex items-center justify-between px-3 text-[11px] text-jb-text-muted select-none font-sans">
      {/* 左侧 */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenBranches}
          className="flex items-center space-x-1 hover:text-jb-text-primary text-jb-text-secondary cursor-pointer"
        >
          <GitBranch className="w-3 h-3 text-jb-blue" />
          <span className="font-mono">{currentBranch}</span>
          {aheadCount > 0 && <span className="text-jb-blue font-mono text-[10px]">↑{aheadCount}</span>}
          {behindCount > 0 && <span className="text-jb-orange font-mono text-[10px]">↓{behindCount}</span>}
        </button>

        <span className="h-3 w-px bg-jb-border" />

        <div className="flex items-center space-x-1">
          <CheckCircle2 className="w-3 h-3 text-jb-green" />
          <span>{dirtyFilesCount === 0 ? 'Working tree clean' : `${dirtyFilesCount} changed · ${stagedFilesCount} staged`}</span>
        </div>
      </div>

      {/* 右侧 */}
      <div className="flex items-center space-x-3 font-mono text-[10px]">
        <div className="flex items-center space-x-1 text-jb-green font-semibold">
          <Zap className="w-3 h-3 text-amber-400" />
          <span>RAM: 48.2 MB (vs IDEA ~2.6 GB, 节约 98%)</span>
        </div>

        <span className="h-3 w-px bg-jb-border" />

        <span>UTF-8</span>
        <span>LF</span>
        <span>{gitVersion.replace('git version ', 'Git ')}</span>
      </div>
    </footer>
  );
};
