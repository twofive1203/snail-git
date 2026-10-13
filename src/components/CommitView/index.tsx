import React, { useEffect, useState } from 'react';
import { FileChange } from '../../types/git';
import { ChangelistTree } from './ChangelistTree';
import { SideBySideDiff } from './SideBySideDiff';
import { CommitActionBox } from './CommitActionBox';

interface CommitViewProps {
  changes: FileChange[];
  onCommit: (msg: string, amend: boolean, andPush: boolean) => void;
  onShelve: () => void;
  onToggleFileStage: (file: FileChange, staged: boolean) => void;
  onBatchToggleStage: (files: FileChange[], staged: boolean) => void;
  onToggleAllStage: (staged: boolean) => void;
  onToggleChunkStage: (file: FileChange, chunkId: string) => void;
  onRevertChunk: (file: FileChange, chunkId: string) => void;
  onRollbackFile: (file: FileChange) => void;
  onRefresh: () => void;
  onRequestDiff: (file: FileChange) => void;
}

export const CommitView: React.FC<CommitViewProps> = ({
  changes,
  onCommit,
  onShelve,
  onToggleFileStage,
  onBatchToggleStage,
  onToggleAllStage,
  onToggleChunkStage,
  onRevertChunk,
  onRollbackFile,
  onRefresh,
  onRequestDiff,
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
      />

      {/* 右侧：双栏 Diff 与 底部 Commit 操作区 */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <SideBySideDiff
          file={selectedFile}
          onToggleChunkStage={(chunkId) => {
            if (selectedFile) onToggleChunkStage(selectedFile, chunkId);
          }}
          onRevertChunk={(chunkId) => {
            if (selectedFile) onRevertChunk(selectedFile, chunkId);
          }}
        />

        <CommitActionBox
          stagedFilesCount={stagedCount}
          onCommit={(msg, isAmend) => onCommit(msg, isAmend, false)}
          onCommitAndPush={(msg, isAmend) => onCommit(msg, isAmend, true)}
          onShelve={onShelve}
        />
      </div>
    </div>
  );
};
