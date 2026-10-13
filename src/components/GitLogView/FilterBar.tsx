import React from 'react';
import { Search, Filter, GitBranch, User, Calendar, FolderTree, RotateCcw } from 'lucide-react';

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
}) => {
  return (
    <div className="h-9 bg-jb-panel/60 border-b border-jb-border flex items-center justify-between px-3 text-xs gap-2 select-none">
      <div className="flex items-center space-x-2 flex-1 overflow-x-auto">
        <span className="text-jb-text-muted flex items-center space-x-1 text-[11px] font-medium uppercase tracking-wider">
          <Filter className="w-3 h-3 text-jb-blue" />
          <span>Filter:</span>
        </span>

        {/* 分支过滤器 */}
        <div className="flex items-center space-x-1 bg-jb-bg border border-jb-border rounded px-2 py-1 text-jb-text-primary hover:border-jb-borderHover">
          <GitBranch className="w-3 h-3 text-jb-blue" />
          <span className="text-jb-text-muted text-[11px]">Branch:</span>
          <select 
            value={selectedBranch}
            onChange={(e) => onBranchChange(e.target.value)}
            className="bg-transparent border-none text-xs focus:outline-none cursor-pointer text-jb-text-primary font-medium"
          >
            <option value="All" className="bg-jb-panel">All Branches</option>
            <option value="Head" className="bg-jb-panel">HEAD (Current)</option>
            {branches.map(b => (
              <option key={b} value={b} className="bg-jb-panel">{b}</option>
            ))}
          </select>
        </div>

        {/* 提交者过滤器 */}
        <div className="flex items-center space-x-1 bg-jb-bg border border-jb-border rounded px-2 py-1 text-jb-text-primary hover:border-jb-borderHover">
          <User className="w-3 h-3 text-emerald-400" />
          <span className="text-jb-text-muted text-[11px]">User:</span>
          <select 
            value={selectedAuthor}
            onChange={(e) => onAuthorChange(e.target.value)}
            className="bg-transparent border-none text-xs focus:outline-none cursor-pointer text-jb-text-primary font-medium"
          >
            <option value="All" className="bg-jb-panel">All Users</option>
            {authors.map(a => (
              <option key={a} value={a} className="bg-jb-panel">{a}</option>
            ))}
          </select>
        </div>

        {/* 日期过滤器 */}
        <div className="flex items-center space-x-1 bg-jb-bg border border-jb-border rounded px-2 py-1 text-jb-text-primary hover:border-jb-borderHover">
          <Calendar className="w-3 h-3 text-purple-400" />
          <span className="text-jb-text-muted text-[11px]">Date:</span>
          <select
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            className="bg-transparent border-none text-xs focus:outline-none cursor-pointer text-jb-text-primary font-medium"
          >
            <option value="All" className="bg-jb-panel">All</option>
            <option value="Today" className="bg-jb-panel">Today</option>
            <option value="Last 7 Days" className="bg-jb-panel">Last 7 Days</option>
            <option value="Last 30 Days" className="bg-jb-panel">Last 30 Days</option>
          </select>
        </div>

        <div className="flex items-center space-x-1 bg-jb-bg border border-jb-border rounded px-2 py-1 text-jb-text-primary hover:border-jb-borderHover">
          <FolderTree className="w-3 h-3 text-jb-orange" />
          <span className="text-jb-text-muted text-[11px]">Paths:</span>
          <input
            value={pathQuery}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder="All"
            className="w-28 bg-transparent border-none text-xs focus:outline-none text-jb-text-primary placeholder-jb-text-muted"
          />
        </div>
      </div>

      {/* 关键字搜索框 */}
      <div className="relative w-64">
        <Search className="w-3.5 h-3.5 text-jb-text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input 
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search message, hash, author..."
          className="w-full bg-jb-bg border border-jb-border rounded pl-8 pr-7 py-1 text-xs text-jb-text-primary placeholder-jb-text-muted focus:outline-none focus:border-jb-blue transition-colors"
        />
        {searchQuery && (
          <button 
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-jb-text-muted hover:text-jb-text-primary"
          >
            ×
          </button>
        )}
      </div>
    </div>
  );
};
