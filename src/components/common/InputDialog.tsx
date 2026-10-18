import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, AlertTriangle, Info, X } from 'lucide-react';
import { useI18n } from '../../i18n/react';
import type { AskInputOptions } from './askInput';

interface InputDialogProps {
  open: boolean;
  options: AskInputOptions | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const toneClass = (tone: AskInputOptions['tone']) => {
  if (tone === 'primary') return 'bg-jb-blue hover:bg-jb-blueHover text-white border-transparent';
  if (tone === 'danger') return 'bg-transparent hover:bg-jb-red/10 text-jb-red border-jb-red/40';
  return 'bg-jb-panel hover:bg-jb-hover text-jb-text-primary border-jb-border';
};

const toneIcon = (tone: AskInputOptions['tone']) => {
  if (tone === 'danger') return <AlertTriangle className="w-3.5 h-3.5" />;
  if (tone === 'primary') return <ArrowRight className="w-3.5 h-3.5" />;
  return <Info className="w-3.5 h-3.5" />;
};

/**
 * 输入弹窗。与 ConfirmDialog 共用视觉 token，但不塞进它：
 * ConfirmDialog 的 onChoose 只回传一个字符串值，无法带回用户输入。
 */
export const InputDialog: React.FC<InputDialogProps> = ({ open, options, onSubmit, onCancel }) => {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  const optionsKey = `${options?.title ?? ''}\u0000${options?.defaultValue ?? ''}`;

  useEffect(() => {
    if (!open) return;
    const initial = options?.defaultValue ?? '';
    setValue(initial);
    setTouched(false);
    // 打开即聚焦并全选默认值：改名场景下直接输入就能替换旧名。
    const id = window.setTimeout(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, optionsKey, options?.defaultValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    // 捕获阶段先于 App 的全局快捷键，Esc 只关最上层弹窗。
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onCancel]);

  const trimmed = value.trim();
  const error = useMemo(() => {
    if (trimmed === '') return null;
    return options?.validate?.(trimmed) ?? null;
  }, [trimmed, options]);

  if (!open || !options) return null;

  const canConfirm = trimmed !== '' && error === null;

  const submit = () => {
    setTouched(true);
    if (!canConfirm) return;
    onSubmit(trimmed);
  };

  const messageLines = options.message ? options.message.split('\n').map(line => line.trim()).filter(Boolean) : [];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-[1px] p-6 select-none"
      onMouseDown={(event) => {
        if (cardRef.current && !cardRef.current.contains(event.target as Node)) onCancel();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[440px] max-h-[80vh] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 text-xs"
      >
        <div className="flex items-start justify-between px-4 pt-3.5 pb-2">
          <div className="flex items-center space-x-2 min-w-0">
            <Info className="w-4 h-4 text-jb-blue shrink-0" />
            <span className="font-semibold text-sm text-jb-text-primary truncate">{options.title}</span>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded hover:bg-jb-hover text-jb-text-muted hover:text-jb-text-primary"
            title={t('common.cancel')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pb-3 space-y-2">
          {messageLines.map((line, index) => (
            <p key={index} className="text-jb-text-secondary leading-relaxed break-words">{line}</p>
          ))}

          <input
            ref={inputRef}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setTouched(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
            placeholder={options.placeholder}
            spellCheck={false}
            className="w-full h-7 rounded border border-jb-border bg-jb-bg px-2.5 font-mono text-jb-text-primary placeholder:text-jb-text-muted focus:outline-none focus:border-jb-blue select-text"
          />

          {error && (
            <p className="text-rose-300 leading-relaxed">{error}</p>
          )}
          {!error && touched && trimmed === '' && (
            <p className="text-jb-text-muted leading-relaxed">{t('common.inputRequired')}</p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-jb-border bg-jb-bg/40 flex items-center justify-end space-x-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded border border-jb-border bg-transparent text-jb-text-secondary hover:bg-jb-hover hover:text-jb-text-primary"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={submit}
            disabled={!canConfirm}
            className={`px-3 py-1.5 rounded border flex items-center space-x-1.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneClass(options.tone)}`}
          >
            {toneIcon(options.tone)}
            <span>{options.confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
