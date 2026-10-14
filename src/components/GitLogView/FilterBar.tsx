import React from 'react';
import { Search, GitBranch, User, Calendar, FolderTree, RotateCcw, X, Star } from 'lucide-react';

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  selectedBranch: string;
  onBranchChange: (b: string) => void;
  selectedAuthor: string;
  onAuthorChange: (a: string) => void;
  selectedDate: string;
  onDateChange: (d: string) => void;
  pathQuery: string;
  onPathChange: (p: string) => void;
  branches: string[];
  authors: string[];
  currentUser?: string;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  onSearchChange,
  selectedBranch,
  onBranchChange,
  selectedAuthor,
  onAuthorChange,
  selectedDate,
  onDateChange,
  pathQuery,
  onPathChange,
  branches,
  authors,
  currentUser = '',
}) => {
  const meActive = Boolean(currentUser) && selectedAuthor === currentUser;
  const headActive = selectedBranch === 'Head';
  const authorOptions = currentUser && !authors.includes(currentUser) ? [currentUser, ...authors] : authors;
  const isFiltered = selectedBranch !== 'All' || selectedAuthor !== 'All' || selectedDate !== 'All' || pathQuery.trim() !== '' || searchQuery.trim() !== '';

  const handleResetFilters = () => {
    onBranchChange('All');
    onAuthorChange('All');
    onDateChange('All');
    onPathChange('');
    onSearchChange('');
  };

  return (
    <div className="h-8 bg-[#1E1F22] border-b border-[#303236] flex items-center justify-between px-2.5 text-xs gap-2 select-none shrink-0">
      {/* 左侧各维度筛选胶囊 */}
      <div className="flex items-center space-x-1.5 flex-1 overflow-x-auto no-scrollbar">
        <button
          type="button"
          disabled={!currentUser}
          onClick={() => onAuthorChange(meActive ? 'All' : currentUser)}
          title={currentUser ? `仅看我的：${currentUser}` : '未读取到 git config user.name'}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 transition-colors ${
            meActive
              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
              : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157] disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          <Star className={`w-3 h-3 shrink-0 ${meActive ? 'fill-amber-400 text-amber-400' : 'text-amber-400'}`} />
          <span>仅看我的</span>
        </button>

        <button
          type="button"
          onClick={() => onBranchChange(headActive ? 'All' : 'Head')}
          title="当前分支：只看从 HEAD 可达的提交历史"
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 transition-colors ${
            headActive
              ? 'bg-[#3574F0]/20 border-[#3574F0] text-blue-300'
              : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
          }`}
        >
          <GitBranch className="w-3 h-3 text-[#3574F0] shrink-0" />
          <span>当前分支</span>
        </button>

        {/* 分支筛选胶囊 */}
        <div className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
          selectedBranch !== 'All' 
            ? 'bg-[#3574F0]/20 border-[#3574F0] text-blue-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <GitBranch className="w-3 h-3 text-[#3574F0] shrink-0" />
          <span className="text-[#8C9099]">Branch:</span>
          <select 
            value={selectedBranch}
            onChange={(e) => onBranchChange(e.target.value)}
            className="bg-transparent border-none text-[11px] focus:outline-none cursor-pointer text-[#DFE1E5] font-medium"
          >
            <option value="All" className="bg-[#2B2D30]">All Branches</option>
            <option value="Head" className="bg-[#2B2D30]">HEAD (Current)</option>
            {branches.map(b => (
              <option key={b} value={b} className="bg-[#2B2D30]">{b}</option>
            ))}
          </select>
        </div>

        {/* 作者筛选胶囊 */}
        <div className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
          selectedAuthor !== 'All' 
            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <User className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[#8C9099]">User:</span>
          <select 
            value={selectedAuthor}
            onChange={(e) => onAuthorChange(e.target.value)}
            className="bg-transparent border-none text-[11px] focus:outline-none cursor-pointer text-[#DFE1E5] font-medium"
          >
            <option value="All" className="bg-[#2B2D30]">All Users</option>
            {authorOptions.map(a => (
              <option key={a} value={a} className="bg-[#2B2D30]">{a}</option>
            ))}
          </select>
        </div>

        {/* 日期筛选胶囊 */}
        <div className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
          selectedDate !== 'All' 
            ? 'bg-purple-500/20 border-purple-500 text-purple-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <Calendar className="w-3 h-3 text-purple-400 shrink-0" />
          <span className="text-[#8C9099]">Date:</span>
          <select
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="bg-transparent border-none text-[11px] focus:outline-none cursor-pointer text-[#DFE1E5] font-medium"
          >
            <option value="All" className="bg-[#2B2D30]">All</option>
            <option value="Today" className="bg-[#2B2D30]">Today</option>
            <option value="Last 7 Days" className="bg-[#2B2D30]">Last 7 Days</option>
            <option value="Last 30 Days" className="bg-[#2B2D30]">Last 30 Days</option>
          </select>
        </div>

        {/* 路径筛选胶囊 */}
        <div className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] transition-colors ${
          pathQuery.trim() !== '' 
            ? 'bg-amber-500/20 border-amber-500 text-amber-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <FolderTree className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-[#8C9099]">Paths:</span>
          <input
            value={pathQuery}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder="All"
            className="w-20 bg-transparent border-none text-[11px] focus:outline-none text-[#DFE1E5] placeholder-[#6F737A]"
          />
        </div>

        {/* 重置过滤器 */}
        {isFiltered && (
          <button
            onClick={handleResetFilters}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-[#8C9099] hover:text-[#DFE1E5] hover:bg-[#2B2D30] transition-colors"
            title="重置所有筛选条件"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* 右侧关键词搜索框 */}
      <div className="relative w-64 shrink-0">
        <Search className="w-3 h-3 text-[#6F737A] absolute left-2 top-1/2 -translate-y-1/2" />
        <input 
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="搜索提交说明、哈希、作者..."
          className="w-full bg-[#2B2D30] border border-[#393B40] rounded pl-7 pr-6 py-0.5 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0] transition-colors h-6"
        />
        {searchQuery && (
          <button 
            onClick={() => onSearchChange('')}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#8C9099] hover:text-[#DFE1E5] p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
