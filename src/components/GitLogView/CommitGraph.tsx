import React, { useState } from 'react';
import { GitCommit } from '../../types/git';
import { 
  GitCommit as CommitIcon, 
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

interface CommitGraphProps {
  commits: GitCommit[];
  selectedHash: string;
  onSelectCommit: (commit: GitCommit) => void;
  onViewDiff: (commit: GitCommit) => void;
  onCheckout?: (hash: string) => void;
  onCherryPick?: (hash: string) => void;
  onRevert?: (hash: string) => void;
  onReset?: (hash: string) => void;
  onCreateBranch?: (hash: string) => void;
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
  onSelectCommit,
  onViewDiff,
  onCheckout,
  onCherryPick,
  onRevert,
  onReset,
  onCreateBranch,
}) => {
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    commit: GitCommit | null;
  }>({ visible: false, x: 0, y: 0, commit: null });

  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const rowHeight = 28;
  const colWidth = 14;

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
      className="flex-1 overflow-auto bg-jb-bg select-none relative focus:outline-none"
      onClick={() => setContextMenu(prev => ({ ...prev, visible: false }))}
    >
      <table className="w-full border-collapse text-xs font-sans">
        <thead className="sticky top-0 bg-jb-panel/95 border-b border-jb-border z-10 text-jb-text-muted font-medium select-none shadow-sm">
          <tr>
            <th className="py-1.5 px-3 text-left font-normal w-24">Graph</th>
            <th className="py-1.5 px-2 text-left font-normal">Description</th>
            <th className="py-1.5 px-2 text-left font-normal w-32">Author</th>
            <th className="py-1.5 px-2 text-left font-normal w-28">Date</th>
            <th className="py-1.5 px-3 text-right font-normal w-24">Commit</th>
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
                onClick={() => onSelectCommit(commit)}
                onContextMenu={(e) => handleContextMenu(e, commit)}
                className={`h-7 border-b border-jb-border/30 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-jb-selected text-jb-selectedText font-medium'
                    : 'hover:bg-jb-hover/80 text-jb-text-primary'
                }`}
              >
                {/* 拓扑分支图轨道单元格 */}
                <td className="p-0 relative w-24 overflow-hidden">
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
                <td className="py-1 px-2 overflow-hidden text-ellipsis whitespace-nowrap">
                  <div className="flex items-center space-x-1.5 overflow-hidden">
                    {/* 分支徽章展示 (仿 IDEA 黄底 Tag, 绿底 HEAD, 蓝底 Remote) */}
                    {commit.refs.map((ref, rIdx) => {
                      const isHead = ref.includes('HEAD');
                      const isTag = ref.includes('tag:');
                      const isRemote = ref.includes('origin/');

                      let badgeClass = 'bg-blue-500/20 text-blue-300 border-blue-500/40';
                      if (isHead) badgeClass = 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40 font-semibold';
                      else if (isTag) badgeClass = 'bg-amber-500/25 text-amber-300 border-amber-500/40';
                      else if (isRemote) badgeClass = 'bg-purple-500/20 text-purple-300 border-purple-500/40';

                      return (
                        <span 
                          key={rIdx} 
                          className={`text-[10px] px-1.5 py-0.2 rounded border shrink-0 flex items-center space-x-1 font-mono ${badgeClass}`}
                        >
                          {isTag ? <Tag className="w-2.5 h-2.5" /> : <GitBranch className="w-2.5 h-2.5" />}
                          <span>{ref}</span>
                        </span>
                      );
                    })}

                    <span className="truncate">{commit.subject}</span>
                  </div>
                </td>

                {/* 提交者 */}
                <td className="py-1 px-2 whitespace-nowrap text-jb-text-secondary">
                  <span className="truncate">{commit.author}</span>
                </td>

                {/* 时间 */}
                <td className="py-1 px-2 whitespace-nowrap text-jb-text-muted">
                  <span>{commit.relativeDate}</span>
                </td>

                {/* Hash */}
                <td className="py-1 px-3 text-right whitespace-nowrap font-mono text-jb-text-muted">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      copyHash(commit.hash);
                    }}
                    title="点击复制完整 Hash"
                    className="hover:text-jb-blue transition-colors px-1 py-0.5 rounded hover:bg-jb-panel"
                  >
                    {copiedHash === commit.hash ? (
                      <span className="text-jb-green flex items-center space-x-0.5 justify-end">
                        <Check className="w-3 h-3" />
                        <span>Copied</span>
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
            <span>Commit {contextMenu.commit.shortHash}</span>
            <button 
              onClick={() => copyHash(contextMenu.commit!.hash)}
              className="text-jb-blue hover:underline flex items-center space-x-0.5"
            >
              <Copy className="w-2.5 h-2.5" />
              <span>Copy</span>
            </button>
          </div>

          <button 
            onClick={() => onViewDiff(contextMenu.commit!)}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <FileDiff className="w-3.5 h-3.5 text-jb-blue" />
            <span>Show Diff with Local</span>
          </button>

          <button
            onClick={() => {
              onCheckout?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <GitBranch className="w-3.5 h-3.5 text-emerald-400" />
            <span>Checkout Revision '{contextMenu.commit.shortHash}'</span>
          </button>

          <button
            onClick={() => {
              onCreateBranch?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <PlusCircle className="w-3.5 h-3.5 text-purple-400" />
            <span>New Branch from Here...</span>
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
            <span>Cherry-pick Commit</span>
          </button>

          <button
            onClick={() => {
              onRevert?.(contextMenu.commit!.hash);
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2"
          >
            <Undo2 className="w-3.5 h-3.5 text-rose-400" />
            <span>Revert Commit</span>
          </button>

          <button
            onClick={() => {
              if (confirm(`将当前分支混合重置到 ${contextMenu.commit!.shortHash}？工作区修改会保留，已暂存内容会取消暂存。`)) {
                onReset?.(contextMenu.commit!.hash);
              }
              setContextMenu(prev => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white flex items-center space-x-2 text-rose-300"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span>Reset Current Branch to Here...</span>
          </button>
        </div>
      )}
    </div>
  );
};
