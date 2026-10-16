import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Combine, Loader2, X } from 'lucide-react';
import { useI18n } from '../../i18n/react';
import { isTauriEnvironment, previewSquash, type SquashPreview } from '../../services/gitService';

interface SquashDialogProps {
  open: boolean;
  repoPath: string;
  hashes: string[];
  onCancel: () => void;
  onConfirm: (hashes: string[], message: string) => Promise<boolean>;
}

function errorText(err: unknown): string {
  if (typeof err === 'string' && err.trim()) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const message = String((err as { message: unknown }).message || '');
    if (message.trim()) return message;
  }
  return String(err);
}

function joinNames(names: string[]): string {
  if (names.length <= 4) return names.join(', ');
  return `${names.slice(0, 4).join(', ')} +${names.length - 4}`;
}

export const SquashDialog: React.FC<SquashDialogProps> = ({
  open,
  repoPath,
  hashes,
  onCancel,
  onConfirm,
}) => {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<SquashPreview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const hashKey = hashes.join(',');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setPreview(null);
    setMessage('');
    setError('');
    if (!isTauriEnvironment()) {
      setError(t('toast.previewNoWrite'));
      return;
    }
    if (!repoPath || hashes.length < 2) {
      setError(t('graph.squashNeedMore'));
      return;
    }
    setLoading(true);
    previewSquash(repoPath, hashes)
      .then(next => {
        if (cancelled) return;
        setPreview(next);
        setMessage(next.message);
        window.setTimeout(() => messageRef.current?.focus(), 0);
      })
      .catch(err => {
        if (!cancelled) setError(errorText(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, repoPath, hashKey, hashes, t]);

  useEffect(() => {
    if (!open || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const canConfirm = Boolean(preview) && message.trim() !== '' && !loading && !error && !busy;

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      const ok = await onConfirm(hashes, message.trim());
      if (!ok) setBusy(false);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[1px] p-6"
      onMouseDown={(event) => {
        if (busy) return;
        if (cardRef.current && !cardRef.current.contains(event.target as Node)) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[560px] max-h-[80vh] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden text-xs"
      >
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2">
          <div className="flex items-center space-x-2 min-w-0">
            <Combine className="w-4 h-4 text-jb-blue shrink-0" />
            <span className="font-semibold text-sm text-jb-text-primary truncate">{t('squash.title')}</span>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1 rounded hover:bg-jb-hover text-jb-text-muted hover:text-jb-text-primary disabled:opacity-40"
            title={t('common.cancel')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pb-3 space-y-2 overflow-y-auto">
          {preview && (
            <p className="text-jb-text-secondary leading-relaxed">
              {t('squash.intro', { count: preview.commits.length, branch: preview.branch })}
            </p>
          )}

          {loading && (
            <div className="flex items-center space-x-2 text-jb-blue">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t('squash.loading')}</span>
            </div>
          )}

          {error && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 px-2.5 py-1.5 leading-relaxed whitespace-pre-wrap">
              {error}
            </div>
          )}

          {preview && (
            <>
              <div className="rounded border border-jb-border bg-jb-bg/60 overflow-hidden">
                <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-jb-text-muted border-b border-jb-border">
                  {t('squash.list')}
                </div>
                <ul className="max-h-32 overflow-y-auto py-1">
                  {preview.commits.map(commit => (
                    <li key={commit.hash} className="px-2.5 py-0.5 flex items-center gap-2 min-w-0" title={commit.subject}>
                      <span className="font-mono text-jb-text-muted shrink-0">{commit.shortHash}</span>
                      <span className="truncate text-jb-text-primary">{commit.subject}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {preview.hasLocalChanges && (
                <p className="text-jb-text-secondary leading-relaxed">{t('squash.localChanges')}</p>
              )}
              {preview.replayCount > 0 && (
                <p className="text-jb-text-secondary leading-relaxed">
                  {t('squash.replay', { count: preview.replayCount })}
                </p>
              )}
              {preview.pushedOn.length > 0 && (
                <div className="rounded border border-amber-500/40 bg-amber-500/10 text-amber-100 px-2.5 py-1.5 leading-relaxed flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{t('squash.pushed', { names: joinNames(preview.pushedOn) })}</span>
                </div>
              )}
              {preview.alsoOn.length > 0 && (
                <p className="text-jb-text-secondary leading-relaxed">
                  {t('squash.otherBranches', { names: joinNames(preview.alsoOn) })}
                </p>
              )}
              <p className="text-jb-text-muted leading-relaxed">{t('squash.undoHint')}</p>

              <label className="block space-y-1">
                <span className="text-jb-text-secondary">{t('squash.message')}</span>
                <textarea
                  ref={messageRef}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault();
                      void confirm();
                    }
                  }}
                  disabled={busy}
                  placeholder={t('squash.messagePlaceholder')}
                  className="w-full min-h-[120px] max-h-56 resize-y rounded border border-jb-border bg-jb-bg px-2.5 py-2 text-jb-text-primary placeholder:text-jb-text-muted focus:outline-none focus:border-jb-blue select-text"
                />
              </label>
            </>
          )}

          {busy && (
            <div className="flex items-center space-x-2 text-jb-blue">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t('common.busy')}</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-jb-border bg-jb-bg/40 flex items-center justify-end space-x-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-jb-border text-jb-text-secondary hover:bg-jb-hover hover:text-jb-text-primary disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void confirm()}
            disabled={!canConfirm}
            className="px-3 py-1.5 rounded border border-transparent bg-jb-blue hover:bg-jb-blueHover text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5"
          >
            <Combine className="w-3.5 h-3.5" />
            <span>{t('squash.confirm')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
