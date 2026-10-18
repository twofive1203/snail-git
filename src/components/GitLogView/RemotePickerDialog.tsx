import React, { useEffect, useRef, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { useI18n } from '../../i18n/react';

interface RemotePickerDialogProps {
  open: boolean;
  title: string;
  /** 说明本次动作会写到远程，破坏性动作必须说清楚。 */
  hint: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  remotes: string[];
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (remote: string) => void;
}

/** 只在有多个远程时出现：让用户选把标签推到哪个远程。 */
export const RemotePickerDialog: React.FC<RemotePickerDialogProps> = ({
  open,
  title,
  hint,
  confirmLabel,
  tone = 'primary',
  remotes,
  busy = false,
  error = '',
  onCancel,
  onConfirm,
}) => {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const [remote, setRemote] = useState('');

  useEffect(() => {
    if (!open) return;
    setRemote(remotes[0] ?? '');
  }, [open, remotes]);

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

  const canConfirm = remote !== '' && !busy;
  const danger = tone === 'danger';

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
        className="w-full max-w-[420px] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden text-xs"
      >
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2">
          <span className="font-semibold text-sm text-jb-text-primary truncate">{title}</span>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1 rounded hover:bg-jb-hover text-jb-text-muted hover:text-jb-text-primary disabled:opacity-40"
            title={t('common.cancel')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pb-3 space-y-2">
          <p className={danger ? 'text-rose-200 leading-relaxed' : 'text-jb-text-secondary leading-relaxed'}>{hint}</p>
          <label className="block space-y-1">
            <span className="text-jb-text-secondary">{t('tag.remote')}</span>
            <select
              value={remote}
              onChange={(event) => setRemote(event.target.value)}
              disabled={busy}
              className="w-full h-7 rounded border border-jb-border bg-jb-bg px-2 font-mono text-jb-text-primary focus:outline-none focus:border-jb-blue"
            >
              {remotes.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          {error && (
            <div className="rounded border border-rose-500/40 bg-rose-500/10 text-rose-200 px-2.5 py-1.5 leading-relaxed whitespace-pre-wrap">
              {error}
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
            onClick={() => { if (canConfirm) onConfirm(remote); }}
            disabled={!canConfirm}
            className={`px-3 py-1.5 rounded font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5 ${
              danger
                ? 'border border-rose-500/60 text-rose-200 hover:bg-rose-500/15'
                : 'border border-transparent bg-jb-blue hover:bg-jb-blueHover text-white'
            }`}
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
