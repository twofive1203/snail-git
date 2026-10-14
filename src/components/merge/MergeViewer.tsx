import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Pencil,
  RotateCcw,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import {
  acceptBoth,
  acceptFile,
  acceptSide,
  applyNonConflicting,
  chunkResult,
  createSession,
  hasConflictMarkers,
  isUnresolved,
  keepBase,
  resolveSimpleConflicts,
  clearManual,
  resolveUsing,
  resultText,
  revertNonConflicting,
  setManual,
  setSideState,
  summarize,
  wordDiffAfter,
  type MergeChunk,
  type MergeSession,
  type ResultSource,
  type SideState,
  type WordSpan,
} from './threeWayMerge';

export interface MergeViewerHandle {
  save: () => void;
}

export interface MergeViewerStats {
  unresolved: number;
  conflicts: number;
  dirty: boolean;
}

interface MergeViewerProps {
  base: string;
  ours: string;
  theirs: string;
  working?: string;
  sessionKey: string;
  loading?: boolean;
  onSave: (content: string) => void;
  onStats?: (stats: MergeViewerStats) => void;
}

type Tone = 'plain' | 'added' | 'deleted' | 'modified' | 'conflict' | 'applied-left' | 'applied-right' | 'applied-both' | 'pending' | 'manual' | 'spacer';

interface Cell {
  key: string;
  text: string;
  lineNo: number | null;
  tone: Tone;
  words: WordSpan[] | null;
}

const COLS = 'minmax(0,1fr) 40px minmax(0,1fr) 40px minmax(0,1fr)';

function lineWidth(text: string): number {
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 255 ? 12.5 : 7.2;
  return width + 56;
}
const DISPLAY_CAP = 280;

const TONE_CLASS: Record<Tone, string> = {
  plain: '',
  added: 'bg-[#2C4A34] shadow-[inset_3px_0_0_#59A869]',
  deleted: 'bg-[#4A3032] text-[#E7B7BC] line-through decoration-[#E35967]/70 shadow-[inset_3px_0_0_#E35967]',
  modified: 'bg-[#2A4060] shadow-[inset_3px_0_0_#4C8DFF]',
  conflict: 'bg-[#5A3236] shadow-[inset_3px_0_0_#E35967]',
  'applied-left': 'bg-[#2A4060]/90 shadow-[inset_3px_0_0_#4C8DFF]',
  'applied-right': 'bg-[#2C4A34]/90 shadow-[inset_3px_0_0_#59A869]',
  'applied-both': 'bg-[#3E3A28] shadow-[inset_3px_0_0_#EDA200]',
  pending: 'bg-[#3A3424] text-[#C8C2B0] shadow-[inset_3px_0_0_#EDA200]',
  manual: 'bg-[#243844] shadow-[inset_3px_0_0_#29B6F6]',
  spacer: 'bg-black/15',
};

function wordClass(tone: Tone): string {
  if (tone === 'conflict' || tone === 'applied-both') return 'bg-[#FF8A84]/45 rounded-[2px]';
  if (tone === 'applied-right' || tone === 'added') return 'bg-[#8FD694]/40 rounded-[2px]';
  return 'bg-[#8EBEFF]/45 rounded-[2px]';
}

function sourceLabel(source: ResultSource, chunk: MergeChunk): string {
  if (source === 'manual') return '已手动编辑';
  if (source === 'simple') return '已简单合并';
  if (source === 'both') return '两边都保留，请检查顺序';
  if (source === 'left') return chunk.kind === 'right' ? '保留基准' : '已采用左侧';
  if (source === 'right') return '已采用右侧';
  if (source === 'base' && chunk.kind !== 'context') return chunk.kind === 'conflict' ? '未处理，结果仍是基准' : '已忽略，保留基准';
  return '';
}

function LineCell({ cell, onDoubleClick }: { cell: Cell; onDoubleClick?: () => void }) {
  return (
    <div
      onDoubleClick={onDoubleClick}
      title={cell.text.length > 180 ? cell.text : undefined}
      className={`flex h-full min-h-[22px] min-w-0 overflow-hidden text-[12px] leading-[22px] ${TONE_CLASS[cell.tone]} ${cell.tone === 'spacer' ? 'pointer-events-none' : ''}`}
    >
      <span className="w-11 shrink-0 pr-2 text-right text-[10px] leading-[22px] text-[#6F737A] select-none tabular-nums">
        {cell.tone === 'deleted' && cell.lineNo == null ? '−' : cell.lineNo ?? ''}
      </span>
      <span className="pr-3 whitespace-pre select-text">
        {cell.words
          ? cell.words.map((part, index) => (
            <span key={index} className={part.type === 'add' ? wordClass(cell.tone) : undefined}>{part.text}</span>
          ))
          : cell.text || (cell.tone === 'spacer' ? '' : '\u00a0')}
      </span>
    </div>
  );
}

function GutterButton({
  active,
  title,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  title: string;
  tone: 'accept' | 'ignore';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const on = tone === 'accept'
    ? 'bg-[#3574F0] text-white border-[#3574F0]'
    : 'bg-[#E35967]/25 text-[#FFD0D4] border-[#E35967]/60';
  const off = 'bg-[#1E1F22] text-[#9DA0A8] border-[#393B40] hover:text-white hover:border-[#4E5157]';
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-6 h-6 rounded flex items-center justify-center border ${active ? on : off}`}
    >
      {children}
    </button>
  );
}

function ActButton({
  children,
  title,
  onClick,
  disabled,
  active,
  accent,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  accent?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`px-1.5 py-0.5 rounded border text-[11px] disabled:opacity-35 disabled:cursor-not-allowed ${
        active
          ? accent || 'bg-[#3574F0]/25 text-[#9EC1FF] border-[#3574F0]/50'
          : 'border-[#393B40] bg-[#1E1F22]/70 text-[#C2C5CC] hover:bg-[#35373C] hover:text-white'
      }`}
    >
      {children}
    </button>
  );
}

function sideCells(chunk: MergeChunk, side: 'left' | 'right'): Cell[] {
  const changed = side === 'left'
    ? chunk.kind === 'left' || chunk.kind === 'conflict' || chunk.kind === 'same'
    : chunk.kind === 'right' || chunk.kind === 'conflict' || chunk.kind === 'same';
  const ownLines = side === 'left' ? chunk.leftLines : chunk.rightLines;
  const lineStart = side === 'left' ? chunk.leftLineStart : chunk.rightLineStart;
  if (!changed) {
    return chunk.baseLines.map((text, index) => ({
      key: `${side}-base-${index}`,
      text,
      lineNo: lineStart + index,
      tone: 'plain',
      words: null,
    }));
  }
  if (ownLines.length === 0 && chunk.baseLines.length > 0) {
    return chunk.baseLines.map((text, index) => ({
      key: `${side}-del-${index}`,
      text,
      lineNo: null,
      tone: 'deleted' as Tone,
      words: null,
    }));
  }
  const tone: Tone = chunk.kind === 'conflict' ? 'conflict' : chunk.baseLines.length === 0 ? 'added' : 'modified';
  return ownLines.map((text, index) => ({
    key: `${side}-${index}`,
    text,
    lineNo: lineStart + index,
    tone,
    words: chunk.baseLines[index] !== undefined ? wordDiffAfter(chunk.baseLines[index], text) : null,
  }));
}

function resultCells(chunk: MergeChunk, lines: string[], source: ResultSource, resultStart: number): Cell[] {
  if (lines.length === 0 && chunk.kind !== 'context') {
    return [{
      key: 'result-empty',
      text: source === 'base' ? '基准中此处没有内容' : '已删除',
      lineNo: null,
      tone: 'deleted',
      words: null,
    }];
  }
  const tone: Tone = source === 'manual'
    ? 'manual'
    : source === 'both'
      ? 'applied-both'
      : source === 'right'
        ? 'applied-right'
        : source === 'left' || source === 'simple'
          ? 'applied-left'
          : source === 'base' && chunk.kind !== 'context'
            ? 'pending'
            : 'plain';
  return lines.map((text, index) => ({
    key: `result-${index}`,
    text,
    lineNo: resultStart + index,
    tone,
    words: tone === 'plain' || tone === 'pending' || source === 'both' || chunk.baseLines[index] === undefined
      ? null
      : wordDiffAfter(chunk.baseLines[index] ?? '', text),
  }));
}

function padCells(cells: Cell[], count: number, prefix: string): Cell[] {
  const next = cells.slice(0, count);
  while (next.length < count) {
    next.push({ key: `${prefix}-${next.length}`, text: '', lineNo: null, tone: 'spacer', words: null });
  }
  return next;
}

const ChunkView = React.memo(function ChunkView({
  chunk,
  resultStart,
  active,
  expanded,
  showBase,
  editing,
  onActivate,
  onToggleExpand,
  onEdit,
  onChange,
}: {
  chunk: MergeChunk;
  resultStart: number;
  active: boolean;
  expanded: boolean;
  showBase: boolean;
  editing: boolean;
  onActivate: (id: string) => void;
  onToggleExpand: (id: string) => void;
  onEdit: (id: string | null) => void;
  onChange: (id: string, recipe: (chunk: MergeChunk) => MergeChunk) => void;
}) {
  const [draft, setDraft] = useState('');
  const result = chunkResult(chunk);
  const unresolved = isUnresolved(chunk);

  useEffect(() => {
    if (editing) setDraft(result.lines.join('\n'));
  }, [editing, chunk.id]);

  if (chunk.kind === 'context') {
    const lines = chunk.baseLines;
    const folded = !expanded && lines.length > 8;
    const head = folded ? lines.slice(0, 2) : lines;
    const tail = folded ? lines.slice(-2) : [];
    const renderSlice = (slice: string[], offset: number) => slice.map((text, index) => {
      const cell: Cell = {
        key: `ctx-${offset + index}`,
        text,
        lineNo: chunk.leftLineStart + offset + index,
        tone: 'plain',
        words: null,
      };
      const resultCell: Cell = { ...cell, key: `ctx-r-${offset + index}`, lineNo: resultStart + offset + index };
      return (
        <div key={cell.key} className="grid w-full" style={{ gridTemplateColumns: COLS }}>
          <LineCell cell={cell} />
          <div className="border-x border-[#393B40]/30" />
          <LineCell cell={resultCell} />
          <div className="border-x border-[#393B40]/30" />
          <LineCell cell={{ ...cell, key: `ctx-t-${offset + index}` }} />
        </div>
      );
    });
    return (
      <div>
        {renderSlice(head, 0)}
        {folded && (
          <button
            type="button"
            onClick={() => onToggleExpand(chunk.id)}
            className="w-full py-0.5 text-[11px] text-[#6F737A] hover:text-[#DFE1E5] hover:bg-[#35373C] border-y border-[#393B40]/70"
          >
            展开其余 {lines.length - 4} 行未改动
          </button>
        )}
        {renderSlice(tail, lines.length - tail.length)}
        {expanded && lines.length > 8 && (
          <button
            type="button"
            onClick={() => onToggleExpand(chunk.id)}
            className="w-full py-0.5 text-[11px] text-[#6F737A] hover:text-[#DFE1E5]"
          >
            折叠未改动
          </button>
        )}
      </div>
    );
  }

  const left = sideCells(chunk, 'left');
  const right = sideCells(chunk, 'right');
  const middle = resultCells(chunk, result.lines, result.source, resultStart);
  const count = Math.max(left.length, right.length, middle.length, 1);
  const truncated = count > DISPLAY_CAP;
  const visible = truncated ? DISPLAY_CAP : count;
  const rows = Array.from({ length: visible }, (_, index) => ({
    left: padCells(left, visible, 'l')[index],
    result: padCells(middle, visible, 'm')[index],
    right: padCells(right, visible, 'r')[index],
  }));
  const leftChanged = chunk.kind === 'left' || chunk.kind === 'conflict' || chunk.kind === 'same';
  const rightChanged = chunk.kind === 'right' || chunk.kind === 'conflict' || chunk.kind === 'same';
  const bar = chunk.kind === 'conflict'
    ? unresolved ? 'bg-[#5A3236] border-[#E35967]/45' : 'bg-[#2C4A34]/70 border-[#59A869]/35'
    : chunk.kind === 'left'
      ? 'bg-[#2A4060]/70 border-[#4C8DFF]/30'
      : chunk.kind === 'right'
        ? 'bg-[#2C4A34]/70 border-[#59A869]/30'
        : 'bg-[#3A3050]/70 border-[#B388FF]/30';

  const clickSide = (side: 'left' | 'right', state: SideState) => {
    const current = side === 'left' ? chunk.leftState : chunk.rightState;
    onChange(chunk.id, currentChunk => setSideState(currentChunk, side, current === state ? 'pending' : state));
  };

  return (
    <div
      data-chunk={chunk.id}
      onClick={() => onActivate(chunk.id)}
      className={`border-b border-[#393B40]/80 ${active ? 'shadow-[inset_0_0_0_1px_#3574F0]' : ''}`}
    >
      <div className={`px-2 py-1 flex items-center gap-1.5 flex-wrap text-[11px] border-y ${bar}`}>
        <span className={`font-semibold ${chunk.kind === 'conflict' ? 'text-[#FFB4B8]' : 'text-[#DFE1E5]'}`}>
          {chunk.kind === 'conflict' ? (unresolved ? '冲突' : '冲突已处理') : chunk.kind === 'same' ? '两边相同' : chunk.baseLines.length === 0 ? '新增' : (chunk.kind === 'left' ? chunk.leftLines : chunk.rightLines).length === 0 ? '删除' : '修改'}
        </span>
        <span className="text-[#6F737A]">
          {chunk.kind === 'left' ? 'Your' : chunk.kind === 'right' ? 'Theirs' : 'Base'} {chunk.baseStart + 1}
          {chunk.baseEnd > chunk.baseStart ? `–${chunk.baseEnd}` : ''}
        </span>
        <span className="text-[#C2C5CC]">{sourceLabel(result.source, chunk)}</span>
        <div className="ml-auto flex items-center gap-1">
          {chunk.kind === 'conflict' && (
            <>
              <ActButton title="采用左侧并忽略右侧 (Alt+1)" onClick={() => onChange(chunk.id, current => resolveUsing(current, 'left'))} active={chunk.leftState === 'accepted' && chunk.rightState === 'ignored'}>
                采用左侧
              </ActButton>
              <ActButton title="采用右侧并忽略左侧 (Alt+2)" onClick={() => onChange(chunk.id, current => resolveUsing(current, 'right'))} active={chunk.rightState === 'accepted' && chunk.leftState === 'ignored'} accent="bg-[#59A869]/20 text-[#B7E0C0] border-[#59A869]/40">
                采用右侧
              </ActButton>
              <ActButton title="两边都放进结果，之后可以再编辑 (Alt+3)" onClick={() => onChange(chunk.id, current => acceptBoth(current, false))} active={chunk.leftState === 'accepted' && chunk.rightState === 'accepted' && !chunk.useSimple}>
                两边都要
              </ActButton>
              <ActButton
                title="同一行两端互不重叠时，合并成一行"
                disabled={!chunk.simple}
                onClick={() => onChange(chunk.id, current => acceptBoth(current, true))}
                active={chunk.useSimple}
                accent="bg-purple-500/20 text-purple-200 border-purple-400/40"
              >
                简单合并
              </ActButton>
            </>
          )}
          <ActButton title="这一块保留基准版本 (Alt+4)" onClick={() => onChange(chunk.id, keepBase)} active={result.source === 'base'}>
            保留基准
          </ActButton>
          <ActButton title="只编辑这一块的结果。双击中间栏也可以" onClick={() => onEdit(editing ? null : chunk.id)} active={editing}>
            <span className="inline-flex items-center gap-1"><Pencil className="w-3 h-3" />编辑</span>
          </ActButton>
          {chunk.manual && (
            <ActButton title="放弃手动编辑，恢复到采用或忽略后的结果" onClick={() => onChange(chunk.id, clearManual)}>
              撤销编辑
            </ActButton>
          )}
        </div>
      </div>
      {showBase && chunk.baseLines.length > 0 && (
        <div className="px-3 py-1 bg-black/25 text-[11px] leading-5 text-[#9DA0A8] font-mono whitespace-pre border-b border-[#393B40]/60">
          <div className="text-[10px] tracking-wide text-[#6F737A] mb-0.5">BASE</div>
          {chunk.baseLines.slice(0, 6).map((line, index) => <div key={index}>{line || ' '}</div>)}
          {chunk.baseLines.length > 6 && <div className="text-[#6F737A]">… 还有 {chunk.baseLines.length - 6} 行基准</div>}
        </div>
      )}
      {editing && (
        <div className="p-2 bg-[#1E1F22] border-b border-[#3574F0]/40">
          <textarea
            value={draft}
            onChange={event => setDraft(event.target.value)}
            spellCheck={false}
            className="w-full min-h-[88px] max-h-64 p-2 bg-[#1E1F22] border border-[#393B40] rounded text-[12px] leading-5 font-mono text-[#DFE1E5] focus:outline-none focus:border-[#3574F0]"
          />
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                onChange(chunk.id, current => setManual(current, draft.split('\n')));
                onEdit(null);
              }}
              className="px-2 py-1 rounded bg-[#3574F0] text-white text-[11px]"
            >
              应用到结果
            </button>
            <button type="button" onClick={() => onEdit(null)} className="px-2 py-1 rounded border border-[#393B40] text-[11px] text-[#C2C5CC]">
              取消
            </button>
          </div>
        </div>
      )}
      <div className="grid w-full" style={{ gridTemplateColumns: COLS }}>
        {rows.map((row, index) => (
          <React.Fragment key={`${row.left.key}-${row.result.key}-${row.right.key}`}>
            <div className="h-full" style={{ gridColumn: 1, gridRow: index + 1 }}>
              <LineCell cell={row.left} />
            </div>
            <div className="h-full" style={{ gridColumn: 3, gridRow: index + 1 }}>
              <LineCell cell={row.result} onDoubleClick={() => onEdit(chunk.id)} />
            </div>
            <div className="h-full" style={{ gridColumn: 5, gridRow: index + 1 }}>
              <LineCell cell={row.right} />
            </div>
          </React.Fragment>
        ))}
        <div className="flex flex-col items-center gap-1 py-1 border-x border-[#393B40]/50 bg-[#26282B]" style={{ gridColumn: 2, gridRow: `1 / span ${visible}` }}>
          {leftChanged && chunk.kind !== 'same' && (
            <>
              <GutterButton active={chunk.leftState === 'accepted'} tone="accept" title="采用左侧。再点一次撤销" onClick={() => clickSide('left', 'accepted')}>
                <ArrowRight className="w-3.5 h-3.5" />
              </GutterButton>
              <GutterButton active={chunk.leftState === 'ignored'} tone="ignore" title="忽略左侧。再点一次撤销" onClick={() => clickSide('left', 'ignored')}>
                <X className="w-3 h-3" />
              </GutterButton>
            </>
          )}
        </div>
        <div className="flex flex-col items-center gap-1 py-1 border-x border-[#393B40]/50 bg-[#26282B]" style={{ gridColumn: 4, gridRow: `1 / span ${visible}` }}>
          {rightChanged && chunk.kind !== 'same' && (
            <>
              <GutterButton active={chunk.rightState === 'accepted'} tone="accept" title="采用右侧。再点一次撤销" onClick={() => clickSide('right', 'accepted')}>
                <ArrowLeft className="w-3.5 h-3.5" />
              </GutterButton>
              <GutterButton active={chunk.rightState === 'ignored'} tone="ignore" title="忽略右侧。再点一次撤销" onClick={() => clickSide('right', 'ignored')}>
                <X className="w-3 h-3" />
              </GutterButton>
            </>
          )}
        </div>
      </div>
      {truncated && (
        <div className="px-3 py-1 text-[11px] text-[#EDA200] bg-[#3A3424]">
          这一块有 {count} 行，视图只展示前 {DISPLAY_CAP} 行。可以用采用左侧 / 采用右侧，或编辑处理全文。
        </div>
      )}
    </div>
  );
});

function FallbackPanel({
  session,
  onSave,
  onText,
}: {
  session: MergeSession;
  onSave: (content: string) => void;
  onText: (text: string) => void;
}) {
  const [text, setText] = useState(session.mode === 'raw' ? session.ours : session.ours || session.theirs);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  useEffect(() => {
    const next = session.mode === 'raw' ? session.ours : session.ours || session.theirs;
    setText(next);
    onTextRef.current(next);
  }, [session]);
  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
      <div className="text-sm text-[#DFE1E5]">{session.note}</div>
      {session.mode !== 'raw' && (
        <div className="flex items-center gap-2">
          <button type="button" disabled={!session.ours && session.mode === 'binary'} onClick={() => onSave(session.ours)} className="px-3 py-1.5 rounded bg-[#3574F0] text-white text-xs disabled:opacity-40">
            整份采用左侧
          </button>
          <button type="button" disabled={!session.theirs && session.mode === 'binary'} onClick={() => onSave(session.theirs)} className="px-3 py-1.5 rounded bg-purple-500/30 text-purple-100 border border-purple-400/40 text-xs disabled:opacity-40">
            整份采用右侧
          </button>
        </div>
      )}
      {session.mode !== 'binary' && (
        <textarea
          value={text}
          onChange={event => {
            setText(event.target.value);
            onText(event.target.value);
          }}
          spellCheck={false}
          className="flex-1 min-h-0 w-full p-3 bg-[#1E1F22] border border-[#393B40] rounded font-mono text-xs leading-5 text-[#DFE1E5] focus:outline-none focus:border-[#3574F0]"
        />
      )}
      {session.mode !== 'binary' && (
        <button type="button" onClick={() => onSave(text)} className="self-start px-3 py-1.5 rounded bg-[#3574F0] text-white text-xs">
          保存当前文本并标记已解决
        </button>
      )}
    </div>
  );
}

export const MergeViewer = forwardRef<MergeViewerHandle, MergeViewerProps>(function MergeViewer({
  base,
  ours,
  theirs,
  working = '',
  sessionKey,
  loading = false,
  onSave,
  onStats,
}, ref) {
  const session = useMemo(() => createSession(base, ours, theirs, working), [base, ours, theirs, working, sessionKey]);
  const [chunks, setChunks] = useState<MergeChunk[]>(session.chunks);
  const [rawMode, setRawMode] = useState(false);
  const [raw, setRaw] = useState('');
  const [showBase, setShowBase] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ask, setAsk] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const initialRef = useRef(session.chunks);

  useEffect(() => {
    initialRef.current = session.chunks;
    setChunks(session.chunks);
    setRawMode(false);
    setRaw('');
    setEditingId(null);
    setAsk(null);
    setExpanded(new Set());
    const first = session.chunks.find(chunk => chunk.kind === 'conflict') || session.chunks.find(chunk => chunk.kind !== 'context');
    setActiveId(first?.id ?? null);
  }, [session]);

  const stats = useMemo(() => summarize(chunks), [chunks]);
  const dirty = rawMode || chunks.some((chunk, index) => {
    const origin = initialRef.current[index];
    return !origin || origin.leftState !== chunk.leftState || origin.rightState !== chunk.rightState || origin.useSimple !== chunk.useSimple || chunk.manual !== null;
  });

  useEffect(() => {
    onStats?.({ unresolved: Math.max(0, stats.unresolved - stats.pendingNonConflict), conflicts: stats.conflicts, dirty });
  }, [stats.unresolved, stats.conflicts, dirty, onStats]);

  const resultStarts = useMemo(() => {
    const starts: number[] = [];
    let cursor = 1;
    for (const chunk of chunks) {
      starts.push(cursor);
      cursor += chunkResult(chunk).lines.length;
    }
    return starts;
  }, [chunks]);

  const conflicts = chunks.filter(chunk => chunk.kind === 'conflict');
  const unresolved = conflicts.filter(isUnresolved);
  const changes = chunks.filter(chunk => chunk.kind !== 'context');
  const f7List = unresolved.length ? unresolved : changes;
  const contentMinWidth = useMemo(() => {
    let max = 300;
    for (const chunk of chunks) {
      const lines = [...chunk.baseLines, ...chunk.leftLines, ...chunk.rightLines, ...chunkResult(chunk).lines];
      for (const line of lines) max = Math.max(max, lineWidth(line));
    }
    return Math.min(max, 1100) * 3 + 80;
  }, [chunks]);

  const jump = (list: MergeChunk[], delta: number) => {
    if (!list.length) return;
    const index = list.findIndex(chunk => chunk.id === activeId);
    const start = index < 0 ? (delta > 0 ? -1 : list.length) : index;
    const next = list[Math.min(list.length - 1, Math.max(0, start + delta))];
    if (!next) return;
    setActiveId(next.id);
    setEditingId(null);
  };

  useEffect(() => {
    const scroller = scrollerRef.current;
    const node = scroller?.querySelector(`[data-chunk="${activeId}"]`) as HTMLElement | null;
    if (!scroller || !node) return;
    const top = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 72;
    scroller.scrollTo({ top: scroller.scrollTop + top, behavior: 'smooth' });
  }, [activeId, sessionKey]);

  const fallbackText = useRef(session.ours);
  const save = () => {
    if (session.mode === 'binary') {
      setAsk('二进制文件不能按行合并，请使用下方的整份采用左侧或右侧。');
      return;
    }
    if (session.mode !== 'merge') {
      onSave(fallbackText.current);
      return;
    }
    const text = resultText(session, chunks, rawMode ? raw : null);
    const openConflicts = Math.max(0, stats.unresolved - stats.pendingNonConflict);
    if ((!rawMode && stats.unresolved > 0) || hasConflictMarkers(text)) {
      const reason = hasConflictMarkers(text)
        ? '结果里还留着冲突标记。'
        : openConflicts > 0
          ? `还有 ${openConflicts} 处冲突没选择采用哪一侧。`
          : `还有 ${stats.pendingNonConflict} 处无冲突改动未处理。`;
      setAsk(`${reason}仍要按当前结果保存并标记已解决吗？`);
      return;
    }
    onSave(text);
  };

  useImperativeHandle(ref, () => ({ save }), [session, chunks, rawMode, raw, stats.unresolved, onSave]);

  const keyRef = useRef({ save, jump, f7List, chunks, activeId });
  keyRef.current = { save, jump, f7List, chunks, activeId };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;
      const current = keyRef.current;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        current.save();
        return;
      }
      if (typing) return;
      if (event.key === 'F7') {
        event.preventDefault();
        current.jump(current.f7List, event.shiftKey ? -1 : 1);
        return;
      }
      if (!event.altKey || !['1', '2', '3', '4'].includes(event.key)) return;
      const chunk = current.chunks.find(item => item.id === current.activeId);
      if (!chunk || chunk.kind === 'context') return;
      event.preventDefault();
      const prefer = (side: 'left' | 'right') => (item: MergeChunk) => {
        if (item.kind === 'conflict') return resolveUsing(item, side);
        if (item.kind === 'same') return item;
        return item.kind === side ? acceptSide(item, side) : keepBase(item);
      };
      const recipe = event.key === '1' ? prefer('left') : event.key === '2' ? prefer('right') : event.key === '3' ? (item: MergeChunk) => acceptBoth(item, false) : keepBase;
      setChunks(prev => prev.map(item => item.id === chunk.id ? recipe(item) : item));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const update = React.useCallback((id: string, recipe: (chunk: MergeChunk) => MergeChunk) => {
    setChunks(prev => prev.map(chunk => chunk.id === id ? recipe(chunk) : chunk));
  }, []);
  const toggleExpand = React.useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const pendingLeft = chunks.some(chunk => chunk.kind === 'left' && chunk.leftState === 'pending');
  const pendingRight = chunks.some(chunk => chunk.kind === 'right' && chunk.rightState === 'pending');
  const appliedNonConflict = chunks.some(chunk => (
    (chunk.kind === 'left' && chunk.leftState === 'accepted') || (chunk.kind === 'right' && chunk.rightState === 'accepted')
  ));

  if (session.mode !== 'merge') {
    return (
      <div className="flex-1 flex flex-col min-h-0 relative">
        {ask && (
          <div className="px-3 py-2 bg-[#3A3424] border-b border-[#EDA200]/40 text-[12px] text-[#F3E2B3] flex items-center gap-2">
            <span className="flex-1">{ask}</span>
            <button type="button" onClick={() => setAsk(null)} className="px-2 py-1 rounded border border-[#EDA200]/40">知道了</button>
          </div>
        )}
        <FallbackPanel session={session} onSave={onSave} onText={text => { fallbackText.current = text; }} />
        {loading && <div className="absolute inset-0 bg-black/35 flex items-center justify-center text-sm text-white">正在读取冲突…</div>}
      </div>
    );
  }

  const focusIndex = Math.max(0, f7List.findIndex(chunk => chunk.id === activeId));

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 bg-[#1E1F22] relative">
      <div className="px-2 py-1.5 border-b border-[#393B40] bg-[#2B2D30] flex items-center gap-1.5 flex-wrap text-[11px]">
        <div className="flex items-center rounded border border-[#393B40] bg-[#1E1F22]">
          <button type="button" title="上一处未解决冲突 (Shift+F7)" disabled={focusIndex <= 0} onClick={() => jump(f7List, -1)} className="p-1 disabled:opacity-30 hover:bg-[#35373C]">
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <span className="px-1.5 font-mono text-[#DFE1E5] min-w-[92px] text-center" title="F7 下一处，Shift+F7 上一处">
            {unresolved.length ? `冲突 ${Math.min(focusIndex + 1, unresolved.length)}/${unresolved.length}` : `变更 ${changes.length ? focusIndex + 1 : 0}/${changes.length}`}
          </span>
          <button type="button" title="下一处未解决冲突 (F7)" disabled={!f7List.length || focusIndex >= f7List.length - 1} onClick={() => jump(f7List, 1)} className="p-1 disabled:opacity-30 hover:bg-[#35373C]">
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
        {conflicts.length > 0 && (
          <select
            value={conflicts.some(chunk => chunk.id === activeId) ? activeId ?? '' : ''}
            onChange={event => setActiveId(event.target.value)}
            className="bg-[#1E1F22] border border-[#393B40] rounded px-1.5 py-1 text-[11px] text-[#DFE1E5] max-w-[220px]"
            title="跳到某一处冲突"
          >
            <option value="" disabled>跳到冲突</option>
            {conflicts.map(chunk => (
              <option key={chunk.id} value={chunk.id}>
                {isUnresolved(chunk) ? '未解决' : '已解决'} · 第 {chunk.baseStart + 1} 行
              </option>
            ))}
          </select>
        )}
        <div className="h-4 w-px bg-[#393B40]" />
        <div className="flex items-center rounded border border-[#393B40] overflow-hidden">
          <button type="button" disabled={!pendingLeft} title="只应用左侧不与右侧重叠的改动" onClick={() => setChunks(prev => applyNonConflicting(prev, 'left'))} className="px-2 py-1 hover:bg-[#35373C] disabled:opacity-35">
            Left
          </button>
          <button
            type="button"
            disabled={!pendingLeft && !pendingRight}
            title={pendingLeft || pendingRight
              ? '应用所有不重叠的改动。真正重叠的冲突不会被自动选边，需要逐块确认。'
              : '无冲突改动已经自动放进结果。若要逐块复查，点 Revert。'}
            onClick={() => setChunks(prev => applyNonConflicting(prev, 'all'))}
            className={`px-2 py-1 border-x border-[#393B40] inline-flex items-center gap-1 disabled:cursor-default ${pendingLeft || pendingRight ? 'bg-purple-500/20 text-purple-100 hover:bg-purple-500/30' : appliedNonConflict ? 'bg-[#2C4A34]/50 text-[#8FD694]' : 'text-[#9DA0A8] disabled:opacity-35'}`}
          >
            <Sparkles className="w-3 h-3" />
            {pendingLeft || pendingRight ? 'Apply All Non-Conflicting' : appliedNonConflict ? '无冲突已应用' : 'Apply All Non-Conflicting'}
          </button>
          <button type="button" disabled={!pendingRight} title="只应用右侧不与左侧重叠的改动" onClick={() => setChunks(prev => applyNonConflicting(prev, 'right'))} className="px-2 py-1 hover:bg-[#35373C] disabled:opacity-35">
            Right
          </button>
        </div>
        <button
          type="button"
          disabled={stats.simpleReady === 0}
          title="合并同一行里互不重叠的修改。这种冲突不会被 Apply All Non-Conflicting 自动处理。"
          onClick={() => setChunks(prev => resolveSimpleConflicts(prev))}
          className="px-2 py-1 rounded border border-purple-400/40 bg-purple-500/15 text-purple-100 disabled:opacity-35 inline-flex items-center gap-1"
        >
          <Sparkles className="w-3 h-3" />
          Resolve Simple{stats.simpleReady ? ` (${stats.simpleReady})` : ''}
        </button>
        <button type="button" title="整份采用你的版本" onClick={() => setChunks(prev => acceptFile(prev, 'left'))} className="px-2 py-1 rounded border border-[#3574F0]/40 text-[#9EC1FF] hover:bg-[#3574F0]/15">
          Accept Yours
        </button>
        <button type="button" title="整份采用对方版本" onClick={() => setChunks(prev => acceptFile(prev, 'right'))} className="px-2 py-1 rounded border border-purple-400/40 text-purple-200 hover:bg-purple-500/15">
          Accept Theirs
        </button>
        <button type="button" disabled={!appliedNonConflict} title="把已自动应用的无冲突改动退回未处理，方便逐块复查" onClick={() => setChunks(prev => revertNonConflicting(prev))} className="px-2 py-1 rounded border border-[#393B40] text-[#C2C5CC] hover:bg-[#35373C] disabled:opacity-35 inline-flex items-center gap-1">
          <Undo2 className="w-3 h-3" />
          Revert
        </button>
        <button type="button" title="恢复打开文件时的选择" onClick={() => { setChunks(initialRef.current); setRawMode(false); }} className="p-1 rounded border border-[#393B40] text-[#9DA0A8] hover:bg-[#35373C]" >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <button type="button" title="在冲突块里显示基准版本" onClick={() => setShowBase(value => !value)} className={`px-2 py-1 rounded border inline-flex items-center gap-1 ${showBase ? 'border-[#3574F0]/50 text-[#9EC1FF] bg-[#3574F0]/15' : 'border-[#393B40] text-[#C2C5CC]'}`}>
          {showBase ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          Base
        </button>
        <button
          type="button"
          title="离开逐块视图，直接编辑完整结果"
          onClick={() => {
            if (rawMode) {
              setRawMode(false);
              return;
            }
            setRaw(resultText(session, chunks, null));
            setRawMode(true);
          }}
          className={`px-2 py-1 rounded border ${rawMode ? 'border-[#3574F0]/50 text-[#9EC1FF]' : 'border-[#393B40] text-[#C2C5CC] hover:bg-[#35373C]'}`}
        >
          {rawMode ? '回到对齐合并' : 'Edit Result'}
        </button>
      </div>
      <div className="px-3 py-1 border-b border-[#393B40]/80 flex items-center gap-3 flex-wrap text-[10px] text-[#9DA0A8] bg-[#232428]">
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 bg-[#2A4060] shadow-[inset_2px_0_0_#4C8DFF]" />修改</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 bg-[#2C4A34] shadow-[inset_2px_0_0_#59A869]" />新增</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 bg-[#4A3032] shadow-[inset_2px_0_0_#E35967]" />删除</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 bg-[#5A3236] shadow-[inset_2px_0_0_#E35967]" />冲突</span>
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 bg-[#3A3424] shadow-[inset_2px_0_0_#EDA200]" />未应用</span>
        <span className="ml-auto">
          {stats.unresolved - stats.pendingNonConflict > 0
            ? <span className="text-[#FFB4B8]">{stats.unresolved - stats.pendingNonConflict} 处冲突未处理</span>
            : stats.pendingNonConflict > 0
              ? <span className="text-[#EDA200]">{stats.pendingNonConflict} 处无冲突改动未应用</span>
              : <span className="text-[#8FD694]">冲突已处理，可以保存</span>}
          <span className="text-[#6F737A]"> · F7 跳转 · Alt+1/2 采用左/右 · &gt;&gt; 采用 · × 忽略</span>
        </span>
      </div>
      {ask && (
        <div className="px-3 py-2 bg-[#3A3424] border-b border-[#EDA200]/40 text-[12px] text-[#F3E2B3] flex items-center gap-2">
          <span className="flex-1">{ask}</span>
          {session.mode === 'merge' && ask.includes('保存') && (
            <button
              type="button"
              onClick={() => {
                const text = resultText(session, chunks, rawMode ? raw : null);
                setAsk(null);
                onSave(text);
              }}
              className="px-2 py-1 rounded bg-[#EDA200] text-[#1E1F22] font-medium"
            >
              仍然保存
            </button>
          )}
          <button type="button" onClick={() => setAsk(null)} className="px-2 py-1 rounded border border-[#EDA200]/40">
            返回处理
          </button>
        </div>
      )}
      {rawMode ? (
        <textarea
          value={raw}
          onChange={event => setRaw(event.target.value)}
          spellCheck={false}
          className="flex-1 min-h-0 w-full p-3 bg-[#1E1F22] text-[#DFE1E5] font-mono text-xs leading-5 resize-none focus:outline-none"
        />
      ) : (
        <div ref={scrollerRef} className="flex-1 overflow-auto min-h-0">
          <div className="min-w-full" style={{ minWidth: contentMinWidth }}>
            <div className="sticky top-0 z-10 grid w-full border-b border-[#393B40] bg-[#2B2D30] text-xs" style={{ gridTemplateColumns: COLS }}>
              <div className="h-8 px-3 flex items-center justify-between">
                <span className="font-semibold text-[#4C8DFF]">Your Version</span>
                <button type="button" title="整份采用左侧" onClick={() => setChunks(prev => acceptFile(prev, 'left'))} className="px-1.5 py-0.5 rounded bg-[#3574F0]/15 text-[#9EC1FF] inline-flex items-center gap-1 text-[11px]">
                  整份采用 <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              <div className="border-x border-[#393B40]/60" />
              <div className="h-8 px-3 flex items-center gap-1.5 font-semibold text-[#8FD694]">
                Result
              </div>
              <div className="border-x border-[#393B40]/60" />
              <div className="h-8 px-3 flex items-center justify-between">
                <button type="button" title="整份采用右侧" onClick={() => setChunks(prev => acceptFile(prev, 'right'))} className="px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-200 inline-flex items-center gap-1 text-[11px]">
                  <ArrowLeft className="w-3 h-3" /> 整份采用
                </button>
                <span className="font-semibold text-purple-300">Their Version</span>
              </div>
            </div>
            {chunks.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#6F737A]">左右版本没有可显示的内容。</div>
            ) : chunks.every(chunk => chunk.kind === 'context') ? (
              <div className="p-6 text-center text-sm text-[#9DA0A8]">左右相对基准没有差异，可以直接保存并标记已解决。</div>
            ) : null}
            {chunks.map((chunk, index) => (
              <ChunkView
                key={chunk.id}
                chunk={chunk}
                resultStart={resultStarts[index] ?? 1}
                active={chunk.id === activeId}
                expanded={expanded.has(chunk.id)}
                showBase={showBase}
                editing={editingId === chunk.id}
                onActivate={setActiveId}
                onToggleExpand={toggleExpand}
                onEdit={setEditingId}
                onChange={update}
              />
            ))}
          </div>
        </div>
      )}
      {loading && (
        <div className="absolute inset-0 bg-black/35 flex items-center justify-center text-sm text-white">
          正在读取冲突…
        </div>
      )}
    </div>
  );
});
