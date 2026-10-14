import { ConflictView, DiffChunk, FileChange, FileMeta, GitBranch, GitCommit, GitRepository, PatchFile, RevisionFile, ShelfItem, StashItem } from '../types/git';

export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export interface GitExecResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exit_code?: number;
  elapsed_ms: number;
}

export interface RepoSnapshot {
  currentBranch: string;
  headHash: string;
  aheadCount: number;
  behindCount: number;
  dirtyFilesCount: number;
  gitVersion: string;
  userName: string;
  changes: FileChange[];
  commits: GitCommit[];
  branches: GitBranch[];
  stashes: StashItem[];
  shelves: ShelfItem[];
}

async function invokeTauri<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function getSystemGitVersion(): Promise<string> {
  if (!isTauriEnvironment()) return '浏览器预览（未连接 Git）';
  return invokeTauri<string>('get_system_git_version');
}

export async function listSavedRepos(): Promise<GitRepository[]> {
  if (!isTauriEnvironment()) return [];
  return invokeTauri<GitRepository[]>('list_saved_repos');
}

export async function addSavedRepo(name: string, path: string): Promise<GitRepository> {
  return invokeTauri<GitRepository>('add_saved_repo', { name, path });
}

export async function removeSavedRepo(id: string): Promise<GitRepository[]> {
  return invokeTauri<GitRepository[]>('remove_saved_repo', { id });
}

export async function toggleFavoriteRepo(id: string): Promise<GitRepository[]> {
  return invokeTauri<GitRepository[]>('toggle_favorite_repo', { id });
}

export async function loadRepoSnapshot(repoPath: string): Promise<RepoSnapshot> {
  return invokeTauri<RepoSnapshot>('load_repo_snapshot', { repoPath });
}

export async function repoSignature(repoPath: string): Promise<string> {
  if (!isTauriEnvironment()) return '';
  return invokeTauri<string>('repo_signature', { repoPath });
}

export async function setWatchPath(repoPath: string): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri<void>('set_watch_path', { repoPath });
}

export async function listenGitChanged(cb: (path: string) => void): Promise<() => void> {
  if (!isTauriEnvironment()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<string>('git-changed', (event) => cb(event.payload));
  return () => unlisten();
}

export interface GitProgress {
  repoPath: string;
  line: string;
}

export interface SyncOutcome {
  status: 'ok' | 'up_to_date' | 'needs_confirm' | string;
  message: string;
  ahead: number;
  behind: number;
  remote: string;
  branch: string;
  conflictingPaths: string[];
}

export async function listenGitProgress(cb: (event: GitProgress) => void): Promise<() => void> {
  if (!isTauriEnvironment()) return () => undefined;
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<GitProgress>('git-progress', (event) => cb(event.payload));
  return () => unlisten();
}

export async function setWatchPaused(paused: boolean): Promise<void> {
  if (!isTauriEnvironment()) return;
  await invokeTauri('set_watch_paused', { paused });
}

export async function loadFileDiff(repoPath: string, path: string, ignoreWhitespace = false): Promise<DiffChunk[]> {
  return invokeTauri<DiffChunk[]>('load_file_diff', { repoPath, path, ignoreWs: ignoreWhitespace });
}

export async function stagePaths(repoPath: string, paths: string[]): Promise<void> {
  await invokeTauri('stage_paths', { repoPath, paths });
}

export async function unstagePaths(repoPath: string, paths: string[]): Promise<void> {
  await invokeTauri('unstage_paths', { repoPath, paths });
}

export async function discardPaths(repoPath: string, paths: string[]): Promise<void> {
  await invokeTauri('discard_paths', { repoPath, paths });
}

export async function appendGitignore(repoPath: string, path: string): Promise<string> {
  return invokeTauri<string>('append_gitignore', { repoPath, path });
}

export async function deleteUnversioned(repoPath: string, path: string): Promise<string> {
  return invokeTauri<string>('delete_unversioned', { repoPath, path });
}

export async function applyChunk(repoPath: string, rawPatch: string, action: 'stage' | 'unstage' | 'rollback'): Promise<void> {
  await invokeTauri('apply_chunk', { repoPath, rawPatch, action });
}

export async function commitChanges(repoPath: string, message: string, amend: boolean, andPush: boolean): Promise<string> {
  return invokeTauri<string>('commit_changes', { repoPath, message, amend, andPush });
}

export async function checkoutBranch(repoPath: string, name: string): Promise<string> {
  return invokeTauri<string>('checkout_branch', { repoPath, name });
}

export async function createBranch(repoPath: string, name: string, startPoint?: string): Promise<string> {
  return invokeTauri<string>('create_branch', { repoPath, name, startPoint });
}

export async function mergeBranch(repoPath: string, name: string): Promise<string> {
  return invokeTauri<string>('merge_branch', { repoPath, name });
}

export async function rebaseOnto(repoPath: string, name: string): Promise<string> {
  return invokeTauri<string>('rebase_onto', { repoPath, name });
}

export async function updateRepo(repoPath: string, confirmRisk: boolean): Promise<SyncOutcome> {
  return invokeTauri<SyncOutcome>('update_repo', { repoPath, confirmRisk });
}

export async function pushRepo(repoPath: string, allowSetUpstream = false): Promise<SyncOutcome> {
  return invokeTauri<SyncOutcome>('push_repo', { repoPath, allowSetUpstream });
}

export async function stashSave(repoPath: string, message: string): Promise<string> {
  return invokeTauri<string>('stash_save', { repoPath, message });
}

export async function stashApply(repoPath: string, index: number, pop: boolean): Promise<string> {
  return invokeTauri<string>('stash_apply', { repoPath, index, pop });
}

export async function stashDrop(repoPath: string, index: number): Promise<string> {
  return invokeTauri<string>('stash_drop', { repoPath, index });
}

export async function cherryPick(repoPath: string, hash: string): Promise<string> {
  return invokeTauri<string>('cherry_pick', { repoPath, hash });
}

export async function revertCommit(repoPath: string, hash: string): Promise<string> {
  return invokeTauri<string>('revert_commit', { repoPath, hash });
}

export async function resetTo(repoPath: string, hash: string): Promise<string> {
  return invokeTauri<string>('reset_to', { repoPath, hash });
}

export async function compareBranches(repoPath: string, name: string): Promise<string> {
  return invokeTauri<string>('compare_branches', { repoPath, name });
}

export async function createShelf(repoPath: string, name: string, paths: string[]): Promise<ShelfItem> {
  return invokeTauri<ShelfItem>('create_shelf', { repoPath, name, paths });
}

export async function unshelve(repoPath: string, id: string): Promise<string> {
  return invokeTauri<string>('unshelve', { repoPath, id });
}

export async function deleteShelf(repoPath: string, id: string): Promise<void> {
  await invokeTauri('delete_shelf', { repoPath, id });
}

export async function pickDirectory(): Promise<string | null> {
  if (!isTauriEnvironment()) return null;
  return invokeTauri<string | null>('pick_directory');
}

export async function fetchRepo(repoPath: string): Promise<string> {
  return invokeTauri<string>('fetch_repo', { repoPath });
}

export async function createPatch(repoPath: string, paths: string[]): Promise<string> {
  return invokeTauri<string>('create_patch', { repoPath, paths });
}

export async function listRevisionFiles(repoPath: string, spec: string, mode: 'commit' | 'worktree' | 'range'): Promise<RevisionFile[]> {
  return invokeTauri<RevisionFile[]>('list_revision_files', { repoPath, spec, mode });
}

export async function loadRevisionDiff(repoPath: string, spec: string, path: string, mode: 'commit' | 'worktree' | 'range', ignoreWhitespace = false): Promise<DiffChunk[]> {
  return invokeTauri<DiffChunk[]>('load_revision_diff', { repoPath, spec, path, mode, ignoreWs: ignoreWhitespace });
}

export async function shelfPatchFiles(repoPath: string, id: string): Promise<PatchFile[]> {
  return invokeTauri<PatchFile[]>('shelf_patch_files', { repoPath, id });
}

export async function stashPatchFiles(repoPath: string, index: number): Promise<PatchFile[]> {
  return invokeTauri<PatchFile[]>('stash_patch_files', { repoPath, index });
}

export async function deleteBranch(repoPath: string, name: string, remote: boolean, force: boolean): Promise<string> {
  return invokeTauri<string>('delete_branch', { repoPath, name, remote, force });
}

export async function renameBranch(repoPath: string, oldName: string, newName: string): Promise<string> {
  return invokeTauri<string>('rename_branch', { repoPath, oldName, newName });
}

export async function toggleFavoriteBranch(repoPath: string, name: string): Promise<void> {
  await invokeTauri('toggle_favorite_branch', { repoPath, name });
}

export async function loadConflict(repoPath: string, path: string): Promise<ConflictView> {
  return invokeTauri<ConflictView>('load_conflict', { repoPath, path });
}

export async function resolveConflict(repoPath: string, path: string, content: string): Promise<string> {
  return invokeTauri<string>('resolve_conflict', { repoPath, path, content });
}

export async function smartMergeConflict(repoPath: string, path: string): Promise<string> {
  return invokeTauri<string>('smart_merge_conflict', { repoPath, path });
}

export async function inspectFile(repoPath: string, path: string): Promise<FileMeta> {
  return invokeTauri<FileMeta>('inspect_file', { repoPath, path });
}

export async function processMemoryMb(): Promise<number> {
  if (!isTauriEnvironment()) return 0;
  return invokeTauri<number>('process_memory_mb');
}

export async function revealPath(path: string): Promise<void> {
  await invokeTauri('reveal_path', { path });
}
