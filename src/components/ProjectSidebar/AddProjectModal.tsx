import React, { useState } from 'react';
import { FolderGit2, X, Plus, FolderOpen, Sparkles } from 'lucide-react';

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, path: string) => void;
  onBrowse?: () => Promise<string | null>;
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  onBrowse,
}) => {
  const [repoPath, setRepoPath] = useState('');
  const [repoName, setRepoName] = useState('');

  if (!isOpen) return null;

  const handlePathChange = (val: string) => {
    setRepoPath(val);
    if (!repoName || repoName === getFolderName(repoPath)) {
      setRepoName(getFolderName(val));
    }
  };

  const getFolderName = (p: string) => {
    const clean = p.replace(/[/\\]+$/, '');
    const parts = clean.split(/[/\\]/);
    return parts[parts.length - 1] || '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath.trim()) return;
    const finalName = repoName.trim() || getFolderName(repoPath) || 'unnamed-repo';
    onAdd(finalName, repoPath.trim());
    setRepoPath('');
    setRepoName('');
    onClose();
  };

  const sampleQuickPaths = [
    { name: 'order-service', path: 'D:/workspace/backend/order-service' },
    { name: 'vue3-admin-dashboard', path: 'D:/workspace/web/vue3-admin-dashboard' },
    { name: 'infra-k8s-manifests', path: 'D:/workspace/devops/infra-k8s' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none text-xs">
      <div className="w-[460px] bg-[#2B2D30] border border-[#393B40] rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 顶部标题 */}
        <div className="h-10 px-4 border-b border-[#393B40] flex items-center justify-between bg-[#2B2D30]">
          <div className="flex items-center space-x-2">
            <FolderGit2 className="w-4 h-4 text-[#3574F0]" />
            <span className="font-semibold text-sm text-[#DFE1E5]">添加已有的 Git 项目</span>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#DFE1E5]">
              项目本地路径 (Directory Path) <span className="text-rose-400">*</span>
            </label>
            <div className="flex items-center space-x-1.5">
              <input
                type="text"
                autoFocus
                value={repoPath}
                onChange={(e) => handlePathChange(e.target.value)}
                placeholder="例如: D:/workspace/my-new-project"
                className="flex-1 bg-[#1E1F22] border border-[#393B40] rounded px-3 py-1.5 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0] font-mono"
              />
              <button
                type="button"
                onClick={() => {
                  if (!onBrowse) return;
                  void onBrowse().then((picked) => {
                    if (picked) handlePathChange(picked);
                  });
                }}
                className="px-2 py-1.5 bg-[#1E1F22] hover:bg-[#35373C] border border-[#393B40] rounded text-[#9DA0A8] hover:text-[#DFE1E5] flex items-center space-x-1"
                title="选择本地目录"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>浏览</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#DFE1E5]">
              项目别名 (Display Name)
            </label>
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="未填写时自动使用目录名"
              className="w-full bg-[#1E1F22] border border-[#393B40] rounded px-3 py-1.5 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]"
            />
          </div>

          {/* 常用预设快捷导入 */}
          <div className="pt-1">
            <span className="text-[11px] text-[#8C9099] flex items-center space-x-1 mb-1.5">
              <Sparkles className="w-3 h-3 text-[#3574F0]" />
              <span>快速体验示例项目：</span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {sampleQuickPaths.map(s => (
                <button
                  type="button"
                  key={s.name}
                  onClick={() => {
                    setRepoPath(s.path);
                    setRepoName(s.name);
                  }}
                  className="px-2 py-1 rounded bg-[#1E1F22] hover:bg-[#35373C] border border-[#393B40] text-[11px] font-mono text-[#9DA0A8] hover:text-[#DFE1E5]"
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          {/* 底部按钮 */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#393B40]">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded hover:bg-[#35373C] text-[#DFE1E5] text-xs font-medium"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!repoPath.trim()}
              className="px-4 py-1.5 rounded bg-[#3574F0] hover:bg-[#4682F7] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center space-x-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>添加并打开项目</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
