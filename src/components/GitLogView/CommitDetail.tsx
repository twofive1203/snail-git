import React, { useState } from 'react';
import { GitCommit, FileChangeStatus } from '../../types/git';
import { 
  FileText, 
  Folder, 
  GitCommit as CommitIcon, 
  User, 
  Calendar, 
  Layers, 
  List, 
  FolderTree, 
  ArrowUpRight, 
  FileDiff 
} from 'lucide-react';

interface CommitDetailProps {
  commit: GitCommit | null;
  onOpenFileDiff: (filePath: string) => void;
}

export const CommitDetail: React.FC<CommitDetailProps> = ({
  commit,
  onOpenFileDiff
}) => {
  const [isTreeView, setIsTreeView] = useState(false);

  if (!commit) {
    return (
      <div className="h-64 border-t border-jb-border bg-jb-panel/40 flex items-center justify-center text-xs text-jb-text-muted">
        Select a commit to view details and changed files
      </div>
    );
  }

  const getStatusBadge = (status: FileChangeStatus) => {
    switch (status) {
      case 'modified':
        return <span className="text-[10px] font-bold text-jb-blue font-mono px-1 bg-jb-blue/10 rounded">M</span>;
      case 'added':
        return <span className="text-[10px] font-bold text-jb-green font-mono px-1 bg-jb-green/10 rounded">A</span>;
      case 'deleted':
        return <span className="text-[10px] font-bold text-jb-red font-mono px-1 bg-jb-red/10 rounded line-through">D</span>;
      default:
        return <span className="text-[10px] font-bold text-jb-orange font-mono px-1">?</span>;
    }
  };

  return (
    <div className="h-64 border-t border-jb-border bg-jb-panel flex flex-col md:flex-row text-xs select-none">
      {/* 左侧：提交元数据与提交说明 */}
      <div className="w-full md:w-1/2 p-3 border-b md:border-b-0 md:border-r border-jb-border flex flex-col justify-between overflow-y-auto">
        <div className="space-y-2">
          {/* 标题 */}
          <div className="font-semibold text-sm text-jb-text-primary leading-snug">
            {commit.subject}
          </div>

          {/* 详细描述 */}
          {commit.body && (
            <div className="text-jb-text-secondary whitespace-pre-wrap font-sans text-xs bg-jb-bg/60 p-2 rounded border border-jb-border/60">
              {commit.body}
            </div>
          )}

          {/* 元信息表 */}
          <div className="space-y-1 text-jb-text-muted pt-1 text-[11px] font-mono">
            <div className="flex items-center space-x-2">
              <span className="w-16 text-jb-text-secondary">Author:</span>
              <span className="text-jb-text-primary">{commit.author} &lt;{commit.authorEmail}&gt;</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-16 text-jb-text-secondary">Date:</span>
              <span className="text-jb-text-primary">{commit.date} ({commit.relativeDate})</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="w-16 text-jb-text-secondary">Commit:</span>
              <span className="text-jb-blue">{commit.hash}</span>
            </div>
            {commit.parents.length > 0 && (
              <div className="flex items-center space-x-2">
                <span className="w-16 text-jb-text-secondary">Parents:</span>
                <div className="flex space-x-1.5">
                  {commit.parents.map(p => (
                    <span key={p} className="text-purple-400 hover:underline cursor-pointer">{p}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 右侧：修改文件列表 */}
      <div className="w-full md:w-1/2 flex flex-col bg-jb-bg/40">
        <div className="h-8 px-3 border-b border-jb-border flex items-center justify-between bg-jb-panel/80">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-jb-text-primary">Changed Files</span>
            <span className="px-1.5 py-0.2 bg-jb-bg rounded-full text-[10px] text-jb-text-muted font-mono border border-jb-border">
              {commit.files.length}
            </span>
          </div>

          <div className="flex items-center space-x-1">
            <button
              onClick={() => setIsTreeView(!isTreeView)}
              title={isTreeView ? "切换到扁平列表" : "切换到目录树"}
              className="p-1 rounded hover:bg-jb-hover text-jb-text-secondary"
            >
              {isTreeView ? <List className="w-3.5 h-3.5" /> : <FolderTree className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
          {commit.files.map((file) => (
            <div
              key={file.path}
              onDoubleClick={() => onOpenFileDiff(file.path)}
              onClick={() => onOpenFileDiff(file.path)}
              className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-jb-hover/80 cursor-pointer group text-xs transition-colors"
            >
              <div className="flex items-center space-x-2 min-w-0">
                {getStatusBadge(file.status)}
                <FileText className="w-3.5 h-3.5 text-jb-text-muted shrink-0" />
                <span className={`font-mono truncate ${
                  file.status === 'modified' ? 'text-jb-blue' :
                  file.status === 'added' ? 'text-jb-green' :
                  file.status === 'deleted' ? 'text-jb-red line-through' :
                  'text-jb-text-primary'
                }`}>
                  {file.path}
                </span>
              </div>

              <div className="flex items-center space-x-2 shrink-0 font-mono text-[11px]">
                {file.additions > 0 && (
                  <span className="text-jb-green">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-jb-red">-{file.deletions}</span>
                )}
                <button 
                  title="在新窗口查看 Diff"
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-jb-blue transition-opacity"
                >
                  <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
