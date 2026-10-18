import React, { useEffect, useState, useMemo, useRef } from 'react';
import { FileChange, FileChangeStatus } from '../../types/git';
import { FilePathDisplay } from '../common/FilePathDisplay';
import { 
  ChevronDown, 
  ChevronRight, 
  Folder, 
  RotateCcw, 
  RefreshCw, 
  Eye, 
  Maximize2, 
  Minimize2, 
  FileCode,
  Check,
  Minus
} from 'lucide-react';
import { askConfirm } from '../common/askConfirm';
import { askInput } from '../common/askInput';
import { useI18n } from '../../i18n/react';

interface ChangelistTreeProps {
  changes: FileChange[];
  selectedFileId: string;
  onSelectFile: (file: FileChange) => void;
  onToggleFileStage: (fileId: string) => void;
  onBatchToggleStage?: (fileIds: string[], targetStaged: boolean) => void;
  onRollbackSelected: () => void;
  onRefresh?: () => void;
  onAddToGitignore?: (path: string) => void;
  onDeleteUnversioned?: (file: FileChange) => void;
  repoKey?: string;
}

// 内部树节点结构
interface TreeNode {
  key: string;
  name: string; // 显示名字（支持紧凑合并如 "src\main"）
  fullPath: string;
  isFolder: boolean;
  file?: FileChange;
  children: TreeNode[];
  fileCount: number; // 包含的文件总数
  submoduleTag?: string; // 如 eam-agent
}

/**
 * 这两个是**状态值与持久化值**，不只是展示文案。
 * 展示走 t('changes.default') / t('changes.all')；比较与存储必须用常量，
 * 改了会让老用户的 localStorage 数据失配（见 §E R-E5）。
 */
const DEFAULT_LIST = '更改';
const ALL_LISTS = '全部';

const NEW_LIST = '__new__';
const MOVE_HERE = '__move__';
const RENAME_LIST = '__rename__';
const DELETE_LIST = '__delete__';

/** 重命名/删除时把 assignments 里的旧名换掉。 */
function remapAssignments(
  map: Record<string, string>,
  from: string,
  to: string,
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [path, list] of Object.entries(map)) {
    next[path] = list === from ? to : list;
  }
  return next;
}

export const ChangelistTree: React.FC<ChangelistTreeProps> = ({
  changes,
  selectedFileId,
  onSelectFile,
  onToggleFileStage,
  onBatchToggleStage,
  onRollbackSelected,
  onRefresh,
  onAddToGitignore,
  onDeleteUnversioned,
  repoKey = 'default',
}) => {
  const { t } = useI18n();
  const treeRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    path: string;
    isFolder: boolean;
    file?: FileChange;
  } | null>(null);
  const storageKey = `snailgit.changelists.${repoKey}`;
  const [changelistNames, setChangelistNames] = useState<string[]>([DEFAULT_LIST]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [activeList, setActiveList] = useState(ALL_LISTS);

  useEffect(() => {
    // 换仓库时必须重置：否则上一个仓库的列表会被写进新仓库的 key。
    setChangelistNames([DEFAULT_LIST]);
    setAssignments({});
    setActiveList(ALL_LISTS);
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { names?: string[]; assignments?: Record<string, string> };
      // 老数据里 names 已经含默认列表，这里去重并保证默认列表存在。
      if (parsed.names?.length) setChangelistNames(Array.from(new Set([DEFAULT_LIST, ...parsed.names])));
      if (parsed.assignments) setAssignments(parsed.assignments);
    } catch {
      /* 本地列表损坏时退回默认列表 */
    }
  }, [storageKey]);

  const persistLists = (names: string[], map: Record<string, string>) => {
    setChangelistNames(names);
    setAssignments(map);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ names, assignments: map }));
    } catch {
      /* 浏览器禁止本地存储时，列表只在当前会话有效 */
    }
  };

  /** 默认列表与全部视图不能改名、不能删。 */
  const canEditActiveList = activeList !== DEFAULT_LIST && activeList !== ALL_LISTS;

  const renameActiveList = () => {
    if (!canEditActiveList) return;
    const current = activeList;
    void askInput({
      title: t('changes.renameListPrompt', { name: current }),
      defaultValue: current,
      confirmLabel: t('common.rename'),
      tone: 'primary',
      validate: (next) => (next !== current && changelistNames.includes(next)
        ? t('changes.listExists', { name: next })
        : null),
    }).then(next => {
      if (!next || next === current) return;
      persistLists(
        changelistNames.map(name => (name === current ? next : name)),
        remapAssignments(assignments, current, next),
      );
      setActiveList(next);
    });
  };

  const deleteActiveList = () => {
    if (!canEditActiveList) return;
    const target = activeList;
    const count = Object.values(assignments).filter(name => name === target).length;
    void askConfirm({
      title: t('changes.deleteListTitle'),
      message: t('changes.deleteListConfirm', { name: target, count }),
      confirmLabel: t('common.delete'),
      tone: 'danger',
    }).then(ok => {
      if (!ok) return;
      // 删除后文件回默认列表；视图切到全部，避免看到一个空白列表。
      persistLists(
        changelistNames.filter(name => name !== target),
        remapAssignments(assignments, target, DEFAULT_LIST),
      );
      setActiveList(ALL_LISTS);
    });
  };
  // 视图模式：树状视图 (tree) vs 扁平列表 (flat)
  const [viewMode, setViewMode] = useState<'tree' | 'flat'>('tree');
  const [compactMiddleFolders, setCompactMiddleFolders] = useState(true);
  const [showViewMenu, setShowViewMenu] = useState(false);

  // 展开的节点集合
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set([
    'tracked-root',
    'untracked-root',
    'eam-agent',
    'eam-agent/src/main',
    'eam-agent/src/main/resources',
    'eam-agent/src/main/resources/delivery-schemas/ontology-capability-builder/schemas',
    'eam-agent/src/main/resources/prompts/delivery',
  ]));

  // 当前高亮选中的节点 key（可能是目录也可以是文件）
  const [selectedKey, setSelectedKey] = useState<string>(
    'eam-agent/src/main/java/com/uinnova/product/eam/agent'
  );

  const visibleChanges = changes.filter(file => {
    if (activeList === ALL_LISTS) return true;
    return (assignments[file.path] || DEFAULT_LIST) === activeList;
  });
  const trackedFiles = visibleChanges.filter(c => c.status !== 'untracked');
  const untrackedFiles = visibleChanges.filter(c => c.status === 'untracked');

  // 构建树形结构并执行紧凑折叠算法
  const buildTree = (fileList: FileChange[]): TreeNode[] => {
    interface RawNode {
      name: string;
      fullPath: string;
      isFolder: boolean;
      file?: FileChange;
      childrenMap: Map<string, RawNode>;
      submoduleTag?: string;
    }

    const rootMap = new Map<string, RawNode>();

    fileList.forEach(file => {
      // 忽略末尾斜杠产生的空段，避免未跟踪目录被画成没有名字的文件。
      const parts = file.path.split(/[/\\]/).filter(part => part.length > 0);
      if (parts.length === 0) return;
      let currentMap = rootMap;
      let pathAccum = '';

      parts.forEach((part, index) => {
        pathAccum = pathAccum ? `${pathAccum}/${part}` : part;
        const isLast = index === parts.length - 1;

        if (!currentMap.has(part)) {
          currentMap.set(part, {
            name: part,
            fullPath: pathAccum,
            isFolder: !isLast,
            file: isLast ? file : undefined,
            childrenMap: new Map(),
            submoduleTag: index === 0 ? part : undefined,
          });
        }
        currentMap = currentMap.get(part)!.childrenMap;
      });
    });

    // 递归转换并进行 compact 紧凑包折叠
    const convert = (node: RawNode): TreeNode => {
      let rawChildren = Array.from(node.childrenMap.values()).map(convert);

      // 紧凑折叠：如果该节点是目录，且只有一个子节点也是目录，则合并两层为 "a\b"
      let displayName = node.name;
      let currentFull = node.fullPath;
      let currentTag = node.submoduleTag;

      if (compactMiddleFolders && node.isFolder) {
        while (rawChildren.length === 1 && rawChildren[0].isFolder) {
          const onlyChild = rawChildren[0];
          displayName = `${displayName}/${onlyChild.name}`;
          currentFull = onlyChild.fullPath;
          currentTag = currentTag || onlyChild.submoduleTag;
          rawChildren = onlyChild.children;
        }
      }

      // 递归计算文件总数
      let totalFiles: number;
      if (!node.isFolder) {
        totalFiles = 1;
      } else {
        totalFiles = rawChildren.reduce((acc, c) => acc + c.fileCount, 0);
      }

      return {
        key: currentFull,
        name: displayName,
        fullPath: currentFull,
        isFolder: node.isFolder,
        file: node.file,
        children: rawChildren,
        fileCount: totalFiles,
        submoduleTag: currentTag,
      };
    };

    return Array.from(rootMap.values()).map(convert);
  };

  const trackedTree = useMemo(() => buildTree(trackedFiles), [trackedFiles, compactMiddleFolders]);
  const untrackedTree = useMemo(() => buildTree(untrackedFiles), [untrackedFiles, compactMiddleFolders]);

  const findNode = (nodes: TreeNode[], key: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.key === key) return node;
      const found = findNode(node.children, key);
      if (found) return found;
    }
    return null;
  };

  useEffect(() => {
    const dismiss = () => setContextMenu(null);
    window.addEventListener('snailgit:dismiss', dismiss);
    return () => window.removeEventListener('snailgit:dismiss', dismiss);
  }, []);

  // 切换折叠/展开
  const toggleExpand = (key: string) => {
    setExpandedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // 全部展开
  const expandAll = () => {
    const allKeys = new Set<string>(['tracked-root', 'untracked-root']);
    const collect = (nodes: TreeNode[]) => {
      nodes.forEach(n => {
        if (n.isFolder) {
          allKeys.add(n.key);
          collect(n.children);
        }
      });
    };
    collect(trackedTree);
    collect(untrackedTree);
    setExpandedKeys(allKeys);
  };

  // 全部折叠
  const collapseAll = () => {
    setExpandedKeys(new Set(['tracked-root', 'untracked-root']));
  };

  // 递归获取节点下所有文件
  const getAllFilesInNode = (node: TreeNode): FileChange[] => {
    if (!node.isFolder && node.file) return [node.file];
    return node.children.flatMap(getAllFilesInNode);
  };

  // 计算节点的勾选状态 (checked, unchecked, indeterminate)
  const getNodeCheckState = (node: TreeNode): 'checked' | 'unchecked' | 'indeterminate' => {
    if (!node.isFolder && node.file) {
      return node.file.isStaged ? 'checked' : 'unchecked';
    }
    const files = getAllFilesInNode(node);
    if (files.length === 0) return 'unchecked';
    const stagedCount = files.filter(f => f.isStaged).length;
    if (stagedCount === files.length) return 'checked';
    if (stagedCount === 0) return 'unchecked';
    return 'indeterminate';
  };

  // 点击复选框级联控制
  const handleToggleNodeStage = (node: TreeNode) => {
    const currentState = getNodeCheckState(node);
    const targetState = currentState !== 'checked';
    const files = getAllFilesInNode(node);
    if (onBatchToggleStage) {
      onBatchToggleStage(files.map(f => f.id), targetState);
    } else {
      files.forEach(f => {
        if (f.isStaged !== targetState) {
          onToggleFileStage(f.id);
        }
      });
    }
  };

  // 渲染自定义复选框 (IDEA 风格的细白描边框 + 亮蓝勾选)
  const renderCheckbox = (state: 'checked' | 'unchecked' | 'indeterminate') => {
    if (state === 'checked') {
      return (
        <span className="w-3.5 h-3.5 rounded-[2px] bg-[#3574F0] flex items-center justify-center text-white shrink-0 shadow-sm ring-1 ring-blue-400/40">
          <Check className="w-3 h-3 stroke-[3]" />
        </span>
      );
    }
    if (state === 'indeterminate') {
      return (
        <span className="w-3.5 h-3.5 rounded-[2px] bg-[#3574F0] flex items-center justify-center text-white shrink-0 shadow-sm">
          <Minus className="w-3 h-3 stroke-[3]" />
        </span>
      );
    }
    return (
      <span className="w-3.5 h-3.5 rounded-[2px] border border-[#6F737A] hover:border-white bg-[#1E1F22] hover:bg-[#2B2D30] block shrink-0 transition-colors" />
    );
  };

  // 文件图标匹配（完全复刻 IDEA 风格）
  const fileStatusClass = (status?: FileChangeStatus) => {
    switch (status) {
      case 'modified':
        return 'text-[#589DF6]';
      case 'added':
      case 'untracked':
        return 'text-[#59A869]';
      case 'conflict':
        return 'text-[#E35967]';
      case 'deleted':
        return 'text-[#E35967] line-through';
      default:
        return 'text-[#DFE1E5]';
    }
  };

  const openUntrackedMenu = (event: React.MouseEvent, path: string, isFolder: boolean, file?: FileChange) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 220),
      y: Math.min(event.clientY, window.innerHeight - 96),
      path: path.replace(/\\/g, '/'),
      isFolder,
      file,
    });
  };

  const renderFileIcon = (filename: string) => {
    if (filename.endsWith('.json')) {
      return (
        <span className="text-[11px] font-mono font-bold text-fuchsia-400 bg-fuchsia-400/10 px-0.5 rounded shrink-0">
          {`{}`}
        </span>
      );
    }
    if (filename.endsWith('.md')) {
      return (
        <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-400/10 px-0.5 rounded shrink-0 flex items-center">
          <span>M</span><span className="text-[8px]">↓</span>
        </span>
      );
    }
    if (filename.endsWith('.java')) {
      return (
        <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 px-0.5 rounded shrink-0">
          J
        </span>
      );
    }
    return <FileCode className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  };

  // 递归渲染树节点
  const renderTreeNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expandedKeys.has(node.key);
    const checkState = getNodeCheckState(node);
    const isSelected = selectedKey === node.key;
    const nodeFiles = node.isFolder ? getAllFilesInNode(node) : node.file ? [node.file] : [];
    const allUntracked = nodeFiles.length > 0 && nodeFiles.every(file => file.status === 'untracked');

    const handleRowClick = () => {
      treeRef.current?.focus();
      setSelectedKey(node.key);
      if (node.isFolder) {
        toggleExpand(node.key);
        // 如果是目录，也可以把目录下第一个修改文件联动展示到 Diff
        const files = getAllFilesInNode(node);
        if (files.length > 0) {
          onSelectFile(files[0]);
        }
      } else if (node.file) {
        onSelectFile(node.file);
      }
    };

    return (
      <div key={node.key} className="select-none font-sans">
        {/* 节点行 */}
        <div
          onClick={handleRowClick}
          onContextMenu={(event) => {
            if (!allUntracked) return;
            openUntrackedMenu(event, node.isFolder ? node.fullPath : (node.file?.path || node.fullPath), node.isFolder, node.file);
          }}
          className={`flex items-center h-6 min-w-0 overflow-hidden px-1 cursor-pointer transition-colors text-xs group relative ${
            isSelected
              ? 'bg-[#2E436E] text-white font-medium'
              : 'hover:bg-[#2B2D30] text-[#DFE1E5]'
          }`}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          {/* 展开/折叠箭头 */}
          <div className="w-4 h-4 flex items-center justify-center shrink-0">
            {node.isFolder ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(node.key);
                }}
                className="text-[#9DA0A8] hover:text-white"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </button>
            ) : (
              <span className="w-3.5" />
            )}
          </div>

          {/* 复选框 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleNodeStage(node);
            }}
            className="w-3.5 h-3.5 mr-1.5 focus:outline-none flex items-center justify-center shrink-0"
          >
            {renderCheckbox(checkState)}
          </button>

          {/* 文件夹或文件图标 */}
          <div className="mr-1.5 flex items-center shrink-0">
            {node.isFolder ? (
              <Folder className="w-3.5 h-3.5 text-[#9DA0A8] fill-[#9DA0A8]/20" />
            ) : (
              renderFileIcon(node.name)
            )}
          </div>

          {/* 节点名称。窄面板里必须截断，不能换行盖住下一行。 */}
          <span className="mr-1.5 flex-1 min-w-0 overflow-hidden">
            {node.isFolder ? (
              <FilePathDisplay path={node.name} className="block max-w-full truncate" />
            ) : (
              <FilePathDisplay path={node.name} className="block max-w-full truncate" filenameClassName={fileStatusClass(node.file?.status)} />
            )}
          </span>

          {/* 文件总数指示 (e.g. 13 个文件) */}
          {node.isFolder && (
            <span className="text-[11px] text-[#8C9099] shrink-0 whitespace-nowrap font-sans mr-2">
              {t('changes.fileCount', { count: node.fileCount })}
            </span>
          )}

          {/* 模块后缀标签 (如 eam-agent) */}
          {node.submoduleTag && node.isFolder && depth === 0 && (
            <span className="text-[11px] text-[#6F737A] shrink-0 max-w-[40%] truncate font-mono">
              {node.submoduleTag}
            </span>
          )}
        </div>

        {/* 子节点递归渲染 */}
        {node.isFolder && isExpanded && (
          <div>
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={treeRef}
      data-keyboard-root="commit"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== ' ' && event.code !== 'Space') return;
        const target = event.target as HTMLElement;
        if (target.closest('button, input, textarea, select')) return;
        event.preventDefault();
        if (viewMode === 'flat') {
          const file = changes.find(item => item.id === selectedFileId);
          if (file) onToggleFileStage(file.id);
          return;
        }
        const node = findNode(trackedTree, selectedKey) || findNode(untrackedTree, selectedKey);
        if (node) {
          handleToggleNodeStage(node);
          return;
        }
        const file = visibleChanges.find(item => item.id === selectedFileId);
        if (file) onToggleFileStage(file.id);
      }}
      className="flex-1 w-full h-full min-h-0 bg-[#1E1F22] flex flex-col select-none text-xs focus:outline-none"
      onClick={() => setContextMenu(null)}
    >
      {/* 顶部工具栏。窄面板里标签不能换行，否则会叠到图标和树节点上。 */}
      <div className="h-9 shrink-0 px-2 border-b border-[#393B40] flex items-center justify-between gap-1 overflow-hidden bg-[#2B2D30] text-[#9DA0A8]">
        {/* 左侧操作按钮 */}
        <div className="flex items-center shrink-0 space-x-0.5">
          {/* 回滚/撤销 */}
          <button 
            onClick={onRollbackSelected}
            title={t('changes.rollback')}
            className="p-1 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* 刷新 */}
          <button 
            title={t('changes.refresh')}
            onClick={onRefresh}
            className="p-1 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* 视图选项 (眼睛图标) */}
          <div className="relative">
            <button 
              onClick={() => setShowViewMenu(!showViewMenu)}
              title={t('changes.viewOptions')}
              className="p-1 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
            >
              <Eye className="w-3.5 h-3.5" />
            </button>

            {showViewMenu && (
              <div className="absolute left-0 top-full mt-1 w-48 bg-[#2B2D30] border border-[#393B40] rounded shadow-2xl py-1 z-30 text-xs text-[#DFE1E5]">
                <button
                  onClick={() => {
                    setViewMode('tree');
                    setShowViewMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-[#2E436E] flex items-center justify-between ${
                    viewMode === 'tree' ? 'text-[#3574F0] font-semibold' : ''
                  }`}
                >
                  <span>{t('changes.tree')}</span>
                  {viewMode === 'tree' && <Check className="w-3 h-3" />}
                </button>

                <button
                  onClick={() => {
                    setViewMode('flat');
                    setShowViewMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-[#2E436E] flex items-center justify-between ${
                    viewMode === 'flat' ? 'text-[#3574F0] font-semibold' : ''
                  }`}
                >
                  <span>{t('changes.flat')}</span>
                  {viewMode === 'flat' && <Check className="w-3 h-3" />}
                </button>

                <div className="h-px bg-[#393B40] my-1" />

                <button
                  onClick={() => {
                    setCompactMiddleFolders(!compactMiddleFolders);
                    setShowViewMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-[#2E436E] flex items-center justify-between"
                >
                  <span>{t('changes.compact')}</span>
                  {compactMiddleFolders && <Check className="w-3 h-3 text-[#3574F0]" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：全部展开、全部折叠、更改列表下拉 */}
        <div className="flex items-center min-w-0 gap-1">
          <button 
            onClick={expandAll}
            title={t('changes.expandAll')}
            className="p-1 shrink-0 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={collapseAll}
            title={t('changes.collapseAll')}
            className="p-1 shrink-0 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center min-w-0 text-[11px] bg-[#1E1F22] border border-[#393B40] rounded px-1.5 py-0.5">
            <select
              value={activeList}
              aria-label={t('changes.list')}
              title={t('changes.list')}
              onChange={(e) => {
                // 受控 select：这四个分支必须在末尾的 setActiveList 之前 return，
                // 否则下拉框会停在哨兵值上。
                if (e.target.value === NEW_LIST) {
                  void askInput({
                    title: t('changes.newListPrompt'),
                    confirmLabel: t('common.create'),
                    tone: 'primary',
                    validate: (name) => (changelistNames.includes(name) ? t('changes.listExists', { name }) : null),
                  }).then(name => {
                    if (!name) return;
                    persistLists([...changelistNames, name], assignments);
                    setActiveList(name);
                  });
                  return;
                }
                if (e.target.value === MOVE_HERE) {
                  const file = changes.find(item => item.id === selectedFileId);
                  const target = activeList === ALL_LISTS ? DEFAULT_LIST : activeList;
                  if (file) persistLists(changelistNames, { ...assignments, [file.path]: target });
                  return;
                }
                if (e.target.value === RENAME_LIST) {
                  renameActiveList();
                  return;
                }
                if (e.target.value === DELETE_LIST) {
                  deleteActiveList();
                  return;
                }
                setActiveList(e.target.value);
              }}
              className="bg-transparent border-none text-[#DFE1E5] focus:outline-none cursor-pointer font-medium w-[5.5rem] max-w-full min-w-0"
            >
              <option value={ALL_LISTS} className="bg-[#2B2D30]">{t('changes.all')}</option>
              {changelistNames.map(name => (
                <option key={name} value={name} className="bg-[#2B2D30]">{name === DEFAULT_LIST ? t('changes.default') : name}</option>
              ))}
              <option value={NEW_LIST} className="bg-[#2B2D30]">{t('changes.newList')}</option>
              <option value={MOVE_HERE} className="bg-[#2B2D30]">{t('changes.moveHere')}</option>
              <option value={RENAME_LIST} disabled={!canEditActiveList} className="bg-[#2B2D30]">{t('changes.renameList')}</option>
              <option value={DELETE_LIST} disabled={!canEditActiveList} className="bg-[#2B2D30]">{t('changes.deleteList')}</option>
            </select>
          </div>
        </div>
      </div>

      {/* 树内容展示区 */}
      <div className="flex-1 overflow-auto py-1">
        {viewMode === 'tree' ? (
          <div>
            {/* 1. 已跟踪的修改文件树 */}
            {trackedTree.map(node => renderTreeNode(node, 0))}

            {/* 2. 未进行版本管理的文件 (Unversioned Files) */}
            {untrackedFiles.length > 0 && (
              <div className="mt-2">
                {/* 分组头部 */}
                <div
                  onClick={() => toggleExpand('untracked-root')}
                  className={`flex items-center h-6 min-w-0 overflow-hidden px-1 cursor-pointer transition-colors text-xs group ${
                    selectedKey === 'untracked-root' ? 'bg-[#2E436E] text-white' : 'hover:bg-[#2B2D30] text-[#9DA0A8]'
                  }`}
                >
                  <div className="w-4 h-4 flex items-center justify-center shrink-0">
                    {expandedKeys.has('untracked-root') ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const allStaged = untrackedFiles.every(f => f.isStaged);
                      const targetState = !allStaged;
                      if (onBatchToggleStage) {
                        onBatchToggleStage(untrackedFiles.map(f => f.id), targetState);
                      } else {
                        untrackedFiles.forEach(f => {
                          if (f.isStaged !== targetState) onToggleFileStage(f.id);
                        });
                      }
                    }}
                    className="w-3.5 h-3.5 mr-1.5 focus:outline-none flex items-center justify-center shrink-0"
                    title={untrackedFiles.every(f => f.isStaged) ? t('changes.unstageUnversioned') : t('changes.stageUnversioned')}
                  >
                    {renderCheckbox(
                      untrackedFiles.every(f => f.isStaged) ? 'checked' :
                      untrackedFiles.some(f => f.isStaged) ? 'indeterminate' : 'unchecked'
                    )}
                  </button>

                  <span className="font-sans font-medium text-[#8C9099] mr-2 min-w-0 truncate">
                    {t('changes.unversioned')}
                  </span>
                  <span className="text-[11px] text-[#6F737A] font-mono shrink-0 whitespace-nowrap">
                    {t('changes.fileCount', { count: untrackedFiles.length })}
                  </span>
                </div>

                {/* 展开展示子模块 */}
                {expandedKeys.has('untracked-root') && (
                  <div>
                    {untrackedTree.map(node => renderTreeNode(node, 1))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* 扁平列表视图 (Flat List) */
          <div className="p-1 space-y-0.5">
            {changes.map(file => {
              const isSelected = file.id === selectedFileId;
              return (
                <div
                  key={file.id}
                  onClick={() => {
                    treeRef.current?.focus();
                    onSelectFile(file);
                  }}
                  onContextMenu={(event) => {
                    if (file.status !== 'untracked') return;
                    openUntrackedMenu(event, file.path, false, file);
                  }}
                  className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer text-xs ${
                    isSelected ? 'bg-[#2E436E] text-white' : 'hover:bg-[#2B2D30] text-[#DFE1E5]'
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFileStage(file.id);
                      }}
                      className="w-3.5 h-3.5 mr-1.5 focus:outline-none flex items-center justify-center shrink-0"
                    >
                      {renderCheckbox(file.isStaged ? 'checked' : 'unchecked')}
                    </button>
                    {renderFileIcon(file.filename)}
                    <FilePathDisplay path={file.path} className="flex-1 min-w-0" filenameClassName={fileStatusClass(file.status)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部统计栏 (对应截图左下角: "13 已修改") */}
      <div className="h-6 shrink-0 px-3 border-t border-[#393B40] bg-[#2B2D30] flex items-center justify-between gap-2 overflow-hidden text-[11px] text-[#8C9099]">
        <div className="flex items-center min-w-0 space-x-1.5 font-sans overflow-hidden">
          <span className="text-[#DFE1E5] font-medium shrink-0 whitespace-nowrap">{t('changes.modified', { count: trackedFiles.length })}</span>
          <span className="text-[#6F737A] shrink-0">•</span>
          <span className="text-[#3574F0] font-medium min-w-0 truncate">{t('changes.checked', { count: changes.filter(c => c.isStaged).length })}</span>
          {untrackedFiles.some(c => c.isStaged) && (
            <span className="text-amber-400 font-mono text-[10px]">
              {t('changes.includingUnversioned', { count: untrackedFiles.filter(c => c.isStaged).length })}
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#6F737A] shrink-0 whitespace-nowrap">
          {viewMode === 'tree' ? t('changes.treeMode') : t('changes.flatMode')}
        </div>
      </div>

      {contextMenu && (
        <div
          className="fixed z-50 w-52 bg-[#2B2D30] border border-[#393B40] rounded shadow-2xl py-1 text-xs text-[#DFE1E5]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              onAddToGitignore?.(contextMenu.path);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-[#2E436E]"
          >
            {t('changes.addGitignore')}
          </button>
          {!contextMenu.isFolder && contextMenu.file && (
            <button
              onClick={() => {
                const file = contextMenu.file;
                setContextMenu(null);
                if (!file) return;
                void askConfirm({
                  title: t('confirm.deleteFileTitle'),
                  message: t('changes.deleteConfirm', { path: file.path }),
                  confirmLabel: t('common.delete'),
                  tone: 'danger',
                  files: [file.path],
                }).then(ok => {
                  if (ok) onDeleteUnversioned?.(file);
                });
              }}
              className="w-full text-left px-3 py-1.5 hover:bg-[#2E436E] text-[#E35967]"
            >
              {t('changes.deleteFile')}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
