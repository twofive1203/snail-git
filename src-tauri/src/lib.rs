mod git_ops;

use git_ops::RepoSnapshot;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

static WATCH_PATH: Mutex<String> = Mutex::new(String::new());
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize)]
pub struct GitExecutionResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub elapsed_ms: u128,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RepoBriefInfo {
    pub is_valid_repo: bool,
    pub current_branch: String,
    pub head_hash: String,
    pub dirty_files_count: usize,
}

#[tauri::command]
fn get_system_git_version() -> Result<String, String> {
    let _slot = git_ops::acquire_git_slot();
    let output = git_ops::git_command()
        .arg("--version")
        .output()
        .map_err(|e| format!("无法执行 git：{e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}

#[tauri::command]
fn execute_git_command(args: Vec<String>, cwd: String) -> GitExecutionResult {
    let start = Instant::now();
    let _slot = git_ops::acquire_git_slot();
    let result = git_ops::git_command().args(&args).current_dir(&cwd).output();
    let elapsed = start.elapsed().as_millis();
    match result {
        Ok(output) => GitExecutionResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
            elapsed_ms: elapsed,
        },
        Err(e) => GitExecutionResult {
            success: false,
            stdout: String::new(),
            stderr: e.to_string(),
            exit_code: None,
            elapsed_ms: elapsed,
        },
    }
}

#[tauri::command]
fn get_repo_info(repo_path: String) -> Result<RepoBriefInfo, String> {
    match git_ops::validate_repo(&repo_path) {
        Ok(top) => {
            let snap = git_ops::load_snapshot(&top)?;
            Ok(RepoBriefInfo {
                is_valid_repo: true,
                current_branch: snap.current_branch,
                head_hash: snap.head_hash,
                dirty_files_count: snap.dirty_files_count as usize,
            })
        }
        Err(_) => Ok(RepoBriefInfo {
            is_valid_repo: false,
            current_branch: String::new(),
            head_hash: String::new(),
            dirty_files_count: 0,
        }),
    }
}

#[tauri::command]
fn list_saved_repos() -> Vec<git_ops::SavedRepoDto> {
    git_ops::list_saved_repos()
}

#[tauri::command]
fn add_saved_repo(name: String, path: String) -> Result<git_ops::SavedRepoDto, String> {
    git_ops::add_saved_repo(&name, &path)
}

#[tauri::command]
fn remove_saved_repo(id: String) -> Result<Vec<git_ops::SavedRepoDto>, String> {
    git_ops::remove_saved_repo(&id)
}

#[tauri::command]
fn toggle_favorite_repo(id: String) -> Result<Vec<git_ops::SavedRepoDto>, String> {
    git_ops::toggle_favorite(&id)
}

#[tauri::command]
fn load_repo_snapshot(repo_path: String) -> Result<RepoSnapshot, String> {
    git_ops::load_snapshot(&repo_path)
}

#[tauri::command]
fn repo_signature(repo_path: String) -> String {
    git_ops::signature(&repo_path)
}

#[tauri::command]
fn set_watch_path(repo_path: String) {
    if let Ok(mut guard) = WATCH_PATH.lock() {
        *guard = repo_path;
    }
}

#[tauri::command]
fn load_file_diff(repo_path: String, path: String, ignore_ws: Option<bool>) -> Result<Vec<git_ops::DiffChunkDto>, String> {
    git_ops::file_diff_opts(&repo_path, &path, ignore_ws.unwrap_or(false))
}

#[tauri::command]
fn stage_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_ops::stage_paths(&repo_path, &paths)
}

#[tauri::command]
fn unstage_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_ops::unstage_paths(&repo_path, &paths)
}

#[tauri::command]
fn discard_paths(repo_path: String, paths: Vec<String>) -> Result<(), String> {
    git_ops::discard_paths(&repo_path, &paths)
}

#[tauri::command]
fn append_gitignore(repo_path: String, path: String) -> Result<String, String> {
    git_ops::append_gitignore(&repo_path, &path)
}

#[tauri::command]
fn delete_unversioned(repo_path: String, path: String) -> Result<String, String> {
    git_ops::delete_unversioned(&repo_path, &path)
}

#[tauri::command]
fn apply_chunk(repo_path: String, raw_patch: String, action: String) -> Result<(), String> {
    git_ops::apply_chunk(&repo_path, &raw_patch, &action)
}

#[tauri::command]
fn commit_changes(repo_path: String, message: String, amend: bool, and_push: bool) -> Result<String, String> {
    git_ops::commit(&repo_path, &message, amend, and_push)
}

#[tauri::command]
fn checkout_branch(repo_path: String, name: String) -> Result<String, String> {
    git_ops::checkout_branch(&repo_path, &name)
}

#[tauri::command]
fn create_branch(repo_path: String, name: String, start_point: Option<String>) -> Result<String, String> {
    git_ops::create_branch(&repo_path, &name, start_point.as_deref())
}

#[tauri::command]
fn merge_branch(repo_path: String, name: String) -> Result<String, String> {
    git_ops::merge_branch(&repo_path, &name)
}

#[tauri::command]
fn rebase_onto(repo_path: String, name: String) -> Result<String, String> {
    git_ops::rebase_onto(&repo_path, &name)
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GitProgressEvent {
    repo_path: String,
    line: String,
}

fn emit_git_progress(app: &AppHandle, repo_path: &str, line: &str) {
    let _ = app.emit(
        "git-progress",
        GitProgressEvent {
            repo_path: repo_path.to_string(),
            line: line.to_string(),
        },
    );
}

/// `response`: probe=首次尝试，stash=贮藏本地改动后重试，continue=带着本地改动继续，abort=用户取消。
#[tauri::command]
fn update_repo(
    app: AppHandle,
    repo_path: String,
    response: Option<String>,
    confirm_risk: Option<bool>,
) -> Result<git_ops::SyncOutcome, String> {
    let repo = repo_path.clone();
    let response = response.unwrap_or_else(|| if confirm_risk.unwrap_or(false) { "continue".into() } else { "probe".into() });
    git_ops::update_repo(&repo_path, confirm_risk.unwrap_or(false), &response, &mut |line| {
        emit_git_progress(&app, &repo, line)
    })
}

#[tauri::command]
fn push_repo(app: AppHandle, repo_path: String, allow_set_upstream: bool) -> Result<git_ops::SyncOutcome, String> {
    let repo = repo_path.clone();
    git_ops::push_repo(&repo_path, allow_set_upstream, &mut |line| {
        emit_git_progress(&app, &repo, line)
    })
}

#[tauri::command]
fn set_watch_paused(paused: bool) {
    if paused {
        git_ops::pause_watch();
    } else {
        git_ops::resume_watch();
    }
}

#[tauri::command]
fn stash_save(repo_path: String, message: String) -> Result<String, String> {
    git_ops::stash_save(&repo_path, &message)
}

#[tauri::command]
fn stash_apply(repo_path: String, index: u32, pop: bool) -> Result<String, String> {
    git_ops::stash_apply(&repo_path, index, pop)
}

#[tauri::command]
fn stash_drop(repo_path: String, index: u32) -> Result<String, String> {
    git_ops::stash_drop(&repo_path, index)
}

#[tauri::command]
fn cherry_pick(repo_path: String, hash: String) -> Result<String, String> {
    git_ops::cherry_pick(&repo_path, &hash)
}

#[tauri::command]
fn revert_commit(repo_path: String, hash: String) -> Result<String, String> {
    git_ops::revert_commit(&repo_path, &hash)
}

#[tauri::command]
fn reset_to(repo_path: String, hash: String) -> Result<String, String> {
    git_ops::reset_mixed(&repo_path, &hash)
}

#[tauri::command]
fn compare_branches(repo_path: String, name: String) -> Result<String, String> {
    git_ops::compare_stat(&repo_path, &name)
}

#[tauri::command]
fn create_shelf(repo_path: String, name: String, paths: Vec<String>) -> Result<git_ops::ShelfItemDto, String> {
    git_ops::create_shelf(&repo_path, &name, &paths)
}

#[tauri::command]
fn unshelve(repo_path: String, id: String) -> Result<String, String> {
    git_ops::unshelve(&repo_path, &id)
}

#[tauri::command]
fn delete_shelf(repo_path: String, id: String) -> Result<(), String> {
    git_ops::delete_shelf(&repo_path, &id)
}

#[tauri::command]
fn pick_directory() -> Result<Option<String>, String> {
    git_ops::pick_directory()
}

#[tauri::command]
fn fetch_repo(app: AppHandle, repo_path: String) -> Result<String, String> {
    let repo = repo_path.clone();
    git_ops::fetch_repo(&repo_path, &mut |line| emit_git_progress(&app, &repo, line))
}

#[tauri::command]
fn create_patch(repo_path: String, paths: Vec<String>) -> Result<String, String> {
    git_ops::create_patch(&repo_path, &paths)
}

#[tauri::command]
fn list_revision_files(repo_path: String, spec: String, mode: String) -> Result<Vec<git_ops::RevisionFileDto>, String> {
    git_ops::list_revision_files(&repo_path, &spec, &mode)
}

#[tauri::command]
fn load_revision_diff(repo_path: String, spec: String, path: String, mode: String, ignore_ws: bool) -> Result<Vec<git_ops::DiffChunkDto>, String> {
    git_ops::load_revision_diff(&repo_path, &spec, &path, &mode, ignore_ws)
}

#[tauri::command]
fn shelf_patch_files(repo_path: String, id: String) -> Result<Vec<git_ops::PatchFileDto>, String> {
    git_ops::shelf_patch_files(&repo_path, &id)
}

#[tauri::command]
fn stash_patch_files(repo_path: String, index: u32) -> Result<Vec<git_ops::PatchFileDto>, String> {
    git_ops::stash_patch_files(&repo_path, index)
}

#[tauri::command]
fn delete_branch(repo_path: String, name: String, remote: bool, force: bool) -> Result<String, String> {
    git_ops::delete_branch(&repo_path, &name, remote, force)
}

#[tauri::command]
fn rename_branch(repo_path: String, old_name: String, new_name: String) -> Result<String, String> {
    git_ops::rename_branch(&repo_path, &old_name, &new_name)
}

#[tauri::command]
fn toggle_favorite_branch(repo_path: String, name: String) -> Result<(), String> {
    git_ops::toggle_favorite_branch(&repo_path, &name)
}

#[tauri::command]
fn load_conflict(repo_path: String, path: String) -> Result<git_ops::ConflictViewDto, String> {
    git_ops::load_conflict(&repo_path, &path)
}

#[tauri::command]
fn resolve_conflict(repo_path: String, path: String, content: String) -> Result<String, String> {
    git_ops::resolve_conflict(&repo_path, &path, &content)
}

#[tauri::command]
fn smart_merge_conflict(repo_path: String, path: String) -> Result<String, String> {
    git_ops::smart_merge_conflict(&repo_path, &path)
}

#[tauri::command]
fn inspect_file(repo_path: String, path: String) -> Result<git_ops::FileMetaDto, String> {
    git_ops::inspect_file(&repo_path, &path)
}

#[tauri::command]
fn process_memory_mb() -> u32 {
    git_ops::process_memory_mb()
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    git_ops::reveal_path(&path)
}

fn watch_loop(app: AppHandle) {
    let mut last_sig = String::new();
    let mut last_path = String::new();
    loop {
        std::thread::sleep(Duration::from_millis(2500));
        let path = WATCH_PATH.lock().map(|g| g.clone()).unwrap_or_default();
        if path.is_empty() || git_ops::watch_paused() {
            continue;
        }
        // 失败时保留上次签名。大仓库上 status 超时若被当成“变了”，会和成功结果来回触发全量刷新。
        let Some(sig) = git_ops::poll_signature(&path) else {
            continue;
        };
        if path != last_path || sig != last_sig {
            let changed = !last_path.is_empty() && (path != last_path || sig != last_sig);
            last_path = path.clone();
            last_sig = sig;
            if changed {
                let _ = app.emit("git-changed", path);
            }
        }
    }
}

fn prepare_data_dir(dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|err| format!("create {}: {err}", dir.display()))?;
    let probe = dir.join(".write-probe");
    std::fs::write(&probe, b"ok").map_err(|err| format!("write {}: {err}", probe.display()))?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

fn data_dir_candidates() -> Vec<std::path::PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        dirs.push(std::path::PathBuf::from(local).join("easy-git").join("webview2"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            dirs.push(parent.join("webview2-data"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        dirs.push(cwd.join("target").join("webview2-data"));
    }
    dirs
}

fn open_main_window(app: &tauri::App) -> Result<(), tauri::Error> {
    let mut last_prepare_error = String::from("没有可写的 WebView2 数据目录");
    for dir in data_dir_candidates() {
        if let Err(err) = prepare_data_dir(&dir) {
            eprintln!("[SETUP_DEBUG] skip data dir: {err}");
            last_prepare_error = err;
            continue;
        }
        eprintln!("[SETUP_DEBUG] using data dir {}", dir.display());
        return tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
            .title("EasyGit - IDEA Style Git Manager")
            .inner_size(1280.0, 820.0)
            .min_inner_size(900.0, 600.0)
            .resizable(true)
            .decorations(false)
            .shadow(true)
            .data_directory(dir)
            .build()
            .map(|_| ())
            .map_err(|err| {
                eprintln!("[SETUP_DEBUG] WebviewWindow creation error: {err:?}");
                err
            });
    }
    Err(tauri::Error::Io(std::io::Error::other(last_prepare_error)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 不要再用环境变量指定用户数据目录或 --no-sandbox/--disable-gpu。
    // wry 已通过 API 传浏览器参数；当前进程又写不了 LocalAppData/Temp，
    // 硬指向那里会让 WebView2 返回 0x800700AA。
    std::env::remove_var("WEBVIEW2_USER_DATA_FOLDER");
    std::env::remove_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS");

    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let _ = APP_HANDLE.set(handle.clone());
            std::thread::spawn(move || watch_loop(handle));
            open_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_git_version,
            execute_git_command,
            get_repo_info,
            list_saved_repos,
            add_saved_repo,
            remove_saved_repo,
            toggle_favorite_repo,
            load_repo_snapshot,
            repo_signature,
            set_watch_path,
            load_file_diff,
            stage_paths,
            unstage_paths,
            discard_paths,
            append_gitignore,
            delete_unversioned,
            apply_chunk,
            commit_changes,
            checkout_branch,
            create_branch,
            merge_branch,
            rebase_onto,
            update_repo,
            push_repo,
            set_watch_paused,
            stash_save,
            stash_apply,
            stash_drop,
            cherry_pick,
            revert_commit,
            reset_to,
            compare_branches,
            create_shelf,
            unshelve,
            delete_shelf,
            pick_directory,
            fetch_repo,
            create_patch,
            list_revision_files,
            load_revision_diff,
            shelf_patch_files,
            stash_patch_files,
            delete_branch,
            rename_branch,
            toggle_favorite_branch,
            load_conflict,
            resolve_conflict,
            smart_merge_conflict,
            inspect_file,
            process_memory_mb,
            reveal_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running easy-git tauri application");
}
