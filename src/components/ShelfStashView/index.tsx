import React, { useEffect, useState } from 'react';
import { ShelfItem, StashItem } from '../../types/git';
import { 
  Archive, 
  Layers, 
  Clock, 
  FileText, 
  Trash2, 
  RotateCcw, 
  CheckCircle, 
  HelpCircle,
  FileDiff,
  Download
} from 'lucide-react';

interface ShelfStashViewProps {
  shelves: ShelfItem[];
  stashes: StashItem[];
  onUnshelve: (shelfId: string) => void;
  onApplyStash: (stash: StashItem) => void;
  onPopStash?: (stash: StashItem) => void;
  onDropStash?: (stash: StashItem) => void;
  onDeleteShelf?: (shelfId: string) => void;
  onCreateStash?: () => void;
  onShowShelfDiff?: (shelfId: string) => void;
  onShowStashDiff?: (stash: StashItem) => void;
}

export const ShelfStashView: React.FC<ShelfStashViewProps> = ({
  shelves: initialShelves,
  stashes: initialStashes,
  onUnshelve,
  onApplyStash,
  onPopStash,
  onDropStash,
  onDeleteShelf,
  onCreateStash,
  onShowShelfDiff,
  onShowStashDiff,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'shelf' | 'stash'>('shelf');
  const [shelves, setShelves] = useState<ShelfItem[]>(initialShelves);
  const [stashes, setStashes] = useState<StashItem[]>(initialStashes);

  useEffect(() => setShelves(initialShelves), [initialShelves]);
  useEffect(() => setStashes(initialStashes), [initialStashes]);
  const [selectedShelfId, setSelectedShelfId] = useState<string>(
    initialShelves.length > 0 ? initialShelves[0].id : ''
  );

  const selectedShelf = shelves.find(s => s.id === selectedShelfId);

  const handleDeleteShelf = (id: string) => {
    if (onDeleteShelf) onDeleteShelf(id);
    else setShelves(prev => prev.filter(s => s.id !== id));
  };

  const handleDeleteStash = (stash: StashItem) => {
    if (onDropStash) onDropStash(stash);
    else setStashes(prev => prev.filter(s => s.id !== stash.id));
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-jb-bg select-none text-xs">
      {/* 顶部二级导航 */}
      <div className="h-9 px-3 border-b border-jb-border bg-jb-panel flex items-center justify-between">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveSubTab('shelf')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center space-x-1.5 ${
              activeSubTab === 'shelf'
                ? 'bg-jb-bg text-jb-text-primary border border-jb-border'
                : 'text-jb-text-secondary hover:text-jb-text-primary'
            }`}
          >
            <Archive className="w-3.5 h-3.5 text-jb-orange" />
            <span>Shelved Changes (架藏)</span>
            <span className="text-[10px] px-1.5 bg-jb-panel rounded-full text-jb-text-muted font-mono">
              {shelves.length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('stash')}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors flex items-center space-x-1.5 ${
              activeSubTab === 'stash'
                ? 'bg-jb-bg text-jb-text-primary border border-jb-border'
                : 'text-jb-text-secondary hover:text-jb-text-primary'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-jb-blue" />
            <span>Git Stashes (贮藏栈)</span>
            <span className="text-[10px] px-1.5 bg-jb-panel rounded-full text-jb-text-muted font-mono">
              {stashes.length}
            </span>
          </button>
        </div>

        {/* 提示条 */}
        <div className="text-[11px] text-jb-text-muted flex items-center space-x-2">
          {onCreateStash && (
            <button
              onClick={onCreateStash}
              className="px-2 py-1 rounded bg-jb-blue/15 text-jb-blue border border-jb-blue/30"
            >
              Stash 当前变更
            </button>
          )}
          <span className="flex items-center space-x-1">
            <HelpCircle className="w-3 h-3 text-jb-blue" />
            <span>Shelf 存在本地，不受分支切换与 stash drop 影响</span>
          </span>
        </div>
      </div>

      {/* 主体内容 */}
      {activeSubTab === 'shelf' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* 左侧：架藏列表 */}
          <div className="w-80 border-r border-jb-border bg-jb-panel/60 flex flex-col overflow-y-auto p-2 space-y-1">
            <div className="text-[11px] font-semibold text-jb-text-muted px-2 py-1 uppercase">
              Shelved Changelists
            </div>

            {shelves.map(shelf => {
              const isSelected = shelf.id === selectedShelfId;
              return (
                <div
                  key={shelf.id}
                  onClick={() => setSelectedShelfId(shelf.id)}
                  className={`p-2.5 rounded cursor-pointer transition-colors space-y-1 ${
                    isSelected
                      ? 'bg-jb-selected text-white'
                      : 'hover:bg-jb-hover bg-jb-bg/40 text-jb-text-primary border border-jb-border/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold truncate">{shelf.name}</span>
                    <span className="text-[10px] font-mono opacity-70">{shelf.fileCount} files</span>
                  </div>
                  <div className="text-[11px] opacity-70 flex items-center space-x-1 font-mono">
                    <Clock className="w-3 h-3" />
                    <span>{shelf.date}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 右侧：架藏详情与恢复 */}
          <div className="flex-1 flex flex-col bg-jb-bg">
            {selectedShelf ? (
              <div className="flex-1 flex flex-col p-4">
                <div className="flex items-center justify-between pb-3 border-b border-jb-border">
                  <div>
                    <h3 className="text-sm font-bold text-jb-text-primary">{selectedShelf.name}</h3>
                    <div className="text-xs text-jb-text-muted mt-0.5">
                      Shelved on {selectedShelf.date} • {selectedShelf.files.length} file(s)
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onShowShelfDiff?.(selectedShelf.id)}
                      className="px-3 py-1.5 bg-jb-panel hover:bg-jb-hover text-jb-text-primary rounded border border-jb-border flex items-center space-x-1.5"
                    >
                      <FileDiff className="w-3.5 h-3.5 text-jb-blue" />
                      <span>查看差异</span>
                    </button>
                    <button
                      onClick={() => onUnshelve(selectedShelf.id)}
                      className="px-3 py-1.5 bg-jb-blue hover:bg-jb-blueHover text-white rounded font-medium flex items-center space-x-1.5 transition-colors shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Unshelve (恢复到工作区)</span>
                    </button>

                    <button
                      onClick={() => handleDeleteShelf(selectedShelf.id)}
                      className="p-1.5 hover:bg-jb-hover text-rose-400 hover:text-rose-300 rounded border border-jb-border transition-colors"
                      title="删除架藏"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* 文件列表 */}
                <div className="mt-3 space-y-1">
                  <div className="text-xs font-semibold text-jb-text-muted mb-2">Files in this shelf:</div>
                  {selectedShelf.files.map(f => (
                    <div key={f.path} className="flex items-center justify-between p-2 rounded bg-jb-panel/50 border border-jb-border/40 font-mono text-xs">
                      <div className="flex items-center space-x-2">
                        <FileText className="w-3.5 h-3.5 text-jb-blue" />
                        <span className="text-jb-text-primary">{f.path}</span>
                      </div>
                      <div className="space-x-1.5 text-[11px]">
                        <span className="text-jb-green">+{f.additions}</span>
                        <span className="text-jb-red">-{f.deletions}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-jb-text-muted">
                Select a shelf to inspect
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Git Stash 视图 */
        <div className="flex-1 p-4 overflow-y-auto space-y-2">
          <div className="text-xs font-semibold text-jb-text-muted uppercase tracking-wider mb-2">
            Standard Git Stash Stack
          </div>
          {stashes.map(stash => (
            <div 
              key={stash.id}
              className="p-3 rounded-lg bg-jb-panel border border-jb-border flex items-center justify-between"
            >
              <div className="space-y-1">
                <div className="flex items-center space-x-2 font-mono">
                  <span className="px-1.5 py-0.5 rounded bg-jb-bg text-jb-blue text-[10px] font-semibold border border-jb-border">
                    stash@{`{${stash.index}}`}
                  </span>
                  <span className="text-jb-text-primary font-medium">{stash.message}</span>
                </div>
                <div className="text-[11px] text-jb-text-muted font-mono flex items-center space-x-3">
                  <span>Branch: {stash.branch}</span>
                  <span>•</span>
                  <span>{stash.date}</span>
                  <span>•</span>
                  <span>{stash.fileCount} files</span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => onShowStashDiff?.(stash)}
                  className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover text-jb-text-primary border border-jb-border"
                >
                  查看差异
                </button>
                <button
                  onClick={() => onApplyStash(stash)}
                  className="px-2.5 py-1.5 rounded bg-jb-blue/20 hover:bg-jb-blue/30 text-jb-blue font-medium border border-jb-blue/30"
                >
                  Apply Stash
                </button>
                <button
                  onClick={() => {
                    if (onPopStash) onPopStash(stash);
                    else {
                      onApplyStash(stash);
                      handleDeleteStash(stash);
                    }
                  }}
                  className="px-2.5 py-1.5 rounded bg-jb-panel hover:bg-jb-hover text-jb-text-primary border border-jb-border"
                >
                  Pop
                </button>
                <button
                  onClick={() => handleDeleteStash(stash)}
                  className="p-1.5 rounded hover:bg-jb-hover text-rose-400 hover:text-rose-300 border border-jb-border"
                  title="Drop Stash"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
