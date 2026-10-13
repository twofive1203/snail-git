import React, { useState } from 'react';
import { GitRepository } from '../../types/git';
import { 
  FolderGit2, 
  Plus, 
  Search, 
  Trash2, 
  Star, 
  PanelLeftClose, 
  PanelLeft, 
  GitBranch, 
  Check, 
  ChevronRight,
  MoreVertical,
  ExternalLink,
  Copy
} from 'lucide-react';
import { AddProjectModal } from './AddProjectModal';

interface ProjectSidebarProps {
  repositories: GitRepository[];
  activeRepoId: string;
  onSelectRepo: (repo: GitRepository) => void;
  onAddRepo: (name: string, path: string) => void;
  onBrowse?: () => Promise<string | null>;
  onRemoveRepo: (repoId: string) => void;
  onToggleFavorite: (repoId: string) => void;
}

export const ProjectSidebar: React.FC<ProjectSidebarProps> = ({
  repositories,
  activeRepoId,
  onSelectRepo,
  onAddRepo,
  onBrowse,
  onRemoveRepo,
  onToggleFavorite,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [contextMenuRepoId, setContextMenuRepoId] = useState<string | null>(null);

  const filteredRepos = repositories.filter(r => 
    r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.path.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 排序：收藏置顶，其次按原顺序
  const sortedRepos = [...filteredRepos].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    return 0;
  });

  const handleCopyPath = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(path);
  };

  return (
    <>
      <aside 
        className={`bg-[#1E1F22] border-r border-[#393B40] flex flex-col h-full select-none transition-all duration-200 relative z-20 ${
          isCollapsed ? 'w-12' : 'w-64'
        }`}
      >
        {/* 顶部标题条与折叠开关 */}
        <div className="h-11 px-2.5 border-b border-[#393B40] flex items-center justify-between bg-[#2B2D30]/80">
          {!isCollapsed && (
            <div className="flex items-center space-x-2 min-w-0">
              <FolderGit2 className="w-4 h-4 text-[#3574F0] shrink-0" />
              <span className="font-semibold text-xs text-[#DFE1E5] truncate">
                Repositories
              </span>
              <span className="text-[10px] font-mono text-[#8C9099] bg-[#1E1F22] px-1.5 py-0.2 rounded-full border border-[#393B40]">
                {repositories.length}
              </span>
            </div>
          )}

          <div className={`flex items-center space-x-1 ${isCollapsed ? 'mx-auto' : ''}`}>
            {!isCollapsed && (
              <button
                onClick={() => setIsAddModalOpen(true)}
                title="添加新 Git 项目文件夹"
                className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5] transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => setIsCollapsed(!isCollapsed)}
              title={isCollapsed ? "展开项目列表" : "折叠项目列表"}
              className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5] transition-colors"
            >
              {isCollapsed ? <PanelLeft className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* 展开时的搜索框 */}
        {!isCollapsed && (
          <div className="p-2 border-b border-[#393B40]/60 bg-[#1E1F22]">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#6F737A] absolute left-2 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目或路径..."
                className="w-full bg-[#2B2D30] border border-[#393B40] rounded pl-7 pr-2 py-1 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0] transition-colors"
              />
            </div>
          </div>
        )}

        {/* 项目列表区 */}
        <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
          {sortedRepos.map((repo) => {
            const isActive = repo.id === activeRepoId;

            if (isCollapsed) {
              // 折叠状态下的紧凑图标展示
              return (
                <div
                  key={repo.id}
                  onClick={() => onSelectRepo(repo)}
                  title={`${repo.name} (${repo.currentBranch}) - ${repo.path}`}
                  className={`w-9 h-9 mx-auto rounded-lg flex items-center justify-center cursor-pointer transition-all relative group ${
                    isActive 
                      ? 'bg-[#3574F0] text-white shadow-md' 
                      : 'hover:bg-[#2B2D30] text-[#9DA0A8] hover:text-[#DFE1E5]'
                  }`}
                >
                  <span className="font-bold text-xs uppercase font-mono">
                    {repo.name.substring(0, 2)}
                  </span>

                  {/* 变动小红点 */}
                  {repo.dirtyFilesCount > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400 ring-2 ring-[#1E1F22]" />
                  )}
                </div>
              );
            }

            // 展开状态下的完整卡片展示
            return (
              <div
                key={repo.id}
                onClick={() => onSelectRepo(repo)}
                className={`p-2 rounded-md cursor-pointer transition-all relative group border text-xs ${
                  isActive
                    ? 'bg-[#2E436E]/60 border-[#3574F0]/80 shadow-sm'
                    : 'hover:bg-[#2B2D30] border-transparent hover:border-[#393B40]/80'
                }`}
              >
                {/* 第一行：项目名、收藏星标、移除按钮 */}
                <div className="flex items-center justify-between min-w-0">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <FolderGit2 className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#3574F0]' : 'text-[#8C9099]'}`} />
                    <span className={`font-semibold truncate ${isActive ? 'text-white' : 'text-[#DFE1E5]'}`}>
                      {repo.name}
                    </span>
                    {repo.isFavorite && (
                      <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />
                    )}
                  </div>

                  <div className="flex items-center space-x-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(repo.id);
                      }}
                      title={repo.isFavorite ? "取消收藏" : "收藏置顶"}
                      className="p-1 rounded hover:bg-[#35373C] text-[#8C9099] hover:text-amber-400"
                    >
                      <Star className={`w-3 h-3 ${repo.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确定要从 EasyGit 中移除项目 "${repo.name}" 吗？（不会删除任何磁盘代码）`)) {
                          onRemoveRepo(repo.id);
                        }
                      }}
                      title="从列表中移除此项目"
                      className="p-1 rounded hover:bg-[#35373C] text-[#8C9099] hover:text-rose-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* 第二行：路径预览 */}
                <div className="text-[10px] text-[#6F737A] font-mono truncate mt-0.5 pl-5" title={repo.path}>
                  {repo.path}
                </div>

                {/* 第三行：分支与状态小徽章 */}
                <div className="flex items-center justify-between mt-1.5 pl-5 text-[10px]">
                  <div className="flex items-center space-x-1 font-mono text-[#8C9099]">
                    <GitBranch className="w-3 h-3 text-[#3574F0] shrink-0" />
                    <span className="truncate max-w-[100px] text-[#589DF6]">{repo.currentBranch}</span>
                    {repo.aheadCount ? (
                      <span className="text-[#3574F0]">↑{repo.aheadCount}</span>
                    ) : null}
                  </div>

                  {/* 变动统计小标 */}
                  <div className="flex items-center space-x-1 shrink-0 font-mono">
                    {repo.dirtyFilesCount > 0 ? (
                      <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 text-[9px] font-semibold">
                        ● {repo.dirtyFilesCount}
                      </span>
                    ) : (
                      <span className="text-emerald-400 flex items-center space-x-0.5 text-[9px]">
                        <Check className="w-2.5 h-2.5" />
                        <span>clean</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {sortedRepos.length === 0 && !isCollapsed && (
            <div className="p-4 text-center text-[#6F737A] text-xs space-y-2">
              <p>未找到匹配的 Git 项目</p>
              <button
                onClick={() => setIsAddModalOpen(true)}
                className="text-[#3574F0] hover:underline text-xs"
              >
                + 添加本地项目
              </button>
            </div>
          )}
        </div>

        {/* 底部折叠状态下的添加按钮 */}
        {isCollapsed && (
          <div className="p-2 border-t border-[#393B40] flex justify-center">
            <button
              onClick={() => setIsAddModalOpen(true)}
              title="添加新项目"
              className="w-8 h-8 rounded-lg bg-[#2B2D30] hover:bg-[#35373C] text-[#DFE1E5] flex items-center justify-center"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* 展开状态下的底部快捷导入入口 */}
        {!isCollapsed && (
          <div className="p-2 border-t border-[#393B40] bg-[#2B2D30]/40">
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="w-full py-1.5 px-2.5 rounded bg-[#2B2D30] hover:bg-[#35373C] border border-[#393B40] text-xs text-[#DFE1E5] flex items-center justify-center space-x-1.5 font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-[#3574F0]" />
              <span>添加 Git 项目文件夹...</span>
            </button>
          </div>
        )}
      </aside>

      {/* 添加项目弹窗 */}
      <AddProjectModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onAdd={onAddRepo}
        onBrowse={onBrowse}
      />
    </>
  );
};
