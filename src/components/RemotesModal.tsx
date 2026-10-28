import React, { useEffect, useState } from 'react';
import { Check, Cloud, Copy, Loader2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { GitRemote, RemoteList } from '../types/git';
import { addRemote, listRemotes, removeRemote, renameRemote, setRemoteUrl } from '../services/gitService';
import { askConfirm } from './common/askConfirm';
import { formatGitCommand } from './common/formatGitCommand';
import { useI18n } from '../i18n/react';

interface RemotesModalProps {
  isOpen: boolean;
  repoPath: string;
  operationsLocked?: boolean;
  onClose: () => void;
  onFetch: (name: string) => Promise<void>;
  onChanged: () => void;
}

const fieldClass = 'w-full bg-[#1E1F22] border border-[#393B40] rounded px-2.5 py-1.5 text-xs text-[#DFE1E5] placeholder-[#6F737A] focus:outline-none focus:border-[#3574F0]';

export const RemotesModal: React.FC<RemotesModalProps> = ({
  isOpen,
  repoPath,
  operationsLocked = false,
  onClose,
  onFetch,
  onChanged,
}) => {
  const { t } = useI18n();
  const [list, setList] = useState<RemoteList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftFetch, setDraftFetch] = useState('');
  const [draftPush, setDraftPush] = useState('');
  const [addName, setAddName] = useState('origin');
  const [addUrl, setAddUrl] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !repoPath) return;
    let stop = false;
    setLoading(true);
    setError('');
    void listRemotes(repoPath)
      .then(data => {
        if (!stop) setList(data);
      })
      .catch(err => {
        if (!stop) setError(String(err));
      })
      .finally(() => {
        if (!stop) setLoading(false);
      });
    return () => {
      stop = true;
    };
  }, [isOpen, repoPath, revision]);

  if (!isOpen) return null;

  const reload = () => setRevision(value => value + 1);

  const beginEdit = (remote: GitRemote) => {
    setEditing(remote.name);
    setDraftName(remote.name);
    setDraftFetch(remote.fetchUrl);
    setDraftPush(remote.pushUrl === remote.fetchUrl ? '' : remote.pushUrl);
    setError('');
  };

  const saveEdit = async () => {
    if (!editing || saving) return;
    setSaving(true);
    setError('');
    try {
      const nextName = draftName.trim();
      if (nextName !== editing) {
        await renameRemote(repoPath, editing, nextName);
      }
      await setRemoteUrl(repoPath, nextName, draftFetch.trim(), draftPush.trim() || undefined);
      setEditing(null);
      reload();
      onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    if (saving || !addName.trim() || !addUrl.trim()) return;
    setSaving(true);
    setError('');
    try {
      await addRemote(repoPath, addName.trim(), addUrl.trim());
      setAddUrl('');
      reload();
      onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (name: string) => {
    if (saving) return;
    const ok = await askConfirm({
      title: t('confirm.removeRemoteTitle'),
      message: t('remotes.removeConfirm', { name }),
      confirmLabel: t('confirm.remove'),
      commands: [formatGitCommand(repoPath, ['remote', 'remove', name])],
    });
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      await removeRemote(repoPath, name);
      if (editing === name) setEditing(null);
      reload();
      onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const upstream = list?.upstreamRemote
    ? t('remotes.upstream', {
        branch: list.currentBranch || 'HEAD',
        remote: list.upstreamRemote,
        upstream: list.upstreamBranch || list.currentBranch || '',
      })
    : list?.currentBranch
      ? t('remotes.noUpstream', { branch: list.currentBranch })
      : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] select-none text-xs">
      <div className="w-[560px] max-h-[80vh] bg-[#2B2D30] border border-[#393B40] rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="h-10 px-4 border-b border-[#393B40] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2 min-w-0">
            <Cloud className="w-4 h-4 text-[#3574F0] shrink-0" />
            <span className="font-semibold text-sm text-[#DFE1E5]">{t('remotes.title')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 overflow-y-auto">
          {upstream && <p className="text-[11px] text-[#8C9099]">{upstream}</p>}
          {error && (
            <p className="text-[11px] text-rose-300 bg-rose-950/30 border border-rose-500/30 rounded px-2 py-1.5 break-all">
              {error}
            </p>
          )}

          {loading && !list ? (
            <div className="py-8 flex items-center justify-center text-[#9DA0A8]">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          ) : list && list.remotes.length === 0 ? (
            <p className="py-6 text-center text-[#8C9099]">{t('remotes.empty')}</p>
          ) : (
            <div className="space-y-2">
              {list?.remotes.map(remote => (
                <div key={remote.name} className="border border-[#393B40] rounded-md bg-[#1E1F22] p-2.5">
                  {editing === remote.name ? (
                    <div className="space-y-2">
                      <label className="block space-y-1">
                        <span className="text-[11px] text-[#8C9099]">{t('remotes.name')}</span>
                        <input value={draftName} onChange={e => setDraftName(e.target.value)} className={fieldClass} />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] text-[#8C9099]">{t('remotes.fetchUrl')}</span>
                        <input value={draftFetch} onChange={e => setDraftFetch(e.target.value)} className={`${fieldClass} font-mono`} />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] text-[#8C9099]">{t('remotes.pushUrl')}</span>
                        <input
                          value={draftPush}
                          onChange={e => setDraftPush(e.target.value)}
                          placeholder={t('remotes.pushPlaceholder')}
                          className={`${fieldClass} font-mono`}
                        />
                      </label>
                      <div className="flex justify-end space-x-1.5">
                        <button type="button" onClick={() => setEditing(null)} className="px-2 py-1 rounded hover:bg-[#35373C] text-[#DFE1E5]">
                          {t('common.cancel')}
                        </button>
                        <button
                          type="button"
                          disabled={saving || !draftName.trim() || !draftFetch.trim()}
                          onClick={() => { void saveEdit(); }}
                          className="px-2 py-1 rounded bg-[#3574F0] hover:bg-[#4682F7] disabled:opacity-40 text-white flex items-center space-x-1"
                        >
                          <Check className="w-3 h-3" />
                          <span>{t('remotes.save')}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[#DFE1E5] font-medium">{remote.name}</div>
                        <div className="mt-1 font-mono text-[11px] text-[#9DA0A8] truncate" title={remote.fetchUrl}>
                          {t('remotes.fetchUrl')} {remote.fetchUrl}
                        </div>
                        {remote.pushUrl !== remote.fetchUrl && (
                          <div className="font-mono text-[11px] text-[#9DA0A8] truncate" title={remote.pushUrl}>
                            {t('remotes.pushUrl')} {remote.pushUrl}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center shrink-0">
                        <button
                          type="button"
                          title={t('common.copy')}
                          onClick={() => { void navigator.clipboard.writeText(remote.fetchUrl); }}
                          className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5]"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title={t('remotes.fetch')}
                          disabled={operationsLocked || saving}
                          onClick={() => { void onFetch(remote.name); }}
                          className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5] disabled:opacity-40"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${operationsLocked ? 'animate-spin' : ''}`} />
                        </button>
                        <button
                          type="button"
                          title={t('remotes.edit')}
                          disabled={saving}
                          onClick={() => beginEdit(remote)}
                          className="p-1 rounded hover:bg-[#35373C] text-[#9DA0A8] hover:text-[#DFE1E5] disabled:opacity-40"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          title={t('remotes.remove')}
                          disabled={saving}
                          onClick={() => { void remove(remote.name); }}
                          className="p-1 rounded hover:bg-rose-950/40 text-[#9DA0A8] hover:text-rose-300 disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <form
            className="border-t border-[#393B40] pt-3 space-y-2"
            onSubmit={event => {
              event.preventDefault();
              void add();
            }}
          >
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <input
                value={addName}
                onChange={e => setAddName(e.target.value)}
                placeholder={t('remotes.namePlaceholder')}
                className={fieldClass}
              />
              <input
                value={addUrl}
                onChange={e => setAddUrl(e.target.value)}
                placeholder={t('remotes.urlPlaceholder')}
                className={`${fieldClass} font-mono`}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-[#6F737A]">{t('remotes.credentials')}</p>
              <button
                type="submit"
                disabled={saving || !addName.trim() || !addUrl.trim()}
                className="px-3 py-1.5 rounded bg-[#3574F0] hover:bg-[#4682F7] disabled:opacity-40 text-white flex items-center space-x-1 shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('remotes.add')}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
