import React from 'react';
import { Search, GitBranch, User, Calendar, FolderTree, RotateCcw, X, Star } from 'lucide-react';
import { useI18n } from '../../i18n/react';

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
  const { t } = useI18n();
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
    <div className="h-8 min-w-0 bg-[#1E1F22] border-b border-[#303236] flex items-center justify-between px-2.5 text-xs gap-2 select-none shrink-0">
      {/* 左侧各维度筛选胶囊：不收缩，窄宽度横向滚动，避免中文按字折成竖排 */}
      <div className="flex items-center space-x-1.5 flex-1 min-w-0 overflow-x-auto no-scrollbar">
        <button
          type="button"
          disabled={!currentUser}
          onClick={() => onAuthorChange(meActive ? 'All' : currentUser)}
          title={currentUser ? t('filter.mineTitle', { user: currentUser }) : t('filter.mineMissing')}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 transition-colors ${
            meActive
              ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300'
              : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157] disabled:opacity-40 disabled:cursor-not-allowed'
          }`}
        >
          <Star className={`w-3 h-3 shrink-0 ${meActive ? 'fill-amber-400 text-amber-400' : 'text-amber-400'}`} />
          <span>{t('filter.mine')}</span>
        </button>

        <button
          type="button"
          onClick={() => onBranchChange(headActive ? 'All' : 'Head')}
          title={t('filter.headTitle')}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 transition-colors ${
            headActive
              ? 'bg-[#3574F0]/20 border-[#3574F0] text-blue-300'
              : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
          }`}
        >
          <GitBranch className="w-3 h-3 text-[#3574F0] shrink-0" />
          <span>{t('filter.head')}</span>
        </button>

        {/* 分支筛选胶囊 */}
        <div
          title={t('filter.branch')}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 whitespace-nowrap transition-colors ${
          selectedBranch !== 'All' 
            ? 'bg-[#3574F0]/20 border-[#3574F0] text-blue-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <GitBranch className="w-3 h-3 text-[#3574F0] shrink-0" />
          <select 
            value={selectedBranch}
            onChange={(e) => onBranchChange(e.target.value)}
            aria-label={t('filter.branch')}
            title={t('filter.branch')}
            className="bg-transparent border-none text-[11px] whitespace-nowrap focus:outline-none cursor-pointer text-[#DFE1E5] font-medium"
          >
            <option value="All" className="bg-[#2B2D30]">{t('filter.allBranches')}</option>
            <option value="Head" className="bg-[#2B2D30]">{t('filter.headOption')}</option>
            {selectedBranch !== 'All' && selectedBranch !== 'Head' && !branches.includes(selectedBranch) && (
              <option value={selectedBranch} className="bg-[#2B2D30]">{selectedBranch}</option>
            )}
            {branches.map(b => (
              <option key={b} value={b} className="bg-[#2B2D30]">{b}</option>
            ))}
          </select>
        </div>

        {/* 作者筛选胶囊 */}
        <div
          title={t('filter.user')}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 whitespace-nowrap transition-colors ${
          selectedAuthor !== 'All' 
            ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <User className="w-3 h-3 text-emerald-400 shrink-0" />
          <select 
            value={selectedAuthor}
            onChange={(e) => onAuthorChange(e.target.value)}
            aria-label={t('filter.user')}
            title={t('filter.user')}
            className="bg-transparent border-none text-[11px] whitespace-nowrap focus:outline-none cursor-pointer text-[#DFE1E5] font-medium"
          >
            <option value="All" className="bg-[#2B2D30]">{t('filter.allUsers')}</option>
            {authorOptions.map(a => (
              <option key={a} value={a} className="bg-[#2B2D30]">{a}</option>
            ))}
          </select>
        </div>

        {/* 日期筛选胶囊 */}
        <div
          title={t('filter.date')}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 whitespace-nowrap transition-colors ${
          selectedDate !== 'All' 
            ? 'bg-purple-500/20 border-purple-500 text-purple-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <Calendar className="w-3 h-3 text-purple-400 shrink-0" />
          <select
            value={selectedDate}
            onChange={(e) => onDateChange(e.target.value)}
            aria-label={t('filter.date')}
            title={t('filter.date')}
            className="bg-transparent border-none text-[11px] whitespace-nowrap focus:outline-none cursor-pointer text-[#DFE1E5] font-medium"
          >
            <option value="All" className="bg-[#2B2D30]">{t('filter.all')}</option>
            <option value="Today" className="bg-[#2B2D30]">{t('filter.today')}</option>
            <option value="Last 7 Days" className="bg-[#2B2D30]">{t('filter.last7')}</option>
            <option value="Last 30 Days" className="bg-[#2B2D30]">{t('filter.last30')}</option>
          </select>
        </div>

        {/* 路径筛选胶囊 */}
        <div
          title={t('filter.pathsHint')}
          className={`flex items-center space-x-1 px-2 py-0.5 rounded border text-[11px] shrink-0 whitespace-nowrap transition-colors ${
          pathQuery.trim() !== '' 
            ? 'bg-amber-500/20 border-amber-500 text-amber-300' 
            : 'bg-[#2B2D30]/80 border-[#393B40] text-[#9DA0A8] hover:border-[#4E5157]'
        }`}>
          <FolderTree className="w-3 h-3 text-amber-400 shrink-0" />
          <input
            value={pathQuery}
            onChange={(e) => onPathChange(e.target.value)}
            placeholder={t('filter.all')}
            aria-label={t('filter.paths')}
            title={t('filter.pathsHint')}
            className="w-20 shrink-0 whitespace-nowrap bg-transparent border-none text-[11px] focus:outline-none text-[#DFE1E5] placeholder-[#6F737A]"
          />
        </div>

        {/* 重置过滤器 */}
        {isFiltered && (
          <button
            onClick={handleResetFilters}
            className="flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] text-[#8C9099] hover:text-[#DFE1E5] hover:bg-[#2B2D30] transition-colors shrink-0 whitespace-nowrap"
            title={t('filter.resetTitle')}
          >
            <RotateCcw className="w-2.5 h-2.5" />
            <span>{t('filter.reset')}</span>
          </button>
        )}
      </div>

      {/* 右侧关键词搜索框 */}
      <div className="relative w-64 min-w-[9rem] max-w-64 shrink">
        <Search className="w-3 h-3 text-[#6F737A] absolute left-2 top-1/2 -translate-y-1/2" />
        <input 
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('filter.search')}
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
