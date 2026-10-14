import React, { useEffect, useState } from 'react';
import { FileChange } from '../../types/git';
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
  onAddToGitignore?: (path: string) => void;
  onDeleteUnversioned?: (file: FileChange) => void;
  onToggleFileStage: (file: FileChange, staged: boolean) => void;
  onBatchToggleStage: (files: FileChange[], staged: boolean) => void;
  onToggleAllStage: (staged: boolean) => void;
  onToggleChunkStage: (file: FileChange, chunkId: string) => void;
  onRevertChunk: (file: FileChange, chunkId: string) => void;
  onRollbackFile: (file: FileChange) => void;
  onRefresh: () => void;
  onRequestDiff: (file: FileChange) => void;
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
  onAddToGitignore,
  onDeleteUnversioned,
  onToggleFileStage,
  onBatchToggleStage,
  onToggleAllStage,
  onToggleChunkStage,
  onRevertChunk,
  onRollbackFile,
  onRefresh,
  onRequestDiff,
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

  useEffect(() => {
    onSelectedFileChange?.(selectedFile);
  }, [selectedFile, onSelectedFileChange]);

  useEffect(() => {
    if (selectedFile && !selectedFile.chunksLoaded) {
      onRequestDiff(selectedFile);
    }
  }, [selectedFile, onRequestDiff]);

  const stagedCount = changes.filter(c => c.isStaged).length;

  return (
    <SplitPane
      orientation="horizontal"
      sized="start"
      defaultSize={384}
      min={200}
      max={960}
      minOther={280}
      storageKey="easygit.commit.treeWidth"
      className="flex-1 h-full bg-jb-bg"
      start={
      <ChangelistTree
        changes={changes}
        selectedFileId={selectedFileId}
        onSelectFile={(f) => setSelectedFileId(f.id)}
        onToggleFileStage={(fileId) => {
          const file = changes.find(c => c.id === fileId);
          if (file) onToggleFileStage(file, !file.isStaged);
        }}
        onBatchToggleStage={(fileIds, targetStaged) => {
          onBatchToggleStage(changes.filter(c => fileIds.includes(c.id)), targetStaged);
        }}
        onToggleAllStage={onToggleAllStage}
        onShelveSelected={onShelve}
        onRollbackSelected={() => {
          if (selectedFile) onRollbackFile(selectedFile);
        }}
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
        storageKey="easygit.commit.actionHeight"
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
          file={selectedFile}
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
          onCreatePatch={onCreatePatch}
        />
        }
      />
      }
    />
  );
};
