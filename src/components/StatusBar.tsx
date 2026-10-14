import React from 'react';
import { GitBranch, HardDrive, CheckCircle2, Zap } from 'lucide-react';
import { useI18n } from '../i18n/react';

interface StatusBarProps {
  currentBranch: string;
  onOpenBranches: () => void;
  stagedFilesCount: number;
  dirtyFilesCount?: number;
  aheadCount?: number;
  behindCount?: number;
  gitVersion?: string;
  connected?: boolean;
  memoryMb?: number;
  encoding?: string;
  lineEnding?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  currentBranch,
  onOpenBranches,
  stagedFilesCount,
  dirtyFilesCount = 0,
  aheadCount = 0,
  behindCount = 0,
  gitVersion = 'Git',
  connected = true,
  memoryMb,
  encoding = '—',
  lineEnding = '—',
}) => {
  const { t } = useI18n();
  const treeStatus = dirtyFilesCount === 0
    ? t('status.clean')
    : t('status.changed', { dirty: dirtyFilesCount, staged: stagedFilesCount });
  const versionLabel = connected ? gitVersion.replace('git version ', 'Git ') : t('status.notConnected');
  return (
    <footer className="h-6 bg-[#18191B] border-t border-[#303236] flex items-center justify-between px-3 text-[11px] text-[#8C9099] select-none font-sans shrink-0">
      {/* 左侧 */}
      <div className="flex items-center space-x-3">
        <button
          onClick={onOpenBranches}
          className="flex items-center space-x-1 hover:text-[#DFE1E5] text-[#9DA0A8] cursor-pointer transition-colors"
        >
          <GitBranch className="w-3 h-3 text-[#3574F0]" />
          <span className="font-mono text-[#589DF6]">{currentBranch}</span>
          {aheadCount > 0 && <span className="px-1 rounded bg-blue-500/15 text-blue-300 font-mono text-[10px]">↑{aheadCount}</span>}
          {behindCount > 0 && <span className="px-1 rounded bg-amber-500/15 text-amber-300 font-mono text-[10px]">↓{behindCount}</span>}
        </button>

        <span className="h-3 w-px bg-[#303236]" />

        <div className="flex items-center space-x-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>{treeStatus}</span>
        </div>
      </div>

      {/* 右侧 */}
      <div className="flex items-center space-x-3 font-mono text-[10px]">
        <div className="flex items-center space-x-1 text-emerald-400 font-medium">
          <Zap className="w-3 h-3 text-amber-400" />
          <span>RAM: {memoryMb && memoryMb > 0 ? `${memoryMb} MB` : '—'}</span>
        </div>

        <span className="h-3 w-px bg-[#303236]" />

        <span>{encoding}</span>
        <span>{lineEnding}</span>
        <span className="text-[#6F737A]">{versionLabel}</span>
      </div>
    </footer>
  );
};
