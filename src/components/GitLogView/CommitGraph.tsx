import React, { useEffect, useRef, useState } from 'react';
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
  FileDiff 
} from 'lucide-react';
import { useI18n } from '../../i18n/react';

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
  onCompareBranch?: (name: string) => void;
  currentBranch?: string;
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

// 模拟 IDEA 经典的 6 色分支轨道配色
const TRACK_COLORS = [
  '#3574F0', // 轨道 0：JetBrains 蓝
  '#59A869', // 轨道 1：绿色
  '#B388FF', // 轨道 2：紫色
  '#EDA200', // 轨道 3：橙黄色
  '#29B6F6', // 轨道 4：青色
  '#E35967', // 轨道 5：红粉色
];

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
  onCompareBranch,
  currentBranch = '',
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
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());

  const rowHeight = 28;
  const colWidth = 14;

  useEffect(() => {
    if (!focusToken) return;
    rowRefs.current.get(selectedHash)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusToken, selectedHash]);

  useEffect(() => {
    const dismiss = () => setContextMenu(prev => ({ ...prev, visible: false }));
    window.addEventListener('easygit:dismiss', dismiss);
    return () => window.removeEventListener('easygit:dismiss', dismiss);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, commit: GitCommit) => {
    e.preventDefault();
    setContextMenu({
      visible: true,
      x: Math.min(e.clientX, window.innerWidth - 220),
      y: Math.min(e.clientY, window.innerHeight - 260),
      commit
    });
  };

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 1500);
  };

  return (
    <div 
      className="flex-1 h-full min-h-0 overflow-auto overflow-x-auto bg-jb-bg select-none relative focus:outline-none"
      onClick={() => setContextMenu(prev => ({ ...prev, visible: false }))}
    >
      <table className="w-full table-fixed border-collapse text-xs font-sans min-w-[760px]">
        <thead className="sticky top-0 bg-jb-panel/95 border-b border-jb-border z-10 text-jb-text-muted font-medium select-none shadow-sm">
          <tr>
            <th className="py-1.5 px-3 text-left font-normal w-20">{t('graph.column.graph')}</th>
            <th className="py-1.5 px-2 text-left font-normal">{t('graph.column.description')}</th>
            <th className="py-1.5 px-2 text-left font-normal w-32">{t('graph.column.author')}</th>
            <th className="py-1.5 px-2 text-left font-normal w-28">{t('graph.column.date')}</th>
            <th className="py-1.5 pr-4 text-right font-normal w-24">{t('graph.column.commit')}</th>
          </tr>
        </thead>
        <tbody>
          {commits.map((commit, index) => {
            const isSelected = commit.hash === selectedHash;
            const track = commit.branchTrack ?? (index % 3);
            const dotX = 14 + track * colWidth;
            const dotY = rowHeight / 2;
            const color = TRACK_COLORS[track % TRACK_COLORS.length];

            return (
              <tr
                key={commit.hash}
                ref={(node) => {
                  if (node) rowRefs.current.set(commit.hash, node);
                  else rowRefs.current.delete(commit.hash);
                }}
                onClick={() => onSelectCommit(commit)}
                onContextMenu={(e) => handleContextMenu(e, commit)}
                className={`h-7 border-b border-jb-border/30 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-jb-selected text-jb-selectedText font-medium'
                    : 'hover:bg-jb-hover/80 text-jb-text-primary'
                }`}
              >
                {/* 拓扑分支图轨道单元格 */}
                <td className="p-0 relative w-20 overflow-hidden">
                  <svg 
                    className="w-full h-7 block" 
                    height={rowHeight}
                  >
                    {/* 贯穿竖线或分支连线 */}
                    {index < commits.length - 1 && (
                      <line 
                        x1={dotX} 
                        y1={dotY} 
                        x2={dotX} 
                        y2={rowHeight} 
                        stroke={color} 
                        strokeWidth="2" 
                        strokeLinecap="round"
                      />
                    )}
                    {index > 0 && (
                      <line 
                        x1={dotX} 
                        y1={0} 
                        x2={dotX} 
                        y2={dotY} 
                        stroke={color} 
                        strokeWidth="2" 
                        strokeLinecap="round"
                      />
                    )}

                    {/* 如果有多分支合并或分叉效果（例如首个 commit 与其分支连接） */}
                    {commit.parents.length > 1 && (
                      <path 
                        d={`M ${dotX} ${dotY} C ${dotX + colWidth * 2} ${dotY}, ${dotX + colWidth * 2} ${rowHeight}, ${dotX + colWidth * 2} ${rowHeight}`} 
                        stroke={TRACK_COLORS[(track + 1) % TRACK_COLORS.length]} 
                        strokeWidth="2" 
                        fill="none" 
                      />
                    )}

                    {/* Commit 节点圆点 */}
                    <circle 
                      cx={dotX} 
                      cy={dotY} 
                      r={isSelected ? 4.5 : 3.5} 
                      fill={color} 
                      stroke={isSelected ? '#FFFFFF' : '#1E1F22'} 
                      strokeWidth={isSelected ? '1.5' : '1'} 
                    />

                    {/* HEAD 当前分支指示心 */}
                    {commit.refs.some(r => r.includes('HEAD')) && (
                      <circle 
                        cx={dotX} 
                        cy={dotY} 
                        r="1.5" 
                        fill="#FFFFFF" 
                      />
                    )}
                  </svg>
                </td>

                {/* 描述与 Branch / Tag 徽章 */}
                <td className="py-1 px-2 overflow-hidden">
                  <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                    {(() => {
                      const parsed = commit.refs.map(parseRef);
                      const primary = parsed.filter(item => item.kind === 'head' || item.kind === 'local');
                      const secondary = parsed.filter(item => item.kind === 'tag' || item.kind === 'remote');
                      const expanded = expandedRefs.has(commit.hash);
                      const visibleSecondary = expanded ? secondary : secondary.slice(0, 2);
                      const hiddenCount = secondary.length - visibleSecondary.length;
                      return (
                        <>
                          {[...primary, ...visibleSecondary].map(item => (
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
                        </>
                      );
                    })()}
                    <span className="truncate min-w-0">{commit.subject}</span>
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

          <div className="h-px bg-jb-border my-1" />

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
              if (confirm(t('graph.resetConfirm', { hash: contextMenu.commit!.shortHash }))) {
                onReset?.(contextMenu.commit!.hash);
              }
              setContextMenu(prev => ({ ...prev, visible: false }));
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
