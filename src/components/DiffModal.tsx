import React, { useEffect, useRef, useState } from 'react';
import { DiffChunk, RevisionFile } from '../types/git';
import { SideBySideDiff } from './CommitView/SideBySideDiff';
import { FilePathDisplay } from './common/FilePathDisplay';
import { X } from 'lucide-react';

interface DiffModalProps {
  title: string;
  files: RevisionFile[];
  onLoad: (path: string, ignoreWhitespace: boolean) => Promise<DiffChunk[]>;
  onClose: () => void;
}

export const DiffModal: React.FC<DiffModalProps> = ({ title, files, onLoad, onClose }) => {
  const [selected, setSelected] = useState(files[0]?.path || '');
  const [chunks, setChunks] = useState<DiffChunk[]>([]);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(false);
  const [error, setError] = useState('');

  const loadRef = useRef(onLoad);
  loadRef.current = onLoad;

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setError('');
    void loadRef.current(selected, ignoreWhitespace).then(next => {
      if (!cancelled) setChunks(next);
    }).catch(err => {
      if (!cancelled) setError(String(err));
    });
    return () => { cancelled = true; };
  }, [selected, ignoreWhitespace, files]);

  const current = files.find(file => file.path === selected) || files[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="w-full max-w-6xl h-[80vh] bg-jb-panel border border-jb-border rounded-lg shadow-2xl flex flex-col overflow-hidden">
        <div className="h-10 px-3 border-b border-jb-border flex items-center justify-between">
          <span className="text-sm font-semibold">{title}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-jb-hover text-jb-text-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 flex min-h-0">
          <div className="w-72 border-r border-jb-border overflow-auto p-1 text-xs">
            {files.length === 0 && <div className="p-3 text-jb-text-muted">没有差异文件</div>}
            <div className="px-2 py-1 text-[10px] text-jb-text-muted">单击或双击查看双栏 Diff</div>
            {files.map(file => (
              <div
                key={file.path}
                role="button"
                tabIndex={0}
                onClick={() => setSelected(file.path)}
                onDoubleClick={() => setSelected(file.path)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') setSelected(file.path);
                }}
                title="单击或双击查看双栏 Diff"
                className={`w-full text-left px-2 py-1.5 rounded cursor-pointer ${file.path === current?.path ? 'bg-jb-selected text-white' : 'hover:bg-jb-hover'}`}
              >
                <FilePathDisplay path={file.path} />
                <div className="pl-0 text-[10px]">
                  <span className="text-jb-green">+{file.additions}</span>
                  <span className="ml-1 text-jb-red">-{file.deletions}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            {error ? (
              <div className="p-4 text-xs text-rose-300">{error}</div>
            ) : (
              <SideBySideDiff
                file={current ? {
                  id: current.path,
                  path: current.path,
                  filename: current.path.split(/[/\\]/).pop() || current.path,
                  status: (current.status as 'modified') || 'modified',
                  additions: current.additions,
                  deletions: current.deletions,
                  isStaged: false,
                  chunks,
                  chunksLoaded: true,
                } : null}
                readOnly
                baselineLabel={title}
                ignoreWhitespace={ignoreWhitespace}
                onIgnoreWhitespaceChange={setIgnoreWhitespace}
                onToggleChunkStage={() => undefined}
                onRevertChunk={() => undefined}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
