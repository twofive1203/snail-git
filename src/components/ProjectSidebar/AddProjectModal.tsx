import React, { useState } from 'react';
import { FolderGit2, X, Plus, FolderOpen, Sparkles, Download, Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n/react';

export interface CloneRequest {
  url: string;
  parent: string;
  directory: string;
  name: string;
}

interface AddProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (name: string, path: string) => void;
  onClone?: (request: CloneRequest) => Promise<void>;
  onBrowse?: () => Promise<string | null>;
  busy?: boolean;
  busyLabel?: string | null;
}

type AddMode = 'local' | 'clone';

const inputClass = 'w-full bg-[#1E1F22] border border-[#393B40] rounded px-3 py-1.5 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0] disabled:opacity-50';

function folderFromPath(path: string): string {
  const clean = path.replace(/[/\\]+$/, '');
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

function folderFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, '');
  const last = trimmed.split(/[/:]/).pop() || '';
  return last.replace(/\.git$/i, '');
}

export const AddProjectModal: React.FC<AddProjectModalProps> = ({
  isOpen,
  onClose,
  onAdd,
  onClone,
  onBrowse,
  busy = false,
  busyLabel,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<AddMode>('local');
  const [repoPath, setRepoPath] = useState('');
  const [repoName, setRepoName] = useState('');
  const [aliasTouched, setAliasTouched] = useState(false);
  const [cloneUrl, setCloneUrl] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [folderName, setFolderName] = useState('');
  const [folderTouched, setFolderTouched] = useState(false);

  if (!isOpen) return null;

  const applyAlias = (next: string, force = false) => {
    if (force || !aliasTouched) setRepoName(next);
  };

  const handlePathChange = (val: string) => {
    setRepoPath(val);
    applyAlias(folderFromPath(val));
  };

  const handleUrlChange = (val: string) => {
    setCloneUrl(val);
    const derived = folderFromUrl(val);
    if (!folderTouched) setFolderName(derived);
    applyAlias(folderTouched ? folderName : derived);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === 'local') {
      if (!repoPath.trim()) return;
      const finalName = repoName.trim() || folderFromPath(repoPath) || 'unnamed-repo';
      onAdd(finalName, repoPath.trim());
      setRepoPath('');
      setRepoName('');
      setAliasTouched(false);
      onClose();
      return;
    }
    if (!onClone || !cloneUrl.trim() || !parentPath.trim()) return;
    const directory = folderName.trim() || folderFromUrl(cloneUrl);
    const name = repoName.trim() || directory || 'repo';
    void onClone({
      url: cloneUrl.trim(),
      parent: parentPath.trim(),
      directory,
      name,
    });
  };

  const sampleQuickPaths = [
    { name: 'order-service', path: 'D:/workspace/backend/order-service' },
    { name: 'vue3-admin-dashboard', path: 'D:/workspace/web/vue3-admin-dashboard' },
    { name: 'infra-k8s-manifests', path: 'D:/workspace/devops/infra-k8s' },
  ];

  const cloneReady = Boolean(cloneUrl.trim() && parentPath.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none text-xs">
      <div className="w-[480px] bg-[#2B2D30] border border-[#393B40] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="h-10 px-4 border-b border-[#393B40] flex items-center justify-between bg-[#2B2D30]">
          <div className="flex items-center space-x-2">
            <FolderGit2 className="w-4 h-4 text-[#3574F0]" />
            <span className="font-semibold text-sm text-[#DFE1E5]">
              {mode === 'clone' ? t('project.cloneTitle') : t('project.title')}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5] disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div className="flex bg-[#1E1F22] p-0.5 rounded border border-[#393B40]">
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('local')}
              className={`flex-1 py-1 rounded text-[11px] font-medium ${mode === 'local' ? 'bg-[#3574F0] text-white' : 'text-[#9DA0A8] hover:text-[#DFE1E5]'}`}
            >
              {t('project.localTab')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setMode('clone')}
              className={`flex-1 py-1 rounded text-[11px] font-medium ${mode === 'clone' ? 'bg-[#3574F0] text-white' : 'text-[#9DA0A8] hover:text-[#DFE1E5]'}`}
            >
              {t('project.cloneTab')}
            </button>
          </div>

          {mode === 'local' ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#DFE1E5]">
                {t('project.path')} <span className="text-rose-400">*</span>
              </label>
              <div className="flex items-center space-x-1.5">
                <input
                  type="text"
                  autoFocus
                  disabled={busy}
                  value={repoPath}
                  onChange={(e) => handlePathChange(e.target.value)}
                  placeholder={t('project.pathPlaceholder')}
                  className={`${inputClass} font-mono`}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (!onBrowse) return;
                    void onBrowse().then((picked) => {
                      if (picked) handlePathChange(picked);
                    });
                  }}
                  className="px-2 py-1.5 bg-[#1E1F22] hover:bg-[#35373C] border border-[#393B40] rounded text-[#9DA0A8] hover:text-[#DFE1E5] flex items-center space-x-1 disabled:opacity-40"
                  title={t('project.browseTitle')}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>{t('project.browse')}</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#DFE1E5]">
                  {t('project.cloneUrl')} <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  autoFocus
                  disabled={busy}
                  value={cloneUrl}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  placeholder={t('project.cloneUrlPlaceholder')}
                  className={`${inputClass} font-mono`}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#DFE1E5]">
                  {t('project.cloneParent')} <span className="text-rose-400">*</span>
                </label>
                <div className="flex items-center space-x-1.5">
                  <input
                    type="text"
                    disabled={busy}
                    value={parentPath}
                    onChange={(e) => setParentPath(e.target.value)}
                    placeholder={t('project.cloneParentPlaceholder')}
                    className={`${inputClass} font-mono`}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (!onBrowse) return;
                      void onBrowse().then((picked) => {
                        if (picked) setParentPath(picked);
                      });
                    }}
                    className="px-2 py-1.5 bg-[#1E1F22] hover:bg-[#35373C] border border-[#393B40] rounded text-[#9DA0A8] hover:text-[#DFE1E5] flex items-center space-x-1 disabled:opacity-40"
                    title={t('project.browseTitle')}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>{t('project.browse')}</span>
                  </button>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#DFE1E5]">{t('project.cloneFolder')}</label>
                <input
                  type="text"
                  disabled={busy}
                  value={folderName}
                  onChange={(e) => {
                    setFolderTouched(true);
                    setFolderName(e.target.value);
                    applyAlias(e.target.value);
                  }}
                  placeholder={t('project.cloneFolderPlaceholder')}
                  className={`${inputClass} font-mono`}
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#DFE1E5]">{t('project.alias')}</label>
            <input
              type="text"
              disabled={busy}
              value={repoName}
              onChange={(e) => {
                setAliasTouched(true);
                setRepoName(e.target.value);
              }}
              placeholder={t('project.aliasPlaceholder')}
              className={inputClass}
            />
          </div>

          {mode === 'local' ? (
            <div className="pt-1">
              <span className="text-[11px] text-[#8C9099] flex items-center space-x-1 mb-1.5">
                <Sparkles className="w-3 h-3 text-[#3574F0]" />
                <span>{t('project.samples')}</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {sampleQuickPaths.map(s => (
                  <button
                    type="button"
                    key={s.name}
                    disabled={busy}
                    onClick={() => {
                      setRepoPath(s.path);
                      setAliasTouched(true);
                      setRepoName(s.name);
                    }}
                    className="px-2 py-1 rounded bg-[#1E1F22] hover:bg-[#35373C] border border-[#393B40] text-[11px] font-mono text-[#9DA0A8] hover:text-[#DFE1E5] disabled:opacity-40"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-[#6F737A]">{t('project.cloneHint')}</p>
          )}

          {busy && busyLabel && (
            <p className="text-[11px] text-amber-300 font-mono truncate" title={busyLabel}>
              {busyLabel}
            </p>
          )}

          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#393B40]">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3 py-1.5 rounded hover:bg-[#35373C] text-[#DFE1E5] text-xs font-medium disabled:opacity-40"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={busy || (mode === 'local' ? !repoPath.trim() : !cloneReady)}
              className="px-4 py-1.5 rounded bg-[#3574F0] hover:bg-[#4682F7] disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-medium flex items-center space-x-1.5 shadow-sm"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : mode === 'clone' ? <Download className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
              <span>{mode === 'clone' ? t('project.cloneOpen') : t('project.addOpen')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
