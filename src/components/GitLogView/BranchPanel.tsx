import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, GitTag } from '../../types/git';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FolderGit2,
  GitBranch as BranchIcon,
  Search,
  Star,
  Tag,
  X,
} from 'lucide-react';
import { useI18n } from '../../i18n/react';

interface BranchPanelProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  branches: GitBranch[];
  tags: GitTag[];
  currentBranch: string;
  selectedRef: string;
  onSelectRef: (name: string) => void;
  onCheckout?: (name: string) => void;
  onCompare?: (name: string) => void;
  onMerge?: (name: string) => void;
  onRebase?: (name: string) => void;
}

interface RemoteGroup {
  name: string;
  branches: { fullName: string; shortName: string; branch: GitBranch }[];
}

interface MenuState {
  x: number;
  y: number;
  kind: 'branch' | 'tag';
  name: string;
  checkoutName: string;
  isCurrent: boolean;
}

function groupRemotes(branches: GitBranch[]): RemoteGroup[] {
  const map = new Map<string, RemoteGroup>();
  for (const branch of branches) {
    if (!branch.isRemote) continue;
    const slash = branch.name.indexOf('/');
    const remote = slash > 0 ? branch.name.slice(0, slash) : branch.name;
    const shortName = slash > 0 ? branch.name.slice(slash + 1) : branch.name;
    const group = map.get(remote) ?? { name: remote, branches: [] };
    group.branches.push({ fullName: branch.name, shortName, branch });
    map.set(remote, group);
  }
  return Array.from(map.values())
    .map(group => ({
      ...group,
      branches: [...group.branches].sort((a, b) => a.shortName.localeCompare(b.shortName)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function matches(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

function AheadBehind({ ahead, behind }: { ahead?: number; behind?: number }) {
  if (!ahead && !behind) return null;
  return (
    <span className="shrink-0 font-mono text-[10px] flex items-center gap-1">
      {ahead ? <span className="text-jb-blue">↑{ahead}</span> : null}
      {behind ? <span className="text-jb-orange">↓{behind}</span> : null}
    </span>
  );
}

export const BranchPanel: React.FC<BranchPanelProps> = ({
  collapsed,
  onToggleCollapsed,
  branches,
  tags,
  currentBranch,
  selectedRef,
  onSelectRef,
  onCheckout,
  onCompare,
  onMerge,
  onRebase,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState({ head: true, local: true, remote: true, tags: true });
  const [openRemotes, setOpenRemotes] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;

  const localBranches = useMemo(() => {
    return branches
      .filter(branch => !branch.isRemote)
      .slice()
      .sort((a, b) => {
        const aCurrent = a.isCurrent || a.name === currentBranch;
        const bCurrent = b.isCurrent || b.name === currentBranch;
        if (aCurrent !== bCurrent) return aCurrent ? -1 : 1;
        if (Boolean(a.isFavorite) !== Boolean(b.isFavorite)) return a.isFavorite ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [branches, currentBranch]);

  const remotes = useMemo(() => groupRemotes(branches), [branches]);
  const visibleLocal = searching ? localBranches.filter(branch => matches(branch.name, q)) : localBranches;
  const visibleRemotes = useMemo(() => {
    if (!searching) return remotes;
    return remotes
      .map(group => {
        if (matches(group.name, q)) return group;
        return { ...group, branches: group.branches.filter(item => matches(item.shortName, q) || matches(item.fullName, q)) };
      })
      .filter(group => group.branches.length > 0 || matches(group.name, q));
  }, [remotes, q, searching]);
  const visibleTags = searching ? tags.filter(tag => matches(tag.name, q)) : tags;
  const detached = !currentBranch || currentBranch === 'HEAD';
  const headLabel = detached ? t('logBranches.detached') : currentBranch;
  const headBranch = localBranches.find(branch => branch.isCurrent || branch.name === currentBranch);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onPointer = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      close();
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('easygit:dismiss', close);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('easygit:dismiss', close);
    };
  }, [menu]);

  const toggleSection = (key: keyof typeof open) => {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleRemote = (name: string) => {
    setOpenRemotes(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const selectRef = (name: string) => {
    onSelectRef(selectedRef === name ? 'All' : name);
  };

  const openMenu = (event: React.MouseEvent, next: Omit<MenuState, 'x' | 'y'>) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      ...next,
      x: Math.min(event.clientX, window.innerWidth - 196),
      y: Math.min(event.clientY, window.innerHeight - 180),
    });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapsed}
        title={t('logBranches.expand')}
        className="h-full w-full bg-[#1E1F22] border-r border-[#303236] flex flex-col items-center py-2 gap-2 text-[#9DA0A8] hover:text-[#DFE1E5] hover:bg-[#2B2D30] overflow-hidden"
      >
        <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        <span className="text-[11px]" style={{ writingMode: 'vertical-rl' }}>{t('logBranches.title')}</span>
      </button>
    );
  }

  const sectionOpen = (key: keyof typeof open, hasItems: boolean) => (searching ? hasItems : open[key]);

  return (
    <div className="h-full min-h-0 bg-[#1E1F22] flex flex-col text-xs select-none">
      <div className="h-7 px-2 flex items-center justify-between border-b border-[#303236] bg-[#2B2D30]/80 shrink-0">
        <span className="text-[11px] font-semibold text-[#DFE1E5]">{t('logBranches.title')}</span>
        <button
          type="button"
          onClick={onToggleCollapsed}
          title={t('logBranches.collapse')}
          className="p-0.5 rounded text-[#8C9099] hover:text-[#DFE1E5] hover:bg-[#35373C]"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-2 py-1.5 border-b border-[#303236] shrink-0">
        <div className="relative">
          <Search className="w-3 h-3 text-[#6F737A] absolute left-1.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('logBranches.search')}
            className="w-full h-6 bg-[#2B2D30] border border-[#393B40] rounded pl-6 pr-6 text-[11px] text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-[#8C9099] hover:text-[#DFE1E5]"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1" onScroll={() => setMenu(null)}>
        <SectionHeader
          label={t('logBranches.head')}
          open={sectionOpen('head', true)}
          onToggle={() => toggleSection('head')}
        />
        {sectionOpen('head', true) && (
          <TreeRow
            indent={18}
            selected={selectedRef === 'Head'}
            title={headLabel}
            icon={<span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
            label={headLabel}
            trailing={<AheadBehind ahead={headBranch?.ahead} behind={headBranch?.behind} />}
            onClick={() => selectRef('Head')}
          />
        )}

        <SectionHeader
          label={t('logBranches.local')}
          count={visibleLocal.length}
          open={sectionOpen('local', visibleLocal.length > 0)}
          onToggle={() => toggleSection('local')}
        />
        {sectionOpen('local', visibleLocal.length > 0) && visibleLocal.map(branch => {
          const isCurrent = branch.isCurrent || branch.name === currentBranch;
          return (
            <TreeRow
              key={branch.name}
              indent={18}
              selected={selectedRef === branch.name}
              title={branch.lastCommitMessage || branch.name}
              icon={<BranchIcon className={`w-3 h-3 shrink-0 ${isCurrent ? 'text-emerald-400' : 'text-[#7AA2F7]'}`} />}
              label={branch.name}
              trailing={
                <span className="flex items-center gap-1 shrink-0">
                  {isCurrent && <span className="text-[10px] text-emerald-300">{t('logBranches.current')}</span>}
                  {branch.isFavorite && <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />}
                  <AheadBehind ahead={branch.ahead} behind={branch.behind} />
                </span>
              }
              onClick={() => selectRef(branch.name)}
              onContextMenu={(event) => openMenu(event, {
                kind: 'branch',
                name: branch.name,
                checkoutName: branch.name,
                isCurrent,
              })}
            />
          );
        })}

        <SectionHeader
          label={t('logBranches.remote')}
          count={visibleRemotes.length}
          open={sectionOpen('remote', visibleRemotes.length > 0)}
          onToggle={() => toggleSection('remote')}
        />
        {sectionOpen('remote', visibleRemotes.length > 0) && visibleRemotes.map(group => {
          const expanded = searching || openRemotes.has(group.name);
          return (
            <div key={group.name}>
              <TreeRow
                indent={18}
                selected={false}
                title={group.name}
                icon={expanded
                  ? <ChevronDown className="w-3 h-3 shrink-0 text-[#8C9099]" />
                  : <ChevronRight className="w-3 h-3 shrink-0 text-[#8C9099]" />}
                label={group.name}
                labelClass="font-sans"
                trailing={
                  <span className="flex items-center gap-1 shrink-0 text-[#6F737A]">
                    <FolderGit2 className="w-3 h-3" />
                    <span className="font-mono text-[10px]">{group.branches.length}</span>
                  </span>
                }
                onClick={() => toggleRemote(group.name)}
              />
              {expanded && group.branches.length === 0 && (
                <div className="h-[22px] pl-10 pr-2 flex items-center text-[11px] text-[#6F737A]">{t('logBranches.noBranches')}</div>
              )}
              {expanded && group.branches.map(item => (
                <TreeRow
                  key={item.fullName}
                  indent={34}
                  selected={selectedRef === item.fullName}
                  title={item.branch.lastCommitMessage || item.fullName}
                  icon={<BranchIcon className="w-3 h-3 shrink-0 text-purple-300" />}
                  label={item.shortName}
                  onClick={() => selectRef(item.fullName)}
                  onContextMenu={(event) => openMenu(event, {
                    kind: 'branch',
                    name: item.fullName,
                    checkoutName: item.fullName,
                    isCurrent: false,
                  })}
                />
              ))}
            </div>
          );
        })}

        <SectionHeader
          label={t('logBranches.tags')}
          count={visibleTags.length}
          open={sectionOpen('tags', visibleTags.length > 0)}
          onToggle={() => toggleSection('tags')}
        />
        {sectionOpen('tags', visibleTags.length > 0) && visibleTags.map(tag => (
          <TreeRow
            key={tag.name}
            indent={18}
            selected={selectedRef === tag.name}
            title={tag.subject || tag.name}
            icon={<Tag className="w-3 h-3 shrink-0 text-amber-300" />}
            label={tag.name}
            onClick={() => selectRef(tag.name)}
            onContextMenu={(event) => openMenu(event, {
              kind: 'tag',
              name: tag.name,
              checkoutName: tag.hash || tag.name,
              isCurrent: false,
            })}
          />
        ))}

        {searching && visibleLocal.length === 0 && visibleRemotes.length === 0 && visibleTags.length === 0 && (
          <div className="px-3 py-4 text-center text-[11px] text-[#6F737A]">{t('logBranches.empty')}</div>
        )}
      </div>

      {menu && (
        <div
          ref={menuRef}
          className="fixed z-50 w-44 bg-jb-panel border border-jb-border rounded-md shadow-2xl py-1 text-xs text-jb-text-primary"
          style={{ left: menu.x, top: menu.y }}
        >
          <div className="px-3 py-1 font-mono text-[11px] text-jb-text-muted truncate border-b border-jb-border/60">{menu.name}</div>
          <MenuButton label={t('logBranches.showLog')} onClick={() => { onSelectRef(menu.name); setMenu(null); }} />
          <MenuButton
            label={t('logBranches.checkout')}
            disabled={menu.isCurrent || !onCheckout}
            onClick={() => { onCheckout?.(menu.checkoutName); setMenu(null); }}
          />
          <MenuButton
            label={t('logBranches.compare')}
            disabled={menu.isCurrent || !onCompare}
            onClick={() => { onCompare?.(menu.name); setMenu(null); }}
          />
          {menu.kind === 'branch' && (
            <>
              <MenuButton
                label={t('logBranches.merge')}
                disabled={menu.isCurrent || !onMerge}
                onClick={() => { onMerge?.(menu.name); setMenu(null); }}
              />
              <MenuButton
                label={t('logBranches.rebase')}
                disabled={menu.isCurrent || !onRebase}
                onClick={() => { onRebase?.(menu.name); setMenu(null); }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

function SectionHeader({
  label,
  count,
  open,
  onToggle,
}: {
  label: string;
  count?: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full h-[22px] px-1.5 flex items-center gap-1 text-[12px] text-[#BBBEC4] hover:bg-[#2B2D30]"
    >
      {open ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
      <span className="truncate">{label}</span>
      {count != null && <span className="ml-auto pr-1 text-[10px] text-[#6F737A] font-mono">{count}</span>}
    </button>
  );
}

function TreeRow({
  indent,
  selected,
  title,
  icon,
  label,
  labelClass = 'font-mono',
  trailing,
  onClick,
  onContextMenu,
}: {
  indent: number;
  selected: boolean;
  title: string;
  icon: React.ReactNode;
  label: string;
  labelClass?: string;
  trailing?: React.ReactNode;
  onClick: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={`h-[22px] pr-1.5 flex items-center gap-1.5 cursor-pointer min-w-0 ${
        selected ? 'bg-jb-selected text-white' : 'text-[#DFE1E5] hover:bg-[#2B2D30]'
      }`}
      style={{ paddingLeft: indent }}
    >
      {icon}
      <span className={`truncate text-[12px] flex-1 ${labelClass}`}>{label}</span>
      {trailing}
    </div>
  );
}

function MenuButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-jb-selected hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-jb-text-primary"
    >
      {label}
    </button>
  );
}
