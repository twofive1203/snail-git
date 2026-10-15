import React, { useEffect, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { useI18n } from '../../i18n/react';

interface StashDialogProps {
  open: boolean;
  fileCount: number;
  onCancel: () => void;
  onConfirm: (message: string) => void;
}

/** 贮藏命名弹窗。取消只关闭，不会调用 git stash。空说明由后端回退为默认名。 */
export const StashDialog: React.FC<StashDialogProps> = ({
  open,
  fileCount,
  onCancel,
  onConfirm,
}) => {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMessage('');
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6">
      <form
        className="w-full max-w-md bg-[#1E1F22] border border-[#393B40] rounded-lg shadow-2xl p-4 text-xs"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm(message.trim());
        }}
      >
        <div className="flex items-center space-x-2 text-sm font-semibold text-[#DFE1E5]">
          <Layers className="w-4 h-4 text-jb-blue" />
          <span>{t('stash.dialogTitle')}</span>
        </div>
        <p className="mt-2 text-[#9DA0A8] leading-relaxed">{t('stash.hint', { count: fileCount })}</p>
        <label className="mt-3 block text-[11px] text-[#8C9099]">
          {t('stash.message')}
          <input
            ref={inputRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={t('stash.messagePlaceholder')}
            className="mt-1 w-full bg-[#2B2D30] border border-[#393B40] rounded px-2.5 py-1.5 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]"
          />
        </label>
        <div className="mt-4 flex items-center justify-end space-x-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-[#393B40] text-[#DFE1E5] hover:bg-[#2B2D30]"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 rounded bg-[#3574F0] hover:bg-[#4682F7] text-white font-medium"
          >
            {t('stash.confirm')}
          </button>
        </div>
      </form>
    </div>
  );
};
