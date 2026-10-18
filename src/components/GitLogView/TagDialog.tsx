import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Tag, X } from 'lucide-react';
import { useI18n } from '../../i18n/react';
import { isTauriEnvironment } from '../../services/gitService';

export interface TagDraft {
  /** 打标签的目标提交 hash 或分支名。 */
  target: string;
  /** 目标的可读描述，例如 `abc1234 subject`。 */
  targetLabel: string;
}

interface TagDialogProps {
  open: boolean;
  draft: TagDraft | null;
  busy?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (name: string, message: string) => void;
}

/**
 * 新建标签。名称非空、且不能和已有 tag 重名（重名由后端拒绝，这里只挡空值）。
 * 附注说明留空即创建轻量标签。
 */
export const TagDialog: React.FC<TagDialogProps> = ({ open, draft, busy = false, error = '', onCancel, onConfirm }) => {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setName('');
    setMessage('');
    window.setTimeout(() => nameRef.current?.focus(), 0);
  }, [open, draft?.target]);

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

  if (!open || !draft) return null;

  const canConfirm = isTauriEnvironment() && name.trim() !== '' && !busy;

  const submit = () => {
    if (!canConfirm) return;
    onConfirm(name.trim(), message.trim());
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
        className="w-full max-w-[480px] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden text-xs"
      >
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2">
          <div className="flex items-center space-x-2 min-w-0">
            <Tag className="w-4 h-4 text-amber-300 shrink-0" />
            <span className="font-semibold text-sm text-jb-text-primary truncate">{t('tag.createTitle')}</span>
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

        <div className="px-4 pb-3 space-y-2">
          <p className="text-jb-text-secondary font-mono truncate" title={draft.target}>
            {draft.targetLabel || draft.target}
          </p>

          <label className="block space-y-1">
            <span className="text-jb-text-secondary">{t('tag.name')}</span>
            <input
              ref={nameRef}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              disabled={busy}
              placeholder={t('tag.namePlaceholder')}
              className="w-full h-7 rounded border border-jb-border bg-jb-bg px-2.5 font-mono text-jb-text-primary placeholder:text-jb-text-muted focus:outline-none focus:border-jb-blue select-text"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-jb-text-secondary">{t('tag.message')}</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submit();
                }
              }}
              disabled={busy}
              placeholder={t('tag.messagePlaceholder')}
              className="w-full min-h-[72px] resize-y rounded border border-jb-border bg-jb-bg px-2.5 py-2 text-jb-text-primary placeholder:text-jb-text-muted focus:outline-none focus:border-jb-blue select-text"
            />
          </label>
          <p className="text-jb-text-muted leading-relaxed">{t('tag.messageHint')}</p>

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
            onClick={submit}
            disabled={!canConfirm}
            className="px-3 py-1.5 rounded border border-transparent bg-jb-blue hover:bg-jb-blueHover text-white font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>{t('tag.create')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
