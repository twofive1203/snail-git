import React, { useEffect, useRef, useState } from 'react';
import { GitCommit, FileChangeStatus } from '../../types/git';
import { FilePathDisplay } from '../common/FilePathDisplay';
import { 
  FileText, 
  Folder, 
  List, 
  FolderTree, 
  ArrowUpRight, 
  ChevronUp,
  ChevronDown,
} from 'lucide-react';

interface CommitDetailProps {
  commit: GitCommit | null;
  onOpenFileDiff: (filePath: string) => void;
  onSelectParent?: (hash: string) => void;
}

const SPLIT_KEY = 'easygit.commitDetail.splitRatio';

function readSplitRatio(): number {
  try {
    const raw = localStorage.getItem(SPLIT_KEY);
    const n = raw ? Number(raw) : 0.4;
    if (!Number.isFinite(n)) return 0.4;
    return Math.min(0.72, Math.max(0.22, n));
  } catch {
    return 0.4;
  }
}

function FileTree({ files, onOpen }: { files: GitCommit['files']; onOpen: (path: string) => void }) {
  const groups = new Map<string, GitCommit['files']>();
  files.forEach(file => {
    const normalized = file.path.replace(/\\/g, '/');
    const slash = normalized.lastIndexOf('/');
    const dir = slash >= 0 ? normalized.slice(0, slash) : '.';
    groups.set(dir, [...(groups.get(dir) || []), file]);
  });
  return (
    <div className="space-y-2">
      {Array.from(groups.entries()).map(([dir, items]) => (
        <div key={dir}>
          <div className="px-2 py-1 text-[11px] text-jb-text-muted font-mono flex items-center space-x-1 min-w-0">
            <Folder className="w-3 h-3 shrink-0" />
            <FilePathDisplay path={dir} className="flex-1" />
          </div>
          {items.map(file => (
            <button key={file.path} onClick={() => onOpen(file.path)} className="w-full text-left px-6 py-1 hover:bg-jb-hover min-w-0">
              <FilePathDisplay path={file.filename} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export const CommitDetail: React.FC<CommitDetailProps> = ({
  commit,
  onOpenFileDiff,
  onSelectParent,
}) => {
  const [isTreeView, setIsTreeView] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [splitRatio, setSplitRatio] = useState(readSplitRatio);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SPLIT_KEY, String(splitRatio));
    } catch {
      /* 浏览器禁止本地存储时，宽度只在当前会话有效 */
    }
  }, [splitRatio]);

  const startDrag = (event: React.MouseEvent) => {
    event.preventDefault();
    const move = (ev: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const next = (ev.clientX - rect.left) / rect.width;
      setSplitRatio(Math.min(0.72, Math.max(0.22, next)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!commit) {
    return (
      <div className="h-48 border-t border-[#303236] bg-[#1E1F22] flex items-center justify-center text-xs text-[#8C9099]">
        选择一个提交以查看详细信息和修改文件
      </div>
    );
  }

  const getStatusBadge = (status: FileChangeStatus) => {
    switch (status) {
      case 'modified':
        return <span className="text-[10px] font-bold text-blue-400 font-mono px-1 bg-blue-500/10 rounded">M</span>;
      case 'added':
        return <span className="text-[10px] font-bold text-emerald-400 font-mono px-1 bg-emerald-500/10 rounded">A</span>;
      case 'deleted':
        return <span className="text-[10px] font-bold text-rose-400 font-mono px-1 bg-rose-500/10 rounded line-through">D</span>;
      default:
        return <span className="text-[10px] font-bold text-amber-400 font-mono px-1">?</span>;
    }
  };

  if (isCollapsed) {
    return (
      <div className="h-7 border-t border-[#303236] bg-[#1E1F22] px-3 flex items-center justify-between text-xs select-none shrink-0">
        <div className="flex items-center space-x-2 truncate">
          <span className="font-mono text-blue-400 font-medium">{commit.shortHash}</span>
          <span className="text-[#DFE1E5] truncate font-medium">{commit.subject}</span>
          <span className="text-[#8C9099] text-[11px]">({commit.files.length} 个文件)</span>
        </div>
        <button
          onClick={() => setIsCollapsed(false)}
          className="flex items-center space-x-1 text-[#8C9099] hover:text-[#DFE1E5] px-1.5 py-0.5 rounded hover:bg-[#2B2D30] text-[11px]"
        >
          <span>展开详情</span>
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="h-56 border-t border-[#303236] bg-[#1E1F22] flex flex-col text-xs select-none shrink-0 relative">
      <div ref={containerRef} className="flex-1 flex min-h-0 min-w-0">
        <div
          style={{ width: `calc((100% - 6px) * ${splitRatio})` }}
          className="min-w-0 p-3 flex flex-col justify-between overflow-y-auto"
        >
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-sm text-[#DFE1E5] leading-snug">
                {commit.subject}
              </div>
              <button
                onClick={() => setIsCollapsed(true)}
                title="折叠详情面板"
                className="p-1 rounded text-[#8C9099] hover:text-[#DFE1E5] hover:bg-[#2B2D30] shrink-0"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {commit.body && (
              <div className="text-jb-text-secondary whitespace-pre-wrap font-sans text-xs bg-jb-bg/60 p-2 rounded border border-jb-border/60">
                {commit.body}
              </div>
            )}

            <div className="space-y-1 text-jb-text-muted pt-1 text-[11px] font-mono">
              <div className="flex items-center space-x-2">
                <span className="w-16 text-jb-text-secondary">Author:</span>
                <span className="text-jb-text-primary">{commit.author} &lt;{commit.authorEmail}&gt;</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-16 text-jb-text-secondary">Date:</span>
                <span className="text-jb-text-primary">{commit.date} ({commit.relativeDate})</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-16 text-jb-text-secondary">Commit:</span>
                <span className="text-jb-blue">{commit.hash}</span>
              </div>
              {commit.parents.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="w-16 text-jb-text-secondary">Parents:</span>
                  <div className="flex space-x-1.5">
                    {commit.parents.map(p => (
                      <button
                        key={p}
                        onClick={() => onSelectParent?.(p)}
                        title={`跳转到父提交 ${p}`}
                        className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 hover:underline"
                      >
                        {p.slice(0, 8)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={Math.round(splitRatio * 100)}
          title="拖拽调整左右宽度"
          onMouseDown={startDrag}
          className="w-1.5 shrink-0 cursor-col-resize bg-[#303236] hover:bg-[#3574F0] active:bg-[#3574F0]"
        />

        <div className="flex-1 min-w-0 flex flex-col bg-jb-bg/40">
          <div className="h-8 px-3 border-b border-jb-border flex items-center justify-between bg-jb-panel/80">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-jb-text-primary">Changed Files</span>
              <span className="px-1.5 py-0.2 bg-jb-bg rounded-full text-[10px] text-jb-text-muted font-mono border border-jb-border">
                {commit.files.length}
              </span>
            </div>

            <div className="flex items-center space-x-1">
              <button
                onClick={() => setIsTreeView(!isTreeView)}
                title={isTreeView ? "切换到扁平列表" : "切换到目录树"}
                className="p-1 rounded hover:bg-jb-hover text-jb-text-secondary"
              >
                {isTreeView ? <List className="w-3.5 h-3.5" /> : <FolderTree className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            {isTreeView ? (
              <FileTree files={commit.files} onOpen={onOpenFileDiff} />
            ) : commit.files.map((file) => (
              <div
                key={file.path}
                onDoubleClick={() => onOpenFileDiff(file.path)}
                onClick={() => onOpenFileDiff(file.path)}
                className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-jb-hover/80 cursor-pointer group text-xs transition-colors"
              >
                <div className="flex items-center space-x-2 min-w-0 flex-1">
                  {getStatusBadge(file.status)}
                  <FileText className="w-3.5 h-3.5 text-jb-text-muted shrink-0" />
                  <FilePathDisplay
                    path={file.path}
                    className="flex-1"
                    filenameClassName={file.status === 'deleted' ? 'line-through' : ''}
                  />
                </div>

                <div className="flex items-center space-x-2 shrink-0 font-mono text-[11px]">
                  {file.additions > 0 && (
                    <span className="text-jb-green">+{file.additions}</span>
                  )}
                  {file.deletions > 0 && (
                    <span className="text-jb-red">-{file.deletions}</span>
                  )}
                  <button 
                    title="查看该提交的 Diff"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFileDiff(file.path);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-jb-blue transition-opacity"
                  >
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
