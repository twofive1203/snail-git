import React, { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowRight, GitMerge, Info, Loader2, X } from 'lucide-react';
import { useI18n } from '../../i18n/react';

export interface ConfirmAction {
  /** 选择该动作时回传给后端的值，对应 git_ops::update_response。 */
  value: string;
  label: string;
  /** primary 为蓝色实心主按钮，danger 为红色描边，其余为普通描边按钮。 */
  tone?: 'primary' | 'default' | 'danger';
  icon?: React.ReactNode;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 正文：字符串按换行分段；需要更丰富的排版时直接传节点。 */
  message: React.ReactNode;
  /** 高亮列出的文件路径，用等宽字体逐条展示。 */
  files?: string[];
  filesHint?: string;
  actions: ConfirmAction[];
  onChoose: (value: string) => void;
  onCancel: () => void;
  /** 后端动作执行中：锁定按钮并显示进度文案。 */
  busy?: boolean;
  busyLabel?: string;
}

const toneClass = (tone: ConfirmAction['tone']) => {
  if (tone === 'primary') return 'bg-jb-blue hover:bg-jb-blueHover text-white border-transparent';
  if (tone === 'danger') return 'bg-transparent hover:bg-jb-red/10 text-jb-red border-jb-red/40';
  return 'bg-jb-panel hover:bg-jb-hover text-jb-text-primary border-jb-border';
};

const actionIcon = (action: ConfirmAction) => {
  if (action.icon) return action.icon;
  if (action.tone === 'primary') return <ArrowRight className="w-3.5 h-3.5" />;
  if (action.tone === 'danger') return <AlertTriangle className="w-3.5 h-3.5" />;
  return <Info className="w-3.5 h-3.5" />;
};

/** 项目风格的确认弹窗，替代 window.confirm —— 支持多选项、文件清单与执行中状态。 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  files,
  filesHint,
  actions,
  onChoose,
  onCancel,
  busy = false,
  busyLabel,
}) => {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || busy) return;
    // 与 BranchesModal 一致：弹窗打开即获得焦点，Esc 关闭。
    const id = window.setTimeout(() => primaryRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      }
    };
    // 捕获阶段先于 App 的全局快捷键，避免 Esc 同时关掉下层菜单。
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const paragraphs = typeof message === 'string'
    ? message.split('\n').map(line => line.trim()).filter(Boolean)
    : [message];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 backdrop-blur-[1px] p-6 select-none"
      onMouseDown={(event) => {
        if (busy) return;
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
            <AlertTriangle className="w-4 h-4 text-jb-orange shrink-0" />
            <span className="font-semibold text-sm text-jb-text-primary truncate">{title}</span>
          </div>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1 rounded hover:bg-jb-hover text-jb-text-muted hover:text-jb-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
            title={t('common.cancel')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-4 pb-3 space-y-2 overflow-y-auto">
          {paragraphs.map((node, index) => (
            <p key={index} className="text-jb-text-secondary leading-relaxed break-words">
              {node}
            </p>
          ))}

          {files && files.length > 0 && (
            <div className="rounded border border-jb-border bg-jb-bg/60 overflow-hidden">
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-jb-text-muted bg-jb-bg/60 border-b border-jb-border flex items-center space-x-1.5">
                <GitMerge className="w-3 h-3 text-jb-orange" />
                <span>{filesHint || t('common.files', { count: files.length })}</span>
              </div>
              <ul className="max-h-40 overflow-y-auto py-1">
                {files.map(file => (
                  <li
                    key={file}
                    className="px-2.5 py-0.5 font-mono text-[11px] text-jb-text-primary break-all"
                    title={file}
                  >
                    {file}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {busy && (
            <div className="flex items-center space-x-2 text-jb-blue">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{busyLabel || t('common.busy')}</span>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-jb-border bg-jb-bg/40 flex items-center justify-end space-x-2 flex-wrap gap-y-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-jb-border bg-transparent text-jb-text-secondary hover:bg-jb-hover hover:text-jb-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('common.cancel')}
          </button>
          {actions.map((action, index) => (
            <button
              key={action.value}
              ref={index === 0 ? primaryRef : undefined}
              onClick={() => onChoose(action.value)}
              disabled={busy}
              className={`px-3 py-1.5 rounded border flex items-center space-x-1.5 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${toneClass(action.tone)}`}
            >
              {actionIcon(action)}
              <span>{action.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
