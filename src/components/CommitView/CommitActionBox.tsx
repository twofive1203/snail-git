import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { useI18n } from '../../i18n/react';

interface CommitActionBoxProps {
  stagedFilesCount: number;
  lastCommitMessage?: string;
  onCommit: (message: string, isAmend: boolean) => void;
  onCommitAndPush: (message: string, isAmend: boolean) => void;
  onShelve: () => void;
  onCreatePatch: () => void;
}

export const CommitActionBox: React.FC<CommitActionBoxProps> = ({
  stagedFilesCount,
  lastCommitMessage = '',
  onCommit,
  onCommitAndPush,
  onShelve,
  onCreatePatch,
}) => {
  const { t } = useI18n();
  const [message, setMessage] = useState('');
  const [isAmend, setIsAmend] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const draftRef = useRef('');
  const amendFilled = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isAmend || amendFilled.current || !lastCommitMessage) return;
    setMessage(lastCommitMessage);
    amendFilled.current = true;
  }, [isAmend, lastCommitMessage]);

  const prefixes = [
    { label: 'feat:', desc: t('commit.prefix.feat') },
    { label: 'fix:', desc: t('commit.prefix.fix') },
    { label: 'refactor:', desc: t('commit.prefix.refactor') },
    { label: 'perf:', desc: t('commit.prefix.perf') },
    { label: 'chore:', desc: t('commit.prefix.chore') },
    { label: 'docs:', desc: t('commit.prefix.docs') },
  ];

  const focusMessageEnd = (value: string) => {
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
    });
  };

  const handleAddPrefix = (prefix: string) => {
    const next = message.startsWith(prefix)
      ? message
      : `${prefix} ${message.replace(/^[a-z]+(\([a-z0-9_-]+\))?:\s*/i, '')}`;
    setMessage(next);
    focusMessageEnd(next);
  };

  const handleAmendChange = (checked: boolean) => {
    if (checked) {
      draftRef.current = message;
      amendFilled.current = Boolean(lastCommitMessage);
      if (lastCommitMessage) setMessage(lastCommitMessage);
    } else {
      amendFilled.current = false;
      setMessage(draftRef.current);
    }
    setIsAmend(checked);
  };

  const subjectLength = message.split('\n')[0]?.length ?? 0;
  const counterClass = subjectLength > 72
    ? 'text-rose-400'
    : subjectLength > 50
      ? 'text-amber-400'
      : 'text-jb-text-muted';

  return (
    <div className="flex-1 h-full min-h-0 bg-jb-panel p-3 flex flex-col text-xs select-none overflow-hidden">
      <div className="flex items-center justify-between mb-1.5 shrink-0">
        <div className="flex items-center space-x-1.5">
          <span className="text-jb-text-muted text-[11px] font-medium">{t('commit.prefixes')}</span>
          {prefixes.map(p => (
            <button
              key={p.label}
              onClick={() => handleAddPrefix(p.label)}
              title={p.desc}
              className="px-1.5 py-0.5 rounded bg-jb-bg hover:bg-jb-hover border border-jb-border/70 text-jb-text-secondary hover:text-jb-text-primary text-[10px] font-mono transition-colors"
            >
              {p.label}
            </button>
          ))}
        </div>

        <label className="flex items-center space-x-1.5 text-jb-text-secondary hover:text-jb-text-primary cursor-pointer">
          <input
            type="checkbox"
            checked={isAmend}
            onChange={(e) => handleAmendChange(e.target.checked)}
            className="rounded border-jb-border text-jb-blue focus:ring-0 cursor-pointer bg-jb-bg"
          />
          <span className="text-[11px] font-medium" title={t('commit.amendTitle')}>{t('commit.amend')}</span>
        </label>
      </div>

      <div className="flex-1 relative mb-2 min-h-0">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('commit.placeholder')}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter' && message.trim() && stagedFilesCount > 0) {
              e.preventDefault();
              onCommit(message, isAmend);
              setMessage('');
              draftRef.current = '';
            }
          }}
          className="w-full h-full bg-jb-bg border border-jb-border rounded p-2 pb-5 text-xs text-jb-text-primary placeholder-jb-text-muted font-sans resize-none focus:outline-none focus:border-jb-blue transition-colors leading-relaxed"
        />
        <span
          title={t('commit.counterTitle')}
          className={`absolute right-2 bottom-1 text-[10px] font-mono pointer-events-none ${counterClass}`}
        >
          {subjectLength} / 72
        </span>
      </div>

      <div className="flex items-center justify-between pt-1 shrink-0">
        <div className="flex items-center space-x-2 text-jb-text-muted text-[11px]">
          <span>{t('commit.staged', { count: stagedFilesCount })}</span>
          <span>•</span>
          <button 
            onClick={onShelve}
            className="text-jb-orange hover:underline flex items-center space-x-1"
          >
            <Layers className="w-3 h-3" />
            <span>{t('commit.shelve')}</span>
          </button>
        </div>

        <div className="flex items-center space-x-2 relative">
          <div className="inline-flex rounded-md shadow-sm">
            <button
              onClick={() => onCommit(message, isAmend)}
              disabled={stagedFilesCount === 0 || !message.trim()}
              className="px-3 py-1.5 bg-jb-blue hover:bg-jb-blueHover disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-l text-xs flex items-center space-x-1.5 transition-colors shadow-sm"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{isAmend ? t('commit.amend') : t('commit.commit')}</span>
            </button>

            <button
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={stagedFilesCount === 0 || !message.trim()}
              className="px-1.5 py-1.5 bg-jb-blue hover:bg-jb-blueHover disabled:opacity-40 disabled:cursor-not-allowed text-white border-l border-blue-600 rounded-r transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {showDropdown && (
            <div className="absolute right-0 bottom-full mb-1 w-44 bg-jb-panel border border-jb-border rounded shadow-xl py-1 z-30 text-xs">
              <button
                onClick={() => {
                  setShowDropdown(false);
                  onCommitAndPush(message, isAmend);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-jb-selected text-jb-text-primary hover:text-white flex items-center space-x-2"
              >
                <span>{t('commit.commitAndPush')}</span>
              </button>
              <button
                onClick={() => {
                  setShowDropdown(false);
                  onCreatePatch();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-jb-selected text-jb-text-primary hover:text-white flex items-center space-x-2"
              >
                <span>{t('commit.createPatch')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
