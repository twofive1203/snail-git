import React, { useEffect, useState } from 'react';
import { FileChange, DiffChunk } from '../../types/git';
import { 
  Columns, 
  AlignJustify, 
  ChevronUp, 
  ChevronDown, 
  Check, 
  X, 
  ChevronsRight, 
  Settings, 
  Code2, 
  CheckSquare, 
  Square 
} from 'lucide-react';

interface SideBySideDiffProps {
  file: FileChange | null;
  onToggleChunkStage: (chunkId: string) => void;
  onRevertChunk: (chunkId: string) => void;
}

export const SideBySideDiff: React.FC<SideBySideDiffProps> = ({
  file,
  onToggleChunkStage,
  onRevertChunk,
}) => {
  const [isUnified, setIsUnified] = useState(false);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const chunks = file?.chunks ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F7' || chunks.length === 0) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      setCurrentChunkIndex((idx) => e.shiftKey
        ? Math.max(0, idx - 1)
        : Math.min(chunks.length - 1, idx + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chunks.length]);

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center bg-jb-bg text-jb-text-muted text-xs">
        Select a file to inspect diff
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-jb-bg overflow-hidden select-none">
      {/* 顶部 Diff 工具条 */}
      <div className="h-9 px-3 border-b border-jb-border bg-jb-panel flex items-center justify-between text-xs">
        {/* 左侧：文件路径与对比基准 */}
        <div className="flex items-center space-x-2 min-w-0">
          <Code2 className="w-4 h-4 text-jb-blue shrink-0" />
          <span className="font-mono text-jb-text-primary font-medium truncate">
            {file.path}
          </span>
          <span className="text-[11px] text-jb-text-muted font-sans hidden md:inline">
            (HEAD vs Working Tree)
          </span>
        </div>

        {/* 中间/右侧：Diff 交互控制器 */}
        <div className="flex items-center space-x-1.5">
          {/* 上一处/下一处差异 */}
          <div className="flex items-center bg-jb-bg rounded border border-jb-border p-0.5">
            <button
              onClick={() => setCurrentChunkIndex(Math.max(0, currentChunkIndex - 1))}
              disabled={currentChunkIndex <= 0}
              title="Previous Difference (Shift+F7)"
              className="p-1 rounded hover:bg-jb-hover disabled:opacity-30 text-jb-text-secondary hover:text-jb-text-primary"
            >
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 text-[11px] font-mono text-jb-text-muted">
              {chunks.length > 0 ? `${currentChunkIndex + 1}/${chunks.length}` : '0/0'}
            </span>
            <button
              onClick={() => setCurrentChunkIndex(Math.min(chunks.length - 1, currentChunkIndex + 1))}
              disabled={currentChunkIndex >= chunks.length - 1}
              title="Next Difference (F7)"
              className="p-1 rounded hover:bg-jb-hover disabled:opacity-30 text-jb-text-secondary hover:text-jb-text-primary"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-4 w-px bg-jb-border mx-1" />

          {/* 忽略空格切换 */}
          <button
            onClick={() => setIgnoreWhitespace(!ignoreWhitespace)}
            className={`px-2 py-1 rounded text-[11px] border transition-colors ${
              ignoreWhitespace 
                ? 'bg-jb-blue/20 text-jb-blue border-jb-blue/40 font-medium' 
                : 'bg-jb-bg text-jb-text-secondary border-jb-border hover:bg-jb-hover'
            }`}
            title="Ignore Whitespace - 忽略缩进与换行符变动"
          >
            Ignore Whitespace
          </button>

          {/* 双栏 vs 单栏切换 */}
          <div className="flex items-center bg-jb-bg rounded border border-jb-border p-0.5">
            <button
              onClick={() => setIsUnified(false)}
              className={`p-1 rounded ${!isUnified ? 'bg-jb-selected text-white' : 'text-jb-text-muted hover:text-jb-text-primary'}`}
              title="Side-by-Side Viewer (双栏视图)"
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsUnified(true)}
              className={`p-1 rounded ${isUnified ? 'bg-jb-selected text-white' : 'text-jb-text-muted hover:text-jb-text-primary'}`}
              title="Unified Viewer (单栏合并视图)"
            >
              <AlignJustify className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Diff 内容视图区域 */}
      <div className="flex-1 overflow-auto font-mono text-xs text-jb-text-code">
        {chunks.length === 0 ? (
          <div className="p-8 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
              <Code2 className="w-5 h-5" />
            </div>
            <div className="text-sm font-medium text-jb-text-primary">
              {file.status === 'untracked' ? '未进行版本管理的新文件 (Untracked File)' : '全新文件或二进制文件'}
            </div>
            <div className="text-xs text-jb-text-muted max-w-md font-sans leading-relaxed">
              {file.chunksLoaded === false
                ? '正在读取差异…'
                : '勾选该文件前面的复选框后，EasyGit 将执行 git add 并纳入本次提交。'}
            </div>
            <div className="pt-2">
              <span className={`px-2.5 py-1 rounded text-xs font-mono font-medium border ${
                file.isStaged 
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm' 
                  : 'bg-jb-panel text-jb-text-muted border-jb-border'
              }`}>
                {file.isStaged ? '✓ 已加入本次提交队列 (Staged)' : '○ 未勾选 (本次不会提交)'}
              </span>
            </div>
          </div>
        ) : (
          chunks.map((chunk, cIdx) => (
            <div 
              key={chunk.id} 
              className={`border-y border-jb-border/40 my-2 ${
                cIdx === currentChunkIndex ? 'ring-1 ring-jb-blue/40 bg-jb-blue/5' : ''
              }`}
            >
              {/* Chunk 头部操作条 (IDEA 核心：行级/块级提交控制器) */}
              <div className="bg-jb-panel/90 px-3 py-1 flex items-center justify-between border-b border-jb-border/50 text-[11px]">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => onToggleChunkStage(chunk.id)}
                    className="flex items-center space-x-1 text-jb-blue hover:text-jb-blueHover focus:outline-none"
                    title="勾选/取消此块提交 (Partial Commit)"
                  >
                    {chunk.isStaged ? (
                      <CheckSquare className="w-3.5 h-3.5" />
                    ) : (
                      <Square className="w-3.5 h-3.5 text-jb-text-muted" />
                    )}
                    <span className="font-sans font-medium">
                      {chunk.isStaged ? 'Staged Chunk' : 'Unstaged Chunk'}
                    </span>
                  </button>
                  <span className="text-jb-text-muted">
                    @@ -{chunk.oldStart},{chunk.oldLines} +{chunk.newStart},{chunk.newLines} @@
                  </span>
                </div>

                <div className="flex items-center space-x-1.5">
                  <button
                    onClick={() => onToggleChunkStage(chunk.id)}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded bg-jb-blue/15 hover:bg-jb-blue/25 text-jb-blue border border-jb-blue/30"
                    title="将本代码块应用到提交中"
                  >
                    <ChevronsRight className="w-3 h-3" />
                    <span>Apply Chunk</span>
                  </button>

                  <button
                    onClick={() => onRevertChunk(chunk.id)}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded bg-jb-red/15 hover:bg-jb-red/25 text-jb-red border border-jb-red/30"
                    title="丢弃/回滚此代码块修改"
                  >
                    <X className="w-3 h-3" />
                    <span>Rollback</span>
                  </button>
                </div>
              </div>

              {/* 逐行比对 */}
              <div className="divide-y divide-jb-border/20">
                {chunk.lines.map((line, lIdx) => {
                  const isAdd = line.type === 'added';
                  const isDel = line.type === 'deleted';
                  const isMod = line.type === 'modified';

                  return (
                    <div 
                      key={lIdx}
                      className={`grid grid-cols-[1fr,40px,1fr] min-h-[20px] leading-5 items-stretch ${
                        isAdd ? 'bg-emerald-950/25' :
                        isDel ? 'bg-rose-950/25' :
                        isMod ? 'bg-blue-950/25' : ''
                      }`}
                    >
                      {/* 左侧旧行 */}
                      <div className={`flex border-r border-jb-border/40 ${isDel ? 'bg-rose-950/30 text-rose-200' : ''}`}>
                        <div className="w-10 px-2 text-right text-jb-text-muted bg-jb-panel/30 select-none border-r border-jb-border/30">
                          {line.oldLineNumber || ''}
                        </div>
                        <div className="px-3 whitespace-pre overflow-x-auto flex-1">
                          {line.oldContent || ''}
                        </div>
                      </div>

                      {/* 中间操作小槽 */}
                      <div className="flex items-center justify-center bg-jb-panel/40 border-r border-jb-border/40 select-none">
                        {isAdd && <span className="text-jb-green font-bold text-xs">+</span>}
                        {isDel && <span className="text-jb-red font-bold text-xs">-</span>}
                      </div>

                      {/* 右侧新行 */}
                      <div className={`flex ${isAdd ? 'bg-emerald-950/30 text-emerald-200' : ''}`}>
                        <div className="w-10 px-2 text-right text-jb-text-muted bg-jb-panel/30 select-none border-r border-jb-border/30">
                          {line.newLineNumber || ''}
                        </div>
                        <div className="px-3 whitespace-pre overflow-x-auto flex-1">
                          {line.wordDiff ? (
                            <span>
                              {line.wordDiff.map((w, wIdx) => (
                                <span 
                                  key={wIdx} 
                                  className="bg-emerald-500/30 text-emerald-100 rounded px-0.5 border border-emerald-500/50"
                                >
                                  {w.text}
                                </span>
                              ))}
                            </span>
                          ) : (
                            line.newContent || ''
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
