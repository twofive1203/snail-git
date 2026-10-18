import React, { useRef, useState } from 'react';
import { GitMerge, Play, RotateCcw, Save, X } from 'lucide-react';
import { FilePathDisplay } from './common/FilePathDisplay';
import { MergeViewer, type MergeViewerHandle, type MergeViewerStats } from './merge/MergeViewer';
import { askConfirm } from './common/askConfirm';
import { useI18n } from '../i18n/react';

export interface ConflictFileRef {
  path: string;
}

interface ThreeWayMergeModalProps {
  isOpen: boolean;
  embedded?: boolean;
  files: ConflictFileRef[];
  activePath?: string;
  base: string;
  ours: string;
  theirs: string;
  working?: string;
  loading?: boolean;
  sessionKey?: string;
  /** 当前中断状态：merge / rebase / cherry-pick / revert。none 时不显示底部动作条。 */
  operation?: string;
  operationPending?: number;
  operationBusy?: boolean;
  onContinueOperation?: () => void;
  onAbortOperation?: () => void;
  onSelectFile: (path: string) => void;
  onSave: (content: string) => void;
  onClose: () => void;
}

export const ThreeWayMergeModal: React.FC<ThreeWayMergeModalProps> = ({
  isOpen,
  embedded = false,
  files,
  activePath,
  base,
  ours,
  theirs,
  working = '',
  loading = false,
  sessionKey = '',
  operation = 'none',
  operationPending = 0,
  operationBusy = false,
  onContinueOperation,
  onAbortOperation,
  onSelectFile,
  onSave,
  onClose,
}) => {
  const { t } = useI18n();
  const viewerRef = useRef<MergeViewerHandle>(null);
  const [stats, setStats] = useState<MergeViewerStats>({ unresolved: 0, conflicts: 0, dirty: false });
  const dirtyRef = useRef(false);
  dirtyRef.current = stats.dirty;

  if (!isOpen && !embedded) return null;

  const selectFile = (path: string) => {
    if (path === activePath) return;
    if (!dirtyRef.current) {
      onSelectFile(path);
      return;
    }
    void askConfirm({
      title: t('confirm.switchFileTitle'),
      message: t('merge.switchConfirm'),
      confirmLabel: t('confirm.continue'),
      tone: 'danger',
    }).then(ok => {
      if (ok) onSelectFile(path);
    });
  };

  const body = (
    <div className={embedded ? 'flex-1 flex flex-col h-full bg-jb-panel overflow-hidden' : 'w-[95vw] max-w-6xl h-[85vh] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden'}>
      <div className="h-11 px-4 border-b border-jb-border flex items-center justify-between gap-3">
        <div className="flex items-center space-x-2 min-w-0">
          <GitMerge className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="font-semibold text-sm shrink-0">{t('merge.resolve')}</span>
          <span className="text-jb-text-muted font-mono truncate">{activePath || t('merge.noFile')}</span>
        </div>
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => viewerRef.current?.save()}
            disabled={!activePath || loading}
            title={t('merge.saveTitle')}
            className="px-3 py-1.5 rounded bg-jb-blue hover:bg-jb-blueHover text-white font-medium flex items-center space-x-1.5 disabled:opacity-40"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{t('merge.save')}{stats.unresolved > 0 ? ` (${stats.unresolved})` : ''}</span>
          </button>
          {!embedded && (
            <button onClick={onClose} className="p-1 rounded hover:bg-jb-hover text-jb-text-muted">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-jb-text-muted">
          {t('merge.empty')}
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="w-56 border-r border-jb-border overflow-auto p-1 text-xs shrink-0">
            {files.map(file => (
              <button
                key={file.path}
                onClick={() => selectFile(file.path)}
                title={file.path}
                className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-1.5 ${file.path === activePath ? 'bg-jb-selected text-white' : 'hover:bg-jb-hover'}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0" />
                <FilePathDisplay
                  path={file.path}
                  className="flex-1"
                  filenameClassName={file.path === activePath ? 'text-white' : 'text-rose-200'}
                />
              </button>
            ))}
          </div>
          <MergeViewer
            ref={viewerRef}
            base={base}
            ours={ours}
            theirs={theirs}
            working={working}
            sessionKey={`${activePath ?? ''}:${sessionKey}`}
            loading={loading}
            onSave={onSave}
            onStats={setStats}
          />
        </div>
      )}

      {operation !== 'none' && (
        <div className="h-10 px-4 border-t border-jb-border flex items-center justify-between gap-3 shrink-0 bg-jb-bg/60">
          <span className={`text-xs truncate ${operationPending > 0 ? 'text-amber-300' : 'text-jb-text-secondary'}`}>
            {operationPending > 0
              ? t('app.operation.pending', { count: operationPending })
              : t('app.operation.hint')}
          </span>
          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={onContinueOperation}
              disabled={operationBusy || operationPending > 0}
              title={operationPending > 0
                ? t('app.operation.pending', { count: operationPending })
                : t('app.operation.continue')}
              className="px-3 py-1.5 rounded bg-jb-blue hover:bg-jb-blueHover text-white font-medium flex items-center space-x-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-3.5 h-3.5" />
              <span>{t('app.operation.continue')}</span>
            </button>
            <button
              onClick={onAbortOperation}
              disabled={operationBusy}
              className="px-3 py-1.5 rounded border border-rose-500/50 text-rose-300 hover:bg-rose-500/15 font-medium flex items-center space-x-1.5 disabled:opacity-40"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{t('app.operation.abort')}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return body;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] text-xs">{body}</div>;
};
