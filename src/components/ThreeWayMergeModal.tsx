import React, { useEffect, useState } from 'react';
import { GitMerge, ArrowLeft, ArrowRight, Sparkles, Save, X, ShieldCheck } from 'lucide-react';

export interface ConflictFileRef {
  path: string;
}

interface ThreeWayMergeModalProps {
  isOpen: boolean;
  embedded?: boolean;
  files: ConflictFileRef[];
  activePath?: string;
  ours: string;
  theirs: string;
  result: string;
  onSelectFile: (path: string) => void;
  onResultChange: (value: string) => void;
  onAcceptLeft: () => void;
  onAcceptRight: () => void;
  onSmartMerge: () => void;
  onSave: () => void;
  onClose: () => void;
}

export const ThreeWayMergeModal: React.FC<ThreeWayMergeModalProps> = ({
  isOpen,
  embedded = false,
  files,
  activePath,
  ours,
  theirs,
  result,
  onSelectFile,
  onResultChange,
  onAcceptLeft,
  onAcceptRight,
  onSmartMerge,
  onSave,
  onClose,
}) => {
  const [localResult, setLocalResult] = useState(result);
  useEffect(() => setLocalResult(result), [result, activePath]);

  if (!isOpen && !embedded) return null;

  const body = (
    <div className={embedded ? 'flex-1 flex flex-col h-full bg-jb-panel overflow-hidden' : 'w-[95vw] max-w-6xl h-[85vh] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden'}>
      <div className="h-11 px-4 border-b border-jb-border flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0">
          <GitMerge className="w-4 h-4 text-purple-400 shrink-0" />
          <span className="font-semibold text-sm">Resolve Conflicts</span>
          <span className="text-jb-text-muted font-mono truncate">{activePath || '没有冲突文件'}</span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={onSmartMerge}
            disabled={!activePath}
            className="px-2.5 py-1.5 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 font-medium flex items-center space-x-1.5 disabled:opacity-40"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Apply All Non-Conflicting</span>
          </button>
          <button
            onClick={() => {
              onResultChange(localResult);
              onSave();
            }}
            disabled={!activePath}
            className="px-3 py-1.5 rounded bg-jb-blue hover:bg-jb-blueHover text-white font-medium flex items-center space-x-1.5 disabled:opacity-40"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save and Mark Resolved</span>
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
          当前仓库没有未解决的冲突。合并或变基产生冲突后，这里会打开对应文件。
        </div>
      ) : (
        <div className="flex-1 flex min-h-0">
          <div className="w-56 border-r border-jb-border overflow-auto p-1 text-xs">
            {files.map(file => (
              <button
                key={file.path}
                onClick={() => onSelectFile(file.path)}
                className={`w-full text-left px-2 py-1.5 rounded font-mono truncate ${file.path === activePath ? 'bg-jb-selected text-white' : 'hover:bg-jb-hover text-rose-300'}`}
              >
                {file.path}
              </button>
            ))}
          </div>
          <div className="flex-1 grid grid-cols-3 divide-x divide-jb-border overflow-hidden font-mono text-xs">
            <div className="flex flex-col bg-jb-bg/50 overflow-hidden">
              <div className="h-8 px-3 border-b border-jb-border flex items-center justify-between font-sans">
                <span className="font-semibold text-jb-blue">Your Version</span>
                <button onClick={onAcceptLeft} className="px-2 py-0.5 rounded bg-jb-blue/20 text-jb-blue flex items-center space-x-1 text-[11px]">
                  <span>Accept Left</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <pre className="p-3 whitespace-pre-wrap overflow-y-auto flex-1 leading-relaxed">{ours || '（空）'}</pre>
            </div>
            <div className="flex flex-col bg-jb-bg overflow-hidden">
              <div className="h-8 px-3 border-b border-jb-border flex items-center space-x-1.5 font-sans font-semibold text-emerald-400">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Result</span>
              </div>
              <textarea
                value={localResult}
                onChange={(e) => {
                  setLocalResult(e.target.value);
                  onResultChange(e.target.value);
                }}
                className="w-full flex-1 p-3 bg-jb-bg text-jb-text-primary font-mono text-xs leading-relaxed resize-none focus:outline-none"
              />
            </div>
            <div className="flex flex-col bg-jb-bg/50 overflow-hidden">
              <div className="h-8 px-3 border-b border-jb-border flex items-center justify-between font-sans">
                <button onClick={onAcceptRight} className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 flex items-center space-x-1 text-[11px]">
                  <ArrowLeft className="w-3 h-3" />
                  <span>Accept Right</span>
                </button>
                <span className="font-semibold text-purple-400">Their Version</span>
              </div>
              <pre className="p-3 whitespace-pre-wrap overflow-y-auto flex-1 leading-relaxed">{theirs || '（空）'}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return body;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none text-xs">{body}</div>;
};
