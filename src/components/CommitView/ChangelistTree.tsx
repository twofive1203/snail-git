import React, { useEffect, useState, useMemo } from 'react';
import { FileChange, FileChangeStatus } from '../../types/git';
import { 
  ChevronDown, 
  ChevronRight, 
  Folder, 
  RotateCcw, 
  RefreshCw, 
  Eye, 
  ChevronsUpDown, 
  Maximize2, 
  Minimize2, 
  Layers, 
  FileCode,
  Check,
  Minus
} from 'lucide-react';

interface ChangelistTreeProps {
  changes: FileChange[];
  selectedFileId: string;
  onSelectFile: (file: FileChange) => void;
  onToggleFileStage: (fileId: string) => void;
  onBatchToggleStage?: (fileIds: string[], targetStaged: boolean) => void;
  onToggleAllStage: (stage: boolean) => void;
  onShelveSelected: () => void;
  onRollbackSelected: () => void;
  onRefresh?: () => void;
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

export const ChangelistTree: React.FC<ChangelistTreeProps> = ({
  changes,
  selectedFileId,
  onSelectFile,
  onToggleFileStage,
  onBatchToggleStage,
  onToggleAllStage,
  onShelveSelected,
  onRollbackSelected,
  onRefresh,
  repoKey = 'default',
}) => {
  const storageKey = `easygit.changelists.${repoKey}`;
  const [changelistNames, setChangelistNames] = useState<string[]>(['更改']);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [activeList, setActiveList] = useState('全部');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { names?: string[]; assignments?: Record<string, string> };
      if (parsed.names?.length) setChangelistNames(Array.from(new Set(['更改', ...parsed.names])));
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
    if (activeList === '全部') return true;
    return (assignments[file.path] || '更改') === activeList;
  });
  const trackedFiles = visibleChanges.filter(c => c.status !== 'untracked');
  const untrackedFiles = visibleChanges.filter(c => c.status === 'untracked');

  // 构建树形结构并执行紧凑折叠算法
  const buildTree = (fileList: FileChange[], rootKey: string): TreeNode[] => {
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
      const parts = file.path.split(/[/\\]/);
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
          displayName = `${displayName}\\${onlyChild.name}`;
          currentFull = onlyChild.fullPath;
          currentTag = currentTag || onlyChild.submoduleTag;
          rawChildren = onlyChild.children;
        }
      }

      // 递归计算文件总数
      let totalFiles = 0;
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

  const trackedTree = useMemo(() => buildTree(trackedFiles, 'tracked'), [trackedFiles, compactMiddleFolders]);
  const untrackedTree = useMemo(() => buildTree(untrackedFiles, 'untracked'), [untrackedFiles, compactMiddleFolders]);

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

    const handleRowClick = () => {
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
          className={`flex items-center h-6 px-1 cursor-pointer transition-colors text-xs group relative ${
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

          {/* 节点名称 */}
          <span className={`truncate font-mono mr-1.5 ${
            !node.isFolder ? 'text-[#589DF6]' : ''
          }`}>
            {node.name}
          </span>

          {/* 文件总数指示 (e.g. 13 个文件) */}
          {node.isFolder && (
            <span className="text-[11px] text-[#8C9099] shrink-0 font-sans mr-2">
              {node.fileCount} 个文件
            </span>
          )}

          {/* 模块后缀标签 (如 eam-agent) */}
          {node.submoduleTag && node.isFolder && depth === 0 && (
            <span className="text-[11px] text-[#6F737A] shrink-0 font-mono">
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
    <div className="w-96 border-r border-[#393B40] bg-[#1E1F22] flex flex-col h-full select-none text-xs">
      {/* 顶部工具栏 (1:1 还原截图顶栏) */}
      <div className="h-9 px-2 border-b border-[#393B40] flex items-center justify-between bg-[#2B2D30] text-[#9DA0A8]">
        {/* 左侧操作按钮 */}
        <div className="flex items-center space-x-0.5">
          {/* 回滚/撤销 */}
          <button 
            onClick={onRollbackSelected}
            title="回滚更改 (Ctrl+Alt+Z)"
            className="p-1 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          {/* 刷新 */}
          <button 
            title="刷新更改"
            onClick={onRefresh}
            className="p-1 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          {/* 视图选项 (眼睛图标) */}
          <div className="relative">
            <button 
              onClick={() => setShowViewMenu(!showViewMenu)}
              title="视图选项 (View Options)"
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
                  <span>树形结构 (Tree View)</span>
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
                  <span>扁平列表 (Flat List)</span>
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
                  <span>紧凑折叠空包路径</span>
                  {compactMiddleFolders && <Check className="w-3 h-3 text-[#3574F0]" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 右侧：全部展开、全部折叠、更改列表下拉 */}
        <div className="flex items-center space-x-1.5">
          <button 
            onClick={expandAll}
            title="全部展开"
            className="p-1 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={collapseAll}
            title="全部折叠"
            className="p-1 rounded hover:bg-[#35373C] hover:text-[#DFE1E5]"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center space-x-1 text-[11px] bg-[#1E1F22] border border-[#393B40] rounded px-1.5 py-0.5">
            <span className="text-[#8C9099]">更改列表:</span>
            <select
              value={activeList}
              onChange={(e) => {
                if (e.target.value === '__new__') {
                  const name = prompt('新的更改列表名称：', '');
                  if (name && !changelistNames.includes(name)) persistLists([...changelistNames, name], assignments);
                  if (name) setActiveList(name);
                  return;
                }
                if (e.target.value === '__move__') {
                  const file = changes.find(item => item.id === selectedFileId);
                  const target = activeList === '全部' ? '更改' : activeList;
                  if (file) persistLists(changelistNames, { ...assignments, [file.path]: target });
                  return;
                }
                setActiveList(e.target.value);
              }}
              className="bg-transparent border-none text-[#DFE1E5] focus:outline-none cursor-pointer font-medium max-w-[88px]"
            >
              <option value="全部" className="bg-[#2B2D30]">全部</option>
              {changelistNames.map(name => (
                <option key={name} value={name} className="bg-[#2B2D30]">{name}</option>
              ))}
              <option value="__new__" className="bg-[#2B2D30]">新建列表...</option>
              <option value="__move__" className="bg-[#2B2D30]">把当前文件移入此列表</option>
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
                  className={`flex items-center h-6 px-1 cursor-pointer transition-colors text-xs group ${
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
                    title={untrackedFiles.every(f => f.isStaged) ? "取消勾选未版本管理文件" : "勾选所有未版本管理文件准备提交"}
                  >
                    {renderCheckbox(
                      untrackedFiles.every(f => f.isStaged) ? 'checked' :
                      untrackedFiles.some(f => f.isStaged) ? 'indeterminate' : 'unchecked'
                    )}
                  </button>

                  <span className="font-sans font-medium text-[#8C9099] mr-2">
                    未进行版本管理的文件
                  </span>
                  <span className="text-[11px] text-[#6F737A] font-mono">
                    {untrackedFiles.length} 个文件
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
                  onClick={() => onSelectFile(file)}
                  className={`flex items-center justify-between px-2 py-1 rounded cursor-pointer text-xs ${
                    isSelected ? 'bg-[#2E436E] text-white' : 'hover:bg-[#2B2D30] text-[#DFE1E5]'
                  }`}
                >
                  <div className="flex items-center space-x-2 min-w-0">
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
                    <span className="font-mono truncate">{file.path}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部统计栏 (对应截图左下角: "13 已修改") */}
      <div className="h-6 px-3 border-t border-[#393B40] bg-[#2B2D30] flex items-center justify-between text-[11px] text-[#8C9099]">
        <div className="flex items-center space-x-1.5 font-sans">
          <span className="text-[#DFE1E5] font-medium">{trackedFiles.length} 已修改</span>
          <span className="text-[#6F737A]">•</span>
          <span className="text-[#3574F0] font-medium">已勾选 {changes.filter(c => c.isStaged).length} 个文件</span>
          {untrackedFiles.some(c => c.isStaged) && (
            <span className="text-amber-400 font-mono text-[10px]">
              (含 {untrackedFiles.filter(c => c.isStaged).length} 个未版本管理文件)
            </span>
          )}
        </div>
        <div className="text-[10px] text-[#6F737A]">
          {viewMode === 'tree' ? '树状视图' : '扁平视图'}
        </div>
      </div>
    </div>
  );
};
