use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

/// 安装版是 windows subsystem，自己没有控制台。
/// 同一时刻只允许一个 git 子进程，避免轮询和快照叠在一起抢 index.lock、堆出大量进程。
static GIT_SLOT: Mutex<()> = Mutex::new(());

pub fn acquire_git_slot() -> std::sync::MutexGuard<'static, ()> {
    GIT_SLOT.lock().unwrap_or_else(|err| err.into_inner())
}

/// 网络操作期间暂停状态轮询，避免 `git status` 在锁后面空等整次 fetch/push。
static WATCH_PAUSE: AtomicU32 = AtomicU32::new(0);

pub fn pause_watch() {
    WATCH_PAUSE.fetch_add(1, Ordering::SeqCst);
}

pub fn resume_watch() {
    let _ = WATCH_PAUSE.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
        Some(value.saturating_sub(1))
    });
}

pub fn watch_paused() -> bool {
    WATCH_PAUSE.load(Ordering::SeqCst) > 0
}

struct WatchPauseGuard;

impl WatchPauseGuard {
    fn new() -> Self {
        pause_watch();
        Self
    }
}

impl Drop for WatchPauseGuard {
    fn drop(&mut self) {
        resume_watch();
    }
}

fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW：GUI 进程拉起 git.exe / powershell.exe 时不要再分配控制台。
        cmd.creation_flags(0x08000000);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

pub fn hidden_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null());
    hide_console(&mut cmd);
    cmd
}

fn git_executable() -> &'static str {
    static GIT: OnceLock<String> = OnceLock::new();
    GIT.get_or_init(|| {
        // 只找 git.exe，避开 git.cmd。再换成 mingw64\bin\git.exe，避免包装器自己弹控制台。
        #[cfg(windows)]
        if let Some(path) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path) {
                let exe = dir.join("git.exe");
                if exe.is_file() {
                    return prefer_real_git(&exe).to_string_lossy().into_owned();
                }
            }
        }
        "git".to_string()
    })
    .as_str()
}

fn prefer_real_git(exe: &Path) -> PathBuf {
    // cmd\git.exe 和 bin\git.exe 都是约 45KB 的包装器，会自己再分配控制台。
    // mingw64\bin\git.exe 才是真正的 git。
    let Some(root) = git_install_root(exe) else {
        return exe.to_path_buf();
    };
    for rel in ["mingw64/bin/git.exe", "mingw32/bin/git.exe"] {
        let candidate = root.join(rel);
        if candidate.is_file() {
            return candidate;
        }
    }
    exe.to_path_buf()
}

fn git_install_root(exe: &Path) -> Option<PathBuf> {
    let parent = exe.parent()?;
    let name = parent.file_name()?.to_string_lossy();
    if name == "bin" {
        let up = parent.parent()?;
        let up_name = up.file_name()?.to_string_lossy();
        if up_name == "mingw64" || up_name == "mingw32" {
            return up.parent().map(|dir| dir.to_path_buf());
        }
        return Some(up.to_path_buf());
    }
    if name == "cmd" {
        return parent.parent().map(|dir| dir.to_path_buf());
    }
    None
}

fn git_path_with_helpers(exe: &Path) -> Option<std::ffi::OsString> {
    let root = git_install_root(exe)?;
    let mut prefix = std::ffi::OsString::new();
    for rel in ["cmd", "bin", "usr/bin", "mingw64/bin", "mingw32/bin"] {
        let dir = root.join(rel);
        if !dir.is_dir() {
            continue;
        }
        if !prefix.is_empty() {
            prefix.push(";");
        }
        prefix.push(dir.as_os_str());
    }
    if prefix.is_empty() {
        return None;
    }
    if let Some(existing) = std::env::var_os("PATH") {
        prefix.push(";");
        prefix.push(existing);
    }
    Some(prefix)
}

pub fn git_command() -> Command {
    let exe = git_executable();
    let mut cmd = hidden_command(exe);
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("GIT_PAGER", "cat");
    if let Some(path) = git_path_with_helpers(Path::new(exe)) {
        cmd.env("PATH", path);
    }
    cmd
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeDto {
    pub id: String,
    pub path: String,
    pub old_path: Option<String>,
    pub filename: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub is_staged: bool,
    pub chunks: Vec<DiffChunkDto>,
    pub chunks_loaded: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffChunkDto {
    pub id: String,
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    pub is_staged: bool,
    pub lines: Vec<DiffLineDto>,
    pub raw_patch: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WordSpanDto {
    #[serde(rename = "type")]
    pub kind: String,
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffLineDto {
    #[serde(rename = "type")]
    pub kind: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
    pub old_content: Option<String>,
    pub new_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub word_diff: Option<Vec<WordSpanDto>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub old_word_diff: Option<Vec<WordSpanDto>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileDto {
    pub path: String,
    pub filename: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitDto {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub body: Option<String>,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub relative_date: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub branch_track: u32,
    pub files: Vec<CommitFileDto>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchDto {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub last_commit_hash: String,
    pub last_commit_message: String,
    #[serde(default)]
    pub is_favorite: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitTagDto {
    pub name: String,
    pub hash: String,
    pub subject: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StashItemDto {
    pub id: String,
    pub index: u32,
    pub message: String,
    pub branch: String,
    pub date: String,
    pub file_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShelfFileDto {
    pub path: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShelfItemDto {
    pub id: String,
    pub name: String,
    pub date: String,
    pub file_count: u32,
    pub files: Vec<ShelfFileDto>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRepoDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub current_branch: String,
    pub ahead_count: u32,
    pub behind_count: u32,
    pub dirty_files_count: u32,
    pub is_favorite: bool,
    pub last_opened: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoteDto {
    pub name: String,
    pub fetch_url: String,
    pub push_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteListDto {
    pub remotes: Vec<GitRemoteDto>,
    pub current_branch: String,
    pub upstream_remote: Option<String>,
    pub upstream_branch: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedRepoDisk {
    id: String,
    name: String,
    path: String,
    is_favorite: bool,
    last_opened: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoSnapshot {
    pub current_branch: String,
    pub head_hash: String,
    pub ahead_count: u32,
    pub behind_count: u32,
    pub dirty_files_count: u32,
    pub git_version: String,
    pub user_name: String,
    pub changes: Vec<FileChangeDto>,
    pub commits: Vec<GitCommitDto>,
    #[serde(default)]
    pub commits_has_more: bool,
    pub branches: Vec<GitBranchDto>,
    pub tags: Vec<GitTagDto>,
    pub stashes: Vec<StashItemDto>,
    pub shelves: Vec<ShelfItemDto>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ShelfDisk {
    id: String,
    name: String,
    date: String,
    files: Vec<ShelfFileDto>,
    patch: String,
    new_files: Vec<NewFileDisk>,
}

#[derive(Debug, Serialize, Deserialize)]
struct NewFileDisk {
    path: String,
    content: String,
}

fn ensure_writable(dir: &Path) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|err| format!("create {}: {err}", dir.display()))?;
    let probe = dir.join(".write-probe");
    fs::write(&probe, b"ok").map_err(|err| format!("write {}: {err}", probe.display()))?;
    let _ = fs::remove_file(&probe);
    Ok(())
}

/// 从 EasyGit 改名后，新目录还不存在时把旧数据目录挪过来，避免仓库列表和架藏丢失。
pub(crate) fn adopt_legacy_dir(target: &Path, legacy: &Path) {
    if target.exists() || !legacy.is_dir() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let _ = fs::rename(legacy, target);
}

pub fn writable_data_dir() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let next = PathBuf::from(&local).join("SnailGit");
        adopt_legacy_dir(&next, &PathBuf::from(local).join("EasyGit"));
        candidates.push(next);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let next = parent.join("snail-git-data");
            adopt_legacy_dir(&next, &parent.join("easy-git-data"));
            candidates.push(next);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let next = cwd.join("target").join("snail-git-data");
        adopt_legacy_dir(&next, &cwd.join("target").join("easy-git-data"));
        candidates.push(next);
    }
    let mut errors = Vec::new();
    for dir in candidates {
        match ensure_writable(&dir) {
            Ok(()) => return Ok(dir),
            Err(err) => errors.push(err),
        }
    }
    Err(if errors.is_empty() {
        "没有可写的应用数据目录".into()
    } else {
        errors.join("; ")
    })
}

fn repos_file() -> Result<PathBuf, String> {
    Ok(writable_data_dir()?.join("repos.json"))
}

fn shelf_dir(repo_path: &str) -> Result<PathBuf, String> {
    let dir = writable_data_dir()?.join("shelves").join(repo_id(repo_path));
    fs::create_dir_all(&dir).map_err(|err| format!("无法创建架藏目录：{err}"))?;
    Ok(dir)
}

pub fn repo_id(path: &str) -> String {
    let norm = normalize_path(path);
    let mut hash: u64 = 1469598103934665603;
    for b in norm.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(1099511628211);
    }
    format!("{:016x}", hash)
}

fn normalize_path(path: &str) -> String {
    let mut p = path.replace('/', "\\");
    while p.ends_with('\\') {
        p.pop();
    }
    p.to_lowercase()
}

fn lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

fn git_base(cwd: &str) -> Command {
    let mut cmd = git_command();
    cmd.current_dir(cwd).args([
        "--no-pager",
        "-c",
        "core.quotepath=false",
        "-c",
        "i18n.logOutputEncoding=utf-8",
    ]);
    cmd
}

fn run_git(cwd: &str, args: &[&str], timeout: Duration) -> Result<Output, String> {
    run_git_global(cwd, &[], args, timeout)
}

fn run_git_with_env(
    cwd: &str,
    args: &[&str],
    env: &[(&str, &str)],
    timeout: Duration,
) -> Result<Output, String> {
    let mut cmd = git_base(cwd);
    for (key, value) in env {
        cmd.env(key, value);
    }
    cmd.args(args);
    output_timeout(cmd, timeout)
}

fn run_git_global(
    cwd: &str,
    global: &[&str],
    args: &[&str],
    timeout: Duration,
) -> Result<Output, String> {
    let mut cmd = git_base(cwd);
    cmd.args(global).args(args);
    output_timeout(cmd, timeout)
}

fn output_timeout(mut cmd: Command, timeout: Duration) -> Result<Output, String> {
    let _slot = acquire_git_slot();
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 git：{e}。请确认已安装 Git 并加入 PATH。"))?;

    let mut stdout_pipe = child.stdout.take().unwrap();
    let mut stderr_pipe = child.stderr.take().unwrap();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });

    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let stdout = out_handle.join().unwrap_or_default();
                let stderr = err_handle.join().unwrap_or_default();
                return Ok(Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Git 命令超时。若是推送/拉取，请先在终端完成凭据登录后再试。".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

const NETWORK_TIMEOUT: Duration = Duration::from_secs(90);
const CLONE_TIMEOUT: Duration = Duration::from_secs(600);
const NETWORK_STALL: Duration = Duration::from_secs(30);
const LOGIN_HINT: &str = "请先在终端完成登录后再试。";
const STALL_HINT: &str = "连接远程没有响应。若需要登录，请先在终端完成凭据登录后再试。";

fn git_network(cwd: &str) -> Command {
    let mut cmd = git_base(cwd);
    // 意外打开编辑器会在无窗口进程里卡住。合并已带 --no-edit，这里再失败快速退出。
    cmd.env("GIT_EDITOR", "false").env("GIT_MERGE_AUTOEDIT", "no");
    cmd
}

fn pump_pipe(mut pipe: impl Read, kind: u8, tx: mpsc::Sender<(u8, Vec<u8>)>) {
    let mut buf = [0u8; 1024];
    loop {
        match pipe.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if tx.send((kind, buf[..n].to_vec())).is_err() {
                    break;
                }
            }
        }
    }
}

fn consider_progress(
    line: &str,
    last_emit: &mut Instant,
    last_line: &mut String,
    on_line: &mut dyn FnMut(&str),
    force: bool,
) {
    let line = line.trim();
    if line.is_empty() {
        return;
    }
    *last_line = line.to_string();
    let lower = line.to_ascii_lowercase();
    let urgent = lower.contains("fatal") || lower.contains("error") || lower.contains("denied");
    if force || urgent || last_emit.elapsed() >= Duration::from_millis(200) {
        *last_emit = Instant::now();
        on_line(line);
    }
}

fn drain_progress(
    buf: &mut String,
    last_emit: &mut Instant,
    last_line: &mut String,
    on_line: &mut dyn FnMut(&str),
) {
    while let Some(idx) = buf.find(['\n', '\r']) {
        let line = buf[..idx].to_string();
        buf.drain(..=idx);
        consider_progress(&line, last_emit, last_line, on_line, false);
    }
}

/// 有进度就把总超时放宽到 90 秒；完全没输出超过 30 秒视为凭据或连接挂起，不再等满 60 秒。
fn run_git_streaming(
    cwd: &str,
    args: &[&str],
    timeout: Duration,
    stall: Option<Duration>,
    on_line: &mut dyn FnMut(&str),
) -> Result<Output, String> {
    let _slot = acquire_git_slot();
    let mut cmd = git_network(cwd);
    cmd.args(args);
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 git：{e}。请确认已安装 Git 并加入 PATH。"))?;

    let stdout_pipe = child.stdout.take().unwrap();
    let stderr_pipe = child.stderr.take().unwrap();
    let (tx, rx) = mpsc::channel::<(u8, Vec<u8>)>();
    let err_tx = tx.clone();
    let out_handle = std::thread::spawn(move || pump_pipe(stdout_pipe, 0, tx));
    let err_handle = std::thread::spawn(move || pump_pipe(stderr_pipe, 1, err_tx));

    let start = Instant::now();
    let mut last_output = Instant::now();
    let mut last_emit = start - Duration::from_secs(1);
    let mut last_line = String::new();
    let mut pending_err = String::new();
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut out_handle = Some(out_handle);
    let mut err_handle = Some(err_handle);

    let apply_chunk = |kind: u8,
                       chunk: Vec<u8>,
                       last_output: &mut Instant,
                       pending_err: &mut String,
                       stdout: &mut Vec<u8>,
                       stderr: &mut Vec<u8>,
                       last_emit: &mut Instant,
                       last_line: &mut String,
                       on_line: &mut dyn FnMut(&str)| {
        *last_output = Instant::now();
        if kind == 1 {
            pending_err.push_str(&String::from_utf8_lossy(&chunk));
            stderr.extend_from_slice(&chunk);
            drain_progress(pending_err, last_emit, last_line, on_line);
        } else {
            stdout.extend_from_slice(&chunk);
        }
    };
    let stop_child = |child: &mut Child,
                      out_handle: &mut Option<std::thread::JoinHandle<()>>,
                      err_handle: &mut Option<std::thread::JoinHandle<()>>| {
        let _ = child.kill();
        let _ = child.wait();
        if let Some(handle) = out_handle.take() {
            let _ = handle.join();
        }
        if let Some(handle) = err_handle.take() {
            let _ = handle.join();
        }
    };

    let status = loop {
        while let Ok((kind, chunk)) = rx.try_recv() {
            apply_chunk(
                kind,
                chunk,
                &mut last_output,
                &mut pending_err,
                &mut stdout,
                &mut stderr,
                &mut last_emit,
                &mut last_line,
                on_line,
            );
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if stall.is_some_and(|limit| last_output.elapsed() > limit) => {
                stop_child(&mut child, &mut out_handle, &mut err_handle);
                return Err(STALL_HINT.into());
            }
            Ok(None) if start.elapsed() > timeout => {
                stop_child(&mut child, &mut out_handle, &mut err_handle);
                return Err("Git 命令超时。传输时间过长，已中止，请稍后重试。".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(err) => {
                stop_child(&mut child, &mut out_handle, &mut err_handle);
                return Err(err.to_string());
            }
        }
    };
    if let Some(handle) = out_handle.take() {
        let _ = handle.join();
    }
    if let Some(handle) = err_handle.take() {
        let _ = handle.join();
    }
    while let Ok((kind, chunk)) = rx.try_recv() {
        apply_chunk(
            kind,
            chunk,
            &mut last_output,
            &mut pending_err,
            &mut stdout,
            &mut stderr,
            &mut last_emit,
            &mut last_line,
            on_line,
        );
    }
    if !pending_err.trim().is_empty() {
        consider_progress(&pending_err, &mut last_emit, &mut last_line, on_line, true);
    } else if !last_line.is_empty() {
        consider_progress(&last_line.clone(), &mut last_emit, &mut last_line, on_line, true);
    }
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn auth_hint(text: &str) -> Option<&'static str> {
    let lower = text.to_ascii_lowercase();
    const MARKERS: &[&str] = &[
        "authentication failed",
        "could not read username",
        "could not read password",
        "terminal prompts disabled",
        "permission denied (publickey)",
        "invalid username or password",
        "http basic: access denied",
        "requested url returned error: 401",
        "requested url returned error: 403",
        "support for password authentication was removed",
        "authentication required",
        "could not read from remote repository",
        "please make sure you have the correct access rights",
    ];
    if MARKERS.iter().any(|marker| lower.contains(marker)) {
        Some(LOGIN_HINT)
    } else {
        None
    }
}

fn finish_network(output: &Output, action: &str) -> Result<String, String> {
    let err = lossy(&output.stderr);
    let out = lossy(&output.stdout);
    if output.status.success() {
        return Ok(if out.is_empty() { err } else { out });
    }
    let msg = if err.is_empty() { out } else { err };
    if let Some(hint) = auth_hint(&msg) {
        return Err(hint.into());
    }
    let rejected = {
        let lower = msg.to_ascii_lowercase();
        lower.contains("non-fast-forward") || lower.contains("[rejected]") || lower.contains("failed to push")
    };
    if rejected {
        return Err(format!("推送被拒绝。远程有本地没有的提交，请先 Update。\n{msg}"));
    }
    Err(if msg.is_empty() {
        format!("{action}失败")
    } else {
        format!("{action}失败：{msg}")
    })
}

fn first_line(text: &str) -> String {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("")
        .to_string()
}

fn ensure_ok(output: &Output, action: &str) -> Result<String, String> {
    if output.status.success() {
        Ok(lossy(&output.stdout))
    } else {
        let err = lossy(&output.stderr);
        let out = lossy(&output.stdout);
        let msg = if err.is_empty() { out } else { err };
        Err(if msg.is_empty() {
            format!("{action}失败")
        } else {
            format!("{action}失败：{msg}")
        })
    }
}

pub fn validate_repo(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if !p.is_dir() {
        return Err("目录不存在".into());
    }
    let output = run_git(path, &["rev-parse", "--show-toplevel"], Duration::from_secs(8))?;
    let top = ensure_ok(&output, "识别仓库")?;
    if top.is_empty() {
        return Err("不是 Git 仓库".into());
    }
    Ok(top.replace('/', "\\"))
}

fn recycle_inside_repo(repo: &str, full: &Path) -> Result<(), String> {
    let canon = fs::canonicalize(full).map_err(|e| format!("无法定位文件：{e}"))?;
    let root = fs::canonicalize(repo).map_err(|e| e.to_string())?;
    if !canon.starts_with(&root) {
        return Err("拒绝删除仓库外文件".into());
    }
    recycle_file(&canon)
}

fn recycle_file(path: &Path) -> Result<(), String> {
    let display = path.display().to_string();
    let plain = display.strip_prefix(r"\\?\").unwrap_or(&display);
    let escaped = plain.replace('\'', "''");
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('{escaped}', 'OnlyErrorDialogs', 'SendToRecycleBin')"
    );
    let _slot = acquire_git_slot();
    let output = hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("无法把文件移入回收站：{e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!("移入回收站失败：{}", lossy(&output.stderr)))
    }
}

fn safe_rel(path: &str) -> Result<String, String> {
    let p = path.replace('\\', "/");
    if p.starts_with('/') || p.contains(':') || p.split('/').any(|s| s == "..") {
        return Err(format!("拒绝不安全路径：{path}"));
    }
    Ok(p)
}

fn filename_of(path: &str) -> String {
    path.replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .to_string()
}

fn map_xy(x: char, y: char) -> (String, bool) {
    if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
        return ("conflict".into(), false);
    }
    if x == '?' || y == '?' {
        return ("untracked".into(), false);
    }
    let staged = x != ' ' && x != '?';
    let code = if y != ' ' && y != '?' { y } else { x };
    let status = match code {
        'A' => "added",
        'D' => "deleted",
        'U' => "conflict",
        _ => "modified",
    };
    (status.into(), staged)
}

pub fn status_files(repo: &str) -> Result<Vec<FileChangeDto>, String> {
    let output = run_git(
        repo,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=normal",
        ],
        Duration::from_secs(20),
    )?;
    if !output.status.success() {
        return Err(format!("读取状态失败：{}", lossy(&output.stderr)));
    }
    let parts: Vec<String> = output
        .stdout
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect();

    let mut files = Vec::new();
    let mut i = 0;
    while i < parts.len() {
        let entry = &parts[i];
        if entry.len() < 3 {
            i += 1;
            continue;
        }
        let x = entry.chars().next().unwrap_or(' ');
        let y = entry.chars().nth(1).unwrap_or(' ');
        let path = entry[3..].to_string();
        let mut display = path.clone();
        let mut old_path = None;
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            i += 1;
            if i < parts.len() {
                // git 2.34 porcelain -z 的第一段是当前路径，第二段才是原路径。
                display = path;
                old_path = Some(parts[i].clone());
            }
        }
        i += 1;
        let (status, is_staged) = map_xy(x, y);
        files.push(FileChangeDto {
            id: display.replace('\\', "/"),
            filename: filename_of(&display),
            path: display,
            old_path,
            status,
            additions: 0,
            deletions: 0,
            is_staged,
            chunks: Vec::new(),
            chunks_loaded: false,
        });
    }
    Ok(files)
}

pub fn signature(repo: &str) -> String {
    poll_signature(repo).unwrap_or_default()
}

/// 轮询用。失败返回 None，调用方应保留上一次签名，避免超时和成功交替把刷新打成死循环。
pub fn poll_signature(repo: &str) -> Option<String> {
    let out = run_git_global(
        repo,
        &["--no-optional-locks"],
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "--ignore-submodules=dirty",
        ],
        Duration::from_secs(8),
    )
    .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(format!("{}\n{}", read_head_hint(repo), lossy(&out.stdout)))
}

fn read_head_hint(repo: &str) -> String {
    let dotgit = Path::new(repo).join(".git");
    let head = if dotgit.is_dir() {
        dotgit.join("HEAD")
    } else {
        let Ok(text) = fs::read_to_string(&dotgit) else {
            return String::new();
        };
        let Some(dir) = text
            .lines()
            .find_map(|line| line.trim().strip_prefix("gitdir:"))
            .map(|p| p.trim().to_string())
        else {
            return String::new();
        };
        let dir = PathBuf::from(dir);
        let dir = if dir.is_absolute() {
            dir
        } else {
            Path::new(repo).join(dir)
        };
        dir.join("HEAD")
    };
    fs::read_to_string(head).unwrap_or_default().trim().to_string()
}

fn ahead_behind(repo: &str) -> (u32, u32) {
    let output = run_git(
        repo,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        Duration::from_secs(8),
    );
    let Ok(output) = output else { return (0, 0) };
    if !output.status.success() {
        return (0, 0);
    }
    let text = lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let ahead = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let behind = parts.next().unwrap_or("0").parse().unwrap_or(0);
    (ahead, behind)
}

fn current_branch(repo: &str) -> Result<(String, String), String> {
    let output = run_git(
        repo,
        &["rev-parse", "--abbrev-ref", "HEAD"],
        Duration::from_secs(8),
    )?;
    let branch = ensure_ok(&output, "读取分支")?;
    let head = run_git(repo, &["rev-parse", "--short", "HEAD"], Duration::from_secs(8))
        .ok()
        .and_then(|o| ensure_ok(&o, "读取 HEAD").ok())
        .unwrap_or_default();
    Ok((branch, head))
}

const LOG_PAGE_SIZE: usize = 200;
const LOG_FETCH_CAP: usize = 20_000;
const HISTORY_PRETTY: &str =
    "COMMIT\x1f%H\x1f%h\x1f%P\x1f%an\x1f%ae\x1f%ad\x1f%ar\x1f%ct\x1f%D\x1f%s\x1f%b\x1e";

#[derive(Debug, Clone)]
pub struct CommitLogQuery {
    pub branch: String,
    pub author: String,
    pub date: String,
    pub path: String,
    pub search: String,
    pub skip: u32,
    pub limit: usize,
}

impl Default for CommitLogQuery {
    fn default() -> Self {
        Self {
            branch: "All".into(),
            author: "All".into(),
            date: "All".into(),
            path: String::new(),
            search: String::new(),
            skip: 0,
            limit: 0,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitLogPage {
    pub commits: Vec<GitCommitDto>,
    pub has_more: bool,
}

struct TimedCommit {
    committer_time: i64,
    commit: GitCommitDto,
}

struct HistoryRev {
    args: Vec<String>,
    ancestor: Option<String>,
}

/// 历史列表只取图谱需要的元数据。文件和增删行在点开提交时再读。
/// limit 为 0 时使用默认页大小。搜索是说明、作者、哈希的并集，不是在已加载页里过滤。
pub fn load_commit_log(repo: &str, query: &CommitLogQuery) -> Result<CommitLogPage, String> {
    let top = validate_repo(repo)?;
    let limit = if query.limit == 0 {
        LOG_PAGE_SIZE
    } else {
        query.limit.min(LOG_PAGE_SIZE)
    };
    let skip = query.skip as usize;
    if skip.saturating_add(limit) > LOG_FETCH_CAP {
        return Err("已达到可继续加载的上限".into());
    }
    let search = query.search.trim();
    if search.is_empty() {
        load_history_page(&top, query, skip, limit)
    } else {
        load_search_page(&top, query, search, skip, limit)
    }
}

pub fn load_commit_files(repo: &str, hash: &str) -> Result<Vec<CommitFileDto>, String> {
    let top = validate_repo(repo)?;
    validate_commit_hash(hash)?;
    let output = run_git(
        &top,
        &[
            "log",
            "-1",
            "--name-status",
            "--find-renames",
            "--pretty=format:",
            hash,
        ],
        Duration::from_secs(15),
    )?;
    let text = ensure_ok(&output, "读取提交文件")?;
    let mut files = parse_name_status(&text);
    attach_commit_numstat(&top, hash, &mut files);
    Ok(files)
}

fn load_history_page(
    repo: &str,
    query: &CommitLogQuery,
    skip: usize,
    limit: usize,
) -> Result<CommitLogPage, String> {
    let rev = history_rev(&query.branch)?;
    let mut args = base_log_args(&rev.args);
    push_exact_author(&mut args, &query.author)?;
    push_since(&mut args, &query.date);
    args.push("-n".into());
    args.push((limit + 1).to_string());
    if skip > 0 {
        args.push("--skip".into());
        args.push(skip.to_string());
    }
    push_path(&mut args, &query.path)?;
    let mut commits = run_history(repo, &args)?
        .into_iter()
        .map(|item| item.commit)
        .collect::<Vec<_>>();
    let has_more = commits.len() > limit;
    if has_more {
        commits.truncate(limit);
    }
    Ok(finish_page(commits, has_more))
}

fn load_search_page(
    repo: &str,
    query: &CommitLogQuery,
    search: &str,
    skip: usize,
    limit: usize,
) -> Result<CommitLogPage, String> {
    reject_control(search, "搜索条件")?;
    let rev = history_rev(&query.branch)?;
    let fetch = skip + limit + 1;
    let mut arms = Vec::new();

    let mut message = base_log_args(&rev.args);
    message.push("-E".into());
    message.push("-i".into());
    message.push(format!("--grep={}", regex_literal(search)));
    push_exact_author(&mut message, &query.author)?;
    push_since(&mut message, &query.date);
    message.push("-n".into());
    message.push(fetch.to_string());
    push_path(&mut message, &query.path)?;
    arms.push(run_history(repo, &message)?);

    if author_search_useful(&query.author, search) {
        let mut author = base_log_args(&rev.args);
        author.push("-E".into());
        if blank_or_all(&query.author) {
            author.push("-i".into());
            author.push(format!("--author={}", regex_literal(search)));
        } else {
            push_exact_author(&mut author, &query.author)?;
        }
        push_since(&mut author, &query.date);
        author.push("-n".into());
        author.push(fetch.to_string());
        push_path(&mut author, &query.path)?;
        arms.push(run_history(repo, &author)?);
    }

    if let Ok(hashes) = disambiguated_commits(repo, search, rev.ancestor.as_deref()) {
        if !hashes.is_empty() {
            let mut hashed = base_log_args(&[]);
            hashed.push("--no-walk".into());
            hashed.push("-E".into());
            push_exact_author(&mut hashed, &query.author)?;
            push_since(&mut hashed, &query.date);
            hashed.extend(hashes);
            push_path(&mut hashed, &query.path)?;
            if let Ok(found) = run_history(repo, &hashed) {
                arms.push(found);
            }
        }
    }

    Ok(merge_arms(arms, skip, limit))
}

fn finish_page(mut commits: Vec<GitCommitDto>, has_more: bool) -> CommitLogPage {
    assign_tracks(&mut commits);
    CommitLogPage { commits, has_more }
}

fn merge_arms(arms: Vec<Vec<TimedCommit>>, skip: usize, limit: usize) -> CommitLogPage {
    let mut all = Vec::new();
    for arm in arms {
        all.extend(arm);
    }
    all.sort_by(|left, right| {
        right
            .committer_time
            .cmp(&left.committer_time)
            .then_with(|| left.commit.hash.cmp(&right.commit.hash))
    });
    let mut seen = std::collections::HashSet::new();
    let mut merged = Vec::new();
    for item in all {
        if seen.insert(item.commit.hash.clone()) {
            merged.push(item.commit);
        }
    }
    let has_more = merged.len() > skip + limit;
    let commits = merged.into_iter().skip(skip).take(limit).collect();
    finish_page(commits, has_more)
}

fn run_history(repo: &str, args: &[String]) -> Result<Vec<TimedCommit>, String> {
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_git(repo, &refs, Duration::from_secs(25))?;
    let text = ensure_ok(&output, "读取提交历史")?;
    Ok(parse_history(&text))
}

fn base_log_args(revision: &[String]) -> Vec<String> {
    let mut args = vec![
        "log".into(),
        "--date-order".into(),
        "--decorate=short".into(),
        "--date=format:%Y-%m-%d %H:%M:%S".into(),
        format!("--pretty=format:{HISTORY_PRETTY}"),
    ];
    args.extend(revision.iter().cloned());
    args
}

fn history_rev(branch: &str) -> Result<HistoryRev, String> {
    let branch = branch.trim();
    if blank_or_all(branch) {
        return Ok(HistoryRev {
            args: vec!["--all".into()],
            ancestor: None,
        });
    }
    if branch == "Head" || branch == "HEAD" {
        return Ok(HistoryRev {
            args: vec!["HEAD".into()],
            ancestor: Some("HEAD".into()),
        });
    }
    validate_log_rev(branch)?;
    Ok(HistoryRev {
        args: vec![branch.to_string()],
        ancestor: Some(branch.to_string()),
    })
}

fn validate_log_rev(name: &str) -> Result<(), String> {
    validate_rev(name)?;
    if name.contains("..")
        || name.contains(' ')
        || name.contains(':')
        || name.contains('^')
        || name.contains('~')
        || name.contains('\\')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains('@')
        || name.contains('\t')
    {
        return Err(format!("无效的修订版本：{name}"));
    }
    Ok(())
}

fn push_exact_author(args: &mut Vec<String>, author: &str) -> Result<(), String> {
    if blank_or_all(author) {
        return Ok(());
    }
    let author = author.trim();
    reject_control(author, "作者")?;
    args.push("-E".into());
    // --author 匹配的是 "Name <email>"，不能用 ^Name$ 否则精确筛选永远落空。
    args.push(format!("--author=^{} <", regex_literal(author)));
    Ok(())
}

fn push_since(args: &mut Vec<String>, date: &str) {
    let since = match date.trim() {
        "Today" => "midnight",
        "Last 7 Days" => "7 days ago",
        "Last 30 Days" => "30 days ago",
        _ => return,
    };
    args.push(format!("--since={since}"));
}

fn push_path(args: &mut Vec<String>, path: &str) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(());
    }
    reject_control(path, "路径")?;
    args.push("--".into());
    args.push(path.to_string());
    Ok(())
}

fn blank_or_all(value: &str) -> bool {
    let value = value.trim();
    value.is_empty() || value == "All"
}

fn author_search_useful(author: &str, search: &str) -> bool {
    if blank_or_all(author) {
        return true;
    }
    author.to_lowercase().contains(&search.to_lowercase())
}

fn reject_control(value: &str, label: &str) -> Result<(), String> {
    if value.chars().any(|ch| ch == '\n' || ch == '\r' || ch == '\0') {
        return Err(format!("无效的{label}"));
    }
    Ok(())
}

fn regex_literal(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for ch in text.chars() {
        if matches!(
            ch,
            '\\' | '.' | '*' | '+' | '?' | '|' | '(' | ')' | '[' | ']' | '{' | '}' | '^' | '$'
        ) {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

fn is_hex_prefix(text: &str) -> bool {
    (4..=40).contains(&text.len()) && text.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn validate_commit_hash(hash: &str) -> Result<(), String> {
    if is_hex_prefix(hash) && hash.len() >= 7 {
        Ok(())
    } else {
        Err("无效的提交哈希".into())
    }
}

fn disambiguated_commits(
    repo: &str,
    prefix: &str,
    ancestor: Option<&str>,
) -> Result<Vec<String>, String> {
    if !is_hex_prefix(prefix) {
        return Ok(Vec::new());
    }
    let output = match run_git(
        repo,
        &["rev-parse", &format!("--disambiguate={prefix}")],
        Duration::from_secs(12),
    ) {
        Ok(output) if output.status.success() => output,
        _ => return Ok(Vec::new()),
    };
    let mut hashes = Vec::new();
    for line in lossy(&output.stdout).lines().take(40) {
        let obj = line.trim();
        if obj.is_empty() || !obj.chars().all(|ch| ch.is_ascii_hexdigit()) {
            continue;
        }
        let spec = format!("{obj}^{{commit}}");
        let verified = match run_git(
            repo,
            &["rev-parse", "--verify", "--quiet", &spec],
            Duration::from_secs(8),
        ) {
            Ok(output) if output.status.success() => lossy(&output.stdout),
            _ => continue,
        };
        if verified.is_empty() {
            continue;
        }
        if let Some(rev) = ancestor {
            let is_ancestor = run_git(
                repo,
                &["merge-base", "--is-ancestor", &verified, rev],
                Duration::from_secs(8),
            )
            .map(|output| output.status.success())
            .unwrap_or(false);
            if !is_ancestor {
                continue;
            }
        }
        hashes.push(verified);
    }
    Ok(hashes)
}

fn parse_history(text: &str) -> Vec<TimedCommit> {
    let mut commits = Vec::new();
    for block in text.split("COMMIT\x1f") {
        if block.trim().is_empty() {
            continue;
        }
        let (meta, _) = block.split_once('\x1e').unwrap_or((block, ""));
        let fields: Vec<&str> = meta.split('\x1f').collect();
        if fields.len() < 10 {
            continue;
        }
        let parents = fields[2]
            .split_whitespace()
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect();
        let refs = fields[8]
            .split(", ")
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect();
        let body = if fields.len() > 10 {
            let text = fields[10..].join("\x1f").trim().to_string();
            if text.is_empty() { None } else { Some(text) }
        } else {
            None
        };
        commits.push(TimedCommit {
            committer_time: fields[7].parse::<i64>().unwrap_or(0),
            commit: GitCommitDto {
                hash: fields[0].to_string(),
                short_hash: fields[1].to_string(),
                subject: fields[9].to_string(),
                body,
                author: fields[3].to_string(),
                author_email: fields[4].to_string(),
                date: fields[5].to_string(),
                relative_date: fields[6].to_string(),
                parents,
                refs,
                branch_track: 0,
                files: Vec::new(),
            },
        });
    }
    commits
}

fn parse_name_status(text: &str) -> Vec<CommitFileDto> {
    let mut files = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        let code = cols.next().unwrap_or("");
        if !code.chars().next().is_some_and(|ch| ch.is_ascii_alphabetic()) {
            continue;
        }
        let path = cols.next().unwrap_or("").to_string();
        if path.is_empty() {
            continue;
        }
        let new_path = cols.next().unwrap_or("").to_string();
        let display = if new_path.is_empty() { path } else { new_path };
        let status = match code.chars().next().unwrap_or('M') {
            'A' => "added",
            'D' => "deleted",
            'U' => "conflict",
            _ => "modified",
        };
        files.push(CommitFileDto {
            filename: filename_of(&display),
            path: display.replace('\\', "/"),
            status: status.into(),
            additions: 0,
            deletions: 0,
        });
    }
    files
}

fn attach_commit_numstat(repo: &str, hash: &str, files: &mut [CommitFileDto]) {
    if files.is_empty() {
        return;
    }
    let output = match run_git(
        repo,
        &["log", "-1", "--numstat", "--pretty=format:%H", hash],
        Duration::from_secs(15),
    ) {
        Ok(output) if output.status.success() => lossy(&output.stdout),
        _ => return,
    };
    let mut rows = Vec::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() || !line.contains('\t') {
            continue;
        }
        let mut cols = line.split('\t');
        let additions = cols.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let deletions = cols.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let path = cols.next().unwrap_or("").replace('\\', "/");
        if path.is_empty() {
            continue;
        }
        rows.push((additions, deletions, path));
    }
    for file in files.iter_mut() {
        let wanted = file.path.replace('\\', "/");
        if let Some((additions, deletions, _)) = rows.iter().find(|(_, _, path)| numstat_matches(&wanted, path)) {
            file.additions = *additions;
            file.deletions = *deletions;
        }
    }
}

fn numstat_matches(file_path: &str, stat_path: &str) -> bool {
    if file_path == stat_path {
        return true;
    }
    if let Some(idx) = stat_path.rfind("=>") {
        let after = stat_path[idx + 2..].trim().trim_matches(|c| c == '{' || c == '}');
        return !after.is_empty() && (file_path == after || file_path.ends_with(&format!("/{after}")));
    }
    false
}

fn assign_tracks(commits: &mut [GitCommitDto]) {
    let mut lanes: Vec<Option<String>> = Vec::new();
    for commit in commits.iter_mut() {
        let found = lanes.iter().position(|l| l.as_deref() == Some(commit.hash.as_str()));
        let lane = if let Some(i) = found {
            i
        } else if let Some(i) = lanes.iter().position(|l| l.is_none()) {
            i
        } else {
            lanes.push(None);
            lanes.len() - 1
        };
        if let Some(parent) = commit.parents.first() {
            lanes[lane] = Some(parent.clone());
        } else {
            lanes[lane] = None;
        }
        for parent in commit.parents.iter().skip(1) {
            if let Some(free) = lanes.iter().position(|l| l.is_none()) {
                lanes[free] = Some(parent.clone());
            } else {
                lanes.push(Some(parent.clone()));
            }
        }
        commit.branch_track = lane as u32;
    }
}

pub fn list_branches(repo: &str, current: &str) -> Result<Vec<GitBranchDto>, String> {
    let output = run_git(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)\u{1f}%(objectname:short)\u{1f}%(subject)",
            "refs/heads",
            "refs/remotes",
        ],
        Duration::from_secs(15),
    )?;
    let text = ensure_ok(&output, "读取分支")?;
    let (ahead, behind) = ahead_behind(repo);
    let mut branches = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\x1f');
        let refname = cols.next().unwrap_or("");
        let hash = cols.next().unwrap_or("").to_string();
        let subject = cols.next().unwrap_or("").to_string();
        if refname.ends_with("/HEAD") {
            continue;
        }
        let (name, is_remote) = if let Some(n) = refname.strip_prefix("refs/heads/") {
            (n.to_string(), false)
        } else if let Some(n) = refname.strip_prefix("refs/remotes/") {
            (n.to_string(), true)
        } else {
            continue;
        };
        let is_current = !is_remote && name == current;
        let favorites = favorite_branch_names(repo);
        branches.push(GitBranchDto {
            ahead: if is_current { Some(ahead) } else { None },
            behind: if is_current { Some(behind) } else { None },
            is_current,
            is_remote,
            upstream: None,
            last_commit_hash: hash,
            last_commit_message: subject,
            is_favorite: favorites.iter().any(|n| n == &name),
            name,
        });
    }
    Ok(branches)
}

pub fn list_tags(repo: &str) -> Result<Vec<GitTagDto>, String> {
    let output = run_git(
        repo,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            "--format=%(refname:short)\u{1f}%(*objectname:short)\u{1f}%(objectname:short)\u{1f}%(subject)",
            "refs/tags",
        ],
        Duration::from_secs(15),
    )?;
    let text = ensure_ok(&output, "读取标签")?;
    let mut tags = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\x1f');
        let name = cols.next().unwrap_or("").trim().to_string();
        if name.is_empty() {
            continue;
        }
        let peeled = cols.next().unwrap_or("").trim().to_string();
        let object = cols.next().unwrap_or("").trim().to_string();
        let subject = cols.next().unwrap_or("").to_string();
        let hash = if peeled.is_empty() { object } else { peeled };
        tags.push(GitTagDto { name, hash, subject });
    }
    Ok(tags)
}

pub fn list_stashes(repo: &str) -> Result<Vec<StashItemDto>, String> {
    let output = run_git(
        repo,
        &["stash", "list", "--pretty=format:%gd%x1f%gs%x1f%ci"],
        Duration::from_secs(10),
    )?;
    if !output.status.success() {
        return Ok(Vec::new());
    }
    let text = lossy(&output.stdout);
    let counts = if text.trim().is_empty() {
        Vec::new()
    } else {
        stash_file_counts(repo)
    };
    let mut items = Vec::new();
    let mut seen = 0usize;
    for (idx, line) in text.lines().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        let mut cols = line.split('\x1f');
        let gd = cols.next().unwrap_or("");
        let message = cols.next().unwrap_or("").to_string();
        let date = cols.next().unwrap_or("").to_string();
        let branch = message
            .split("on ")
            .nth(1)
            .and_then(|s| s.split(':').next())
            .unwrap_or("")
            .trim()
            .to_string();
        let index = gd
            .trim_start_matches("stash@{")
            .trim_end_matches('}')
            .parse()
            .unwrap_or(idx as u32);
        let file_count = counts.get(seen).copied().unwrap_or(0);
        seen += 1;
        items.push(StashItemDto {
            id: format!("stash-{index}"),
            index,
            message,
            branch,
            date,
            file_count,
        });
    }
    Ok(items)
}

fn stash_file_counts(repo: &str) -> Vec<u32> {
    let output = match run_git(
        repo,
        &["log", "-g", "--name-only", "--pretty=format:%x1e", "refs/stash"],
        Duration::from_secs(12),
    ) {
        Ok(output) if output.status.success() => output,
        _ => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    text.split('\x1e')
        .filter(|block| !block.is_empty())
        .map(|block| {
            block
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .count() as u32
        })
        .collect()
}

pub fn load_snapshot(repo: &str) -> Result<RepoSnapshot, String> {
    let top = validate_repo(repo)?;
    let (branch, head) = current_branch(&top)?;
    let changes = status_files(&top)?;
    let (ahead, behind) = ahead_behind(&top);
    let version = run_git(&top, &["--version"], Duration::from_secs(5))
        .ok()
        .and_then(|o| ensure_ok(&o, "git version").ok())
        .unwrap_or_else(|| "git".into());
    let user_name = configured_user_name(&top);
    let log_page = load_commit_log(&top, &CommitLogQuery::default()).unwrap_or(CommitLogPage {
        commits: Vec::new(),
        has_more: false,
    });
    Ok(RepoSnapshot {
        dirty_files_count: changes.len() as u32,
        commits: log_page.commits,
        commits_has_more: log_page.has_more,
        branches: list_branches(&top, &branch).unwrap_or_default(),
        tags: list_tags(&top).unwrap_or_default(),
        stashes: list_stashes(&top).unwrap_or_default(),
        shelves: list_shelves(&top).unwrap_or_default(),
        current_branch: branch,
        head_hash: head,
        ahead_count: ahead,
        behind_count: behind,
        git_version: version,
        user_name,
        changes,
    })
}

fn configured_user_name(repo: &str) -> String {
    run_git(repo, &["config", "--get", "user.name"], Duration::from_secs(5))
        .ok()
        .and_then(|output| ensure_ok(&output, "user.name").ok())
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_default()
}

fn split_hunks(diff_text: &str, staged: bool, id_prefix: &str) -> Vec<DiffChunkDto> {
    if diff_text.contains("Binary files") || diff_text.contains("GIT binary patch") {
        return Vec::new();
    }
    let preamble_end = diff_text.find("@@").unwrap_or(diff_text.len());
    let preamble = diff_text[..preamble_end].to_string();
    let body = &diff_text[preamble_end..];
    if body.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut current_header = String::new();
    let mut current_lines: Vec<&str> = Vec::new();
    let flush = |header: &str, lines: &[&str], chunks: &mut Vec<DiffChunkDto>| {
        if header.is_empty() {
            return;
        }
        if let Some(chunk) = parse_hunk(header, lines, staged, id_prefix, chunks.len(), &preamble) {
            chunks.push(chunk);
        }
    };
    for line in body.lines() {
        if line.starts_with("@@") {
            flush(&current_header, &current_lines, &mut chunks);
            current_header = line.to_string();
            current_lines.clear();
        } else if !current_header.is_empty() {
            current_lines.push(line);
        }
    }
    flush(&current_header, &current_lines, &mut chunks);
    chunks
}

fn parse_hunk(
    header: &str,
    raw_lines: &[&str],
    staged: bool,
    id_prefix: &str,
    index: usize,
    preamble: &str,
) -> Option<DiffChunkDto> {
    // @@ -l,s +l,s @@
    let spec = header.trim_start_matches("@@").trim();
    let spec = spec.split("@@").next().unwrap_or("").trim();
    let mut parts = spec.split_whitespace();
    let old = parts.next().unwrap_or("-0,0");
    let new = parts.next().unwrap_or("+0,0");
    let (old_start, old_lines) = parse_range(old);
    let (new_start, new_lines) = parse_range(new);
    let mut lines = Vec::new();
    let mut old_no = old_start;
    let mut new_no = new_start;
    let mut patch_body = String::new();
    for line in raw_lines {
        if line.starts_with('\\') {
            continue;
        }
        patch_body.push_str(line);
        patch_body.push('\n');
        if line.starts_with('+') {
            lines.push(plain_line("added", None, Some(new_no), None, Some(line[1..].to_string())));
            new_no += 1;
        } else if line.starts_with('-') {
            lines.push(plain_line("deleted", Some(old_no), None, Some(line[1..].to_string()), None));
            old_no += 1;
        } else {
            let content = line.strip_prefix(' ').unwrap_or(line).to_string();
            lines.push(plain_line("unchanged", Some(old_no), Some(new_no), Some(content.clone()), Some(content)));
            old_no += 1;
            new_no += 1;
        }
    }
    let lines = pair_modified_lines(lines);
    let preamble = preamble
        .lines()
        .filter(|line| !line.starts_with("index "))
        .collect::<Vec<_>>()
        .join("\n");
    let preamble = if preamble.is_empty() { String::new() } else { format!("{preamble}\n") };
    let raw_patch = format!("{preamble}{header}\n{patch_body}");
    Some(DiffChunkDto {
        id: format!("{id_prefix}-{index}-{old_start}-{new_start}"),
        old_start,
        old_lines,
        new_start,
        new_lines,
        is_staged: staged,
        lines,
        raw_patch,
    })
}

fn parse_range(token: &str) -> (u32, u32) {
    let t = token.trim_start_matches(['-', '+']);
    let mut parts = t.split(',');
    let start = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let count = parts.next().unwrap_or("1").parse().unwrap_or(1);
    (start, count)
}

fn plain_line(
    kind: &str,
    old_no: Option<u32>,
    new_no: Option<u32>,
    old: Option<String>,
    new: Option<String>,
) -> DiffLineDto {
    DiffLineDto {
        kind: kind.into(),
        old_line_number: old_no,
        new_line_number: new_no,
        old_content: old,
        new_content: new,
        word_diff: None,
        old_word_diff: None,
    }
}

fn pair_modified_lines(lines: Vec<DiffLineDto>) -> Vec<DiffLineDto> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        if lines[i].kind != "deleted" {
            out.push(lines[i].clone());
            i += 1;
            continue;
        }
        let start = i;
        while i < lines.len() && lines[i].kind == "deleted" {
            i += 1;
        }
        let del_end = i;
        while i < lines.len() && lines[i].kind == "added" {
            i += 1;
        }
        let add_end = i;
        let del_count = del_end - start;
        let add_count = add_end - del_end;
        let paired = del_count.min(add_count);
        for k in 0..paired {
            let old = lines[start + k].old_content.clone().unwrap_or_default();
            let new = lines[del_end + k].new_content.clone().unwrap_or_default();
            let (old_spans, new_spans) = word_spans(&old, &new);
            out.push(DiffLineDto {
                kind: "modified".into(),
                old_line_number: lines[start + k].old_line_number,
                new_line_number: lines[del_end + k].new_line_number,
                old_content: Some(old),
                new_content: Some(new),
                old_word_diff: Some(old_spans),
                word_diff: Some(new_spans),
            });
        }
        out.extend(lines[start + paired..del_end].iter().cloned());
        out.extend(lines[del_end + paired..add_end].iter().cloned());
    }
    out
}

fn tokenize_words(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut word = false;
    for ch in text.chars() {
        let next_word = ch.is_alphanumeric() || ch == '_';
        if !cur.is_empty() && next_word != word {
            out.push(std::mem::take(&mut cur));
        }
        word = next_word;
        cur.push(ch);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn coalesce_spans(spans: Vec<WordSpanDto>) -> Vec<WordSpanDto> {
    let mut out: Vec<WordSpanDto> = Vec::new();
    for span in spans {
        if let Some(last) = out.last_mut() {
            if last.kind == span.kind {
                last.text.push_str(&span.text);
                continue;
            }
        }
        out.push(span);
    }
    out
}

pub fn word_spans(old: &str, new: &str) -> (Vec<WordSpanDto>, Vec<WordSpanDto>) {
    let old_toks = tokenize_words(old);
    let new_toks = tokenize_words(new);
    let n = old_toks.len();
    let m = new_toks.len();
    if n == 0 && m == 0 {
        return (Vec::new(), Vec::new());
    }
    if n.saturating_mul(m) > 4096 {
        return (
            vec![WordSpanDto { kind: "del".into(), text: old.to_string() }],
            vec![WordSpanDto { kind: "add".into(), text: new.to_string() }],
        );
    }
    let mut dp = vec![vec![0u16; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if old_toks[i] == new_toks[j] {
                dp[i + 1][j + 1].saturating_add(1)
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let mut i = 0;
    let mut j = 0;
    let mut old_spans = Vec::new();
    let mut new_spans = Vec::new();
    while i < n && j < m {
        if old_toks[i] == new_toks[j] {
            old_spans.push(WordSpanDto { kind: "same".into(), text: old_toks[i].clone() });
            new_spans.push(WordSpanDto { kind: "same".into(), text: new_toks[j].clone() });
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            old_spans.push(WordSpanDto { kind: "del".into(), text: old_toks[i].clone() });
            i += 1;
        } else {
            new_spans.push(WordSpanDto { kind: "add".into(), text: new_toks[j].clone() });
            j += 1;
        }
    }
    while i < n {
        old_spans.push(WordSpanDto { kind: "del".into(), text: old_toks[i].clone() });
        i += 1;
    }
    while j < m {
        new_spans.push(WordSpanDto { kind: "add".into(), text: new_toks[j].clone() });
        j += 1;
    }
    (coalesce_spans(old_spans), coalesce_spans(new_spans))
}

pub fn file_diff_opts(repo: &str, path: &str, ignore_ws: bool) -> Result<Vec<DiffChunkDto>, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let status = status_files(&top)?;
    let file = status.iter().find(|f| f.path.replace('\\', "/") == rel.replace('\\', "/"));
    let is_untracked = file.map(|f| f.status == "untracked").unwrap_or(false);
    if is_untracked {
        return Ok(untracked_chunks(&top, &rel));
    }
    let ws = if ignore_ws { vec!["-w"] } else { Vec::new() };
    let mut unstaged_args = vec!["diff", "-U3"];
    unstaged_args.extend(ws.iter().copied());
    unstaged_args.extend(["--", rel.as_str()]);
    let unstaged = run_git(&top, &unstaged_args, Duration::from_secs(15))?;
    let mut staged_args = vec!["diff", "--cached", "-U3"];
    staged_args.extend(ws.iter().copied());
    staged_args.extend(["--", rel.as_str()]);
    let staged = run_git(&top, &staged_args, Duration::from_secs(15))?;
    let mut chunks = split_hunks(&lossy(&unstaged.stdout), false, "u");
    chunks.extend(split_hunks(&lossy(&staged.stdout), true, "s"));
    if chunks.is_empty() {
        let mut head_args = vec!["diff", "-U3", "HEAD"];
        head_args.extend(ws.iter().copied());
        head_args.extend(["--", rel.as_str()]);
        let head = run_git(&top, &head_args, Duration::from_secs(15))?;
        chunks = split_hunks(&lossy(&head.stdout), false, "h");
    }
    for chunk in &mut chunks {
        if chunk.lines.len() > 800 {
            chunk.lines.truncate(800);
        }
    }
    Ok(chunks)
}

fn untracked_chunks(repo: &str, rel: &str) -> Vec<DiffChunkDto> {
    let full = Path::new(repo).join(rel);
    let bytes = fs::read(&full).unwrap_or_default();
    if bytes.len() > 200_000 || bytes.contains(&0) {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines = Vec::new();
    let mut patch = format!("diff --git a/{rel} b/{rel}\nnew file mode 100644\n--- /dev/null\n+++ b/{rel}\n");
    let content_lines: Vec<&str> = text.lines().take(300).collect();
    let count = content_lines.len() as u32;
    patch.push_str(&format!("@@ -0,0 +1,{count} @@\n"));
    for (i, line) in content_lines.iter().enumerate() {
        patch.push('+');
        patch.push_str(line);
        patch.push('\n');
        lines.push(plain_line("added", None, Some(i as u32 + 1), None, Some((*line).to_string())));
    }
    vec![DiffChunkDto {
        id: format!("new-{rel}"),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: count,
        is_staged: false,
        lines,
        raw_patch: patch,
    }]
}

pub fn stage_paths(repo: &str, paths: &[String]) -> Result<(), String> {
    let top = validate_repo(repo)?;
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["add", "--"];
    let rels: Vec<String> = paths.iter().map(|p| safe_rel(p)).collect::<Result<_, _>>()?;
    for p in &rels {
        args.push(p);
    }
    let output = run_git(&top, &args, Duration::from_secs(20))?;
    ensure_ok(&output, "暂存")?;
    Ok(())
}

pub fn unstage_paths(repo: &str, paths: &[String]) -> Result<(), String> {
    let top = validate_repo(repo)?;
    if paths.is_empty() {
        return Ok(());
    }
    let mut args = vec!["restore", "--staged", "--"];
    let rels: Vec<String> = paths.iter().map(|p| safe_rel(p)).collect::<Result<_, _>>()?;
    for p in &rels {
        args.push(p);
    }
    let output = run_git(&top, &args, Duration::from_secs(20))?;
    ensure_ok(&output, "取消暂存")?;
    Ok(())
}

pub fn discard_paths(repo: &str, paths: &[String]) -> Result<(), String> {
    let top = validate_repo(repo)?;
    let status = status_files(&top)?;
    for path in paths {
        let rel = safe_rel(path)?;
        let file = status.iter().find(|f| f.path.replace('\\', "/") == rel);
        if let Some(old) = file.and_then(|f| f.old_path.clone()) {
            let old_rel = safe_rel(&old)?;
            let restored = run_git(
                &top,
                &["restore", "--source=HEAD", "--worktree", "--staged", "--", &old_rel],
                Duration::from_secs(15),
            )?;
            ensure_ok(&restored, "恢复重命名前的文件")?;
            let _ = run_git(
                &top,
                &["rm", "--cached", "--ignore-unmatch", "--", &rel],
                Duration::from_secs(10),
            );
            let full = Path::new(&top).join(&rel);
            if full.is_file() {
                recycle_inside_repo(&top, &full)?;
            }
            continue;
        }
        let in_head = run_git(
            &top,
            &["cat-file", "-e", &format!("HEAD:{rel}")],
            Duration::from_secs(8),
        )
        .map(|o| o.status.success())
        .unwrap_or(false);
        if file.map(|f| f.status == "untracked").unwrap_or(false) || !in_head {
            let _ = run_git(&top, &["restore", "--staged", "--", &rel], Duration::from_secs(10));
            let full = Path::new(&top).join(&rel);
            if full.is_file() {
                recycle_inside_repo(&top, &full)?;
            }
            continue;
        }
        let output = run_git(
            &top,
            &["restore", "--source=HEAD", "--worktree", "--staged", "--", &rel],
            Duration::from_secs(15),
        )?;
        ensure_ok(&output, "回滚文件")?;
    }
    Ok(())
}

fn gitignore_line(rel: &str, is_dir: bool) -> String {
    let normalized = rel.replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    let escaped: String = trimmed
        .chars()
        .flat_map(|ch| {
            if matches!(ch, ' ' | '#' | '!' | '*' | '?' | '[' | ']') {
                vec!['\\', ch]
            } else {
                vec![ch]
            }
        })
        .collect();
    if is_dir {
        format!("{escaped}/")
    } else {
        escaped
    }
}

fn ignore_line_matches(existing: &str, pattern: &str) -> bool {
    let norm = |value: &str| {
        value
            .trim()
            .trim_end_matches('/')
            .replace("\\ ", " ")
            .replace('\\', "")
    };
    let target = norm(pattern);
    existing.lines().any(|line| {
        let line = line.trim();
        !line.is_empty() && !line.starts_with('#') && norm(line) == target
    })
}

pub fn append_gitignore(repo: &str, path: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let full = Path::new(&top).join(&rel);
    let pattern = gitignore_line(&rel, full.is_dir());
    let ignore_path = Path::new(&top).join(".gitignore");
    let mut existing = if ignore_path.exists() {
        fs::read_to_string(&ignore_path).map_err(|err| format!("读取 .gitignore 失败：{err}"))?
    } else {
        String::new()
    };
    if ignore_line_matches(&existing, &pattern) {
        return Ok(format!("已在 .gitignore 中：{pattern}"));
    }
    if !existing.is_empty() && !existing.ends_with('\n') {
        existing.push('\n');
    }
    existing.push_str(&pattern);
    existing.push('\n');
    fs::write(&ignore_path, existing).map_err(|err| format!("写入 .gitignore 失败：{err}"))?;
    Ok(format!("已加入 .gitignore：{pattern}"))
}

pub fn delete_unversioned(repo: &str, path: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let status = status_files(&top)?;
    let file = status.iter().find(|item| item.path.replace('\\', "/") == rel);
    if file.map(|item| item.status.as_str() != "untracked").unwrap_or(true) {
        return Err("只能删除未版本管理的文件".into());
    }
    let full = Path::new(&top).join(&rel);
    if !full.is_file() {
        return Err("只能删除未版本管理的文件，目录请先加入 .gitignore".into());
    }
    let canon = fs::canonicalize(&full).map_err(|err| format!("无法定位文件：{err}"))?;
    let root = fs::canonicalize(&top).map_err(|err| err.to_string())?;
    if !canon.starts_with(&root) {
        return Err("拒绝删除仓库外文件".into());
    }
    fs::remove_file(&canon).map_err(|err| format!("删除失败：{err}"))?;
    Ok(format!("已删除 {rel}"))
}

fn run_git_with_stdin(cwd: &str, args: &[&str], stdin_text: &str, timeout: Duration) -> Result<Output, String> {
    let _slot = acquire_git_slot();
    let mut cmd = git_base(cwd);
    cmd.args(args).stdin(Stdio::piped());
    let mut child = cmd
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("无法启动 git：{e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        stdin.write_all(stdin_text.as_bytes()).map_err(|e| e.to_string())?;
    }
    let mut stdout_pipe = child.stdout.take().unwrap();
    let mut stderr_pipe = child.stderr.take().unwrap();
    let out_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let err_handle = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return Ok(Output {
                    status,
                    stdout: out_handle.join().unwrap_or_default(),
                    stderr: err_handle.join().unwrap_or_default(),
                });
            }
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Git 命令超时。若是推送/拉取，请先在终端完成凭据登录后再试。".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(40)),
            Err(e) => return Err(e.to_string()),
        }
    }
}

pub fn apply_chunk(repo: &str, raw_patch: &str, action: &str) -> Result<(), String> {
    let top = validate_repo(repo)?;
    if raw_patch.trim().is_empty() {
        return Err("没有可应用的差异块".into());
    }
    match action {
        "stage" | "unstage" => {
            let mut args = vec!["apply", "--cached", "--unidiff-zero"];
            if action == "unstage" {
                args.insert(1, "-R");
            }
            let output = run_git_with_stdin(&top, &args, raw_patch, Duration::from_secs(15))?;
            ensure_ok(&output, "应用差异块")?;
            Ok(())
        }
        "rollback" => {
            let check = run_git_with_stdin(
                &top,
                &["apply", "--check", "-R", "--unidiff-zero"],
                raw_patch,
                Duration::from_secs(15),
            )?;
            if !check.status.success() {
                return Err("工作区内容和这个差异块不一致，已拒绝回滚，避免覆盖未暂存修改。".into());
            }
            let output = run_git_with_stdin(
                &top,
                &["apply", "-R", "--unidiff-zero"],
                raw_patch,
                Duration::from_secs(15),
            )?;
            ensure_ok(&output, "回滚差异块")?;
            let _ = run_git_with_stdin(
                &top,
                &["apply", "--cached", "--check", "-R", "--unidiff-zero"],
                raw_patch,
                Duration::from_secs(8),
            )
            .and_then(|checked| {
                if checked.status.success() {
                    run_git_with_stdin(
                        &top,
                        &["apply", "--cached", "-R", "--unidiff-zero"],
                        raw_patch,
                        Duration::from_secs(15),
                    )?;
                }
                Ok(())
            });
            Ok(())
        }
        _ => Err("未知块操作".into()),
    }
}

pub fn commit(repo: &str, message: &str, amend: bool, and_push: bool) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let message = message.trim();
    if message.is_empty() {
        return Err("提交说明不能为空".into());
    }
    if amend {
        let published = run_git(
            &top,
            &["rev-list", "--count", "@{upstream}..HEAD"],
            Duration::from_secs(8),
        );
        match published {
            Ok(output) if output.status.success() => {
                let count = lossy(&output.stdout);
                if count == "0" {
                    return Err("这个提交已经推送到上游，拒绝 amend，避免改写已发布历史。".into());
                }
            }
            _ => {}
        }
    }
    let mut args = vec!["commit"];
    if amend {
        args.push("--amend");
    }
    args.push("-m");
    args.push(message);
    let output = run_git(&top, &args, Duration::from_secs(30))?;
    let text = ensure_ok(&output, "提交")?;
    if and_push {
        match push_repo(&top, false, &mut |_| {}) {
            Ok(outcome) if outcome.status == "needs_confirm" => {
                return Ok(format!(
                    "提交已写入，但当前分支没有上游，未自动推送。请用顶部 Push 确认目标。\n{text}"
                ));
            }
            Ok(outcome) => return Ok(format!("{text}\n{}", outcome.message)),
            Err(err) => return Err(format!("提交已写入，但推送失败：{err}")),
        }
    }
    Ok(text)
}

fn looks_like_hash(name: &str) -> bool {
    (7..=40).contains(&name.len()) && name.chars().all(|c| c.is_ascii_hexdigit())
}

pub fn checkout_branch(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    if name.contains("..") || name.contains(' ') {
        return Err("分支名不合法".into());
    }
    if looks_like_hash(name) {
        let output = run_git(&top, &["switch", "--detach", name], Duration::from_secs(20))?;
        return ensure_ok(&output, "检出提交");
    }
    let local = run_git(
        &top,
        &["show-ref", "--verify", "--quiet", &format!("refs/heads/{name}")],
        Duration::from_secs(8),
    )?;
    if local.status.success() {
        let output = run_git(&top, &["switch", "--", name], Duration::from_secs(20))?;
        return ensure_ok(&output, "检出分支");
    }
    // 不限于 origin：日志左侧会列出 agent、feature 等多个上游。
    let remote_ref = format!("refs/remotes/{name}");
    let remote = run_git(
        &top,
        &["show-ref", "--verify", "--quiet", &remote_ref],
        Duration::from_secs(8),
    )?;
    if remote.status.success() {
        let local_name = name
            .split_once('/')
            .map(|(_, rest)| rest)
            .filter(|rest| !rest.is_empty())
            .unwrap_or(name);
        let tracked = run_git(&top, &["switch", "--track", name], Duration::from_secs(20))?;
        if tracked.status.success() {
            return Ok(lossy(&tracked.stdout));
        }
        let created = run_git(
            &top,
            &["switch", "-c", local_name, "--track", name],
            Duration::from_secs(20),
        )?;
        return ensure_ok(&created, "检出远程分支");
    }
    let output = run_git(&top, &["switch", "--", name], Duration::from_secs(20))?;
    ensure_ok(&output, "检出分支")
}

pub fn create_branch(repo: &str, name: &str, start_point: Option<&str>) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let name = name.trim();
    if name.is_empty() || name.contains("..") || name.contains(' ') || name.contains('\\') {
        return Err("分支名不合法".into());
    }
    let output = if let Some(start) = start_point {
        run_git(&top, &["switch", "-c", name, "--", start], Duration::from_secs(20))?
    } else {
        run_git(&top, &["switch", "-c", name], Duration::from_secs(20))?
    };
    ensure_ok(&output, "创建分支")
}

pub fn merge_branch(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["merge", "--no-edit", "--", name], Duration::from_secs(40))?;
    ensure_ok(&output, "合并")
}

pub fn rebase_onto(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["rebase", "--", name], Duration::from_secs(40))?;
    ensure_ok(&output, "变基")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncOutcome {
    pub status: String,
    pub message: String,
    pub ahead: u32,
    pub behind: u32,
    pub remote: String,
    pub branch: String,
    pub conflicting_paths: Vec<String>,
    /// "merge" / "rebase" / "rebase-merges"，前端据此说人话。
    pub strategy: String,
}

fn sync_outcome(
    status: &str,
    message: impl Into<String>,
    ahead: u32,
    behind: u32,
    remote: &str,
    branch: &str,
    conflicting_paths: Vec<String>,
) -> SyncOutcome {
    SyncOutcome {
        status: status.into(),
        message: message.into(),
        ahead,
        behind,
        remote: remote.into(),
        branch: branch.into(),
        conflicting_paths,
        strategy: String::new(),
    }
}

/// 仅内部使用：带上集成策略供前端区分提示文案。
fn sync_outcome_with_strategy(
    status: &str,
    message: impl Into<String>,
    ahead: u32,
    behind: u32,
    remote: &str,
    branch: &str,
    conflicting_paths: Vec<String>,
    strategy: &str,
) -> SyncOutcome {
    let mut outcome = sync_outcome(status, message, ahead, behind, remote, branch, conflicting_paths);
    outcome.strategy = strategy.into();
    outcome
}

fn upstream_ref(repo: &str) -> Option<String> {
    let output = run_git(
        repo,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
        Duration::from_secs(8),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = lossy(&output.stdout);
    if text.is_empty() { None } else { Some(text) }
}

fn config_get(repo: &str, key: &str) -> Option<String> {
    let output = run_git(repo, &["config", "--get", key], Duration::from_secs(8)).ok()?;
    if !output.status.success() {
        return None;
    }
    let text = lossy(&output.stdout);
    if text.is_empty() { None } else { Some(text) }
}

fn remotes(repo: &str) -> Result<Vec<String>, String> {
    let output = run_git(repo, &["remote"], Duration::from_secs(8))?;
    let text = ensure_ok(&output, "读取远程")?;
    Ok(text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn choose_remote(repo: &str, branch: &str) -> Result<String, String> {
    let key = format!("branch.{branch}.remote");
    if let Some(remote) = config_get(repo, &key) {
        return Ok(remote);
    }
    let remotes = remotes(repo)?;
    if remotes.iter().any(|remote| remote == "origin") {
        return Ok("origin".into());
    }
    remotes.into_iter().next().ok_or_else(|| "没有配置远程仓库".to_string())
}

fn require_branch(repo: &str) -> Result<(String, String), String> {
    let (branch, head) = current_branch(repo)?;
    if branch == "HEAD" || head.is_empty() {
        return Err("当前是分离头指针或还没有提交，不能更新或推送。".into());
    }
    Ok((branch, head))
}

fn integrate_strategy(value: Option<&str>) -> Result<&'static str, String> {
    match value.unwrap_or("false").trim() {
        "" | "false" => Ok("merge"),
        "true" => Ok("rebase"),
        "merges" => Ok("rebase-merges"),
        "interactive" => Err("当前 pull.rebase=interactive，无法在无终端里变基。请改成 true 或 false。".into()),
        other => Err(format!("不支持的 pull.rebase 配置：{other}")),
    }
}

fn normalize_git_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn overlapping_paths(dirty: &[String], incoming: &[String]) -> Vec<String> {
    let incoming: std::collections::HashSet<String> = incoming.iter().map(|path| normalize_git_path(path)).collect();
    let mut found: Vec<String> = dirty
        .iter()
        .filter(|path| incoming.contains(&normalize_git_path(path)))
        .map(|path| normalize_git_path(path))
        .collect();
    found.sort();
    found.dedup();
    found
}

/// 合并可能被本地改动挡住的文件（git 报 “Your local changes ... would be overwritten”）。
fn merge_blocked_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    let mut collecting = false;
    for raw in text.lines() {
        let line = raw.trim();
        if line.to_ascii_lowercase().contains("would be overwritten by merge") {
            collecting = true;
            continue;
        }
        if !collecting {
            continue;
        }
        if line.is_empty() || line.to_ascii_lowercase().starts_with("please ") {
            collecting = false;
            continue;
        }
        paths.push(normalize_git_path(line));
    }
    paths.sort();
    paths.dedup();
    paths
}

/// 文本冲突的文件列表。仓库处于合并中时 `diff --name-only --diff-filter=U` 才能给出准确答案。
fn unmerged_paths(repo: &str) -> Vec<String> {
    let Ok(output) = run_git(
        repo,
        &["diff", "--name-only", "--diff-filter=U"],
        Duration::from_secs(20),
    ) else {
        return Vec::new();
    };
    let mut paths: Vec<String> = lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(normalize_git_path)
        .collect();
    paths.sort();
    paths.dedup();
    paths
}

fn join_limited(paths: &[String]) -> String {
    const MAX: usize = 6;
    if paths.len() <= MAX {
        paths.join("、")
    } else {
        format!("{} 等 {} 个文件", paths[..MAX].join("、"), paths.len())
    }
}

struct DirtyPaths {
    tracked: Vec<String>,
    untracked: Vec<String>,
}

fn dirty_paths(repo: &str) -> Result<DirtyPaths, String> {
    let output = run_git(
        repo,
        &["status", "--porcelain=v1", "-z", "--untracked-files=normal"],
        Duration::from_secs(20),
    )?;
    if !output.status.success() {
        return Err(format!("读取状态失败：{}", lossy(&output.stderr)));
    }
    let parts: Vec<String> = output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|part| !part.is_empty())
        .map(|part| String::from_utf8_lossy(part).into_owned())
        .collect();
    let mut tracked = Vec::new();
    let mut untracked = Vec::new();
    let mut index = 0;
    while index < parts.len() {
        let entry = &parts[index];
        if entry.len() < 3 {
            index += 1;
            continue;
        }
        let x = entry.chars().next().unwrap_or(' ');
        let y = entry.chars().nth(1).unwrap_or(' ');
        let path = entry[3..].to_string();
        if x == 'R' || x == 'C' || y == 'R' || y == 'C' {
            index += 1;
        }
        index += 1;
        if x == '?' || y == '?' {
            untracked.push(path);
        } else {
            tracked.push(path);
        }
    }
    Ok(DirtyPaths { tracked, untracked })
}

/// 只列“远程相对 merge-base 新带来”的文件。
/// 三点 `HEAD...@{upstream}` 会把本地已提交未推送的改动画成远程变更，是误报的主要来源。
fn incoming_paths(repo: &str) -> Result<Vec<String>, String> {
    let output = run_git(
        repo,
        &["diff", "--name-only", "@{upstream}", "^HEAD"],
        Duration::from_secs(20),
    )?;
    let text = ensure_ok(&output, "读取远程变更")?;
    Ok(text.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect())
}

fn overwrite_confirm_message(paths: &[String]) -> String {
    format!(
        "远程更新会覆盖你未提交的修改：{}。\n\n可以先把这些改动贮藏起来、更新完再自动恢复（推荐），或先取消自行处理。",
        join_limited(paths)
    )
}

fn stash_entry_count(top: &str) -> Result<usize, String> {
    let output = run_git(top, &["stash", "list"], Duration::from_secs(15))?;
    let text = ensure_ok(&output, "读取贮藏")?;
    Ok(text.lines().filter(|line| !line.trim().is_empty()).count())
}

/// 返回是否真的新建了贮藏。干净工作区时 `stash push` 仍以 0 退出，
/// 不能据此去 apply，否则会弹出用户原先的贮藏。
fn stash_update_changes(top: &str) -> Result<bool, String> {
    let before = stash_entry_count(top)?;
    let stash = run_git(
        top,
        &["stash", "push", "--include-untracked", "-m", "SnailGit update"],
        Duration::from_secs(60),
    )?;
    if !stash.status.success() {
        return Err(format!("贮藏本地改动失败：{}", lossy(&stash.stderr)));
    }
    Ok(stash_entry_count(top)? > before)
}

struct StashRestore {
    applied: bool,
    reason: String,
    conflicts: Vec<String>,
}

fn restore_update_stash(top: &str) -> StashRestore {
    let Ok(apply) = run_git(top, &["stash", "apply"], Duration::from_secs(60)) else {
        return StashRestore {
            applied: false,
            reason: "无法恢复贮藏".into(),
            conflicts: unmerged_paths(top),
        };
    };
    if apply.status.success() {
        let _ = run_git(top, &["stash", "drop"], Duration::from_secs(30));
        let mut conflicts = unmerged_paths(top);
        conflicts.sort();
        conflicts.dedup();
        return StashRestore {
            applied: true,
            reason: String::new(),
            conflicts,
        };
    }
    StashRestore {
        applied: false,
        reason: first_line(&lossy(&apply.stderr)),
        conflicts: unmerged_paths(top),
    }
}

fn outcome_after_stash_restore(
    top: &str,
    ahead: u32,
    behind: u32,
    remote: &str,
    branch: &str,
    strategy: &str,
    prior_conflicts: Vec<String>,
) -> SyncOutcome {
    let restore = restore_update_stash(top);
    if restore.applied {
        let mut all = prior_conflicts;
        all.extend(restore.conflicts);
        all.sort();
        all.dedup();
        let message = if all.is_empty() {
            "已更新，本地改动已自动恢复。".to_string()
        } else {
            format!("已更新。本地改动已恢复到工作区，{}请在三方合并里解决。", describe_conflict(&all))
        };
        return sync_outcome_with_strategy("ok", message, ahead, behind, remote, branch, all, strategy);
    }
    let reason = if restore.reason.is_empty() {
        String::new()
    } else {
        format!("{}。", restore.reason)
    };
    sync_outcome_with_strategy(
        "ok",
        format!("已更新，但恢复本地改动时发生冲突，改动仍保存在贮藏里（stash@{{0}}）。{reason}"),
        ahead,
        behind,
        remote,
        branch,
        prior_conflicts,
        strategy,
    )
}

fn git_path_exists(top: &str, name: &str) -> bool {
    let Ok(output) = run_git(top, &["rev-parse", "--git-path", name], Duration::from_secs(8)) else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let path = lossy(&output.stdout);
    if path.is_empty() {
        return false;
    }
    let path = Path::new(&path);
    let full = if path.is_absolute() { path.to_path_buf() } else { Path::new(top).join(path) };
    full.exists()
}

fn rebase_in_progress(top: &str) -> bool {
    git_path_exists(top, "rebase-merge") || git_path_exists(top, "rebase-apply")
}

fn rebase_blocked_by_local_changes(detail: &str) -> bool {
    let lower = detail.to_ascii_lowercase();
    lower.contains("unstaged changes")
        || lower.contains("uncommitted changes")
        || lower.contains("local changes")
        || lower.contains("would be overwritten")
        || detail.contains("未暂存")
        || detail.contains("未提交")
        || detail.contains("本地修改")
        || detail.contains("将被覆盖")
        || detail.contains("会被覆盖")
}

/// 响应前端确认框：probe=首次尝试，abort=用户取消，stash=贮藏本地改动后重试，continue=带着本地改动继续。
fn update_response(value: &str) -> Result<&'static str, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "" | "probe" => Ok("probe"),
        "abort" | "cancel" => Ok("abort"),
        "stash" => Ok("stash"),
        "continue" | "merge" | "true" => Ok("continue"),
        other => Err(format!("未知的更新响应：{other}")),
    }
}

/// 合并被本地改动或真实冲突挡住时，清理探测留下的中间状态，让仓库回到原样。
fn abort_merge_if_any(top: &str) {
    if merge_in_progress(top) {
        let _ = run_git(top, &["merge", "--abort"], Duration::from_secs(30));
    }
}

/// 只有 MERGE_HEAD 存在时才有合并待落地。
/// `merge --no-commit` 在“已是最新”或快进时同样返回 0，却不会留下任何待提交内容；
/// 只判断退出码就会白白跑一次 `commit` 并报 “no changes added to commit”。
fn merge_in_progress(top: &str) -> bool {
    let output = run_git(top, &["rev-parse", "--git-path", "MERGE_HEAD"], Duration::from_secs(8));
    let Ok(output) = output else { return false };
    if !output.status.success() {
        return false;
    }
    let path = lossy(&output.stdout);
    if path.is_empty() {
        return false;
    }
    let path = Path::new(&path);
    let full = if path.is_absolute() { path.to_path_buf() } else { Path::new(top).join(path) };
    full.exists()
}

/// 把探测得到的合并结果落地成合并提交；没有待落地的合并就不提交（快进/已是最新）。
/// 返回 "merge" 表示创建了合并提交，"none" 表示无需提交。
fn commit_pending_merge(top: &str) -> Result<&'static str, String> {
    if !merge_in_progress(top) {
        return Ok("none");
    }
    // 冲突待解决时不能替用户提交，把状态留给三方合并器。
    if !unmerged_paths(top).is_empty() {
        return Ok("none");
    }
    let commit = run_git(top, &["commit", "--no-edit", "--no-verify"], Duration::from_secs(60))?;
    ensure_ok(&commit, "创建合并提交")?;
    Ok("merge")
}

fn describe_conflict(paths: &[String]) -> String {
    if paths.is_empty() {
        "远程更新与本地改动存在真实冲突。".to_string()
    } else {
        format!("远程更新与本地改动存在真实冲突（{}）。", join_limited(paths))
    }
}

/// 一次合并尝试的结果。三态必须区分清楚：
/// `Ok` 不能当成功用 —— `merge --no-commit` 被本地改动挡住时，stdout 为空、错误全在 stderr，
/// 不看退出码就会把这行报错当成正常输出，弹一个绿色的“已更新”。
enum MergeAttempt {
    /// 合并成功执行；有冲突时 conflicts 非空（待解决状态保留在工作区）。
    Merged { text: String, conflicts: Vec<String> },
    /// 被本地未提交改动挡住，合并根本没有执行，仓库原样未动。
    Blocked { paths: Vec<String>, detail: String },
    /// 其他失败，需要把原文报给用户。
    Failed { detail: String },
}

fn try_merge(top: &str, extra_args: &[&str], timeout: Duration) -> Result<MergeAttempt, String> {
    // 不带 --no-ff：本地没有独有提交时直接快进。--no-commit 不影响快进，只拦住分叉后的合并提交。
    let mut args: Vec<&str> = vec!["merge", "--no-commit", "--no-edit"];
    args.extend_from_slice(extra_args);
    args.push("@{upstream}");
    let output = run_git(top, &args, timeout)?;
    let stdout = lossy(&output.stdout);
    let stderr = lossy(&output.stderr);
    let detail = if stderr.is_empty() { stdout.clone() } else { stderr.clone() };

    let conflicts = unmerged_paths(top);
    // 只要留下待解决的合并（或干脆成功），就不是“根本没执行”。
    if output.status.success() || !conflicts.is_empty() {
        return Ok(MergeAttempt::Merged {
            text: if stdout.is_empty() { detail } else { stdout },
            conflicts,
        });
    }
    let blocked = merge_blocked_paths(&detail);
    abort_merge_if_any(top);
    if !blocked.is_empty() {
        return Ok(MergeAttempt::Blocked { paths: blocked, detail });
    }
    Ok(MergeAttempt::Failed { detail })
}

pub fn update_repo(
    repo: &str,
    confirm_risk: bool,
    response: &str,
    on_progress: &mut dyn FnMut(&str),
) -> Result<SyncOutcome, String> {
    let _pause = WatchPauseGuard::new();
    let action = update_response(if confirm_risk { "continue" } else { response })?;
    let top = validate_repo(repo)?;
    let (branch, _) = require_branch(&top)?;
    let remote = choose_remote(&top, &branch)?;

    if action == "abort" {
        abort_merge_if_any(&top);
        return Ok(sync_outcome(
            "cancelled",
            "已取消更新，工作区未改动。",
            0,
            0,
            &remote,
            &branch,
            Vec::new(),
        ));
    }

    on_progress("正在连接远程，若弹出登录窗口请完成登录");
    let fetched = run_git_streaming(
        &top,
        &["fetch", "--progress", "--prune", &remote],
        NETWORK_TIMEOUT,
        Some(NETWORK_STALL),
        on_progress,
    )?;
    finish_network(&fetched, "拉取")?;
    let Some(_upstream) = upstream_ref(&top) else {
        return Ok(sync_outcome(
            "ok",
            "已刷新远程，但当前分支没有上游，未合并。",
            0,
            0,
            &remote,
            &branch,
            Vec::new(),
        ));
    };
    let (ahead, behind) = ahead_behind(&top);
    if behind == 0 {
        let message = if ahead > 0 {
            format!("已是最新，本地还有 {ahead} 个提交未推送")
        } else {
            "已是最新".into()
        };
        return Ok(sync_outcome("up_to_date", message, ahead, behind, &remote, &branch, Vec::new()));
    }

    let strategy = integrate_strategy(config_get(&top, "pull.rebase").as_deref())?;
    let dirty = dirty_paths(&top)?;
    // 未跟踪文件只在和远程同名时才会挡住合并（git 不会覆盖未跟踪文件），此时也走贮藏/取消。
    let mut comparable = dirty.tracked.clone();
    comparable.extend(dirty.untracked.iter().cloned());
    let incoming = incoming_paths(&top)?;
    let overlap = overlapping_paths(&comparable, &incoming);

    // 变基只在远程会改到未提交文件时询问。不重叠就直接变基，避免无谓贮藏。
    if strategy != "merge" && action == "probe" && !overlap.is_empty() {
        return Ok(sync_outcome_with_strategy(
            "needs_confirm",
            overwrite_confirm_message(&overlap),
            ahead,
            behind,
            &remote,
            &branch,
            overlap,
            strategy,
        ));
    }

    if strategy == "merge" && (action == "probe" || action == "continue") {
        // 不再猜路径，直接跑一次可回滚的合并：探测和真做是同一次调用，失败时工作区原样不动。
        // “继续”也走这里：本地改动可能仍在，不能再假设一定能合。
        on_progress("正在检查本地改动与远程更新的冲突…");
        let attempt = try_merge(&top, &[], Duration::from_secs(60))?;
        match attempt {
            MergeAttempt::Merged { text, conflicts } => {
                // 快进或已是最新时没有合并待落地，这里会直接返回 none，不再盲目 commit。
                on_progress("正在整理合并结果…");
                let landed = commit_pending_merge(&top)?;
                let (ahead, behind) = ahead_behind(&top);
                // 快进不会留下 MERGE_HEAD，landed 为 none。不能靠英文 Fast-forward 判断，中文 Git 会把成功快进误报成已是最新。
                let message = if !conflicts.is_empty() {
                    format!("{}\n\n请在三方合并里解决后提交。", describe_conflict(&conflicts))
                } else if landed == "merge" {
                    "已合并远程更新".into()
                } else if behind == 0 {
                    "已更新".into()
                } else {
                    command_summary_text(&text, "已更新")
                };
                return Ok(sync_outcome_with_strategy(
                    "ok",
                    message,
                    ahead,
                    behind,
                    &remote,
                    &branch,
                    conflicts,
                    strategy,
                ));
            }
            MergeAttempt::Blocked { paths, .. } => {
                let files = join_limited(&paths);
                // “继续”仍保留给旧调用：再弹一次同样的选择没意义，直接说清楚为什么仍然走不通。
                let message = if action == "continue" {
                    format!(
                        "合并仍未执行：这些未提交改动会被远程更新覆盖（{files}）。请先提交、贮藏或撤销后再试。"
                    )
                } else {
                    overwrite_confirm_message(&paths)
                };
                let status = if action == "continue" { "blocked" } else { "needs_confirm" };
                return Ok(sync_outcome_with_strategy(
                    status,
                    message,
                    ahead,
                    behind,
                    &remote,
                    &branch,
                    paths,
                    strategy,
                ));
            }
            MergeAttempt::Failed { detail } => {
                return Err(format!("合并远程更新失败：{detail}"));
            }
        }
    }

    // 走到这里的合并只剩“贮藏后更新”；变基则可能是直接更新，或用户已选择贮藏。
    let mut created_stash = if action == "stash" {
        let created = stash_update_changes(&top)?;
        if created {
            on_progress("已贮藏本地改动，正在集成远程更新…");
        }
        created
    } else {
        false
    };

    if strategy == "merge" {
        on_progress("正在合并远程更新…");
        let attempt = try_merge(&top, &[], NETWORK_TIMEOUT)?;
        let conflicts = match attempt {
            MergeAttempt::Merged { conflicts, .. } => conflicts,
            MergeAttempt::Blocked { paths, detail } => {
                let files = join_limited(&paths);
                let kept = stash_kept_note(&top, created_stash);
                return Err(format!("贮藏后合并仍被未提交改动挡住（{files}）。{detail}{kept}"));
            }
            MergeAttempt::Failed { detail } => {
                let kept = stash_kept_note(&top, created_stash);
                return Err(format!("合并远程更新失败：{detail}{kept}"));
            }
        };
        if conflicts.is_empty() {
            commit_pending_merge(&top)?;
        }
        let (ahead, behind) = ahead_behind(&top);
        if created_stash {
            return Ok(outcome_after_stash_restore(
                &top, ahead, behind, &remote, &branch, strategy, conflicts,
            ));
        }
        let message = if conflicts.is_empty() {
            "已更新".to_string()
        } else {
            format!("{}\n\n请在三方合并里解决后提交。", describe_conflict(&conflicts))
        };
        return Ok(sync_outcome_with_strategy(
            "ok", message, ahead, behind, &remote, &branch, conflicts, strategy,
        ));
    }

    on_progress("正在变基到远程更新…");
    let mut output = run_update_rebase(&top, strategy, on_progress)?;
    let mut stdout = lossy(&output.stdout);
    let mut stderr = lossy(&output.stderr);
    let mut detail = if stderr.is_empty() { stdout.clone() } else { stderr.clone() };
    let mut conflicts = unmerged_paths(&top);
    let mut rebasing = rebase_in_progress(&top);

    // 有的 Git 只要工作区不干净就拒绝变基，即使远程没碰这些文件。
    // 不重叠时静默贮藏再试，不再追问；重叠的情况已在前面问过。
    if !output.status.success()
        && conflicts.is_empty()
        && !rebasing
        && !created_stash
        && overlap.is_empty()
        && rebase_blocked_by_local_changes(&detail)
    {
        created_stash = stash_update_changes(&top)?;
        if created_stash {
            on_progress("工作区有未提交修改，已先贮藏再变基…");
            output = run_update_rebase(&top, strategy, on_progress)?;
            stdout = lossy(&output.stdout);
            stderr = lossy(&output.stderr);
            detail = if stderr.is_empty() { stdout.clone() } else { stderr.clone() };
            conflicts = unmerged_paths(&top);
            rebasing = rebase_in_progress(&top);
        }
    }

    if !output.status.success() && conflicts.is_empty() && !rebasing {
        if action == "probe" && !overlap.is_empty() && rebase_blocked_by_local_changes(&detail) {
            return Ok(sync_outcome_with_strategy(
                "needs_confirm",
                overwrite_confirm_message(&overlap),
                ahead,
                behind,
                &remote,
                &branch,
                overlap,
                strategy,
            ));
        }
        let kept = stash_kept_note(&top, created_stash);
        let base = if detail.is_empty() { "变基失败".to_string() } else { format!("变基失败：{detail}") };
        return Err(format!("{base}{kept}"));
    }

    // 内容冲突会让变基停下。此时不要把贮藏叠回去，避免和变基状态缠在一起。
    if !conflicts.is_empty() || rebasing {
        let (ahead, behind) = ahead_behind(&top);
        let message = if created_stash {
            format!(
                "{}\n\n变基已停下。本地改动仍在贮藏里（stash@{{0}}），解决并继续变基后再恢复。",
                describe_conflict(&conflicts)
            )
        } else {
            format!("{}\n\n请在三方合并里解决后继续变基。", describe_conflict(&conflicts))
        };
        return Ok(sync_outcome_with_strategy(
            "blocked",
            message,
            ahead,
            behind,
            &remote,
            &branch,
            conflicts,
            strategy,
        ));
    }

    let (ahead, behind) = ahead_behind(&top);
    if created_stash {
        return Ok(outcome_after_stash_restore(
            &top, ahead, behind, &remote, &branch, strategy, conflicts,
        ));
    }
    let text = if stdout.is_empty() { detail } else { stdout };
    Ok(sync_outcome_with_strategy(
        "ok",
        command_summary_text(&text, "已更新"),
        ahead,
        behind,
        &remote,
        &branch,
        conflicts,
        strategy,
    ))
}

fn run_update_rebase(
    top: &str,
    strategy: &str,
    on_progress: &mut dyn FnMut(&str),
) -> Result<Output, String> {
    match strategy {
        "rebase-merges" => run_git_streaming(
            top,
            &["rebase", "--rebase-merges", "--", "@{upstream}"],
            NETWORK_TIMEOUT,
            None,
            on_progress,
        ),
        _ => run_git_streaming(top, &["rebase", "--", "@{upstream}"], NETWORK_TIMEOUT, None, on_progress),
    }
}

/// 贮藏后的集成失败时，尽量把改动放回工作区；放不回去就明确告诉用户它还在贮藏里。
fn stash_kept_note(top: &str, created_stash: bool) -> String {
    if !created_stash {
        return String::new();
    }
    let restore = restore_update_stash(top);
    if restore.applied && restore.conflicts.is_empty() {
        "\n本地改动已从贮藏恢复。".into()
    } else if restore.applied {
        "\n本地改动已放回工作区，但和当前内容有冲突。".into()
    } else {
        "\n本地改动仍保存在贮藏里（stash@{0}）。".into()
    }
}

fn command_summary_text(text: &str, fallback: &str) -> String {
    let line = first_line(text);
    if line.is_empty() { fallback.into() } else { line }
}

pub fn push_repo(repo: &str, allow_set_upstream: bool, on_progress: &mut dyn FnMut(&str)) -> Result<SyncOutcome, String> {
    let _pause = WatchPauseGuard::new();
    let top = validate_repo(repo)?;
    let (branch, _) = require_branch(&top)?;
    let remote = choose_remote(&top, &branch)?;
    if upstream_ref(&top).is_none() {
        if !allow_set_upstream {
            return Ok(sync_outcome(
                "needs_confirm",
                format!("当前分支 {branch} 还没有上游。推送到 {remote}/{branch} 会写入上游配置。继续？"),
                0,
                0,
                &remote,
                &branch,
                Vec::new(),
            ));
        }
        on_progress("正在连接远程，若弹出登录窗口请完成登录");
        let output = run_git_streaming(
            &top,
            &["push", "--progress", "-u", &remote, &branch],
            NETWORK_TIMEOUT,
            Some(NETWORK_STALL),
            on_progress,
        )?;
        let text = finish_network(&output, "推送")?;
        let (ahead, behind) = ahead_behind(&top);
        return Ok(sync_outcome(
            "ok",
            command_summary_text(&text, "已推送并设置上游"),
            ahead,
            behind,
            &remote,
            &branch,
            Vec::new(),
        ));
    }
    let (ahead, behind) = ahead_behind(&top);
    if ahead == 0 {
        let message = if behind > 0 {
            format!("没有需要推送的提交。远程还有 {behind} 个提交，可先 Update。")
        } else {
            "已与远程同步，没有需要推送的提交。".into()
        };
        return Ok(sync_outcome("up_to_date", message, ahead, behind, &remote, &branch, Vec::new()));
    }
    on_progress("正在连接远程，若弹出登录窗口请完成登录");
    let output = run_git_streaming(
        &top,
        &["push", "--progress"],
        NETWORK_TIMEOUT,
        Some(NETWORK_STALL),
        on_progress,
    )?;
    let text = finish_network(&output, "推送")?;
    let (ahead, behind) = ahead_behind(&top);
    Ok(sync_outcome(
        "ok",
        command_summary_text(&text, "已推送"),
        ahead,
        behind,
        &remote,
        &branch,
        Vec::new(),
    ))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushPreview {
    pub local_branch: String,
    pub remote: String,
    pub target_branch: String,
    pub has_upstream: bool,
    pub upstream_remote: String,
    pub upstream_branch: String,
    pub target_exists: bool,
    pub will_set_upstream: bool,
    pub remotes: Vec<String>,
    pub remote_branches: Vec<String>,
    pub ahead: u32,
    pub behind: u32,
    pub truncated: bool,
    pub commits: Vec<GitCommitDto>,
}

fn split_upstream(upstream: &str) -> (String, String) {
    match upstream.split_once('/') {
        Some((remote, branch)) if !remote.is_empty() && !branch.is_empty() => {
            (remote.to_string(), branch.to_string())
        }
        _ => (String::new(), String::new()),
    }
}

fn ref_exists(repo: &str, rev: &str) -> bool {
    run_git(repo, &["rev-parse", "--verify", "--quiet", rev], Duration::from_secs(8))
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// 推送目标会拼进 `local:remote` refspec，冒号和通配符不能交给 Git 解释。
fn validate_push_branch(name: &str) -> Result<(), String> {
    validate_branch_name(name)?;
    if name.contains(':')
        || name.contains('^')
        || name.contains('~')
        || name.contains('?')
        || name.contains('*')
        || name.contains('[')
        || name.contains("@{")
        || name.starts_with('/')
    {
        return Err(format!("无效的分支名：{name}"));
    }
    Ok(())
}

fn list_remote_branch_names(repo: &str, remote: &str) -> Vec<String> {
    let prefix = format!("refs/remotes/{remote}/");
    let Ok(output) = run_git(
        repo,
        &["for-each-ref", "--format=%(refname:short)", &prefix],
        Duration::from_secs(8),
    ) else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    let short_prefix = format!("{remote}/");
    let mut names: Vec<String> = lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.ends_with("/HEAD") {
                return None;
            }
            let name = line.strip_prefix(&short_prefix).unwrap_or(line);
            if name.is_empty() || name == "HEAD" {
                None
            } else {
                Some(name.to_string())
            }
        })
        .collect();
    names.sort();
    names.dedup();
    names
}

fn left_right_count(repo: &str, range: &str) -> (u32, u32) {
    let Ok(output) = run_git(
        repo,
        &["rev-list", "--left-right", "--count", range],
        Duration::from_secs(15),
    ) else {
        return (0, 0);
    };
    if !output.status.success() {
        return (0, 0);
    }
    let text = lossy(&output.stdout);
    let mut parts = text.split_whitespace();
    let left = parts.next().unwrap_or("0").parse().unwrap_or(0);
    let right = parts.next().unwrap_or("0").parse().unwrap_or(0);
    (left, right)
}

fn rev_list_count(repo: &str, args: &[&str]) -> u32 {
    let mut full = vec!["rev-list", "--count"];
    full.extend_from_slice(args);
    let Ok(output) = run_git(repo, &full, Duration::from_secs(15)) else {
        return 0;
    };
    if !output.status.success() {
        return 0;
    }
    lossy(&output.stdout).trim().parse().unwrap_or(0)
}

fn parse_push_commits(text: &str) -> Vec<GitCommitDto> {
    let mut commits = Vec::new();
    for block in text.split("COMMIT\x1f") {
        if block.trim().is_empty() {
            continue;
        }
        let (meta, rest) = block.split_once('\x1e').unwrap_or((block, ""));
        let fields: Vec<&str> = meta.split('\x1f').collect();
        if fields.len() < 9 {
            continue;
        }
        let parents = fields[2]
            .split_whitespace()
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect();
        let refs = fields[7]
            .split(", ")
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect();
        let body = if fields.len() > 9 {
            let text = fields[9..].join("\x1f").trim().to_string();
            if text.is_empty() { None } else { Some(text) }
        } else {
            None
        };
        let mut files = Vec::new();
        for line in rest.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let mut cols = line.split('\t');
            let code = cols.next().unwrap_or("");
            let path = cols.next().unwrap_or("").to_string();
            if path.is_empty() {
                continue;
            }
            let new_path = cols.next().unwrap_or("").to_string();
            let display = if new_path.is_empty() { path } else { new_path };
            let status = match code.chars().next().unwrap_or('M') {
                'A' => "added",
                'D' => "deleted",
                'U' => "conflict",
                _ => "modified",
            };
            files.push(CommitFileDto {
                filename: filename_of(&display),
                path: display.replace('\\', "/"),
                status: status.into(),
                additions: 0,
                deletions: 0,
            });
        }
        commits.push(GitCommitDto {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            subject: fields[8].to_string(),
            body,
            author: fields[3].to_string(),
            author_email: fields[4].to_string(),
            date: fields[5].to_string(),
            relative_date: fields[6].to_string(),
            parents,
            refs,
            branch_track: 0,
            files,
        });
    }
    commits
}

fn fill_range_numstat(repo: &str, rev_args: &[&str], commits: &mut [GitCommitDto]) {
    if commits.is_empty() {
        return;
    }
    let mut args = vec![
        "log".to_string(),
        "-n".to_string(),
        "201".to_string(),
        "--numstat".to_string(),
        "--pretty=format:%H".to_string(),
    ];
    args.extend(rev_args.iter().map(|item| (*item).to_string()));
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = match run_git(repo, &refs, Duration::from_secs(20)) {
        Ok(output) if output.status.success() => lossy(&output.stdout),
        _ => return,
    };
    let mut current = String::new();
    let mut stats: std::collections::HashMap<String, Vec<(i32, i32, String)>> = std::collections::HashMap::new();
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if !line.contains('\t') && line.chars().all(|ch| ch.is_ascii_hexdigit()) && line.len() >= 7 {
            current = line.to_string();
            continue;
        }
        if current.is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        let additions = cols.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let deletions = cols.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let path = cols.next().unwrap_or("").replace('\\', "/");
        if path.is_empty() {
            continue;
        }
        stats.entry(current.clone()).or_default().push((additions, deletions, path));
    }
    for commit in commits.iter_mut() {
        let Some(rows) = stats.get(&commit.hash) else {
            continue;
        };
        for file in &mut commit.files {
            let wanted = file.path.replace('\\', "/");
            if let Some((additions, deletions, _)) = rows.iter().find(|(_, _, path)| numstat_matches(&wanted, path)) {
                file.additions = *additions;
                file.deletions = *deletions;
            }
        }
    }
}

fn log_range_commits(repo: &str, rev_args: &[&str]) -> Result<(Vec<GitCommitDto>, bool), String> {
    let mut args = vec![
        "log".to_string(),
        "-n".to_string(),
        "201".to_string(),
        "--date=format:%Y-%m-%d %H:%M:%S".to_string(),
        "--name-status".to_string(),
        "--pretty=format:COMMIT%x1f%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%ar%x1f%D%x1f%s%x1f%b%x1e".to_string(),
    ];
    args.extend(rev_args.iter().map(|item| (*item).to_string()));
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_git(repo, &refs, Duration::from_secs(20))?;
    let text = ensure_ok(&output, "读取待推送提交")?;
    let mut commits = parse_push_commits(&text);
    let truncated = commits.len() > 200;
    if truncated {
        commits.truncate(200);
    }
    fill_range_numstat(repo, rev_args, &mut commits);
    Ok((commits, truncated))
}

/// 空源表示当前检出分支。有源时不要求 HEAD 是分支，便于分离头指针时推送其他本地分支。
fn resolve_push_source(repo: &str, source: Option<&str>) -> Result<String, String> {
    let Some(name) = source.map(str::trim).filter(|name| !name.is_empty()) else {
        let (local, _) = require_branch(repo)?;
        validate_push_branch(&local)?;
        return Ok(local);
    };
    validate_push_branch(name)?;
    let full = format!("refs/heads/{name}");
    if !ref_exists(repo, &full) {
        return Err(format!("本地分支 {name} 不存在"));
    }
    Ok(name.to_string())
}

fn branch_upstream(repo: &str, branch: &str) -> Option<String> {
    let spec = format!("{branch}@{{upstream}}");
    let output = run_git(
        repo,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", &spec],
        Duration::from_secs(8),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = lossy(&output.stdout);
    if text.is_empty() { None } else { Some(text) }
}

fn is_ancestor(repo: &str, ancestor: &str, descendant: &str) -> bool {
    run_git(
        repo,
        &["merge-base", "--is-ancestor", ancestor, descendant],
        Duration::from_secs(15),
    )
    .map(|output| output.status.success())
    .unwrap_or(false)
}

/// 推送前预览。默认目标跟 IDEA：已有上游则用上游，否则用 origin（或唯一远程）加本地同名分支。
/// 提交列表只读本地远程跟踪引用，不上网。`source` 为空时源是当前分支。
pub fn preview_push(
    repo: &str,
    remote: Option<&str>,
    branch: Option<&str>,
    source: Option<&str>,
) -> Result<PushPreview, String> {
    let top = validate_repo(repo)?;
    let local = resolve_push_source(&top, source)?;
    let known = remotes(&top)?;
    if known.is_empty() {
        return Err("没有配置远程仓库".into());
    }
    let upstream = branch_upstream(&top, &local);
    let (up_remote, up_branch) = upstream.as_deref().map(split_upstream).unwrap_or_default();
    let remote = if let Some(name) = remote.map(str::trim).filter(|name| !name.is_empty()) {
        validate_remote_name(name)?;
        if !known.iter().any(|item| item == name) {
            return Err(format!("远程 {name} 不存在"));
        }
        name.to_string()
    } else if !up_remote.is_empty() && known.iter().any(|item| item == &up_remote) {
        up_remote.clone()
    } else {
        choose_remote(&top, &local)?
    };
    let target = if let Some(name) = branch.map(str::trim).filter(|name| !name.is_empty()) {
        validate_push_branch(name)?;
        name.to_string()
    } else if remote == up_remote && !up_branch.is_empty() {
        up_branch.clone()
    } else {
        local.clone()
    };
    let remote_ref = format!("refs/remotes/{remote}/{target}");
    let target_exists = ref_exists(&top, &remote_ref);
    let (ahead, behind, rev_args_owned) = if target_exists {
        let range = format!("{local}...{remote_ref}");
        let (ahead, behind) = left_right_count(&top, &range);
        (ahead, behind, vec![format!("{remote_ref}..{local}")])
    } else {
        // 远程还没有这个分支时，列出源分支上尚未出现在该远程跟踪分支上的提交。
        let not_remote = format!("--remotes={remote}");
        let ahead = rev_list_count(&top, &[&local, "--not", &not_remote]);
        (ahead, 0, vec![local.clone(), "--not".into(), not_remote])
    };
    let rev_args: Vec<&str> = rev_args_owned.iter().map(String::as_str).collect();
    let (commits, truncated) = if ahead == 0 && target_exists {
        (Vec::new(), false)
    } else {
        log_range_commits(&top, &rev_args)?
    };
    let remote_branches = list_remote_branch_names(&top, &remote);
    Ok(PushPreview {
        local_branch: local,
        will_set_upstream: up_remote != remote || up_branch != target,
        has_upstream: upstream.is_some(),
        upstream_remote: up_remote,
        upstream_branch: up_branch,
        target_exists,
        remotes: known,
        remote_branches,
        ahead,
        behind,
        truncated,
        commits,
        remote,
        target_branch: target,
    })
}

pub fn push_to(
    repo: &str,
    remote: &str,
    branch: &str,
    set_upstream: bool,
    source: Option<&str>,
    on_progress: &mut dyn FnMut(&str),
) -> Result<SyncOutcome, String> {
    let _pause = WatchPauseGuard::new();
    let top = validate_repo(repo)?;
    let remote = remote.trim();
    let branch = branch.trim();
    validate_remote_name(remote)?;
    validate_push_branch(branch)?;
    let local = resolve_push_source(&top, source)?;
    let known = remotes(&top)?;
    if !known.iter().any(|name| name == remote) {
        return Err(format!("远程 {remote} 不存在"));
    }
    let refspec = format!("{local}:{branch}");
    let mut args = vec!["push".to_string(), "--progress".to_string()];
    if set_upstream {
        args.push("--set-upstream".to_string());
    }
    args.push(remote.to_string());
    args.push(refspec);
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    on_progress("正在连接远程，若弹出登录窗口请完成登录");
    let output = run_git_streaming(&top, &refs, NETWORK_TIMEOUT, Some(NETWORK_STALL), on_progress)?;
    let text = finish_network(&output, "推送")?;
    // 计数始终描述当前 HEAD，避免推送其他分支时改写状态栏。
    let (ahead, behind) = ahead_behind(&top);
    let fallback = if set_upstream { "已推送并设置上游" } else { "已推送" };
    Ok(sync_outcome(
        "ok",
        command_summary_text(&text, fallback),
        ahead,
        behind,
        remote,
        branch,
        Vec::new(),
    ))
}

/// 只快进未检出的本地分支。当前分支必须走 `update_repo`，以免绕过工作区确认。
pub fn update_local_branch(
    repo: &str,
    name: &str,
    on_progress: &mut dyn FnMut(&str),
) -> Result<SyncOutcome, String> {
    let _pause = WatchPauseGuard::new();
    let top = validate_repo(repo)?;
    let name = name.trim();
    validate_branch_name(name)?;
    let full = format!("refs/heads/{name}");
    if !ref_exists(&top, &full) {
        return Err(format!("本地分支 {name} 不存在"));
    }
    let (current, _) = current_branch(&top)?;
    if name == current {
        return Err("当前分支请使用项目更新".into());
    }
    let remote = choose_remote(&top, name)?;
    on_progress("正在连接远程，若弹出登录窗口请完成登录");
    let fetched = run_git_streaming(
        &top,
        &["fetch", "--progress", "--prune", &remote],
        NETWORK_TIMEOUT,
        Some(NETWORK_STALL),
        on_progress,
    )?;
    finish_network(&fetched, "拉取")?;
    let (ahead, behind) = ahead_behind(&top);
    let Some(upstream) = branch_upstream(&top, name) else {
        return Ok(sync_outcome(
            "ok",
            format!("已刷新远程，但分支 {name} 没有上游，未合并。"),
            ahead,
            behind,
            &remote,
            name,
            Vec::new(),
        ));
    };
    let (up_remote, up_branch) = split_upstream(&upstream);
    if up_remote.is_empty() || up_branch.is_empty() || !ref_exists(&top, &format!("refs/remotes/{upstream}")) {
        return Ok(sync_outcome(
            "blocked",
            format!("分支 {name} 的上游 {upstream} 不存在，未合并。"),
            ahead,
            behind,
            &remote,
            name,
            Vec::new(),
        ));
    }
    if up_remote != remote {
        let extra = run_git_streaming(
            &top,
            &["fetch", "--progress", "--prune", &up_remote],
            NETWORK_TIMEOUT,
            Some(NETWORK_STALL),
            on_progress,
        )?;
        finish_network(&extra, "拉取")?;
    }
    let local_sha = ensure_ok(
        &run_git(&top, &["rev-parse", "--verify", &full], Duration::from_secs(8))?,
        "读取分支",
    )?;
    let upstream_sha = ensure_ok(
        &run_git(
            &top,
            &["rev-parse", "--verify", &format!("refs/remotes/{upstream}")],
            Duration::from_secs(8),
        )?,
        "读取上游",
    )?;
    if local_sha == upstream_sha || is_ancestor(&top, &upstream_sha, &local_sha) {
        let message = if local_sha == upstream_sha {
            format!("分支 {name} 已是最新")
        } else {
            format!("分支 {name} 已包含上游，未移动")
        };
        return Ok(sync_outcome(
            "up_to_date",
            message,
            ahead,
            behind,
            &up_remote,
            name,
            Vec::new(),
        ));
    }
    if !is_ancestor(&top, &local_sha, &upstream_sha) {
        return Ok(sync_outcome(
            "blocked",
            format!("分支 {name} 与上游 {upstream} 已分叉，不能在未检出时快进。请先检出后再更新。"),
            ahead,
            behind,
            &up_remote,
            name,
            Vec::new(),
        ));
    }
    // 旧值校验避免竞态覆盖；不用强制 refspec，不能快进的提交不会被写进去。
    let updated = run_git(
        &top,
        &["update-ref", &full, &upstream_sha, &local_sha],
        Duration::from_secs(8),
    )?;
    ensure_ok(&updated, "快进分支")?;
    Ok(sync_outcome(
        "ok",
        format!("已快进分支 {name}"),
        ahead,
        behind,
        &up_remote,
        name,
        Vec::new(),
    ))
}

pub fn stash_save(repo: &str, message: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let msg = if message.trim().is_empty() { "SnailGit stash" } else { message.trim() };
    let output = run_git(&top, &["stash", "push", "-u", "-m", msg], Duration::from_secs(20))?;
    ensure_ok(&output, "贮藏")
}

pub fn stash_apply(repo: &str, index: u32, pop: bool) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let spec = format!("stash@{{{index}}}");
    let verb = if pop { "pop" } else { "apply" };
    let output = run_git(&top, &["stash", verb, &spec], Duration::from_secs(20))?;
    ensure_ok(&output, if pop { "弹出贮藏" } else { "应用贮藏" })
}

pub fn stash_drop(repo: &str, index: u32) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let spec = format!("stash@{{{index}}}");
    let output = run_git(&top, &["stash", "drop", &spec], Duration::from_secs(15))?;
    ensure_ok(&output, "丢弃贮藏")
}

pub fn cherry_pick(repo: &str, hash: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["cherry-pick", "--", hash], Duration::from_secs(30))?;
    ensure_ok(&output, "挑拣提交")
}

pub fn revert_commit(repo: &str, hash: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["revert", "--no-edit", "--", hash], Duration::from_secs(30))?;
    ensure_ok(&output, "还原提交")
}

pub fn reset_mixed(repo: &str, hash: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["reset", "--mixed", "--", hash], Duration::from_secs(20))?;
    ensure_ok(&output, "重置分支")
}

pub fn compare_stat(repo: &str, name: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let output = run_git(&top, &["diff", "--stat", &format!("HEAD...{name}")], Duration::from_secs(20))?;
    let text = ensure_ok(&output, "对比分支")?;
    if text.is_empty() {
        Ok("没有差异".into())
    } else {
        Ok(text)
    }
}

const SQUASH_BACKUP_FILE: &str = "snailgit-pre-squash";
const SQUASH_WORK_BRANCH: &str = "snailgit-squash-work";
const SQUASH_TIP_BRANCH: &str = "snailgit-squash-tip";
const SQUASH_HISTORY_LIMIT: usize = 8000;
const SQUASH_MAX_COMMITS: usize = 100;

/// IDEA 的 Squash Commits 本质是 `git rebase -i`：把选中范围改成一条 pick + 若干 squash。
/// 安装版没有终端，不能打开序列编辑器，所以在当前分支的一等父历史上软重置后再提交一次。
/// 范围不在顶端时，把后面的提交重放到压缩结果上。失败会回到压缩前的提交。
/// 备份只写在 Git 目录的文件里，不能放进 refs/，否则日志的 --all 会把旧提交再画出来。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashCommitDto {
    pub hash: String,
    pub short_hash: String,
    pub subject: String,
    pub author: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SquashPreview {
    pub branch: String,
    pub commits: Vec<SquashCommitDto>,
    pub message: String,
    pub replay_count: u32,
    pub pushed_on: Vec<String>,
    pub also_on: Vec<String>,
    pub has_local_changes: bool,
}

#[derive(Debug, Clone)]
struct HistoryCommit {
    hash: String,
    parents: Vec<String>,
    author: String,
    email: String,
    subject: String,
    body: String,
    committed_at: String,
}

struct SquashPlan {
    branch: String,
    head: String,
    oldest_parent: String,
    commits: Vec<HistoryCommit>,
    replay_count: usize,
    pushed_on: Vec<String>,
    also_on: Vec<String>,
    committed_at: String,
}

struct SquashRollback {
    top: String,
    branch: String,
    backup: String,
    stash: Option<String>,
    armed: bool,
    stash_pending: bool,
}

impl Drop for SquashRollback {
    fn drop(&mut self) {
        if self.armed {
            let _ = restore_squash_point(&self.top, &self.branch, &self.backup);
        }
        if self.stash_pending {
            if let Some(hash) = &self.stash {
                let _ = restore_autostash(&self.top, hash);
            }
        }
    }
}

fn parse_first_parent_log(text: &str) -> Vec<HistoryCommit> {
    let mut commits = Vec::new();
    for record in text.split('\x1e') {
        let record = record.trim();
        if record.is_empty() {
            continue;
        }
        let mut fields = record.splitn(7, '\x1f');
        let hash = fields.next().unwrap_or("").trim().to_string();
        if hash.len() < 7 || !hash.chars().all(|ch| ch.is_ascii_hexdigit()) {
            continue;
        }
        let parents = fields
            .next()
            .unwrap_or("")
            .split_whitespace()
            .filter(|item| !item.is_empty())
            .map(|item| item.to_string())
            .collect();
        commits.push(HistoryCommit {
            hash,
            parents,
            author: fields.next().unwrap_or("").trim().to_string(),
            email: fields.next().unwrap_or("").trim().to_string(),
            subject: fields.next().unwrap_or("").trim().to_string(),
            committed_at: fields.next().unwrap_or("").trim().to_string(),
            body: fields.next().unwrap_or("").trim().to_string(),
        });
    }
    commits
}

fn normalize_hash_token(hash: &str) -> Result<String, String> {
    let token = hash.trim().to_ascii_lowercase();
    if (7..=40).contains(&token.len()) && token.chars().all(|ch| ch.is_ascii_hexdigit()) {
        Ok(token)
    } else {
        Err(format!("无效的提交哈希：{}", hash.trim()))
    }
}

/// history 从新到旧。返回 (newest_index, oldest_index)。
fn resolve_squash_span(history: &[HistoryCommit], hashes: &[String]) -> Result<(usize, usize), String> {
    if hashes.len() < 2 {
        return Err("请至少选择两个提交再压缩。".into());
    }
    if hashes.len() > SQUASH_MAX_COMMITS {
        return Err(format!("一次最多压缩 {SQUASH_MAX_COMMITS} 个提交。"));
    }
    let mut indexes = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for raw in hashes {
        let token = normalize_hash_token(raw)?;
        if !seen.insert(token.clone()) {
            continue;
        }
        let hits: Vec<usize> = history
            .iter()
            .enumerate()
            .filter(|(_, commit)| {
                let full = commit.hash.to_ascii_lowercase();
                full == token || full.starts_with(&token)
            })
            .map(|(index, _)| index)
            .collect();
        match hits.as_slice() {
            [one] => indexes.push(*one),
            [] => {
                return Err(
                    "只能压缩当前分支上的提交。有选中的提交不在当前分支的一等父历史上，可能来自其他分支，或距离当前提交太远。"
                        .into(),
                );
            }
            _ => return Err(format!("提交 {token} 在当前分支历史上不唯一，请使用更长的哈希。")),
        }
    }
    if indexes.len() < 2 {
        return Err("请至少选择两个提交再压缩。".into());
    }
    indexes.sort_unstable();
    let newest = indexes[0];
    let oldest = *indexes.last().unwrap();
    if oldest - newest + 1 != indexes.len() {
        return Err("选中的提交不连续，中间还有未选中的提交。请选择一段连续的提交再压缩。".into());
    }
    Ok((newest, oldest))
}

fn suggest_squash_message(commits: &[HistoryCommit]) -> String {
    let mut parts = Vec::new();
    for commit in commits {
        let subject = commit.subject.trim();
        let body = commit.body.trim();
        if subject.is_empty() && body.is_empty() {
            continue;
        }
        if body.is_empty() {
            parts.push(subject.to_string());
        } else if subject.is_empty() {
            parts.push(body.to_string());
        } else {
            parts.push(format!("{subject}\n\n{body}"));
        }
    }
    parts.join("\n\n")
}

fn squash_author_arg(commit: &HistoryCommit) -> Option<String> {
    let name = commit.author.trim();
    let email = commit.email.trim();
    if name.is_empty()
        || email.is_empty()
        || name.contains(['<', '>', '\n', '\r'])
        || email.contains([' ', '<', '>', '\n', '\r'])
    {
        return None;
    }
    Some(format!("{name} <{email}>"))
}

fn rewrite_blocked(top: &str) -> Result<(), String> {
    if rebase_in_progress(top)
        || git_path_exists(top, "MERGE_HEAD")
        || git_path_exists(top, "CHERRY_PICK_HEAD")
        || git_path_exists(top, "REVERT_HEAD")
        || git_path_exists(top, "BISECT_LOG")
    {
        return Err("当前有未完成的变基、合并、挑拣或还原。请先完成或中止后再压缩提交。".into());
    }
    Ok(())
}

fn worktree_has_local_changes(top: &str) -> Result<bool, String> {
    let output = run_git(
        top,
        &["status", "--porcelain=v1", "--untracked-files=normal"],
        Duration::from_secs(12),
    )?;
    let text = ensure_ok(&output, "检查工作区")?;
    Ok(text.lines().any(|line| !line.trim().is_empty()))
}

const SQUASH_STASH_MESSAGE: &str = "snailgit-squash-autostash";

/// 和 IDEA 一样：先把未提交修改连同未跟踪文件挪走，压缩完再放回。
/// 否则软重置后的提交会把已暂存内容卷进去。
fn autostash_local_changes(top: &str) -> Result<Option<String>, String> {
    if !worktree_has_local_changes(top)? {
        return Ok(None);
    }
    let output = run_git(
        top,
        &[
            "stash",
            "push",
            "--include-untracked",
            "-m",
            SQUASH_STASH_MESSAGE,
        ],
        Duration::from_secs(30),
    )?;
    ensure_ok(&output, "暂存未提交修改")?;
    if worktree_has_local_changes(top)? {
        return Err("未能把未提交修改移出工作区，已停止压缩。".into());
    }
    let hash = run_git(top, &["rev-parse", "refs/stash"], Duration::from_secs(8))?;
    Ok(Some(ensure_ok(&hash, "读取贮藏")?))
}

fn drop_stash_hash(top: &str, hash: &str) {
    let Ok(output) = run_git(top, &["stash", "list", "--format=%gd %H"], Duration::from_secs(10)) else {
        return;
    };
    if !output.status.success() {
        return;
    }
    for line in lossy(&output.stdout).lines() {
        let mut parts = line.split_whitespace();
        let name = parts.next().unwrap_or("");
        let oid = parts.next().unwrap_or("");
        if oid == hash && !name.is_empty() {
            let _ = run_git(top, &["stash", "drop", name], Duration::from_secs(15));
            return;
        }
    }
}

fn restore_autostash(top: &str, hash: &str) -> Result<(), String> {
    let indexed = run_git(top, &["stash", "apply", "--index", hash], Duration::from_secs(30))?;
    if indexed.status.success() {
        drop_stash_hash(top, hash);
        return Ok(());
    }
    let still_clean = !worktree_has_local_changes(top).unwrap_or(true);
    if still_clean {
        let plain = run_git(top, &["stash", "apply", hash], Duration::from_secs(30))?;
        if plain.status.success() {
            drop_stash_hash(top, hash);
            return Ok(());
        }
        let err = lossy(&plain.stderr);
        return Err(format!("未提交修改无法自动放回，仍保留在贮藏中。{err}"));
    }
    let err = lossy(&indexed.stderr);
    Err(format!("未提交修改无法自动放回，仍保留在贮藏中。{err}"))
}

fn load_first_parent_history(top: &str) -> Result<Vec<HistoryCommit>, String> {
    let limit = SQUASH_HISTORY_LIMIT.to_string();
    let output = run_git(
        top,
        &[
            "log",
            "--first-parent",
            "-n",
            &limit,
            "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%s%x1f%cI%x1f%b%x1e",
            "HEAD",
        ],
        Duration::from_secs(30),
    )?;
    let text = ensure_ok(&output, "读取分支历史")?;
    Ok(parse_first_parent_log(&text))
}

fn parse_branch_contains(text: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.contains("->") {
            continue;
        }
        let name = line.trim_start_matches(['*', '+']).trim();
        if name.is_empty() || name == SQUASH_WORK_BRANCH || name == SQUASH_TIP_BRANCH {
            continue;
        }
        names.push(name.to_string());
    }
    names
}

fn refs_containing(top: &str, hash: &str, remote: bool) -> Vec<String> {
    let mut args = vec!["branch", "--contains", hash];
    if remote {
        args.insert(1, "-r");
    }
    let Ok(output) = run_git(top, &args, Duration::from_secs(20)) else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    parse_branch_contains(&lossy(&output.stdout))
}

fn plan_squash(top: &str, hashes: &[String]) -> Result<SquashPlan, String> {
    rewrite_blocked(top)?;
    let (branch, _) = current_branch(top)?;
    if branch == "HEAD"
        || branch.is_empty()
        || branch == SQUASH_WORK_BRANCH
        || branch == SQUASH_TIP_BRANCH
    {
        return Err("当前不是可改写的普通分支。请先切回要压缩的分支。".into());
    }
    let head_output = run_git(top, &["rev-parse", "HEAD"], Duration::from_secs(8))?;
    let head = ensure_ok(&head_output, "读取 HEAD")?;
    if head.is_empty() {
        return Err("当前分支还没有提交。".into());
    }
    let history = load_first_parent_history(top)?;
    if history.is_empty() || !history[0].hash.eq_ignore_ascii_case(&head) {
        return Err("无法读取当前分支顶端。".into());
    }
    let (newest, oldest) = resolve_squash_span(&history, hashes)?;
    for commit in &history[newest..=oldest] {
        if commit.parents.len() > 1 {
            return Err("选中范围内包含合并提交，不能压缩。".into());
        }
        if commit.parents.is_empty() {
            return Err("选中范围包含仓库的第一个提交，暂不支持压缩根提交。".into());
        }
    }
    if newest > 0 {
        for commit in &history[..newest] {
            if commit.parents.len() > 1 {
                return Err(
                    "选中范围之后还有合并提交。重放这些提交会拆掉合并结构，已拒绝。请只压缩直到当前分支顶端的连续提交。"
                        .into(),
                );
            }
        }
    }
    let oldest_parent = history[oldest].parents[0].clone();
    let committed_at = history[newest].committed_at.clone();
    let oldest_hash = history[oldest].hash.clone();
    let mut commits = history[newest..=oldest].to_vec();
    commits.reverse();
    let pushed_on = refs_containing(top, &oldest_hash, true);
    let also_on = refs_containing(top, &oldest_hash, false)
        .into_iter()
        .filter(|name| name != &branch)
        .collect();
    Ok(SquashPlan {
        branch,
        head,
        oldest_parent,
        replay_count: newest,
        pushed_on,
        also_on,
        committed_at,
        commits,
    })
}

fn preview_from_plan(plan: &SquashPlan, has_local_changes: bool) -> SquashPreview {
    SquashPreview {
        branch: plan.branch.clone(),
        commits: plan
            .commits
            .iter()
            .map(|commit| SquashCommitDto {
                hash: commit.hash.clone(),
                short_hash: commit.hash.chars().take(7).collect(),
                subject: commit.subject.clone(),
                author: commit.author.clone(),
            })
            .collect(),
        message: suggest_squash_message(&plan.commits),
        replay_count: plan.replay_count as u32,
        pushed_on: plan.pushed_on.clone(),
        also_on: plan.also_on.clone(),
        has_local_changes,
    }
}

fn write_squash_message(message: &str) -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!("snailgit-squash-{}-{stamp}.txt", std::process::id()));
    let mut text = message.trim().to_string();
    if !text.ends_with('\n') {
        text.push('\n');
    }
    fs::write(&path, text).map_err(|err| format!("无法写入提交说明：{err}"))?;
    Ok(path)
}

fn create_squashed_commit(top: &str, plan: &SquashPlan, message: &str) -> Result<(), String> {
    // 这里不能加 --。reset --soft 的参数是提交，一旦出现 -- 就会被当成路径。
    let reset = run_git(
        top,
        &["reset", "--soft", &plan.oldest_parent],
        Duration::from_secs(30),
    )?;
    ensure_ok(&reset, "软重置到压缩起点")?;
    let message_path = write_squash_message(message)?;
    let message_arg = message_path.to_string_lossy().to_string();
    let author = plan.commits.first().and_then(squash_author_arg);
    let mut args = vec![
        "commit".to_string(),
        "--allow-empty".to_string(),
        "-F".to_string(),
        message_arg,
    ];
    if let Some(author) = author {
        args.push("--author".to_string());
        args.push(author);
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut env = Vec::new();
    if !plan.committed_at.is_empty() {
        env.push(("GIT_AUTHOR_DATE", plan.committed_at.as_str()));
        env.push(("GIT_COMMITTER_DATE", plan.committed_at.as_str()));
    }
    let output = run_git_with_env(top, &arg_refs, &env, Duration::from_secs(60));
    let _ = fs::remove_file(&message_path);
    ensure_ok(&output?, "写入压缩提交")?;
    Ok(())
}

fn delete_temp_branch(top: &str, name: &str) {
    let _ = run_git(top, &["branch", "-D", name], Duration::from_secs(10));
}

fn rev_parse_ref(top: &str, spec: &str) -> Result<String, String> {
    let output = run_git(top, &["rev-parse", spec], Duration::from_secs(8))?;
    ensure_ok(&output, "读取提交")
}

fn squash_with_replay(top: &str, plan: &SquashPlan, message: &str) -> Result<(), String> {
    delete_temp_branch(top, SQUASH_WORK_BRANCH);
    delete_temp_branch(top, SQUASH_TIP_BRANCH);
    let tip = run_git(top, &["branch", "-f", SQUASH_TIP_BRANCH, "HEAD"], Duration::from_secs(15))?;
    ensure_ok(&tip, "记录压缩前的分支顶端")?;
    let newest = plan
        .commits
        .last()
        .map(|commit| commit.hash.clone())
        .ok_or_else(|| "没有可压缩的提交".to_string())?;
    let work = run_git(
        top,
        &["switch", "-C", SQUASH_WORK_BRANCH, "--", &newest],
        Duration::from_secs(30),
    )?;
    ensure_ok(&work, "切到要压缩的提交")?;
    create_squashed_commit(top, plan, message)?;
    let rebase = run_git(
        top,
        &["rebase", "--onto", SQUASH_WORK_BRANCH, &newest, SQUASH_TIP_BRANCH],
        Duration::from_secs(120),
    )?;
    if !rebase.status.success() {
        let err = lossy(&rebase.stderr);
        let out = lossy(&rebase.stdout);
        let detail = if err.is_empty() { out } else { err };
        return Err(format!("重放后续提交失败，已停止压缩。{detail}"));
    }
    let squashed = rev_parse_ref(top, SQUASH_WORK_BRANCH)?;
    let new_tip = rev_parse_ref(top, SQUASH_TIP_BRANCH)?;
    if new_tip == plan.head {
        return Err("重放后续提交没有产生新历史，已停止。".into());
    }
    let ancestor = run_git(
        top,
        &["merge-base", "--is-ancestor", &squashed, SQUASH_TIP_BRANCH],
        Duration::from_secs(15),
    )?;
    if !ancestor.status.success() {
        return Err("重放结果没有接在压缩提交上，已停止。".into());
    }
    let back = run_git(top, &["switch", "--", &plan.branch], Duration::from_secs(30))?;
    ensure_ok(&back, "切回原分支")?;
    let reset = run_git(top, &["reset", "--hard", SQUASH_TIP_BRANCH], Duration::from_secs(30))?;
    ensure_ok(&reset, "更新当前分支")?;
    delete_temp_branch(top, SQUASH_WORK_BRANCH);
    delete_temp_branch(top, SQUASH_TIP_BRANCH);
    Ok(())
}

fn restore_squash_point(top: &str, branch: &str, backup: &str) -> Result<(), String> {
    if rebase_in_progress(top) {
        let _ = run_git(top, &["rebase", "--abort"], Duration::from_secs(30));
    }
    if git_path_exists(top, "CHERRY_PICK_HEAD") {
        let _ = run_git(top, &["cherry-pick", "--abort"], Duration::from_secs(20));
    }
    let _ = run_git(top, &["switch", "--", branch], Duration::from_secs(30));
    let output = run_git(top, &["reset", "--hard", backup], Duration::from_secs(30))?;
    ensure_ok(&output, "恢复压缩前的提交")?;
    delete_temp_branch(top, SQUASH_WORK_BRANCH);
    delete_temp_branch(top, SQUASH_TIP_BRANCH);
    Ok(())
}

pub fn preview_squash(repo: &str, hashes: &[String]) -> Result<SquashPreview, String> {
    let top = validate_repo(repo)?;
    let has_local_changes = worktree_has_local_changes(&top)?;
    let plan = plan_squash(&top, hashes)?;
    Ok(preview_from_plan(&plan, has_local_changes))
}

fn squash_result_text(plan: &SquashPlan, head: &str, stash_note: Option<&str>) -> String {
    let mut text = format!("已将 {} 个提交压缩为 {head}", plan.commits.len());
    if let Some(note) = stash_note {
        text.push('。');
        text.push_str(note);
    }
    if !plan.pushed_on.is_empty() {
        text.push_str("。这些提交已在远程，之后推送需要强制推送");
    }
    text.push_str(&format!("。撤销：git reset --hard {}", plan.head));
    text
}

fn put_back_autostash(top: &str, stash: &Option<String>) -> Result<(), String> {
    match stash {
        Some(hash) => restore_autostash(top, hash),
        None => Ok(()),
    }
}

pub fn squash_commits(repo: &str, hashes: &[String], message: &str) -> Result<String, String> {
    let _pause = WatchPauseGuard::new();
    let top = validate_repo(repo)?;
    let message = message.trim();
    if message.is_empty() {
        return Err("提交说明不能为空".into());
    }
    let plan = plan_squash(&top, hashes)?;
    let stash = autostash_local_changes(&top)?;
    let mut rollback = SquashRollback {
        top: top.clone(),
        branch: plan.branch.clone(),
        backup: plan.head.clone(),
        stash: stash.clone(),
        armed: false,
        stash_pending: stash.is_some(),
    };
    if let Err(err) = write_squash_backup(&top, &plan.head) {
        return Err(err);
    }
    rollback.armed = true;
    let rewritten = if plan.replay_count == 0 {
        create_squashed_commit(&top, &plan, message)
    } else {
        squash_with_replay(&top, &plan, message)
    };
    if let Err(err) = rewritten {
        rollback.armed = false;
        rollback.stash_pending = false;
        let restored = restore_squash_point(&top, &plan.branch, &plan.head);
        let stashed_back = put_back_autostash(&top, &stash);
        return match (restored, stashed_back) {
            (Ok(()), Ok(())) => Err(format!("{err}\n仓库已恢复到压缩前。")),
            (Ok(()), Err(stash_err)) => Err(format!("{err}\n仓库已恢复到压缩前。{stash_err}")),
            (Err(restore_err), _) => Err(format!(
                "{err}\n自动恢复失败：{restore_err}\n请执行 git reset --hard {}",
                plan.head
            )),
        };
    }
    rollback.armed = false;
    rollback.stash_pending = false;
    let stash_note = match put_back_autostash(&top, &stash) {
        Ok(()) => None,
        Err(err) => Some(err),
    };
    let head = run_git(&top, &["rev-parse", "--short", "HEAD"], Duration::from_secs(8))
        .ok()
        .and_then(|output| ensure_ok(&output, "读取新提交").ok())
        .unwrap_or_default();
    Ok(squash_result_text(&plan, &head, stash_note.as_deref()))
}

fn write_squash_backup(top: &str, hash: &str) -> Result<(), String> {
    let output = run_git(top, &["rev-parse", "--absolute-git-dir"], Duration::from_secs(8))?;
    let git_dir = ensure_ok(&output, "定位 Git 目录")?;
    fs::write(Path::new(&git_dir).join(SQUASH_BACKUP_FILE), format!("{hash}\n"))
        .map_err(|err| format!("无法记录压缩前的位置：{err}"))
}

fn load_disk_repos() -> Vec<SavedRepoDisk> {
    let Ok(path) = repos_file() else {
        return Vec::new();
    };
    let raw = fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn save_disk_repos(repos: &[SavedRepoDisk]) -> Result<(), String> {
    let path = repos_file()?;
    let text = serde_json::to_string_pretty(repos).map_err(|err| err.to_string())?;
    fs::write(&path, text).map_err(|err| format!("无法保存仓库列表 {}: {err}", path.display()))
}

fn repo_brief(path: &str) -> (String, u32, u32, u32) {
    let output = run_git_global(
        path,
        &["--no-optional-locks"],
        &[
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=normal",
            "--ignore-submodules=dirty",
        ],
        Duration::from_secs(12),
    );
    let Ok(output) = output else {
        return ("missing".into(), 0, 0, 0);
    };
    if !output.status.success() {
        return ("missing".into(), 0, 0, 0);
    }
    parse_branch_status(&lossy(&output.stdout))
}

fn parse_branch_status(text: &str) -> (String, u32, u32, u32) {
    let mut branch = "HEAD".to_string();
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut dirty = 0u32;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("## ") {
            let name = rest.split("...").next().unwrap_or(rest);
            let name = name.split(' ').next().unwrap_or(name).trim();
            branch = if name.is_empty() {
                "HEAD".to_string()
            } else {
                name.to_string()
            };
            if let Some(start) = rest.find('[') {
                if let Some(end) = rest[start..].find(']') {
                    for part in rest[start + 1..start + end].split(',') {
                        let part = part.trim();
                        if let Some(n) = part.strip_prefix("ahead ") {
                            ahead = n.parse().unwrap_or(0);
                        } else if let Some(n) = part.strip_prefix("behind ") {
                            behind = n.parse().unwrap_or(0);
                        }
                    }
                }
            }
        } else if !line.trim().is_empty() {
            dirty += 1;
        }
    }
    (branch, dirty, ahead, behind)
}

pub fn list_saved_repos() -> Vec<SavedRepoDto> {
    load_disk_repos()
        .into_iter()
        .map(|r| {
            let (branch, dirty, ahead, behind) = repo_brief(&r.path);
            SavedRepoDto {
                id: r.id,
                name: r.name,
                path: r.path,
                current_branch: branch,
                ahead_count: ahead,
                behind_count: behind,
                dirty_files_count: dirty,
                is_favorite: r.is_favorite,
                last_opened: r.last_opened,
            }
        })
        .collect()
}

pub fn add_saved_repo(name: &str, path: &str) -> Result<SavedRepoDto, String> {
    let top = validate_repo(path)?;
    let mut repos = load_disk_repos();
    let id = repo_id(&top);
    let display_name;
    let is_favorite;
    if let Some(existing) = repos.iter_mut().find(|r| r.id == id) {
        existing.last_opened = "刚刚".into();
        existing.path = top.clone();
        if !name.trim().is_empty() {
            existing.name = name.trim().to_string();
        }
        display_name = existing.name.clone();
        is_favorite = existing.is_favorite;
    } else {
        display_name = if name.trim().is_empty() {
            filename_of(&top)
        } else {
            name.trim().to_string()
        };
        is_favorite = false;
        repos.insert(
            0,
            SavedRepoDisk {
                id: id.clone(),
                name: display_name.clone(),
                path: top.clone(),
                is_favorite: false,
                last_opened: "刚刚".into(),
            },
        );
    }
    save_disk_repos(&repos)?;
    // 分支和脏文件由随后的快照填充，这里不再把每个已保存仓库都扫一遍。
    Ok(SavedRepoDto {
        id,
        name: display_name,
        path: top,
        current_branch: String::new(),
        ahead_count: 0,
        behind_count: 0,
        dirty_files_count: 0,
        is_favorite,
        last_opened: "刚刚".into(),
    })
}

pub fn remove_saved_repo(id: &str) -> Result<Vec<SavedRepoDto>, String> {
    let mut repos = load_disk_repos();
    repos.retain(|r| r.id != id);
    save_disk_repos(&repos)?;
    Ok(list_saved_repos())
}

pub fn toggle_favorite(id: &str) -> Result<Vec<SavedRepoDto>, String> {
    let mut repos = load_disk_repos();
    for repo in &mut repos {
        if repo.id == id {
            repo.is_favorite = !repo.is_favorite;
        }
    }
    save_disk_repos(&repos)?;
    Ok(list_saved_repos())
}

pub fn list_shelves(repo: &str) -> Result<Vec<ShelfItemDto>, String> {
    let dir = shelf_dir(repo)?;
    let mut items = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = fs::read_to_string(&path).unwrap_or_default();
        if let Ok(disk) = serde_json::from_str::<ShelfDisk>(&raw) {
            items.push(ShelfItemDto {
                id: disk.id,
                name: disk.name,
                date: disk.date,
                file_count: disk.files.len() as u32,
                files: disk.files,
            });
        }
    }
    items.sort_by(|a, b| b.date.cmp(&a.date));
    Ok(items)
}

pub fn create_shelf(repo: &str, name: &str, paths: &[String]) -> Result<ShelfItemDto, String> {
    let top = validate_repo(repo)?;
    let rels: Vec<String> = if paths.is_empty() {
        status_files(&top)?.into_iter().map(|f| f.path).collect()
    } else {
        paths.iter().map(|p| safe_rel(p)).collect::<Result<_, _>>()?
    };
    if rels.is_empty() {
        return Err("没有可架藏的变更".into());
    }
    let has_head = run_git(&top, &["rev-parse", "--verify", "HEAD"], Duration::from_secs(8))
        .map(|o| o.status.success())
        .unwrap_or(false);
    let patch = if has_head {
        let mut args = vec!["diff".to_string(), "HEAD".to_string(), "--".to_string()];
        args.extend(rels.iter().cloned());
        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let diff = run_git(&top, &arg_refs, Duration::from_secs(20))?;
        lossy(&diff.stdout)
    } else {
        String::new()
    };
    let status = status_files(&top)?;
    let mut files = Vec::new();
    let mut new_files = Vec::new();
    for rel in &rels {
        let Some(file) = status.iter().find(|f| f.path.replace('\\', "/") == rel.replace('\\', "/")) else {
            continue;
        };
        files.push(ShelfFileDto {
            path: file.path.clone(),
            status: file.status.clone(),
            additions: file.additions,
            deletions: file.deletions,
        });
        if file.status == "untracked" {
            let full = Path::new(&top).join(rel);
            if let Ok(bytes) = fs::read(&full) {
                if bytes.len() < 200_000 && !bytes.contains(&0) {
                    new_files.push(NewFileDisk {
                        path: rel.clone(),
                        content: String::from_utf8_lossy(&bytes).into_owned(),
                    });
                }
            }
        }
    }
    if patch.trim().is_empty() && new_files.is_empty() {
        return Err("没有可架藏的文本变更".into());
    }
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "shelf".into());
    let date = chrono_like_now();
    let disk = ShelfDisk {
        id: id.clone(),
        name: if name.trim().is_empty() { format!("Shelf {date}") } else { name.trim().to_string() },
        date: date.clone(),
        files: files.clone(),
        patch,
        new_files,
    };
    let raw = serde_json::to_string_pretty(&disk).map_err(|e| e.to_string())?;
    let shelf_path = shelf_dir(&top)?.join(format!("{id}.json"));
    fs::write(&shelf_path, raw).map_err(|e| format!("写入架藏失败（{}）：{e}", shelf_path.display()))?;
    // IDEA 的 Shelf 会把变更从工作区移走，避免和架藏各留一份。
    discard_paths(&top, &rels).map_err(|err| {
        format!("架藏已保存，但从工作区移出失败：{err}")
    })?;
    Ok(ShelfItemDto {
        id,
        name: disk.name,
        date,
        file_count: files.len() as u32,
        files,
    })
}

pub fn unshelve(repo: &str, id: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let path = shelf_dir(&top)?.join(format!("{id}.json"));
    let raw = fs::read_to_string(&path).map_err(|_| "找不到架藏".to_string())?;
    let disk: ShelfDisk = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    if !disk.patch.trim().is_empty() {
        let output = run_git_with_stdin(&top, &["apply", "--unidiff-zero"], &disk.patch, Duration::from_secs(20))?;
        ensure_ok(&output, "恢复架藏")?;
    }
    for file in &disk.new_files {
        let rel = safe_rel(&file.path)?;
        let full = Path::new(&top).join(&rel);
        if let Some(parent) = full.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if !full.exists() {
            fs::write(&full, &file.content).map_err(|e| e.to_string())?;
        }
    }
    Ok("已恢复到工作区，架藏仍保留".into())
}

pub fn delete_shelf(repo: &str, id: &str) -> Result<(), String> {
    let top = validate_repo(repo)?;
    let path = shelf_dir(&top)?.join(format!("{id}.json"));
    fs::remove_file(path).map_err(|e| format!("删除架藏失败：{e}"))?;
    Ok(())
}

fn chrono_like_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = (secs / 86400) as i64;
    let tod = secs % 86400;
    let (y, m, d) = civil_from_days(days);
    format!(
        "{y:04}-{m:02}-{d:02} {:02}:{:02}:{:02} UTC",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

fn civil_from_days(z: i64) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionFileDto {
    pub path: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchFileDto {
    pub path: String,
    pub status: String,
    pub additions: i32,
    pub deletions: i32,
    pub chunks: Vec<DiffChunkDto>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictViewDto {
    pub path: String,
    pub ours: String,
    pub theirs: String,
    pub base: String,
    pub working: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetaDto {
    pub encoding: String,
    pub line_ending: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct BranchFavDisk {
    repos: std::collections::HashMap<String, Vec<String>>,
}

fn branch_fav_path() -> Result<PathBuf, String> {
    Ok(writable_data_dir()?.join("branch-favorites.json"))
}

fn load_branch_favs() -> BranchFavDisk {
    let Ok(path) = branch_fav_path() else {
        return BranchFavDisk::default();
    };
    serde_json::from_str(&fs::read_to_string(path).unwrap_or_default()).unwrap_or_default()
}

fn favorite_branch_names(repo: &str) -> Vec<String> {
    let id = repo_id(repo);
    load_branch_favs().repos.get(&id).cloned().unwrap_or_default()
}

pub fn toggle_favorite_branch(repo: &str, name: &str) -> Result<(), String> {
    let top = validate_repo(repo)?;
    validate_branch_name(name)?;
    let id = repo_id(&top);
    let mut disk = load_branch_favs();
    let names = disk.repos.entry(id).or_default();
    if let Some(pos) = names.iter().position(|item| item == name) {
        names.remove(pos);
    } else {
        names.push(name.to_string());
    }
    let path = branch_fav_path()?;
    let text = serde_json::to_string_pretty(&disk).map_err(|err| err.to_string())?;
    fs::write(path, text).map_err(|err| format!("无法保存分支收藏：{err}"))?;
    Ok(())
}

fn validate_branch_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.starts_with('-')
        || name.ends_with('/')
        || name.contains("..")
        || name.chars().any(|ch| matches!(ch, ' ' | '\n' | '\0' | '\\'))
    {
        return Err(format!("无效的分支名：{name}"));
    }
    Ok(())
}

fn validate_rev(spec: &str) -> Result<(), String> {
    if spec.is_empty() || spec.starts_with('-') || spec.chars().any(|ch| ch == '\n' || ch == '\0') {
        return Err("无效的修订版本".into());
    }
    Ok(())
}

pub fn fetch_repo(repo: &str, on_progress: &mut dyn FnMut(&str)) -> Result<String, String> {
    let _pause = WatchPauseGuard::new();
    let top = validate_repo(repo)?;
    on_progress("正在连接远程，若弹出登录窗口请完成登录");
    let output = run_git_streaming(
        &top,
        &["fetch", "--progress", "--prune", "--all"],
        NETWORK_TIMEOUT,
        Some(NETWORK_STALL),
        on_progress,
    )?;
    if output.status.success() {
        let text = finish_network(&output, "刷新远程")?;
        let line = first_line(&text);
        return Ok(if line.is_empty() { "远程引用已更新".into() } else { line });
    }
    let msg = lossy(&output.stderr);
    if msg.to_ascii_lowercase().contains("no remote") {
        return Err("没有配置远程仓库".into());
    }
    if let Some(hint) = auth_hint(&msg) {
        return Err(hint.into());
    }
    Err(if msg.trim().is_empty() { "刷新远程引用失败".into() } else { msg })
}

fn validate_remote_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('-')
        || name.starts_with('.')
        || name.ends_with('.')
        || name.ends_with('/')
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.contains("..")
        || name.contains('@')
        || name.chars().any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err(format!("无效的远程名：{name}"));
    }
    Ok(())
}

fn validate_remote_url(url: &str) -> Result<(), String> {
    let lower = url.to_ascii_lowercase();
    // ext:: / fd:: 会让 Git 执行本地命令。名称和地址都不允许以 - 开头，避免被当成选项。
    if url.is_empty()
        || url.starts_with('-')
        || lower.starts_with("ext::")
        || lower.starts_with("fd::")
        || url.chars().any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err("远程地址无效。不要以 - 开头，也不能包含空格。".into());
    }
    Ok(())
}

fn validate_clone_directory(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.starts_with('-')
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.contains('/')
        || name.contains('\\')
        || name.contains(':')
        || name.chars().any(|ch| ch.is_control() || matches!(ch, '<' | '>' | '"' | '|' | '?' | '*'))
    {
        return Err(format!("无效的文件夹名：{name}"));
    }
    Ok(())
}

fn directory_from_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim().trim_end_matches(['/', '\\']);
    let last = trimmed.rsplit(['/', '\\', ':']).next().unwrap_or("");
    let name = last.strip_suffix(".git").unwrap_or(last);
    validate_clone_directory(name)?;
    Ok(name.to_string())
}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

fn remote_url(repo: &str, name: &str, push: bool) -> Result<String, String> {
    // 名称已拒绝以 - 开头，不必再插入 --。remote 子命令对 -- 的支持并不一致。
    let output = if push {
        run_git(repo, &["remote", "get-url", "--push", name], Duration::from_secs(8))?
    } else {
        run_git(repo, &["remote", "get-url", name], Duration::from_secs(8))?
    };
    ensure_ok(&output, "读取远程地址")
}

fn read_remote(repo: &str, name: &str) -> Result<GitRemoteDto, String> {
    let fetch_url = remote_url(repo, name, false)?;
    let push_url = remote_url(repo, name, true).unwrap_or_else(|_| fetch_url.clone());
    Ok(GitRemoteDto {
        name: name.to_string(),
        fetch_url,
        push_url,
    })
}

pub fn list_remotes(repo: &str) -> Result<RemoteListDto, String> {
    let top = validate_repo(repo)?;
    let names = remotes(&top)?;
    let mut items = Vec::with_capacity(names.len());
    for name in names {
        items.push(read_remote(&top, &name)?);
    }
    let branch = current_branch(&top).map(|(name, _)| name).unwrap_or_default();
    let tracked = !branch.is_empty() && branch != "HEAD";
    let upstream_remote = if tracked {
        config_get(&top, &format!("branch.{branch}.remote"))
    } else {
        None
    };
    let upstream_branch = if tracked {
        config_get(&top, &format!("branch.{branch}.merge"))
            .map(|merge| merge.strip_prefix("refs/heads/").unwrap_or(&merge).to_string())
    } else {
        None
    };
    Ok(RemoteListDto {
        remotes: items,
        current_branch: branch,
        upstream_remote,
        upstream_branch,
    })
}

pub fn add_remote(repo: &str, name: &str, url: &str) -> Result<GitRemoteDto, String> {
    let top = validate_repo(repo)?;
    let name = name.trim();
    let url = url.trim();
    validate_remote_name(name)?;
    validate_remote_url(url)?;
    let output = run_git(&top, &["remote", "add", name, url], Duration::from_secs(8))?;
    ensure_ok(&output, "添加远程")?;
    read_remote(&top, name)
}

pub fn rename_remote(repo: &str, old_name: &str, new_name: &str) -> Result<(), String> {
    let top = validate_repo(repo)?;
    let old_name = old_name.trim();
    let new_name = new_name.trim();
    validate_remote_name(old_name)?;
    validate_remote_name(new_name)?;
    if old_name == new_name {
        return Ok(());
    }
    let output = run_git(&top, &["remote", "rename", old_name, new_name], Duration::from_secs(8))?;
    ensure_ok(&output, "重命名远程")?;
    Ok(())
}

pub fn set_remote_url(repo: &str, name: &str, fetch_url: &str, push_url: Option<&str>) -> Result<GitRemoteDto, String> {
    let top = validate_repo(repo)?;
    let name = name.trim();
    let fetch_url = fetch_url.trim();
    validate_remote_name(name)?;
    validate_remote_url(fetch_url)?;
    let push = push_url.map(str::trim).filter(|url| !url.is_empty()).unwrap_or(fetch_url);
    validate_remote_url(push)?;
    let output = run_git(&top, &["remote", "set-url", name, fetch_url], Duration::from_secs(8))?;
    ensure_ok(&output, "修改获取地址")?;
    let output = run_git(&top, &["remote", "set-url", "--push", name, push], Duration::from_secs(8))?;
    ensure_ok(&output, "修改推送地址")?;
    read_remote(&top, name)
}

pub fn remove_remote(repo: &str, name: &str) -> Result<(), String> {
    let top = validate_repo(repo)?;
    let name = name.trim();
    validate_remote_name(name)?;
    let output = run_git(&top, &["remote", "remove", name], Duration::from_secs(8))?;
    ensure_ok(&output, "移除远程")?;
    Ok(())
}

pub fn fetch_remote(repo: &str, name: &str, on_progress: &mut dyn FnMut(&str)) -> Result<String, String> {
    let _pause = WatchPauseGuard::new();
    let top = validate_repo(repo)?;
    let name = name.trim();
    validate_remote_name(name)?;
    on_progress("正在连接远程，若弹出登录窗口请完成登录");
    let output = run_git_streaming(
        &top,
        &["fetch", "--progress", "--prune", "--", name],
        NETWORK_TIMEOUT,
        Some(NETWORK_STALL),
        on_progress,
    )?;
    let text = finish_network(&output, "获取")?;
    let line = first_line(&text);
    Ok(if line.is_empty() { format!("已获取 {name}") } else { line })
}

fn cleanup_failed_clone(dest: &Path) -> Option<String> {
    if !dest.exists() {
        return None;
    }
    fs::remove_dir_all(dest)
        .err()
        .map(|err| format!("克隆失败后未能删除不完整目录 {}：{err}", dest.display()))
}

/// 克隆到用户选定的父目录下。凭据仍由系统 Git 处理，这里不保存密码。
pub fn clone_repo(
    url: &str,
    parent: &str,
    directory: &str,
    on_progress: &mut dyn FnMut(&str),
) -> Result<String, String> {
    let _pause = WatchPauseGuard::new();
    let url = url.trim();
    validate_remote_url(url)?;
    let parent_path = Path::new(parent.trim());
    if !parent_path.is_dir() {
        return Err("保存目录不存在".into());
    }
    let folder = if directory.trim().is_empty() {
        directory_from_url(url)?
    } else {
        let name = directory.trim();
        validate_clone_directory(name)?;
        name.to_string()
    };
    let parent_canon = fs::canonicalize(parent_path).map_err(|err| format!("无法定位保存目录：{err}"))?;
    let dest = parent_canon.join(&folder);
    if !dest.starts_with(&parent_canon) {
        return Err("目标路径越出保存目录".into());
    }
    if dest.exists() {
        return Err("目标文件夹已存在".into());
    }
    let parent_arg = strip_verbatim_prefix(&parent_canon);
    let dest_arg = strip_verbatim_prefix(&dest);
    let parent_s = parent_arg.to_string_lossy().to_string();
    let dest_s = dest_arg.to_string_lossy().to_string();
    on_progress("正在克隆，若弹出登录窗口请完成登录");
    let cloned = run_git_streaming(
        &parent_s,
        &["clone", "--progress", "--", url, &dest_s],
        CLONE_TIMEOUT,
        Some(NETWORK_STALL),
        on_progress,
    );
    match cloned {
        Ok(output) if output.status.success() => validate_repo(&dest_s),
        Ok(output) => {
            let leftover = cleanup_failed_clone(&dest_arg);
            let mut err = match finish_network(&output, "克隆") {
                Ok(text) => {
                    let line = first_line(&text);
                    if line.is_empty() { "克隆失败".into() } else { format!("克隆失败：{line}") }
                }
                Err(err) => err,
            };
            if let Some(note) = leftover {
                err.push('\n');
                err.push_str(&note);
            }
            Err(err)
        }
        Err(err) => {
            let leftover = cleanup_failed_clone(&dest_arg);
            Err(match leftover {
                Some(note) => format!("{err}\n{note}"),
                None => err,
            })
        }
    }
}

fn pick_save_path(default_name: &str) -> Result<Option<String>, String> {
    let safe = default_name.replace('\\', "").replace('\'', "");
    let script = format!(
        r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
$d.Filter = 'Patch (*.patch)|*.patch|All files (*.*)|*.*'
$d.FileName = '{safe}'
$d.OverwritePrompt = $true
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $d.FileName }}
"#
    );
    let output = hidden_command("powershell")
        .args(["-STA", "-NoProfile", "-Command", &script])
        .output()
        .map_err(|err| format!("无法打开保存对话框：{err}"))?;
    let path = lossy(&output.stdout);
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path.lines().next().unwrap_or("").trim().to_string()))
    }
}

pub fn create_patch(repo: &str, paths: &[String]) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let rels: Vec<String> = paths.iter().map(|p| safe_rel(p)).collect::<Result<_, _>>()?;
    let status = status_files(&top)?;
    let selected: Vec<&FileChangeDto> = if rels.is_empty() {
        status.iter().collect()
    } else {
        status.iter().filter(|file| rels.iter().any(|p| p == &file.path.replace('\\', "/"))).collect()
    };
    if selected.is_empty() {
        return Err("没有可导出的变更".into());
    }
    let mut text = String::new();
    let tracked: Vec<String> = selected.iter().filter(|f| f.status != "untracked").map(|f| f.path.clone()).collect();
    if !tracked.is_empty() {
        let mut args = vec!["diff".to_string(), "HEAD".to_string(), "--".to_string()];
        args.extend(tracked);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let output = run_git(&top, &refs, Duration::from_secs(20))?;
        if !output.status.success() && output.stdout.is_empty() {
            return Err(lossy(&output.stderr));
        }
        text.push_str(&lossy(&output.stdout));
    }
    for file in selected.iter().filter(|f| f.status == "untracked") {
        for chunk in untracked_chunks(&top, &file.path) {
            text.push_str(&chunk.raw_patch);
            if !text.ends_with('\n') {
                text.push('\n');
            }
        }
    }
    if text.trim().is_empty() {
        return Err("没有可导出的文本差异".into());
    }
    let Some(dest) = pick_save_path("snail-git.patch")? else {
        return Ok("已取消".into());
    };
    fs::write(&dest, text).map_err(|err| format!("写入补丁失败：{err}"))?;
    Ok(format!("已保存 {dest}"))
}

fn collect_revision_files(name_status: &str, numstat: &str) -> Vec<RevisionFileDto> {
    let mut files = Vec::new();
    for line in name_status.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("commit ") {
            continue;
        }
        let mut cols = line.split('\t');
        let code = cols.next().unwrap_or("");
        let path = cols.next().unwrap_or("");
        let renamed = cols.next().unwrap_or("");
        let display = if renamed.is_empty() { path } else { renamed };
        if display.is_empty() {
            continue;
        }
        let status = match code.chars().next().unwrap_or('M') {
            'A' => "added",
            'D' => "deleted",
            'U' => "conflict",
            _ => "modified",
        };
        files.push(RevisionFileDto {
            path: display.replace('\\', "/"),
            status: status.into(),
            additions: 0,
            deletions: 0,
        });
    }
    for line in numstat.lines() {
        let line = line.trim();
        if line.is_empty() || !line.contains('\t') {
            continue;
        }
        let mut cols = line.split('\t');
        let additions = cols.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let deletions = cols.next().unwrap_or("0").parse::<i32>().unwrap_or(0);
        let path = cols.next().unwrap_or("").replace('\\', "/");
        if let Some(file) = files.iter_mut().find(|file| file.path == path || numstat_matches(&file.path, &path)) {
            file.additions = additions;
            file.deletions = deletions;
        }
    }
    files
}

pub fn list_revision_files(repo: &str, spec: &str, mode: &str) -> Result<Vec<RevisionFileDto>, String> {
    let top = validate_repo(repo)?;
    validate_rev(spec)?;
    let (names, stats) = match mode {
        "commit" => (
            run_git(&top, &["show", "--name-status", "--pretty=format:", spec], Duration::from_secs(20))?,
            run_git(&top, &["show", "--numstat", "--pretty=format:", spec], Duration::from_secs(20))?,
        ),
        "worktree" | "range" => (
            run_git(&top, &["diff", "--name-status", spec], Duration::from_secs(20))?,
            run_git(&top, &["diff", "--numstat", spec], Duration::from_secs(20))?,
        ),
        _ => return Err("未知对比模式".into()),
    };
    if !names.status.success() {
        return Err(lossy(&names.stderr));
    }
    Ok(collect_revision_files(&lossy(&names.stdout), &lossy(&stats.stdout)))
}

pub fn load_revision_diff(repo: &str, spec: &str, path: &str, mode: &str, ignore_ws: bool) -> Result<Vec<DiffChunkDto>, String> {
    let top = validate_repo(repo)?;
    validate_rev(spec)?;
    let rel = safe_rel(path)?;
    let args: Vec<String> = match mode {
        "commit" if ignore_ws => vec!["diff".into(), "-U3".into(), "-w".into(), format!("{spec}^"), spec.into(), "--".into(), rel],
        "commit" => vec!["show".into(), "-U3".into(), "--format=".into(), spec.into(), "--".into(), rel],
        "worktree" | "range" => {
            let mut args = vec!["diff".into(), "-U3".into()];
            if ignore_ws {
                args.push("-w".into());
            }
            args.push(spec.into());
            args.push("--".into());
            args.push(rel);
            args
        }
        _ => return Err("未知对比模式".into()),
    };
    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_git(&top, &refs, Duration::from_secs(20))?;
    let text = lossy(&output.stdout);
    if text.is_empty() && !output.status.success() {
        return Err(lossy(&output.stderr));
    }
    let mut chunks = split_hunks(&text, false, "rev");
    for chunk in &mut chunks {
        if chunk.lines.len() > 800 {
            chunk.lines.truncate(800);
        }
    }
    Ok(chunks)
}

fn split_diff_blocks(diff_text: &str) -> Vec<&str> {
    let Some(start) = diff_text.find("diff --git ") else {
        return if diff_text.contains("@@") { vec![diff_text] } else { Vec::new() };
    };
    let text = &diff_text[start..];
    let mut blocks = Vec::new();
    let mut offset = 0;
    while let Some(rel) = text[offset..].find("diff --git ") {
        let abs = offset + rel;
        if let Some(next) = text[abs + 1..].find("\ndiff --git ") {
            let end = abs + 1 + next;
            blocks.push(&text[abs..end]);
            offset = end + 1;
        } else {
            blocks.push(&text[abs..]);
            break;
        }
    }
    blocks
}

fn patch_path(block: &str) -> Option<String> {
    for line in block.lines() {
        if let Some(rest) = line.strip_prefix("+++ b/") {
            if rest != "/dev/null" {
                return Some(rest.to_string());
            }
        }
    }
    for line in block.lines() {
        if let Some(rest) = line.strip_prefix("--- a/") {
            if rest != "/dev/null" {
                return Some(rest.to_string());
            }
        }
    }
    None
}

fn patch_to_files(diff_text: &str) -> Vec<PatchFileDto> {
    split_diff_blocks(diff_text)
        .into_iter()
        .filter_map(|block| {
            let path = patch_path(block)?;
            let chunks = split_hunks(block, false, "patch");
            let additions = chunks.iter().flat_map(|c| c.lines.iter()).filter(|l| l.kind != "deleted" && l.kind != "unchanged").count() as i32;
            let deletions = chunks.iter().flat_map(|c| c.lines.iter()).filter(|l| l.kind != "added" && l.kind != "unchanged").count() as i32;
            let status = if block.contains("new file mode") {
                "added"
            } else if block.contains("deleted file mode") {
                "deleted"
            } else {
                "modified"
            };
            Some(PatchFileDto {
                path,
                status: status.into(),
                additions,
                deletions,
                chunks,
            })
        })
        .collect()
}

fn new_file_patch(path: &str, content: &str) -> PatchFileDto {
    let lines: Vec<&str> = content.lines().take(300).collect();
    let count = lines.len() as u32;
    let mut dto_lines = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        dto_lines.push(plain_line("added", None, Some(i as u32 + 1), None, Some((*line).to_string())));
    }
    let chunk = DiffChunkDto {
        id: format!("shelf-new-{path}"),
        old_start: 0,
        old_lines: 0,
        new_start: 1,
        new_lines: count,
        is_staged: false,
        lines: dto_lines,
        raw_patch: String::new(),
    };
    PatchFileDto {
        path: path.into(),
        status: "added".into(),
        additions: count as i32,
        deletions: 0,
        chunks: vec![chunk],
    }
}

pub fn shelf_patch_files(repo: &str, id: &str) -> Result<Vec<PatchFileDto>, String> {
    let top = validate_repo(repo)?;
    if id.is_empty() || id.chars().any(|ch| matches!(ch, '/' | '\\' | '.')) {
        return Err("无效的架藏编号".into());
    }
    let path = shelf_dir(&top)?.join(format!("{id}.json"));
    let raw = fs::read_to_string(&path).map_err(|_| "找不到架藏".to_string())?;
    let disk: ShelfDisk = serde_json::from_str(&raw).map_err(|err| err.to_string())?;
    let mut files = patch_to_files(&disk.patch);
    for file in &disk.new_files {
        if files.iter().any(|item| item.path == file.path) {
            continue;
        }
        files.push(new_file_patch(&file.path, &file.content));
    }
    Ok(files)
}

pub fn stash_patch_files(repo: &str, index: u32) -> Result<Vec<PatchFileDto>, String> {
    let top = validate_repo(repo)?;
    let spec = format!("stash@{{{index}}}");
    let output = run_git(&top, &["stash", "show", "-p", "--include-untracked", &spec], Duration::from_secs(20))?;
    let text = if output.status.success() {
        lossy(&output.stdout)
    } else {
        let fallback = run_git(&top, &["stash", "show", "-p", &spec], Duration::from_secs(20))?;
        ensure_ok(&fallback, "读取贮藏差异")?
    };
    Ok(patch_to_files(&text))
}

pub fn delete_branch(repo: &str, name: &str, remote: bool, force: bool) -> Result<String, String> {
    let top = validate_repo(repo)?;
    validate_branch_name(name)?;
    if remote {
        let (remote_name, branch) = name.split_once('/').ok_or_else(|| "远程分支名无效".to_string())?;
        let output = run_git(&top, &["push", remote_name, "--delete", branch], Duration::from_secs(60))?;
        return ensure_ok(&output, "删除远程分支");
    }
    let (current, _) = current_branch(&top)?;
    if name == current {
        return Err("不能删除当前分支".into());
    }
    let flag = if force { "-D" } else { "-d" };
    let output = run_git(&top, &["branch", flag, "--", name], Duration::from_secs(15))?;
    ensure_ok(&output, "删除分支")
}

pub fn rename_branch(repo: &str, old: &str, new: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    validate_branch_name(old)?;
    validate_branch_name(new)?;
    let output = run_git(&top, &["branch", "-m", "--", old, new], Duration::from_secs(15))?;
    ensure_ok(&output, "重命名分支")
}

fn show_stage(repo: &str, stage: u8, rel: &str) -> String {
    let spec = format!(":{stage}:{rel}");
    match run_git(repo, &["show", &spec], Duration::from_secs(12)) {
        Ok(output) if output.status.success() => lossy(&output.stdout),
        _ => String::new(),
    }
}

pub fn load_conflict(repo: &str, path: &str) -> Result<ConflictViewDto, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let working = fs::read(Path::new(&top).join(&rel))
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    Ok(ConflictViewDto {
        path: rel.clone(),
        ours: show_stage(&top, 2, &rel),
        theirs: show_stage(&top, 3, &rel),
        base: show_stage(&top, 1, &rel),
        working,
    })
}

pub fn resolve_conflict(repo: &str, path: &str, content: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let full = Path::new(&top).join(&rel);
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&full, content).map_err(|err| format!("写入合并结果失败：{err}"))?;
    let output = run_git(&top, &["add", "--", &rel], Duration::from_secs(15))?;
    ensure_ok(&output, "标记冲突已解决")?;
    Ok("已写入并标记为已解决".into())
}

pub fn smart_merge_conflict(repo: &str, path: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let view = load_conflict(&top, &rel)?;
    if view.ours.is_empty() && view.theirs.is_empty() {
        return Ok(view.working);
    }
    let dir = std::env::temp_dir().join(format!("snail-git-merge-{}", std::process::id()));
    fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    let base = dir.join("base");
    let ours = dir.join("ours");
    let theirs = dir.join("theirs");
    fs::write(&base, view.base.as_bytes()).map_err(|err| err.to_string())?;
    fs::write(&ours, view.ours.as_bytes()).map_err(|err| err.to_string())?;
    fs::write(&theirs, view.theirs.as_bytes()).map_err(|err| err.to_string())?;
    let output = run_git(
        &top,
        &[
            "merge-file",
            "-p",
            ours.to_str().unwrap_or(""),
            base.to_str().unwrap_or(""),
            theirs.to_str().unwrap_or(""),
        ],
        Duration::from_secs(15),
    )?;
    let text = lossy(&output.stdout);
    if text.is_empty() && !output.status.success() {
        let err = lossy(&output.stderr);
        return Err(if err.trim().is_empty() { "智能合并失败".into() } else { err });
    }
    Ok(text)
}

pub fn inspect_file(repo: &str, path: &str) -> Result<FileMetaDto, String> {
    let top = validate_repo(repo)?;
    let rel = safe_rel(path)?;
    let bytes = fs::read(Path::new(&top).join(rel)).unwrap_or_default();
    let encoding = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        "UTF-8 BOM"
    } else if bytes.starts_with(&[0xFF, 0xFE]) {
        "UTF-16 LE"
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        "UTF-16 BE"
    } else if bytes.is_empty() || std::str::from_utf8(&bytes).is_ok() {
        "UTF-8"
    } else {
        "未知"
    };
    let crlf = bytes.windows(2).filter(|pair| *pair == b"\r\n").count();
    let lf = bytes.iter().filter(|byte| **byte == b'\n').count();
    let lone_lf = lf.saturating_sub(crlf);
    let line_ending = if crlf > 0 && lone_lf > 0 {
        "混合"
    } else if crlf > 0 {
        "CRLF"
    } else if lone_lf > 0 {
        "LF"
    } else {
        "—"
    };
    Ok(FileMetaDto {
        encoding: encoding.into(),
        line_ending: line_ending.into(),
    })
}

pub fn process_memory_mb() -> u32 {
    #[cfg(windows)]
    {
        #[repr(C)]
        struct Counters {
            cb: u32,
            page_fault_count: u32,
            peak_working_set_size: usize,
            working_set_size: usize,
            quota_peak_paged_pool_usage: usize,
            quota_paged_pool_usage: usize,
            quota_peak_non_paged_pool_usage: usize,
            quota_non_paged_pool_usage: usize,
            pagefile_usage: usize,
            peak_pagefile_usage: usize,
        }
        extern "system" {
            fn GetCurrentProcess() -> *mut core::ffi::c_void;
            fn K32GetProcessMemoryInfo(process: *mut core::ffi::c_void, counters: *mut Counters, cb: u32) -> i32;
        }
        unsafe {
            let mut pmc: Counters = std::mem::zeroed();
            pmc.cb = std::mem::size_of::<Counters>() as u32;
            if K32GetProcessMemoryInfo(GetCurrentProcess(), &mut pmc, pmc.cb) != 0 {
                return (pmc.working_set_size / (1024 * 1024)) as u32;
            }
        }
    }
    0
}

pub fn reveal_path(path: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err("路径为空".into());
    }
    hidden_command("explorer")
        .arg(path)
        .spawn()
        .map_err(|err| format!("无法打开资源管理器：{err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gitignore_line_keeps_filename_and_directory_slash() {
        assert_eq!(gitignore_line(r"src\Foo Bar.ts", false), "src/Foo\\ Bar.ts");
        assert_eq!(gitignore_line("build/out/", true), "build/out/");
        assert!(ignore_line_matches("src/Foo\\ Bar.ts\n", "src/Foo\\ Bar.ts"));
    }

    #[test]
    fn branch_status_keeps_dots_in_branch_names() {
        let (branch, dirty, ahead, behind) = parse_branch_status(
            "## release/1.2...origin/release/1.2 [ahead 2, behind 1]\n M src/a.ts\n?? new.txt\n",
        );
        assert_eq!(branch, "release/1.2");
        assert_eq!((dirty, ahead, behind), (2, 2, 1));
        let (detached, _, _, _) = parse_branch_status("## HEAD (no branch)\n");
        assert_eq!(detached, "HEAD");
    }

    fn temp_repo() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("snail-git-test-{}", std::process::id()));
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();
        let init = run_git(&path, &["init", "-b", "main"], Duration::from_secs(10)).unwrap();
        assert!(init.status.success(), "{}", lossy(&init.stderr));
        let _ = run_git(&path, &["config", "user.email", "test@snailgit.local"], Duration::from_secs(5));
        let _ = run_git(&path, &["config", "user.name", "SnailGit Test"], Duration::from_secs(5));
        fs::write(dir.join("a.txt"), "hello\n").unwrap();
        dir
    }

    #[test]
    fn status_stage_commit_and_log() {
        let dir = temp_repo();
        let path = dir.to_string_lossy().to_string();
        let files = status_files(&path).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, "untracked");

        stage_paths(&path, &["a.txt".into()]).unwrap();
        let staged = status_files(&path).unwrap();
        assert!(staged[0].is_staged, "file should be staged");

        commit(&path, "init", false, false).unwrap();
        let log = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].subject, "init");
        assert!(log[0].refs.iter().any(|r| r.contains("main")));
        assert!(log[0].files.is_empty(), "history list should not preload file stats");
        let files = load_commit_files(&path, &log[0].hash).unwrap();
        assert!(files.iter().any(|f| f.path == "a.txt" && f.additions > 0), "commit file stats should come from numstat");
        let tagged = run_git(&path, &["tag", "v0.1.0"], Duration::from_secs(8)).unwrap();
        assert!(tagged.status.success(), "{}", lossy(&tagged.stderr));
        let tags = list_tags(&path).unwrap();
        assert!(tags.iter().any(|tag| tag.name == "v0.1.0" && !tag.hash.is_empty()));

        fs::write(dir.join("a.txt"), "hello\nchanged\n").unwrap();
        let diff = file_diff_opts(&path, "a.txt", false).unwrap();
        assert!(!diff.is_empty(), "expected a diff chunk");
        assert!(diff[0].lines.iter().any(|l| l.kind == "added"));
        apply_chunk(&path, &diff[0].raw_patch, "stage").unwrap();
        let after = status_files(&path).unwrap();
        assert!(after[0].is_staged, "chunk stage should stage the file");

        checkout_branch(&path, &log[0].hash).unwrap();
        let (branch, _) = current_branch(&path).unwrap();
        assert_eq!(branch, "HEAD");
        checkout_branch(&path, "main").unwrap();

        let shelf = create_shelf(&path, "smoke", &["a.txt".into()]).unwrap();
        assert_eq!(shelf.file_count, 1);
        assert!(
            status_files(&path).unwrap().iter().all(|f| f.path != "a.txt"),
            "shelving should move the change out of the worktree"
        );
        let shelf_diff = shelf_patch_files(&path, &shelf.id).unwrap();
        assert!(!shelf_diff.is_empty(), "shelf should keep a readable patch");
        delete_shelf(&path, &shelf.id).unwrap();

        create_branch(&path, "feature-smoke", None).unwrap();
        let (now, _) = current_branch(&path).unwrap();
        let branches = list_branches(&path, &now).unwrap();
        assert!(
            branches.iter().any(|b| b.name == "feature-smoke" && b.is_current),
            "current={now} branches={:?}",
            branches.iter().map(|b| format!("{} current={}", b.name, b.is_current)).collect::<Vec<_>>()
        );
        let before = signature(&path);
        fs::write(dir.join("a.txt"), "stash me\n").unwrap();
        assert_ne!(signature(&path), before, "worktree change should change the watch signature");
        stash_save(&path, "wip").unwrap();
        let stashes = list_stashes(&path).unwrap();
        assert_eq!(stashes.len(), 1);
        stash_apply(&path, stashes[0].index, true).unwrap();
        assert!(list_stashes(&path).unwrap().is_empty());

        fs::write(dir.join("a.txt"), "line1\nkeep\nline3\n").unwrap();
        stage_paths(&path, &["a.txt".into()]).unwrap();
        commit(&path, "two lines", false, false).unwrap();
        fs::write(dir.join("a.txt"), "LINE1\nkeep\nLINE3\n").unwrap();
        let raw = run_git(&path, &["diff", "-U0", "--", "a.txt"], Duration::from_secs(8)).unwrap();
        let chunks = split_hunks(&lossy(&raw.stdout), false, "u");
        assert!(chunks.len() >= 2, "expected two separate hunks, got {}:\n{}", chunks.len(), lossy(&raw.stdout));
        apply_chunk(&path, &chunks[0].raw_patch, "stage").unwrap();
        let cached = run_git(&path, &["diff", "--cached", "-U0", "--", "a.txt"], Duration::from_secs(8)).unwrap();
        let cached_text = lossy(&cached.stdout);
        assert!(cached_text.contains("+LINE1"), "first hunk should be staged");
        assert!(!cached_text.contains("+LINE3"), "second hunk must stay unstaged");
        fs::write(dir.join("a.txt"), "other\nkeep\nLINE3\n").unwrap();
        let refused = apply_chunk(&path, &chunks[0].raw_patch, "rollback");
        assert!(refused.is_err(), "rollback must refuse when the worktree no longer matches");

        fs::write(dir.join("old-name.txt"), "keep\n").unwrap();
        stage_paths(&path, &["old-name.txt".into()]).unwrap();
        commit(&path, "add old name", false, false).unwrap();
        run_git(&path, &["mv", "old-name.txt", "new-name.txt"], Duration::from_secs(8)).unwrap();
        let renamed = status_files(&path).unwrap();
        let renamed_file = renamed.iter().find(|f| f.path.ends_with("new-name.txt")).expect("rename should expose the new path");
        assert_eq!(renamed_file.old_path.as_deref(), Some("old-name.txt"));
        discard_paths(&path, &["new-name.txt".into()]).unwrap();
        assert!(dir.join("old-name.txt").exists(), "rollback must restore the original path");
        assert!(!dir.join("new-name.txt").exists(), "rollback must remove the renamed path");

        fs::write(dir.join("new.txt"), "temp\n").unwrap();
        discard_paths(&path, &["new.txt".into()]).unwrap();
        assert!(!dir.join("new.txt").exists(), "untracked file should leave the worktree");

        rename_branch(&path, "feature-smoke", "feature-renamed").unwrap();
        run_git(&path, &["switch", "-f", "main"], Duration::from_secs(15)).unwrap();
        delete_branch(&path, "feature-renamed", false, true).unwrap();
        let (old_spans, new_spans) = word_spans("hello world", "hello SnailGit");
        assert!(old_spans.iter().any(|span| span.kind == "del" && span.text.contains("world")));
        assert!(new_spans.iter().any(|span| span.kind == "add" && span.text.contains("SnailGit")));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn commit_log_query_pages_and_filters() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = std::env::temp_dir().join(format!("snail-git-log-{}-{stamp}", std::process::id()));
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();
        let init = run_git(&path, &["init", "-b", "main"], Duration::from_secs(10)).unwrap();
        assert!(init.status.success(), "{}", lossy(&init.stderr));
        let _ = run_git(&path, &["config", "user.email", "test@snailgit.local"], Duration::from_secs(5));
        let _ = run_git(&path, &["config", "user.name", "SnailGit Test"], Duration::from_secs(5));

        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("src/old.txt"), "old\n").unwrap();
        stage_paths(&path, &["src/old.txt".into()]).unwrap();
        let other = run_git(
            &path,
            &["commit", "--author", "Other Person <other@snailgit.local>", "-m", "alpha unique"],
            Duration::from_secs(15),
        )
        .unwrap();
        assert!(other.status.success(), "{}", lossy(&other.stderr));
        run_git(&path, &["branch", "feature"], Duration::from_secs(8)).unwrap();

        fs::write(dir.join("b.txt"), "b\n").unwrap();
        stage_paths(&path, &["b.txt".into()]).unwrap();
        commit(&path, "beta", false, false).unwrap();
        fs::write(dir.join("c.txt"), "c\n").unwrap();
        stage_paths(&path, &["c.txt".into()]).unwrap();
        commit(&path, "gamma", false, false).unwrap();

        let page = load_commit_log(&path, &CommitLogQuery { limit: 2, ..CommitLogQuery::default() }).unwrap();
        assert_eq!(page.commits.len(), 2);
        assert!(page.has_more);
        assert_eq!(page.commits[0].subject, "gamma");
        assert!(page.commits[0].files.is_empty());

        let older = load_commit_log(&path, &CommitLogQuery { skip: 2, limit: 2, ..CommitLogQuery::default() }).unwrap();
        assert_eq!(older.commits.len(), 1);
        assert!(!older.has_more);
        assert_eq!(older.commits[0].subject, "alpha unique");

        let by_message = load_commit_log(
            &path,
            &CommitLogQuery { search: "alpha unique".into(), limit: 2, ..CommitLogQuery::default() },
        )
        .unwrap();
        assert_eq!(by_message.commits.len(), 1);
        assert_eq!(by_message.commits[0].subject, "alpha unique");

        let by_author_text = load_commit_log(
            &path,
            &CommitLogQuery { search: "Other Person".into(), limit: 2, ..CommitLogQuery::default() },
        )
        .unwrap();
        assert!(by_author_text.commits.iter().any(|item| item.subject == "alpha unique"));

        let by_author = load_commit_log(
            &path,
            &CommitLogQuery { author: "Other Person".into(), limit: 2, ..CommitLogQuery::default() },
        )
        .unwrap();
        assert_eq!(by_author.commits.len(), 1);
        assert_eq!(by_author.commits[0].subject, "alpha unique");

        let by_path = load_commit_log(
            &path,
            &CommitLogQuery { path: "src".into(), limit: 2, ..CommitLogQuery::default() },
        )
        .unwrap();
        assert_eq!(by_path.commits.len(), 1);
        assert_eq!(by_path.commits[0].subject, "alpha unique");

        let by_branch = load_commit_log(
            &path,
            &CommitLogQuery { branch: "feature".into(), limit: 2, ..CommitLogQuery::default() },
        )
        .unwrap();
        assert_eq!(by_branch.commits.len(), 1);
        assert_eq!(by_branch.commits[0].subject, "alpha unique");

        let head = load_commit_log(
            &path,
            &CommitLogQuery { branch: "Head".into(), limit: 10, ..CommitLogQuery::default() },
        )
        .unwrap();
        assert_eq!(head.commits.len(), 3);

        let prefix = &older.commits[0].hash[..7];
        let by_hash = load_commit_log(
            &path,
            &CommitLogQuery { search: prefix.into(), limit: 2, ..CommitLogQuery::default() },
        )
        .unwrap();
        assert!(by_hash.commits.iter().any(|item| item.hash.starts_with(prefix)));

        let files = load_commit_files(&path, &older.commits[0].hash).unwrap();
        assert!(files.iter().any(|file| file.path == "src/old.txt" && file.additions > 0));
        let _ = fs::remove_dir_all(&dir);
    }

    /// 真冲突：探测就把合并执行到底（带着 `--no-commit`），把待解决状态留在工作区交给三方合并器，
    /// 而不是让 git 失败退出、把冲突信息丢在报错里。
    #[test]
    fn update_keeps_merge_in_progress_when_conflict_is_detected() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-update-conflict-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin");
        let local = root.join("local");
        init_repo(&origin);
        let origin_s = origin.to_string_lossy().to_string();
        fs::write(origin.join("a.txt"), "base\n").unwrap();
        git_ok(&origin_s, &["add", "."]);
        git_ok(&origin_s, &["commit", "-m", "base"]);
        let root_s = root.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        git_ok(&root_s, &["clone", &origin_s, &local_s]);

        // 两边各自提交对同一行不同的修改，制造确定会冲突的场景。
        fs::write(origin.join("a.txt"), "remote\n").unwrap();
        git_ok(&origin_s, &["add", "a.txt"]);
        git_ok(&origin_s, &["commit", "-m", "remote edit"]);
        fs::write(local.join("a.txt"), "local\n").unwrap();
        git_ok(&local_s, &["add", "a.txt"]);
        git_ok(&local_s, &["commit", "-m", "local edit"]);

        let probed = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(probed.status, "ok", "{}", probed.message);
        assert_eq!(probed.strategy, "merge");
        assert!(probed.conflicting_paths.iter().any(|path| path.ends_with("a.txt")));
        assert!(
            local.join(".git").join("MERGE_HEAD").exists(),
            "探测发现冲突后应处于合并中，等用户解决"
        );
        // 本地提交仍在，没有被回滚掉。
        let head = run_git(&local_s, &["log", "-1", "--format=%s"], Duration::from_secs(8)).unwrap();
        assert_eq!(lossy(&head.stdout), "local edit");
        let working = fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n");
        assert!(working.contains("<<<<<<<"), "冲突标记应留在工作区：{working}");
        let _ = fs::remove_dir_all(&root);
    }

    /// 回归：未贮藏本地改动时选“继续”，合并会被 git 挡住（exit=2、stdout 为空）。
    /// 旧代码不看退出码，把这行 stderr 当成正常输出，返回 `ok` —— 前端于是弹一个绿色的
    /// “error: Your local changes ... would be overwritten by merge:”，而仓库一动没动。
    #[test]
    fn update_blocked_by_local_changes_never_reports_success() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-update-blocked-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin");
        let local = root.join("local");
        init_repo(&origin);
        let origin_s = origin.to_string_lossy().to_string();
        fs::write(origin.join("a.txt"), "v1\n").unwrap();
        git_ok(&origin_s, &["add", "."]);
        git_ok(&origin_s, &["commit", "-m", "v1"]);
        let root_s = root.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        git_ok(&root_s, &["clone", &origin_s, &local_s]);

        // 远程推进（本地无独有提交），并改同一个文件；本地也改它但未提交。
        fs::write(origin.join("a.txt"), "v2\n").unwrap();
        git_ok(&origin_s, &["add", "a.txt"]);
        git_ok(&origin_s, &["commit", "-m", "v2"]);
        fs::write(local.join("a.txt"), "mylocal\n").unwrap();
        let before = run_git(&local_s, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();

        // 探测阶段就应该把真实原因（哪个文件被挡）拆出来给用户选。
        let asked = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(asked.status, "needs_confirm", "{}", asked.message);
        assert!(!asked.message.contains("overwritten"), "不应直接把 git 原文丢给用户：{}", asked.message);
        assert!(asked.conflicting_paths.iter().any(|path| path.ends_with("a.txt")));

        // 旧的 continue 调用仍会被挡住，必须是 blocked，不能是 ok。界面已不再提供这个选项。
        let continued = update_repo(&local_s, false, "continue", &mut |_| {}).unwrap();
        assert_eq!(continued.status, "blocked", "{}", continued.message);
        assert!(!continued.message.contains("overwritten"), "{}", continued.message);

        // 无论哪一步，都不能真的动仓库，也不能弄丢本地改动。
        let after = run_git(&local_s, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();
        assert_eq!(lossy(&before.stdout), lossy(&after.stdout), "被挡住时不该推进 HEAD");
        assert_eq!(
            fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n"),
            "mylocal\n"
        );
        assert!(!local.join(".git").join("MERGE_HEAD").exists(), "不该留下半途的合并状态");
        let _ = fs::remove_dir_all(&root);
    }

    /// 不该在“没有待落地合并”时盲目 commit：
    /// 否则快进/已是最新会让 git 报 “no changes added to commit”，把用户自己的未提交改动一起列出来，
    /// 而仓库可能已经快进、只差一个提交。
    #[test]
    fn commit_pending_merge_skips_when_nothing_is_merging() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-pending-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let repo = root.join("repo");
        init_repo(&repo);
        let repo_s = repo.to_string_lossy().to_string();
        fs::write(repo.join("a.txt"), "v1\n").unwrap();
        git_ok(&repo_s, &["add", "."]);
        git_ok(&repo_s, &["commit", "-m", "v1"]);
        // 工作区有未提交改动，但没有任何合并在进行。
        fs::write(repo.join("a.txt"), "dirty\n").unwrap();

        assert_eq!(commit_pending_merge(&repo_s).unwrap(), "none");
        assert_eq!(merge_in_progress(&repo_s), false);
        // 未提交的改动必须原样保留，没有被顺手提交掉。
        assert_eq!(
            fs::read_to_string(repo.join("a.txt")).unwrap().replace("\r\n", "\n"),
            "dirty\n"
        );
        let log = run_git(&repo_s, &["log", "--format=%s"], Duration::from_secs(8)).unwrap();
        assert_eq!(lossy(&log.stdout), "v1", "不该多出任何提交");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn auth_hint_maps_credential_failures() {
        assert!(auth_hint("fatal: Authentication failed for 'https://example.com'").is_some());
        assert!(auth_hint("fatal: could not read Username: terminal prompts disabled").is_some());
        assert!(auth_hint("Permission denied (publickey).").is_some());
        assert!(auth_hint("merge conflict in a.txt").is_none());
    }

    #[test]
    fn integrate_strategy_follows_pull_rebase() {
        assert_eq!(integrate_strategy(None).unwrap(), "merge");
        assert_eq!(integrate_strategy(Some("false")).unwrap(), "merge");
        assert_eq!(integrate_strategy(Some("true")).unwrap(), "rebase");
        assert_eq!(integrate_strategy(Some("merges")).unwrap(), "rebase-merges");
        assert!(integrate_strategy(Some("interactive")).is_err());
    }

    #[test]
    fn overlapping_paths_normalizes_separators() {
        let found = overlapping_paths(&["src\\a.txt".into(), "other.txt".into()], &["src/a.txt".into()]);
        assert_eq!(found, vec!["src/a.txt".to_string()]);
    }

    fn git_ok(cwd: &str, args: &[&str]) {
        let output = run_git(cwd, args, Duration::from_secs(20)).unwrap();
        assert!(output.status.success(), "{:?} {}", args, lossy(&output.stderr));
    }

    fn init_repo(path: &std::path::Path) {
        fs::create_dir_all(path).unwrap();
        let cwd = path.to_string_lossy().to_string();
        git_ok(&cwd, &["init", "-b", "main"]);
        git_ok(&cwd, &["config", "user.email", "test@snailgit.local"]);
        git_ok(&cwd, &["config", "user.name", "SnailGit Test"]);
    }

    #[test]
    fn push_confirms_upstream_and_skips_when_nothing_to_push() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-sync-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let bare = root.join("origin.git");
        let local = root.join("local");
        let bare_s = bare.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        let root_s = root.to_string_lossy().to_string();
        git_ok(&root_s, &["init", "--bare", "-b", "main", &bare_s]);
        init_repo(&local);
        fs::write(local.join("a.txt"), "v1\n").unwrap();
        git_ok(&local_s, &["add", "a.txt"]);
        git_ok(&local_s, &["commit", "-m", "init"]);
        git_ok(&local_s, &["remote", "add", "origin", &bare_s]);

        let asked = push_repo(&local_s, false, &mut |_| {}).unwrap();
        assert_eq!(asked.status, "needs_confirm");
        assert!(upstream_ref(&local_s).is_none(), "confirm must not set upstream");

        let pushed = push_repo(&local_s, true, &mut |_| {}).unwrap();
        assert_eq!(pushed.status, "ok", "{}", pushed.message);
        assert!(upstream_ref(&local_s).is_some());

        let again = push_repo(&local_s, false, &mut |_| {}).unwrap();
        assert_eq!(again.status, "up_to_date", "{}", again.message);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn preview_push_lists_commits_and_can_retarget() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-push-preview-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let bare = root.join("origin.git");
        let local = root.join("local");
        let bare_s = bare.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        let root_s = root.to_string_lossy().to_string();
        git_ok(&root_s, &["init", "--bare", "-b", "main", &bare_s]);
        init_repo(&local);
        fs::write(local.join("a.txt"), "v1\n").unwrap();
        git_ok(&local_s, &["add", "a.txt"]);
        git_ok(&local_s, &["commit", "-m", "init"]);
        fs::write(local.join("b.txt"), "v2\n").unwrap();
        git_ok(&local_s, &["add", "b.txt"]);
        git_ok(&local_s, &["commit", "-m", "second"]);
        git_ok(&local_s, &["remote", "add", "origin", &bare_s]);

        let preview = preview_push(&local_s, None, None, None).unwrap();
        assert_eq!(preview.remote, "origin");
        assert_eq!(preview.target_branch, "main");
        assert!(!preview.target_exists);
        assert!(preview.will_set_upstream);
        assert_eq!(preview.ahead, 2);
        assert_eq!(preview.commits.len(), 2);
        assert_eq!(preview.commits[0].subject, "second");
        assert!(preview.commits[0].files.iter().any(|file| file.path == "b.txt"));

        let custom = preview_push(&local_s, Some("origin"), Some("feature"), None).unwrap();
        assert_eq!(custom.target_branch, "feature");
        assert!(!custom.target_exists);
        assert!(custom.will_set_upstream);

        let pushed = push_to(&local_s, "origin", "feature", true, None, &mut |_| {}).unwrap();
        assert_eq!(pushed.status, "ok", "{}", pushed.message);
        assert_eq!(upstream_ref(&local_s).as_deref(), Some("origin/feature"));
        let (branch, _) = current_branch(&local_s).unwrap();
        assert_eq!(branch, "main", "推送到别的远程分支不能改本地分支名");

        let tracked = preview_push(&local_s, None, None, None).unwrap();
        assert_eq!(tracked.remote, "origin");
        assert_eq!(tracked.target_branch, "feature", "已有上游时默认推到上游，而不是强行同名");
        assert!(tracked.target_exists);
        assert_eq!(tracked.ahead, 0);
        assert!(tracked.commits.is_empty());
        assert!(!tracked.will_set_upstream);

        let feature_ref = run_git(&local_s, &["rev-parse", "refs/remotes/origin/feature"], Duration::from_secs(8)).unwrap();
        assert!(push_to(&local_s, "origin", "bad:name", false, None, &mut |_| {}).is_err());
        assert!(push_to(&local_s, "elsewhere", "main", false, None, &mut |_| {}).is_err());
        let feature_after = run_git(&local_s, &["rev-parse", "refs/remotes/origin/feature"], Duration::from_secs(8)).unwrap();
        assert_eq!(lossy(&feature_ref.stdout), lossy(&feature_after.stdout));

        fs::write(local.join("c.txt"), "v3\n").unwrap();
        git_ok(&local_s, &["add", "c.txt"]);
        git_ok(&local_s, &["commit", "-m", "third"]);
        let again = preview_push(&local_s, Some("origin"), Some("feature"), None).unwrap();
        assert_eq!(again.ahead, 1);
        assert_eq!(again.commits.len(), 1);
        assert!(again.commits[0].files.iter().any(|file| file.path == "c.txt"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn update_asks_before_overlapping_local_changes() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-update-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin");
        let local = root.join("local");
        init_repo(&origin);
        let origin_s = origin.to_string_lossy().to_string();
        fs::write(origin.join("a.txt"), "v1\n").unwrap();
        git_ok(&origin_s, &["add", "a.txt"]);
        git_ok(&origin_s, &["commit", "-m", "v1"]);
        let root_s = root.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        git_ok(&root_s, &["clone", &origin_s, &local_s]);
        let before = run_git(&local_s, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();
        fs::write(origin.join("a.txt"), "v2\n").unwrap();
        git_ok(&origin_s, &["add", "a.txt"]);
        git_ok(&origin_s, &["commit", "-m", "v2"]);
        fs::write(local.join("a.txt"), "local\n").unwrap();

        let asked = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(asked.status, "needs_confirm", "{}", asked.message);
        assert!(asked.conflicting_paths.iter().any(|path| path.ends_with("a.txt")));
        let after = run_git(&local_s, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();
        assert_eq!(lossy(&before.stdout), lossy(&after.stdout), "confirm must not merge");
        assert_eq!(
            fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n"),
            "local\n"
        );

        // 选择“贮藏后更新”：本地改动先入 stash，合并完成再自动恢复（可能带回冲突，但不丢）。
        let stashed = update_repo(&local_s, false, "stash", &mut |_| {}).unwrap();
        assert_eq!(stashed.status, "ok", "{}", stashed.message);
        let restored = fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n");
        assert!(restored.contains("local"), "本地改动必须保住：{restored}");
        assert!(restored.contains("<<<<<<<"), "冲突应留在工作区供三方合并：{restored}");
        assert!(!restored.contains("v1"), "必须已合并到 v2：{restored}");
        let _ = fs::remove_dir_all(&root);
    }

    /// 本地改了 A、远程改了 B 时不该弹确认框：三点 diff 曾把本地未推送的 A 也算成远程变更。
    #[test]
    fn update_skips_confirm_when_dirty_file_is_untouched_by_remote() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-update-clean-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin");
        let local = root.join("local");
        init_repo(&origin);
        let origin_s = origin.to_string_lossy().to_string();
        fs::write(origin.join("a.txt"), "v1\n").unwrap();
        fs::write(origin.join("b.txt"), "v1\n").unwrap();
        git_ok(&origin_s, &["add", "."]);
        git_ok(&origin_s, &["commit", "-m", "v1"]);
        let root_s = root.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        git_ok(&root_s, &["clone", &origin_s, &local_s]);
        fs::write(origin.join("b.txt"), "v2\n").unwrap();
        git_ok(&origin_s, &["add", "b.txt"]);
        git_ok(&origin_s, &["commit", "-m", "v2"]);
        // 本地只动 a.txt，远程只动 b.txt，两者不交叉。
        fs::write(local.join("a.txt"), "local-only\n").unwrap();

        let outcome = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(outcome.status, "ok", "{}", outcome.message);
        let dirty = fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n");
        assert_eq!(dirty, "local-only\n");
        let merged = fs::read_to_string(local.join("b.txt")).unwrap().replace("\r\n", "\n");
        assert_eq!(merged, "v2\n");
        assert!(head_matches_upstream(&local_s), "不重叠的落后更新应快进，而不是停在旧提交");
        assert!(!is_merge_commit(&local_s), "能快进时不应制造合并提交");
        let _ = fs::remove_dir_all(&root);
    }

    /// 已提交、不领先、远程有新提交：直接快进，不出合并提交。
    #[test]
    fn update_fast_forwards_when_local_has_no_unique_commits() {
        let (root, origin_s, local_s) = cloned_pair("snail-git-update-ff");
        let origin = root.join("origin");
        fs::write(origin.join("a.txt"), "v2\n").unwrap();
        git_ok(&origin_s, &["add", "a.txt"]);
        git_ok(&origin_s, &["commit", "-m", "v2"]);

        let outcome = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(outcome.status, "ok", "{}", outcome.message);
        assert!(head_matches_upstream(&local_s));
        assert!(!is_merge_commit(&local_s), "{}", outcome.message);
        let _ = fs::remove_dir_all(&root);
    }

    /// 两边都有独有提交时仍要合并提交，不能因为允许快进就把分叉当成快进。
    #[test]
    fn update_creates_merge_commit_when_histories_diverge() {
        let (root, origin_s, local_s) = cloned_pair("snail-git-update-diverge");
        let origin = root.join("origin");
        let local = root.join("local");
        fs::write(origin.join("b.txt"), "remote\n").unwrap();
        git_ok(&origin_s, &["add", "b.txt"]);
        git_ok(&origin_s, &["commit", "-m", "remote file"]);
        fs::write(local.join("a.txt"), "local-commit\n").unwrap();
        git_ok(&local_s, &["add", "a.txt"]);
        git_ok(&local_s, &["commit", "-m", "local file"]);

        let outcome = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(outcome.status, "ok", "{}", outcome.message);
        assert!(is_merge_commit(&local_s), "分叉且无内容冲突时应创建合并提交");
        assert_eq!(
            fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n"),
            "local-commit\n"
        );
        assert_eq!(
            fs::read_to_string(local.join("b.txt")).unwrap().replace("\r\n", "\n"),
            "remote\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn update_rebase_skips_confirm_when_dirty_file_is_untouched() {
        let (root, origin_s, local_s) = cloned_pair("snail-git-update-rebase-clean");
        let origin = root.join("origin");
        let local = root.join("local");
        git_ok(&local_s, &["config", "pull.rebase", "true"]);
        fs::write(origin.join("b.txt"), "v2\n").unwrap();
        git_ok(&origin_s, &["add", "b.txt"]);
        git_ok(&origin_s, &["commit", "-m", "v2"]);
        fs::write(local.join("a.txt"), "local-only\n").unwrap();

        let outcome = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(outcome.status, "ok", "{}", outcome.message);
        assert_ne!(outcome.status, "needs_confirm");
        assert_eq!(
            fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n"),
            "local-only\n"
        );
        assert_eq!(
            fs::read_to_string(local.join("b.txt")).unwrap().replace("\r\n", "\n"),
            "v2\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn update_rebase_asks_then_stashes_overlapping_changes() {
        let (root, origin_s, local_s) = cloned_pair("snail-git-update-rebase-overlap");
        let origin = root.join("origin");
        let local = root.join("local");
        git_ok(&local_s, &["config", "pull.rebase", "true"]);
        fs::write(origin.join("a.txt"), "v2\n").unwrap();
        git_ok(&origin_s, &["add", "a.txt"]);
        git_ok(&origin_s, &["commit", "-m", "v2"]);
        fs::write(local.join("a.txt"), "local\n").unwrap();
        let before = run_git(&local_s, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();

        let asked = update_repo(&local_s, false, "probe", &mut |_| {}).unwrap();
        assert_eq!(asked.status, "needs_confirm", "{}", asked.message);
        assert_eq!(asked.strategy, "rebase");
        let after = run_git(&local_s, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();
        assert_eq!(lossy(&before.stdout), lossy(&after.stdout), "确认前不应变基");

        let stashed = update_repo(&local_s, false, "stash", &mut |_| {}).unwrap();
        assert_eq!(stashed.status, "ok", "{}", stashed.message);
        let restored = fs::read_to_string(local.join("a.txt")).unwrap().replace("\r\n", "\n");
        assert!(restored.contains("local"), "本地改动必须保住：{restored}");
        assert!(head_matches_upstream(&local_s), "贮藏后应已变基到远程");
        let _ = fs::remove_dir_all(&root);
    }

    fn cloned_pair(prefix: &str) -> (PathBuf, String, String) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("{prefix}-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin");
        let local = root.join("local");
        init_repo(&origin);
        let origin_s = origin.to_string_lossy().to_string();
        fs::write(origin.join("a.txt"), "v1\n").unwrap();
        fs::write(origin.join("b.txt"), "v1\n").unwrap();
        git_ok(&origin_s, &["add", "."]);
        git_ok(&origin_s, &["commit", "-m", "v1"]);
        let root_s = root.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        git_ok(&root_s, &["clone", &origin_s, &local_s]);
        (root, origin_s, local_s)
    }

    #[test]
    fn remote_crud_and_local_fetch_do_not_touch_network() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-remote-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let origin = root.join("origin");
        init_repo(&origin);
        let origin_s = origin.to_string_lossy().to_string();
        fs::write(origin.join("a.txt"), "v1\n").unwrap();
        git_ok(&origin_s, &["add", "."]);
        git_ok(&origin_s, &["commit", "-m", "v1"]);

        let local = root.join("local");
        init_repo(&local);
        let local_s = local.to_string_lossy().to_string();
        assert!(add_remote(&local_s, "-origin", &origin_s).is_err());
        assert!(add_remote(&local_s, "origin", "--upload-pack=evil").is_err());
        assert!(add_remote(&local_s, "origin", "ext::calc").is_err());
        add_remote(&local_s, "origin", &origin_s).unwrap();
        let listed = list_remotes(&local_s).unwrap();
        assert_eq!(listed.remotes.len(), 1);
        assert_eq!(listed.remotes[0].name, "origin");
        assert_eq!(listed.remotes[0].fetch_url, origin_s);

        let push_url = root.join("push-only").to_string_lossy().to_string();
        set_remote_url(&local_s, "origin", &origin_s, Some(&push_url)).unwrap();
        rename_remote(&local_s, "origin", "upstream").unwrap();
        let renamed = list_remotes(&local_s).unwrap();
        assert_eq!(renamed.remotes[0].name, "upstream");
        assert_eq!(renamed.remotes[0].push_url, push_url);
        set_remote_url(&local_s, "upstream", &origin_s, None).unwrap();

        let fetched = fetch_remote(&local_s, "upstream", &mut |_| {}).unwrap();
        assert!(!fetched.is_empty());
        remove_remote(&local_s, "upstream").unwrap();
        assert!(list_remotes(&local_s).unwrap().remotes.is_empty());

        let parent = root.join("clones");
        fs::create_dir_all(&parent).unwrap();
        assert!(clone_repo(&origin_s, &parent.to_string_lossy(), "..", &mut |_| {}).is_err());
        assert!(clone_repo("-evil", &parent.to_string_lossy(), "copy", &mut |_| {}).is_err());
        let cloned = clone_repo(&origin_s, &parent.to_string_lossy(), "copy", &mut |_| {}).unwrap();
        assert!(Path::new(&cloned).join(".git").exists() || Path::new(&cloned).join(".git").is_file());
        assert!(clone_repo(&origin_s, &parent.to_string_lossy(), "copy", &mut |_| {}).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    fn sha(repo: &str, rev: &str) -> String {
        let output = run_git(repo, &["rev-parse", rev], Duration::from_secs(8)).unwrap();
        assert!(output.status.success(), "{rev} {}", lossy(&output.stderr));
        lossy(&output.stdout)
    }

    #[test]
    fn push_source_uses_selected_branch_not_head() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-push-source-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let bare = root.join("origin.git");
        let local = root.join("local");
        let bare_s = bare.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        let root_s = root.to_string_lossy().to_string();
        git_ok(&root_s, &["init", "--bare", "-b", "main", &bare_s]);
        init_repo(&local);
        fs::write(local.join("a.txt"), "v1\n").unwrap();
        git_ok(&local_s, &["add", "a.txt"]);
        git_ok(&local_s, &["commit", "-m", "init"]);
        git_ok(&local_s, &["remote", "add", "origin", &bare_s]);
        git_ok(&local_s, &["checkout", "-b", "feature"]);
        fs::write(local.join("b.txt"), "v2\n").unwrap();
        git_ok(&local_s, &["add", "b.txt"]);
        git_ok(&local_s, &["commit", "-m", "feature-only"]);
        git_ok(&local_s, &["checkout", "main"]);

        let preview = preview_push(&local_s, None, None, Some("feature")).unwrap();
        assert_eq!(preview.local_branch, "feature");
        assert_eq!(preview.target_branch, "feature");
        assert!(preview.commits.iter().any(|commit| commit.subject == "feature-only"));
        assert!(!preview.commits.iter().any(|commit| commit.subject == "init") || preview.ahead >= 1);

        let head_only = preview_push(&local_s, None, None, None).unwrap();
        assert_eq!(head_only.local_branch, "main");
        assert!(!head_only.commits.iter().any(|commit| commit.subject == "feature-only"));

        let pushed = push_to(&local_s, "origin", "feature", true, Some("feature"), &mut |_| {}).unwrap();
        assert_eq!(pushed.status, "ok", "{}", pushed.message);
        let (branch, _) = current_branch(&local_s).unwrap();
        assert_eq!(branch, "main");
        let tracked = run_git(
            &local_s,
            &["rev-parse", "--abbrev-ref", "feature@{upstream}"],
            Duration::from_secs(8),
        )
        .unwrap();
        assert_eq!(lossy(&tracked.stdout), "origin/feature");
        assert!(upstream_ref(&local_s).is_none(), "当前分支上游不应被改写");
        assert!(preview_push(&local_s, None, None, Some("missing")).is_err());
        assert!(preview_push(&local_s, None, None, Some("bad:name")).is_err());

        git_ok(&local_s, &["checkout", "--detach"]);
        let detached = preview_push(&local_s, None, None, Some("feature")).unwrap();
        assert_eq!(detached.local_branch, "feature");
        assert!(preview_push(&local_s, None, None, None).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn update_local_branch_fast_forwards_without_moving_head() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("snail-git-update-local-{stamp}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let bare = root.join("origin.git");
        let local = root.join("local");
        let other = root.join("other");
        let bare_s = bare.to_string_lossy().to_string();
        let local_s = local.to_string_lossy().to_string();
        let other_s = other.to_string_lossy().to_string();
        let root_s = root.to_string_lossy().to_string();
        git_ok(&root_s, &["init", "--bare", "-b", "main", &bare_s]);
        init_repo(&local);
        fs::write(local.join("a.txt"), "v1\n").unwrap();
        git_ok(&local_s, &["add", "a.txt"]);
        git_ok(&local_s, &["commit", "-m", "init"]);
        git_ok(&local_s, &["remote", "add", "origin", &bare_s]);
        git_ok(&local_s, &["push", "-u", "origin", "main"]);
        git_ok(&local_s, &["branch", "feature"]);
        git_ok(&local_s, &["push", "-u", "origin", "feature"]);
        git_ok(&root_s, &["clone", &bare_s, &other_s]);
        git_ok(&other_s, &["config", "user.email", "test@snailgit.local"]);
        git_ok(&other_s, &["config", "user.name", "SnailGit Test"]);
        git_ok(&other_s, &["checkout", "feature"]);
        fs::write(other.join("b.txt"), "remote\n").unwrap();
        git_ok(&other_s, &["add", "b.txt"]);
        git_ok(&other_s, &["commit", "-m", "remote-feature"]);
        git_ok(&other_s, &["push", "origin", "feature"]);

        fs::write(local.join("dirty.txt"), "keep\n").unwrap();
        let head_before = sha(&local_s, "HEAD");
        let feature_before = sha(&local_s, "refs/heads/feature");
        let updated = update_local_branch(&local_s, "feature", &mut |_| {}).unwrap();
        assert_eq!(updated.status, "ok", "{}", updated.message);
        assert_ne!(sha(&local_s, "refs/heads/feature"), feature_before);
        assert_eq!(sha(&local_s, "refs/heads/feature"), sha(&local_s, "refs/remotes/origin/feature"));
        assert_eq!(sha(&local_s, "HEAD"), head_before);
        assert_eq!(fs::read_to_string(local.join("dirty.txt")).unwrap(), "keep\n");
        let (branch, _) = current_branch(&local_s).unwrap();
        assert_eq!(branch, "main");

        let again = update_local_branch(&local_s, "feature", &mut |_| {}).unwrap();
        assert_eq!(again.status, "up_to_date", "{}", again.message);

        git_ok(&local_s, &["branch", "lonely"]);
        let lonely_before = sha(&local_s, "refs/heads/lonely");
        let no_upstream = update_local_branch(&local_s, "lonely", &mut |_| {}).unwrap();
        assert_eq!(no_upstream.status, "ok", "{}", no_upstream.message);
        assert!(no_upstream.message.contains("没有上游"));
        assert_eq!(sha(&local_s, "refs/heads/lonely"), lonely_before);

        assert!(update_local_branch(&local_s, "main", &mut |_| {}).is_err());

        git_ok(&local_s, &["checkout", "-b", "diverged", "feature"]);
        fs::write(local.join("local-only.txt"), "x\n").unwrap();
        git_ok(&local_s, &["add", "local-only.txt"]);
        git_ok(&local_s, &["commit", "-m", "local-diverge"]);
        git_ok(&local_s, &["checkout", "main"]);
        git_ok(&other_s, &["commit", "--allow-empty", "-m", "remote-diverge"]);
        git_ok(&other_s, &["push", "origin", "feature"]);
        git_ok(&local_s, &["branch", "--set-upstream-to=origin/feature", "diverged"]);
        let diverged_before = sha(&local_s, "refs/heads/diverged");
        let blocked = update_local_branch(&local_s, "diverged", &mut |_| {}).unwrap();
        assert_eq!(blocked.status, "blocked", "{}", blocked.message);
        assert_eq!(sha(&local_s, "refs/heads/diverged"), diverged_before);
        assert_eq!(sha(&local_s, "HEAD"), head_before);
        let _ = fs::remove_dir_all(&root);
    }

    fn head_matches_upstream(repo: &str) -> bool {
        let head = run_git(repo, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();
        let upstream = run_git(repo, &["rev-parse", "@{upstream}"], Duration::from_secs(8)).unwrap();
        lossy(&head.stdout) == lossy(&upstream.stdout)
    }

    fn is_merge_commit(repo: &str) -> bool {
        let output = run_git(repo, &["rev-parse", "--verify", "-q", "HEAD^2"], Duration::from_secs(8)).unwrap();
        output.status.success()
    }

    fn history_commit(hash: &str, parent: &str) -> HistoryCommit {
        HistoryCommit {
            hash: hash.to_string(),
            parents: if parent.is_empty() {
                Vec::new()
            } else {
                vec![parent.to_string()]
            },
            author: "A".into(),
            email: "a@example.com".into(),
            subject: hash.to_string(),
            body: String::new(),
            committed_at: "2024-01-01T00:00:00+00:00".into(),
        }
    }

    #[test]
    fn squash_span_requires_a_contiguous_first_parent_range() {
        let history = vec![
            history_commit("ccccccc1", "bbbbbbb1"),
            history_commit("bbbbbbb1", "aaaaaaa1"),
            history_commit("aaaaaaa1", "11111111"),
        ];
        let (newest, oldest) =
            resolve_squash_span(&history, &["ccccccc1".into(), "bbbbbbb1".into()]).unwrap();
        assert_eq!((newest, oldest), (0, 1));
        assert!(resolve_squash_span(&history, &["ccccccc1".into(), "aaaaaaa1".into()]).is_err());
        assert!(resolve_squash_span(&history, &["bbbbbbb1".into()]).is_err());
    }

    #[test]
    fn first_parent_log_keeps_multiline_body() {
        let text = "abc1234\x1fdef5678\x1fAlice\x1falice@example.com\x1fsubject\x1f2024-01-02T03:04:05+08:00\x1fline1\n\nline2\x1e";
        let commits = parse_first_parent_log(text);
        assert_eq!(commits.len(), 1);
        assert_eq!(commits[0].subject, "subject");
        assert_eq!(commits[0].committed_at, "2024-01-02T03:04:05+08:00");
        assert_eq!(commits[0].body, "line1\n\nline2");
        assert_eq!(commits[0].parents, vec!["def5678".to_string()]);
        let message = suggest_squash_message(&commits);
        assert_eq!(message, "subject\n\nline1\n\nline2");
    }

    fn squash_repo(prefix: &str) -> (PathBuf, String) {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let dir = std::env::temp_dir().join(format!("{prefix}-{stamp}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        init_repo(&dir);
        let path = dir.to_string_lossy().to_string();
        git_ok(&path, &["config", "core.autocrlf", "false"]);
        (dir, path)
    }

    fn commit_file(dir: &Path, path: &str, name: &str, content: &str, message: &str) {
        fs::write(dir.join(name), content).unwrap();
        git_ok(path, &["add", name]);
        git_ok(path, &["commit", "-m", message]);
    }

    fn log_subjects(path: &str) -> Vec<String> {
        load_commit_log(path, &CommitLogQuery::default())
            .unwrap()
            .commits
            .into_iter()
            .map(|commit| commit.subject)
            .collect()
    }

    fn head_hash(path: &str) -> String {
        let output = run_git(path, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();
        lossy(&output.stdout)
    }

    #[test]
    fn squash_tip_combines_trees_and_keeps_oldest_author() {
        let (dir, path) = squash_repo("snail-git-squash-tip");
        commit_file(&dir, &path, "root.txt", "root\n", "root");
        fs::write(dir.join("a.txt"), "alice\n").unwrap();
        git_ok(&path, &["add", "a.txt"]);
        git_ok(
            &path,
            &[
                "-c",
                "user.name=Alice",
                "-c",
                "user.email=alice@example.com",
                "commit",
                "-m",
                "alice work",
            ],
        );
        commit_file(&dir, &path, "b.txt", "bob\n", "bob work");
        commit_file(&dir, &path, "c.txt", "carol\n", "carol work");
        let before = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        assert_eq!(before.len(), 4);
        let hashes = vec![before[0].hash.clone(), before[1].hash.clone(), before[2].hash.clone()];
        let preview = preview_squash(&path, &hashes).unwrap();
        assert_eq!(preview.replay_count, 0);
        assert_eq!(preview.commits[0].subject, "alice work");
        assert!(preview.message.contains("alice work") && preview.message.contains("carol work"));

        let text = squash_commits(&path, &hashes, "feature done\n\ncombined").unwrap();
        assert!(text.contains("已将 3 个提交压缩为"), "{text}");
        let after = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        assert_eq!(after.len(), 2);
        assert_eq!(after[0].subject, "feature done");
        assert_eq!(after[0].author, "Alice");
        let files = load_commit_files(&path, &after[0].hash).unwrap();
        assert!(files.iter().any(|file| file.path == "a.txt"));
        assert!(files.iter().any(|file| file.path == "c.txt"));
        assert!(dir.join("b.txt").is_file());
        assert!(text.contains("git reset --hard "));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn squash_middle_replays_later_commits() {
        let (dir, path) = squash_repo("snail-git-squash-middle");
        commit_file(&dir, &path, "base.txt", "base\n", "base");
        commit_file(&dir, &path, "a.txt", "A\n", "commit a");
        commit_file(&dir, &path, "b.txt", "B\n", "commit b");
        commit_file(&dir, &path, "c.txt", "C\n", "commit c");
        let before = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        let hashes = vec![before[1].hash.clone(), before[2].hash.clone()];
        let preview = preview_squash(&path, &hashes).unwrap();
        assert_eq!(preview.replay_count, 1);
        assert_eq!(preview.commits[0].subject, "commit a");

        squash_commits(&path, &hashes, "ab together").unwrap();
        assert_eq!(
            log_subjects(&path),
            vec!["commit c".to_string(), "ab together".to_string(), "base".to_string()]
        );
        assert_eq!(fs::read_to_string(dir.join("c.txt")).unwrap(), "C\n");
        assert!(dir.join("a.txt").is_file() && dir.join("b.txt").is_file());
        let branch = current_branch(&path).unwrap().0;
        assert_eq!(branch, "main");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn squash_rejects_gaps_without_moving_head() {
        let (dir, path) = squash_repo("snail-git-squash-guard");
        commit_file(&dir, &path, "a.txt", "base\n", "base");
        commit_file(&dir, &path, "a.txt", "A\n", "commit a");
        commit_file(&dir, &path, "a.txt", "B\n", "commit b");
        commit_file(&dir, &path, "a.txt", "C\n", "commit c");
        let before = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        let head = head_hash(&path);
        let gap = preview_squash(&path, &[before[0].hash.clone(), before[2].hash.clone()]);
        assert!(gap.is_err(), "{gap:?}");
        assert_eq!(head_hash(&path), head);
        let _ = fs::remove_dir_all(&dir);
    }

    fn porcelain(path: &str) -> String {
        let output = run_git(
            path,
            &["status", "--porcelain=v1", "--untracked-files=normal"],
            Duration::from_secs(12),
        )
        .unwrap();
        assert!(output.status.success(), "{}", lossy(&output.stderr));
        // 不能用 lossy()：它会 trim 掉第一行开头的空格，未暂存修改就看不出来。
        String::from_utf8_lossy(&output.stdout).trim_end().to_string()
    }

    fn stash_count(path: &str) -> usize {
        let output = run_git(path, &["stash", "list"], Duration::from_secs(8)).unwrap();
        assert!(output.status.success(), "{}", lossy(&output.stderr));
        lossy(&output.stdout).lines().filter(|line| !line.trim().is_empty()).count()
    }

    #[test]
    fn squash_puts_uncommitted_changes_back() {
        let (dir, path) = squash_repo("snail-git-squash-dirty");
        commit_file(&dir, &path, "a.txt", "one\n", "one");
        commit_file(&dir, &path, "b.txt", "two\n", "two");
        commit_file(&dir, &path, "c.txt", "three\n", "three");
        fs::write(dir.join("a.txt"), "one\ndirty\n").unwrap();
        fs::write(dir.join("staged.txt"), "staged\n").unwrap();
        git_ok(&path, &["add", "staged.txt"]);
        fs::write(dir.join("extra.txt"), "extra\n").unwrap();
        let before = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        let preview = preview_squash(&path, &[before[0].hash.clone(), before[1].hash.clone()]).unwrap();
        assert!(preview.has_local_changes);

        squash_commits(&path, &[before[0].hash.clone(), before[1].hash.clone()], "together").unwrap();
        assert_eq!(log_subjects(&path)[0], "together");
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "one\ndirty\n");
        assert_eq!(fs::read_to_string(dir.join("extra.txt")).unwrap(), "extra\n");
        assert_eq!(fs::read_to_string(dir.join("staged.txt")).unwrap(), "staged\n");
        let status = porcelain(&path);
        assert!(status.contains("staged.txt"), "{status}");
        assert!(status.lines().any(|line| line.ends_with("staged.txt") && line.starts_with("A")), "{status}");
        assert!(status.lines().any(|line| line.contains("a.txt") && line.starts_with(" M")), "{status}");
        assert!(status.lines().any(|line| line.contains("extra.txt") && line.starts_with("??")), "{status}");
        assert_eq!(stash_count(&path), 0);
        let files = load_commit_files(&path, &load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits[0].hash).unwrap();
        assert!(!files.iter().any(|file| file.path == "staged.txt" || file.path == "extra.txt"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn squash_failure_restores_uncommitted_changes() {
        let (dir, path) = squash_repo("snail-git-squash-dirty-rollback");
        commit_file(&dir, &path, "root.txt", "root\n", "root");
        commit_file(&dir, &path, "a.txt", "one\n", "one");
        commit_file(&dir, &path, "b.txt", "two\n", "two");
        fs::write(dir.join("a.txt"), "one\ndirty\n").unwrap();
        let hooks = dir.join(".git").join("hooks");
        fs::create_dir_all(&hooks).unwrap();
        fs::write(hooks.join("pre-commit"), "#!/bin/sh\nexit 1\n").unwrap();
        let before = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        let head = head_hash(&path);
        let err = squash_commits(&path, &[before[0].hash.clone(), before[1].hash.clone()], "nope").unwrap_err();
        assert!(err.contains("恢复"), "{err}");
        assert_eq!(head_hash(&path), head);
        assert_eq!(fs::read_to_string(dir.join("a.txt")).unwrap(), "one\ndirty\n");
        assert_eq!(stash_count(&path), 0);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn squash_hook_failure_restores_the_branch() {
        let (dir, path) = squash_repo("snail-git-squash-rollback");
        commit_file(&dir, &path, "a.txt", "one\n", "one");
        commit_file(&dir, &path, "b.txt", "two\n", "two");
        commit_file(&dir, &path, "c.txt", "three\n", "three");
        let hooks = dir.join(".git").join("hooks");
        fs::create_dir_all(&hooks).unwrap();
        fs::write(hooks.join("pre-commit"), "#!/bin/sh\nexit 1\n").unwrap();
        let before = load_commit_log(&path, &CommitLogQuery::default()).unwrap().commits;
        let head = head_hash(&path);
        let err = squash_commits(
            &path,
            &[before[0].hash.clone(), before[1].hash.clone()],
            "should not land",
        )
        .unwrap_err();
        assert!(err.contains("恢复") || err.contains("写入压缩提交"), "{err}");
        assert_eq!(head_hash(&path), head);
        assert_eq!(log_subjects(&path).len(), 3);
        assert!(!rebase_in_progress(&path));
        assert_eq!(current_branch(&path).unwrap().0, "main");
        let _ = fs::remove_dir_all(&dir);
    }
}

pub fn pick_directory() -> Result<Option<String>, String> {
    let script = r#"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '选择 Git 仓库目录'
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }
"#;
    let output = hidden_command("powershell")
        .args(["-STA", "-NoProfile", "-Command", script])
        .output()
        .map_err(|e| format!("无法打开目录选择器：{e}"))?;
    let path = lossy(&output.stdout);
    if path.is_empty() {
        Ok(None)
    } else {
        Ok(Some(path.lines().next().unwrap_or("").trim().to_string()))
    }
}
