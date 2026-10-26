import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileChange, DiffLine } from '../../types/git';
import { FilePathDisplay } from '../common/FilePathDisplay';
import { 
  Columns, 
  AlignJustify, 
  ChevronUp, 
  ChevronDown, 
  ChevronsRight, 
  Code2, 
  Undo2,
} from 'lucide-react';
import { useI18n } from '../../i18n/react';

interface SideBySideDiffProps {
  file: FileChange | null;
  onToggleChunkStage: (chunkId: string) => void;
  onRevertChunk: (chunkId: string) => void;
  readOnly?: boolean;
  baselineLabel?: string;
  ignoreWhitespace?: boolean;
  onIgnoreWhitespaceChange?: (value: boolean) => void;
}

interface DiffRow {
  key: string;
  chunkIndex: number;
  chunkId: string;
  isStaged: boolean;
  isFirst: boolean;
  isLast: boolean;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  line: DiffLine;
}

function WordText({ spans, side }: { spans: NonNullable<DiffLine['wordDiff']>; side: 'old' | 'new' }) {
  return (
    <span>
      {spans.map((part, index) => (
        <span
          key={index}
          className={part.type === 'same'
            ? ''
            : side === 'old'
              ? 'bg-rose-500/40 text-rose-50 rounded-sm'
              : 'bg-emerald-500/40 text-emerald-50 rounded-sm'}
        >
          {part.text}
        </span>
      ))}
    </span>
  );
}

function activeShadow(active: boolean, isFirst: boolean, isLast: boolean, stagedLeft: boolean): React.CSSProperties | undefined {
  const parts: string[] = [];
  if (active) parts.push('inset 0 0 0 9999px rgba(53,116,240,0.07)');
  if (active && isFirst) parts.push('inset 0 1px 0 0 rgba(53,116,240,0.5)');
  if (active && isLast) parts.push('inset 0 -1px 0 0 rgba(53,116,240,0.5)');
  if (stagedLeft) parts.push('inset 2px 0 0 0 rgba(89,168,105,0.75)');
  if (parts.length === 0) return undefined;
  return { boxShadow: parts.join(', ') };
}

function lineTone(line: DiffLine, pane: 'left' | 'right'): string {
  const isAdd = line.type === 'added';
  const isDel = line.type === 'deleted';
  const isMod = line.type === 'modified';
  if (pane === 'left') {
    if (isDel || isMod) return 'bg-rose-950/35 text-rose-100';
    if (isAdd) return 'bg-emerald-950/10';
    return '';
  }
  if (isAdd || isMod) return 'bg-emerald-950/35 text-emerald-100';
  if (isDel) return 'bg-rose-950/10';
  return '';
}

function PaneLineInner({
  row,
  pane,
  active,
  lineRef,
}: {
  row: DiffRow;
  pane: 'left' | 'right';
  active: boolean;
  lineRef?: (node: HTMLDivElement | null) => void;
}) {
  const line = row.line;
  const content = pane === 'left' ? (line.oldContent || '') : (line.newContent || '');
  const wordDiff = pane === 'left' ? line.oldWordDiff : line.wordDiff;
  const lineNumber = pane === 'left' ? line.oldLineNumber : line.newLineNumber;

  return (
    <div
      ref={lineRef}
      data-chunk-index={row.chunkIndex}
      className={`flex h-5 leading-5 shrink-0 ${lineTone(line, pane)}`}
      style={activeShadow(active, row.isFirst, row.isLast, pane === 'left' && row.isStaged)}
    >
      <div className="sticky left-0 z-10 w-10 shrink-0 px-1 text-right text-jb-text-muted bg-jb-panel border-r border-jb-border/40 select-none">
        {lineNumber || ''}
      </div>
      <div className="whitespace-pre px-3">
        {wordDiff ? <WordText spans={wordDiff} side={pane === 'left' ? 'old' : 'new'} /> : content}
      </div>
    </div>
  );
}

function GutterLineInner({
  row,
  active,
  showActions,
  onStage,
  onRevert,
}: {
  row: DiffRow;
  active: boolean;
  showActions: boolean;
  onStage: (chunkId: string) => void;
  onRevert: (chunkId: string) => void;
}) {
  const { t } = useI18n();
  const isAdd = row.line.type === 'added';
  const isDel = row.line.type === 'deleted';
  const isMod = row.line.type === 'modified';
  const tone = isAdd ? 'bg-emerald-950/10' : isDel ? 'bg-rose-950/10' : isMod ? 'bg-blue-950/15' : '';

  return (
    <div
      data-chunk-index={row.chunkIndex}
      title={row.isFirst ? `@@ -${row.oldStart},${row.oldLines} +${row.newStart},${row.newLines} @@` : undefined}
      className={`relative h-5 shrink-0 ${tone} ${showActions ? 'z-20' : ''}`}
      style={activeShadow(active, row.isFirst, row.isLast, false)}
    >
      {showActions && (
        <div className="absolute left-1/2 top-0.5 z-20 -translate-x-1/2 flex flex-col gap-0.5">
          <button
            onClick={() => onStage(row.chunkId)}
            title={t(row.isStaged ? 'diff.unstageChunk' : 'diff.stageChunk', {
              oldStart: row.oldStart,
              oldLines: row.oldLines,
              newStart: row.newStart,
              newLines: row.newLines,
            })}
            className="w-5 h-5 rounded border border-jb-blue/40 bg-jb-panel/95 text-jb-blue hover:bg-jb-blue/20 flex items-center justify-center shadow-sm"
          >
            <ChevronsRight className="w-3 h-3" />
          </button>
          <button
            onClick={() => onRevert(row.chunkId)}
            title={t('diff.revertChunk')}
            className="w-5 h-5 rounded border border-rose-500/40 bg-jb-panel/95 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center shadow-sm"
          >
            <Undo2 className="w-3 h-3" />
          </button>
        </div>
      )}
      {row.isFirst && (
        <span className="pointer-events-none absolute top-0 inset-x-0 text-center text-[8px] leading-none text-[#6F737A] font-mono">@@</span>
      )}
      <div className="h-5 flex items-center justify-center select-none">
        {isAdd && <span className="text-jb-green font-bold text-xs leading-none">+</span>}
        {isDel && <span className="text-jb-red font-bold text-xs leading-none">-</span>}
        {isMod && <span className="text-jb-blue font-bold text-xs leading-none">~</span>}
      </div>
    </div>
  );
}

// 行渲染占了 diff 面板的绝大部分开销：侧栏模式一次就有 rows×3 个节点，
// hover 换块 / 切换当前差异都会让父组件重渲，包成 memo 后只有真正变了的行才重建。
const PaneLine = React.memo(PaneLineInner);
const GutterLine = React.memo(GutterLineInner);

export const SideBySideDiff: React.FC<SideBySideDiffProps> = ({
  file,
  onToggleChunkStage,
  onRevertChunk,
  readOnly = false,
  baselineLabel,
  ignoreWhitespace: ignoreWhitespaceProp,
  onIgnoreWhitespaceChange,
}) => {
  const { t } = useI18n();
  const baseline = baselineLabel ?? t('diff.baseline');
  const [isUnified, setIsUnified] = useState(false);
  const [ignoreWhitespaceLocal, setIgnoreWhitespaceLocal] = useState(false);
  const ignoreWhitespace = ignoreWhitespaceProp ?? ignoreWhitespaceLocal;
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [hoveredChunk, setHoveredChunk] = useState<number | null>(null);
  const chunkRefs = useRef<Array<HTMLDivElement | null>>([]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const unifiedRef = useRef<HTMLDivElement>(null);
  const syncLock = useRef(false);
  // 回调包一层稳定的 ref 转发：父组件每次渲染传进来的都是新箭头函数，
  // 直接当 props 传下去会让 GutterLine 的 memo 完全失效。
  const chunksSource = file?.chunks;
  const chunks = useMemo(() => {
    const source = chunksSource ?? [];
    if (!ignoreWhitespace) return source;
    // 显示层过滤，不再为了 -w 重跑 git。空白块藏起来，原始 patch 仍留在未过滤的数据上。
    return source.flatMap(chunk => {
      const lines = chunk.lines.flatMap(line => {
        if (line.type === 'added' || line.type === 'deleted') {
          const text = line.type === 'added' ? line.newContent : line.oldContent;
          return (text ?? '').trim() === '' ? [] : [line];
        }
        if (line.type === 'modified') {
          const oldNorm = (line.oldContent ?? '').replace(/\s+/g, '');
          const newNorm = (line.newContent ?? '').replace(/\s+/g, '');
          if (oldNorm === newNorm) {
            return [{ ...line, type: 'unchanged' as const, wordDiff: undefined, oldWordDiff: undefined }];
          }
        }
        return [line];
      });
      if (!lines.some(line => line.type !== 'unchanged')) return [];
      return [{ ...chunk, lines }];
    });
  }, [chunksSource, ignoreWhitespace]);
  const rows = useMemo(() => {
    const next: DiffRow[] = [];
    chunks.forEach((chunk, chunkIndex) => {
      chunk.lines.forEach((line, lineIndex) => {
        next.push({
          key: `${chunk.id}-${lineIndex}`,
          chunkIndex,
          chunkId: chunk.id,
          isStaged: chunk.isStaged,
          isFirst: lineIndex === 0,
          isLast: lineIndex === chunk.lines.length - 1,
          oldStart: chunk.oldStart,
          oldLines: chunk.oldLines,
          newStart: chunk.newStart,
          newLines: chunk.newLines,
          line,
        });
      });
    });
    return next;
  }, [chunks]);

  const stageRef = useRef(onToggleChunkStage);
  const revertRef = useRef(onRevertChunk);
  useEffect(() => {
    stageRef.current = onToggleChunkStage;
    revertRef.current = onRevertChunk;
  });
  const stageChunk = useCallback((chunkId: string) => stageRef.current(chunkId), []);
  const revertChunk = useCallback((chunkId: string) => revertRef.current(chunkId), []);

  useEffect(() => {
    setCurrentChunkIndex(0);
    setHoveredChunk(null);
    for (const el of [leftRef.current, rightRef.current, gutterRef.current, unifiedRef.current]) {
      if (!el) continue;
      el.scrollTop = 0;
      el.scrollLeft = 0;
    }
  }, [file?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F7' || chunks.length === 0) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      e.preventDefault();
      setCurrentChunkIndex((idx) => e.shiftKey
        ? Math.max(0, idx - 1)
        : Math.min(chunks.length - 1, idx + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chunks.length]);

  useEffect(() => {
    const node = chunkRefs.current[currentChunkIndex];
    const scroller = isUnified ? unifiedRef.current : rightRef.current;
    if (!node || !scroller) return;
    const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const delta = top - Math.max(24, (scroller.clientHeight - node.clientHeight) / 3);
    scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'smooth' });
  }, [currentChunkIndex, file?.id, isUnified, chunks.length]);

  // 左右是两个窗口：横滚按相同像素互相同步；纵滚三列一起走，避免增删行错位。
  // 锁放到微任务再放开，挡住赋值触发的同步 scroll 回声，避免一侧滚到底后把另一侧拽回来。
  const syncFrom = (source: 'left' | 'right' | 'gutter') => {
    if (syncLock.current) return;
    const left = leftRef.current;
    const right = rightRef.current;
    const gutter = gutterRef.current;
    if (!left || !right || !gutter) return;
    const from = source === 'left' ? left : source === 'right' ? right : gutter;
    syncLock.current = true;
    const y = from.scrollTop;
    if (left.scrollTop !== y) left.scrollTop = y;
    if (right.scrollTop !== y) right.scrollTop = y;
    if (gutter.scrollTop !== y) gutter.scrollTop = y;
    if (source !== 'gutter') {
      const x = from.scrollLeft;
      if (left.scrollLeft !== x) left.scrollLeft = x;
      if (right.scrollLeft !== x) right.scrollLeft = x;
    }
    queueMicrotask(() => {
      syncLock.current = false;
    });
  };

  const onPaneMouseOver = (event: React.MouseEvent) => {
    const el = (event.target as HTMLElement).closest('[data-chunk-index]');
    const raw = el?.getAttribute('data-chunk-index');
    const next = raw == null ? null : Number(raw);
    setHoveredChunk(prev => (prev === next ? prev : next));
  };

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center bg-jb-bg text-jb-text-muted text-xs">
        {t('diff.selectFile')}
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
          <FilePathDisplay path={file.path} className="flex-1 min-w-0" />
          <span className="text-[11px] text-jb-text-muted font-sans hidden md:inline">
            ({baseline})
          </span>
        </div>

        {/* 中间/右侧：Diff 交互控制器 */}
        <div className="flex items-center space-x-1.5">
          {/* 上一处/下一处差异 */}
          <div className="flex items-center bg-jb-bg rounded border border-jb-border p-0.5">
            <button
              onClick={() => setCurrentChunkIndex(Math.max(0, currentChunkIndex - 1))}
              disabled={currentChunkIndex <= 0}
              title={t('diff.prev')}
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
              title={t('diff.next')}
              className="p-1 rounded hover:bg-jb-hover disabled:opacity-30 text-jb-text-secondary hover:text-jb-text-primary"
            >
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-4 w-px bg-jb-border mx-1" />

          {/* 忽略空格切换 */}
          <button
            onClick={() => {
              const next = !ignoreWhitespace;
              setIgnoreWhitespaceLocal(next);
              onIgnoreWhitespaceChange?.(next);
            }}
            className={`px-2 py-1 rounded text-[11px] border transition-colors ${
              ignoreWhitespace 
                ? 'bg-jb-blue/20 text-jb-blue border-jb-blue/40 font-medium' 
                : 'bg-jb-bg text-jb-text-secondary border-jb-border hover:bg-jb-hover'
            }`}
            title={t('diff.ignoreWhitespaceTitle')}
          >
            {t('diff.ignoreWhitespace')}
          </button>

          {/* 双栏 vs 单栏切换 */}
          <div className="flex items-center bg-jb-bg rounded border border-jb-border p-0.5">
            <button
              onClick={() => setIsUnified(false)}
              className={`p-1 rounded ${!isUnified ? 'bg-jb-selected text-white' : 'text-jb-text-muted hover:text-jb-text-primary'}`}
              title={t('diff.sideBySide')}
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsUnified(true)}
              className={`p-1 rounded ${isUnified ? 'bg-jb-selected text-white' : 'text-jb-text-muted hover:text-jb-text-primary'}`}
              title={t('diff.unified')}
            >
              <AlignJustify className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Diff 内容视图区域 */}
      {chunks.length === 0 ? (
        <div className="flex-1 overflow-auto font-mono text-xs text-jb-text-code">
          <div className="p-8 flex flex-col items-center justify-center text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
              <Code2 className="w-5 h-5" />
            </div>
            <div className="text-sm font-medium text-jb-text-primary">
              {file.status === 'untracked' ? t('diff.untracked') : t('diff.binaryOrNew')}
            </div>
            <div className="text-xs text-jb-text-muted max-w-md font-sans leading-relaxed">
              {file.chunksLoaded === false
                ? t('diff.loading')
                : t('diff.stageHint')}
            </div>
            <div className="pt-2">
              <span className={`px-2.5 py-1 rounded text-xs font-mono font-medium border ${
                file.isStaged 
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm' 
                  : 'bg-jb-panel text-jb-text-muted border-jb-border'
              }`}>
                {file.isStaged ? t('diff.staged') : t('diff.unstaged')}
              </span>
            </div>
          </div>
        </div>
      ) : isUnified ? (
        <div ref={unifiedRef} className="flex-1 min-h-0 min-w-0 overflow-x-scroll overflow-y-auto overscroll-contain font-mono text-xs text-jb-text-code">
          <div className="flex flex-col w-max min-w-full">
            {chunks.map((chunk, cIdx) => (
              <div
                key={chunk.id}
                ref={(node) => { chunkRefs.current[cIdx] = node; }}
                className={`relative group/chunk ${
                  cIdx === currentChunkIndex ? 'bg-jb-blue/[0.07] ring-1 ring-inset ring-jb-blue/30' : ''
                }`}
                style={chunk.isStaged ? { boxShadow: 'inset 2px 0 0 0 rgba(89,168,105,0.75)' } : undefined}
              >
                {!readOnly && (
                  <div className="absolute top-0.5 left-20 z-20 flex flex-col gap-0.5 opacity-0 pointer-events-none group-hover/chunk:opacity-100 group-hover/chunk:pointer-events-auto">
                    <button
                      onClick={() => onToggleChunkStage(chunk.id)}
                      title={t(chunk.isStaged ? 'diff.unstageChunk' : 'diff.stageChunk', {
                        oldStart: chunk.oldStart,
                        oldLines: chunk.oldLines,
                        newStart: chunk.newStart,
                        newLines: chunk.newLines,
                      })}
                      className="w-5 h-5 rounded border border-jb-blue/40 bg-jb-panel/95 text-jb-blue hover:bg-jb-blue/20 flex items-center justify-center shadow-sm"
                    >
                      <ChevronsRight className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => onRevertChunk(chunk.id)}
                      title={t('diff.revertChunk')}
                      className="w-5 h-5 rounded border border-rose-500/40 bg-jb-panel/95 text-rose-300 hover:bg-rose-500/20 flex items-center justify-center shadow-sm"
                    >
                      <Undo2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
                {chunk.lines.map((line, lIdx) => {
                  const isAdd = line.type === 'added';
                  const isDel = line.type === 'deleted';
                  const isMod = line.type === 'modified';
                  const tone = isAdd ? 'bg-emerald-950/25 text-emerald-200' : isDel ? 'bg-rose-950/25 text-rose-200' : isMod ? 'bg-blue-950/25' : '';
                  return (
                    <div key={lIdx} className={`flex h-5 leading-5 shrink-0 ${tone}`}>
                      <div className="sticky left-0 z-10 flex shrink-0">
                        <div className="w-12 px-2 text-right text-jb-text-muted bg-jb-panel border-r border-jb-border/40 select-none">
                          {line.oldLineNumber || ''}
                        </div>
                        <div className="w-12 px-2 text-right text-jb-text-muted bg-jb-panel border-r border-jb-border/40 select-none">
                          {line.newLineNumber || ''}
                        </div>
                      </div>
                      <div className="whitespace-pre px-3">
                        <span className="inline-block w-4 text-jb-text-muted">{isAdd ? '+' : isDel ? '-' : ' '}</span>
                        {line.wordDiff ? <WordText spans={line.wordDiff} side="new" /> : (line.newContent ?? line.oldContent ?? '')}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div
          className="flex-1 min-h-0 min-w-0 flex overflow-hidden font-mono text-xs text-jb-text-code"
          onMouseOver={onPaneMouseOver}
          onMouseLeave={() => setHoveredChunk(null)}
        >
          <div
            ref={leftRef}
            onScroll={() => syncFrom('left')}
            className="diff-pane-sync diff-pane-sync-hide-y flex-1 min-w-0 min-h-0"
          >
            <div className="flex flex-col w-max min-w-full">
              {rows.map(row => (
                <PaneLine
                  key={row.key}
                  row={row}
                  pane="left"
                  active={row.chunkIndex === currentChunkIndex}
                />
              ))}
            </div>
          </div>

          <div className="w-10 shrink-0 flex flex-col min-h-0 border-x border-jb-border/40">
            <div
              ref={gutterRef}
              onScroll={() => syncFrom('gutter')}
              className="diff-gutter-sync flex-1 min-h-0"
            >
              {rows.map(row => (
                <GutterLine
                  key={row.key}
                  row={row}
                  active={row.chunkIndex === currentChunkIndex}
                  showActions={!readOnly && row.isFirst && hoveredChunk === row.chunkIndex}
                  onStage={stageChunk}
                  onRevert={revertChunk}
                />
              ))}
            </div>
            <div className="diff-scrollbar-spacer bg-jb-bg" />
          </div>

          <div
            ref={rightRef}
            onScroll={() => syncFrom('right')}
            className="diff-pane-sync flex-1 min-w-0 min-h-0"
          >
            <div className="flex flex-col w-max min-w-full">
              {rows.map(row => (
                <PaneLine
                  key={row.key}
                  row={row}
                  pane="right"
                  active={row.chunkIndex === currentChunkIndex}
                  lineRef={row.isFirst ? (node) => { chunkRefs.current[row.chunkIndex] = node; } : undefined}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
