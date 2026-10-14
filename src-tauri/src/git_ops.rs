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
    pub branches: Vec<GitBranchDto>,
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

pub fn writable_data_dir() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("EasyGit"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.join("easy-git-data"));
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("target").join("easy-git-data"));
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

pub fn git_log(repo: &str) -> Result<Vec<GitCommitDto>, String> {
    let output = run_git(
        repo,
        &[
            "log",
            "--all",
            "--date-order",
            "-n",
            "200",
            "--name-status",
            "--date=format:%Y-%m-%d %H:%M:%S",
            "--pretty=format:COMMIT%x1f%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%ar%x1f%D%x1f%s%x1f%b%x1e",
        ],
        Duration::from_secs(25),
    )?;
    let text = ensure_ok(&output, "读取提交历史")?;
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
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        let refs = fields[7]
            .split(", ")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
        let body = if fields.len() > 9 {
            let b = fields[9..].join("\x1f").trim().to_string();
            if b.is_empty() { None } else { Some(b) }
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
                path: display,
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
    assign_tracks(&mut commits);
    attach_numstat(repo, &mut commits);
    Ok(commits)
}

fn attach_numstat(repo: &str, commits: &mut [GitCommitDto]) {
    let output = match run_git(
        repo,
        &[
            "log",
            "--all",
            "--date-order",
            "-n",
            "200",
            "--numstat",
            "--pretty=format:%H",
        ],
        Duration::from_secs(25),
    ) {
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
        if !line.contains('\t') && line.chars().all(|c| c.is_ascii_hexdigit()) && line.len() >= 7 {
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
    Ok(RepoSnapshot {
        dirty_files_count: changes.len() as u32,
        commits: git_log(&top).unwrap_or_default(),
        branches: list_branches(&top, &branch).unwrap_or_default(),
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

pub fn file_diff(repo: &str, path: &str) -> Result<Vec<DiffChunkDto>, String> {
    file_diff_opts(repo, path, false)
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
    if name.starts_with("origin/") {
        let local_name = name.trim_start_matches("origin/");
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
    }
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

fn incoming_paths(repo: &str) -> Result<Vec<String>, String> {
    let output = run_git(
        repo,
        &["diff", "--name-only", "HEAD...@{upstream}"],
        Duration::from_secs(20),
    )?;
    let text = ensure_ok(&output, "读取远程变更")?;
    Ok(text.lines().map(str::trim).filter(|line| !line.is_empty()).map(str::to_string).collect())
}

fn update_risk_message(strategy: &str, overlap: &[String], tracked_dirty: &[String]) -> (bool, String, Vec<String>) {
    if strategy != "merge" && !tracked_dirty.is_empty() {
        let paths = if overlap.is_empty() { tracked_dirty.to_vec() } else { overlap.to_vec() };
        let files = if paths.is_empty() { String::new() } else { format!("涉及 {}。", join_limited(&paths)) };
        return (
            true,
            format!("工作区有未提交修改，当前仓库配置为变基，继续可能失败。{files}仍要继续？"),
            paths,
        );
    }
    if !overlap.is_empty() {
        return (
            true,
            format!("这些未提交文件可能和远程更新冲突：{}。仍要继续？", join_limited(overlap)),
            overlap.to_vec(),
        );
    }
    (false, String::new(), Vec::new())
}

pub fn update_repo(repo: &str, confirm_risk: bool, on_progress: &mut dyn FnMut(&str)) -> Result<SyncOutcome, String> {
    let _pause = WatchPauseGuard::new();
    let top = validate_repo(repo)?;
    let (branch, _) = require_branch(&top)?;
    let remote = choose_remote(&top, &branch)?;
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
    let incoming = incoming_paths(&top)?;
    let mut comparable = dirty.tracked.clone();
    comparable.extend(dirty.untracked.iter().cloned());
    let overlap = overlapping_paths(&comparable, &incoming);
    let (needs_confirm, message, paths) = update_risk_message(strategy, &overlap, &dirty.tracked);
    if needs_confirm && !confirm_risk {
        return Ok(sync_outcome("needs_confirm", message, ahead, behind, &remote, &branch, paths));
    }
    let integrate_label = if strategy == "merge" { "正在合并远程更新…" } else { "正在变基到远程更新…" };
    on_progress(integrate_label);
    let output = match strategy {
        "rebase" => run_git_streaming(&top, &["rebase", "--", "@{upstream}"], NETWORK_TIMEOUT, None, on_progress)?,
        "rebase-merges" => run_git_streaming(
            &top,
            &["rebase", "--rebase-merges", "--", "@{upstream}"],
            NETWORK_TIMEOUT,
            None,
            on_progress,
        )?,
        _ => run_git_streaming(&top, &["merge", "--no-edit", "--", "@{upstream}"], NETWORK_TIMEOUT, None, on_progress)?,
    };
    let text = finish_network(&output, if strategy == "merge" { "合并" } else { "变基" })?;
    let (ahead, behind) = ahead_behind(&top);
    Ok(sync_outcome(
        "ok",
        command_summary_text(&text, "已更新"),
        ahead,
        behind,
        &remote,
        &branch,
        Vec::new(),
    ))
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

pub fn stash_save(repo: &str, message: &str) -> Result<String, String> {
    let top = validate_repo(repo)?;
    let msg = if message.trim().is_empty() { "EasyGit stash" } else { message.trim() };
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
    let Some(dest) = pick_save_path("easy-git.patch")? else {
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
    let dir = std::env::temp_dir().join(format!("easy-git-merge-{}", std::process::id()));
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
        let dir = std::env::temp_dir().join(format!("easy-git-test-{}", std::process::id()));
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        fs::create_dir_all(&dir).unwrap();
        let path = dir.to_string_lossy().to_string();
        let init = run_git(&path, &["init", "-b", "main"], Duration::from_secs(10)).unwrap();
        assert!(init.status.success(), "{}", lossy(&init.stderr));
        let _ = run_git(&path, &["config", "user.email", "test@easygit.local"], Duration::from_secs(5));
        let _ = run_git(&path, &["config", "user.name", "EasyGit Test"], Duration::from_secs(5));
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
        let log = git_log(&path).unwrap();
        assert_eq!(log.len(), 1);
        assert_eq!(log[0].subject, "init");
        assert!(log[0].refs.iter().any(|r| r.contains("main")));
        assert!(log[0].files.iter().any(|f| f.additions > 0), "commit file stats should come from numstat");

        fs::write(dir.join("a.txt"), "hello\nchanged\n").unwrap();
        let diff = file_diff(&path, "a.txt").unwrap();
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
        let (old_spans, new_spans) = word_spans("hello world", "hello EasyGit");
        assert!(old_spans.iter().any(|span| span.kind == "del" && span.text.contains("world")));
        assert!(new_spans.iter().any(|span| span.kind == "add" && span.text.contains("EasyGit")));

        let _ = fs::remove_dir_all(&dir);
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
        git_ok(&cwd, &["config", "user.email", "test@easygit.local"]);
        git_ok(&cwd, &["config", "user.name", "EasyGit Test"]);
    }

    #[test]
    fn push_confirms_upstream_and_skips_when_nothing_to_push() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("easy-git-sync-{stamp}"));
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
    fn update_asks_before_overlapping_local_changes() {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let root = std::env::temp_dir().join(format!("easy-git-update-{stamp}"));
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

        let asked = update_repo(&local_s, false, &mut |_| {}).unwrap();
        assert_eq!(asked.status, "needs_confirm", "{}", asked.message);
        assert!(asked.conflicting_paths.iter().any(|path| path.ends_with("a.txt")));
        let after = run_git(&local_s, &["rev-parse", "HEAD"], Duration::from_secs(8)).unwrap();
        assert_eq!(lossy(&before.stdout), lossy(&after.stdout), "confirm must not merge");
        assert_eq!(fs::read_to_string(local.join("a.txt")).unwrap(), "local\n");
        let _ = fs::remove_dir_all(&root);
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
