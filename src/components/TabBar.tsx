import React from 'react';
import { 
  GitGraph, 
  CheckSquare, 
  GitFork, 
  Archive, 
  GitMerge, 
  HelpCircle,
  Monitor,
  Globe
} from 'lucide-react';
import { isTauriEnvironment } from '../services/gitService';

export type ActiveTab = 'log' | 'commit' | 'branches' | 'shelf' | 'merge';

interface TabBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  changesCount: number;
}

export const TabBar: React.FC<TabBarProps> = ({
  activeTab,
  onTabChange,
  changesCount
}) => {
  const tabs = [
    { 
      id: 'log' as ActiveTab, 
      label: 'Git Log', 
      shortcut: 'Alt+9', 
      icon: GitGraph 
    },
    { 
      id: 'commit' as ActiveTab, 
      label: 'Commit & Diff', 
      shortcut: 'Alt+0', 
      icon: CheckSquare,
      badge: changesCount > 0 ? changesCount : undefined 
    },
    { 
      id: 'branches' as ActiveTab, 
      label: 'Branches', 
      shortcut: '', 
      icon: GitFork 
    },
    { 
      id: 'shelf' as ActiveTab, 
      label: 'Shelf & Stash', 
      shortcut: '', 
      icon: Archive 
    },
    { 
      id: 'merge' as ActiveTab, 
      label: '3-Way Merge (冲突解决)', 
      shortcut: '', 
      icon: GitMerge,
      highlight: true
    },
  ];

  return (
    <div className="h-9 bg-jb-panel/90 border-b border-jb-border flex items-center justify-between px-2 select-none">
      <div className="flex items-center space-x-1 h-full">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`h-full flex items-center space-x-1.5 px-3 border-b-2 text-xs transition-colors font-medium relative ${
                isActive
                  ? 'border-jb-blue text-jb-text-primary bg-jb-bg/40'
                  : 'border-transparent text-jb-text-secondary hover:text-jb-text-primary hover:bg-jb-hover/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-jb-blue' : tab.highlight ? 'text-purple-400' : 'text-jb-text-muted'}`} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-jb-blue/20 text-jb-blue border border-jb-blue/40 font-mono">
                  {tab.badge}
                </span>
              )}
              {tab.shortcut && (
                <span className="text-[10px] text-jb-text-muted ml-1 hidden sm:inline font-mono">
                  ({tab.shortcut})
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center space-x-2 text-xs text-jb-text-muted pr-2">
        <span className="flex items-center space-x-1.5 font-mono text-[11px]">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[#DFE1E5]">
            {isTauriEnvironment() ? 'Tauri 2.0 Native' : 'Git 2.34.1 Ready'}
          </span>
          <span className="text-[10px] text-[#6F737A] bg-[#1E1F22] px-1 rounded border border-[#393B40]">
            {isTauriEnvironment() ? 'Desktop' : 'Web'}
          </span>
        </span>
      </div>
    </div>
  );
};
