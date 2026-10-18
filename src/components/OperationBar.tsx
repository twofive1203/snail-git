import React from 'react';
import { AlertTriangle, GitMerge, Play, RotateCcw } from 'lucide-react';
import type { RepoOperationState } from '../services/gitService';
import { useI18n } from '../i18n/react';
import type { MessageKey } from '../i18n/messages';

const LABELS: Record<string, MessageKey> = {
  merge: 'app.operation.merge',
  rebase: 'app.operation.rebase',
  'cherry-pick': 'app.operation.cherry-pick',
  revert: 'app.operation.revert',
};

interface OperationBarProps {
  state: RepoOperationState | null;
  busy?: boolean;
  onContinue: () => void;
  onAbort: () => void;
  /** 还有未解决冲突时，把「立即解决」作为跳到三方合并的入口。 */
  onOpenMerge?: () => void;
}

/**
 * 合并 / 变基 / 挑拣 / 还原停在半途时的动作条。
 * 只有后端报告 operation !== 'none' 才渲染：没有中断状态时不该出现任何按钮。
 */
export const OperationBar: React.FC<OperationBarProps> = ({ state, busy = false, onContinue, onAbort, onOpenMerge }) => {
  const { t } = useI18n();
  if (!state || state.operation === 'none') return null;
  const pending = state.unmergedPaths.length;
  const label = LABELS[state.operation];

  return (
    <div className="h-8 bg-purple-500/15 border-b border-purple-500/30 px-3 flex items-center justify-between text-xs text-purple-100 shrink-0 z-10">
      <div className="flex items-center space-x-2 min-w-0">
        <GitMerge className="w-3.5 h-3.5 text-purple-300 shrink-0" />
        <span className="font-medium shrink-0">{label ? t(label) : state.operation}</span>
        {pending > 0 ? (
          <button
            onClick={onOpenMerge}
            className="flex items-center space-x-1 text-amber-200 hover:text-amber-100 truncate"
          >
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="underline decoration-dotted">{t('app.operation.pending', { count: pending })}</span>
            <span className="shrink-0">{t('app.resolveNow')}</span>
          </button>
        ) : (
          <span className="text-purple-200/80 truncate">{t('app.operation.hint')}</span>
        )}
      </div>
      <div className="flex items-center space-x-1.5 shrink-0">
        <button
          onClick={onContinue}
          disabled={busy || pending > 0}
          title={pending > 0 ? t('app.operation.pending', { count: pending }) : t('app.operation.continue')}
          className="px-2.5 py-0.5 rounded bg-purple-500/30 hover:bg-purple-500/45 text-purple-100 border border-purple-500/50 font-medium transition-colors text-xs flex items-center space-x-1 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Play className="w-3 h-3" />
          <span>{t('app.operation.continue')}</span>
        </button>
        <button
          onClick={onAbort}
          disabled={busy}
          title={t('app.operation.abort')}
          className="px-2.5 py-0.5 rounded bg-jb-panel hover:bg-jb-hover text-jb-text-secondary border border-jb-border font-medium transition-colors text-xs flex items-center space-x-1 disabled:opacity-40"
        >
          <RotateCcw className="w-3 h-3" />
          <span>{t('app.operation.abort')}</span>
        </button>
      </div>
    </div>
  );
};
