import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowUp, Loader2, RefreshCw, X } from 'lucide-react';
import { FileChangeStatus, GitCommit } from '../types/git';
import { previewPush, type PushPreview, type PushTarget } from '../services/gitService';
import { askConfirm } from './common/askConfirm';
import { formatGitCommand } from './common/formatGitCommand';
import { FilePathDisplay } from './common/FilePathDisplay';
import { useI18n } from '../i18n/react';

interface PushDialogProps {
  open: boolean;
  repoPath: string;
  refreshKey?: number;
  /** 本次推送的本地源。空则由后端使用当前分支。 */
  sourceBranch?: string;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onPush: (target: PushTarget) => void;
  onOpenFile?: (hash: string, path: string, shortHash: string) => void;
  onManageRemotes?: () => void;
}

const fieldClass = 'bg-jb-bg border border-jb-border rounded px-2 py-1 text-xs text-jb-text-primary focus:outline-none focus:border-jb-blue disabled:opacity-40';

function statusBadge(status: FileChangeStatus) {
  if (status === 'added') return <span className="text-[10px] font-bold text-emerald-400 font-mono px-1 bg-emerald-500/10 rounded">A</span>;
  if (status === 'deleted') return <span className="text-[10px] font-bold text-rose-400 font-mono px-1 bg-rose-500/10 rounded">D</span>;
  if (status === 'conflict') return <span className="text-[10px] font-bold text-amber-400 font-mono px-1 bg-amber-500/10 rounded">U</span>;
  return <span className="text-[10px] font-bold text-blue-400 font-mono px-1 bg-blue-500/10 rounded">M</span>;
}

function aggregateFiles(commits: GitCommit[]): GitCommit['files'] {
  const seen = new Map<string, GitCommit['files'][number]>();
  for (const commit of commits) {
    for (const file of commit.files) {
      if (!seen.has(file.path)) seen.set(file.path, file);
    }
  }
  return [...seen.values()];
}

export const PushDialog: React.FC<PushDialogProps> = ({
  open,
  repoPath,
  refreshKey = 0,
  sourceBranch = '',
  busy = false,
  error = '',
  onClose,
  onPush,
  onOpenFile,
  onManageRemotes,
}) => {
  const { t } = useI18n();
  const cardRef = useRef<HTMLDivElement>(null);
  const pushRef = useRef<HTMLButtonElement>(null);
  const remoteRef = useRef('');
  const branchRef = useRef('');
  const seq = useRef(0);
  const branchTimer = useRef<number>();
  const [remote, setRemote] = useState('');
  const [branch, setBranch] = useState('');
  const [setUpstream, setSetUpstream] = useState(true);
  const [force, setForce] = useState(false);
  const [preview, setPreview] = useState<PushPreview | null>(null);
  const [selected, setSelected] = useState('');
  const [fileMode, setFileMode] = useState<'selected' | 'all'>('selected');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  const apply = (data: PushPreview, keepUpstreamChoice: boolean) => {
    setPreview(data);
    setRemote(data.remote);
    setBranch(data.targetBranch);
    remoteRef.current = data.remote;
    branchRef.current = data.targetBranch;
    setSetUpstream(prev => keepUpstreamChoice ? prev : data.willSetUpstream);
    setSelected(prev => data.commits.some(commit => commit.hash === prev) ? prev : (data.commits[0]?.hash || ''));
  };

  const reload = async (nextRemote?: string, nextBranch?: string, keepUpstreamChoice = false) => {
    if (!repoPath) return;
    const id = ++seq.current;
    const requestedRemote = (nextRemote ?? '').trim();
    const requestedBranch = (nextBranch ?? '').trim();
    setLoading(true);
    setLoadError('');
    try {
      const data = await previewPush(
        repoPath,
        requestedRemote || undefined,
        requestedBranch || undefined,
        sourceBranch || undefined,
      );
      if (id !== seq.current) return;
      // 请求发出后用户又改了目标，不能把输入框打回这次结果。
      if (remoteRef.current.trim() !== requestedRemote || branchRef.current.trim() !== requestedBranch) return;
      apply(data, keepUpstreamChoice);
    } catch (err) {
      if (id !== seq.current) return;
      if (remoteRef.current.trim() !== requestedRemote || branchRef.current.trim() !== requestedBranch) return;
      setLoadError(String(err));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) {
      seq.current += 1;
      remoteRef.current = '';
      branchRef.current = '';
      setPreview(null);
      setLoadError('');
      setSelected('');
      setFileMode('selected');
      setForce(false);
      return;
    }
    remoteRef.current = '';
    branchRef.current = '';
    setRemote('');
    setBranch('');
    void reload(undefined, undefined);
    return () => {
      window.clearTimeout(branchTimer.current);
    };
    // 打开、换源或远程配置变化时重新取默认目标。换源必须丢掉上一次的远程分支，否则会预览错提交。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, repoPath, refreshKey, sourceBranch]);

  useEffect(() => {
    if (!open || busy) return;
    const id = window.setTimeout(() => pushRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open, busy]);

  const branchName = branch.trim();
  const targetMatches = Boolean(preview && preview.remote === remote && preview.targetBranch === branchName);
  // 只在「确实需要」时出现强制开关：两边分叉（预览判定）或已被非快进拒绝。
  // behind 单独也算：本地跟踪过期时 lease 会拒，用户需要看到这个选项而不是只看到一句报错。
  const needsForce = Boolean(targetMatches && (preview?.needsForce || (preview?.behind ?? 0) > 0));

  // 换目标或不再需要强制时清掉勾选：用户当初是对旧目标做的危险决定。
  useEffect(() => {
    if (!needsForce) setForce(false);
  }, [needsForce, remote, branchName]);

  if (!open) return null;

  const nothingToPush = Boolean(targetMatches && preview?.targetExists && preview.ahead === 0);
  const forceOffered = needsForce || force;
  const canPush = Boolean(remote && branchName && !loading && !busy && !loadError && !nothingToPush);
  const selectedCommit = preview?.commits.find(commit => commit.hash === selected) || preview?.commits[0];
  const files = fileMode === 'all'
    ? aggregateFiles(preview?.commits || [])
    : (selectedCommit?.files || []);
  const summary = !preview || !targetMatches
    ? ''
    : preview.ahead === 0
      ? t('push.summaryEmpty', { count: 0, remote: preview.remote, branch: preview.targetBranch })
      : preview.targetExists
        ? t('push.summary', { count: preview.ahead, remote: preview.remote, branch: preview.targetBranch })
        : t('push.summaryNew', { count: preview.ahead, remote: preview.remote, branch: preview.targetBranch });

  const changeRemote = (value: string) => {
    window.clearTimeout(branchTimer.current);
    setRemote(value);
    remoteRef.current = value;
    void reload(value, branchRef.current || undefined);
  };

  const changeBranch = (value: string) => {
    setBranch(value);
    branchRef.current = value;
    window.clearTimeout(branchTimer.current);
    const next = value.trim();
    if (!next) return;
    branchTimer.current = window.setTimeout(() => {
      void reload(remoteRef.current || undefined, next);
    }, 280);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[1px] p-6 select-none"
      onMouseDown={(event) => {
        if (busy) return;
        if (cardRef.current && !cardRef.current.contains(event.target as Node)) onClose();
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-5xl h-[min(78vh,720px)] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden text-xs"
      >
        <div className="h-10 px-3 border-b border-jb-border flex items-center justify-between shrink-0">
          <span className="font-semibold text-sm text-jb-text-primary">{t('push.title')}</span>
          <button
            onClick={onClose}
            disabled={busy}
            className="p-1 rounded hover:bg-jb-hover text-jb-text-muted hover:text-jb-text-primary disabled:opacity-40"
            title={t('common.cancel')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="px-3 py-2.5 border-b border-jb-border space-y-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="text-jb-text-muted shrink-0">{t('push.localBranch')}</span>
            <span className="font-mono text-jb-text-primary truncate">{preview?.localBranch || '…'}</span>
            <span className="text-jb-text-muted">→</span>
            <label className="sr-only" htmlFor="push-remote">{t('push.remote')}</label>
            <select
              id="push-remote"
              value={remote}
              disabled={busy || !preview || preview.remotes.length === 0}
              onChange={(event) => changeRemote(event.target.value)}
              className={`${fieldClass} max-w-[140px]`}
            >
              {(preview?.remotes || []).map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
            <span className="text-jb-text-muted">/</span>
            <input
              value={branch}
              disabled={busy || !preview}
              onChange={(event) => changeBranch(event.target.value)}
              list="push-remote-branches"
              placeholder={t('push.branchPlaceholder')}
              className={`${fieldClass} w-48 font-mono`}
              spellCheck={false}
            />
            <datalist id="push-remote-branches">
              {(preview?.remoteBranches || []).map(name => (
                <option key={name} value={name} />
              ))}
            </datalist>
            {targetMatches && preview && !preview.targetExists && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px] font-semibold">{t('push.new')}</span>
            )}
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-jb-blue" />}
          </div>
          <label className="flex items-center gap-2 text-jb-text-secondary w-fit" title={t('push.setUpstreamHint')}>
            <input
              type="checkbox"
              checked={setUpstream}
              disabled={busy || !preview}
              onChange={(event) => setSetUpstream(event.target.checked)}
              className="rounded border-jb-border text-jb-blue focus:ring-0 cursor-pointer bg-jb-bg"
            />
            <span>{t('push.setUpstream')}</span>
            {preview?.hasUpstream && preview.upstreamRemote && (
              <span className="text-jb-text-muted">
                {t('push.tracking', { remote: preview.upstreamRemote, branch: preview.upstreamBranch })}
              </span>
            )}
          </label>
        </div>

        {targetMatches && preview && preview.behind > 0 && (
          <div className="px-3 py-1.5 bg-amber-500/10 text-amber-200 border-b border-amber-500/20 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>{t('push.behind', { count: preview.behind })}</span>
          </div>
        )}

        {forceOffered && (
          <div className="px-3 py-1.5 bg-rose-500/10 text-rose-200 border-b border-rose-500/25 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <label className="flex items-start gap-2 cursor-pointer min-w-0" title={t('push.forceHint')}>
              <input
                type="checkbox"
                checked={force}
                disabled={busy}
                onChange={(event) => setForce(event.target.checked)}
                className="mt-0.5 rounded border-rose-400/60 text-rose-500 focus:ring-0 cursor-pointer bg-jb-bg"
              />
              <span className="min-w-0">
                <span className="font-medium">{t('push.force')}</span>
                <span className="block text-rose-200/80 leading-relaxed">{t('push.forceHint')}</span>
              </span>
            </label>
          </div>
        )}

        <div className="flex-1 min-h-0 flex">
          <div className="w-[46%] min-w-0 border-r border-jb-border flex flex-col">
            <div className="h-8 px-3 border-b border-jb-border flex items-center justify-between text-jb-text-secondary">
              <span className="font-semibold text-jb-text-primary">{t('push.commits')}</span>
              <span className="font-mono text-[10px]">{targetMatches ? preview?.ahead ?? 0 : '…'}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading && !preview && (
                <div className="p-4 text-jb-text-muted flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{t('push.loading')}</span>
                </div>
              )}
              {loadError && (
                <div className="p-3 text-rose-300 break-words">{loadError}</div>
              )}
              {!loadError && preview && preview.commits.length === 0 && (
                <div className="p-4 text-jb-text-muted">{t('push.emptyCommits')}</div>
              )}
              {preview?.commits.map(commit => (
                <button
                  key={commit.hash}
                  onClick={() => {
                    setSelected(commit.hash);
                    setFileMode('selected');
                  }}
                  className={`w-full text-left px-3 py-2 border-b border-jb-border/60 ${commit.hash === selectedCommit?.hash && fileMode === 'selected' ? 'bg-jb-selected text-white' : 'hover:bg-jb-hover'}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono text-jb-blue shrink-0">{commit.shortHash}</span>
                    <span className="truncate font-medium">{commit.subject}</span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-jb-text-muted truncate">
                    {commit.author} · {commit.relativeDate} · {t('common.files', { count: commit.files.length })}
                  </div>
                </button>
              ))}
              {preview?.truncated && (
                <div className="px-3 py-2 text-[10px] text-jb-text-muted">{t('push.truncated', { count: preview.commits.length })}</div>
              )}
            </div>
          </div>

          <div className="flex-1 min-w-0 flex flex-col bg-jb-bg/40">
            <div className="h-8 px-3 border-b border-jb-border flex items-center justify-between">
              <span className="font-semibold text-jb-text-primary">{t('push.files')}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setFileMode('selected')}
                  className={`px-1.5 py-0.5 rounded ${fileMode === 'selected' ? 'bg-jb-selected text-white' : 'text-jb-text-muted hover:bg-jb-hover'}`}
                >
                  {t('push.filesSelected')}
                </button>
                <button
                  onClick={() => setFileMode('all')}
                  className={`px-1.5 py-0.5 rounded ${fileMode === 'all' ? 'bg-jb-selected text-white' : 'text-jb-text-muted hover:bg-jb-hover'}`}
                >
                  {t('push.filesAll')}
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {files.length === 0 && !loading && (
                <div className="p-3 text-jb-text-muted">{t('push.emptyFiles')}</div>
              )}
              {files.map(file => (
                <button
                  key={file.path}
                  onClick={() => {
                    const owner = fileMode === 'selected'
                      ? selectedCommit
                      : preview?.commits.find(commit => commit.files.some(item => item.path === file.path));
                    if (owner) onOpenFile?.(owner.hash, file.path, owner.shortHash);
                  }}
                  className="w-full text-left px-2 py-1.5 rounded hover:bg-jb-hover flex items-center gap-2 min-w-0"
                  title={file.path}
                >
                  {statusBadge(file.status)}
                  <FilePathDisplay path={file.path} className="flex-1" filenameClassName={file.status === 'deleted' ? 'line-through' : ''} />
                  <span className="shrink-0 font-mono text-[11px]">
                    {file.additions > 0 && <span className="text-jb-green">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="ml-1 text-jb-red">-{file.deletions}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-3 py-2.5 border-t border-jb-border bg-jb-bg/40 flex items-center gap-3 shrink-0">
          <div className="flex-1 min-w-0 text-[11px] text-jb-text-muted space-y-0.5">
            {summary && <div className="text-jb-text-secondary truncate">{summary}</div>}
            {targetMatches && preview && !preview.targetExists && <div>{t('push.willCreate')}</div>}
            {error && <div className="text-rose-300 break-words">{error}</div>}
            {loadError.includes('没有配置远程') && <div>{t('push.noRemotes')}</div>}
            <div>{t('push.stale')}</div>
          </div>
          <button
            onClick={() => void reload(remote || undefined, branchName || undefined, true)}
            disabled={busy || loading || !repoPath}
            className="px-2 py-1.5 rounded border border-jb-border text-jb-text-secondary hover:bg-jb-hover disabled:opacity-40 flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('push.reload')}</span>
          </button>
          {onManageRemotes && (
            <button
              onClick={onManageRemotes}
              disabled={busy}
              className="px-2 py-1.5 rounded border border-jb-border text-jb-text-secondary hover:bg-jb-hover disabled:opacity-40"
            >
              {t('push.manageRemotes')}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded border border-jb-border text-jb-text-secondary hover:bg-jb-hover disabled:opacity-40"
          >
            {t('common.cancel')}
          </button>
          <button
            ref={pushRef}
            onClick={() => {
              if (!canPush) return;
              const target = {
                remote,
                branch: branchName,
                setUpstream,
                source: sourceBranch || undefined,
                force: forceOffered ? force : false,
              };
              if (!target.force) {
                onPush(target);
                return;
              }
              const local = sourceBranch || preview?.localBranch || '';
              const args = ['push', '--progress'];
              if (setUpstream) args.push('--set-upstream');
              args.push('--force-with-lease', remote, `${local}:${branchName}`);
              void askConfirm({
                title: t('confirm.forcePushTitle'),
                message: t('confirm.forcePush'),
                confirmLabel: t('push.actionForce'),
                tone: 'danger',
                commands: [formatGitCommand(repoPath, args)],
              }).then(ok => {
                if (ok) onPush(target);
              });
            }}
            disabled={!canPush}
            className={`px-3 py-1.5 rounded font-medium flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
              force
                ? 'bg-jb-red hover:bg-jb-red/85 text-white'
                : 'bg-jb-blue hover:bg-jb-blueHover text-white'
            }`}
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-3.5 h-3.5" />}
            <span>{force ? t('push.actionForce') : t('push.action')}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
