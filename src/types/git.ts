export type FileChangeStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'conflict';

export interface DiffLine {
  type: 'unchanged' | 'added' | 'deleted' | 'modified';
  oldLineNumber?: number;
  newLineNumber?: number;
  oldContent?: string;
  newContent?: string;
  wordDiff?: {
    type: 'add' | 'del' | 'same';
    text: string;
  }[];
  oldWordDiff?: {
    type: 'add' | 'del' | 'same';
    text: string;
  }[];
}

export interface RevisionFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface PatchFile extends RevisionFile {
  chunks: DiffChunk[];
}

export interface ConflictView {
  path: string;
  ours: string;
  theirs: string;
  base: string;
  working: string;
}

export interface FileMeta {
  encoding: string;
  lineEnding: string;
}

export interface DiffChunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  isStaged: boolean;
  lines: DiffLine[];
  rawPatch?: string;
}

export interface FileChange {
  id: string;
  path: string;
  oldPath?: string;
  filename: string;
  status: FileChangeStatus;
  additions: number;
  deletions: number;
  isStaged: boolean;
  /** 本次提交是否纳入。缺省时跟随索引里的 isStaged。勾选本身不写 git。 */
  included?: boolean;
  /** 后端给的内容指纹（mtime + 大小）；变化才需要重新拉 diff。 */
  stamp?: string;
  chunks: DiffChunk[];
  chunksLoaded?: boolean;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  subject: string;
  body?: string;
  author: string;
  authorEmail: string;
  date: string;
  relativeDate: string;
  parents: string[];
  refs: string[]; // e.g. ["HEAD -> main", "origin/main", "tag: v1.0.0"]
  branchTrack?: number; // 0, 1, 2 分支轨道索引
  files: {
    path: string;
    filename: string;
    status: FileChangeStatus;
    additions: number;
    deletions: number;
  }[];
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  lastCommitHash: string;
  lastCommitMessage: string;
  isFavorite?: boolean;
}

export interface GitTag {
  name: string;
  hash: string;
  subject: string;
}

export interface ShelfItem {
  id: string;
  name: string;
  date: string;
  fileCount: number;
  files: {
    path: string;
    status: FileChangeStatus;
    additions: number;
    deletions: number;
  }[];
}

export interface StashItem {
  id: string;
  index: number;
  message: string;
  branch: string;
  date: string;
  fileCount: number;
}

export interface GitRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface RemoteList {
  remotes: GitRemote[];
  currentBranch: string;
  upstreamRemote?: string | null;
  upstreamBranch?: string | null;
}

export interface GitRepository {
  id: string;
  name: string;
  path: string;
  currentBranch: string;
  aheadCount?: number;
  behindCount?: number;
  dirtyFilesCount: number; // 工作区待提交变动数量
  isFavorite?: boolean;
  lastOpened: string;
}

