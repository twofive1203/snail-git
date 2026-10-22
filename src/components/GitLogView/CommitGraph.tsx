import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GitCommit } from '../../types/git';
import { 
  GitBranch, 
  Tag, 
  Copy, 
  Scissors, 
  Undo2, 
  RotateCcw, 
  PlusCircle, 
  Check, 
  FileDiff,
  Combine,
} from 'lucide-react';
import { askConfirm } from '../common/askConfirm';
import { useI18n } from '../../i18n/react';
import { inspectSquashSelection, type SquashIssue } from './squashSelection';
import {
  GraphLayout,
  GraphLink,
  TRACK_COLORS,
  graphColumnWidth,
  laneCenter,
  layoutGraph,
} from './graphLayout';

type RefKind = 'head' | 'tag' | 'remote' | 'local';

interface ParsedRef {
  kind: RefKind;
  label: string;
  title: string;
}

function parseRef(ref: string): ParsedRef {
  if (ref.startsWith('HEAD -> ')) {
    return { kind: 'head', label: ref.slice('HEAD -> '.length), title: ref };
  }
  if (ref === 'HEAD') {
    return { kind: 'head', label: 'HEAD', title: ref };
  }
  if (ref.startsWith('tag: ')) {
    return { kind: 'tag', label: ref.slice('tag: '.length), title: ref };
  }
  if (ref.includes('origin/') || ref.startsWith('remotes/')) {
    return { kind: 'remote', label: ref.replace(/^remotes\//, ''), title: ref };
  }
  return { kind: 'local', label: ref, title: ref };
}

function RefBadge({ item, onContextMenu }: { item: ParsedRef; onContextMenu?: (event: React.MouseEvent) => void }) {
  const badgeClass = item.kind === 'head'
    ? 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40 font-semibold'
    : item.kind === 'tag'
      ? 'bg-amber-500/25 text-amber-300 border-amber-500/40'
      : item.kind === 'remote'
        ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
        : 'bg-blue-500/20 text-blue-300 border-blue-500/40';

  return (
    <span
      title={item.title}
      onContextMenu={onContextMenu}
      className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 max-w-[200px] overflow-hidden inline-flex items-center gap-1 font-mono ${badgeClass}`}
    >
      {item.kind === 'head' ? (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
      ) : item.kind === 'tag' ? (
        <Tag className="w-2.5 h-2.5 shrink-0" />
      ) : (
        <GitBranch className="w-2.5 h-2.5 shrink-0" />
      )}
      <span className="truncate">{item.label}</span>
    </span>
  );
}

interface CommitGraphProps {
  commits: GitCommit[];
  selectedHash: string;
  focusToken?: number;
  onSelectCommit: (commit: GitCommit) => void;
  onViewDiff: (commit: GitCommit) => void;
  onCheckout?: (hash: string) => void;
  onCherryPick?: (hash: string) => void;
  onRevert?: (hash: string) => void;
  onReset?: (hash: string) => void;
  onCreateBranch?: (hash: string) => void;
  onCreateTag?: (hash: string) => void;
  onCompareBranch?: (name: string) => void;
  onSquash?: (hashes: string[]) => void;
  currentBranch?: string;
  listNote?: string;
  listLoading?: boolean;
  listError?: string;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** 当前分支还没有的提交。传入后，不在集合里的行标灰；null 表示不高亮。 */
  unappliedHashes?: ReadonlySet<string> | null;
}

function compareTargets(commit: GitCommit, currentBranch: string): string[] {
  const names = new Set<string>();
  commit.refs.forEach(ref => {
    const parsed = parseRef(ref);
    if (parsed.kind === 'tag' || !parsed.label || parsed.label === 'HEAD' || parsed.label === currentBranch) return;
    names.add(parsed.label);
  });
  return Array.from(names);
}

interface RowAnchor {
  top: number;
  height: number;
}

function linkPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(x1 - x2) < 0.5) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const midY = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
}

function cubicPoint(
  t: number,
  x1: number,
  y1: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x2: number,
  y2: number,
) {
  const u = 1 - t;
  return {
    x: u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2,
    y: u * u * u * y1 + 3 * u * u * t * cy1 + 3 * u * t * t * cy2 + t * t * t * y2,
  };
}

function arrowPoints(x1: number, y1: number, x2: number, y2: number): string {
  const midY = (y1 + y2) / 2;
  const t = 0.62;
  const p = cubicPoint(t, x1, y1, x1, midY, x2, midY, x2, y2);
  const q = cubicPoint(Math.min(t + 0.16, 0.92), x1, y1, x1, midY, x2, midY, x2, y2);
  const vx = q.x - p.x;
  const vy = q.y - p.y;
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;
  const px = -uy;
  const py = ux;
  const length = 6;
  const half = 3.1;
  const tipX = p.x + ux * 2.4;
  const tipY = p.y + uy * 2.4;
  const baseX = tipX - ux * length;
  const baseY = tipY - uy * length;
  return `${tipX},${tipY} ${baseX + px * half},${baseY + py * half} ${baseX - px * half},${baseY - py * half}`;
}

function GraphOverlay({
  layout,
  anchors,
  selectedIndices,
  headRows,
}: {
  layout: GraphLayout;
  anchors: RowAnchor[];
  selectedIndices: Set<number>;
  headRows: Set<number>;
}) {
  if (anchors.length === 0 || anchors.length !== layout.rows.length) return null;
  const origin = anchors[0].top;
  const last = anchors[anchors.length - 1];
  const height = Math.max(1, last.top + last.height - origin);
  const width = graphColumnWidth(layout.laneCount);

  const yOf = (row: number, edge: GraphLink['fromY']) => {
    const anchor = anchors[row];
    const top = anchor.top - origin;
    const bottom = row < anchors.length - 1
      ? anchors[row + 1].top - origin
      : top + anchor.height;
    if (edge === 'top') return row === 0 ? top : top - 0.5;
    if (edge === 'bottom') return row === anchors.length - 1 ? bottom : bottom + 0.5;
    return top + anchor.height / 2;
  };

  const straight: { key: string; link: GraphLink; row: number }[] = [];
  const curved: { key: string; link: GraphLink; row: number }[] = [];
  layout.rows.forEach((row, index) => {
    row.links.forEach((link, linkIndex) => {
      const item = { key: `${index}-${linkIndex}`, link, row: index };
      if (link.fromLane === link.toLane) straight.push(item);
      else curved.push(item);
    });
  });

  const drawLink = (key: string, link: GraphLink, row: number) => {
    const x1 = laneCenter(link.fromLane);
    const x2 = laneCenter(link.toLane);
    const y1 = yOf(row, link.fromY);
    const y2 = yOf(row, link.toY);
    const color = TRACK_COLORS[link.color % TRACK_COLORS.length];
    return (
      <g key={key}>
        <path
          d={linkPath(x1, y1, x2, y2)}
          stroke={color}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {link.arrow && <polygon points={arrowPoints(x1, y1, x2, y2)} fill={color} />}
      </g>
    );
  };

  return (
    <svg
      aria-hidden="true"
      className="absolute left-0 pointer-events-none z-[1]"
      style={{ top: origin, width, height }}
      width={width}
      height={height}
    >
      {straight.map(item => drawLink(item.key, item.link, item.row))}
      {curved.map(item => drawLink(item.key, item.link, item.row))}
      {layout.rows.map((row, index) => {
        const color = TRACK_COLORS[row.commitColor % TRACK_COLORS.length];
        const cx = laneCenter(row.commitLane);
        const cy = yOf(index, 'mid');
        const selected = selectedIndices.has(index);
        return (
          <g key={`dot-${index}`}>
            <circle
              cx={cx}
              cy={cy}
              r={selected ? 4.5 : 3.5}
              fill={color}
              stroke={selected ? '#FFFFFF' : '#1E1F22'}
              strokeWidth={selected ? 1.5 : 1}
            />
            {headRows.has(index) && <circle cx={cx} cy={cy} r="1.5" fill="#FFFFFF" />}
          </g>
        );
      })}
    </svg>
  );
}

export const CommitGraph: React.FC<CommitGraphProps> = ({
  commits,
  selectedHash,
  focusToken = 0,
  onSelectCommit,
  onViewDiff,
  onCheckout,
  onCherryPick,
  onRevert,
  onReset,
  onCreateBranch,
  onCreateTag,
  onCompareBranch,
  onSquash,
  currentBranch = '',
  listNote = '',
  listLoading = false,
  listError = '',
  hasMore = false,
  onLoadMore,
  unappliedHashes = null,
}) => {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    commit: GitCommit | null;
    branchName?: string;
  }>({ visible: false, x: 0, y: 0, commit: null });

  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [expandedRefs, setExpandedRefs] = useState<Set<string>>(new Set());
  const [anchors, setAnchors] = useState<RowAnchor[]>([]);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const wrapRef = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const graphWidth = graphColumnWidth(layout.laneCount);
  const tableMinWidth = Math.max(760, graphWidth + 128 + 112 + 96 + 240);
  const [selectedHashes, setSelectedHashes] = useState<string[]>([]);
  const anchorRef = useRef('');
  const headRows = useMemo(() => {
    const rows = new Set<number>();
    commits.forEach((commit, index) => {
      if (commit.refs.some(ref => ref.includes('HEAD'))) rows.add(index);
    });
    return rows;
  }, [commits]);

  useEffect(() => {
    setSelectedHashes(prev => {
      const alive = prev.filter(hash => commits.some(commit => commit.hash === hash));
      if (selectedHash && !alive.includes(selectedHash)) {
        anchorRef.current = selectedHash;
        return [selectedHash];
      }
      if (alive.length === 0 && selectedHash) {
        anchorRef.current = selectedHash;
        return [selectedHash];
      }
      return alive.length === prev.length ? prev : alive;
    });
  }, [commits, selectedHash]);

  useEffect(() => {
    if (!focusToken) return;
    rowRefs.current.get(selectedHash)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusToken, selectedHash]);

  const selectedIndices = useMemo(() => {
    const indices = new Set<number>();
    commits.forEach((commit, index) => {
      if (selectedHashes.includes(commit.hash)) indices.add(index);
    });
    return indices;
  }, [commits, selectedHashes]);

  const squashIssue = inspectSquashSelection(commits, selectedHashes);
  const squashIssueText = (issue: SquashIssue | null) => {
    if (issue === 'need-more') return t('graph.squashNeedMore');
    if (issue === 'gap') return t('graph.squashGap');
    if (issue === 'merge') return t('graph.squashMerge');
    if (issue === 'root') return t('graph.squashRoot');
    if (issue === 'missing') return t('graph.squashMissing');
    return t('graph.squashHint');
  };

  const selectOnly = (commit: GitCommit) => {
    setSelectedHashes([commit.hash]);
    anchorRef.current = commit.hash;
    onSelectCommit(commit);
  };

  const handleRowClick = (event: React.MouseEvent, commit: GitCommit) => {
    const index = commits.findIndex(item => item.hash === commit.hash);
    if (event.shiftKey && anchorRef.current) {
      const anchorIndex = commits.findIndex(item => item.hash === anchorRef.current);
      if (anchorIndex >= 0 && index >= 0) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        setSelectedHashes(commits.slice(start, end + 1).map(item => item.hash));
        onSelectCommit(commit);
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      if (selectedHashes.includes(commit.hash)) {
        const next = selectedHashes.filter(hash => hash !== commit.hash);
        if (next.length === 0) return;
        setSelectedHashes(next);
        if (commit.hash === selectedHash) {
          const fallback = commits.find(item => item.hash === next[next.length - 1]);
          if (fallback) onSelectCommit(fallback);
        }
        return;
      }
      setSelectedHashes([...selectedHashes, commit.hash]);
      anchorRef.current = commit.hash;
      onSelectCommit(commit);
      return;
    }
    selectOnly(commit);
  };

  const openSquash = (hashes: string[]) => {
    if (inspectSquashSelection(commits, hashes)) return;
    onSquash?.(hashes);
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  useEffect(() => {
    const dismiss = () => setContextMenu(prev => ({ ...prev, visible: false }));
    window.addEventListener('snailgit:dismiss', dismiss);
    return () => window.removeEventListener('snailgit:dismiss', dismiss);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, commit: GitCommit) => {
    e.preventDefault();
    const keep = selectedHashes.includes(commit.hash) && selectedHashes.length > 1;
    if (!keep) selectOnly(commit);
    setContextMenu({
      visible: true,
      x: Math.min(e.clientX, window.innerWidth - 240),
      y: Math.min(e.clientY, window.innerHeight - 320),
      commit
    });
  };

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      if (commits.length === 0) {
        setAnchors(prev => (prev.length === 0 ? prev : []));
        return;
      }
      if (commits.some(commit => !rowRefs.current.get(commit.hash))) return;
      const wrapTop = wrap.getBoundingClientRect().top;
      const next = commits.map(commit => {
        const el = rowRefs.current.get(commit.hash)!;
        const rect = el.getBoundingClientRect();
        return { top: rect.top - wrapTop, height: rect.height };
      });
      if (next.some(item => item.height < 1)) return;
      setAnchors(prev => {
        if (
          prev.length === next.length
          && prev.every((item, index) => Math.abs(item.top - next[index].top) < 0.5 && Math.abs(item.height - next[index].height) < 0.5)
        ) {
          return prev;
        }
        return next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [commits, graphWidth, expandedRefs]);

  return (
    <div 
      className="flex-1 h-full min-h-0 overflow-auto overflow-x-auto bg-jb-bg select-none relative focus:outline-none"
      onClick={() => setContextMenu(prev => ({ ...prev, visible: false }))}
    >
      <div ref={wrapRef} className="relative w-full" style={{ minWidth: tableMinWidth }}>
      <table className="w-full table-fixed border-collapse text-xs font-sans" style={{ minWidth: tableMinWidth }}>
        <colgroup>
          <col style={{ width: graphWidth }} />
          <col />
          <col style={{ width: 128 }} />
          <col style={{ width: 112 }} />
          <col style={{ width: 96 }} />
        </colgroup>
        <thead className="sticky top-0 bg-jb-panel border-b border-jb-border z-20 text-jb-text-muted font-medium select-none shadow-sm">
          <tr>
            <th className="py-1.5 px-1 text-left font-normal overflow-hidden" style={{ width: graphWidth }}>{t('graph.column.graph')}</th>
            <th className="py-1.5 px-2 text-left font-normal">{t('graph.column.description')}</th>
            <th className="py-1.5 px-2 text-left font-normal w-32">{t('graph.column.author')}</th>
            <th className="py-1.5 px-2 text-left font-normal w-28">{t('graph.column.date')}</th>
            <th className="py-1.5 pr-4 text-right font-normal w-24">{t('graph.column.commit')}</th>
          </tr>
        </thead>
        <tbody>
          {commits.map((commit) => {
            const parsed = commit.refs.map(parseRef);
            const primary = parsed.filter(item => item.kind === 'head' || item.kind === 'local');
            const secondary = parsed.filter(item => item.kind === 'tag' || item.kind === 'remote');
            const expanded = expandedRefs.has(commit.hash);
            const visibleSecondary = expanded ? secondary : secondary.slice(0, 2);
            const hiddenCount = secondary.length - visibleSecondary.length;
            const badges = [...primary, ...visibleSecondary];
            const selected = selectedHashes.includes(commit.hash);
            const applied = unappliedHashes !== null && !unappliedHashes.has(commit.hash);
            const appliedHint = t('graph.alreadyApplied');

            return (
              <tr
                key={commit.hash}
                ref={(node) => {
                  if (node) rowRefs.current.set(commit.hash, node);
                  else rowRefs.current.delete(commit.hash);
                }}
                onClick={(event) => handleRowClick(event, commit)}
                onContextMenu={(e) => handleContextMenu(e, commit)}
                title={applied ? appliedHint : undefined}
                className={`h-7 border-b border-jb-border/30 cursor-pointer transition-colors ${
                  selected
                    ? 'bg-jb-selected text-jb-selectedText font-medium'
                    : applied
                      ? 'bg-jb-active text-jb-text-secondary hover:bg-jb-borderHover'
                      : 'hover:bg-jb-hover/80 text-jb-text-primary'
                }`}
              >
                <td className="p-0" style={{ width: graphWidth, minWidth: graphWidth }} />

                <td className="py-1 px-2 overflow-hidden">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="truncate min-w-0" title={applied ? `${commit.subject} — ${appliedHint}` : commit.subject}>{commit.subject}</span>
                    {badges.length > 0 && (
                      <div className="ml-auto flex items-center gap-1 shrink-0 max-w-[58%] min-w-0">
                        <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                          {badges.map(item => (
                            <RefBadge
                              key={item.title}
                              item={item}
                              onContextMenu={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setContextMenu({
                                  visible: true,
                                  x: Math.min(event.clientX, window.innerWidth - 240),
                                  y: Math.min(event.clientY, window.innerHeight - 280),
                                  commit,
                                  branchName: item.kind === 'tag' || item.label === 'HEAD' ? undefined : item.label,
                                });
                              }}
                            />
                          ))}
                        </div>
                        {secondary.length > 2 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setExpandedRefs(prev => {
                                const next = new Set(prev);
                                if (next.has(commit.hash)) next.delete(commit.hash);
                                else next.add(commit.hash);
                                return next;
                              });
                            }}
                            title={expanded ? t('graph.collapseRefs') : t('graph.moreRefs', { count: hiddenCount })}
                            className="text-[10px] px-1.5 py-0.5 rounded-full border border-jb-border bg-jb-panel text-jb-text-muted hover:text-jb-text-primary shrink-0"
                          >
                            {expanded ? '–' : `+${hiddenCount}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </td>

                <td className="py-1 px-2 overflow-hidden text-jb-text-secondary">
                  <span className="block truncate">{commit.author}</span>
                </td>

                <td className="py-1 px-2 overflow-hidden text-jb-text-muted">
                  <span className="block truncate">{commit.relativeDate}</span>
                </td>

                <td className="py-1 pr-4 text-right font-mono text-jb-text-muted">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      copyHash(commit.hash);
                    }}
                    title={t('graph.copyHash')}
                    className="hover:text-jb-blue transition-colors px-1 py-0.5 rounded hover:bg-jb-panel"
                  >
                    {copiedHash === commit.hash ? (
                      <span className="text-jb-green inline-flex items-center justify-end">
                        <Check className="w-3 h-3" />
                      </span>
                    ) : (
                      commit.shortHash
                    )}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {(listNote || listLoading || listError || hasMore) && (
        <div className="px-3 py-2 flex items-center gap-3 text-[11px] text-jb-text-muted">
          {listLoading && <span>{t('log.loading')}</span>}
          {!listLoading && listError && <span className="text-rose-300">{listError}</span>}
          {!listLoading && !listError && listNote && <span>{listNote}</span>}
          {hasMore && onLoadMore && (
            <button
              type="button"
              onClick={onLoadMore}
              disabled={listLoading}
              className="px-2 py-0.5 rounded border border-[#393B40] text-[#DFE1E5] hover:bg-[#2B2D30] disabled:opacity-40"
            >
              {t('log.loadMore')}
            </button>
          )}
        </div>
      )}
      <GraphOverlay
        layout={layout}
        anchors={anchors}
        selectedIndices={selectedIndices}
        headRows={headRows}
      />
      {selectedHashes.length > 1 && (
        <div className="sticky bottom-0 z-30 flex items-center gap-2 px-3 py-1.5 bg-jb-panel/95 border-t border-jb-border text-[11px]">
          <span className="text-jb-text-secondary">{t('graph.selectedCount', { count: selectedHashes.length })}</span>
          <button
            type="button"
            disabled={squashIssue !== null}
            title={squashIssueText(squashIssue)}
            onClick={() => openSquash(selectedHashes)}
            className="px-2 py-0.5 rounded border border-jb-blue/50 text-jb-blue hover:bg-jb-blue/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {t('graph.squash')}
          </button>
          <button
            type="button"
            onClick={() => {
              const hash = selectedHash || selectedHashes[0];
              const commit = commits.find(item => item.hash === hash);
              if (commit) selectOnly(commit);
            }}
            className="px-2 py-0.5 rounded border border-jb-border text-jb-text-muted hover:text-jb-text-primary hover:bg-jb-hover"
          >
            {t('graph.clearSelection')}
          </button>
          {squashIssue && <span className="text-jb-text-muted truncate">{squashIssueText(squashIssue)}</span>}
        </div>
      )}
      </div>

      {/* IDEA 经典右键快捷菜单 */}
      {contextMenu.visible && contextMenu.commit && (
        <div 
          className="fixed bg-jb-panel border border-jb-border rounded-md shadow-2xl py-1 z-50 w-56 text-xs text-jb-text-primary select-none animate-in fade-in zoom-in-95 duration-100"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="px-3 py-1 font-mono text-[11px] text-jb-text-muted border-b border-jb-border/60 flex items-center justify-between">
            <span>{t('graph.commit', { hash: contextMenu.commit.shortHash })}</span>
            <button 
              onClick={() => copyHash(contextMenu.commit!.hash)}
              className="text-jb-blue hover:underline flex items-center space-x-0.5"
            >
              <Copy className="w-2.5 h-2.5" />
              <span>{t('graph.copy')}</span>
            </button>
          </div>

          <button 
            onClick={() => onViewDiff(contextMenu.commit!)}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <FileDiff className="w-3.5 h-3.5 text-jb-blue" />
            <span>{t('graph.showDiff')}</span>
          </button>

          {contextMenu.branchName === currentBranch && (
            <div className="px-3 py-1.5 text-jb-text-muted">{t('graph.alreadyCurrent')}</div>
          )}
          {(contextMenu.branchName && contextMenu.branchName !== currentBranch
            ? [contextMenu.branchName]
            : compareTargets(contextMenu.commit, currentBranch)
          ).map(name => (
            <button
              key={name}
              onClick={() => {
                onCompareBranch?.(name);
                setContextMenu(prev => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
            >
              <GitBranch className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">{t('graph.compare', { name })}</span>
            </button>
          ))}

          <button
            onClick={() => {
              onCheckout?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t('graph.checkout', { hash: contextMenu.commit.shortHash })}</span>
          </button>

          <button
            onClick={() => {
              onCreateBranch?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <PlusCircle className="w-3.5 h-3.5 text-purple-400" />
            <span>{t('graph.newBranch')}</span>
          </button>

          <button
            onClick={() => {
              onCreateTag?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <Tag className="w-3.5 h-3.5 text-amber-300" />
            <span>{t('graph.newTag')}</span>
          </button>

          <div className="h-px bg-jb-border my-1" />

          <button
            disabled={squashIssue !== null}
            title={squashIssueText(squashIssue)}
            onClick={() => openSquash(selectedHashes)}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-jb-text-primary"
          >
            <Combine className="w-3.5 h-3.5 text-amber-300" />
            <span>{selectedHashes.length > 1 ? t('graph.squashCount', { count: selectedHashes.length }) : t('graph.squash')}</span>
          </button>

          <button
            onClick={() => {
              onCherryPick?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>{t('graph.cherryPick')}</span>
          </button>

          <button
            onClick={() => {
              onRevert?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <Undo2 className="w-3.5 h-3.5 text-rose-400" />
            <span>{t('graph.revert')}</span>
          </button>

          <button
            onClick={() => {
              const commit = contextMenu.commit;
              setContextMenu(prev => ({ ...prev, visible: false }));
              if (!commit) return;
              void askConfirm({
                title: t('confirm.resetTitle'),
                message: t('graph.resetConfirm', { hash: commit.shortHash }),
                confirmLabel: t('confirm.reset'),
                tone: 'danger',
              }).then(ok => {
                if (ok) onReset?.(commit.hash);
              });
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2 text-rose-300"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span>{t('graph.reset')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
