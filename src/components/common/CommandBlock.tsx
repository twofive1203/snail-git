import { useState } from 'react';
import { useI18n } from '../../i18n/react';

interface CommandBlockProps {
  commands: string[];
  hint?: string;
  /** 复制内容。缺省时把 commands 用换行接起来。 */
  copyText?: string;
}

/** 确认框里的等宽命令区。复制失败只提示，不关闭弹窗，也不触发确认。 */
export function CommandBlock({ commands, hint, copyText }: CommandBlockProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  if (commands.length === 0) return null;

  const copy = () => {
    const text = copyText ?? commands.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopyError(false);
      setCopied(true);
    }).catch(() => {
      setCopied(false);
      setCopyError(true);
    });
  };

  return (
    <div className="rounded border border-jb-border bg-jb-bg/60 overflow-hidden">
      <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-jb-text-muted bg-jb-bg/60 border-b border-jb-border flex items-center justify-between gap-2">
        <span>{t('confirm.commands')}</span>
        <button
          type="button"
          onClick={copy}
          className="normal-case tracking-normal text-jb-blue hover:underline"
        >
          {t('common.copy')}
        </button>
      </div>
      {hint && (
        <p className="px-2.5 pt-1.5 text-jb-text-secondary leading-relaxed">{hint}</p>
      )}
      <ul className="max-h-40 overflow-auto py-1">
        {commands.map((line, index) => (
          <li
            key={`${index}-${line}`}
            className="px-2.5 py-0.5 font-mono text-[11px] text-jb-text-primary whitespace-pre"
          >
            {line}
          </li>
        ))}
      </ul>
      {copyError && (
        <p className="px-2.5 pb-1.5 text-jb-red">{t('confirm.copyFailed')}</p>
      )}
      {copied && !copyError && (
        <p className="px-2.5 pb-1.5 text-jb-text-muted">{t('confirm.copied')}</p>
      )}
    </div>
  );
}
