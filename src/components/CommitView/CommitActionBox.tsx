import React, { useState } from 'react';
import { Check, ChevronDown, Sparkles, History, Layers } from 'lucide-react';

interface CommitActionBoxProps {
  stagedFilesCount: number;
  onCommit: (message: string, isAmend: boolean) => void;
  onCommitAndPush: (message: string, isAmend: boolean) => void;
  onShelve: () => void;
  onCreatePatch: () => void;
}

export const CommitActionBox: React.FC<CommitActionBoxProps> = ({
  stagedFilesCount,
  onCommit,
  onCommitAndPush,
  onShelve,
  onCreatePatch,
}) => {
  const [message, setMessage] = useState('');
  const [isAmend, setIsAmend] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const prefixes = [
    { label: 'feat:', desc: '新特性' },
    { label: 'fix:', desc: '修复' },
    { label: 'refactor:', desc: '重构' },
    { label: 'perf:', desc: '性能' },
    { label: 'chore:', desc: '杂项' },
    { label: 'docs:', desc: '文档' },
  ];

  const handleAddPrefix = (prefix: string) => {
    if (!message.startsWith(prefix)) {
      setMessage(`${prefix} ${message.replace(/^[a-z]+(\([a-z0-9_-]+\))?:\s*/i, '')}`);
    }
  };

  return (
    <div className="h-44 border-t border-jb-border bg-jb-panel p-3 flex flex-col justify-between text-xs select-none">
      {/* 顶部操作：快捷前缀与 Amend 选项 */}
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center space-x-1.5">
          <span className="text-jb-text-muted text-[11px] font-medium">Prefixes:</span>
          {prefixes.map(p => (
            <button
              key={p.label}
              onClick={() => handleAddPrefix(p.label)}
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
            onChange={(e) => setIsAmend(e.target.checked)}
            className="rounded border-jb-border text-jb-blue focus:ring-0 cursor-pointer bg-jb-bg"
          />
          <span className="text-[11px] font-medium" title="只改写尚未推送的最近一次提交">Amend Commit</span>
        </label>
      </div>

      {/* 提交消息文本框 */}
      <div className="flex-1 relative mb-2">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Commit message (Ctrl+Enter to commit)..."
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter' && message.trim() && stagedFilesCount > 0) {
              e.preventDefault();
              onCommit(message, isAmend);
              setMessage('');
            }
          }}
          className="w-full h-full bg-jb-bg border border-jb-border rounded p-2 text-xs text-jb-text-primary placeholder-jb-text-muted font-sans resize-none focus:outline-none focus:border-jb-blue transition-colors leading-relaxed"
        />
      </div>

      {/* 底部动作条 */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center space-x-2 text-jb-text-muted text-[11px]">
          <span>{stagedFilesCount} file(s) staged</span>
          <span>•</span>
          <button 
            onClick={onShelve}
            className="text-jb-orange hover:underline flex items-center space-x-1"
          >
            <Layers className="w-3 h-3" />
            <span>Shelve Changes...</span>
          </button>
        </div>

        {/* 组合提交按钮 (仿 IDEA Commit / Commit and Push 复合按钮) */}
        <div className="flex items-center space-x-2 relative">
          <div className="inline-flex rounded-md shadow-sm">
            <button
              onClick={() => onCommit(message, isAmend)}
              disabled={stagedFilesCount === 0 || !message.trim()}
              className="px-3 py-1.5 bg-jb-blue hover:bg-jb-blueHover disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-l text-xs flex items-center space-x-1.5 transition-colors shadow-sm"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{isAmend ? 'Amend Commit' : 'Commit'}</span>
            </button>

            <button
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={stagedFilesCount === 0 || !message.trim()}
              className="px-1.5 py-1.5 bg-jb-blue hover:bg-jb-blueHover disabled:opacity-40 disabled:cursor-not-allowed text-white border-l border-blue-600 rounded-r transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 下拉弹出项 */}
          {showDropdown && (
            <div className="absolute right-0 bottom-full mb-1 w-44 bg-jb-panel border border-jb-border rounded shadow-xl py-1 z-30 text-xs">
              <button
                onClick={() => {
                  setShowDropdown(false);
                  onCommitAndPush(message, isAmend);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-jb-selected text-jb-text-primary hover:text-white flex items-center space-x-2"
              >
                <span>Commit and Push...</span>
              </button>
              <button
                onClick={() => {
                  setShowDropdown(false);
                  onCreatePatch();
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-jb-selected text-jb-text-primary hover:text-white flex items-center space-x-2"
              >
                <span>Create Patch...</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
