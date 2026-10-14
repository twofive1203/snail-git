import React, { useEffect, useState } from 'react';
import { FileChange } from '../../types/git';
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
    <div className="flex-1 flex h-full overflow-hidden bg-jb-bg">
      {/* 左侧：文件变更列表树 (Default Changelist & Unversioned) */}
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

      {/* 右侧：双栏 Diff 与 底部 Commit 操作区 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {selectedFile?.status === 'conflict' && (
          <div className="h-8 px-3 border-b border-jb-border bg-rose-950/30 flex items-center justify-between text-xs">
            <span className="text-rose-200">这个文件有冲突，普通 diff 无法安全合并。</span>
            <button onClick={() => onResolveConflict?.(selectedFile)} className="px-2 py-1 rounded bg-purple-500/30 text-purple-100">打开三方合并</button>
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

        <CommitActionBox
          stagedFilesCount={stagedCount}
          lastCommitMessage={lastCommitMessage}
          onCommit={(msg, isAmend) => onCommit(msg, isAmend, false)}
          onCommitAndPush={(msg, isAmend) => onCommit(msg, isAmend, true)}
          onShelve={onShelve}
          onCreatePatch={onCreatePatch}
        />
      </div>
    </div>
  );
};
