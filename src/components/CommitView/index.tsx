import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DiffChunk, FileChange } from '../../types/git';
import { SplitPane } from '../common/SplitPane';
import { useI18n } from '../../i18n/react';
import { ChangelistTree } from './ChangelistTree';
import { SideBySideDiff } from './SideBySideDiff';
import { CommitActionBox } from './CommitActionBox';

interface CommitViewProps {
  changes: FileChange[];
  lastCommitMessage?: string;
  onCommit: (msg: string, amend: boolean, andPush: boolean) => void;
  onShelve: () => void;
  onStash: () => void;
  onAddToGitignore?: (path: string) => void;
  onDeleteUnversioned?: (file: FileChange) => void;
  onToggleFileStage: (file: FileChange, staged: boolean) => void;
  onBatchToggleStage: (files: FileChange[], staged: boolean) => void;
  onToggleChunkStage: (file: FileChange, chunkId: string) => void;
  onRevertChunk: (file: FileChange, chunkId: string) => void;
  onRollbackFile: (file: FileChange) => void;
  onRefresh: () => void;
  onRequestDiff: (file: FileChange) => Promise<DiffChunk[] | null>;
  /** 块操作或外部刷新作废了缓存时递增，让当前文件重新拉 diff。 */
  diffGeneration?: number;
  onCreatePatch: () => void;
  repoKey?: string;
  ignoreWhitespace?: boolean;
  onIgnoreWhitespaceChange?: (value: boolean) => void;
  onResolveConflict?: (file: FileChange) => void;
  onSelectedFileChange?: (file: FileChange | null) => void;
}

export const CommitView: React.FC<CommitViewProps> = ({
  changes,
  lastCommitMessage,
  onCommit,
  onShelve,
  onStash,
  onAddToGitignore,
  onDeleteUnversioned,
  onToggleFileStage,
  onBatchToggleStage,
  onToggleChunkStage,
  onRevertChunk,
  onRollbackFile,
  onRefresh,
  onRequestDiff,
  diffGeneration = 0,
  onCreatePatch,
  repoKey,
  ignoreWhitespace,
  onIgnoreWhitespaceChange,
  onResolveConflict,
  onSelectedFileChange,
}) => {
  const { t } = useI18n();
  const [selectedFileId, setSelectedFileId] = useState<string>(
    changes.length > 0 ? changes[0].id : ''
  );

  useEffect(() => {
    if (!changes.some(c => c.id === selectedFileId)) {
      setSelectedFileId(changes[0]?.id ?? '');
    }
  }, [changes, selectedFileId]);

  const selectedFile = changes.find(c => c.id === selectedFileId) || null;
  const [shownDiff, setShownDiff] = useState<{ id: string; chunks: DiffChunk[]; loading: boolean } | null>(null);
  const requestRef = useRef(onRequestDiff);
  requestRef.current = onRequestDiff;

  useEffect(() => {
    onSelectedFileChange?.(selectedFile);
  }, [selectedFile, onSelectedFileChange]);

  useEffect(() => {
    if (!selectedFile) {
      setShownDiff(null);
      return;
    }
    const file = selectedFile;
    let cancelled = false;
    setShownDiff(prev => (
      prev?.id === file.id && !prev.loading ? { ...prev, loading: true } : { id: file.id, chunks: prev?.id === file.id ? prev.chunks : [], loading: true }
    ));
    void requestRef.current(file).then(chunks => {
      if (cancelled) return;
      setShownDiff(prev => {
        // 块操作会先把缓存标脏并返回 null，这时留着上一份，等刷新后再换。
        if (chunks == null && prev?.id === file.id && prev.chunks.length > 0) {
          return { ...prev, loading: false };
        }
        return { id: file.id, chunks: chunks ?? file.chunks, loading: false };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, diffGeneration]);

  const shownForFile = shownDiff?.id === selectedFile?.id ? shownDiff : null;
  const diffReady = Boolean(shownForFile && !shownForFile.loading);
  const fileForDiff = selectedFile ? {
    ...selectedFile,
    // 徽标表示“本次是否提交”，不是索引里是否已暂存。
    isStaged: selectedFile.included ?? selectedFile.isStaged,
    chunks: shownForFile ? shownForFile.chunks : selectedFile.chunks,
    chunksLoaded: diffReady,
  } : null;

  const stagedCount = changes.filter(c => c.included ?? c.isStaged).length;
  const selectFile = useCallback((file: FileChange) => setSelectedFileId(file.id), []);
  const toggleFile = useCallback((fileId: string) => {
    const file = changes.find(c => c.id === fileId);
    if (file) onToggleFileStage(file, !(file.included ?? file.isStaged));
  }, [changes, onToggleFileStage]);
  const batchToggle = useCallback((fileIds: string[], targetStaged: boolean) => {
    onBatchToggleStage(changes.filter(c => fileIds.includes(c.id)), targetStaged);
  }, [changes, onBatchToggleStage]);
  const rollbackSelected = useCallback(() => {
    if (selectedFile) onRollbackFile(selectedFile);
  }, [selectedFile, onRollbackFile]);

  return (
    <SplitPane
      orientation="horizontal"
      sized="start"
      defaultSize={384}
      min={200}
      max={960}
      minOther={280}
      storageKey="snailgit.commit.treeWidth"
      className="flex-1 h-full bg-jb-bg"
      start={
      <ChangelistTree
        changes={changes}
        selectedFileId={selectedFileId}
        onSelectFile={selectFile}
        onToggleFileStage={toggleFile}
        onBatchToggleStage={batchToggle}
        onRollbackSelected={rollbackSelected}
        onRefresh={onRefresh}
        onAddToGitignore={onAddToGitignore}
        onDeleteUnversioned={onDeleteUnversioned}
        repoKey={repoKey}
      />
      }
      end={
      <SplitPane
        orientation="vertical"
        sized="end"
        defaultSize={176}
        min={140}
        max={520}
        minOther={96}
        storageKey="snailgit.commit.actionHeight"
        className="h-full w-full"
        start={
        <div className="flex-1 h-full min-h-0 flex flex-col overflow-hidden">
        {selectedFile?.status === 'conflict' && (
          <div className="h-8 px-3 border-b border-jb-border bg-rose-950/30 flex items-center justify-between text-xs">
            <span className="text-rose-200">{t('commit.conflict')}</span>
            <button onClick={() => onResolveConflict?.(selectedFile)} className="px-2 py-1 rounded bg-purple-500/30 text-purple-100">{t('commit.openMerge')}</button>
          </div>
        )}
        <SideBySideDiff
          file={fileForDiff}
          ignoreWhitespace={ignoreWhitespace}
          onIgnoreWhitespaceChange={onIgnoreWhitespaceChange}
          onToggleChunkStage={(chunkId) => {
            if (selectedFile) onToggleChunkStage(selectedFile, chunkId);
          }}
          onRevertChunk={(chunkId) => {
            if (selectedFile) onRevertChunk(selectedFile, chunkId);
          }}
        />
        </div>
        }
        end={
        <CommitActionBox
          stagedFilesCount={stagedCount}
          lastCommitMessage={lastCommitMessage}
          onCommit={(msg, isAmend) => onCommit(msg, isAmend, false)}
          onCommitAndPush={(msg, isAmend) => onCommit(msg, isAmend, true)}
          onShelve={onShelve}
          onStash={onStash}
          onCreatePatch={onCreatePatch}
        />
        }
      />
      }
    />
  );
};
